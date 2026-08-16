# xterm.js: an inertial fling reports `NaN` mouse coordinates

This is a writeup of an upstream xterm.js bug, kept here so it can be filed
without being rediscovered. sip works around it in `static/mobile.js`
(`TouchMouse.onChange`); the workaround is not a fix, and the bug affects every
xterm.js embedder that runs on a touch device.

## Summary

On a touch device, flicking the terminal while the program has mouse reporting
enabled sends mouse reports whose coordinates are the literal text `NaN`. A
shell fills with `NaN;NaNMaN;NaNM…`; a program that parses the report gets
garbage or drops the connection.

Measured against a real xterm build, three flings put **534 mouse reports** on
the wire and **489 of them** were `\x1b[<65;NaN;NaNM`.

It needs a touch device (or Chrome's gesture synthesizer, below) and a program
that has enabled mouse reporting. It is invisible on a desktop and invisible in
mouse-mode-off terminals, which is presumably why it has survived.

## Root cause

Three pieces, each assuming another had checked. The code below is read out of
a shipped xterm build (the bundle vendored as sip's `static/webterm.js`) and
de-minified by hand, so the names are the surviving property names and the
locals are renamed for legibility. Anyone filing this should re-quote from
upstream source.

**1. The recognizer builds a coordinate-less event.** `Gesture`, inherited from
VS Code's `vs/base/browser/touch.ts`, dispatches `-xterm-gesturechange` from two
places. The one built in `_handleTouchMove` carries positions:

```js
const evt = this._newGestureEvent(EventType.CHANGE, data.initialTarget);
evt.translationX = touch.pageX - lastOf(data.rollingPageX);
evt.translationY = touch.pageY - lastOf(data.rollingPageY);
evt.pageX = touch.pageX;
evt.pageY = touch.pageY;
evt.clientX = touch.clientX;
evt.clientY = touch.clientY;
```

The one built in `_inertia`, which runs after the finger has left the glass,
does not:

```js
const evt = this._newGestureEvent(EventType.CHANGE);
evt.translationX = deltaX;
evt.translationY = deltaY;
targets.forEach(t => t.dispatchEvent(evt));
```

No `pageX`, no `pageY`, no `clientX`, no `clientY`, and no `initialTarget`
either — `_newGestureEvent` is called with one argument where every other call
site passes two.

**2. The coordinate service returns `NaN` instead of failing.**
`getMouseReportCoords` reaches a helper that is arithmetic on `event.clientX`:

```js
return [event.clientX - rect.left - paddingLeft, event.clientY - rect.top - paddingTop];
```

`undefined - number` is `NaN`, and the method then returns an **object**, whose
only guard is `hasValidSize` on the char size service:

```js
if (this._charSizeService.hasValidSize) {
  ...
  return {
    col: Math.floor(coords[0] / cell.width),
    row: Math.floor(coords[1] / cell.height),
    x: Math.floor(coords[0]),
    y: Math.floor(coords[1]),
  };
}
```

`{col: NaN, row: NaN, x: NaN, y: NaN}` — truthy.

**3. The caller's guard is a truthiness check.**
`_handleTouchScrollAsWheel` does exactly what the code above invites:

```js
const pos = this._mouseCoordsService.getMouseReportCoords(ev, target.screenElement);
if (pos) {
  for (let i = 0; i < Math.abs(amount); i++) {
    this._triggerMouseEvent({ col: pos.col, row: pos.row, x: pos.x, y: pos.y, button: 4, ... });
  }
}
```

`_triggerMouseEvent`'s own range checks are all comparisons — `col < 0`,
`col >= cols`, `row < 0`, `row >= rows` — and every comparison against `NaN` is
false, so the whole rejecting condition evaluates false and nothing stops it.
The encoder interpolates the numbers into the report and it goes out.

Any one of the three would have stopped it.

## Reproduction

Needs a touch device or Chrome's gesture synthesizer. `Input.dispatchTouchEvent`
is **not** enough: the fling is the recognizer's, and only real gesture timing
produces one.

```html
<!doctype html>
<div id="t" style="width: 100vw; height: 100vh"></div>
<script type="module">
  import { Terminal } from '@xterm/xterm';
  const term = new Terminal();
  term.open(document.getElementById('t'));
  term.onData(d => { if (d.includes('NaN')) console.error('NaN report:', JSON.stringify(d)); });
  // What a full-screen program asks for: click, drag, SGR encoding.
  term.write('\x1b[?1000;1002;1006h');
</script>
```

Open it on a phone and flick the terminal. Or, over the DevTools protocol:

```js
await cdp.send('Input.synthesizeScrollGesture', {
  x, y, xDistance: 0, yDistance: -260,
  speed: 6000, gestureSourceType: 'touch', preventFling: false,
});
```

sip's own version of this, asserting at the transport boundary and counting the
reports, is `clienttests/touch.spec.mjs`, "an inertial fling never reports a NaN
coordinate".

## Suggested fix

Any of the three layers would do, and doing more than one is not wasteful given
how quietly this failed:

1. **`Gesture._inertia`** should carry a position, and this is close to free:
   it already has one. Its 6th and 9th parameters are the running page
   position, seeded from the last touch and advanced by each frame's
   translation on the recursive call (`positionX + translationX`,
   `positionY + translationY`) — and then never read. Writing them onto the
   event as `pageX`/`pageY` and `clientX`/`clientY`, and passing the
   `initialTarget` that every other `_newGestureEvent` call site passes, makes
   the inertial event the same shape as the real one. This is the fix that
   makes the other two unnecessary.
2. **`getMouseReportCoords`** should return `undefined` when the arithmetic
   produced a non-finite number, which is what its callers already believe a
   falsy return means.
3. **`_triggerMouseEvent`** should reject a non-finite `col`/`row` explicitly
   rather than relying on comparisons, which silently pass everything.

## What sip does instead

sip does not patch the vendored bundle. A capture-phase listener above the
screen element fills the missing coordinates in from the last place a finger
was actually seen, and drops the event outright if there is no such place. The
gesture events do not bubble and are dispatched at the screen element, so an
ancestor's capture listener is the only place this can be done from outside:
at the target itself, capture and bubble listeners run in registration order,
so xterm's own handler would still win.

See `static/mobile.js`, `TouchMouse.onChange`.
