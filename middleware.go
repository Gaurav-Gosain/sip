package sip

import (
	"context"
	"crypto/subtle"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// ConnectHandler is invoked at the handshake boundary for both
// WebSocket upgrades and WebTransport CONNECTs. Returning a non-nil
// error rejects the connection; returning *ConnectError gives full
// control over the rejection response.
//
// A middleware that approves the connection MUST call next(r). The
// framework's terminal handler captures the *http.Request as last
// seen, which is how context updates propagate to layer 2 / layer 3.
type ConnectHandler func(r *http.Request) error

// ConnectMiddleware decorates a ConnectHandler.
type ConnectMiddleware func(next ConnectHandler) ConnectHandler

// SessionMiddleware decorates an internalSession to allow filtering of
// I/O streams (OutputReader / InputWriter) and lifecycle events.
// Compose using Go's interface-embedding idiom:
//
//	type myMW struct{ sip.SessionIO }
//	func (m *myMW) OutputReader() io.Reader { ... wrap m.SessionIO.OutputReader() ... }
//
// SessionMiddleware values are applied in install order; the first
// middleware installed is the outermost wrapper.
type SessionMiddleware func(SessionIO) SessionIO

// SessionIO is the subset of session capabilities exposed to
// SessionMiddleware. It is the wrappable shape — middleware overrides
// OutputReader / InputWriter to filter byte streams.
type SessionIO interface {
	OutputReader() io.Reader
	InputWriter() io.Writer
	Resize(cols, rows int)
	Done() <-chan struct{}
	Context() context.Context
	Close() error
}

// Middleware decorates a Handler. Matches the shape of
// charmbracelet/wish bubbletea.Middleware.
type Middleware func(next Handler) Handler

// applyConnectMiddleware composes mws in install order — mws[0] is the
// outermost wrapper (sees calls first).
func applyConnectMiddleware(base ConnectHandler, mws []ConnectMiddleware) ConnectHandler {
	for i := len(mws) - 1; i >= 0; i-- {
		base = mws[i](base)
	}
	return base
}

// applySessionMiddleware wraps base with mws — mws[0] is outermost.
func applySessionMiddleware(base SessionIO, mws []SessionMiddleware) SessionIO {
	for i := len(mws) - 1; i >= 0; i-- {
		base = mws[i](base)
	}
	return base
}

// applyHandlerMiddleware wraps base with mws — mws[0] is outermost.
func applyHandlerMiddleware(base Handler, mws []Middleware) Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		base = mws[i](base)
	}
	return base
}

// validateBasicAuth reports whether r carries credentials that match
// the configured username and password. If both are empty, auth is
// skipped and the result is true. Constant-time comparison so response
// timing does not leak the configured secret.
func validateBasicAuth(r *http.Request, username, password string) bool {
	if username == "" && password == "" {
		return true
	}
	u, p, ok := r.BasicAuth()
	if !ok {
		return false
	}
	userOK := subtle.ConstantTimeCompare([]byte(u), []byte(username)) == 1
	passOK := subtle.ConstantTimeCompare([]byte(p), []byte(password)) == 1
	return userOK && passOK
}

// basicAuthMiddleware returns a ConnectMiddleware performing HTTP
// Basic Auth. Failures return *ConnectError{401, WWW-Authenticate, "Unauthorized"}.
func basicAuthMiddleware(username, password string) ConnectMiddleware {
	return func(next ConnectHandler) ConnectHandler {
		return func(r *http.Request) error {
			if !validateBasicAuth(r, username, password) {
				headers := make(http.Header)
				headers.Add("WWW-Authenticate", `Basic realm="sip"`)
				return &ConnectError{
					Status:  http.StatusUnauthorized,
					Headers: headers,
					Body:    "Unauthorized",
				}
			}
			return next(r)
		}
	}
}

// connLimitMiddleware returns a ConnectMiddleware that gates
// connections against srv.config.MaxConnections.
func connLimitMiddleware(srv *httpServer) ConnectMiddleware {
	return func(next ConnectHandler) ConnectHandler {
		return func(r *http.Request) error {
			if !srv.tryAcquireConnection() {
				return &ConnectError{
					Status: http.StatusServiceUnavailable,
					Body:   "max connections reached",
				}
			}
			if err := next(r); err != nil {
				srv.releaseConnection()
				return err
			}
			return nil
		}
	}
}

// idleTimeoutMiddleware returns a SessionMiddleware that closes the
// wrapped session if no inbound bytes arrive for d. Inbound means
// client→PTY writes on InputWriter; outbound activity does NOT reset.
//
// d <= 0 makes the middleware a no-op.
func idleTimeoutMiddleware(d time.Duration) SessionMiddleware {
	return func(base SessionIO) SessionIO {
		if d <= 0 {
			return base
		}
		w := &idleSession{SessionIO: base, timer: time.NewTimer(d), duration: d}
		go w.watch()
		return w
	}
}

type idleSession struct {
	SessionIO
	timer    *time.Timer
	duration time.Duration
}

func (s *idleSession) InputWriter() io.Writer {
	return &idleResetWriter{inner: s.SessionIO.InputWriter(), sess: s}
}

func (s *idleSession) watch() {
	defer s.timer.Stop()
	for {
		select {
		case <-s.Done():
			return
		case <-s.timer.C:
			slog.Default().Info("sip idle timeout", slog.Duration("after", s.duration))
			_ = s.Close()
			return
		}
	}
}

type idleResetWriter struct {
	inner io.Writer
	sess  *idleSession
}

func (w *idleResetWriter) Write(p []byte) (int, error) {
	w.sess.timer.Stop()
	w.sess.timer.Reset(w.sess.duration)
	return w.inner.Write(p)
}

// --- LiftHTTPMiddleware: adapt net/http middleware to ConnectMiddleware ---

var errResponseWritten = errors.New("sip: response already written by lifted middleware")

type liftCtxKey struct{}

type liftBridge struct {
	w http.ResponseWriter
}

type statusCapturingWriter struct {
	http.ResponseWriter
	wrote bool
}

func (s *statusCapturingWriter) WriteHeader(code int) {
	s.wrote = true
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusCapturingWriter) Write(p []byte) (int, error) {
	s.wrote = true
	return s.ResponseWriter.Write(p)
}

func (s *statusCapturingWriter) Unwrap() http.ResponseWriter {
	return s.ResponseWriter
}

// LiftHTTPMiddleware adapts a standard func(http.Handler) http.Handler
// into a ConnectMiddleware so existing net/http middleware (chi,
// gorilla, otelhttp, prometheus, tollbooth, …) can run on the sip
// handshake boundary.
//
// Outcomes:
//   - Lifted middleware calls next: adapter invokes the sip
//     ConnectHandler chain and returns its result.
//   - Lifted middleware writes a response and does NOT call next:
//     adapter returns errResponseWritten so the framework stops
//     without writing again.
//
// Lifted middleware MUST NOT inspect the response after next returns —
// there is no response after upgrade. Must call next.ServeHTTP
// synchronously; goroutine dispatch is undefined.
func LiftHTTPMiddleware(mw func(http.Handler) http.Handler) ConnectMiddleware {
	return func(next ConnectHandler) ConnectHandler {
		return func(r *http.Request) error {
			b, ok := r.Context().Value(liftCtxKey{}).(*liftBridge)
			if !ok {
				return next(r)
			}
			scw := &statusCapturingWriter{ResponseWriter: b.w}
			var called bool
			var nextErr error
			handler := mw(http.HandlerFunc(func(_ http.ResponseWriter, r2 *http.Request) {
				called = true
				nextErr = next(r2)
			}))
			handler.ServeHTTP(scw, r)
			if called {
				return nextErr
			}
			if scw.wrote {
				return errResponseWritten
			}
			return &ConnectError{Status: http.StatusInternalServerError}
		}
	}
}

// runLiftedChain runs the connect chain with the per-request lift
// bridge installed in context.
func runLiftedChain(w http.ResponseWriter, r *http.Request, mws []ConnectMiddleware, terminal ConnectHandler) error {
	bridge := &liftBridge{w: w}
	r = r.WithContext(context.WithValue(r.Context(), liftCtxKey{}, bridge))
	chain := terminal
	for i := len(mws) - 1; i >= 0; i-- {
		chain = mws[i](chain)
	}
	return chain(r)
}
