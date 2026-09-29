//go:build !windows

package sip

import (
	"context"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
)

// idleModel renders one line and waits for input.
type idleModel struct{ ready chan struct{} }

func (m idleModel) Init() tea.Cmd {
	close(m.ready)
	return nil
}

func (m idleModel) Update(tea.Msg) (tea.Model, tea.Cmd) { return m, nil }

func (idleModel) View() tea.View { return tea.NewView("idle") }

// TestCloseStopsTheInputReaderBeforeThePty opens a session with bubbletea's
// input reader on the PTY slave and closes it at once. The reader calls Fd on
// the slave while it waits, so closing the PTY before the reader has stopped
// is a data race that -race reports.
func TestCloseStopsTheInputReaderBeforeThePty(t *testing.T) {
	for range 5 {
		ready := make(chan struct{})
		handler := func(sess Session) *tea.Program {
			return tea.NewProgram(idleModel{ready: ready},
				append(MakeOptions(sess), tea.WithoutSignalHandler())...)
		}
		srv := newHTTPServer(DefaultConfig(), handler)

		sess, err := srv.createSession(context.Background(), handler, 80, 24, 0, 0)
		if err != nil {
			t.Fatalf("createSession: %v", err)
		}
		select {
		case <-ready:
		case <-time.After(5 * time.Second):
			t.Fatal("the program did not start")
		}
		srv.closeSession(sess)

		select {
		case <-sess.programDone:
		case <-time.After(5 * time.Second):
			t.Fatal("the program did not stop after the session closed")
		}
	}
}
