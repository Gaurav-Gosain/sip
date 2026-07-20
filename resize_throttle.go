package sip

import (
	"sync"
	"time"
)

// newResizeApplier returns an apply function that coalesces rapid resize
// values and a stop function that releases the timer. apply is safe to call
// from multiple goroutines; values overwrite any pending value.
//
// This is a leading+trailing throttle: a resize that arrives when the
// session has been idle for at least `throttle` is forwarded to the PTY
// immediately, on the calling goroutine, before apply returns. Only a
// resize that arrives inside an active throttle window is deferred, and
// then only until the window closes, coalescing a burst (e.g. a mouse-drag
// resize) into its last value.
//
// The immediate leading edge matters beyond latency: a resize is commonly
// followed straight away by input on the same connection (a keystroke, or a
// script/TUI that reads the terminal size right after resizing it). Input is
// written to the PTY unthrottled, on the same read loop that hands resizes
// to apply. A purely trailing-edge throttle — queue the value, apply it on
// the next periodic tick — can let that input reach the PTY and be read by
// the child before the resize the client already sent has actually been
// ioctl'd onto the winsize, so the child observes stale dimensions. The
// leading edge closes that window for the common case of an isolated
// resize; only a rapid burst still incurs the deferred trailing apply.
func newResizeApplier(sess internalSession, throttle time.Duration) (apply func(WindowSize), stop func()) {
	var mu sync.Mutex
	var latest WindowSize
	var have bool
	var timer *time.Timer
	var lastApply time.Time
	var stopped bool

	doApply := func(ws WindowSize) {
		if wr, ok := sess.(WindowResizer); ok {
			wr.ResizeWindow(ws)
		} else {
			sess.Resize(ws.Width, ws.Height)
		}
	}

	// fire runs as the timer's callback (its own goroutine) once a
	// throttle window closes with a value still pending.
	fire := func() {
		mu.Lock()
		if stopped || !have {
			timer = nil
			mu.Unlock()
			return
		}
		ws := latest
		have = false
		lastApply = time.Now()
		timer = nil
		mu.Unlock()
		doApply(ws)
	}

	apply = func(ws WindowSize) {
		mu.Lock()
		if stopped {
			mu.Unlock()
			return
		}
		latest = ws
		have = true

		if time.Since(lastApply) >= throttle {
			// Idle for a full window: apply now, on the caller's
			// goroutine, so the PTY winsize is already updated by the
			// time apply returns.
			have = false
			lastApply = time.Now()
			mu.Unlock()
			doApply(ws)
			return
		}

		// Inside an active window: coalesce into the trailing apply
		// already scheduled, or schedule one for when the window closes.
		if timer == nil {
			timer = time.AfterFunc(throttle-time.Since(lastApply), fire)
		}
		mu.Unlock()
	}

	stop = func() {
		mu.Lock()
		stopped = true
		if timer != nil {
			timer.Stop()
			timer = nil
		}
		mu.Unlock()
	}

	return apply, stop
}
