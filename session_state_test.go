//go:build !windows

package sip

import (
	"context"
	"sync"
	"testing"
	"time"
)

// TestWindowChangesKeepsTheNewestSize resizes twice with no reader. The
// reader then has to see the second size, which is the size the window has.
func TestWindowChangesKeepsTheNewestSize(t *testing.T) {
	first := WindowSize{Width: 80, Height: 24}
	second := WindowSize{Width: 132, Height: 43}

	sessions := map[string]interface {
		Resize(cols, rows int)
		WindowChanges() <-chan WindowSize
	}{
		"bubble tea": &webSession{windowChanges: make(chan WindowSize, 1)},
		"command":    &cmdSession{windowChanges: make(chan WindowSize, 1)},
	}
	for name, sess := range sessions {
		t.Run(name, func(t *testing.T) {
			sess.Resize(first.Width, first.Height)
			sess.Resize(second.Width, second.Height)
			select {
			case got := <-sess.WindowChanges():
				if got != second {
					t.Fatalf("WindowChanges gave %+v, want the newest size %+v", got, second)
				}
			default:
				t.Fatal("WindowChanges gave nothing")
			}
		})
	}
}

// TestSessionIDsAreUnique takes ids from several goroutines at once. Ids from
// the clock collide here: 66 to 293 of 8,000 were equal on an 8-core machine.
func TestSessionIDsAreUnique(t *testing.T) {
	const goroutines, each = 4, 2000
	ids := make([][]string, goroutines)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for g := range goroutines {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for range each {
				ids[g] = append(ids[g], newSessionID())
			}
		}()
	}
	close(start)
	wg.Wait()
	seen := map[string]bool{}
	for _, list := range ids {
		for _, id := range list {
			if seen[id] {
				t.Fatalf("two sessions got the id %s", id)
			}
			seen[id] = true
		}
	}
}

// TestShutdownClosesEverySession starts two sessions back to back and shuts
// down. Each one is in the session map under its own id, and each one ends.
func TestShutdownClosesEverySession(t *testing.T) {
	srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{name: "sleep", args: []string{"30"}})
	a, err := srv.createCmdSession(context.Background(), 80, 24, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	b, err := srv.createCmdSession(context.Background(), 80, 24, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if a.id == b.id {
		t.Fatalf("both sessions have the id %s", a.id)
	}

	srv.closeAllSessions()

	for _, s := range []*cmdSession{a, b} {
		select {
		case <-s.Done():
		case <-time.After(5 * time.Second):
			t.Fatalf("session %s is still running after shutdown", s.id)
		}
		if _, ok := srv.sessions.Load(s.id); ok {
			t.Fatalf("session %s is still in the session map after shutdown", s.id)
		}
	}
}
