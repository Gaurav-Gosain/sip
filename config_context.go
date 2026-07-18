package sip

import (
	"context"
	"time"
)

const (
	defaultMaxPasteBytes        = 1 << 20 // 1 MiB
	defaultResizeThrottle       = 16 * time.Millisecond
	defaultMaxWindowCols        = 4096
	defaultMaxWindowRows        = 4096
	defaultInitialResizeTimeout = 10 * time.Second
	defaultWriteTimeout         = 30 * time.Second
)

func pasteMaxOrDefault(v int) int {
	if v <= 0 {
		return defaultMaxPasteBytes
	}
	return v
}

func resizeThrottleOrDefault(v time.Duration) time.Duration {
	if v <= 0 {
		return defaultResizeThrottle
	}
	return v
}

func windowDimsOrDefault(v WindowSize) WindowSize {
	if v.Width <= 0 {
		v.Width = defaultMaxWindowCols
	}
	if v.Height <= 0 {
		v.Height = defaultMaxWindowRows
	}
	return v
}

func initialResizeTimeoutOrDefault(v time.Duration) time.Duration {
	if v <= 0 {
		return defaultInitialResizeTimeout
	}
	return v
}

// writeTimeoutOrDefault resolves the per-write output deadline. A zero
// value uses the default; a negative value disables the deadline (returns
// 0, which callers treat as "no deadline").
func writeTimeoutOrDefault(v time.Duration) time.Duration {
	if v < 0 {
		return 0
	}
	if v == 0 {
		return defaultWriteTimeout
	}
	return v
}

type configCtxKey struct{}

// withConfig returns a derived context carrying cfg.
func withConfig(ctx context.Context, cfg Config) context.Context {
	return context.WithValue(ctx, configCtxKey{}, cfg)
}

// ConfigFromContext returns a read-only copy of the Config attached to
// ctx, or the zero value if none.
func ConfigFromContext(ctx context.Context) Config {
	v, _ := ctx.Value(configCtxKey{}).(Config)
	return v
}
