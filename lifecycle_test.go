//go:build !windows

package sip

import (
	"context"
	"sync"
	"testing"
	"time"
)

// TestSessionTeardownUnblocksBlockingRead reproduces a client
// disconnect while the output goroutine is blocked in a PTY read. It
// mirrors the handler's teardown structure (watchdog + blocking read +
// ctx cancel). Before the watchdog fix this deadlocked: the read never
// observed ctx cancellation and wg.Wait never returned.
func TestSessionTeardownUnblocksBlockingRead(t *testing.T) {
	srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{name: "sleep", args: []string{"30"}})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rawSess, info, closeFunc, err := srv.makeSession(ctx, 80, 24, 0, 0)
	if err != nil {
		t.Fatalf("makeSession: %v", err)
	}

	// Watchdog, exactly as installed by the handlers: the sole teardown
	// trigger, fired by ctx cancellation.
	go func() {
		<-ctx.Done()
		closeFunc()
	}()

	readDone := make(chan struct{})
	go func() {
		buf := make([]byte, 64)
		// sleep produces no output, so this blocks until teardown closes
		// the PTY.
		_, _ = rawSess.OutputReader().Read(buf)
		close(readDone)
	}()

	// Let the read block, then simulate a client disconnect.
	time.Sleep(100 * time.Millisecond)
	cancel()

	select {
	case <-readDone:
	case <-time.After(3 * time.Second):
		t.Fatal("teardown deadlocked: blocking PTY read never unblocked")
	}

	// The watchdog's teardown removes the session from the map; it runs
	// concurrently with the read unblocking, so poll for the effect.
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, ok := srv.sessions.Load(info.id); !ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("session leaked in sessions map after teardown")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// TestShortLivedCommandCleanup asserts a command that exits on its own
// signals the session Done and leaves nothing behind after teardown.
func TestShortLivedCommandCleanup(t *testing.T) {
	srv := newCmdHTTPServer(DefaultConfig(), &CommandHandler{name: "true"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rawSess, info, closeFunc, err := srv.makeSession(ctx, 80, 24, 0, 0)
	if err != nil {
		t.Fatalf("makeSession: %v", err)
	}

	// The reaper must observe the child exit and cancel the session ctx.
	select {
	case <-rawSess.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("child exit did not signal session Done (frozen client)")
	}

	closeFunc()
	if _, ok := srv.sessions.Load(info.id); ok {
		t.Error("session leaked in sessions map after cleanup")
	}
	cs := rawSess.(*cmdSession)
	if cs.platform.cmd.ProcessState == nil {
		t.Error("child process was not reaped")
	}
}

// TestCmdPlatformConcurrentWaitClose exercises the reaper's Wait racing
// the teardown's Close. Under -race this catches any double
// exec.Cmd.Wait; both must funnel through the single waitOnce owner.
func TestCmdPlatformConcurrentWaitClose(t *testing.T) {
	p, err := newCmdPlatformPty("sleep", []string{"1"}, "", 80, 24)
	if err != nil {
		t.Fatalf("newCmdPlatformPty: %v", err)
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _ = p.Wait() }()
	go func() { defer wg.Done(); _ = p.Close() }()

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Wait/Close deadlocked")
	}
}
