package sip

import (
	"errors"
	"fmt"
	"net/http"
)

// ConnectError is returned by ConnectHandler implementations to control
// the rejection response. A plain error returned from a ConnectHandler
// is treated as &ConnectError{Status: http.StatusInternalServerError}.
type ConnectError struct {
	Status  int         // HTTP status code on WS path; mapped to QUIC code on WT path
	Headers http.Header // Headers to write on WS path before body (ignored on WT)
	Body    string      // Body to write on WS path (ignored on WT)
	WTCode  uint32      // Override the default WS-status → QUIC-code mapping
	Cause   error       // Optional underlying error
}

func (e *ConnectError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("connect rejected: status=%d: %v", e.Status, e.Cause)
	}
	return fmt.Sprintf("connect rejected: status=%d", e.Status)
}

func (e *ConnectError) Unwrap() error { return e.Cause }

// WTErrorCode returns the QUIC error code used when closing a
// WebTransport session in response to this ConnectError.
// Default mapping: 4xx → 0x01, 5xx → 0x02, anything else → 0x00.
func (e *ConnectError) WTErrorCode() uint32 {
	if e.WTCode != 0 {
		return e.WTCode
	}
	switch {
	case e.Status >= 400 && e.Status < 500:
		return 0x01
	case e.Status >= 500 && e.Status < 600:
		return 0x02
	default:
		return 0x00
	}
}

func writeConnectError(w http.ResponseWriter, err error) {
	var ce *ConnectError
	if !errors.As(err, &ce) {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	status := ce.Status
	if status < 100 || status > 599 {
		status = http.StatusInternalServerError
	}
	for k, vs := range ce.Headers {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	if ce.Body != "" {
		http.Error(w, ce.Body, status)
		return
	}
	w.WriteHeader(status)
}
