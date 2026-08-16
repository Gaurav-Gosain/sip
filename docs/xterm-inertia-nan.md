# xterm.js: an inertial fling reports `NaN` mouse coordinates

A writeup of an upstream xterm.js bug, kept here so it can be filed without
being rediscovered. sip works around it in `static/mobile.js`
(`TouchMouse.onChange`); the workaround is not a fix, and the bug affects every
xterm.js embedder that runs on a touch device.

**No upstream issue or PR exists for it** as of the check below.

## Summary

On a touch device, flicking the terminal while the program has mouse reporting
enabled sends mouse reports whose coordinates are the literal text `NaN`. A
shell fills with `NaN;NaNMaN;NaNM…`; a program that parses the report gets
garbage.

Measured: three flings put **534 mouse reports** on the wire and **489 of them**
were `\x1b[<65;NaN;NaNM`.

It needs a touch device (or Chrome's gesture synthesizer, below) and a program
that has enabled mouse reporting. It is invisible on a desktop and invisible
with mouse reporting off, which is presumably why it has survived.

### Affected versions

Present on **master** (`29a7384`, 2026-08-10) and on `@xterm/xterm@6.1.0-beta.290`.

**Not** in the `6.0.0` stable release: the consumer that feeds the event into
coordinate math, `_handleTouchScrollAsWheel`, arrived in PR
[#5685](https://github.com/xtermjs/xterm.js/pull/5685) ("Fix scrolling with
touch", merged 2026-03-11, part of issue
[#5377](https://github.com/xtermjs/xterm.js/issues/5377)), which post-dates
6.0.0. So this is a regression against the 6.1.0 line only, and #5377 is the
right thread to reference when filing.

## Root cause

Three guards, all of which fail open on `NaN`.

**1. The recognizer builds a coordinate-less event.**
`src/browser/scrollable/touch.ts`, `Gesture._inertia` (lines 412-443; the
dispatch is 434-437):

```ts
      const evt = this._newGestureEvent(EventType.CHANGE);
      evt.translationX = deltaPosX;
      evt.translationY = deltaPosY;
      dispatchTo.forEach(d => d.dispatchEvent(evt));
```

Contrast `_handleTouchMove` in the same file (lines 459-466), which is the same
event type built properly:

```ts
      const evt = this._newGestureEvent(EventType.CHANGE, data.initialTarget);
      evt.translationX = touch.pageX - tail(data.rollingPageX)!;
      evt.translationY = touch.pageY - tail(data.rollingPageY)!;
      evt.pageX = touch.pageX;
      evt.pageY = touch.pageY;
      evt.clientX = touch.clientX;
      evt.clientY = touch.clientY;
      this._dispatchEvent(evt);
```

`_newGestureEvent` (lines 359-365) makes a bare
`document.createEvent('CustomEvent')` and sets only `initialTarget` and
`tapCount`, so everything not assigned afterwards is `undefined`. `IGestureEvent`
(lines 150-159) declares `pageX`/`pageY`/`clientX`/`clientY` as non-optional
`number`, so the type checker does not see the omission.

Two consequences, not one: the inertial event also goes straight to
`dispatchTo` rather than through `Gesture._dispatchEvent`, so it carries
`initialTarget === undefined` and skips the `_ignoreTargets` filtering and
target-depth sorting that a `touchmove`-built event gets.

**2. The coordinate service returns `NaN` instead of failing.**
`src/browser/input/Mouse.ts`, `getCoordsRelativeToElement` (lines 6-15) is
arithmetic on `event.clientX`:

```ts
  return [
    event.clientX - rect.left - leftPadding,
    event.clientY - rect.top - topPadding
  ];
```

`undefined - number` is `NaN`. `src/browser/services/MouseCoordsService.ts`,
`getMouseReportCoords` (lines 33-46) then clamps and floors it, both of which
are `NaN`-transparent, and returns an **object**:

```ts
  public getMouseReportCoords(event: MouseEvent, element: HTMLElement): { col: number, row: number, x: number, y: number } | undefined {
    const coords = getCoordsRelativeToElement(getWindow(element), event, element);
    if (!this._charSizeService.hasValidSize) {
      return undefined;
    }
    coords[0] = Math.min(Math.max(coords[0], 0), this._renderService.dimensions.css.canvas.width - 1);
    coords[1] = Math.min(Math.max(coords[1], 0), this._renderService.dimensions.css.canvas.height - 1);
    return {
      col: Math.floor(coords[0] / this._renderService.dimensions.css.cell.width),
      row: Math.floor(coords[1] / this._renderService.dimensions.css.cell.height),
      x: Math.floor(coords[0]),
      y: Math.floor(coords[1])
    };
  }
```

Its only failure mode is an invalid char size. `{col: NaN, row: NaN, x: NaN,
y: NaN}` is a perfectly truthy return.

**3. Both remaining checks are comparisons.**
`src/browser/services/MouseService.ts`, `_handleTouchScrollAsWheel` (lines
341-372) guards on truthiness (354-357):

```ts
    const pos = this._mouseCoordsService.getMouseReportCoords(e, ctx.target.screenElement);
    if (!pos) {
      return;
    }
```

and `_triggerMouseEvent` (497-502) guards on range:

```ts
    if (e.col < 0 || e.col >= this._bufferService.cols
      || e.row < 0 || e.row >= this._bufferService.rows) {
      return false;
    }
```

Every comparison against `NaN` is false, so the whole rejecting condition is
false and the event goes to the encoder.

**Every encoding is affected, not just SGR.**
`src/common/services/MouseStateService.ts`:

- `SGR` (143-150) interpolates directly: `\x1b[<65;NaN;NaNM`.
- `SGR_PIXELS` does the same with `e.x`/`e.y`.
- `DEFAULT` (X10/normal, 127-137) computes `params[1] = NaN + 32` → `NaN`, and
  its `params[1] > 255` suppression is likewise false for `NaN`, so it emits
  `String.fromCharCode(NaN)` — a `NUL`. A program in the default encoding
  therefore receives `\x1b[M` followed by the button byte and two `NUL`s.

## Reproduction

Needs a touch device or Chrome's gesture synthesizer. `Input.dispatchTouchEvent`
is **not** enough: the fling is the recognizer's own animation loop, and only
real gesture timing starts one.

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

1. **`Gesture._inertia`** should carry a position, and this is nearly free: it
   already has one. Its `x` and `y` parameters are the running page position,
   seeded from the last touch and advanced by each frame's translation on the
   recursive call, and then never read. Writing them onto the event as
   `pageX`/`pageY`/`clientX`/`clientY`, and dispatching through
   `_dispatchEvent` with the `initialTarget` every other call site passes,
   makes the inertial event the same shape as the real one and fixes the
   `_ignoreTargets` bypass at the same time. This alone closes the bug.
2. **`getMouseReportCoords`** should return `undefined` for a non-finite
   result, which is what its callers already believe a falsy return means.
3. **`_triggerMouseEvent`** should reject a non-finite `col`/`row` explicitly
   rather than by comparison.

## Inherited from VS Code

`Gesture` comes from `microsoft/vscode`, `src/vs/base/browser/touch.ts`, which
has the identical omission: `inertia` (line 309, dispatch at 331-335) sets only
`translationX`/`translationY` while `onTouchMove` sets the coordinates too.
Only the identifiers were renamed on the way into xterm.

VS Code's own scroll consumers appear unaffected because they read nothing but
the translations — `pointerHandler.ts` `onChange` calls `deltaScrollNow(-e.translationX, -e.translationY)`.
xterm is the first consumer to feed the event into coordinate math, so the fix
belongs in xterm regardless of whether VS Code takes one too.

## What sip does instead

sip does not patch its vendored bundle. A capture-phase listener above the
screen element fills the missing coordinates in from the last place a finger
was actually seen, and drops the event outright if there is no such place. The
gesture events do not bubble and are dispatched at the screen element, so an
ancestor's capture listener is the only place this can be done from outside:
at the target itself, capture and bubble listeners run in registration order,
so xterm's own handler would still win.

See `static/mobile.js`, `TouchMouse.onChange`.
