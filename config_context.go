package sip

import (
	"context"
	"time"
)

const (
	defaultMaxPasteBytes        = 1 << 20 // 1 MiB
	defaultResizeThrottle       = 16 * time.Millisecond
	defaultMaxWindowCols        = 2048
	defaultMaxWindowRows        = 1024
	defaultMaxWindowCells       = 250_000
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

func windowCellsOrDefault(v int) int {
	if v <= 0 {
		return defaultMaxWindowCells
	}
	return v
}

// clampWindow fits a requested size under the configured caps. Each
// dimension is cut to MaxWindowDims first. When columns times rows is still
// over MaxWindowCells, the columns stay and the rows shrink, because a
// terminal that is too narrow breaks more programs than one that is too
// short. The pixel size shrinks in step, so the cell size stays the same.
// It reports whether it changed the size.
func clampWindow(cfg Config, cols, rows, widthPx, heightPx int) (WindowSize, bool) {
	dims := windowDimsOrDefault(cfg.MaxWindowDims)
	maxCells := windowCellsOrDefault(cfg.MaxWindowCells)
	c, r := min(cols, dims.Width), min(rows, dims.Height)
	if c > 0 && r > 0 && c*r > maxCells {
		c = min(c, maxCells)
		r = max(1, maxCells/c)
	}
	if c == cols && r == rows {
		return WindowSize{Width: cols, Height: rows, WidthPx: widthPx, HeightPx: heightPx}, false
	}
	if cols > 0 {
		widthPx = widthPx * c / cols
	}
	if rows > 0 {
		heightPx = heightPx * r / rows
	}
	return WindowSize{Width: c, Height: r, WidthPx: widthPx, HeightPx: heightPx}, true
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
