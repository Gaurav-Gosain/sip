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
      --auto-tls              Serve HTTPS from sip's own managed self-signed cert
      --cert-dir string       Where that cert lives (default: user config dir/sip)
      --cert-host strings     Extra DNS name / IP in its SAN (repeatable)
      --cert-days int         Its validity (0 = 365)
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
  cert                        Manage the self-signed TLS cert (info/new/rm/path)
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
├── cert.go                 # Ephemeral self-signed cert (WebTransport, loopback)
├── certstore.go            # The managed on-disk keypair: create/load/remove, SAN discovery
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
│   ├── index.html          # Loads webterm.js + mobile.js + terminal.js, includes {{FONT_FACE_EXTRA}} placeholder
│   ├── terminal.js         # Classic script: SipConnection (wire protocol) + SipTerminal (settings, status)
│   ├── mobile.js           # Classic script: the touch key bar, the keyboard-aware
│   │                       # layout, the touch mouse layer and installDraggable.
│   │                       # Publishes window.SipMobile
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
   - The Go side registers `bubbletea_read` / `bubbletea_write` /
     `bubbletea_resize` on `globalThis` and nothing else. `static/terminal.js`
     has no adapter for them: it was dropped in the webterm split and has not
     been rebuilt, so a wasm app currently supplies its own page and drives
     those three globals itself. `static/mobile.js` is standalone and usable
     from such a page as it stands.
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

There are none. `static/webterm.js` is byte for byte a webterm `main` build, and
nothing under `static/` is edited after vendoring. Anything that used to be a
`/*__sipPatch:<name>*/` marker now lives in webterm's source, so a bundle bump
carries it rather than dropping it.

The one that mattered is the rounded device cell width. Both atlas renderers
compute `device.char.width = Math.floor(advance * dpr)` and the atlas rasterises
each glyph into a box of exactly that width, so at dpr 2, where the 14px advance
is 16.8 device px, every cell was 16 and any glyph drawn to the full advance lost
0.8 device px off its right edge: powerline separators, box and block glyphs,
Nerd Font icons. An eight-cell powerline pill measured 128 device px of ink
against the DOM renderer's 135. sip carried that as a hand edit to the vendored
addon bundles until the webterm split, where it was silently lost. It now lives
in webterm's `src/cell-metrics.ts`, which gives the renderer a char size service
reporting an advance that floors to the rounded device width, leaving the core's
own service and therefore layout, selection and the kitty overlay measuring the
real advance. Upstream xterm still ships the floor. Guarded on both sides: the
HiDPI test in `clienttests/metrics.spec.mjs` and webterm's own
`test/browser/metrics.spec.mjs` at `chromium-dpr2`.

#### Kitty graphics overlay

The overlay now lives in webterm (`src/kitty/`) and ships inside `webterm.js`.
It registers an APC handler for identifier 71 via
`term.parser.registerApcHandler`, parses the kitty protocol itself, and draws
each placement as an absolutely positioned canvas in a DOM layer above xterm's.

sip runs it on the `scrollback` anchor, so a placement is tied to the buffer row
that introduced it and scrolls away with that row. A full-screen compositor is
unaffected: the alternate screen has no scrollback, so the anchoring row and the
screen row are the same row there. sip previously forced `anchor: 'viewport'`,
which pinned every image to the visible grid and left it hanging in place while
the text scrolled underneath it.

After a placement the overlay moves the cursor past the image, right by its
columns and down by its rows, unless the sender asks for `C=1`. `kitten icat`
emits only a trailing CR LF of its own and relies on the terminal for the rest,
so without this the next shell prompt is drawn straight through the image.

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

### Touch and the software keyboard

`static/mobile.js` is a standalone classic script publishing `window.SipMobile`.
It imports nothing, injects its own styles and builds its own DOM, and it is
installed only on a touch device (`detectTouch`, overridable with `?mobile=1`
and `?mobile=0` for testing). `terminal.js` wires it up in `setupMobile`.

Four parts:

- **The key bar.** One or more scrolling strips of the keys a phone keyboard
  does not have. The key set is the caller's: `installKeyBar(host, { keys,
  rows, actions, prefix })`, with `Config.MobileKeys`, `Config.MobileRows`,
  `Config.MobilePrefix` and `Config.DisableMobileKeyBar` as the Go-side route
  into it through `window.__sipConfig`. The default set is Escape, Tab, sticky
  Ctrl and Alt, the arrows and some punctuation, and it deliberately assumes
  nothing about what is running: sip serves arbitrary programs and has no
  business guessing at their keymap. An application with chords worth a button
  supplies them.

  **The leader chord is why the rows exist.** tmux, screen, zellij and emacs are
  each driven by one, and a touch screen cannot hold a modifier while pressing
  a key, so without `MobilePrefix` every binding in such a program is out of
  reach from a phone. `MobileKey.Prefixed` sends the leader and a key in one
  tap; `MobileKey.Prefix` arms it and lights up so the second half can be typed
  on the software keyboard. The latch is cleared by every keystroke that goes
  out, through `pressKey`, `wrapKey` and `transformInput`, which is what lets a
  chord button skip a leader the user already sent without the two states ever
  drifting apart.

  A host that gates `transformInput` on its own idea of what the bar is holding
  will drop the latch: ask `bar.pending` instead. `terminal.js` did exactly that
  and swallowed the leader silently, which is what `mobile.spec.mjs` now pins.
- **The keyboard's share of the window.** `--sip-kb-inset` and `--sip-keybar-h`
  are published on the document element and `terminal.css` pads
  `#terminal-container` with them, which makes webterm's own ResizeObserver
  refit the grid. The inset is the max of two measurements, the VirtualKeyboard
  API (Chromium on Android) and the visualViewport difference (Safari on iOS),
  because no one browser has both and a browser that resized the layout itself
  reports zero on both. A bad measurement costs space, never layout.
- **The mouse a phone does not have.** `installTouchMouse(host, options)`, wired
  up in `setupTouchMouse`, with `Config.MobileMouse` as the Go-side route in.
  Its own section below, because none of it is obvious.
- **`installDraggable(el, opts)`.** Independent of the rest. It makes one
  fixed-position control draggable and remembers where it was left. sip uses it
  for the settings gear, which floats over whatever the program is drawing.

#### A finger on the terminal

xterm.js recognizes touch with a `Gesture` class inherited from VS Code, and
that class is why nothing works. It registers `touchstart` and `touchmove` on
the **document** with `{passive:false}` and ends every handler with
`preventDefault()` then `stopPropagation()`. The first half means the browser
synthesizes no compatibility `mousedown`/`mouseup`/`click`; the second means
the touch never reaches the window's bubble phase. A page sitting on top of
xterm sees a finger not at all. Before this landed, tap to focus, tap to place
the cursor, drag to select, long press and every press-motion-release gesture
put **zero bytes** on the wire. Only a pan worked, as wheel reports, because
xterm subscribes to two of the recognizer's five events itself.

What it does dispatch, on the screen element, is `-xterm-gesturestart`,
`-xterm-gesturechange`, `-xterm-gesturesend`, `-xterm-gesturetap` and
`-xterm-gesturecontextmenu`. `bindMouse` listens for the first two. The last
two are dispatched to the same element and dropped on the floor.

`installTouchMouse` picks them up and adds the one gesture the recognizer has
no event for:

| gesture | what goes out |
|---------|---------------|
| tap | press + release, button 1 |
| long press (recognizer's 700ms, no movement) | press + release, button 3 |
| press, hold `longPressMs`, then move | press at the origin, motion, release |
| pan | wheel reports, unchanged, xterm's own |

**Everything is a synthesized `MouseEvent` at the screen element, never bytes.**
That is the whole design and it is worth defending. xterm already owns the
encoding, and there is far more of it than a touch layer should reimplement:
which of X10, VT200, urxvt, SGR and SGR-pixels the program asked for, whether
it wants motion at all, whether the report is suppressed for a modifier that
forces selection, and the per-cell deduplication of motion. Dispatching the
event a mouse would have produced gets all of it, and gets the no-mouse-mode
case for free: the same press-hold-drag runs xterm's selection service, so a
finger selects text. An encoder of our own would have shipped SGR at a program
that asked for X10 and would have needed a `cellAtPixel` of its own to do it.

**The listeners go on the `window` in the capture phase, and that is load
bearing.** The gesture events are dispatched *at* the screen element, and at
the target itself capture and bubble listeners run in registration order, so a
capture listener added to the screen element would still run after xterm's own
— which consumes the event with `stopPropagation`. An ancestor's capture
listener runs first whatever the registration order. The events are also
`bubbles: false`, so capture is the only phase in which they are visible from
outside at all.

**The inertial fling was corrupting the shell.** `Gesture._inertia` builds its
CHANGE events out of `translationX`/`translationY` alone, with none of the
coordinates the ones from `touchmove` carry. `_handleTouchScrollAsWheel` passes
them to `getMouseReportCoords`, which subtracts the element rect from an
undefined `clientX`; the `{col: NaN, row: NaN}` that comes back is an object,
so the `if (coords)` guard passes and the encoder ships it. Measured: three
flings put 534 mouse reports on the wire and **489 were `\x1b[<65;NaN;NaNM`**,
filling the pane with `NaN;NaNMaN;NaNM…`. The layer fills the coordinates from
the last place a finger was actually seen, and drops the event if there is no
such place rather than guessing. This has **no config switch**: there is no
honest setting for "keep corrupting my shell". `docs/xterm-inertia-nan.md` is
the upstream writeup; `clienttests/touch.spec.mjs` counts the reports.

`Config.MobileMouse` is the config surface and its **zero value is all of it,
on**. Argued rather than assumed: a terminal where tapping does nothing is
broken, the events being consumed already exist, and none of it installs
without a touch screen, so the desktop path pays nothing. `Disable`,
`DisableTap` and `DisableDrag` turn parts off for a program that reads a click
as destructive or handles touch from its own page script; `LongPressMs` and
`SlopPx` retune the one gesture that is ours. The zero value emits nothing into
the page at all, which `TestRenderIndexMobileMouse` pins.

#### Two things in there that will be silently re-broken

**The bar is `overflow: hidden` and pans itself.** The obvious implementation is
`overflow-x: auto`, and it costs the software keyboard. A native touch scroll is
a gesture the page has already lost by the time it can see it: Blink delivers
`touchmove` and `touchend` with `cancelable === false`, so the page cannot stop
it, and the browser takes the keyboard down when a scroll starts under it.
Emulation shows none of that. The two fixes look irreconcilable, because
cancelling the touch sequence is what keeps the keyboard up and cancelling it is
what stops a native scroll. They are only irreconcilable while the browser is
the one scrolling: the strip is `overflow: hidden`, the whole bar is
`touch-action: none`, every touch is cancelled at `touchstart`, and the pan is
`scrollLeft` assignment, which an `overflow: hidden` box still honours.

An earlier theory blamed the compat mouse events a tap synthesises. It was
measured and it was wrong. Do not revert to it.

**Sticky modifiers are folded in on the byte path, not the key path.**
`SipConnection.send` is the last point at which a keystroke is still visible as
itself: xterm has already encoded the key by then, and an Android IME keyboard
never produced a usable key event in the first place (keyCode 229, no `.key`).
`transformInput` rewrites a single character or a single bare cursor key and
consumes the one-shot modifier; anything longer is a mouse report, a paste or a
device-query reply, which passes through with the modifier left armed. With
nothing armed it returns its argument, so the desktop cost is two property
reads.

`clienttests/mobile.spec.mjs` pins both. The pan test drives a real multi-step
touch sequence through CDP (Playwright's `touchscreen` only taps) and asserts
that the strip moved, that no event arrived non-cancellable, that focus never
left xterm's textarea, and that flicking past a button did not press it.

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
    AutoTLS                                    bool           // serve from sip's managed cert
    CertDir, CertHosts, CertValidity                          // where / what for / how long
    MobileKeys                                 []MobileKey    // touch key bar, one row
    MobileRows                                 []MobileRow    // touch key bar, many rows
    MobilePrefix                               MobilePrefix   // the deployment's leader chord
    DisableMobileKeyBar                        bool
    MobileMouse                                MobileMouse    // what a finger on the terminal does
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
- Non-loopback bind requires `--cert`/`--key`, `--auto-tls`, OR explicit `--allow-insecure-no-tls`
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
