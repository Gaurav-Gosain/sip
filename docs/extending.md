# Changing sip's page without forking it

Everything the browser runs is baked into sip's binary by `go:embed`. Until
these five options existed, changing one CSS rule meant vendoring seven files
and maintaining them forever.

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
sip.on('ready',      (e) => console.log('grid', e.cols, e.rows));
sip.on('connect',    (e) => banner.textContent = 'on ' + e.transport);
sip.on('disconnect', (e) => banner.textContent = 'off: ' + e.reason);
document.getElementById('restart').onclick = () => sip.send('\x03exec bash\n');
`
```

`window.sip` is what sip promises to keep. It is four calls and five events.

| Call | Does |
|---|---|
| `sip.on(name, fn)` | Listen. Returns a function that removes the listener. |
| `sip.off(name, fn)` | Stop listening. |
| `sip.send(data)` | Send input, as if it had been typed. Returns a promise. |
| `sip.size()` | `{cols, rows}`, or `null` before `ready`. |

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

### What is deliberately not in it

**The terminal object.** There is no `sip.term` in the promise, and that is the
whole design. Sip renders with xterm.js today and has two renderer branches in
flight. A handle to xterm's `Terminal` would be a promise sip plans to break,
and a broken promise reads as sip's bug in your users' eyes. Everything above
is answerable whatever renders the grid.

If you need something xterm-specific, open an issue and ask for a `Config`
field. That is the route sip maintains.

**The output stream.** No event carries what the program printed. It is a
firehose, it would tie sip to the exact shape of its output path, and a page
script that logs a terminal's output is a privacy hazard by accident.

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
