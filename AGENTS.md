# AGENTS.md - Sip

> Sip is a Go library for serving Bubble Tea TUI applications through web browsers, rendered with xterm.js.

## Quick Reference

```bash
# Build library and CLI
go build ./...

# Client-side tests (drive a real server in a real browser)
(cd clienttests && npm install && npx playwright test)

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
      --renderer string       Client renderer: "webgl", "canvas", "dom", empty = auto
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
│   ├── index.html          # Loads webterm.js + terminal.js, includes {{FONT_FACE_EXTRA}} placeholder
│   ├── terminal.js         # Classic script: SipConnection (wire protocol) + SipTerminal (settings, status)
│   ├── terminal.css        # JBM Nerd Font @font-face + Catppuccin Mocha + chrome
│   ├── webterm.js          # Vendored webterm standalone (~835 KB): xterm.js, its addons,
│   │                       # the kitty overlay, the clipboard layer and the width overrides
│   ├── webterm.css         # webterm container + kitty overlay styles
│   ├── xterm.css           # xterm's own stylesheet, still required alongside webterm
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

1. Browser loads `static/index.html` → `static/webterm.js` → `static/terminal.js`
2. `WebTerm.open()` loads the fonts, constructs `Terminal`, then picks a renderer
3. `SipConnection` tries WebTransport (HTTP/3 over QUIC) → falls back to WebSocket
4. Server creates a PTY for the session, spawns either Bubble Tea or the wrapped command
5. PTY output is framed and sent to the browser (through the kitty transcoder only when enabled)
6. The browser writes inbound bytes into xterm; outbound input goes to the PTY

### Renderer

- **xterm.js** parses VT sequences and owns input, selection and scrollback
- Renderer ladder: WebGL → canvas → DOM, chosen once at `term.open()`
- `--renderer`, `?renderer=`, and the settings panel all pick a rung; switching
  it reloads the page, because the addon attaches only at open
- Kitty graphics go through the local overlay, not the image addon (below)
- Sixel goes through the image addon, which is loaded with `kittySupport: false`
- OSC 52 clipboard writes are handled by a registered OSC handler (below)
- Kitty *keyboard* protocol is not supported: xterm.js does not speak it, so
  `MsgKittyKbd` ('8') is never sent. The server still accepts and ignores it.

#### Cell geometry

`lineHeight` is **1.0** and must stay there. A font's line box already includes
its line gap, so multiplying it again renders glyph ink taller than the cell.
That is what produced the seam between stacked block glyphs (U+2588 drawing
~20px of ink into an 18px cell) that motivated returning to xterm.js.

xterm's canvas and webgl renderers draw box and block drawing characters as
vector shapes fitted to the cell rather than as font glyphs, which removes the
seam structurally instead of tuning around it.
`clienttests/client.spec.mjs` pins this by compositing the canvas layers and
asserting that a column through four stacked block rows contains no
background-coloured pixel.

Fonts are loaded through the FontFace API and awaited **before** `new Terminal`.
Constructing the terminal first makes it measure the fallback face and cache the
wrong cell box.

#### Grapheme clustering

The vendored bundle already carries the modern Unicode API: `charProperties`
(width `(v>>1)&3`, shouldJoin `v&1`) and an InputHandler that subtracts the
preceding width on a join. What it ships by default is `UnicodeV6`, a thin
wrapper over wcwidth with no notion of a cluster, so a ZWJ family emoji is
billed per scalar and eats eight columns.

`xterm-addon-unicode-graphemes.js` (@xterm/addon-unicode-graphemes 0.4.0, 58 KB
UMD, no external imports) supplies a UAX 29 provider against the same bit
layout. It is loaded before `term.open()` and `activeVersion` is set to
`15-graphemes`.

Against the 45-cluster corpus measured from the real ghostty-vt it agrees on
39. The six remaining divergences are all a lone zero-width or defective
character written at column 0, where InputHandler has no preceding cell to join
onto and gives the codepoint a cell of its own; they are pinned in
`clienttests/grapheme_corpus.spec.mjs` rather than papered over.

`sip-unicode.js` is ours, loaded before `terminal.js`. It wraps the addon's
provider and overrides the width of a short list of codepoints, currently only
U+200B ZERO WIDTH SPACE, which the addon bills one column and everything else
bills zero. That one was worth fixing because ZWSP appears in ordinary text as
a line-break opportunity; the rest of the list is argued case by case in the
file's header, including which characters are deliberately left alone. Register
overrides there, never by patching the addon.

Do not reach for a ghostty-vt-backed provider to close the rest. The wasm
exports no standalone width or grapheme-break function — only grid-scoped
`ghostty_cell_get` and `ghostty_grid_ref_graphemes` — so it would need a shadow
VT with a wasm round trip per character on xterm's hottest path.

#### Patches to the vendored bundles

Vendored files are shipped as published, with one exception each marked inline
by a `/*__sipPatch:<name>*/` comment so `grep -r __sipPatch static/` lists every
one. Re-apply them deliberately after any bundle bump.

- `round-device-cell-width` in `webterm.js`. Both atlas renderers computed
  `device.char.width = Math.floor(advance * dpr)`. The atlas rasterises each
  glyph into a box of exactly that width, so at dpr 2, where the 14px advance
  is 16.8 device px, every cell was 16 and any glyph drawn to the full advance
  lost 0.8 device px off its right edge: powerline separators, box and block
  glyphs, Nerd Font icons. An eight-cell powerline pill measured 128 device px
  of ink against the DOM renderer's 135. Now `Math.round`. Rounding rather than
  ceiling is the point: at dpr 1 the cell stays 8 for an 8.4px advance, so text
  is not loosened to fix icons. Guarded by the HiDPI test in
  `clienttests/metrics.spec.mjs`, which fails with the unpatched bundle.
  Upstream still ships `Math.floor`, and webterm cannot carry the fix because
  it takes the addons as peer dependencies rather than vendoring them, so this
  patch has to be re-applied to every rebuilt `webterm.js`.

#### Kitty graphics overlay

The overlay now lives in webterm (`src/kitty/`) and ships inside `webterm.js`.
It registers an APC handler for identifier 71 via
`term.parser.registerApcHandler`, parses the kitty protocol itself, and draws
each placement as an absolutely positioned canvas in a DOM layer above xterm's.

sip runs it with `anchor: 'viewport'`, because the compositor re-emits every
placement each frame and the newlines it emits would otherwise park images in
scrollback. A shell running an image viewer wants the `scrollback` default.

It exists instead of the image addon's kitty support because the addon bakes
placements into the cell buffer and cannot reposition them, which is fatal for a
window manager that moves windows around. The overlay repositions every
placement on scroll and resize through a microtask-batched scheduler.

Supported: actions t/T/p/d/q, direct base64 transmission, formats 24/32/100,
zlib via `DecompressionStream`, chunked transmission, deletion by image or
placement id. PNG (f=100) is decoded natively with `createImageBitmap`, which is
why the server-side transcoder is off by default. Out of scope by design:
animation, file and shared-memory transmission, Unicode placeholder placement.

**`registerApcHandler` is load-bearing.** @xterm/xterm 6.0.0 stable has no APC
parser at all — zero occurrences in its runtime bundle and its typings — so
upgrading the vendored bundle to it would kill kitty graphics outright. 6.1.0
restores it. Check for the handler before any bundle bump.

### Browser coverage

`playwright.config.mjs` defines two projects. `chromium` runs everything.
`firefox` runs only `keyboard.spec.mjs`, because the renderer checks read pixels
back out of a canvas under a pinned GL setup, which is Chromium-specific.

Firefox is not optional decoration: it is the only engine here that reaches
**WebTransport** against a loopback server (Chromium falls back to WebSocket), so
it is the only coverage of that transport. Two consequences for anyone writing a
browser test:

- Do not wait on `classList.contains('connected')`. Under WebTransport the
  status class is `webtransport`. Wait on `window.sipTerm.connected` instead.
- Do not hook `WebSocket.prototype.send` to capture what the client sends.
  Under WebTransport nothing passes through it, so the hook records zero frames
  and the test fails by timeout or passes vacuously.
- Hook the transport boundary — `sipTerm.wsConnection.send` or
  `sipTerm.wtWriter.write` — as `keyboard.spec.mjs` does, never a shared send
  path above them. A hook above the transport records identical bytes whichever
  one is live, so it cannot tell them apart and a green run says nothing about
  either. The boundary also proves the framing, which differs between the two.

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

#### What the keyboard suite does not prove

It is a guard on the **encoding table** and nothing more. The chord-leak class
of bug — Ctrl+L reaching the server as `0x6c` instead of `0x0c` — has been
proven unreproducible from synthesized key events **in either direction**: the
handler was instrumented doing the right thing while the wrong byte arrived,
and the identical code path produced the correct byte headless. The trigger is
environmental (Firefox on Linux with an ibus/fcitx daemon reports keyCode 229,
the "IME is processing" sentinel, for ordinary keys) and Playwright cannot carry
it.

A green run means the table is intact. It does not mean chords work on a real
desktop, and it must never again be cited as if it did. Verify chords by hand.

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

`kittygfx.go` can intercept kitty graphics APC sequences in the PTY → client byte stream and re-emit PNG (`f=100`) payloads as raw RGBA (`f=32`) chunks. It is **off by default**: the browser overlay decodes PNG natively with `createImageBitmap`, so forwarding the compressed payload untouched is both smaller and faster. Enable with `Config.EnableKittyTranscoder = true` for a client with no PNG decoder of its own.

JPEG / GIF support is enabled via `image/jpeg` and `image/gif` import side-effects.

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
- Classic scripts — the xterm bundle publishes globals, `static/terminal.js` consumes them
- xterm.js and its addons vendored as-is; no build or transpile step
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
- `webterm.js`, the standalone build of the webterm package, which inlines
  xterm.js and the fit / webgl / canvas / web-links / image /
  unicode-graphemes addons
- webterm also owns what used to be `xterm-kitty-overlay.js` and
  `sip-unicode.js`: the kitty graphics overlay, the layered clipboard, the
  unicode width overrides, input chunking, motion dedup and Keyboard Lock

#### The webterm split

Everything reusable moved out to the webterm package and comes back as one
vendored bundle. What stayed in `terminal.js` is what is sip's alone: the
message types 0x30-0x37, the 4-byte WebTransport length prefix, the
`/cert-hash` exchange and the port+1 convention, the settings panel, the status
indicator and the reconnect policy.

`SipConnection` implements webterm's three-method `Transport` (`start`, `send`,
`close`), so the package never learns a message type byte. `send` carries
terminal input only; resize and ping go through `sendMessage`, which the client
calls directly, because those are not terminal traffic.

Test instrumentation hooks `window.sipTerm.connection`, not `window.sipTerm`:
the socket and the stream writer live on the connection now. A kitty protocol
reply arrives at `connection.send` rather than at `sendInput`, because it takes
the same outbound path a keystroke does.

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
- `//go:embed static/*` ships everything in the binary (JBM fonts dominate the size)
- Assets are tagged with a content ETag and `Cache-Control: no-cache`, so the
  browser revalidates and a redeployed client actually takes effect
- Custom font (`--font`) is served from disk, not embedded

**Editing `static/` does nothing until you rebuild.** The server never reads
those files at runtime; `go:embed` bakes them into the binary at build time, so
a running server keeps serving the bundle it was compiled with no matter what
the working tree says. Restarting the same binary does not help either.

This has already burned a whole debugging session. A keyboard fix was confirmed
present in the client bundle on disk, the server went on serving the
previous build of that file, the chords stayed broken, and the investigation
went hunting for a second bug that did not exist. Verifying a fix by grepping
the file on disk proves nothing about what the browser is running.

Two guards exist now, use them instead of trusting the tree:
- On startup, if `static/` exists next to the process and differs from the
  embedded copy, the server logs `serving a STALE embedded bundle` and names
  the files. Watch for it whenever a frontend fix appears to do nothing.
- `curl -s $URL/static/terminal.js | grep <your marker>` asks
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
5. **`registerApcHandler` is load-bearing** — the kitty overlay's entry point. @xterm/xterm 6.0.0 stable removed the APC parser entirely; check for the handler before bumping the vendored bundle
6. **Kitty transcoder is stateful per session** — one `kittyGfxTranscoder` per output stream goroutine; do not share
