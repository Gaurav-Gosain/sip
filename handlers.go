package sip

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/quic-go/webtransport-go"
)

// Message types for WebSocket/WebTransport communication.
const (
	MsgInput    = '0' // Terminal input (client → server)
	MsgOutput   = '1' // Terminal output (server → client)
	MsgResize   = '2' // Resize terminal
	MsgPing     = '3' // Ping
	MsgPong     = '4' // Pong
	MsgTitle    = '5' // Set window title
	MsgOptions  = '6' // Configuration options
	MsgClose    = '7' // Session closed (server → client)
	MsgKittyKbd = '8' // Kitty keyboard protocol flags
)

// MaxMessageSize is the maximum allowed message size (1 MiB).
const MaxMessageSize = 1 << 20

const (
	readBufSize  = 16 * 1024
	writeBufSize = 16*1024 + 5
)

var (
	readBufPool = sync.Pool{
		New: func() any {
			b := make([]byte, readBufSize)
			return &b
		},
	}
	writeBufPool = sync.Pool{
		New: func() any {
			b := make([]byte, writeBufSize)
			return &b
		},
	}
	smallBufPool = sync.Pool{
		New: func() any {
			b := make([]byte, 256)
			return &b
		},
	}
)

// ResizeMessage is sent when the terminal should be resized.
//
// WidthPx and HeightPx are optional canvas dimensions in pixels. When
// non-zero the server populates the PTY's TIOCSWINSZ ws_xpixel/ws_ypixel
// fields, which kitty graphics tools (e.g. kitten icat) read to size images.
type ResizeMessage struct {
	Cols     int `json:"cols"`
	Rows     int `json:"rows"`
	WidthPx  int `json:"widthPx,omitempty"`
	HeightPx int `json:"heightPx,omitempty"`
}

// OptionsMessage is sent to configure the terminal.
type OptionsMessage struct {
	ReadOnly bool `json:"readOnly"`
}

// internalSession is the interface that both webSession and cmdSession
// implement. It's a superset of SessionIO so the SessionMiddleware
// chain wraps cleanly.
type internalSession interface {
	SessionIO
}

// sessionInfo holds common session metadata for logging.
type sessionInfo struct {
	id   string
	cols int
	rows int
}

func (s *httpServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	logger.Info("WebSocket connection attempt",
		"remote", r.RemoteAddr,
		"user_agent", r.UserAgent(),
	)

	r = r.WithContext(WithRemoteAddr(withConfig(r.Context(), s.config), r.RemoteAddr))

	// Run the layer-1 ConnectMiddleware chain. Acquires the connection
	// slot via connLimitMiddleware on success.
	var capturedR *http.Request
	terminal := func(rr *http.Request) error {
		capturedR = rr
		return nil
	}
	if err := runLiftedChain(w, r, s.connectMW, terminal); err != nil {
		if !errors.Is(err, errResponseWritten) {
			writeConnectError(w, err)
		}
		return
	}
	if capturedR == nil {
		writeConnectError(w, &ConnectError{Status: http.StatusInternalServerError})
		return
	}
	r = capturedR
	defer s.releaseConnection()

	opts := &websocket.AcceptOptions{
		OriginPatterns: s.originPatterns(),
	}

	conn, err := websocket.Accept(w, r, opts)
	if err != nil {
		logger.Error("WebSocket accept failed", "err", err, "remote", r.RemoteAddr)
		return
	}
	conn.SetReadLimit(MaxMessageSize)
	defer func() { _ = conn.CloseNow() }()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	cols, rows := 80, 24
	pxW, pxH := 0, 0
	readCtx, readCancel := context.WithTimeout(ctx, initialResizeTimeoutOrDefault(s.config.InitialResizeTimeout))
	_, data, err := conn.Read(readCtx)
	readCancel()

	if err == nil && len(data) > 0 && data[0] == MsgResize {
		var resize ResizeMessage
		if err := json.Unmarshal(data[1:], &resize); err == nil {
			cols = resize.Cols
			rows = resize.Rows
			pxW = resize.WidthPx
			pxH = resize.HeightPx
			logger.Debug("got initial size from browser", "cols", cols, "rows", rows, "px", []int{pxW, pxH})
		}
	}
	maxDims := windowDimsOrDefault(s.config.MaxWindowDims)
	if cols > maxDims.Width || rows > maxDims.Height {
		logger.Warn("initial resize exceeds MaxWindowDims",
			"cols", cols, "rows", rows, "max", []int{maxDims.Width, maxDims.Height})
		_ = conn.Close(websocket.StatusPolicyViolation, "window too large")
		return
	}

	startTime := time.Now()

	rawSess, info, closeFunc, err := s.makeSession(ctx, cols, rows, pxW, pxH)
	if err != nil {
		logger.Error("session creation failed", "err", err, "remote", r.RemoteAddr)
		_ = conn.Close(websocket.StatusInternalError, err.Error())
		return
	}
	wrapped := applySessionMiddleware(rawSess, s.config.SessionMiddleware)
	defer func() {
		closeFunc()
		logger.Info("WebSocket session ended",
			"session", info.id,
			"remote", r.RemoteAddr,
			"duration", time.Since(startTime).Round(time.Second),
		)
	}()

	logger.Info("WebSocket session started",
		"session", info.id,
		"remote", r.RemoteAddr,
		"cols", info.cols,
		"rows", info.rows,
	)

	optionsData, _ := json.Marshal(OptionsMessage{ReadOnly: s.config.ReadOnly})
	_ = conn.Write(ctx, websocket.MessageBinary, append([]byte{MsgOptions}, optionsData...))

	apply, stopThrottle := newResizeApplier(rawSess, resizeThrottleOrDefault(s.config.ResizeThrottle))
	defer stopThrottle()

	// Watchdog: when the context is cancelled — client disconnect, child
	// exit (cmd reaper), or handler return — close the session so its PTY
	// closes and the output goroutine's blocking Read unblocks. Without
	// this, teardown deadlocks on wg.Wait() (the read never observes ctx
	// cancellation) and leaks the PTY, child, goroutines, and the
	// connection slot.
	go func() {
		<-ctx.Done()
		closeFunc()
	}()

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		defer cancel()
		s.streamOutputToWebSocket(ctx, conn, wrapped, info)
	}()

	go func() {
		defer wg.Done()
		defer cancel()
		s.handleWebSocketInput(ctx, conn, wrapped, info, apply)
	}()

	wg.Wait()
}

func (s *httpServer) handleWebTransport(w http.ResponseWriter, r *http.Request) {
	logger.Info("WebTransport connection attempt",
		"remote", r.RemoteAddr,
		"protocol", r.Proto,
	)

	r = r.WithContext(WithRemoteAddr(withConfig(r.Context(), s.config), r.RemoteAddr))

	var capturedR *http.Request
	terminal := func(rr *http.Request) error {
		capturedR = rr
		return nil
	}
	if err := runLiftedChain(w, r, s.connectMW, terminal); err != nil {
		if !errors.Is(err, errResponseWritten) {
			writeConnectError(w, err)
		}
		return
	}
	if capturedR == nil {
		writeConnectError(w, &ConnectError{Status: http.StatusInternalServerError})
		return
	}
	r = capturedR
	defer s.releaseConnection()

	wtSession, err := s.wtServer.Upgrade(w, r)
	if err != nil {
		logger.Error("WebTransport upgrade failed", "err", err, "remote", r.RemoteAddr)
		return
	}
	defer func() { _ = wtSession.CloseWithError(0, "session closed") }()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	stream, err := wtSession.AcceptStream(ctx)
	if err != nil {
		logger.Error("stream accept failed", "err", err)
		return
	}
	defer func() { _ = stream.Close() }()

	cols, rows := 80, 24
	pxW, pxH := 0, 0
	_ = stream.SetReadDeadline(time.Now().Add(initialResizeTimeoutOrDefault(s.config.InitialResizeTimeout)))
	lenBuf := make([]byte, 4)
	if _, err := io.ReadFull(stream, lenBuf); err == nil {
		length := binary.BigEndian.Uint32(lenBuf)
		if length > 0 && length < 1024 {
			data := make([]byte, length)
			if _, err := io.ReadFull(stream, data); err == nil && len(data) > 0 && data[0] == MsgResize {
				var resize ResizeMessage
				if err := json.Unmarshal(data[1:], &resize); err == nil {
					cols = resize.Cols
					rows = resize.Rows
					pxW = resize.WidthPx
					pxH = resize.HeightPx
					logger.Debug("got initial size from browser (WT)", "cols", cols, "rows", rows, "px", []int{pxW, pxH})
				}
			}
		}
	}
	_ = stream.SetReadDeadline(time.Time{})

	maxDims := windowDimsOrDefault(s.config.MaxWindowDims)
	if cols > maxDims.Width || rows > maxDims.Height {
		logger.Warn("initial resize exceeds MaxWindowDims (WT)",
			"cols", cols, "rows", rows, "max", []int{maxDims.Width, maxDims.Height})
		return
	}

	startTime := time.Now()

	rawSess, info, closeFunc, err := s.makeSession(ctx, cols, rows, pxW, pxH)
	if err != nil {
		logger.Error("session creation failed", "err", err, "remote", r.RemoteAddr)
		return
	}
	wrapped := applySessionMiddleware(rawSess, s.config.SessionMiddleware)
	defer func() {
		closeFunc()
		logger.Info("WebTransport session ended",
			"session", info.id,
			"remote", r.RemoteAddr,
			"duration", time.Since(startTime).Round(time.Second),
		)
	}()

	logger.Info("WebTransport session started",
		"session", info.id,
		"remote", r.RemoteAddr,
		"cols", info.cols,
		"rows", info.rows,
	)

	optionsData, _ := json.Marshal(OptionsMessage{ReadOnly: s.config.ReadOnly})
	_ = writeFramed(stream, append([]byte{MsgOptions}, optionsData...))

	apply, stopThrottle := newResizeApplier(rawSess, resizeThrottleOrDefault(s.config.ResizeThrottle))
	defer stopThrottle()

	// Watchdog: see handleWebSocket. Closing the session on ctx.Done
	// unblocks the output goroutine's PTY Read so teardown can't deadlock.
	go func() {
		<-ctx.Done()
		closeFunc()
	}()

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		defer cancel()
		s.streamOutputToWebTransport(ctx, stream, wrapped, info)
	}()

	go func() {
		defer wg.Done()
		defer cancel()
		s.handleWebTransportInput(ctx, stream, wrapped, info, apply)
	}()

	wg.Wait()
	<-wtSession.Context().Done()
}

// makeSession dispatches to the cmd or bubbletea path depending on
// what's configured. Returns the raw session (pre-SessionMiddleware), a
// log-friendly info struct, and a teardown function.
func (s *httpServer) makeSession(ctx context.Context, cols, rows, widthPx, heightPx int) (internalSession, sessionInfo, func(), error) {
	if s.cmdHandler != nil {
		cmdSess, err := s.createCmdSession(ctx, cols, rows, widthPx, heightPx)
		if err != nil {
			return nil, sessionInfo{}, nil, err
		}
		return cmdSess, sessionInfo{id: cmdSess.id, cols: cmdSess.cols, rows: cmdSess.rows},
			func() { s.closeCmdSession(cmdSess) }, nil
	}
	webSess, err := s.createSession(ctx, s.handler, cols, rows, widthPx, heightPx)
	if err != nil {
		return nil, sessionInfo{}, nil, err
	}
	return webSess, sessionInfo{id: webSess.id, cols: webSess.cols, rows: webSess.rows},
		func() { s.closeSession(webSess) }, nil
}

func (s *httpServer) outputFilter() func([]byte) []byte {
	if !s.config.EnableKittyTranscoder {
		return func(b []byte) []byte { return b }
	}
	tr := &kittyGfxTranscoder{}
	return tr.Filter
}

func (s *httpServer) streamOutputToWebSocket(ctx context.Context, conn *websocket.Conn, session internalSession, info sessionInfo) {
	bufPtr := readBufPool.Get().(*[]byte)
	buf := *bufPtr
	defer readBufPool.Put(bufPtr)

	filter := s.outputFilter()
	writeTimeout := writeTimeoutOrDefault(s.config.WriteTimeout)
	var totalBytes int64

	// wsWrite bounds a single write so a stalled-but-alive client (stopped
	// reading, send buffer full) can't pin this goroutine and its
	// connection slot forever.
	wsWrite := func(msg []byte) error {
		if writeTimeout <= 0 {
			return conn.Write(ctx, websocket.MessageBinary, msg)
		}
		wctx, cancel := context.WithTimeout(ctx, writeTimeout)
		defer cancel()
		return conn.Write(wctx, websocket.MessageBinary, msg)
	}

	for {
		select {
		case <-ctx.Done():
			logger.Debug("WebSocket output stopped (context)", "session", info.id, "bytes_sent", totalBytes)
			return
		case <-session.Done():
			logger.Debug("session ended, sending close", "session", info.id)
			_ = wsWrite([]byte{MsgClose})
			return
		default:
		}

		n, err := session.OutputReader().Read(buf)
		if err != nil {
			logger.Debug("output closed", "session", info.id, "bytes_sent", totalBytes, "error", err)
			_ = wsWrite([]byte{MsgClose})
			return
		}
		if n == 0 {
			continue
		}

		if totalBytes == 0 {
			logger.Debug("first output received", "session", info.id, "bytes", n)
		}
		totalBytes += int64(n)

		filtered := filter(buf[:n])
		// Filter may return an empty slice (transcoder mid-APC) — in that
		// case there's nothing to send for this read.
		for len(filtered) > 0 {
			chunk := filtered
			if len(chunk) > readBufSize {
				chunk = chunk[:readBufSize]
			}
			msg := make([]byte, len(chunk)+1)
			msg[0] = MsgOutput
			copy(msg[1:], chunk)
			if err := wsWrite(msg); err != nil {
				logger.Debug("WebSocket write error", "session", info.id, "err", err)
				return
			}
			filtered = filtered[len(chunk):]
		}
	}
}

func (s *httpServer) streamOutputToWebTransport(ctx context.Context, stream *webtransport.Stream, session internalSession, info sessionInfo) {
	bufPtr := readBufPool.Get().(*[]byte)
	buf := *bufPtr
	defer readBufPool.Put(bufPtr)

	filter := s.outputFilter()
	writeTimeout := writeTimeoutOrDefault(s.config.WriteTimeout)
	var totalBytes int64

	// setDeadline bounds a single stream write so a stalled client can't
	// pin this goroutine and its connection slot forever.
	setDeadline := func() {
		if writeTimeout > 0 {
			_ = stream.SetWriteDeadline(time.Now().Add(writeTimeout))
		}
	}

	for {
		select {
		case <-ctx.Done():
			logger.Debug("WebTransport output stopped (context)", "session", info.id, "bytes_sent", totalBytes)
			return
		case <-session.Done():
			logger.Debug("session ended, sending close", "session", info.id)
			setDeadline()
			_ = writeFramed(stream, []byte{MsgClose})
			return
		default:
		}

		n, err := session.OutputReader().Read(buf)
		if err != nil {
			logger.Debug("output closed", "session", info.id, "bytes_sent", totalBytes, "error", err)
			setDeadline()
			_ = writeFramed(stream, []byte{MsgClose})
			return
		}
		if n == 0 {
			continue
		}

		if totalBytes == 0 {
			debugBytes := n
			if debugBytes > 100 {
				debugBytes = 100
			}
			logger.Debug("first output received (WT)", "session", info.id, "bytes", n, "first_bytes", fmt.Sprintf("%q", string(buf[:debugBytes])))
		}
		totalBytes += int64(n)

		filtered := filter(buf[:n])
		for len(filtered) > 0 {
			chunk := filtered
			if len(chunk) > readBufSize {
				chunk = chunk[:readBufSize]
			}
			msgLen := len(chunk) + 1
			frame := make([]byte, 4+msgLen)
			binary.BigEndian.PutUint32(frame[0:4], uint32(msgLen))
			frame[4] = MsgOutput
			copy(frame[5:], chunk)
			setDeadline()
			if _, err := stream.Write(frame); err != nil {
				logger.Debug("WebTransport write error", "session", info.id, "err", err)
				return
			}
			filtered = filtered[len(chunk):]
		}
	}
}

func (s *httpServer) handleWebSocketInput(ctx context.Context, conn *websocket.Conn, session internalSession, info sessionInfo, apply func(WindowSize)) {
	var totalBytes int64
	var msgCount int64

	for {
		select {
		case <-ctx.Done():
			logger.Debug("WebSocket input stopped", "session", info.id, "messages", msgCount, "bytes", totalBytes)
			return
		case <-session.Done():
			return
		default:
		}

		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}

		totalBytes += int64(len(data))
		msgCount++
		if !s.processInput(data, session, info, apply) {
			_ = conn.CloseNow()
			return
		}
	}
}

func (s *httpServer) handleWebTransportInput(ctx context.Context, stream *webtransport.Stream, session internalSession, info sessionInfo, apply func(WindowSize)) {
	lenBuf := make([]byte, 4)
	var totalBytes int64
	var msgCount int64

	for {
		select {
		case <-ctx.Done():
			logger.Debug("WebTransport input stopped", "session", info.id, "messages", msgCount, "bytes", totalBytes)
			return
		case <-session.Done():
			return
		default:
		}

		if _, err := io.ReadFull(stream, lenBuf); err != nil {
			return
		}

		length := binary.BigEndian.Uint32(lenBuf)
		if length > MaxMessageSize {
			logger.Warn("message too large", "session", info.id, "size", length)
			return
		}

		var msg []byte
		var pooled *[]byte
		if length <= 256 {
			pooled = smallBufPool.Get().(*[]byte)
			msg = (*pooled)[:length]
		} else {
			msg = make([]byte, length)
		}

		if _, err := io.ReadFull(stream, msg); err != nil {
			if pooled != nil {
				smallBufPool.Put(pooled)
			}
			return
		}

		totalBytes += int64(length)
		msgCount++
		// processInput consumes msg synchronously (all branches Write or
		// copy immediately), so the pooled buffer is free to reuse now —
		// return it per iteration rather than deferring for the whole
		// connection, which would pin one buffer per inbound message.
		ok := s.processInput(msg, session, info, apply)
		if pooled != nil {
			smallBufPool.Put(pooled)
		}
		if !ok {
			stream.CancelRead(0)
			_ = stream.Close()
			return
		}
	}
}

// processInput dispatches one inbound message. Returns false if the
// caller should drop the connection. An oversized paste is dropped as a
// single message rather than tearing down the session.
func (s *httpServer) processInput(data []byte, session internalSession, info sessionInfo, apply func(WindowSize)) bool {
	if len(data) == 0 {
		return true
	}

	msgType := data[0]
	payload := data[1:]

	switch msgType {
	case MsgInput:
		if s.config.ReadOnly {
			return true
		}
		if len(payload) > pasteMaxOrDefault(s.config.MaxPasteBytes) {
			logger.Warn("input exceeds MaxPasteBytes; dropping message",
				"session", info.id, "size", len(payload), "max", pasteMaxOrDefault(s.config.MaxPasteBytes))
			return true
		}
		if _, err := session.InputWriter().Write(payload); err != nil {
			logger.Debug("session input write error", "session", info.id, "err", err)
		}

	case MsgResize:
		var resize ResizeMessage
		if err := json.Unmarshal(payload, &resize); err != nil {
			logger.Warn("invalid resize message", "session", info.id, "err", err)
			return true
		}
		if resize.Cols <= 0 || resize.Rows <= 0 {
			return true
		}
		maxDims := windowDimsOrDefault(s.config.MaxWindowDims)
		if resize.Cols > maxDims.Width || resize.Rows > maxDims.Height {
			logger.Debug("resize exceeds MaxWindowDims; ignoring",
				"session", info.id, "got", []int{resize.Cols, resize.Rows},
				"max", []int{maxDims.Width, maxDims.Height})
			return true
		}
		apply(WindowSize{
			Width: resize.Cols, Height: resize.Rows,
			WidthPx: resize.WidthPx, HeightPx: resize.HeightPx,
		})
		logger.Debug("terminal resize queued",
			"session", info.id, "to", []int{resize.Cols, resize.Rows},
			"px", []int{resize.WidthPx, resize.HeightPx},
		)

	case MsgPing:
		// Pong handled at transport layer.

	case MsgKittyKbd:
		if s.config.Debug {
			logger.Debug("kitty keyboard flags", "session", info.id, "payload", string(payload))
		}

	default:
		if s.config.Debug {
			logger.Debug("unknown message type",
				"session", info.id,
				"type", fmt.Sprintf("0x%02x", msgType),
				"size", len(payload),
			)
		}
	}
	return true
}

func writeFramed(w io.Writer, msg []byte) error {
	frame := make([]byte, 4+len(msg))
	binary.BigEndian.PutUint32(frame[0:4], uint32(len(msg)))
	copy(frame[4:], msg)
	_, err := w.Write(frame)
	return err
}

func (s *httpServer) tryAcquireConnection() bool {
	if s.config.MaxConnections <= 0 {
		atomic.AddInt32(&s.connCount, 1)
		return true
	}
	for {
		current := atomic.LoadInt32(&s.connCount)
		if int(current) >= s.config.MaxConnections {
			return false
		}
		if atomic.CompareAndSwapInt32(&s.connCount, current, current+1) {
			return true
		}
	}
}

func (s *httpServer) releaseConnection() {
	atomic.AddInt32(&s.connCount, -1)
}

// originPatterns merges legacy AllowOrigins + new OriginPatterns. An
// empty merged slice means "same-origin only": coder/websocket enforces
// that the Origin host matches the request Host, and checkOrigin does the
// same for WebTransport. Any-origin access requires an explicit "*" entry.
func (s *httpServer) originPatterns() []string {
	merged := append([]string{}, s.config.AllowOrigins...)
	merged = append(merged, s.config.OriginPatterns...)
	return merged
}

// checkOrigin enforces same-origin by default for the WebTransport
// handshake, mirroring the coder/websocket policy applied to WS upgrades.
// Requests without an Origin header (non-browser clients) pass. Otherwise
// the Origin must be this server's own origin (either the WebTransport
// endpoint itself or the HTTP listener that served the page) or match an
// entry in the merged allowlist (path.Match glob); an explicit "*" opts
// into any origin.
func (s *httpServer) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	// The WebTransport origin itself.
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}
	// The HTTP origin that served the page. The HTTP and WebTransport
	// listeners deliberately sit on different ports, so a page loaded from
	// http://host:7681 sends that Origin to the WT endpoint on host:7682.
	// A strict host comparison never matches and would leave WebTransport
	// permanently unreachable under the default policy.
	if s.isOwnHTTPOrigin(u, r.Host) {
		return true
	}
	for _, pattern := range s.originPatterns() {
		if matched, err := path.Match(strings.ToLower(pattern), strings.ToLower(u.Host)); err == nil && matched {
			return true
		}
	}
	logger.Warn("WebTransport origin rejected; client will fall back to WebSocket",
		"origin", origin,
		"request_host", r.Host,
		"http_port", s.config.Port,
		"allowlist", s.originPatterns(),
		"hint", "add the origin to OriginPatterns, or \"*\" to allow any origin",
	)
	return false
}

// isOwnHTTPOrigin reports whether u is this server's HTTP origin: the same
// hostname the WebTransport request was addressed to, on the HTTP port.
// Both the hostname and the port must match, so a genuinely foreign origin
// is still rejected.
func (s *httpServer) isOwnHTTPOrigin(u *url.URL, reqHost string) bool {
	originHost, originPort := splitOriginHostPort(u.Host, u.Scheme)
	wtHost, _ := splitOriginHostPort(reqHost, "")
	if originHost == "" || wtHost == "" || originHost != wtHost {
		return false
	}
	httpPort := s.config.Port
	if httpPort == "" {
		httpPort = "7681"
	}
	return originPort != "" && originPort == httpPort
}

// splitOriginHostPort lowercases hostport and splits it, falling back to
// the scheme's default port when hostport carries no explicit port.
func splitOriginHostPort(hostport, scheme string) (host, port string) {
	host = hostport
	if h, p, err := net.SplitHostPort(hostport); err == nil {
		host, port = h, p
	} else {
		switch strings.ToLower(scheme) {
		case "http":
			port = "80"
		case "https":
			port = "443"
		}
	}
	return strings.ToLower(host), port
}
