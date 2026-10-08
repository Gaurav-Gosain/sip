//go:build linux

package sip

import (
	"context"
	"testing"
	"time"
)

// TestWTNoStopSendingAtEnd: when the program exits, the server must not
// send STOP_SENDING on the stream. Firefox errors the whole bidirectional
// stream when STOP_SENDING arrives and drops MsgClose that was already
// sent. quic-go does not, so this checks for the frame itself: a client
// write after the end fails only if the server stopped its receive side.
func TestWTNoStopSendingAtEnd(t *testing.T) {
	srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{name: "sh", args: []string{"-c", "printf " + finalMarker}})
	srv.connectMW = []ConnectMiddleware{connLimitMiddleware(srv)}
	h := startWT(t, srv)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	c := h.dial(t, ctx)
	if _, saw, eof, err := c.readAll(-1); !saw || !eof {
		t.Fatalf("bad end: MsgClose=%v EOF=%v err=%v", saw, eof, err)
	}
	time.Sleep(300 * time.Millisecond)
	if err := writeFramed(c.stream, []byte{MsgPing}); err != nil {
		t.Fatalf("the server sent STOP_SENDING at the end of the session: %v", err)
	}
	_ = c.sess.CloseWithError(0, "")
}
