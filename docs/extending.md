# Changing sip's page without forking it

Everything the browser runs is baked into sip's binary by `go:embed`. Until
these options existed, changing one CSS rule meant vendoring seven files and
maintaining them forever.

`examples/hackable` is all of it in one file. Run it and read it beside this
page:

```
go run ./examples/hackable -p 7681
```

## Which one to reach for

Read the list top to bottom and stop at the first one that does the job. The
ones at the top survive a sip upgrade. The one at the bottom is a fork of one
file.

| You want | Use |
|---|---|
| Different colours, cursors or a font size | `Config.Appearance` — see [Colours](../README.md#colours) |
| A few CSS rules | `Config.ExtraCSS` |
| A small script on the page | `Config.ExtraJS` and `window.sip` |
| To decide what that script may do | `Config.PageAPI` |
| A logo, a font, an image | `Config.StaticFS`, under a name sip does not use |
| A URL of your own: a manifest, an icon file, a page | `Config.Routes` |
| To replace one of sip's client files | `Config.StaticFS`, under that file's name |

A deployment that sets none of these serves exactly what sip served before any
of it existed. `TestDefaultPageUnchanged` pins that byte for byte.

## Config.ExtraCSS

Rules appended after sip's own stylesheet.

```go
cfg.ExtraCSS = `
#connection-status { border-color: #a6e3a1; }
#settings-panel    { border-radius: 12px; }
`
```

Sip goes on serving `terminal.css` underneath, so an upgrade carries every fix
to it and only your rules are yours. There is nothing here to go stale.

The link tag comes after sip's own stylesheets, so a rule of the same
specificity wins on cascade order alone. You do not need `!important`.

It is served as a file at `/static/sip-extra.css`. Your rules show up in the
browser's developer tools like any other stylesheet, and a relative `url()` in
them resolves against `/static/`, which is how a rule reaches an image you
supplied through `StaticFS`.

Colours are not this. `Config.Appearance` sets the palette, both cursors, the
scrollback and the font size, and the terminal reads them as options rather
than as CSS. `ExtraCSS` is for the chrome around the grid.

## Config.ExtraJS and window.sip

A classic script served at `/static/sip-extra.js` and loaded with `defer`, so
it runs after sip's client and before the terminal opens.

```go
cfg.ExtraJS = `
const api = sip.claim();

api.on('ready',      (e) => console.log('grid', e.cols, e.rows));
api.on('connect',    (e) => banner.textContent = 'on ' + e.transport);
api.on('disconnect', (e) => banner.textContent = 'off: ' + e.reason);
document.getElementById('restart').onclick = () => api.send('\x03exec bash\n');
`
```

`window.sip` is what sip promises to keep. Four calls and five events sit on it
directly. Everything else arrives through `sip.claim()`, and what `claim`
answers is the deployment's own choice. See
[Config.PageAPI](#configpageapi-what-the-page-may-do) below.

| Call | Does |
|---|---|
| `sip.on(name, fn)` | Listen. Returns a function that removes the listener. |
| `sip.off(name, fn)` | Stop listening. |
| `sip.send(data)` | Send input, as if it had been typed. Returns a promise. |
| `sip.size()` | `{cols, rows}`, or `null` before `ready`. |
| `sip.capabilities()` | The capability names this deployment granted. |
| `sip.claim()` | The rest of the API. It answers once. |

| Event | Detail | When |
|---|---|---|
| `ready` | `{cols, rows}` | The terminal exists, before it connects. |
| `connect` | `{transport}` | A transport is carrying the session. |
| `disconnect` | `{reason}` | `closed` if the session ended, `lost` otherwise. |
| `resize` | `{cols, rows}` | The grid changed shape. |
| `title` | `{title}` | The program renamed the browser tab. |

`ready` is sticky. A listener added after it fired is called anyway, so a
script never has to race the terminal.

A listener that throws is reported to the console and the rest still run. One
bad line in your script must not take the terminal with it.

## Config.PageAPI: what the page may do

A page script can do more than watch and type. It can repaint the terminal,
search the scrollback, read the selection, copy it and restart the session.
Every one of those is off unless you turn it on.

```go
cfg.PageAPI = sip.PageAPI{
    Grant:  []sip.Capability{sip.CapAppearance, sip.CapRead},
    Revoke: []sip.Capability{sip.CapInput},
}
```

`Grant` adds to the default set. `Revoke` runs after `Grant` and takes away, so
a capability in both lists is refused. Neither field needs a "none" value:
revoke everything and the page gets nothing.

### The capabilities

| Capability | The page may | Default |
|---|---|---|
| `CapObserve` | Listen for the events, read the grid size and the status. | on |
| `CapInput` | Type into the shell, and paste into it. | on |
| `CapAppearance` | Repaint the palette, the font, the cursors and the tab. | off |
| `CapView` | Scroll the viewport, clear the scrollback, focus the grid. | off |
| `CapRead` | Read the selection, and search what the program printed. | off |
| `CapClipboard` | Copy the selection to the system clipboard. | off |
| `CapConnection` | End the session and start a new one. | off |

**The default is `CapObserve` and `CapInput`, and it is exactly what
`window.sip` granted before this option existed.** A deployment that upgrades
sip gains no call it did not already have.

**Reach for `CapAppearance` on its own** when the page wants a theme switcher,
a font size control or a tab icon. It repaints and it reads nothing.

**Do not reach for `sip.AllCapabilities()`** unless you write and ship every
script on the page. A grant is a promise about the document, not about the line
you are writing. The next section says why.

**`CapInput` is the strongest one.** Anything that can call `sip.send` can run
a command in the user's shell. A page that only restyles the terminal should
revoke it.

**`CapRead` is program output.** The selection is what the program printed.
Search is the same thing one answer at a time, so the two travel together: a
page that can ask "is this string on the screen" can learn the screen.

**`CapConnection` is destructive.** A reconnect ends the running session and
starts a new one, and the program the user was running dies with it. The client
already reconnects on its own when a transport drops, so this is a button, not
a recovery path.

A capability name sip does not know is refused at startup, and the refusal
lists the names it does know. A misspelled grant is silent otherwise, and
silence reads exactly like sip ignoring the option.

### A call the page does not have

It throws, at the call, every time:

```
SipCapabilityError: sip: this page does not grant the appearance capability.
Add it to Config.PageAPI.Grant in Go.
```

The error carries the capability on `error.capability`. Nothing happens before
it throws, so a refused call cannot half apply. Ask `sip.capabilities()` first
if you would rather look than catch.

### sip.claim

`sip.claim()` hands over the API object once. The first caller gets it and
every caller after that gets an error.

```js
const api = sip.claim();   // the first line of your own script
```

Call it early, from your own script. An API that nobody has claimed is there
for whatever runs next.

What this buys is written out plainly below. It is not isolation.

## Who you are defending against

Three things can reach the page, and they are not the same.

### 1. The program in the terminal

The terminal renders bytes from whatever the user is running. Treat every one
of those bytes as hostile, because a program can print anything a program
likes.

**No byte from the program calls anything on this page.** Program output
reaches the grid and stops there. It sets no capability, no CSS property, no
tab icon and no page script running. The browser suite proves it by putting the
escape sequences a program would use into a real shell and asserting that
nothing moved.

Two consequences for your own script:

- **The `title` event carries a string the program chose.** It is the one
  place program output reaches the default API, and sip cannot help that: the
  point of the event is that the program renamed the tab. Put it in
  `textContent`. Never put it in `innerHTML`, in a URL or in a CSS value.
- **`sip.appearance.get()` reports what sip was told to paint.** A program that
  changes a colour with an escape sequence changes the terminal and not this,
  because a value the program chose is not a value your page asked for.

Every value your script hands to `sip.appearance.set()` is checked before it
reaches the browser: a colour must be hex, a cursor must be a keyword sip
knows, a tab icon must not be a `javascript:` URL, and a field sip does not
know is refused rather than passed on. That check is there for the day your
own script reads a theme name out of a query string.

### 2. Another script on the page

If your page loads analytics, a widget or anything else you did not write, that
code shares one JavaScript context with sip's client. It can call anything that
context can reach.

`sip.claim()` raises the bar. The API object is handed over instead of parked
on `window`, so a script that arrives later cannot reach the powerful half of
it unless your own code hands it over.

**It is not a boundary, and this is the honest part.** Inside one JavaScript
context you cannot keep a capability away from another script in that context.
A script that runs before sip's client can replace `window.sip`, patch the
functions the client is built from, or set the config the client reads. A
token, a private symbol or a closure would change none of that.

So:

- **`sip.claim()` reduces accidental exposure.** It is worth using, and it is
  the reason to call it on your first line.
- **The claimed object holds its own handles.** `window.sip` is a plain object
  and a later script can replace a call on it. That does not change what your
  claimed object does, so replacing `window.sip.send` does not put anyone
  between your page and its terminal.
- **The capability list bounds sip's supported API.** It does not bound the
  document. `window.sipTerm` is still on the page for sip's own browser tests,
  and a script that wants the terminal's buffer can take it from there.
- **An operator who needs a real boundary must use an iframe.** Serve sip on
  its own origin, put it in an iframe, and talk to it with `postMessage`. A
  separate context is the only thing that is actually a wall.

### 3. Your own config

`Config.PageAPI` is a promise about every script in the document. Grant the
capability the page needs and no more. Revoke `CapInput` from a page that has
no business typing.

Every capability sip added after the first four calls is off by default, so
silence is safe. The cost of an unsure answer is one line in Go.

## The rest of the API

Everything below comes from `sip.claim()`. Each call names the capability it
needs. `api.version` is the shape of the object, and it goes up when a call
changes meaning.

### status, observe

```js
api.status()   // {connected, transport, readOnly, renderer, cols, rows} or null
```

### input

```js
api.input.send(data)    // as if typed
api.input.paste(text)   // as a paste, so bracketed paste mode sees it
```

### appearance

```js
api.appearance.get()          // what sip is painting
api.appearance.set(patch)     // repaint
api.appearance.reset()        // back to the deployment's own appearance
```

The patch takes any of `theme`, `pageBackground`, `fontSize`, `fontFamily`,
`scrollback`, `cursorStyle`, `cursorInactiveStyle`, `cursorBlink`,
`mouseCursor`, `title` and `favicon`. They are the fields of
[`Appearance`](../README.md#colours) and they mean the same thing here.

```js
api.appearance.set({ theme: { background: '#282828', foreground: '#ebdbb2' } });
```

A theme is a patch, the way it is in Go: three colours change three colours.

`mouseCursor` takes the same keywords `Appearance.MouseCursor` does. A program
that names its own pointer shape through the kitty protocol wins while it holds
one, which is the same order sip already follows.

The chrome follows the palette, so the settings panel and the status line
repaint with the terminal.

It works before the terminal opens, which is where a page that reads a theme
out of local storage wants it. The first paint is then already the right one.

A reconnect re-sends the deployment's own appearance. What your page set goes
back on top of it, so a live theme survives.

### view

```js
api.view.scrollToTop()
api.view.scrollToBottom()
api.view.scrollLines(count)   // negative scrolls back
api.view.clear()              // throws the scrollback away
api.view.focus()
api.view.blur()
```

### selection and search, both CapRead

```js
api.selection.has()        // boolean
api.selection.get()        // the selected text
api.selection.clear()
api.selection.selectAll()

api.search.find(query, { caseSensitive, backwards })   // {row, col, length} or null
api.search.findNext()
api.search.findPrevious()
api.search.clear()
```

`find` selects the match and scrolls to it. The query is plain text and never a
pattern: a regular expression from a page script is your own runtime to lose.
Wrapped lines are searched as the line they wrapped from, which is most of what
is on a terminal screen.

### clipboard

```js
api.clipboard.copySelection()   // promise for whether it landed
```

The text does not pass through your script, which is why this is not `CapRead`.

### connection

```js
api.connection.reconnect()   // ends the session and starts a new one
```

### What is deliberately not in it

**The terminal object.** There is no `sip.term` in the promise, and that is the
whole design. Sip renders with xterm.js today and has two renderer branches in
flight. A handle to xterm's `Terminal` would be a promise sip plans to break,
and a broken promise reads as sip's bug in your users' eyes. Every call above
is answerable whatever renders the grid.

If you need something xterm-specific, open an issue and ask for a `Config`
field. That is the route sip maintains.

**The output stream.** No event carries what the program printed. It is a
firehose, it would tie sip to the exact shape of its output path, and a page
script that logs a terminal's output is a privacy hazard by accident.
`CapRead` is the bounded answer: the user selects, or your script searches for
something it already knows.

**Reading the clipboard.** `navigator.clipboard.readText()` is the browser's
own API, it asks the user, and it works on any page. Sip has nothing to add to
it but a second door.

**A capability that changes while the page runs.** The list is decided when the
page is rendered and never again. The session handshake does not carry it. A
capability that could widen after your script has already run is a capability
whose check is a race.

**The connection, the settings object and the DOM.** `window.sipTerm`,
`window.sip.term`, `window.sip.settings`, the element ids and the CSS class
names are sip's own. They are readable, they are what sip's own browser tests
use, and they change without notice. Read them for a one-off, never for
something you have to keep running.

## Config.StaticFS

An `fs.FS` that wins over sip's own copy of a file, name by name.

```go
//go:embed assets
var assets embed.FS

pages, _ := fs.Sub(assets, "assets")
cfg.StaticFS = pages
```

Names match the URLs under `/static/`: `terminal.css`, `index.html`,
`fonts/MyFont.woff2`. A name missing from your FS falls through to sip's own
copy, so replacing one file does not mean vendoring the rest.

Two names are config, not files, and a file cannot claim them:
`sip-extra.css` and `sip-extra.js`.

### Adding a file

A name sip does not use is simply served. This is the safe half of `StaticFS`
and there is nothing to keep in step:

```
assets/brand.svg  →  /static/brand.svg
```

### Replacing a file

A replacement is a fork of that one file. Sip goes on developing the original,
an upgrade brings the new one in, and nothing on the screen or in the log says
your copy has fallen behind.

Sip does two things about it and you should do the third.

1. At startup it names every shipped file your FS replaces, so the risk is at
   least visible: `sip serves replaced client files. Check each one after a
   sip upgrade`.
2. `sip.Assets()` hands you the files sip actually serves, so you can derive a
   copy from the current one rather than guess at it.
3. Pin the digest of the file you copied, in a test of your own:

```go
func TestOverrideIsStillCurrent(t *testing.T) {
    got, err := sip.AssetDigest("index.html")
    if err != nil {
        t.Fatal(err)
    }
    if got != sipIndexDigest {
        t.Fatalf("sip's index.html has changed since assets/index.html was copied from it.\n"+
            "  was: %s\n  now: %s", sipIndexDigest, got)
    }
}
```

The test fails on the upgrade that moved the file, which is the only moment at
which the answer is useful. `examples/hackable/stale_test.go` is this, working.

`sip.AssetNames()` lists every name you can override.

### Replacing index.html

The page sip renders is `index.html` with its settings written into it. Keep
`{{FONT_FACE_EXTRA}}` in the head: the font rules, the renderer choice, the
touch key bar, the palette, `ExtraCSS` and `ExtraJS` all arrive through it.
Without it sip falls back to inserting them before `</head>` and logs a line
saying so. A page with neither is served as it is, and the log says that too.

The client needs one element, `<div id="terminal">`. A page without it gets a
console error and a status line, not a blank screen.

Everything else is optional. A page that drops the settings panel keeps its
terminal, and sip says in the console that the panel is missing.

### When the override breaks

A read that fails for any reason other than "no such file" is logged and sip
serves its own copy:

```
cannot read the override. Sip serves its own copy of this file  file=terminal.css err=...
```

A deployment whose asset directory lost its read permission gets a working
terminal and a line in the log, not a blank page.

## Config.Routes

URLs of your own, beside the terminal.

```go
cfg.Routes = []sip.Route{
    {Pattern: "/manifest.webmanifest", Handler: http.HandlerFunc(manifest)},
    {Pattern: "/brand/", Handler: http.StripPrefix("/brand/", http.FileServerFS(brand))},
}
```

`Pattern` is an `http.ServeMux` pattern, so a trailing slash makes it a
subtree.

**Every route is behind the same Basic Auth as the rest of the server.** Sip
cannot tell which of your URLs is safe to publish, so it treats them all as
private, the way it treats the static assets.

A pattern that names a path sip's own client needs is refused at startup, and
the refusal says which one: `/`, `/static/`, `/ws`, `/webtransport`, `/health`
and `/cert-hash`. `/favicon.ico` is not on that list. Sip answers it with 204
only because it has no icon to give, so a route may take it.

For the tab icon, reach for `Appearance.Favicon` first. It names a URL, so it
pairs with a file served from `StaticFS` and needs no route at all.

## A request never picks a file

`assetName` is the only place a request decides which asset to read. It
requires the `/static/` prefix, rejects `.`, rejects a backslash and runs
`fs.ValidPath`, which refuses `..`, a leading slash and an empty element. A
name that fails any of those is a 404 and never reaches your `fs.FS`.

Nothing else in the extension surface is driven by a request. `ExtraCSS`,
`ExtraJS`, `StaticFS` and `Routes` are all read once, from the config, before
the server binds a port.
