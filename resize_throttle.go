package sip

import (
	"sync"
	"time"
)

// newResizeApplier returns an apply function that coalesces rapid
// resize values and a stop function that drains and shuts down the
// throttle goroutine. The applier is safe to call from multiple
// goroutines; values overwrite any pending value.
//
// The background goroutine wakes up at most once per throttle interval
// and forwards the most recent value to sess.ResizeWindow when the
// session implements WindowResizer (pixel-aware), else sess.Resize.
// stop is safe to call multiple times.
func newResizeApplier(sess internalSession, throttle time.Duration) (apply func(WindowSize), stop func()) {
	pending := make(chan WindowSize, 1)
	done := make(chan struct{})
	var stopOnce sync.Once

	apply = func(ws WindowSize) {
		select {
		case <-pending:
		default:
		}
		select {
		case pending <- ws:
		default:
		}
	}

	stop = func() {
		stopOnce.Do(func() { close(done) })
	}

	go func() {
		ticker := time.NewTicker(throttle)
		defer ticker.Stop()
		var latest WindowSize
		var have bool
		for {
			select {
			case <-done:
				return
			case ws := <-pending:
				latest = ws
				have = true
			case <-ticker.C:
				if !have {
					continue
				}
				if wr, ok := sess.(WindowResizer); ok {
					wr.ResizeWindow(latest)
				} else {
					sess.Resize(latest.Width, latest.Height)
				}
				have = false
			}
		}
	}()

	return apply, stop
}
