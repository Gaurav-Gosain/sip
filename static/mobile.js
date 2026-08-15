// Touch support for the sip web client: a key bar, keyboard-aware layout, and
// draggable page controls.
//
// A phone keyboard has no Esc, no Tab, no Ctrl and no arrows, which is most of
// what a terminal is driven with, and when it opens it covers the bottom half
// of the terminal it was opened for. This file fixes both, and it is
// deliberately standalone: it imports nothing, injects its own styles, builds
// its own DOM, and talks to the terminal through one plain object. Drop it into
// any page that has a terminal in it.
//
// Loaded as a classic script, publishing window.SipMobile. It has no imports
// and no exports, so `import './mobile.js'` works too and leaves the same
// global behind.
//
// ---------------------------------------------------------------------------
// installKeyBar(host, options)
// ---------------------------------------------------------------------------
//
// host provides:
//
//   send(text)        write terminal input bytes, as a string.
//   focusTarget()     the element that holds the software keyboard up, or null.
//                     For xterm.js that is term.textarea. Without one there is
//                     no keyboard to raise, so the bar leaves out its keyboard
//                     key and never tries to keep focus.
//   isReady()         optional. False while the terminal is not accepting
//                     input; defaults to always ready.
//   encodeKey(spec, mods)  optional. Encode one key spec as input bytes, or
//                     null for a key that produces nothing. Hosts that own a
//                     key encoder of their own pass it here; everyone else gets
//                     encodeKeySpec below, which covers the default key set.
//
// options:
//
//   keys      the typing row of the bar. Defaults to DEFAULT_KEYS. Each entry
//             is { label, title, key, code, ctrl, alt, shift, narrow, id } for
//             a key, or { label, title, mod: 'ctrl' | 'alt' } for a sticky
//             modifier. key is a KeyboardEvent key name ('Escape',
//             'ArrowLeft', 'PageUp') or a literal character; code is the
//             KeyboardEvent code, unused by the default encoder and passed
//             through for hosts that encode from a keymap; ctrl, alt and shift
//             are modifiers the button carries itself, on top of whatever the
//             bar has armed.
//   actions   appended to the last row behind a divider and tinted apart:
//             entries of { label, title, run, id, narrow } whose run() is
//             called inside the tap gesture. This is where a page puts its own
//             controls. Empty by default.
//   rows      full control of the layout, for a key set that has outgrown one
//             strip: an array of { label, keys, collapsible, id }, drawn top
//             to bottom, with the typing row conventionally last because it is
//             the one nearest the thumb that is already on the software
//             keyboard. Given rows, `keys` is ignored and `actions` still
//             joins the last row. A collapsible row can be folded away by a
//             control pinned to the right of the bar, and whether it is folded
//             is remembered.
//   prefix    the leader chord this deployment is driven by, as
//             { key, code, ctrl, alt, shift }: tmux's Ctrl+B, screen's Ctrl+A,
//             emacs's Ctrl+X. It powers two kinds of button, and without it
//             both degrade to nothing rather than to something wrong:
//               { prefix: true }     arms the chord and lights up until the
//                                    next key goes out, so the second half can
//                                    be typed on the software keyboard. Left
//                                    out of the bar when no prefix is set.
//               { prefixed: true, key: 'c' }
//                                    one tap sends the leader and then a bare
//                                    'c'. With no prefix set it sends the key
//                                    on its own.
//   keyboardKey  false to leave out the pinned show/hide keyboard key.
//   keyBar    false to leave the strip out altogether and keep only the
//             keyboard-aware layout and the sticky modifiers, for a page that
//             draws touch controls of its own.
//   storagePrefix  namespace for what the bar remembers. Defaults to 'sip'.
//
// It returns a controller with:
//
//   .enabled          whether the bar installed at all (touch devices only).
//   .mods             { ctrl, alt }: 0 off, 1 armed for one key, 2 locked.
//   .transformInput(text)  fold the armed modifiers into terminal input the
//                     host is about to send, and consume the one-shot ones.
//                     For hosts whose terminal does its own key encoding, which
//                     is the only place their keystrokes are still visible.
//   .wrapKey(event)   the same thing one level up, for hosts that encode key
//                     events themselves: returns an event-shaped object with
//                     the armed modifiers folded in. Use one or the other.
//   .setState(id, state)  mark a bar button '', 'active', 'armed' or 'locked'.
//                     For an action that has a state of its own.
//   .prefixPending    whether the leader has been sent and the program is
//                     waiting for the key that finishes the chord.
//   .sendPrefix()     send the leader chord. False when none is configured.
//   .setRowsOpen(bool)  fold or unfold the collapsible rows.
//   .focusInput()     raise the software keyboard. Must be in a user gesture.
//   .destroy()
//
// And it publishes two CSS custom properties on the document element:
//
//   --sip-kb-inset    height of the software keyboard, or 0px.
//   --sip-keybar-h    height of the key bar, or 0px.
//
// The page decides what to do with them. sip's terminal.css does the obvious
// thing:
//
//   #terminal-container { padding-bottom: calc(var(--sip-kb-inset) + var(--sip-keybar-h)); }
//
// which makes the terminal's own ResizeObserver fire, which is how the grid
// gets resized. Nothing in this file knows about the terminal.
//
// Body classes for page styling: sip-touch while the bar is up, sip-kb-open
// while the software keyboard is open.
(function () {
    'use strict';

    // A swipe across the bar has to travel further than this before it stops
    // being a tap. The bar is a scroller, so the finger is expected to move,
    // and a button that fires while the user is flicking past it is worse than
    // one that needs a second try.
    const BAR_TAP_SLOP_PX = 12;

    // The bar keeps moving after a flick, and this is how it stops: velocity
    // times this every frame. About a third of a second of travel from a hard
    // flick, which crosses the bar without feeling like it is drifting.
    const BAR_GLIDE_DECAY = 0.94;

    // Pixels per millisecond below which a glide has stopped.
    const BAR_GLIDE_MIN_V = 0.02;

    // A keyboard that vanishes within this long of a bar gesture ending, while
    // the focus target still holds focus, was taken away by the browser rather
    // than by the user, and is asked for again. See armKeyboardRescue.
    const KB_RESCUE_MS = 700;

    // Below this an inset is browser chrome moving, not a keyboard. Acting on
    // those would make the terminal twitch every time the URL bar slides.
    const INSET_MIN_PX = 48;

    // And no keyboard is taller than this share of the window. A larger reading
    // is a bad measurement, and clamping it means a wrong guess costs some
    // wasted space rather than a terminal squeezed to nothing.
    const INSET_MAX_FRACTION = 0.72;

    // Pointer travel that turns a press on a draggable control into a drag.
    // Small enough that moving it feels immediate, large enough that a click
    // with an unsteady hand is still a click.
    const DRAG_SLOP_PX = 4;

    // Keys that carry no input of their own, so pressing one must not consume
    // an armed one-shot modifier.
    const BARE_MODIFIERS = new Set([
        'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock',
        'AltGraph', 'Dead', 'Unidentified',
    ]);

    /**
     * The keys a phone keyboard does not have, or hides two layers deep.
     *
     * Whatever is first here is what a narrow phone shows without scrolling, so
     * the order is the priority order. Everything in it is a key any terminal
     * program understands; nothing here assumes anything about what is running.
     */
    // The code and shift fields are not read by encodeKeySpec, which works
    // from key alone. They are here because a host may substitute an encoder
    // of its own, and a keymap encoder derives the character from code plus
    // the shift state rather than from the key name, so a table without them
    // is unusable at exactly the extension point this file advertises.
    const DEFAULT_KEYS = [
        { label: 'esc', title: 'Escape', key: 'Escape', code: 'Escape' },
        { label: 'tab', title: 'Tab', key: 'Tab', code: 'Tab' },
        { label: 'ctrl', title: 'Ctrl (tap to arm, tap again to lock)', mod: 'ctrl' },
        { label: 'alt', title: 'Alt (tap to arm, tap again to lock)', mod: 'alt' },
        { label: '←', title: 'Left', key: 'ArrowLeft', code: 'ArrowLeft', narrow: true },
        { label: '↓', title: 'Down', key: 'ArrowDown', code: 'ArrowDown', narrow: true },
        { label: '↑', title: 'Up', key: 'ArrowUp', code: 'ArrowUp', narrow: true },
        { label: '→', title: 'Right', key: 'ArrowRight', code: 'ArrowRight', narrow: true },
        { label: '/', title: 'Slash', key: '/', code: 'Slash', narrow: true },
        { label: '-', title: 'Minus', key: '-', code: 'Minus', narrow: true },
        { label: '|', title: 'Pipe', key: '|', code: 'Backslash', shift: true, narrow: true },
        { label: ':', title: 'Colon', key: ':', code: 'Semicolon', shift: true, narrow: true },
    ];

    // Pinned to the right of the bar, outside the scrollers: the way back to
    // the software keyboard has to be reachable from wherever any row is
    // scrolled to.
    const KEYBOARD_KEY = {
        label: 'abc', title: 'Show or hide the software keyboard', keyboard: true,
    };

    // Pinned above it, and folds the collapsible rows away.
    //
    // A second row over a software keyboard costs about three rows of terminal
    // on a phone, and for a user who only types it is a row they never touch.
    // Only the rows a deployment marks collapsible fold: the typing row is why
    // the bar exists at all, and a chord row is still reachable through the
    // prefix key and the software keyboard.
    const FOLD_KEY = {
        label: '▾', title: 'Hide the extra rows', fold: true, narrow: true,
    };

    const STYLE = `
:root {
  /* env() is the VirtualKeyboard API's own answer and the right default. JS
     overwrites both of these whenever it has a measurement of its own. */
  --sip-kb-inset: env(keyboard-inset-height, 0px);
  --sip-keybar-h: 0px;
}
body.sip-touch {
  overscroll-behavior: none;
  -webkit-text-size-adjust: 100%;
}
#sip-keybar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: var(--sip-kb-inset);
  z-index: 1004;
  display: flex;
  align-items: stretch;
  gap: 3px;
  padding: 3px 3px calc(3px + env(safe-area-inset-bottom, 0px));
  background: rgba(24, 24, 37, 0.96);
  border-top: 1px solid #45475a;
  /* The bar is chrome, and none of it is the browser's to interpret: no
     zooming, no callouts, no page scrolling, and above all no native scrolling
     of the strip itself, which is what used to take the software keyboard down
     with it. The strip is panned by hand instead; see installBarTouch. */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
body.sip-kb-open #sip-keybar {
  padding-bottom: 3px;
}
/* The rows stack, and they stack upwards: the last row declared sits at the
   bottom, nearest the thumb, and folding a row above it leaves it where it
   was. A row that moved when another one folded would put the key under the
   finger somewhere else between one tap and the next. */
#sip-keybar-rows {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 3px;
}
/* Each scroller is wrapped so the edge fades can be positioned against
   something that does not scroll with the buttons. */
.sip-keybar-row {
  position: relative;
  min-width: 0;
}
#sip-keybar.folded .sip-keybar-row.collapsible {
  display: none;
}
/* hidden, not auto: this box is scrolled, but only ever by assigning
   scrollLeft. An overflow: hidden box still honours that, while offering the
   browser no gesture to take over and no scroll container to attach its own
   keyboard-dismissing behaviour to. It also keeps touch-action: none applying
   to the whole bar, since both engines reset the inherited touch-action at an
   element that is scrollable by the user and this one is not. */
.sip-keybar-scroll {
  display: flex;
  align-items: center;
  gap: 3px;
  overflow: hidden;
  touch-action: none;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.sip-keybar-scroll::-webkit-scrollbar {
  display: none;
}
/* Something is off the edge in that direction. Set on build and on every pan,
   so a bar that overflows says so on the first frame rather than only once it
   has been touched. */
.sip-keybar-row::before,
.sip-keybar-row::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 22px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
}
.sip-keybar-row::before {
  left: 0;
  background: linear-gradient(to right, rgba(24, 24, 37, 0.98), rgba(24, 24, 37, 0));
}
.sip-keybar-row::after {
  right: 0;
  background: linear-gradient(to left, rgba(24, 24, 37, 0.98), rgba(24, 24, 37, 0));
}
.sip-keybar-row.more-left::before,
.sip-keybar-row.more-right::after {
  opacity: 1;
}
#sip-keybar .sep {
  flex: 0 0 auto;
  width: 1px;
  align-self: center;
  height: 24px;
  margin: 0 2px;
  background: #585b70;
}
#sip-keybar button {
  flex: 0 0 auto;
  min-width: 40px;
  height: 38px;
  border: 1px solid #45475a;
  border-radius: 6px;
  background: #313244;
  color: #cdd6f4;
  font-family: 'JetBrainsMono Nerd Font Mono', ui-monospace, monospace;
  font-size: 13px;
  line-height: 1;
  padding: 0 6px;
  cursor: pointer;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  /* A tap that selects the label, or that the browser treats as a possible
     double-tap or the start of a scroll, is a tap that can move focus off the
     element the software keyboard is riding on. Swiping across the buttons
     still works: the bar pans itself. */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
#sip-keybar button.narrow {
  min-width: 34px;
  padding: 0 4px;
}
/* Actions are not keys: they do not type, and one of them may well close
   something. Tinting them apart is the cheapest way to say so in a strip this
   small. */
#sip-keybar button.action {
  background: #292a3d;
  border-color: #585b70;
  color: #b4befe;
}
/* .pressed is the touch half of :active. A touch sequence that is cancelled at
   touchstart, which is what keeps the keyboard up, is also a touch sequence the
   browser will not draw an active state for, so the bar draws its own. */
#sip-keybar button:active,
#sip-keybar button.pressed {
  background: #45475a;
}
/* Pinned, so these survive however far any row is scrolled. They stack in the
   same direction the rows do, so the keyboard key stays on the bottom line
   next to the typing row whether or not anything above it is folded. */
#sip-keybar-pin {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 3px;
  padding-left: 4px;
  border-left: 1px solid #45475a;
  touch-action: none;
}
#sip-keybar button.fold {
  font-size: 16px;
}
/* Folded, the pin lies down. Left stacked it would hold the bar at its
   two-row height and the fold would give no space back, which is the whole
   reason to fold. */
#sip-keybar.folded #sip-keybar-pin {
  flex-direction: row;
}
#sip-keybar button.active {
  background: #45475a;
  color: #f9e2af;
  border-color: #f9e2af;
}
/* Armed for one keystroke: outlined. Locked until tapped off: filled. The two
   have to be told apart at a glance or a locked Ctrl silently eats the rest of
   what gets typed. */
#sip-keybar button.armed {
  background: #313244;
  color: #f9e2af;
  border-color: #f9e2af;
}
#sip-keybar button.locked {
  background: #f9e2af;
  color: #1e1e2e;
  border-color: #f9e2af;
}
`;

    // --- key encoding -------------------------------------------------------

    // The named keys the default bar can send, as their unmodified bytes and,
    // where one exists, the CSI final byte a modified press uses instead.
    // Anything not in here is treated as a literal character.
    const NAMED_KEYS = {
        Escape: { bytes: '\x1b' },
        Tab: { bytes: '\t' },
        Enter: { bytes: '\r' },
        Backspace: { bytes: '\x7f' },
        Delete: { bytes: '\x1b[3~', csi: '~', param: '3' },
        Insert: { bytes: '\x1b[2~', csi: '~', param: '2' },
        ArrowUp: { bytes: '\x1b[A', csi: 'A' },
        ArrowDown: { bytes: '\x1b[B', csi: 'B' },
        ArrowRight: { bytes: '\x1b[C', csi: 'C' },
        ArrowLeft: { bytes: '\x1b[D', csi: 'D' },
        Home: { bytes: '\x1b[H', csi: 'H' },
        End: { bytes: '\x1b[F', csi: 'F' },
        PageUp: { bytes: '\x1b[5~', csi: '~', param: '5' },
        PageDown: { bytes: '\x1b[6~', csi: '~', param: '6' },
    };

    /** xterm's modifier parameter: 1 plus a bitmask of shift, alt and ctrl. */
    function modifierParam(mods) {
        return 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
    }

    /**
     * The control byte a character produces when Ctrl is held.
     *
     * The classic table: a letter is masked to its low five bits, and the seven
     * punctuation marks that sit next to the letters in ASCII produce the
     * remaining control codes. Anything else has no control form, so the
     * character is sent as itself rather than being swallowed.
     */
    function ctrlByte(ch) {
        const c = ch.toUpperCase().charCodeAt(0);
        if (c >= 0x41 && c <= 0x5f) return String.fromCharCode(c & 0x1f);
        if (ch === ' ') return '\x00';
        if (ch === '?') return '\x7f';
        return ch;
    }

    /**
     * Encode one key spec as terminal input.
     *
     * This is the default host.encodeKey: enough for the default key set and
     * for anything else built out of named keys and literal characters. A host
     * with a key encoder of its own (a kitty keyboard protocol encoder, say)
     * passes that instead and this is never called.
     */
    function encodeKeySpec(spec, mods) {
        const m = {
            ctrl: !!(mods && mods.ctrl),
            alt: !!(mods && mods.alt),
            shift: !!(mods && mods.shift) || !!spec.shift,
        };
        const named = NAMED_KEYS[spec.key];
        if (named) {
            const param = modifierParam(m);
            if (param > 1 && named.csi) {
                return `\x1b[${named.param || '1'};${param}${named.csi}`;
            }
            // Escape, Tab, Enter and Backspace have no CSI form. Alt still
            // prefixes them, which is what every terminal does with Meta.
            return (m.alt ? '\x1b' : '') + named.bytes;
        }
        if (typeof spec.key !== 'string' || spec.key.length === 0) return null;
        const ch = m.ctrl ? ctrlByte(spec.key) : spec.key;
        return (m.alt ? '\x1b' : '') + ch;
    }

    // A bare arrow or Home/End, as sent by a terminal that has not been told
    // about a modifier. Rewritten in place when the bar has one armed.
    const BARE_CSI = /^\x1b(?:\[|O)([A-DHF])$/;

    /** Touch device, or an explicit ?mobile=1 / ?mobile=0 override for testing. */
    function detectTouch() {
        try {
            const forced = new URLSearchParams(location.search).get('mobile');
            if (forced === '1') return true;
            if (forced === '0') return false;
        } catch (e) {
            /* no location */
        }
        const coarse = typeof matchMedia === 'function'
            && matchMedia('(pointer: coarse)').matches;
        const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
        return !!(coarse && touch);
    }

    /**
     * The font size to start at.
     *
     * On a phone the choice is between columns and legibility and there is no
     * setting that wins both. This keeps the configured default everywhere
     * except a narrow touch viewport, where it steps down by a point so the
     * program gets a few more columns without the text becoming a texture. It
     * is skipped once the user has picked a size of their own.
     */
    function pickFontSize(defaultPx, userChose) {
        if (userChose || !detectTouch()) return defaultPx;
        const w = Math.min(window.innerWidth || 0, window.innerHeight || 0);
        if (!w || w >= 600) return defaultPx; // tablet: the desktop size fits
        return Math.min(defaultPx, 13);
    }

    class KeyBar {
        constructor(host, options) {
            this.host = host;
            this.options = options || {};
            this.enabled = false;
            this.mods = { ctrl: 0, alt: 0 }; // 0 off, 1 armed for one key, 2 locked
            // The leader chord this deployment is driven by, and whether it is
            // currently armed. See sendPrefix.
            this.prefix = this.options.prefix || null;
            this.prefixPending = false;
            this.inset = 0;
            this.listeners = [];
            this.buttons = new Map(); // id -> button
            // The bar's rows, top first, each { el, scroll, collapsible }.
            this.rows = [];
            this.rowsOpen = true;
            // The frame a flick is being carried on, and the deadline after a
            // gesture within which a keyboard that vanishes is assumed to have
            // been taken rather than dismissed. See installBarTouch and
            // armKeyboardRescue.
            this.glideFrame = 0;
            this.rescueUntil = 0;
            this.encode = typeof host.encodeKey === 'function' ? host.encodeKey : encodeKeySpec;
            this.storeKey = `${this.options.storagePrefix || 'sip'}.keybar.rows`;
        }

        install() {
            this.enabled = true;
            document.body.classList.add('sip-touch');
            this.injectStyle();
            // keyBar: false leaves out the strip but keeps everything else: a
            // page with touch controls of its own still wants the software
            // keyboard measured and reserved, and still wants the sticky
            // modifiers it can drive from those controls.
            if (this.options.keyBar !== false) this.buildBar();
            this.installViewport();
            this.measureBar();
            return this;
        }

        on(target, type, fn, opts) {
            target.addEventListener(type, fn, opts);
            this.listeners.push([target, type, fn, opts]);
        }

        injectStyle() {
            const el = document.createElement('style');
            el.id = 'sip-mobile-style';
            el.textContent = STYLE;
            document.head.appendChild(el);
            this.styleEl = el;
        }

        ready() {
            return typeof this.host.isReady === 'function' ? !!this.host.isReady() : true;
        }

        /**
         * Whether transformInput has anything to do.
         *
         * A host that decodes its outbound bytes to call transformInput needs
         * a way to skip that on the common path, and this is it. It lives here
         * rather than in the host because the list of things the bar might be
         * holding is the bar's to know: the host that re-derived it missed the
         * leader latch when that was added, and swallowed it silently.
         */
        get pending() {
            return this.mods.ctrl > 0 || this.mods.alt > 0 || this.prefixPending;
        }

        focusEl() {
            return typeof this.host.focusTarget === 'function' ? this.host.focusTarget() : null;
        }

        // --- sticky modifiers -----------------------------------------------

        /**
         * Fold the armed modifiers into terminal input on its way out.
         *
         * On a touch screen you cannot hold Ctrl and press a letter, so Ctrl is
         * a state rather than a held key: one tap arms it for the next
         * keystroke, a second tap locks it until tapped off. A host whose
         * terminal does its own key encoding has no key event left to modify by
         * the time it can see the keystroke, so it modifies the bytes instead,
         * which is what this does. With nothing armed it returns what it was
         * given.
         *
         * Only a single character and a single bare cursor key are rewritten,
         * and only those consume the armed modifier. Everything else that
         * reaches the input path is not a keystroke at all: a mouse report, a
         * paste, a reply to a device query. Spending an armed Ctrl on one of
         * those would take it away from the key the user is about to press.
         */
        transformInput(text) {
            if (!this.mods.ctrl && !this.mods.alt && !this.prefixPending) return text;
            if (typeof text !== 'string' || text.length === 0) return text;
            const mods = { ctrl: this.mods.ctrl > 0, alt: this.mods.alt > 0, shift: false };

            // The same test decides both questions. What counts as a keystroke
            // for spending an armed modifier is what counts as the key that
            // finishes a leader chord, and everything else on this path is a
            // mouse report, a paste or a device-query reply.
            const chars = Array.from(text);
            if (chars.length === 1) {
                this.consumeOneShot();
                this.setPrefixPending(false);
                const ch = mods.ctrl ? ctrlByte(chars[0]) : chars[0];
                return (mods.alt ? '\x1b' : '') + ch;
            }
            const bare = BARE_CSI.exec(text);
            if (bare) {
                this.consumeOneShot();
                this.setPrefixPending(false);
                return `\x1b[1;${modifierParam(mods)}${bare[1]}`;
            }
            return text;
        }

        /**
         * The same fold one level up, for a host that encodes key events
         * itself: returns an event-shaped object with the armed modifiers in
         * it. Returns the event unchanged when nothing is armed, so on a
         * desktop it costs two property reads.
         */
        wrapKey(e) {
            if (BARE_MODIFIERS.has(e.key)) return e;
            // Before the early exit, so a key typed on the software keyboard
            // clears the leader light whether or not a modifier is armed.
            if (this.prefixPending) this.setPrefixPending(false);
            if (!this.mods.ctrl && !this.mods.alt) return e;
            const shim = {
                key: e.key,
                code: e.code,
                ctrlKey: e.ctrlKey || this.mods.ctrl > 0,
                altKey: e.altKey || this.mods.alt > 0,
                shiftKey: !!e.shiftKey,
                metaKey: !!e.metaKey,
            };
            this.consumeOneShot();
            return shim;
        }

        consumeOneShot() {
            let changed = false;
            for (const name of ['ctrl', 'alt']) {
                if (this.mods[name] === 1) {
                    this.mods[name] = 0;
                    changed = true;
                }
            }
            if (changed) this.refreshMods();
        }

        cycleMod(name) {
            this.mods[name] = (this.mods[name] + 1) % 3;
            this.refreshMods();
        }

        clearMods() {
            this.mods.ctrl = 0;
            this.mods.alt = 0;
            this.refreshMods();
        }

        refreshMods() {
            for (const [name, btn] of Object.entries(this.modButtons || {})) {
                btn.classList.toggle('armed', this.mods[name] === 1);
                btn.classList.toggle('locked', this.mods[name] === 2);
            }
        }

        // --- the bar ---------------------------------------------------------

        /**
         * The rows to draw, as declared or as inferred from the older
         * single-row options.
         *
         * A deployment that says nothing gets one row of DEFAULT_KEYS, which
         * is what this file did before rows existed. Whatever the source, the
         * page's own `actions` join the last row behind a divider, because
         * that row is the one at thumb height.
         */
        resolveRows() {
            const declared = Array.isArray(this.options.rows) && this.options.rows.length
                ? this.options.rows
                : [{ keys: this.options.keys || DEFAULT_KEYS }];
            const rows = declared
                .map((row) => ({ ...row, keys: (row.keys || []).filter((s) => this.usable(s)) }))
                .filter((row) => row.keys.length);
            const actions = this.options.actions || [];
            if (actions.length) {
                const last = rows[rows.length - 1] || { keys: [] };
                if (!rows.length) rows.push(last);
                last.keys = last.keys.concat(
                    [{ sep: true }],
                    actions.map((s) => ({ ...s, action: true })),
                );
            }
            return rows;
        }

        /**
         * Whether a button can do anything here.
         *
         * A prefix key with no prefix configured is the one button that would
         * be a lie: it would light up and arm a chord that is never sent. It
         * is left out instead, so a key set written for a leader-driven
         * program degrades to its plain keys rather than to a dead control.
         */
        usable(spec) {
            return !(spec.prefix && !this.prefix);
        }

        buildBar() {
            const bar = document.createElement('div');
            bar.id = 'sip-keybar';
            bar.setAttribute('role', 'toolbar');
            bar.setAttribute('aria-label', 'Terminal keys');
            this.modButtons = {};
            // Which button is which key. The touch handling is one delegated
            // set of listeners on the bar rather than a set per button, because
            // a pan starts wherever the thumb lands: on a button, on the
            // divider, in a 3px gap.
            this.specs = new Map();

            const rowsEl = document.createElement('div');
            rowsEl.id = 'sip-keybar-rows';
            const declared = this.resolveRows();
            declared.forEach((row, i) => this.buildRow(rowsEl, row, i));
            bar.appendChild(rowsEl);

            const pin = document.createElement('div');
            pin.id = 'sip-keybar-pin';
            if (this.rows.some((r) => r.collapsible)) {
                pin.appendChild(this.buildButton(FOLD_KEY));
            }
            if (this.options.keyboardKey !== false && this.focusEl()) {
                pin.appendChild(this.buildButton(KEYBOARD_KEY));
            }
            if (pin.childElementCount) bar.appendChild(pin);

            // Anything inside the bar that manages to take focus takes the
            // software keyboard down with it, and this fires inside the gesture
            // that did it, so asking for focus back still counts as
            // user-initiated.
            this.on(bar, 'focusin', () => this.keepFocus());
            // The default action of a press is "focus what was pressed, or
            // clear focus if it is not focusable", and that is the keyboard
            // gone. The buttons cancel it themselves; this is for everything
            // else in the bar, which is to say the dividers, the gaps and the
            // padding around the strip. Capture, because a stray listener that
            // stops propagation must not be able to open the hole again.
            const swallow = (e) => e.preventDefault();
            this.on(bar, 'mousedown', swallow, { capture: true });
            this.on(bar, 'contextmenu', swallow, { capture: true });
            this.on(bar, 'dragstart', swallow, { capture: true });

            (this.options.container || document.body).appendChild(bar);
            this.bar = bar;
            this.installBarTouch();
            if (typeof ResizeObserver === 'function') {
                this.barObserver = new ResizeObserver(() => {
                    this.measureBar();
                    this.refreshScrollHints();
                });
                this.barObserver.observe(bar);
            }
            for (const row of this.rows) {
                this.on(row.scroll, 'scroll', () => this.refreshScrollHints(), { passive: true });
                // A trackpad or a mouse wheel on a touch laptop, where the bar
                // exists but nothing ever touches it. The box has no scrollbar
                // and no native scrolling of its own, so this is the only way
                // it moves without a finger.
                this.on(row.scroll, 'wheel', (e) => {
                    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
                    if (!d) return;
                    e.preventDefault();
                    this.panBy(row.scroll, d);
                }, { passive: false });
                if (this.barObserver) this.barObserver.observe(row.scroll);
            }
            this.applyRowsOpen(this.readRowsOpen());
            this.refreshScrollHints();
        }

        /**
         * One row: a wrapper the edge fades hang off, and the box that is
         * panned.
         *
         * The buttons are appended flat rather than in group elements: a
         * wrapper would need display:contents to keep the flex layout, and a
         * box with no box of its own is exactly the thing screen readers
         * disagree about. The grouping is carried by the row, the divider, the
         * tint and the labels.
         */
        buildRow(parent, row, index) {
            const wrap = document.createElement('div');
            wrap.className = 'sip-keybar-row';
            if (row.collapsible) wrap.classList.add('collapsible');
            wrap.setAttribute('role', 'group');
            wrap.setAttribute('aria-label', row.label || `Row ${index + 1}`);

            const scroll = document.createElement('div');
            scroll.className = 'sip-keybar-scroll';
            for (const spec of row.keys) {
                if (spec.sep) {
                    const sep = document.createElement('span');
                    sep.className = 'sep';
                    sep.setAttribute('aria-hidden', 'true');
                    scroll.appendChild(sep);
                    continue;
                }
                const btn = this.buildButton(spec);
                if (spec.action) btn.classList.add('action');
                scroll.appendChild(btn);
            }

            wrap.appendChild(scroll);
            parent.appendChild(wrap);
            this.rows.push({ el: wrap, scroll, collapsible: !!row.collapsible });
        }

        /**
         * One bar button. The touch path is not here: see installBarTouch.
         *
         * What is here is the mouse, and pointer events drive that case only.
         * On a touch device they duplicate the touch sequence, and acting on
         * both would fire every button twice.
         */
        buildButton(spec) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = spec.label;
            btn.title = spec.title || spec.label;
            btn.setAttribute('aria-label', spec.title || spec.label);
            if (spec.narrow) btn.classList.add('narrow');
            if (spec.fold) btn.classList.add('fold');
            if (spec.mod) this.modButtons[spec.mod] = btn;
            if (spec.keyboard) this.keyboardBtn = btn;
            if (spec.fold) this.foldBtn = btn;
            if (spec.prefix) this.prefixBtn = btn;
            if (spec.id) this.buttons.set(spec.id, btn);
            // Nothing in the bar is in the focus order. A button that can be
            // focused is a button that can hold the focus the software keyboard
            // is riding on.
            btn.tabIndex = -1;
            this.specs.set(btn, spec);

            const mouseTap = (e) => {
                if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
                e.preventDefault();
                this.tapBarKey(spec);
                if (!spec.keyboard) this.keepFocus();
            };
            if (typeof PointerEvent === 'function') {
                this.on(btn, 'pointerdown', mouseTap);
            } else {
                this.on(btn, 'mousedown', mouseTap);
            }
            this.on(btn, 'click', (e) => e.preventDefault());
            return btn;
        }

        /**
         * The bar's scrolling, done by hand.
         *
         * The obvious way to make a row of buttons scroll is overflow-x: auto
         * and let the browser do it, and that costs the software keyboard. A
         * native touch scroll is a gesture the page has already lost by the time
         * it can see it: touchmove and touchend arrive with cancelable false,
         * the browser owns the sequence, and browsers do things to the software
         * keyboard when a scroll starts under it. Emulation shows none of that.
         * The two fixes look irreconcilable from there, because cancelling the
         * touch sequence is exactly what keeps the keyboard up, and cancelling
         * it is exactly what stops a native scroll.
         *
         * They are only irreconcilable while the browser is the one scrolling.
         * So it is not: the strip is overflow: hidden, the whole bar is
         * touch-action: none, every touch on it is cancelled at touchstart, and
         * the pan is done here by assigning scrollLeft, which an overflow:
         * hidden box still honours. The browser is left with no gesture to
         * interpret, so it has no scroll to dismiss the keyboard for, and focus
         * never moves because the sequence that would have moved it never
         * completed.
         *
         * Do not replace this with compat-mouse-event suppression. That theory
         * was measured and was wrong; the non-cancellable native scroll is the
         * mechanism.
         *
         * The tap guard comes with it: a tap is a touch that ended within
         * BAR_TAP_SLOP_PX of where it started, on the button it started on. A
         * flick past a button cannot fire it.
         */
        installBarTouch() {
            const bar = this.bar;
            let g = null;

            const find = (e) => {
                for (const t of e.changedTouches) if (t.identifier === g.id) return t;
                return null;
            };
            const release = () => {
                if (g && g.btn) g.btn.classList.remove('pressed');
                const a = g;
                g = null;
                return a;
            };

            this.on(bar, 'touchstart', (e) => {
                // Cancelling here is the whole fix. It is also what makes the
                // rest of this function necessary.
                if (e.cancelable) e.preventDefault();
                // A second finger on a toolbar is a mistake, not a gesture. The
                // first one keeps the pan.
                if (g) return;
                this.stopGlide();
                const t = e.changedTouches[0];
                const hit = e.target && e.target.closest ? e.target : null;
                const btn = hit ? hit.closest('button') : null;
                // The row the finger landed on is the row that pans, so each
                // strip scrolls on its own. A touch that started on a pinned
                // key, or on the bar's own padding, is over no row at all and
                // is a press or nothing.
                const scroller = hit ? hit.closest('.sip-keybar-scroll') : null;
                g = {
                    id: t.identifier,
                    x0: t.clientX, y0: t.clientY, x: t.clientX,
                    anchor: t.clientX, from: scroller ? scroller.scrollLeft : 0,
                    at: performance.now(), v: 0, moved: false,
                    btn, spec: btn ? this.specs.get(btn) : null,
                    scroller,
                };
                if (btn) btn.classList.add('pressed');
            }, { passive: false });

            this.on(bar, 'touchmove', (e) => {
                if (!g) return;
                const t = find(e);
                if (!t) return;
                if (e.cancelable) e.preventDefault();
                if (!g.moved && Math.hypot(t.clientX - g.x0, t.clientY - g.y0) > BAR_TAP_SLOP_PX) {
                    g.moved = true;
                    // The pan starts from where the finger is now, not from
                    // where it went down, or crossing the threshold would jump
                    // the strip by the slop.
                    g.anchor = t.clientX;
                    g.from = g.scroller ? g.scroller.scrollLeft : 0;
                    if (g.btn) g.btn.classList.remove('pressed');
                }
                const now = performance.now();
                const dt = now - g.at;
                if (dt > 0) {
                    // Smoothed, because one sample of a finger is noise and the
                    // flick is judged on the last of them.
                    g.v = 0.7 * ((t.clientX - g.x) / dt) + 0.3 * g.v;
                    g.at = now;
                }
                g.x = t.clientX;
                if (g.moved && g.scroller) this.panTo(g.scroller, g.from - (t.clientX - g.anchor));
            }, { passive: false });

            this.on(bar, 'touchend', (e) => {
                if (!g || !find(e)) return;
                if (e.cancelable) e.preventDefault();
                const a = release();
                if (!a.moved) {
                    if (a.spec) this.tapBarKey(a.spec);
                } else if (a.scroller) {
                    this.glide(a.scroller, -a.v);
                }
                // Inside the gesture, which is the only context in which asking
                // for focus brings the keyboard back rather than being ignored.
                // Skipped for the keyboard key itself, whose whole job is to
                // take focus away.
                if (!(a.spec && a.spec.keyboard)) {
                    this.keepFocus();
                    this.armKeyboardRescue();
                }
            }, { passive: false });

            this.on(bar, 'touchcancel', () => { release(); }, { passive: true });
        }

        /** Move a strip to an offset, clamped by the box itself. */
        panTo(scroller, left) {
            if (!scroller) return;
            scroller.scrollLeft = left;
            this.refreshScrollHints();
        }

        panBy(scroller, dx) {
            if (!scroller) return;
            scroller.scrollLeft += dx;
            this.refreshScrollHints();
        }

        /**
         * Carry a flick on after the finger has gone. v is px per millisecond.
         *
         * One glide at a time across the whole bar: flicking a second row
         * stops the first, because two strips moving under a stationary finger
         * is the layout shifting on its own.
         */
        glide(scroller, v) {
            this.stopGlide();
            if (!scroller || Math.abs(v) < BAR_GLIDE_MIN_V) return;
            let last = performance.now();
            const step = (now) => {
                const dt = Math.min(now - last, 32);
                last = now;
                const before = scroller.scrollLeft;
                this.panBy(scroller, v * dt);
                // The end of the strip stops the glide: the box clamped what it
                // was given, so nothing moved.
                if (scroller.scrollLeft === before) return;
                v *= Math.pow(BAR_GLIDE_DECAY, dt / 16);
                if (Math.abs(v) < BAR_GLIDE_MIN_V) return;
                this.glideFrame = requestAnimationFrame(step);
            };
            this.glideFrame = requestAnimationFrame(step);
        }

        stopGlide() {
            if (this.glideFrame) cancelAnimationFrame(this.glideFrame);
            this.glideFrame = 0;
        }

        /** Light each row's edge fade on whichever side has buttons off screen. */
        refreshScrollHints() {
            for (const { el, scroll } of this.rows) {
                const max = scroll.scrollWidth - scroll.clientWidth;
                el.classList.toggle('more-left', scroll.scrollLeft > 2);
                el.classList.toggle('more-right', max > 2 && scroll.scrollLeft < max - 2);
            }
        }

        // --- folding ----------------------------------------------------------

        /**
         * Whether the collapsible rows were left open. Anything but the stored
         * '0' means open, so a corrupt or unreadable value fails towards the
         * bar the deployment declared rather than towards a hidden one.
         */
        readRowsOpen() {
            try {
                return localStorage.getItem(this.storeKey) !== '0';
            } catch (e) {
                return true; // private mode
            }
        }

        setRowsOpen(open) {
            this.applyRowsOpen(open);
            try {
                localStorage.setItem(this.storeKey, open ? '1' : '0');
            } catch (e) {
                /* private mode: the fold still works, it is just not remembered */
            }
        }

        /** Fold or unfold without recording the answer, for the initial restore. */
        applyRowsOpen(open) {
            this.rowsOpen = !!open;
            if (this.bar) this.bar.classList.toggle('folded', !this.rowsOpen);
            const btn = this.foldBtn;
            if (btn) {
                btn.textContent = this.rowsOpen ? '▾' : '▴';
                btn.title = this.rowsOpen ? 'Hide the extra rows' : 'Show the extra rows';
                btn.setAttribute('aria-label', btn.title);
                btn.setAttribute('aria-expanded', this.rowsOpen ? 'true' : 'false');
            }
            // The bar just changed height, and the terminal is sized from it.
            this.measureBar();
            this.refreshScrollHints();
        }

        measureBar() {
            if (!this.bar) return;
            const h = Math.round(this.bar.getBoundingClientRect().height);
            if (h === this.barHeight) return;
            this.barHeight = h;
            document.documentElement.style.setProperty('--sip-keybar-h', `${h}px`);
        }

        /** Mark a button by id: '', 'active', 'armed' or 'locked'. */
        setState(id, state) {
            const btn = this.buttons.get(id);
            if (!btn) return;
            for (const c of ['active', 'armed', 'locked']) btn.classList.toggle(c, state === c);
        }

        tapBarKey(spec) {
            if (spec.mod) {
                this.cycleMod(spec.mod);
                return;
            }
            if (spec.keyboard) {
                this.toggleKeyboard();
                return;
            }
            if (spec.fold) {
                this.setRowsOpen(!this.rowsOpen);
                return;
            }
            if (typeof spec.run === 'function') {
                spec.run(this);
                return;
            }
            if (spec.prefix) {
                this.tapPrefix();
                return;
            }
            if (spec.prefixed) {
                this.pressChord(spec);
                return;
            }
            this.pressKey(spec);
        }

        // --- the leader chord -------------------------------------------------

        /**
         * Send the configured leader, as a keystroke rather than as bytes.
         *
         * It goes through the same encoder every other button uses, so a host
         * that speaks a protocol of its own encodes the leader in it too
         * instead of receiving a hand-written control byte that its terminal
         * would have framed differently.
         *
         * Reports whether anything went out, which is false when no prefix is
         * configured.
         */
        sendPrefix() {
            if (!this.prefix || !this.ready()) return false;
            const bytes = this.encode(this.prefix, {
                ctrl: !!this.prefix.ctrl,
                alt: !!this.prefix.alt,
                shift: !!this.prefix.shift,
            });
            if (!bytes) return false;
            this.host.send(bytes);
            return true;
        }

        /**
         * The prefix button: send the leader and light up until the next key.
         *
         * This is what makes a chord the bar has no button for reachable at
         * all: tap it, then type the second half on the software keyboard.
         * The light is a mirror of what the program was told, which is why
         * tapping it a second time sends a second leader rather than quietly
         * going dark. Every program with a leader defines what a doubled one
         * means (tmux and tuios take it as cancel, or as the literal leader
         * for a nested session); none of them define what happens when the bar
         * lies about the state.
         */
        tapPrefix() {
            if (!this.prefix) return;
            // A chord is a fixed sequence, so a locked Ctrl is cleared rather
            // than folded into it. Ctrl+B then Ctrl+C is a different chord
            // from Ctrl+B then C, and the user pressed one button.
            this.clearMods();
            if (!this.sendPrefix()) return;
            this.setPrefixPending(!this.prefixPending);
        }

        setPrefixPending(on) {
            this.prefixPending = !!on;
            if (this.prefixBtn) this.prefixBtn.classList.toggle('armed', this.prefixPending);
        }

        /**
         * One tap for a whole chord: the leader, then this key on its own.
         *
         * The leader is skipped when the user already armed it by hand, so
         * tapping prefix and then a chord button does not send it twice. That
         * is safe because the latch is cleared by every key that goes out, so
         * it can only still be set when nothing at all has been sent since the
         * tap that set it.
         *
         * With no prefix configured this sends the bare key, which is the
         * honest degradation: the button still means what its label says for a
         * program that binds the key directly.
         */
        pressChord(spec) {
            if (!this.ready()) return;
            this.clearMods();
            if (!this.prefixPending) this.sendPrefix();
            this.setPrefixPending(false);
            const bytes = this.encode(
                { key: spec.key, code: spec.code, shift: !!spec.shift },
                { ctrl: false, alt: false, shift: !!spec.shift },
            );
            if (bytes) this.host.send(bytes);
        }

        /**
         * Synthesise a key press with the armed modifiers applied.
         *
         * A key that carries a modifier of its own, which is how a button says
         * "^C", gets it on top of whatever is armed rather than instead of it.
         */
        pressKey(spec) {
            if (!this.ready()) return;
            const mods = {
                ctrl: this.mods.ctrl > 0 || !!spec.ctrl,
                alt: this.mods.alt > 0 || !!spec.alt,
                shift: !!spec.shift,
            };
            const bytes = this.encode(spec, mods);
            this.consumeOneShot();
            if (!bytes) return;
            this.host.send(bytes);
            // A key went to the program, so it has consumed whatever leader
            // was pending.
            this.setPrefixPending(false);
        }

        // --- the software keyboard -------------------------------------------

        focusInput() {
            const el = this.focusEl();
            if (!el) return;
            try {
                el.focus({ preventScroll: true });
            } catch (e) {
                el.focus();
            }
        }

        /** Put focus back on the focus target. Call inside a user gesture. */
        keepFocus() {
            const el = this.focusEl();
            if (!el || document.activeElement === el) return;
            this.focusInput();
        }

        toggleKeyboard() {
            const el = this.focusEl();
            if (!el) return;
            if (document.activeElement !== el) {
                this.focusInput();
                this.setKeyboardOpen(true);
                return;
            }
            // Focused with nothing covering the window is the state the page
            // loads in: the terminal took focus on its own, which is not a
            // gesture, and no browser raises a keyboard for that. Asking an
            // already focused element to focus is a no-op, so the way to ask
            // for the keyboard from here is to leave and come back. Without
            // this the first tap on this key would only spend itself dropping
            // focus the user could not see.
            if (!this.inset) {
                el.blur();
                this.focusInput();
                this.setKeyboardOpen(true);
                return;
            }
            // Asked for, so the keyboard going away is not something to rescue
            // it from. See armKeyboardRescue.
            this.rescueUntil = 0;
            el.blur();
            this.setKeyboardOpen(false);
        }

        setKeyboardOpen(open) {
            document.body.classList.toggle('sip-kb-open', open);
            const btn = this.keyboardBtn;
            if (btn) {
                btn.classList.toggle('active', open);
                btn.textContent = open ? 'hide' : 'abc';
            }
            // A keyboard that closes takes its inset with it, and not every
            // browser says so: iOS fires a visualViewport resize, but a blur
            // triggered from JS sometimes does not. Zero it here and let the
            // next measurement correct it.
            if (!open) {
                this.vkInset = 0;
                this.vvInset = 0;
                this.applyInset();
            }
            this.measureBar();
        }

        /**
         * The net under keepFocus, for the browsers that take the keyboard away
         * without taking the focus with it.
         *
         * A browser that blurs the focus target is caught by keepFocus, because
         * focus is observable. A browser that leaves focus alone and merely
         * hides the keyboard is not: activeElement still names the element, and
         * asking an already focused element to focus is a no-op, so there is
         * nothing to notice. What is observable is the inset: the keyboard was
         * measurably covering part of the window before the gesture and
         * measurably is not after it, which no browser does on its own except
         * by hiding it.
         *
         * Armed only at the end of a bar gesture, only while the focus target
         * still holds focus, and only when there was an inset to lose, so a
         * browser that reports no inset at all can never trigger it and neither
         * can the key whose job is to put the keyboard away.
         */
        armKeyboardRescue() {
            const el = this.focusEl();
            if (!el || document.activeElement !== el) return;
            if (!this.inset) return;
            this.rescueUntil = performance.now() + KB_RESCUE_MS;
        }

        /** The inset just went to zero. Was it ours to lose? */
        maybeRescueKeyboard() {
            if (!this.rescueUntil || performance.now() > this.rescueUntil) return;
            this.rescueUntil = 0;
            const el = this.focusEl();
            if (!el) return;
            if (document.activeElement !== el) {
                // A blur that arrived after the gesture ended, too late for the
                // touchend to have caught it.
                this.focusInput();
                return;
            }
            // Focus never moved, so the keyboard went without it. The only way
            // to ask for one on an already focused element is to leave and come
            // back.
            el.blur();
            this.focusInput();
        }

        /**
         * Work out how much of the window the software keyboard is covering.
         *
         * Two APIs, because no one browser has both:
         *
         *   VirtualKeyboard API. Chromium on Android. Asking for
         *   overlaysContent means the browser stops resizing anything and
         *   instead reports the keyboard's rectangle, which is the only way to
         *   get an exact number.
         *
         *   visualViewport. What Safari on iOS has. The keyboard does not
         *   change the layout viewport there, only the visual one, so the
         *   difference between them is the keyboard.
         *
         * Whichever reports more wins, rather than whichever exists. They
         * cannot double-count, because it is a max and not a sum, and either
         * one reading zero is exactly what "this browser resized the layout for
         * me already" looks like: window.innerHeight has shrunk too, so the
         * difference is zero and there is nothing left to reserve.
         *
         * If both are absent or wrong the inset stays 0 and the terminal is the
         * size of the window, which is what it was before this file existed:
         * the keyboard covers the bottom rows, which is survivable. Everything
         * here is written so that a bad measurement costs space, never layout.
         */
        installViewport() {
            this.vkInset = 0;
            this.vvInset = 0;

            const vk = navigator.virtualKeyboard;
            if (vk && 'overlaysContent' in vk) {
                try {
                    vk.overlaysContent = true;
                    this.vk = vk;
                    this.on(vk, 'geometrychange', () => {
                        const r = vk.boundingRect;
                        this.vkInset = r ? r.height : 0;
                        this.applyInset();
                    });
                } catch (e) {
                    this.vk = null;
                }
            }

            const vv = window.visualViewport;
            if (vv) {
                const onChange = () => {
                    this.vvInset = window.innerHeight - vv.height - vv.offsetTop;
                    this.applyInset();
                    // iOS scrolls the layout viewport to reveal the focused
                    // element when the keyboard opens. The page is a fixed
                    // layout, so that only pushes the terminal off the top.
                    if (window.scrollY !== 0) window.scrollTo(0, 0);
                };
                this.on(vv, 'resize', onChange);
                this.on(vv, 'scroll', onChange);
            }

            // Rotating the phone changes everything at once and neither API is
            // guaranteed to fire, so remeasure after the orientation settles.
            this.on(window, 'orientationchange', () => {
                setTimeout(() => this.measureBar(), 250);
            });

            const el = this.focusEl();
            if (el) {
                this.on(el, 'focus', () => this.setKeyboardOpen(true));
                this.on(el, 'blur', () => this.setKeyboardOpen(false));
            }
        }

        applyInset() {
            this.setInset(Math.max(this.vkInset || 0, this.vvInset || 0));
        }

        setInset(px) {
            const max = (window.innerHeight || 0) * INSET_MAX_FRACTION;
            let v = Math.round(px || 0);
            if (!Number.isFinite(v) || v < INSET_MIN_PX) v = 0;
            if (v > max) v = Math.round(max);
            if (v === this.inset) return;
            // A keyboard that was there and is not any more. If a bar gesture
            // has just ended, it did not go of its own accord.
            const lost = this.inset > 0 && v === 0;
            this.inset = v;
            if (lost) this.maybeRescueKeyboard();
            if (this.insetPending) return;
            this.insetPending = true;
            requestAnimationFrame(() => {
                this.insetPending = false;
                document.documentElement.style.setProperty('--sip-kb-inset', `${this.inset}px`);
                this.measureBar();
            });
        }

        destroy() {
            for (const [target, type, fn, opts] of this.listeners) {
                target.removeEventListener(type, fn, opts);
            }
            this.listeners = [];
            this.stopGlide();
            this.rescueUntil = 0;
            this.rows = [];
            this.prefixPending = false;
            if (this.barObserver) this.barObserver.disconnect();
            if (this.bar) this.bar.remove();
            if (this.styleEl) this.styleEl.remove();
            document.body.classList.remove('sip-touch', 'sip-kb-open');
            document.documentElement.style.removeProperty('--sip-kb-inset');
            document.documentElement.style.removeProperty('--sip-keybar-h');
            this.enabled = false;
        }
    }

    /** The no-op returned on a desktop, so the caller needs no null checks. */
    const INERT = {
        enabled: false,
        mods: { ctrl: 0, alt: 0 },
        prefixPending: false,
        pending: false,
        transformInput: (t) => t,
        wrapKey: (e) => e,
        setState() {},
        setRowsOpen() {},
        sendPrefix: () => false,
        focusInput() {},
        destroy() {},
    };

    function installKeyBar(host, options) {
        if (!detectTouch()) return INERT;
        return new KeyBar(host, options).install();
    }

    /**
     * Make a fixed-position control draggable, and remember where it was left.
     *
     * A control that floats over a terminal is in the way of something, and
     * which something depends on what is running: a full-screen program owns
     * every corner of the screen and sip has no way to know which one it can
     * spare. Rather than guess at a placement that is always free, this lets
     * the control be moved and keeps the answer in localStorage.
     *
     * Options:
     *
     *   storageKey  where to remember the position. Omit for no persistence.
     *   margin      pixels the control is kept clear of the viewport edge.
     *
     * The element keeps its own click handler and needs no other changes. The
     * pointer sequence is cancelled from pointerdown onwards, which keeps a
     * drag from selecting text, from reaching whatever is underneath, and from
     * moving focus off an element that is holding a software keyboard up; the
     * click that ends a drag is swallowed, so letting go does not also press
     * the thing.
     *
     * Returns { destroy() }.
     */
    function installDraggable(el, opts = {}) {
        if (!el) return { destroy() {} };
        const margin = opts.margin == null ? 4 : opts.margin;
        const key = opts.storageKey || '';

        const clamp = (x, y) => {
            const w = el.offsetWidth || 0;
            const h = el.offsetHeight || 0;
            const maxX = Math.max(margin, window.innerWidth - w - margin);
            const maxY = Math.max(margin, window.innerHeight - h - margin);
            return [
                Math.min(Math.max(x, margin), maxX),
                Math.min(Math.max(y, margin), maxY),
            ];
        };

        // Placing by left/top means the CSS defaults (which use right/bottom)
        // have to go, or the element would be stretched between the two.
        const place = (x, y) => {
            const [cx, cy] = clamp(x, y);
            el.style.left = `${Math.round(cx)}px`;
            el.style.top = `${Math.round(cy)}px`;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            return [cx, cy];
        };

        const save = (x, y) => {
            if (!key) return;
            try {
                localStorage.setItem(key, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
            } catch (e) {
                /* private mode */
            }
        };

        let placed = false;
        if (key) {
            try {
                const raw = JSON.parse(localStorage.getItem(key) || 'null');
                if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
                    place(raw.x, raw.y);
                    placed = true;
                }
            } catch (e) {
                /* corrupt or unavailable */
            }
        }

        let drag = null;
        const listeners = [];
        const on = (target, type, fn, o) => {
            target.addEventListener(type, fn, o);
            listeners.push([target, type, fn, o]);
        };

        on(el, 'pointerdown', (e) => {
            if (e.button != null && e.button !== 0) return;
            e.preventDefault();
            const r = el.getBoundingClientRect();
            drag = {
                id: e.pointerId,
                dx: e.clientX - r.left,
                dy: e.clientY - r.top,
                x0: e.clientX,
                y0: e.clientY,
                moved: false,
            };
            try {
                el.setPointerCapture(e.pointerId);
            } catch (err) {
                /* capture is a nicety */
            }
        });

        on(el, 'pointermove', (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            if (!drag.moved) {
                if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_SLOP_PX) return;
                drag.moved = true;
                el.classList.add('dragging');
            }
            e.preventDefault();
            place(e.clientX - drag.dx, e.clientY - drag.dy);
        });

        const end = (e) => {
            if (!drag || (e && e.pointerId !== drag.id)) return;
            const moved = drag.moved;
            drag = null;
            el.classList.remove('dragging');
            if (!moved) return;
            // A drag must not also be a click, or letting go would open the
            // panel it was being dragged out of the way of.
            const swallow = (ev) => ev.stopPropagation();
            el.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
            const r = el.getBoundingClientRect();
            placed = true;
            save(r.left, r.top);
        };
        on(el, 'pointerup', end);
        on(el, 'pointercancel', end);
        // Dragging is not a text selection or a context menu, whatever the
        // browser would otherwise make of a press and a drag on a button.
        on(el, 'dragstart', (e) => e.preventDefault());
        on(el, 'contextmenu', (e) => { if (drag) e.preventDefault(); });

        // A window that shrinks must not leave the control outside it, where
        // there is no way to get it back.
        on(window, 'resize', () => {
            if (!placed) return;
            const r = el.getBoundingClientRect();
            place(r.left, r.top);
        });

        return {
            destroy() {
                for (const [target, type, fn, o] of listeners) target.removeEventListener(type, fn, o);
                listeners.length = 0;
            },
        };
    }

    window.SipMobile = {
        DEFAULT_KEYS,
        detectTouch,
        encodeKeySpec,
        installDraggable,
        installKeyBar,
        pickFontSize,
    };
})();
