# AGENTS.md - Sip

> Sip is a Go library for serving Bubble Tea TUI applications through web browsers, rendered with libghostty (ghostty-web wasm) for high-fidelity terminal emulation.

## Quick Reference

```bash
# Build library and CLI
go build ./...

# Client-side tests
node --test 'clienttests/*.test.mjs'         # fast, no browser
(cd clienttests && npm install && npx playwright test)  # drives a real server

# Run example (Bubble Tea mode)
go run ./examples/simple

# Run CLI (command mode)
go run ./cmd/sip -- htop
go run ./cmd/sip -p 8080 -- claude -c
go run ./cmd/sip --host 0.0.0.0 --cert s.crt --key s.key -- bash

# WASM build (compile a Bubble Tea app to run in-browser)
go run ./cmd/sip-wasm-build -o web/app.wasm ./cmd/myapp/

# Then open http://localhost:7681 in browser
```

## CLI Usage

Built with Cobra + Fang. Supports shell completion generation.

```
sip [flags] -- command [args...]

Listener / TLS:
  -H, --host string           Host to bind (default "localhost")
  -p, --port string           Port to listen (default "7681")
      --cert string           TLS cert (PEM)
      --key string            TLS key  (PEM)
      --allow-insecure-no-tls Allow non-loopback bind / basic auth without TLS
      --origin strings        Browser origin allowlist (path.Match glob, repeatable)

Auth:
      --basic-user string     HTTP Basic Auth username
      --basic-pass string     HTTP Basic Auth password (prefer file/env)
      --basic-pass-file string Read password from file
                              ($SIP_PASSWORD env also honoured;
                               precedence: file > env > flag)

Limits:
      --max-conns int         Concurrent session limit (0 = unlimited)
      --idle-timeout duration Close sessions idle for this long (0 = off)

Renderer / fonts:
      --renderer string       Client renderer: "webgl" for vtgl, empty for canvas 2D
      --font path             Custom font (.ttf/.otf/.woff/.woff2)
      --font-family string    CSS font-family (overrides default JBM Nerd Font)
      --disable-kitty-transcoder
                              Disable server-side kitty PNG → RGBA filter

Misc:
  -d, --dir string            Working directory for the wrapped command
      --debug                 Enable debug logging
  -v, --version               Print version
  -h, --help                  Show help

Commands:
  completion                  Generate shell completion scripts
```

Examples:
- `sip -- htop` — htop in browser
- `sip --host 0.0.0.0 --cert s.crt --key s.key -- bash` — public bind, TLS
- `sip --host 0.0.0.0 --allow-insecure-no-tls -- bash` — public bind, no TLS (insecure; trusted-proxy use only)
- `sip --basic-user admin --basic-pass-file /run/secrets/sip --cert s.crt --key s.key -- bash`
- `sip --font /path/to/CommitMono.ttf --font-family "Commit Mono" -- nvim`

## Project Structure

```
sip/
├── sip.go                  # Public API: Session, Pty, WindowSize, Handler, Config, Server, MakeOptions
├── server.go               # HTTP server bootstrap, TLS, mux, validateConfig, font templating
├── handlers.go             # Wire protocol (msg types '0'..'8'), WS+WT loops, kitty transcoder hookup
├── session.go              # webSession (Bubble Tea in-process)
├── session_unix.go         # Unix PTY (UnixPty master+slave, pixel-aware resize via SetWinsize)
├── session_windows.go      # Windows pipes (ConPty unsuitable for in-process)
├── cmd_session.go          # cmdSession (CLI mode, spawned external command in PTY)
├── cmd_unix.go / cmd_windows.go
├── middleware.go           # ConnectMiddleware / SessionMiddleware / Middleware framework + LiftHTTPMiddleware
├── connecterror.go         # ConnectError type for graceful handshake rejection
├── identity.go             # Identity + RemoteAddr context plumbing
├── config_context.go       # Defaults + ConfigFromContext helper
├── resize_throttle.go      # Coalescing inbound resize messages
├── kittygfx.go             # Server-side kitty graphics PNG/JPEG/GIF → RGBA transcoder
├── cert.go                 # Self-signed cert + cert wrapping for WebTransport
├── run_native.go / run_js.go  # Polymorphic NewBrowserProgram/RunBrowser (native or wasm)
├── wasm/wasm.go            # //go:build js && wasm — JS bridge (bubbletea_read/write/resize)
├── middleware/
│   ├── osc52gate/          # SessionMiddleware: allow/deny/audit OSC 52 clipboard writes
│   ├── recover/            # Middleware: recover from panics in Handler construction
│   └── logging/            # Middleware: slog session start/end logging
├── cmd/
│   ├── sip/                # CLI binary
│   └── sip-wasm-build/     # Wraps `GOOS=js GOARCH=wasm go build` with bubbletea v2 stubs
├── static/
│   ├── index.html          # Loads ES module terminal.js, includes {{FONT_FACE_EXTRA}} placeholder
│   ├── terminal.js         # ES module: wires SipTerminal + SipAutoAdapter, settings panel, mobile keyboard
│   ├── terminal.css        # JBM Nerd Font @font-face + Catppuccin Mocha + chrome
│   ├── ghostty-web/        # Vendored MIT (NimbleMarkets fork of coder/ghostty-web, nm-kitty-meow)
│   │   ├── ghostty-vt.wasm   (~611 KB)
│   │   └── ghostty-web.js    (~1.1 MB)
│   ├── vtgl/               # Vendored MIT glyph-atlas WebGL2 renderer (built artifact)
│   │   ├── vtgl.js           (~30 KB minified ESM)
│   │   └── README.md         # Provenance + how to refresh
│   ├── sip-client/         # ES modules adapted from go-booba's TS bundle (MIT, NimbleMarkets):
│   │   sip.js, adapter.js, websocket_adapter.js, webtransport_adapter.js,
│   │   auto_adapter.js, protocol.js, clipboard.js, urls.js, types.js,
│   │   vtgl_source.js, vtgl_bridge.js
│   └── fonts/              # JetBrains Mono Nerd Font (embedded)
└── examples/simple/        # Counter example (Bubble Tea mode)
```

## Architecture

### Two operating modes

1. **Library mode (Bubble Tea, in-process)**
   - `server.Serve()` / `server.ServeWithProgram()`
   - Handler creates a `tea.Model` per browser session
   - PTY provides terminal semantics for Bubble Tea (raw mode + window size events)

2. **CLI mode (spawned commands)**
   - `sip -- command [args...]`  →  `server.ServeCommand()`
   - xpty spawns the command attached to a PTY
   - Pure I/O forwarding between PTY and browser

3. **WASM mode (in-browser only, no server)**
   - `wasm.Run(model)` (or `sip.RunBrowser(model)` polymorphic)
   - Bubble Tea program compiled to wasm runs entirely in the browser
   - Frontend connects via `SipWasmAdapter` polling `bubbletea_read/write/resize` globals
   - Build with `go run ./cmd/sip-wasm-build -o web/app.wasm ./your/cmd/`

### Communication flow

1. Browser loads `static/index.html` → `static/terminal.js` (ES module)
2. `SipTerminal` (wrapper around ghostty-web's `Terminal` + `FitAddon`) initializes the libghostty wasm
3. `SipAutoAdapter` tries WebTransport (HTTP/3 over QUIC) → falls back to WebSocket
4. Server creates a PTY for the session, spawns either Bubble Tea or the wrapped command
5. PTY output is filtered through the kitty graphics transcoder before being framed and sent to the browser
6. The browser pipes inbound bytes into ghostty-vt; outbound input goes to the PTY

### Renderer

- **libghostty** parses VT sequences (correctness on par with ghostty proper)
- Renders to a single 2D `<canvas>` by default
- Kitty graphics protocol supported natively via the NimbleMarkets ghostty-web fork
- Kitty keyboard protocol forwardable through `MsgKittyKbd` ('8')
- OSC 52 clipboard writes routed to `navigator.clipboard` (gated by `allowOSC52`)

#### Optional WebGL renderer (vtgl)

Opt in with `--renderer webgl`, `?renderer=webgl`, or the settings panel. The
2D path remains the default until this has had burn-in. There is no VT change:
ghostty-vt still parses everything, and vtgl only draws.

Layering. A WebGL2 context and a 2D context cannot share one canvas, so vtgl
gets its own, positioned behind the bundle's. The bundle's canvas stays in
normal flow (page layout is unchanged) and becomes a transparent overlay:

```
z 0  canvas.sip-vtgl-canvas   text grid + cell backgrounds   (pointer-events: none)
z 1  bundle canvas            selection tint, kitty graphics, cursor, scrollbar
```

Input, selection tracking, clipboard, scrollback, link detection and kitty
graphics all keep running in the bundle untouched, which is why this mode does
not fork the bundle's behavior.

The seam is one hook, `renderer.__sipRenderHook`, in the same surgical style as
the existing `__sip*` patch points. Three lines in `ghostty-web.js`:

- `renderLine()` clears its row and returns early when the hook is set, so the
  overlay stays transparent and stale overlay pixels are still cleared.
- The hook is called once per frame after the row pass, before the kitty and
  cursor passes, so z-order comes out right.
- `resize()` clears rather than filling the background when the hook is set.
- The row pass skips its `getLine()` when the hook is set. `renderLine()` only
  clears the overlay row in that mode, so reading the cells was pure waste.

### The viewport memo

`wasmTerm.getViewport()` walks the whole grid at roughly eight wasm crossings
per cell, and `getLine(row)` is implemented as "walk the viewport, slice one
row". The render loop calls `getLine()` once per damaged row, so an unmemoized
`getViewport()` made a frame O(rows^2 \* cols) crossings. At 80x24 that is
invisible; at the ~200x55 of a maximised terminal it dominates the frame and
was the cause of the "slow on both renderers" reports.

`getViewport()` therefore memoizes into `__sipViewportValid`, invalidated at
every point where the grid can actually change: `write()`, `resize()`,
`setCellPixelSize()`, `markClean()`, and the colour setters `setColorOption()`
and `applyConfig()` (the pool caches resolved per-cell RGB, so a palette change
restyles cells without touching them). Because `markClean()` is the end of a
frame, the memo is per-frame by construction: one walk per frame regardless of
how many rows are read. `clienttests/viewport_reads.spec.mjs` pins the ratio.

Anything added to this file that reads cells must go through `getLine()` or
`getViewport()` so it shares the memo, and any new mutation path must
invalidate it.

### Input: chords must never leak as text

`handleKeyDown` had three paths that returned **without** calling
`preventDefault()`: the IME guard (`isComposing`, or `keyCode === 229`), and an
unmapped `event.code`. The browser then proceeded to its default action, fired
`beforeinput` with `inputType: "insertText"`, and `handleBeforeInput` sent the
bare character. Ctrl+L put `0x6c` ("l") on the wire instead of `0x0c`, and every
chord degraded the same way.

The trigger is environmental, which is why it survived a green suite: Firefox on
Linux running an IME daemon (ibus/fcitx) reports keyCode 229, the "IME is
processing" sentinel, for ordinary keys. Chromium does not, and **synthesized
Playwright key events never carry it**, so `page.keyboard.press('Control+l')`
passes on the broken build.

The fix computes `sipChord` (`ctrl XOR alt`, or meta -- Ctrl+Alt is excluded
because that is AltGr and genuinely composes) and: skips the composition guard
for chords, calls `preventDefault()` before returning on an unmapped code while
a chord is held, and drops `insertText` arriving within 50ms of a chord keydown.
Unmodified keys still fall through to `beforeinput` on purpose, since that is
the mobile and IME input route.

`clienttests/chord_leak.spec.mjs` drives the bail-out conditions directly rather
than hoping the harness reproduces the environment.

### Browser coverage

`playwright.config.mjs` defines two projects. `chromium` runs everything.
`firefox` runs only the input specs, because the renderer specs read pixels back
out of a SwiftShader WebGL context, which is a Chromium-specific setup.

Firefox is not optional decoration: it is the only engine here that reaches
**WebTransport** against a loopback server (Chromium falls back to WebSocket), so
it is the only coverage of that transport, and it is where the input divergences
show up. Two consequences for anyone writing a browser test:

- Do not wait on `classList.contains('connected')`. Under WebTransport the
  status class is `webtransport`. Accept either.
- Do not hook `WebSocket.prototype.send` to capture what the client sends.
  Under WebTransport nothing passes through it, so the hook records zero frames
  and the test fails by timeout or passes vacuously.
- Do not hook the shared adapter's `sipWrite` either, even though it is
  transport-independent. That is the problem, not the fix: it sits *above* both
  transports and records identical bytes whichever one is live, so it cannot
  tell them apart and a green run says nothing about either. Hook the transport
  boundary instead, `ws.send` or the WebTransport stream writer's `write`, as
  `keyboard.spec.mjs` does. That also checks the framing, which differs between
  the two.

**Transport is a test dimension, not an implementation detail.** This suite has
been caught blind twice: once Chromium-only, then WebSocket-only. The second
time a 27/27 green chord matrix was cited as proof a WebTransport bug could not
exist, when every one of those cases had silently run over WebSocket, because
WebTransport had never once connected before the origin fix landed.

So `keyboard.spec.mjs` runs its whole matrix per transport, and every test
declares the transport it wants and **fails** if it got a different one. Never
let a test accept a fallback silently. `TRANSPORT_SUPPORT` records what each
engine can actually reach and is itself asserted: a combination recorded as
unsupported must prove the fallback is real before it skips, so the table
cannot quietly drift out of date.

`vtgl_source.js` adapts the wasm buffer to vtgl's `VtSource` (absolute row
coordinates, theme-resolved colors). `vtgl_bridge.js` owns the canvas, the
geometry sync and the selection tint.

Cell geometry stays the bundle's, so toggling the renderer never reflows the
terminal or shifts mouse hit-testing; vtgl is coerced onto it via derived
lineHeight/letterSpacing. The one value flowing the other way is the text
baseline, because the bundle's block cursor redraws its cell's glyph with the
2D text path.

Known gaps in this mode: link underlines and selection foreground recoloring
are not drawn (selection is a translucent overlay instead), and kitty virtual
placeholder cells are not rendered by vtgl.

### Wire protocol

Binary frames, type-prefixed:

```go
MsgInput    = '0' // Terminal input  (client → server)
MsgOutput   = '1' // Terminal output (server → client)
MsgResize   = '2' // {cols, rows, widthPx?, heightPx?} (client → server)
MsgPing     = '3' // Ping
MsgPong     = '4' // Pong
MsgTitle    = '5' // Window title (server → client)
MsgOptions  = '6' // {readOnly} (server → client, sent on connect)
MsgClose    = '7' // Session ended (server → client)
MsgKittyKbd = '8' // Kitty keyboard protocol flags (bidirectional)
```

WebSocket framing: raw `[type][payload]`.
WebTransport framing: `[uint32 BE length][type][payload]`.

`MaxMessageSize` = 1 MiB. `MaxPasteBytes` defaults to 1 MiB; oversized inbound messages drop the connection.

**Ground truth for "what did the client actually send" is the server, not the
browser.** Run with `SIP_DEBUG_INPUT=1` and every inbound frame is logged with
its type, length and hex payload, for both transports:

```
SIP_DEBUG_INPUT=1 sip -p 7711 -- sh
INFO sip: SIPDEBUG input frame session=... msgType=48 len=1 hex=0c
```

Off by default because keystrokes are sensitive. Reach for it whenever a
keyboard report is ambiguous: "ctrl does nothing" is at least two different
bugs, and `hex=6c` (the chord leaked as its bare character) versus no frame at
all (the chord was swallowed) tells them apart immediately. Client-side capture
cannot, because it only sees what the client *believed* it sent. Two separate
investigations have been misled by trusting it.

### Middleware

Three composable layers, modeled after Wish:

| Layer       | Type                | Wraps                              | Install                            |
|-------------|---------------------|------------------------------------|------------------------------------|
| 1 Handshake | `ConnectMiddleware` | `*http.Request` for WS upgrade + WT CONNECT | `Config.ConnectMiddleware`         |
| 2 Session   | `SessionMiddleware` | `SessionIO` (transport byte streams) | `Config.SessionMiddleware`         |
| 3 Handler   | `Middleware`        | `Handler` (per-session `tea.Model`) | `Config.HandlerMiddleware`         |

`sip.LiftHTTPMiddleware(mw)` adapts any `func(http.Handler) http.Handler` into a `ConnectMiddleware` — chi/gorilla/otelhttp/tollbooth all reusable at the handshake.

Built-ins (auto-installed when configured):
- Basic Auth (when `BasicUsername` or `BasicPassword` set)
- Connection limit (when `MaxConnections > 0`)
- Idle timeout (when `IdleTimeout > 0`)

Subpackages:
- `middleware/osc52gate` — allow / deny / audit OSC 52 clipboard writes outbound
- `middleware/recover` — catch panics during Handler construction
- `middleware/logging` — slog session start / end logging

### Server-side kitty graphics transcoder

`kittygfx.go` intercepts kitty graphics APC sequences in the PTY → client byte stream. PNG (`f=100`) payloads are decoded server-side and re-emitted as raw RGBA (`f=32`) chunks because the wasm build of ghostty-vt doesn't link wuffs (no PNG decoder).

JPEG / GIF support is enabled via `image/jpeg` and `image/gif` import side-effects. Disable with `Config.DisableKittyTranscoder = true`.

### Config knobs (all optional, sensible defaults)

```go
type Config struct {
    Host, Port                                 string
    ReadOnly                                   bool
    MaxConnections                             int
    IdleTimeout                                time.Duration
    AllowOrigins, OriginPatterns               []string  // path.Match globs
    TLSCert, TLSKey                            string
    Debug                                      bool
    BasicUsername, BasicPassword               string
    AllowInsecureNoTLS                         bool      // bypass TLS-required check
    MaxPasteBytes                              int       // default 1 MiB
    ResizeThrottle                             time.Duration  // default 16ms
    MaxWindowDims                              WindowSize     // default 4096×4096
    InitialResizeTimeout                       time.Duration  // default 10s
    FontPath, FontFamily                       string         // custom font upload
    ConnectMiddleware                          []ConnectMiddleware
    SessionMiddleware                          []SessionMiddleware
    HandlerMiddleware                          []Middleware
    DisableKittyTranscoder                     bool
}
```

### Custom fonts

`--font /path/to/file.ttf` serves the file at `/static/fonts/custom<ext>` and injects an `@font-face` rule + `window.__sipConfig.fontFamily` into `index.html` at request time. Pair with `--font-family "My Font Name"` for the CSS family. Falls back to the bundled JetBrains Mono Nerd Font if either is unset.

## Pixel-aware resize

`ResizeMessage` carries optional `widthPx` / `heightPx`. When non-zero and the underlying PTY is `xpty.UnixPty`, the values are forwarded to TIOCSWINSZ via `SetWinsize`, populating `ws_xpixel`/`ws_ypixel`. Kitty graphics tools (kitten icat, ntcharts) read these to size images.

Sessions implement `WindowResizer` to opt into pixel-aware resize. The resize throttler picks `ResizeWindow` over plain `Resize` when available.

## Code conventions

### Go
- Standard `gofmt`
- `charmbracelet/log` for the package logger (ANSI disabled to avoid leaking escapes)
- Error wrapping with `fmt.Errorf("ctx: %w", err)`
- `sync.Pool` for hot-path buffers
- `sync.Map` for concurrent session tracking

### Frontend
- ES modules — `static/terminal.js` is the entry, imports from `static/sip-client/sip.js`
- ghostty-web vendored as-is; no transpile step
- Settings persisted via `localStorage["sip-web-settings"]`

### Naming
- Exported types: `Session`, `SessionIO`, `Handler`, `ProgramHandler`, `Middleware`, `Config`, `Server`, `WindowSize`, `Pty`, `WindowResizer`, `Identity`, `ConnectError`
- Internal: `httpServer`, `webSession`, `cmdSession`, `internalSession`
- Constants: `MsgInput..MsgKittyKbd` ('0'..'8')

## Dependencies

### Core
- `bubbletea/v2` (beta) — TUI framework
- `lipgloss/v2` (beta) — Styling
- `x/xpty` — cross-platform PTY (UnixPty has `SetWinsize`)
- `colorprofile` — terminal color detection
- `charmbracelet/log` — structured logging
- `charmbracelet/fang` — CLI ergonomics

### Transport
- `coder/websocket`
- `quic-go/quic-go`, `quic-go/webtransport-go`

### Frontend (vendored, MIT)
- ghostty-web (NimbleMarkets `nm-kitty-meow` fork — adds kitty graphics + virtual placement)
- sip-client TS bundle adapted from go-booba

## Important notes

### TLS / auth gating
- Self-signed cert auto-generated for loopback hosts (10-day validity for Chrome's `serverCertificateHashes`)
- Non-loopback bind requires `--cert`/`--key` OR explicit `--allow-insecure-no-tls`
- Basic Auth requires TLS unless `--allow-insecure-no-tls` is set; static assets are auth-gated too
- Logs a loud warning when running insecure (cleartext credentials, unencrypted PTY traffic)

### PTY handling
- **Unix**: `xpty.UnixPty` master + slave; pixel-aware via `SetWinsize`
- **Windows**: `io.Pipe()` (ConPty unsuitable for in-process); pixel resize is a no-op
- Session owns lifecycle — `Close()` is idempotent

### Embedded assets
- `//go:embed static/*` ships everything in the binary (~3 MB total: JBM fonts + ghostty-web wasm)
- Fonts cached 1 year client-side; wasm cached 1 year
- Custom font (`--font`) is served from disk, not embedded

**Editing `static/` does nothing until you rebuild.** The server never reads
those files at runtime; `go:embed` bakes them into the binary at build time, so
a running server keeps serving the bundle it was compiled with no matter what
the working tree says. Restarting the same binary does not help either.

This has already burned a whole debugging session. A keyboard fix was confirmed
present in `static/ghostty-web/ghostty-web.js`, the server went on serving the
previous build of that file, the chords stayed broken, and the investigation
went hunting for a second bug that did not exist. Verifying a fix by grepping
the file on disk proves nothing about what the browser is running.

Two guards exist now, use them instead of trusting the tree:
- On startup, if `static/` exists next to the process and differs from the
  embedded copy, the server logs `serving a STALE embedded bundle` and names
  the files. Watch for it whenever a frontend fix appears to do nothing.
- `curl -s $URL/static/ghostty-web/ghostty-web.js | grep <your marker>` asks
  the running server what it is actually serving, which is the only answer that
  matters.

`clienttests` runs the server via `go run`, so the suite always builds the
current tree and never sees a stale bundle. That is also why a green suite can
coexist with a broken running server.

### Concurrency
- 2 goroutines per connection (input + output streams) plus the resize throttler
- Sessions in `sync.Map`, conn count in `atomic.Int32`

### WASM mode build
- BubbleTea v2 has no js/wasm tags for signal handling / TTY init (charmbracelet/bubbletea#1410)
- `cmd/sip-wasm-build` works around this by copying bubbletea to a temp dir, dropping in stub files (`signals_js.go`, `tty_js.go`), and building through a `go.mod` `replace` directive

## Gotchas

1. **Bubble Tea v2 beta** — pre-release, API may change
2. **Port +1 for WebTransport** — HTTP on 7681 ⇒ WT on 7682
3. **Logger colors disabled** — ANSI off so escape sequences don't leak when sip itself logs
4. **Suspend filtered** — `tea.SuspendMsg` becomes `tea.ResumeMsg` (no process suspend in browser)
5. **Bundle size jump** — moving from xterm.js (~1 MB) to libghostty (~1.7 MB raw) doubles cold-load weight; both are gzip-friendly. Keep an eye on `static/ghostty-web/` if you bump the upstream
6. **Kitty transcoder is stateful per session** — one `kittyGfxTranscoder` per output stream goroutine; do not share
