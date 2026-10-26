// Main-thread input for the worker engine. It turns DOM events into small
// messages; the worker encodes them with Ghostty's key and mouse encoders,
// which read the terminal's modes directly, and writes the bytes to the
// socket. Nothing here knows about escape sequences.

const SHIFT = 1, CTRL = 2, ALT = 4, SUPER = 8;
const ACTION = { release: 0, press: 1, repeat: 2 };

export function mods(ev) {
  return (ev.shiftKey ? SHIFT : 0) | (ev.ctrlKey ? CTRL : 0) | (ev.altKey ? ALT : 0) | (ev.metaKey ? SUPER : 0);
}

// The codepoint the key gives without shift, for the kitty protocol's
// "unshifted key" field and for ctrl chords.
function unshifted(ev, text) {
  if (ev.code.startsWith('Key')) return ev.code.charCodeAt(3) + 32;
  if (ev.code.startsWith('Digit')) return ev.code.charCodeAt(5);
  return text ? text.toLowerCase().codePointAt(0) : 0;
}

/**
 * Attach keyboard, IME, paste, focus, pointer and wheel handling.
 * post(msg) sends a message to the worker. cell() returns { cw, ch } in CSS
 * pixels. Returns a detach function.
 */
export function attachInput(host, canvas, post, opts = {}) {
  const ac = new AbortController();
  const on = (el, type, fn, o = {}) => el.addEventListener(type, fn, { ...o, signal: ac.signal });

  // A transparent textarea receives keys and IME composition. It sits over
  // the terminal so the IME window opens near the text.
  const ta = document.createElement('textarea');
  ta.setAttribute('autocapitalize', 'off');
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('autocorrect', 'off');
  ta.setAttribute('spellcheck', 'false');
  ta.setAttribute('aria-label', 'Terminal input');
  Object.assign(ta.style, { position: 'absolute', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', border: '0', padding: '0', resize: 'none', outline: 'none', overflow: 'hidden', zIndex: '-1' });
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.append(ta);

  let composing = false;
  const state = { selection: '' };
  // execCommand('copy') fires a copy event only when the document has a
  // selection, so give the hidden textarea one for the duration.
  const copyNow = () => {
    ta.value = state.selection;
    ta.select();
    const ok = document.execCommand('copy');
    ta.value = '';
    return ok;
  };
  const held = new Set(); // codes whose keydown we sent, so keyup follows

  on(ta, 'keydown', (ev) => {
    if (composing || ev.isComposing || ev.key === 'Process' || ev.key === 'Dead') return;
    if (opts.onKey && opts.onKey(ev) === false) return;
    // Paste shortcuts produce a paste event; leave them to the browser.
    if ((ev.metaKey || (ev.ctrlKey && ev.shiftKey)) && ev.code === 'KeyV') return;
    // Copy shortcuts with a selection produce a copy event. Without one,
    // ctrl+shift+c goes to the program like any other chord.
    if ((ev.metaKey || (ev.ctrlKey && ev.shiftKey)) && ev.code === 'KeyC' && state.selection) {
      copyNow();
      ev.preventDefault();
      return;
    }
    // Keep browser and OS shortcuts that use the platform key.
    if (ev.metaKey) return;
    ev.preventDefault();
    // A page with sticky modifiers (sip's phone key bar) folds them in here.
    const k = opts.keyFilter ? opts.keyFilter(ev) : ev;
    const text = [...k.key].length === 1 ? k.key : '';
    held.add(ev.code);
    post({ type: 'key', code: k.code, mods: mods(k), action: ev.repeat ? ACTION.repeat : ACTION.press, text, unshifted: unshifted(k, text), t: ev.timeStamp });
  });
  on(ta, 'keyup', (ev) => {
    if (!held.delete(ev.code)) return;
    post({ type: 'key', code: ev.code, mods: mods(ev), action: ACTION.release, text: '', unshifted: 0 });
  });
  on(ta, 'compositionstart', () => { composing = true; });
  on(ta, 'compositionend', (ev) => {
    composing = false;
    if (ev.data) post({ type: 'text', text: ev.data });
    ta.value = '';
  });
  // Soft keyboards and some IMEs insert text without a usable keydown.
  on(ta, 'input', (ev) => {
    if (composing || ev.inputType === 'insertCompositionText' || ev.inputType === 'insertFromComposition') return;
    if (ev.data) post({ type: 'text', text: opts.textFilter ? opts.textFilter(ev.data) : ev.data });
    ta.value = '';
  });
  on(ta, 'paste', (ev) => {
    ev.preventDefault();
    const text = ev.clipboardData?.getData('text/plain');
    if (text) post({ type: 'paste', text });
  });
  // The selected text is cached here (the worker sends it when a selection
  // ends), so the clipboard is filled inside the copy event itself. That
  // works on insecure origins, where the async clipboard API does not.
  on(document, 'copy', (ev) => {
    if (!state.selection || (document.activeElement !== ta && !host.contains(document.activeElement))) return;
    ev.clipboardData.setData('text/plain', state.selection);
    ev.preventDefault();
  });
  // IME preedit, drawn over the cursor cell while a composition is open.
  const pre = document.createElement('div');
  Object.assign(pre.style, { position: 'absolute', left: '0', top: '0', display: 'none', whiteSpace: 'pre', pointerEvents: 'none', zIndex: '2', textDecoration: 'underline', ...(opts.preeditStyle || {}) });
  host.append(pre);
  on(ta, 'compositionupdate', (ev) => { pre.textContent = ev.data || ''; pre.style.display = ev.data ? 'block' : 'none'; });
  on(ta, 'compositionend', () => { pre.textContent = ''; pre.style.display = 'none'; });
  on(ta, 'focus', () => post({ type: 'focus', focused: true }));
  on(ta, 'blur', () => { held.clear(); post({ type: 'focus', focused: false }); });

  // Pointer: mouse reports in CSS pixels relative to the canvas. The
  // worker decides whether the program wants them.
  let buttons = 0;
  const pos = (ev) => { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  const button = (b) => (b === 0 ? 1 : b === 1 ? 3 : b === 2 ? 2 : b + 5);
  // The mousedown default would move focus to the body after our focus()
  // call, and keys would stop reaching the textarea.
  on(canvas, 'mousedown', (ev) => ev.preventDefault());
  // Touch. A finger is not a mouse: a tap is a click (and raises the
  // keyboard through onTap), a swipe scrolls, a hold then move is a drag,
  // and a hold without moving is a right click. The same rules as sip's
  // touch layer (mobile.js), on our own pointer events.
  canvas.style.touchAction = 'none';
  const HOLD_MS = opts.longPressMs ?? 450, SLOP = opts.slopPx ?? 10;
  let touch = null;
  const touchPost = (action, button, p, pressed) => post({ type: 'pointer', action, button, mods: 0, x: p.x, y: p.y, pressed, t: performance.now() });
  on(canvas, 'pointerdown', (ev) => {
    if (ev.pointerType !== 'touch') return;
    ev.stopImmediatePropagation();
    canvas.setPointerCapture?.(ev.pointerId);
    const start = pos(ev);
    touch = { id: ev.pointerId, start, last: start, mode: 'none', held: false, acc: 0 };
    touch.timer = setTimeout(() => { if (touch && touch.mode === 'none') touch.held = true; }, HOLD_MS);
  }, { capture: true });
  on(canvas, 'pointermove', (ev) => {
    if (ev.pointerType !== 'touch' || !touch || ev.pointerId !== touch.id) return;
    ev.stopImmediatePropagation();
    const p = pos(ev);
    const moved = Math.hypot(p.x - touch.start.x, p.y - touch.start.y) > SLOP;
    if (touch.mode === 'none' && moved) {
      clearTimeout(touch.timer);
      touch.mode = touch.held ? 'drag' : 'pan';
      if (touch.mode === 'drag') touchPost(0, 1, touch.start, 1);
    }
    if (touch.mode === 'pan') {
      // Content follows the finger: dragging down shows older lines.
      touch.acc += (touch.last.y - p.y) / opts.cell().ch;
      const lines = Math.trunc(touch.acc);
      if (lines) { touch.acc -= lines; post({ type: 'wheel', lines, mods: 0, ...p }); }
    } else if (touch.mode === 'drag') touchPost(2, 1, p, 1);
    touch.last = p;
  }, { capture: true });
  const touchEnd = (ev) => {
    if (ev.pointerType !== 'touch' || !touch || ev.pointerId !== touch.id) return;
    ev.stopImmediatePropagation();
    clearTimeout(touch.timer);
    const p = touch.last;
    if (touch.mode === 'drag') touchPost(1, 1, p, 0);
    else if (touch.mode === 'none' && ev.type === 'pointerup') {
      if (touch.held) { touchPost(0, 2, p, 1); touchPost(1, 2, p, 0); }
      else { opts.onTap?.(); ta.focus({ preventScroll: true }); touchPost(0, 1, p, 1); touchPost(1, 1, p, 0); }
    }
    touch = null;
  };
  on(canvas, 'pointerup', touchEnd, { capture: true });
  on(canvas, 'pointercancel', touchEnd, { capture: true });

  on(canvas, 'pointerdown', (ev) => {
    ta.focus({ preventScroll: true });
    buttons |= 1 << ev.button;
    canvas.setPointerCapture?.(ev.pointerId);
    post({ type: 'pointer', action: 0, button: button(ev.button), mods: mods(ev), ...pos(ev), pressed: 1, t: ev.timeStamp });
  });
  on(canvas, 'pointerup', (ev) => {
    buttons &= ~(1 << ev.button);
    post({ type: 'pointer', action: 1, button: button(ev.button), mods: mods(ev), ...pos(ev), pressed: buttons ? 1 : 0, t: ev.timeStamp });
  });
  // Motion is sent at most once per animation frame.
  let move = null;
  on(canvas, 'pointermove', (ev) => {
    const b = buttons ? button(Math.log2(buttons & -buttons)) : 0;
    if (!move) requestAnimationFrame(() => { post(move); move = null; });
    move = { type: 'pointer', action: 2, button: b, mods: mods(ev), ...pos(ev), pressed: buttons ? 1 : 0, t: ev.timeStamp };
  });
  on(canvas, 'pointerleave', () => { if (!buttons) post({ type: 'pointer', action: 2, button: 0, mods: 0, x: -1, y: -1, pressed: 0, t: performance.now() }); });
  on(canvas, 'contextmenu', (ev) => ev.preventDefault());
  let wheelAcc = 0;
  on(canvas, 'wheel', (ev) => {
    ev.preventDefault();
    const px = ev.deltaMode === 1 ? ev.deltaY * opts.cell().ch : ev.deltaMode === 2 ? ev.deltaY * opts.cell().ch * 20 : ev.deltaY;
    wheelAcc += px / opts.cell().ch;
    const lines = Math.trunc(wheelAcc);
    if (!lines) return;
    wheelAcc -= lines;
    post({ type: 'wheel', lines, mods: mods(ev), ...pos(ev) });
  }, { passive: false });

  return {
    textarea: ta,
    focus: () => ta.focus({ preventScroll: true }),
    /** The worker's cursor moved: keep the IME window and preedit on it. */
    cursor(x, y) {
      const { cw, ch } = opts.cell();
      // A transform moves both without a layout pass.
      const t = `translate(${x * cw}px, ${y * ch}px)`;
      ta.style.transform = t;
      pre.style.transform = t;
      pre.style.height = pre.style.lineHeight = `${ch}px`;
    },
    setSelection(text) { state.selection = text; },
    copy: () => copyNow(),
    detach: () => { ac.abort(); ta.remove(); pre.remove(); },
  };
}
