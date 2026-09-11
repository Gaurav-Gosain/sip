// Sip web terminal client.
//
// The terminal itself, its renderer, kitty graphics, clipboard, unicode widths
// and input policy all come from the vendored webterm bundle (static/webterm.js,
// which publishes the WebTerm global). What is left here is the part that is
// sip's and not reusable: the wire protocol (message types 0..7, matching
// handlers.go), the WebTransport length framing, the /cert-hash exchange, the
// settings panel, the status indicator and the reconnect policy.
//
// Loaded as a classic script after the webterm bundle.
(function() {
    'use strict';

    const { WebTerm } = window.WebTerm;
    // The touch layer: the key bar, the keyboard-aware layout and the
    // draggable page controls. See static/mobile.js.
    const SipMobile = window.SipMobile;

    // Message types (must match server)
    const MSG_INPUT = 0x30;    // '0'
    const MSG_OUTPUT = 0x31;   // '1'
    const MSG_RESIZE = 0x32;   // '2'
    const MSG_PING = 0x33;     // '3'
    const MSG_PONG = 0x34;     // '4'
    const MSG_TITLE = 0x35;    // '5'
    const MSG_OPTIONS = 0x36;  // '6'
    const MSG_CLOSE = 0x37;    // '7'

    // Font family with fallbacks.
    const FONT_FAMILY = "'JetBrainsMono Nerd Font Mono', 'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace";

    // Settings storage.
    const STORAGE_KEY = 'sip-web-settings';

    // The server drops a single input message larger than MaxPasteBytes
    // (1 MiB by default) rather than killing the session, so a big paste has
    // to arrive as several messages. 64 KiB stays well under any configured
    // limit and keeps each frame small enough not to stall the socket.
    const INPUT_CHUNK_SIZE = 64 * 1024;

    const MAX_FRAME_BYTES = 16 * 1024 * 1024;

    // Reserved chords worth asking the Keyboard Lock API for. Only ever
    // granted to a fullscreen document, so this does nothing outside one.
    const RESERVED_KEYS = [
        'KeyW', 'KeyT', 'KeyN', 'KeyR', 'KeyL',
        'Tab', 'Escape', 'Digit1', 'Digit2', 'Digit3',
    ];

    const DEFAULT_SETTINGS = {
        transport: 'auto',
        renderer: 'auto',
        fontSize: 14,
        // A blinking cursor is a persistent animation, so it repaints forever
        // on an otherwise idle terminal. Off unless asked for.
        cursorBlink: false,
        copyOnSelect: false,
        // The browser context menu covers the terminal on right click, which
        // hides whatever the program under the cursor wanted to do with the
        // button. Terminals suppress it for that reason; turn this on to get
        // the browser menu back.
        browserContextMenu: false,
        // Ctrl+W, Ctrl+T and friends are reserved by the browser and cannot be
        // intercepted by an ordinary page. The Keyboard Lock API hands them to
        // us, but only while the document is fullscreen, so this only takes
        // effect there.
        captureReservedKeys: true,
    };

    const THEME = {
        foreground: '#cdd6f4',
        background: '#1e1e2e',
        cursor: '#f5e0dc',
        cursorAccent: '#1e1e2e',
        selectionBackground: '#585b70',
        selectionForeground: '#cdd6f4',
        selectionInactiveBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
    };

    // Per-deployment config injected by the server (see renderIndex). Absent
    // unless sip was started with a font, renderer or appearance setting.
    const sipConfig = window.__sipConfig || {};

    // --- Appearance ------------------------------------------------------
    //
    // How the page looks: the palette, the two cursors, the chrome. See
    // Appearance in the Go package for what each field means.
    //
    // It arrives twice from one producer. The blob in __sipConfig is read
    // before the terminal is constructed, so the first paint is already the
    // deployment's; the identical blob arrives again over MsgOptions on
    // connect, which is what reaches a page sip did not render and what
    // re-applies after a reconnect.
    //
    // Every field is optional and the whole blob may be missing: an old tab
    // reconnecting to a new server, or a server that predates the option.
    // Nothing here throws on an absent field, it falls back to the constant.

    /** The deployment palette over sip's own, so a partial theme is a patch. */
    function mergeTheme(a) {
        return Object.assign({}, THEME, (a && a.theme) || {});
    }

    /** The chrome properties applyPageAppearance last wrote, so it can undo them. */
    let appliedChrome = [];

    /**
     * Paint the page around the terminal: the chrome colours, the mouse
     * cursor, the tab title and its icon.
     *
     * The colours are CSS custom properties that static/terminal.css already
     * declares with today's values as their fallbacks, so an unset property
     * is not a missing colour, it is the built-in one.
     */
    function applyPageAppearance(a) {
        const root = document.documentElement;
        const chrome = (a && a.chrome) || {};
        const applied = [];
        for (const prop of Object.keys(chrome)) {
            // Two namespaces and no others, so the blob cannot reach a
            // property the page did not mean to expose. --webterm-* is the
            // vendored bundle's own hook for the ground behind the grid and
            // the scrollbar, which sip's properties do not reach.
            if (prop.startsWith('--sip-') || prop.startsWith('--webterm-')) {
                root.style.setProperty(prop, chrome[prop]);
                applied.push(prop);
            }
        }
        // A colour this palette does not name goes back to the stylesheet's
        // own default, which is what makes appearance.reset a reset rather
        // than a partial one. Only the properties this function set are
        // removed: static/mobile.js publishes --sip-kb-inset and
        // --sip-keybar-h on the same element, and taking those away would
        // hand the software keyboard's share of the window back to nobody.
        for (const prop of appliedChrome) {
            if (applied.indexOf(prop) < 0) root.style.removeProperty(prop);
        }
        appliedChrome = applied;
        if (a && a.mouseCursor) root.style.setProperty('--sip-mouse-cursor', a.mouseCursor);
        else root.style.removeProperty('--sip-mouse-cursor');

        if (a && a.favicon) {
            let link = document.querySelector('link[rel="icon"]');
            if (!link) {
                link = document.createElement('link');
                link.rel = 'icon';
                document.head.appendChild(link);
            }
            // Assigned as a property, never written into markup.
            link.href = a.favicon;
        }
    }

    // --- Pointer shapes, the kitty OSC 22 protocol -----------------------
    //
    // A program running in the terminal names the shape the mouse pointer
    // takes: `wait` while it is busy, `ew-resize` over a pane divider,
    // `pointer` over a button. The specification is at
    // https://sw.kovidgoyal.net/kitty/pointer-shapes/.
    //
    //     OSC 22 ; [= | > | < | ?] name[,name...] ST
    //
    // `=` or no prefix sets the shape, `>` pushes a list, `<` pops, and `?`
    // queries. The thirty names are CSS cursor keywords, which is the whole
    // reason this is cheap here: a native terminal maps each one onto a
    // platform cursor, and the browser already has all thirty.
    //
    // It is parsed here rather than in Go because everything the
    // specification ties the protocol to already lives in this process.
    // Separate stacks for the main and the alternate screen need to know
    // which screen is live; emptying both on a terminal reset needs to see
    // RIS and DECSTR; and the pointer itself is a CSS property on an element
    // in this document. xterm's parser hands all of that over for free, and
    // it is the only parser here that already knows a real OSC 22 from the
    // same bytes inside a kitty graphics payload.

    /**
     * The thirty shape names the specification requires, and the whole of what
     * sip accepts from a program.
     *
     * This list is the security boundary. A name arrives from the PTY, which
     * is output from whatever program the user is running, and it ends up in a
     * CSS `cursor` property. `url(https://example.com/x.png), pointer` is a
     * perfectly valid cursor value, so a name passed through because it looked
     * plausible would let a program in a pane point the browser at any URL it
     * likes. Membership of this set is the only way a string reaches the DOM.
     *
     * pointershapes.go carries the same list and TestClientAndGoAgreeOnTheShapes
     * fails when the two differ.
     */
    const POINTER_SHAPES = new Set([
        'alias', 'cell', 'copy', 'crosshair', 'default',
        'e-resize', 'ew-resize', 'grab', 'grabbing', 'help',
        'move', 'n-resize', 'ne-resize', 'nesw-resize', 'no-drop',
        'not-allowed', 'ns-resize', 'nw-resize', 'nwse-resize', 'pointer',
        'progress', 's-resize', 'se-resize', 'sw-resize', 'text',
        'vertical-text', 'w-resize', 'wait', 'zoom-in', 'zoom-out',
    ]);

    // The bounds. A program that pushes a million shapes must cost nothing, so
    // every one of these is a hard cap rather than a warning.
    //
    // POINTER_STACK_MAX is the specification's own minimum of 16, which is
    // also its maximum here: nothing legitimate nests pointer shapes deeper
    // than that, and the specification says the bottom entry is evicted when
    // the stack is full.
    const POINTER_STACK_MAX = 16;
    // One sequence longer than this is dropped whole rather than truncated. A
    // truncated name would silently become a different name.
    const POINTER_MAX_PAYLOAD = 1024;
    // Names parsed out of one push or one query. The stack is 16 deep, so a
    // longer push is already pointless; this bounds the reply to a query too.
    const POINTER_MAX_NAMES = 64;

    // What ?__grabbed__ answers. sip's terminal grid never grabs, but the
    // question has to have an answer from the table, and `grabbing` is the one
    // sip does use for its own drag, on the settings gear.
    const POINTER_GRABBED = 'grabbing';

    /**
     * The one gate. Returns the name if sip supports it, null otherwise.
     *
     * Null is a real stack entry rather than a dropped one, so a push and the
     * pop that follows it stay balanced. See PointerShapes.push.
     */
    function pointerShapeOrNull(name) {
        return POINTER_SHAPES.has(name) ? name : null;
    }

    /**
     * The shape the terminal falls back to when the stack holds nothing.
     *
     * It reads the same two things static/terminal.css does, in the same
     * order, so the answer to `?__default__` and the pixel on the screen
     * cannot disagree: the deployment's Appearance.MouseCursor if it named
     * one, otherwise `text`, or `default` while a program is reading the
     * mouse and there is nothing to select.
     *
     * A deployment cursor outside the thirty, `none` for instance, has no
     * name in the table to report, so the query answers `default`.
     */
    function defaultPointerShape(appearance, term) {
        const configured = appearance && appearance.mouseCursor;
        if (configured) return POINTER_SHAPES.has(configured) ? configured : 'default';
        const el = term && term.element;
        return el && el.classList.contains('enable-mouse-events') ? 'default' : 'text';
    }

    class PointerShapes {
        /**
         * @param term the xterm Terminal, for its parser and its buffers
         * @param sendReply called with the escape sequence answering a query
         * @param defaultShape called for the name ?__default__ reports
         */
        constructor(term, sendReply, defaultShape) {
            this.term = term;
            this.sendReply = sendReply;
            this.defaultShape = defaultShape;
            // One stack per screen, which the specification requires: a full
            // screen program that drops back to the shell must not have to
            // save and restore the pointer around it.
            this.stacks = { normal: [], alternate: [] };

            term.parser.registerOscHandler(22, (data) => this.handle(data));
            // RIS empties both stacks, which is what the specification means
            // by resetting the terminal. The handler returns false, so xterm
            // still does the reset itself; this only listens.
            //
            // DECSTR is deliberately not in here. A soft reset is what a
            // curses program sends on the way in, and clearing the stacks on
            // it would take the shape away from the program that had just
            // asked for one.
            term.parser.registerEscHandler({ final: 'c' }, () => { this.reset(); return false; });
            // The shape follows the screen. Switching to the alternate screen
            // shows that screen's shape, and switching back restores the
            // main screen's.
            term.buffer.onBufferChange(() => this.apply());
        }

        /** The stack belonging to the screen that is live now. */
        stack() {
            const b = this.term.buffer;
            return b && b.active && b.active.type === 'alternate' ? this.stacks.alternate : this.stacks.normal;
        }

        /** The top of the live stack, or null when nothing is set. */
        current() {
            const st = this.stack();
            return st.length ? st[st.length - 1] : null;
        }

        /** Empty both stacks and put the pointer back to the default. */
        reset() {
            this.stacks.normal.length = 0;
            this.stacks.alternate.length = 0;
            this.apply();
        }

        /**
         * Put the current shape on the page.
         *
         * It is a custom property rather than an inline cursor so the cascade
         * still decides. static/terminal.css reads it ahead of
         * --sip-mouse-cursor and ahead of the built-in default, and the one
         * rule that outranks it is sip's own pointer over a hyperlink.
         */
        apply() {
            const shape = this.current();
            const root = document.documentElement;
            if (shape) root.style.setProperty('--sip-pointer-shape', shape);
            else root.style.removeProperty('--sip-pointer-shape');
        }

        /** OSC 22's payload: everything after `22;` and before the terminator. */
        handle(data) {
            // Consumed either way. Returning false would hand the sequence to
            // xterm's fallback handler, which logs it as unrecognised.
            if (typeof data !== 'string' || data.length > POINTER_MAX_PAYLOAD) return true;
            const first = data.charAt(0);
            const rest = (first === '=' || first === '>' || first === '<' || first === '?')
                ? data.slice(1) : data;
            switch (first) {
                case '>': this.push(rest); break;
                case '<': this.pop(); break;
                case '?': this.query(rest); break;
                default: this.set(rest); break;
            }
            return true;
        }

        /** The comma separated list, capped. */
        names(rest) {
            if (rest === '') return [];
            return rest.split(',', POINTER_MAX_NAMES);
        }

        /**
         * Set the current shape, which replaces the top of the stack rather
         * than growing it. An empty name is the specification's "reset the
         * pointer to default" and puts a null there.
         *
         * A set takes one name. The whole payload is that name, commas and
         * all, because the specification says "follow the first char with the
         * name of the shape", singular. Reading it as a list instead would
         * make `=url(...),pointer` two names, and the first half of a valid
         * CSS cursor is exactly what must not get through.
         */
        set(name) {
            const shape = name === '' ? null : pointerShapeOrNull(name);
            // An unsupported name is a no-op. The program can ask first, with
            // `?name`, and gets an honest 0.
            if (name !== '' && shape === null) return;
            const st = this.stack();
            if (st.length === 0) st.push(shape);
            else st[st.length - 1] = shape;
            this.apply();
        }

        /**
         * Push a list, the last name becoming current.
         *
         * An unsupported name still takes a slot, as null, so the pointer goes
         * back to the default for it. Skipping it outright would leave the
         * program's idea of the stack depth one ahead of sip's, and the pop
         * after that restores the wrong shape for the rest of the session.
         * A wrong shape now is cheaper than a stack that never lines up again.
         */
        push(rest) {
            const st = this.stack();
            for (const name of this.names(rest)) {
                st.push(pointerShapeOrNull(name));
                // The specification: the bottom entry is evicted when the
                // stack is full.
                if (st.length > POINTER_STACK_MAX) st.shift();
            }
            this.apply();
        }

        /** Pop the top. A pop past the bottom does nothing, as specified. */
        pop() {
            const st = this.stack();
            if (st.length) st.pop();
            this.apply();
        }

        /**
         * Answer a query with an OSC 22 of sip's own.
         *
         * The reply carries only sip's own constants and the digits 0 and 1.
         * The queried name is never echoed back, so nothing a program sent can
         * reach the PTY through this path.
         */
        query(rest) {
            const out = [];
            for (const name of this.names(rest)) {
                switch (name) {
                    // `0` when the stack is empty, i.e. no shape is set.
                    case '__current__': out.push(this.current() || '0'); break;
                    case '__default__': out.push(this.defaultShape()); break;
                    case '__grabbed__': out.push(POINTER_GRABBED); break;
                    default: out.push(POINTER_SHAPES.has(name) ? '1' : '0'); break;
                }
            }
            if (out.length === 0) return;
            this.sendReply('\x1b]22;' + out.join(',') + '\x1b\\');
        }
    }

    // --- window.sip, the page API ---------------------------------------
    //
    // This is what a deployment's own script may rely on, and the whole of it.
    // Everything else on this page is sip's own: window.sipTerm, the element
    // ids, the settings object and the webterm instance all move without
    // notice, and a script that reads them breaks on an upgrade.
    //
    // Every call was picked because sip can still answer it after the renderer
    // underneath changes. There is no handle to the xterm.js Terminal here for
    // exactly that reason: sip has two renderer branches in flight, and a
    // promise it plans to break is worse than no promise. Nothing here returns
    // a renderer object, and nothing here takes one.
    //
    // It is published while this script parses, before the terminal exists,
    // so a deferred script can subscribe and still catch the ready event. The
    // ready event is sticky: a listener added afterwards is called anyway.
    //
    // What the page may do is the deployment's answer, not sip's. Config.PageAPI
    // in Go names the capabilities, the list arrives in __sipConfig, and every
    // call checks it. See docs/extending.md for the threat model, including
    // what this check does not buy.

    /** Every capability sip defines. An unknown name from a newer server is ignored. */
    const CAP_ALL = ['observe', 'input', 'appearance', 'view', 'read', 'clipboard', 'connection'];

    /**
     * What a deployment that configures nothing grants: the events, the grid
     * size and send. It is what window.sip answered before capabilities
     * existed, and Go's defaultCapabilities is the other half of this pair.
     */
    const CAP_DEFAULT = ['observe', 'input'];

    // Read while this script parses, so a script that loads later cannot widen
    // it by assigning to __sipConfig. A script that runs *earlier* still can:
    // one JavaScript context holds no boundary, and docs/extending.md says so
    // rather than pretending otherwise.
    const grantedCaps = Object.freeze(
        (Array.isArray(sipConfig.pageAPI) ? sipConfig.pageAPI : CAP_DEFAULT)
            .filter((c) => CAP_ALL.indexOf(c) >= 0),
    );
    const grants = new Set(grantedCaps);

    /** Thrown by a call the deployment did not grant. */
    class SipCapabilityError extends Error {
        constructor(cap) {
            super(`sip: this page does not grant the ${cap} capability. `
                + `Add it to Config.PageAPI.Grant in Go.`);
            this.name = 'SipCapabilityError';
            this.capability = cap;
        }
    }

    /**
     * Refuse a call the deployment did not grant.
     *
     * Checked per call rather than once at handoff, because a method that
     * exists and throws tells the developer which capability to grant, and a
     * method that is simply missing reads as sip being broken. It costs one
     * set lookup, and no reference taken earlier can outlive the check.
     */
    function need(cap) {
        if (!grants.has(cap)) throw new SipCapabilityError(cap);
    }

    // --- Values the page hands in ----------------------------------------
    //
    // Everything below refuses a value it does not understand rather than
    // passing it to the browser. Two reasons, and the second is the one that
    // matters: a browser drops a colour or a cursor keyword it cannot parse
    // and silently keeps the old one, so a typo reads as sip ignoring the
    // call; and a value that reaches a CSS property or a link href is a place
    // where a string someone else chose can point the browser somewhere. The
    // page script is the deployment's own code, but what it feeds these calls
    // may not be, and sip is the last thing between the two.

    const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

    // The CSS cursor keywords Appearance.MouseCursor accepts, which is what a
    // page may set too: the protocol's thirty shapes plus the four that are a
    // deployment's to choose and a program's to do without. An allowlist and
    // never a free string, because url(...) is a valid cursor value.
    //
    // Built from POINTER_SHAPES rather than written out again, so the two
    // cannot drift. pointershapes.go holds the same two lists in Go and
    // MOUSE_CURSORS_EXTRA is pinned against it by TestClientMouseCursorsMatchGo.
    const MOUSE_CURSORS_EXTRA = ['none', 'auto', 'context-menu', 'all-scroll'];
    const MOUSE_CURSORS = new Set([...POINTER_SHAPES, ...MOUSE_CURSORS_EXTRA]);
    const CURSOR_STYLES = new Set(['block', 'bar', 'underline']);
    const CURSOR_INACTIVE_STYLES = new Set(['outline', 'block', 'bar', 'underline', 'none']);

    // The theme's field names, which are xterm's own and Go's Theme JSON tags.
    const THEME_KEYS = new Set([
        'foreground', 'background', 'cursor', 'cursorAccent',
        'selectionBackground', 'selectionForeground', 'selectionInactiveBackground',
        'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
        'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
        'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
    ]);

    function checkColor(name, v) {
        const s = String(v);
        if (!HEX_RE.test(s)) {
            throw new TypeError(`sip: ${name} "${s}" is not a hex colour. Write it as #rgb or #rrggbb.`);
        }
        return s;
    }

    function checkKeyword(name, v, allowed) {
        const s = String(v);
        if (!allowed.has(s)) {
            throw new TypeError(`sip: ${name} "${s}" is not one of ${Array.from(allowed).join(', ')}.`);
        }
        return s;
    }

    function checkInt(name, v, lo, hi) {
        const n = Number(v);
        if (!Number.isFinite(n) || Math.floor(n) !== n || n < lo || n > hi) {
            throw new TypeError(`sip: ${name} must be a whole number from ${lo} to ${hi}.`);
        }
        return n;
    }

    /**
     * A CSS font-family list, with the characters that end a declaration
     * removed from the alphabet. The family still has to be one the page has
     * loaded, so this is a syntax gate and not a promise that the font exists.
     */
    function checkFontFamily(v) {
        const s = String(v);
        if (!s || s.length > 200 || /[<>(){};\\]/.test(s) || /[\x00-\x1f\x7f]/.test(s)) {
            throw new TypeError('sip: fontFamily must be a plain CSS font-family list under 200 characters.');
        }
        return s;
    }

    function checkText(name, v, max) {
        const s = String(v).replace(/[\x00-\x1f\x7f]/g, '');
        if (s.length > max) {
            throw new TypeError(`sip: ${name} must be under ${max} characters.`);
        }
        return s;
    }

    /**
     * A URL the page may put in the tab icon's href.
     *
     * Allowlisted by scheme and closed by default, which is what makes a
     * control character or a mixed-case "JavaScript:" a refusal rather than a
     * bypass. The value is assigned as a property and never written into
     * markup, so the risk here is the scheme and only the scheme.
     */
    function checkIconURL(v) {
        const s = String(v).replace(/[\x00-\x20\x7f]/g, '');
        const colon = s.indexOf(':');
        const slash = s.search(/[/?#]/);
        if (colon >= 0 && (slash < 0 || colon < slash)) {
            const scheme = s.slice(0, colon).toLowerCase();
            if (scheme !== 'http' && scheme !== 'https' && scheme !== 'data') {
                throw new TypeError(`sip: favicon "${s}" uses the ${scheme} scheme. Use a relative path or an http, https or data URL.`);
            }
        }
        return s;
    }

    function checkTheme(v) {
        if (!v || typeof v !== 'object') throw new TypeError('sip: theme must be an object of colours.');
        const out = {};
        for (const key of Object.keys(v)) {
            if (!THEME_KEYS.has(key)) {
                throw new TypeError(`sip: theme has no "${key}" colour. See Theme in the Go package for the names.`);
            }
            out[key] = checkColor('theme.' + key, v[key]);
        }
        return out;
    }

    /**
     * Check an appearance patch, field by field, and return the checked copy.
     *
     * An unknown field is refused rather than dropped. That is what keeps the
     * page out of `chrome`, the derived map of CSS custom properties: those
     * carry raw CSS values, sip derives them from a palette it has already
     * checked, and a page that could write them directly would be writing CSS
     * rather than naming a colour.
     */
    function checkAppearance(patch) {
        if (!patch || typeof patch !== 'object') {
            throw new TypeError('sip: appearance.set needs an object.');
        }
        const out = {};
        for (const key of Object.keys(patch)) {
            const v = patch[key];
            switch (key) {
                case 'theme': out.theme = checkTheme(v); break;
                case 'pageBackground': out.pageBackground = checkColor('pageBackground', v); break;
                case 'fontSize': out.fontSize = checkInt('fontSize', v, 1, 200); break;
                case 'fontFamily': out.fontFamily = checkFontFamily(v); break;
                case 'scrollback': out.scrollback = checkInt('scrollback', v, 0, 1000000); break;
                case 'cursorStyle': out.cursorStyle = checkKeyword('cursorStyle', v, CURSOR_STYLES); break;
                case 'cursorInactiveStyle':
                    out.cursorInactiveStyle = checkKeyword('cursorInactiveStyle', v, CURSOR_INACTIVE_STYLES);
                    break;
                case 'cursorBlink': out.cursorBlink = !!v; break;
                case 'mouseCursor': out.mouseCursor = checkKeyword('mouseCursor', v, MOUSE_CURSORS); break;
                case 'title': out.title = checkText('title', v, 512); break;
                case 'favicon': out.favicon = checkIconURL(v); break;
                default:
                    throw new TypeError(`sip: appearance.set has no "${key}" setting. See Appearance in the Go package.`);
            }
        }
        return out;
    }

    // --- The chrome the page repaints ------------------------------------

    /** A hex colour's three channels, or null. Alpha is dropped, as in Go. */
    function hexRGB(c) {
        if (!c || !HEX_RE.test(c)) return null;
        let d = c.slice(1);
        if (d.length === 3 || d.length === 4) d = d[0] + d[0] + d[1] + d[1] + d[2] + d[2];
        const n = parseInt(d.slice(0, 6), 16);
        return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    }

    /** Blend two hex colours, taking frac of b. The same mix Color.mix does. */
    function mixColor(a, b, frac) {
        const x = hexRGB(a);
        const y = hexRGB(b);
        if (!x || !y) return '';
        const ch = (i) => {
            const v = Math.floor(x[i] * (1 - frac) + y[i] * frac + 0.5);
            return Math.min(Math.max(v, 0), 255).toString(16).padStart(2, '0');
        };
        return '#' + ch(0) + ch(1) + ch(2);
    }

    /**
     * The page's own colours, derived from the palette.
     *
     * Appearance.chrome in Go does this for what the deployment configured,
     * and the server sends the result. A page that repaints the palette has no
     * such producer, so the same derivation lives here, and
     * pageapi.spec.mjs pins the two against each other by feeding this the
     * palette the server already derived and comparing the maps.
     */
    function deriveChrome(theme, pageBackground) {
        const t = theme || {};
        const bg = pageBackground || t.background || '';
        const out = {};
        const set = (prop, c) => { if (c) out[prop] = c; };
        set('--sip-bg', bg);
        set('--webterm-background', bg);
        set('--webterm-scrollbar', t.brightBlack);
        set('--sip-fg', t.foreground);
        set('--sip-border', t.black);
        set('--sip-border-strong', t.brightBlack);
        set('--sip-muted', t.brightWhite);
        set('--sip-accent', t.blue);
        set('--sip-accent-strong', t.brightBlue);
        set('--sip-ok', t.green);
        set('--sip-warn', t.yellow);
        set('--sip-error', t.red);
        set('--sip-cursor', t.cursor);
        set('--sip-surface', mixColor(bg, t.foreground, 0.12));
        const rgb = hexRGB(bg);
        if (rgb) {
            out['--sip-bg-rgb'] = rgb.join(', ');
            const bar = hexRGB(mixColor(bg, '#000000', 0.10));
            if (bar) out['--sip-bar-bg-rgb'] = bar.join(', ');
        }
        return out;
    }

    // --- The appearance the page is painted with -------------------------
    //
    // Three layers, in this order: sip's built-in constants, the deployment's
    // Appearance, and the patch a page script made with appearance.set. The
    // page's patch is an answer and outranks the deployment's default, the
    // same rule the settings panel already follows, so a reconnect re-applying
    // the deployment's blob must not pull a live theme back.

    /** What the page was rendered with, until the client is constructed. */
    let seededAppearance = sipConfig.appearance || {};

    /** What appearance.set has asked for, kept so a reconnect can re-apply it. */
    const pagePatch = {};

    /** The deployment appearance under the patch, merged. */
    function mergeAppearance(base, patch) {
        const out = Object.assign({}, base, patch);
        if (base.theme || patch.theme) {
            out.theme = Object.assign({}, base.theme, patch.theme);
        }
        // The server's chrome map was derived from the deployment's palette
        // alone, so a patch that moves a colour has to derive it again.
        if (patch.theme || patch.pageBackground) {
            out.chrome = deriveChrome(out.theme, out.pageBackground);
        }
        return out;
    }

    /** The appearance in force: the deployment's, with the page's patch over it. */
    function currentAppearance() {
        return sipClient ? sipClient.appearance : seededAppearance;
    }

    /**
     * Put the page's patch back on top of the deployment's appearance.
     *
     * Called when the patch changes, when the terminal opens and after every
     * handshake, because MsgOptions carries the deployment's blob and would
     * otherwise undo a live theme on the first reconnect.
     */
    function applyPagePatch() {
        if (Object.keys(pagePatch).length === 0) return;
        const base = sipClient ? sipClient.appearance : seededAppearance;
        const eff = mergeAppearance(base, pagePatch);
        if (sipClient) sipClient.appearance = eff;
        else seededAppearance = eff;

        applyPageAppearance(eff);
        if (pagePatch.title !== undefined) document.title = pagePatch.title;

        if (!sipClient || !sipClient.webterm) return;
        const opts = {};
        if (pagePatch.theme !== undefined) opts.theme = mergeTheme(eff);
        if (pagePatch.fontSize !== undefined) opts.fontSize = pagePatch.fontSize;
        if (pagePatch.fontFamily !== undefined) opts.fontFamily = pagePatch.fontFamily;
        if (pagePatch.cursorBlink !== undefined) opts.cursorBlink = pagePatch.cursorBlink;
        if (pagePatch.cursorStyle !== undefined) opts.cursorStyle = pagePatch.cursorStyle;
        if (pagePatch.scrollback !== undefined) opts.scrollback = pagePatch.scrollback;
        if (pagePatch.cursorInactiveStyle !== undefined) {
            opts.xterm = { cursorInactiveStyle: pagePatch.cursorInactiveStyle };
        }
        if (Object.keys(opts).length) sipClient.webterm.setOptions(opts);
    }

    // --- Search over the grid --------------------------------------------
    //
    // No renderer object escapes, and none is promised: a match is a row, a
    // column and a length, which any renderer that owns a grid can answer.
    //
    // A terminal wraps constantly, so a search that stopped at the row
    // boundary would miss most of what is on the screen. Rows are joined into
    // the logical line they came from, the match is found there, and the
    // column is measured back out of the row it started in. A wide character
    // is one character in two columns, which is why that last step is a
    // measurement and not an index.

    const MAX_QUERY = 256;

    /** The buffer rows, joined into the logical lines they wrapped from. */
    function logicalLines(buf) {
        const lines = [];
        for (let i = 0; i < buf.length; i++) {
            const row = buf.getLine(i);
            if (!row) continue;
            const text = row.translateToString(false);
            const last = lines[lines.length - 1];
            if (row.isWrapped && last) {
                last.text += text;
                last.segments.push({ row: i, length: text.length });
                continue;
            }
            lines.push({ row: i, text, segments: [{ row: i, length: text.length }] });
        }
        return lines;
    }

    /** The column a character index sits at, measured through the row's cells. */
    function columnAt(row, charIndex) {
        if (charIndex <= 0) return 0;
        let lo = 0;
        let hi = row.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (row.translateToString(false, 0, mid).length < charIndex) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    /** Where a character index inside a logical line lands in the buffer. */
    function bufferPosition(buf, line, index) {
        let left = index;
        for (const seg of line.segments) {
            if (left < seg.length) {
                return { row: seg.row, col: columnAt(buf.getLine(seg.row), left) };
            }
            left -= seg.length;
        }
        return { row: line.row, col: 0 };
    }

    /** The terminal's search, over the buffer rather than over the renderer. */
    const search = {
        query: '',
        caseSensitive: false,
        match: null,

        run(query, opts) {
            const term = sipClient && sipClient.term;
            if (!term) return null;
            const q = String(query);
            if (!q || q.length > MAX_QUERY) return null;
            const o = opts || {};
            const caseSensitive = !!o.caseSensitive;
            const backwards = !!o.backwards;
            this.query = q;
            this.caseSensitive = caseSensitive;

            const buf = term.buffer.active;
            const lines = logicalLines(buf);
            const needle = caseSensitive ? q : q.toLowerCase();

            // Start where the last match was, so next and previous walk.
            const from = this.match ? this.match.row : buf.viewportY;
            let startLine = 0;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].row <= from) startLine = i;
                else break;
            }

            for (let n = 0; n <= lines.length; n++) {
                const i = backwards
                    ? (startLine - n + lines.length * 2) % lines.length
                    : (startLine + n) % lines.length;
                const line = lines[i];
                const hay = caseSensitive ? line.text : line.text.toLowerCase();
                // Skip the match the caller is already sitting on, so a
                // second call moves instead of answering the same row.
                let index = -1;
                if (n === 0 && this.match && this.match.line === line.row) {
                    index = backwards
                        ? hay.lastIndexOf(needle, Math.max(0, this.match.index - 1))
                        : hay.indexOf(needle, this.match.index + 1);
                } else {
                    index = backwards ? hay.lastIndexOf(needle) : hay.indexOf(needle);
                }
                if (index < 0) continue;

                const at = bufferPosition(buf, line, index);
                this.match = { line: line.row, index, row: at.row, col: at.col, length: q.length };
                term.select(at.col, at.row, q.length);
                if (at.row < buf.viewportY || at.row >= buf.viewportY + term.rows) {
                    term.scrollToLine(Math.max(0, at.row - Math.floor(term.rows / 2)));
                }
                return { row: at.row, col: at.col, length: q.length };
            }
            this.match = null;
            return null;
        },

        reset() {
            this.query = '';
            this.match = null;
            const term = sipClient && sipClient.term;
            if (term) term.clearSelection();
        },
    };

    // --- The API objects --------------------------------------------------

    const sipListeners = new Map();
    let sipReadyDetail = null;
    let sipClient = null;

    function sipCall(name, fn, detail) {
        try {
            fn(detail);
        } catch (e) {
            console.error(`sip: a ${name} listener threw`, e);
        }
    }

    /** Tell the page's own scripts what just happened. */
    function sipEmit(name, detail) {
        if (name === 'ready') sipReadyDetail = detail;
        const fns = sipListeners.get(name);
        if (!fns) return;
        for (const fn of Array.from(fns)) sipCall(name, fn, detail);
    }

    /** The terminal, or null before the page's terminal has opened. */
    function term() {
        return sipClient ? sipClient.term : null;
    }

    /** Whether sip.claim has already handed the API over. */
    let claimed = false;

    // --- The four calls window.sip has always carried --------------------
    //
    // They are closure functions rather than properties read off window.sip,
    // and the claimed object holds these and not the object. window.sip is a
    // plain object the page may decorate, and a script that replaces
    // window.sip.on must not thereby see the events a deployment's own
    // claimed handle receives. It is the same bar sip.claim raises, held at
    // the same place.

    /**
     * Listen for a page event. Returns a function that removes the
     * listener, so a caller need not keep the callback to undo it.
     *
     *   ready      {cols, rows}   the terminal exists, before it connects
     *   connect    {transport}    a transport is carrying the session
     *   disconnect {reason}       'closed' if the session ended, 'lost' otherwise
     *   resize     {cols, rows}   the grid changed shape
     *   title      {title}        the program renamed the browser tab
     *
     * A listener that throws is reported to the console and the rest still
     * run: a deployment's script must not be able to stop the terminal.
     */
    function apiOn(name, fn) {
        need('observe');
        if (typeof fn !== 'function') throw new TypeError('sip.on needs a function');
        let fns = sipListeners.get(name);
        if (!fns) sipListeners.set(name, (fns = new Set()));
        fns.add(fn);
        if (name === 'ready' && sipReadyDetail) {
            queueMicrotask(() => {
                if (fns.has(fn)) sipCall(name, fn, sipReadyDetail);
            });
        }
        return () => apiOff(name, fn);
    }

    /** Stop listening. Safe to call with a function that never listened. */
    function apiOff(name, fn) {
        need('observe');
        const fns = sipListeners.get(name);
        if (fns) fns.delete(fn);
    }

    /**
     * Send terminal input, as if it had been typed. Returns a promise that
     * settles once the bytes have left. A read-only session and a page whose
     * terminal has not opened both accept the call and send nothing.
     */
    function apiSend(data) {
        need('input');
        if (!sipClient) return Promise.resolve();
        return sipClient.sendInput(String(data));
    }

    /** The grid's shape, or null before the ready event. */
    function apiSize() {
        need('observe');
        const t = term();
        return t ? { cols: t.cols, rows: t.rows } : null;
    }

    const sipApi = {
        on: apiOn,
        off: apiOff,
        send: apiSend,
        size: apiSize,

        /** The capabilities this deployment granted, as names. */
        capabilities() {
            return grantedCaps;
        },

        /**
         * Take the page API, once.
         *
         * The object it returns carries every granted capability. It is handed
         * over instead of parked on window, so a script that loads after this
         * one — an analytics tag, a widget, anything appended at runtime —
         * cannot reach the powerful half of the API unless your own code hands
         * it over. That raises the bar. It is not a boundary: a script that
         * runs before sip's client can patch anything it likes, and
         * docs/extending.md says so plainly.
         *
         * Call it early, from your own script. An API nobody has claimed is
         * there for whatever runs next.
         */
        claim() {
            if (claimed) {
                throw new Error('sip: the page API is claimed already. sip.claim() answers once. '
                    + 'Keep the object your own script took and pass it on from there.');
            }
            claimed = true;
            return claimedApi;
        },
    };

    /** Reads and writes that are not on window.sip. See sip.claim. */
    const claimedApi = Object.freeze({
        /** The shape of this API. It goes up when a call changes meaning. */
        version: 1,
        capabilities: () => grantedCaps,

        on: apiOn,
        off: apiOff,
        send: apiSend,
        size: apiSize,

        /**
         * What the terminal is doing: whether a transport is carrying it,
         * which one, whether the session refuses input, which renderer drew
         * the grid and how big the grid is. Null before the terminal opens.
         */
        status() {
            need('observe');
            const t = term();
            if (!t) return null;
            return Object.freeze({
                connected: !!sipClient.connected,
                transport: sipClient.currentTransport,
                readOnly: !!sipClient.readOnly,
                renderer: sipClient.currentRenderer,
                cols: t.cols,
                rows: t.rows,
            });
        },

        input: Object.freeze({
            /** Send input, as if it had been typed. */
            send: apiSend,

            /**
             * Paste text, the way the browser's own paste does, so a program
             * in bracketed paste mode sees it as a paste and not as typing.
             */
            paste(text) {
                need('input');
                if (!sipClient || !sipClient.webterm) return;
                sipClient.webterm.paste(String(text));
            },
        }),

        appearance: Object.freeze({
            /**
             * The appearance in force: the deployment's, with whatever this
             * page has set over it.
             *
             * It reports what sip was told to paint. A program that changes a
             * colour with an escape sequence changes the terminal and not
             * this, because a value a program chose is not a value the page
             * asked for.
             */
            get() {
                need('appearance');
                const a = currentAppearance();
                return Object.freeze({
                    theme: Object.freeze(mergeTheme(a)),
                    fontSize: sipClient ? sipClient.settings.fontSize : (a.fontSize || 0),
                    fontFamily: sipClient ? sipClient.fontFamily : (a.fontFamily || ''),
                    cursorStyle: a.cursorStyle || 'block',
                    cursorInactiveStyle: a.cursorInactiveStyle || 'outline',
                    cursorBlink: sipClient ? !!sipClient.settings.cursorBlink : !!a.cursorBlink,
                    scrollback: a.scrollback || 5000,
                    mouseCursor: a.mouseCursor || '',
                    title: document.title,
                    favicon: a.favicon || '',
                });
            },

            /**
             * Repaint. The patch carries any of the fields get returns, and
             * every one is checked before it reaches the browser.
             *
             * It works before the terminal opens, which is where a page that
             * picks a theme from local storage wants it: the first paint is
             * then already the right one.
             */
            set(patch) {
                need('appearance');
                const checked = checkAppearance(patch);
                if (checked.theme) {
                    pagePatch.theme = Object.assign({}, pagePatch.theme, checked.theme);
                    delete checked.theme;
                }
                Object.assign(pagePatch, checked);
                applyPagePatch();
            },

            /** Drop what this page set and go back to the deployment's appearance. */
            reset() {
                need('appearance');
                for (const key of Object.keys(pagePatch)) delete pagePatch[key];
                if (sipClient) {
                    sipClient.applyAppearance(sipClient.serverAppearance || sipConfig.appearance || {});
                }
            },
        }),

        view: Object.freeze({
            scrollToTop() { need('view'); const t = term(); if (t) t.scrollToTop(); },
            scrollToBottom() { need('view'); const t = term(); if (t) t.scrollToBottom(); },
            /** Scroll by whole lines. A negative count scrolls back. */
            scrollLines(count) {
                need('view');
                const n = checkInt('scrollLines', count, -1000000, 1000000);
                const t = term();
                if (t) t.scrollLines(n);
            },
            /** Throw the scrollback away and keep the line the cursor is on. */
            clear() { need('view'); const t = term(); if (t) t.clear(); },
            focus() { need('view'); if (sipClient && sipClient.webterm) sipClient.webterm.focus(); },
            blur() { need('view'); if (sipClient && sipClient.webterm) sipClient.webterm.blur(); },
        }),

        selection: Object.freeze({
            /** Whether anything is selected. */
            has() { need('read'); const t = term(); return t ? t.hasSelection() : false; },
            /** The selected text. This is what the program printed. */
            get() { need('read'); const t = term(); return t ? t.getSelection() : ''; },
            clear() { need('read'); const t = term(); if (t) t.clearSelection(); },
            selectAll() { need('read'); const t = term(); if (t) t.selectAll(); },
        }),

        search: Object.freeze({
            /**
             * Find text on the screen or in the scrollback, select it and
             * scroll to it. Returns {row, col, length} or null.
             *
             * Options: caseSensitive and backwards. The query is plain text,
             * never a pattern: a regular expression from a page script is the
             * page's own runtime to lose.
             */
            find(query, opts) {
                need('read');
                return search.run(query, opts);
            },
            /** The next match for the last query. */
            findNext() {
                need('read');
                return search.query ? search.run(search.query, { caseSensitive: search.caseSensitive }) : null;
            },
            /** The previous match for the last query. */
            findPrevious() {
                need('read');
                return search.query
                    ? search.run(search.query, { caseSensitive: search.caseSensitive, backwards: true })
                    : null;
            },
            /** Forget the query and drop the selection. */
            clear() { need('read'); search.reset(); },
        }),

        clipboard: Object.freeze({
            /**
             * Copy the selection to the system clipboard. Returns a promise
             * for whether it landed.
             *
             * The text does not pass through the caller, which is why this is
             * not the read capability. Reading the clipboard is not here at
             * all: the browser's own navigator.clipboard is the API for that,
             * it asks the user, and sip has nothing to add but a second door.
             */
            copySelection() {
                need('clipboard');
                const t = term();
                const text = t ? t.getSelection() : '';
                if (!text) return Promise.resolve(false);
                return sipClient.copyText(text);
            },
        }),

        connection: Object.freeze({
            /**
             * Close the session and open a new one.
             *
             * The program the user was running dies with the old session. This
             * is a reconnect button, not a way to recover a dropped link: the
             * client already reconnects on its own when a transport fails.
             */
            reconnect() {
                need('connection');
                if (!sipClient) return Promise.resolve();
                return sipClient.reconnect();
            },
        }),
    });

    window.sip = sipApi;

    /**
     * Resolve sip's endpoint URLs against the document base URI, so the page
     * keeps working when the index is served at a non-root path behind a
     * reverse proxy.
     *
     * The WebTransport URL here is only a fallback for a /cert-hash response
     * that omits wtUrl. Normally the server advertises the authoritative
     * endpoint, derived from the host the browser actually reached, and that
     * is the value the same-origin check on both transports expects.
     */
    function resolveSipURLs(baseURI) {
        const base = new URL('./', baseURI);
        const wsScheme = base.protocol === 'https:' ? 'wss:' : 'ws:';
        const httpPort = base.port ? parseInt(base.port, 10) : (base.protocol === 'https:' ? 443 : 80);
        return {
            wsUrl: `${wsScheme}//${base.host}${base.pathname}ws`,
            wtUrl: `https://${base.hostname}:${httpPort + 1}/webtransport`,
            certHashUrl: `${base.origin}${base.pathname}cert-hash`,
        };
    }

    /**
     * sip's wire protocol as a webterm Transport.
     *
     * webterm hands over raw input bytes and knows nothing about the framing;
     * everything sip-specific lives here. `send` is the Transport method and
     * carries terminal input only. Resize, ping and any other control message
     * goes through sendMessage, which the client calls directly, because those
     * are not terminal traffic and the package has no notion of them.
     */
    class SipConnection {
        constructor(client) {
            this.client = client;
            this.sink = null;
            this.ready = null;
            this.closed = false;

            this.useWebTransport = false;
            this.ws = null;
            this.wt = null;
            this.wtWriter = null;
            this.wtReader = null;
            this.webTransportUnavailable = false;
            this.name = 'sip';
        }

        // --- Transport ----------------------------------------------------

        start(sink) {
            this.sink = sink;
            this.ready = this.connect();
            return this.ready;
        }

        /**
         * Terminal input, already chunked by webterm to input.chunkBytes.
         *
         * This is the last point at which a keystroke is still visible as
         * itself, which is why the key bar's sticky modifiers are folded in
         * here: xterm has already encoded the key by the time the client sees
         * it, and a software keyboard never produced a key event to modify in
         * the first place. Off a touch device the call returns its argument.
         */
        send(bytes) {
            return this.sendMessage(MSG_INPUT, this.client.applyBarState(bytes));
        }

        close() {
            this.teardown();
        }

        // --- Connection ---------------------------------------------------

        async connect() {
            const preference = this.client.settings.transport;
            const wantsWebTransport = preference === 'auto' || preference === 'webtransport';
            this.webTransportUnavailable = false;

            if (wantsWebTransport && typeof WebTransport !== 'undefined') {
                try {
                    await this.connectWebTransport();
                    return;
                } catch (e) {
                    console.log('WebTransport unavailable:', e.message);
                    this.webTransportUnavailable = true;
                    // Drop the half-open transport so the fallback below does
                    // not inherit it and teardown has nothing stale to close.
                    if (this.wt) { try { this.wt.close(); } catch (_) {} this.wt = null; }
                }
            } else if (preference === 'webtransport') {
                console.log('WebTransport requested but this browser does not support it');
                this.webTransportUnavailable = true;
            }

            // Fall back even when WebTransport was explicitly chosen. Chromium
            // refuses a QUIC connection to a loopback origin with a self-signed
            // cert hash where Firefox accepts it, so an honoured preference on
            // one machine is an unreachable one on the next; leaving a dead
            // page there helps nobody. The status line names the transport that
            // actually carried the session, so the fallback is visible rather
            // than silent.
            await this.connectWebSocket();
        }

        async connectWebTransport() {
            const urls = this.client.urls;
            let transportOptions = {};
            let wtUrl = urls.wtUrl;

            try {
                const resp = await fetch(urls.certHashUrl);
                if (resp.ok) {
                    const data = await resp.json();
                    // Prefer the server's own advertised endpoint: it is
                    // derived from the host the browser actually reached, and
                    // the same-origin check on both transports expects that
                    // value rather than a guess.
                    if (data.wtUrl) wtUrl = data.wtUrl;

                    const hashBytes = new Uint8Array(data.hashBytes);
                    transportOptions = {
                        serverCertificateHashes: [{
                            algorithm: 'sha-256',
                            value: hashBytes.buffer
                        }]
                    };
                }
            } catch (e) {}

            const wt = new WebTransport(wtUrl, transportOptions);
            this.wt = wt;

            // Only report a close once this transport is the one carrying the
            // session. A failed handshake settles `closed` too, and treating
            // that as a session close would tear the connection down before
            // the WebSocket fallback has even been tried.
            const reportIfLive = () => {
                if (this.useWebTransport && this.wt === wt) this.reportClosed();
            };
            wt.closed.then(reportIfLive, reportIfLive);

            await wt.ready;

            this.useWebTransport = true;
            const stream = await this.wt.createBidirectionalStream();
            this.wtWriter = stream.writable.getWriter();
            this.wtReader = stream.readable.getReader();

            this.client.onConnected('WebTransport (QUIC)', 'webtransport', 'Connected (QUIC)');
            this.readLoop();
        }

        connectWebSocket() {
            return new Promise((resolve, reject) => {
                this.ws = new WebSocket(this.client.urls.wsUrl);
                this.ws.binaryType = 'arraybuffer';

                this.ws.onopen = () => {
                    this.useWebTransport = false;
                    const name = this.webTransportUnavailable
                        ? 'WebSocket (WebTransport unavailable)'
                        : 'WebSocket';
                    this.client.onConnected(name, 'connected', `Connected (${name})`);
                    resolve();
                };

                this.ws.onmessage = event => {
                    if (event.data instanceof ArrayBuffer) {
                        this.client.handleMessage(new Uint8Array(event.data));
                    }
                };

                this.ws.onerror = reject;
                this.ws.onclose = () => this.reportClosed();
            });
        }

        /**
         * Reassemble the length-prefixed frames sip puts on a WebTransport
         * stream. A QUIC stream is a byte stream with no message boundaries,
         * so the 4-byte big-endian prefix is what re-establishes them.
         */
        async readLoop() {
            if (!this.wtReader) return;

            let buffer = new Uint8Array(64 * 1024);
            let bufferLen = 0;

            try {
                while (true) {
                    const { value, done } = await this.wtReader.read();
                    if (done) break;

                    if (bufferLen + value.length > buffer.length) {
                        const grown = new Uint8Array(Math.max(buffer.length * 2, bufferLen + value.length));
                        grown.set(buffer.subarray(0, bufferLen));
                        buffer = grown;
                    }

                    buffer.set(value, bufferLen);
                    bufferLen += value.length;

                    let offset = 0;
                    while (bufferLen - offset >= 4) {
                        const msgLen = new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0, false);

                        if (msgLen > MAX_FRAME_BYTES) {
                            console.error('WebTransport frame too large:', msgLen);
                            return;
                        }

                        if (bufferLen - offset < 4 + msgLen) break;

                        this.client.handleMessage(buffer.subarray(offset + 4, offset + 4 + msgLen));
                        offset += 4 + msgLen;
                    }

                    if (offset > 0) {
                        if (bufferLen > offset) buffer.copyWithin(0, offset, bufferLen);
                        bufferLen -= offset;
                    }
                }
            } catch (e) {
                if (!this.closed) console.error('WebTransport read error:', e);
            }
        }

        /** Prefix `payload` with its message type and put it on the wire. */
        async sendMessage(type, payload) {
            if (this.closed) return;

            const body = payload || new Uint8Array(0);
            const msg = new Uint8Array(body.length + 1);
            msg[0] = type;
            msg.set(body, 1);

            try {
                if (this.useWebTransport && this.wtWriter) {
                    const frame = new Uint8Array(4 + msg.length);
                    new DataView(frame.buffer).setUint32(0, msg.length, false);
                    frame.set(msg, 4);
                    await this.wtWriter.write(frame);
                } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(msg);
                }
            } catch (e) {
                console.error('Send error:', e);
            }
        }

        reportClosed() {
            if (this.closed) return;
            this.teardown();
            if (this.sink) this.sink.closed();
            this.client.handleDisconnect();
        }

        teardown() {
            if (this.closed) return;
            this.closed = true;

            if (this.wtWriter) { try { this.wtWriter.releaseLock(); } catch (_) {} this.wtWriter = null; }
            if (this.wtReader) { try { this.wtReader.releaseLock(); } catch (_) {} this.wtReader = null; }
            if (this.wt) { try { this.wt.close(); } catch (_) {} this.wt = null; }
            if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
        }
    }

    class SipTerminal {
        constructor() {
            this.webterm = null;
            this.connection = null;
            this.connected = false;
            this.readOnly = false;
            // The OSC 22 pointer shape state. Built once the terminal exists,
            // because it hangs off xterm's parser and its buffers.
            this.pointer = null;

            this.reconnectAttempts = 0;
            this.maxReconnectAttempts = 5;
            this.reconnectDelay = 1000;
            this.pingInterval = null;

            this.encoder = new TextEncoder();
            this.decoder = new TextDecoder();

            // Seeded from the deployment's blob, and already carrying
            // whatever a page script set before the terminal was built.
            this.appearance = seededAppearance;
            // The deployment's own blob, kept so appearance.reset can go back
            // to it after a page script has repainted.
            this.serverAppearance = null;
            this.storedSettings = {};
            // Whether the program has named the tab itself. Until it does,
            // the configured title stands; after it does, a reconnect must
            // not pull the tab back to the deployment's name.
            this.sawTitle = false;
            this.settings = this.loadSettings();
            this.fontFamily = sipConfig.fontFamily || FONT_FAMILY;
            // Replaced by the key bar on a touch device, inert everywhere else.
            this.mobile = { enabled: false, mods: { ctrl: 0, alt: 0 }, pending: false, transformInput: (t) => t };
            this.currentTransport = 'unknown';
            this.urls = resolveSipURLs(document.baseURI);

            this.statusEl = null;
            this.statusTextEl = null;
        }

        // --- Handles the browser tests and the console reach for ------------
        //
        // These kept their names across the move to the webterm package, so the
        // suites in clienttests/ still describe the client rather than the
        // wrapper underneath it.

        get term() {
            return this.webterm ? this.webterm.xterm : null;
        }

        get kittyOverlay() {
            return this.webterm ? this.webterm.kitty : null;
        }

        get imageAddon() {
            return this.webterm ? this.webterm.image : null;
        }

        /** 'vtgl' | 'WebGL' | 'Canvas' | 'DOM', the labels the settings panel shows. */
        get currentRenderer() {
            if (!this.webterm) return 'unknown';
            switch (this.webterm.renderer) {
                case 'vtgl': return 'vtgl';
                case 'webgl': return 'WebGL';
                case 'canvas': return 'Canvas';
                default: return 'DOM';
            }
        }

        loadSettings() {
            let stored = {};
            try {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) stored = JSON.parse(saved) || {};
            } catch (e) {}
            const settings = Object.assign({}, DEFAULT_SETTINGS, stored);
            // What the user chose themselves, kept so a later options blob
            // can tell a deployment default from a user's answer.
            this.storedSettings = stored;
            // A ?renderer= query param pins a backend for the browser tests
            // without touching stored settings; the per-deployment config from
            // the sip --renderer flag outranks a default but not a saved
            // preference the user set themselves.
            const q = new URLSearchParams(window.location.search).get('renderer');
            if (q) settings.renderer = q;
            else if (!stored.renderer && sipConfig.renderer) settings.renderer = sipConfig.renderer;
            // The deployment's defaults, which outrank sip's own and lose to
            // anything the user set in the settings panel. Same rule the
            // renderer preference follows, for the same reason: a deployment
            // picks a starting point, a user picks an answer.
            if (this.appearance.fontSize && stored.fontSize === undefined) {
                settings.fontSize = this.appearance.fontSize;
            }
            if (this.appearance.cursorBlink && stored.cursorBlink === undefined) {
                settings.cursorBlink = true;
            }
            // A narrow touch screen starts a point smaller so the program has
            // some columns to work with, but only until the user picks a size,
            // which is what a stored fontSize means.
            if (SipMobile) {
                settings.fontSize = SipMobile.pickFontSize(settings.fontSize, stored.fontSize !== undefined);
            }
            return settings;
        }

        saveSettings() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
            } catch (e) {}
            // Everything in the panel is now the user's answer, so a later
            // options blob must not push a deployment default over it.
            this.storedSettings = Object.assign({}, this.settings);
        }

        /**
         * Take the appearance the server sent at the handshake.
         *
         * The same blob was already seeded into the page from __sipConfig, so
         * this is normally a no-op that costs one setOptions. It is not
         * redundant: it is the only route into a page sip did not render, and
         * it is what re-applies the deployment's palette after a reconnect to
         * a server whose config has changed.
         *
         * An absent blob is not "clear everything". A server that knows
         * nothing about appearance sends no field, and the page keeps what it
         * has, which is what an old tab reconnecting needs.
         */
        applyAppearance(a) {
            if (!a) return;
            this.appearance = a;
            this.serverAppearance = a;
            applyPageAppearance(a);
            if (a.title && !this.sawTitle) document.title = a.title;

            // The two settings the user may have answered themselves. The
            // deployment sets the default and loses to a stored answer.
            if (a.fontSize && this.storedSettings.fontSize === undefined) {
                this.settings.fontSize = a.fontSize;
            }
            if (a.cursorBlink && this.storedSettings.cursorBlink === undefined) {
                this.settings.cursorBlink = true;
            }

            if (this.webterm) {
                this.webterm.setOptions({
                    theme: mergeTheme(a),
                    fontSize: this.settings.fontSize,
                    cursorBlink: this.settings.cursorBlink,
                    cursorStyle: a.cursorStyle || 'block',
                    scrollback: a.scrollback || 5000,
                    xterm: {
                        cursorInactiveStyle: a.cursorInactiveStyle || 'outline',
                        tabStopWidth: 8,
                    },
                });
            }

            // The deployment's blob has just overwritten everything, so what
            // a page script asked for goes back on top. Without this a
            // reconnect pulls a live theme back to the deployment's.
            applyPagePatch();
        }

        /** The webterm option groups derived from sip's stored settings. */
        webtermOptions() {
            return {
                fontFamily: this.fontFamily,
                fontSize: this.settings.fontSize,
                // A custom deployment font arrives through the server's
                // injected @font-face rule, so only the embedded family is
                // named here. webterm awaits these before it constructs the
                // Terminal, which is what keeps the cell box off the fallback.
                fonts: [
                    { source: 'url(static/fonts/JetBrainsMonoNerdFontMono-Regular.ttf)', weight: '400', style: 'normal' },
                    { source: 'url(static/fonts/JetBrainsMonoNerdFontMono-Bold.ttf)', weight: '700', style: 'normal' },
                    { source: 'url(static/fonts/JetBrainsMonoNerdFontMono-Italic.ttf)', weight: '400', style: 'italic' },
                    { source: 'url(static/fonts/JetBrainsMonoNerdFontMono-BoldItalic.ttf)', weight: '700', style: 'italic' },
                ],
                theme: mergeTheme(this.appearance),
                cursorBlink: this.settings.cursorBlink,
                cursorStyle: this.appearance.cursorStyle || 'block',
                scrollback: this.appearance.scrollback || 5000,
                links: true,
                renderer: { prefer: this.settings.renderer },
                clipboard: { copyOnSelect: this.settings.copyOnSelect },
                // The scrollback anchor, so an image scrolls away with the text
                // that introduced it, which is what a shell running an image
                // viewer expects. A full-screen compositor is unaffected: the
                // alternate screen has no scrollback, so there the anchoring
                // row and the screen row are the same row.
                graphics: { kitty: { anchor: 'scrollback' }, sixel: true },
                keyboard: {
                    captureReservedKeys: this.settings.captureReservedKeys,
                    reservedKeys: RESERVED_KEYS,
                },
                mouse: { suppressContextMenu: !this.settings.browserContextMenu },
                input: { chunkBytes: INPUT_CHUNK_SIZE, readOnly: false },
                xterm: {
                    cursorInactiveStyle: this.appearance.cursorInactiveStyle || 'outline',
                    tabStopWidth: 8,
                },
            };
        }

        async init() {
            // Before the terminal is constructed, so the deployment's ground
            // colour is the first one painted rather than a flash of sip's.
            applyPageAppearance(this.appearance);
            if (this.appearance.title) document.title = this.appearance.title;

            this.statusEl = document.getElementById('connection-status');
            this.statusTextEl = document.getElementById('status-text');
            this.updateStatus('connecting', 'Initializing terminal...');

            // A page sip did not write may not have the element the terminal
            // opens into. Say so on the screen and in the console: the failure
            // is otherwise a blank page with a thrown promise nobody sees.
            const host = document.getElementById('terminal');
            if (!host) {
                console.error('sip: this page has no element with id "terminal". The terminal cannot open.');
                this.updateStatus('disconnected', 'This page has no terminal element');
                return;
            }

            this.webterm = new WebTerm(this.webtermOptions());
            await this.webterm.open(host);
            // A page script runs before the terminal is constructed, so a
            // theme or a font size it set is waiting for this moment.
            applyPagePatch();

            // The pointer shape protocol. The reply to a query takes
            // sendInput, which is the path a keystroke takes, because a reply
            // is input as far as the program is concerned. That also gets the
            // read-only case right for free: a session that sends no
            // keystrokes sends no replies either.
            this.pointer = new PointerShapes(
                this.term,
                (reply) => { this.sendInput(reply).catch(() => {}); },
                () => defaultPointerShape(this.appearance, this.term),
            );

            // Input, mouse reports and kitty protocol replies leave through the
            // attached transport on their own. What is wired here is the part
            // that is sip's: the resize message, the page title and the bell.
            this.webterm.on('resize', () => {
                if (this.connected) this.sendResize();
                sipEmit('resize', { cols: this.term.cols, rows: this.term.rows });
            });
            this.webterm.on('title', title => {
                this.setTitle(title);
            });
            this.webterm.on('bell', () => {
                const c = document.getElementById('terminal-container');
                if (!c) return;
                c.style.outline = '2px solid var(--sip-warn, #f9e2af)';
                setTimeout(() => { c.style.outline = 'none'; }, 150);
            });

            this.setupCopyKeys();
            this.setupSettingsPanel();
            this.setupMobile();
            // The page's own scripts get their handle before the connection
            // opens, so a listener registered here still sees the first
            // connect event.
            sipEmit('ready', { cols: this.term.cols, rows: this.term.rows });

            await this.connect();
            this.webterm.focus();
        }

        // --- Copy ------------------------------------------------------------

        /**
         * Bind the copy chords.
         *
         * webterm owns paste (xterm listens for the browser's native paste
         * event, so Ctrl+V and Ctrl+Shift+V already arrive) and it owns OSC 52,
         * but it binds no copy chord, so Ctrl+C on a selection used to fall
         * straight through to the encoder: the selection stayed on screen and
         * the shell got an interrupt. Nothing in webterm claims the custom key
         * handler slot, so taking it here does not displace anything.
         */
        setupCopyKeys() {
            this.webterm.xterm.attachCustomKeyEventHandler(ev => {
                // The handler runs for keypress as well as keydown; acting on
                // both would copy twice for one chord.
                if (ev.type !== 'keydown') return true;
                if (!ev.ctrlKey || ev.altKey || ev.metaKey) return true;
                if (ev.code !== 'KeyC') return true;

                // The branch the whole fix turns on. Ctrl+C is overloaded: it
                // is the only way to interrupt the foreground program, and it
                // is what everyone reaches for to copy. Terminals resolve that
                // by letting the selection decide, because a selection is a
                // deliberate act that says "this chord is about text". With no
                // selection there is nothing to copy, so the chord has to stay
                // an interrupt or the terminal becomes unusable.
                //
                // Ctrl+Shift+C copies too where it survives the browser, but it
                // is not the path to rely on: Chromium and Firefox both reserve
                // it for devtools and it never reaches the page.
                const selection = this.webterm.xterm.getSelection();
                if (!selection) return true;

                // Returning false stops xterm encoding the chord, but it does
                // not suppress the browser's own copy, which would race this
                // write against an empty DOM selection.
                ev.preventDefault();
                ev.stopPropagation();
                this.copyText(selection);
                return false;
            });
        }

        /**
         * Write text to the system clipboard, reporting failure rather than
         * swallowing it.
         *
         * The async API is gated on a secure context and on permission, and it
         * rejects instead of throwing, so an unhandled promise here is exactly
         * the silent no-op this fix is about. The execCommand path is the
         * fallback for a plain-http origin, where navigator.clipboard is
         * undefined; it needs a real selection, hence the offscreen textarea.
         */
        copyText(text) {
            if (!text) return Promise.resolve(false);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(text).then(() => true, () => {
                    if (this.copyFallback(text)) return true;
                    this.updateStatus(this.connected ? 'connected' : 'disconnected', 'Copy failed');
                    return false;
                });
            }
            if (this.copyFallback(text)) return Promise.resolve(true);
            this.updateStatus(this.connected ? 'connected' : 'disconnected', 'Copy unavailable');
            return Promise.resolve(false);
        }

        /**
         * The pre-Clipboard-API copy, for origins the async API refuses.
         *
         * The selection and the focus are both borrowed and put back. The
         * selection because this runs on a terminal that has one, which is the
         * text being copied, and clearing it would make the copy look like it
         * failed. The focus because on a phone it is what the software keyboard
         * is riding on, and losing it takes the keyboard down mid-copy.
         *
         * iOS needs the contenteditable and readonly pair plus
         * setSelectionRange; select() alone is ignored there. The textarea is
         * fixed at the origin rather than parked off screen, because a browser
         * scrolls to an off-screen element before it will select it.
         */
        copyFallback(text) {
            const previous = document.activeElement;
            const selection = document.getSelection();
            const saved = [];
            if (selection) {
                for (let i = 0; i < selection.rangeCount; i++) saved.push(selection.getRangeAt(i));
            }

            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.contentEditable = 'true';
            ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;'
                + 'padding:0;border:0;margin:0;opacity:0;pointer-events:none;';
            document.body.appendChild(ta);

            let ok = false;
            try {
                ta.focus({ preventScroll: true });
                ta.select();
                ta.setSelectionRange(0, text.length);
                ok = document.execCommand('copy');
            } catch (e) {
                ok = false;
            } finally {
                ta.remove();
                if (selection) {
                    selection.removeAllRanges();
                    for (const range of saved) selection.addRange(range);
                }
                if (previous && previous.focus) {
                    try {
                        previous.focus({ preventScroll: true });
                    } catch (e) {
                        previous.focus();
                    }
                } else {
                    this.webterm.focus();
                }
            }
            return ok;
        }

        // --- Connection ----------------------------------------------------

        async connect() {
            this.updateStatus('connecting', 'Connecting...');
            const conn = new SipConnection(this);
            this.connection = conn;
            this.webterm.attach(conn);
            try {
                await conn.ready;
            } catch (e) {
                console.error('Connect failed:', e);
                this.handleDisconnect();
            }
        }

        async reconnect() {
            this.webterm.detach();
            this.handleDisconnect();
            this.reconnectAttempts = 0;
            await this.connect();
        }

        /** Called by the connection once a transport is carrying the session. */
        onConnected(name, status, text) {
            this.connected = true;
            this.reconnectAttempts = 0;
            this.currentTransport = name;
            this.updateStatus(status, text);
            this.sendResize();
            this.startPing();
            sipEmit('connect', { transport: name });
        }

        handleMessage(data) {
            if (!data || data.length === 0) return;

            switch (data[0]) {
                case MSG_OUTPUT:
                    // webterm batches these to one write per animation frame.
                    if (data.length > 1) this.webterm.write(data.subarray(1));
                    break;

                case MSG_CLOSE:
                    this.webterm.write('\r\n\x1b[33m[Session ended. Refresh to start new session.]\x1b[0m\r\n');
                    this.connected = false;
                    this.updateStatus('disconnected', 'Session ended');
                    sipEmit('disconnect', { reason: 'closed' });
                    break;

                case MSG_TITLE:
                    this.setTitle(this.decoder.decode(data.subarray(1)));
                    break;

                case MSG_OPTIONS:
                    try {
                        const options = JSON.parse(this.decoder.decode(data.subarray(1)));
                        this.readOnly = options.readOnly || false;
                        this.applyAppearance(options.appearance);
                        // Options arrive once per session, so this is where a
                        // reconnect starts over. A browser that comes back to
                        // a new PTY must not keep the shape the old one set:
                        // the program that set it is gone and nothing will
                        // ever pop it.
                        if (this.pointer) this.pointer.reset();
                        // Read-only is enforced inside webterm, so keystrokes,
                        // mouse reports and kitty protocol replies alike stop
                        // at the source rather than being filtered per path.
                        this.webterm.setOptions({
                            input: { chunkBytes: INPUT_CHUNK_SIZE, readOnly: this.readOnly },
                        });
                        if (this.readOnly) this.updateStatus('connected', 'Connected (Read-Only)');
                    } catch (e) {}
                    break;

                case MSG_PONG:
                    break;
            }
        }

        handleDisconnect() {
            const wasConnected = this.connected;
            this.connected = false;

            if (this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = null;
            }

            if (!wasConnected) return;

            this.currentTransport = 'disconnected';
            this.updateStatus('disconnected', 'Disconnected');
            sipEmit('disconnect', { reason: 'lost' });

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
                this.updateStatus('connecting', `Reconnecting in ${Math.round(delay / 1000)}s...`);
                setTimeout(() => this.connect(), delay);
            } else {
                this.updateStatus('disconnected', 'Connection lost');
                this.webterm.write('\r\n\x1b[31m[Connection lost. Refresh to reconnect.]\x1b[0m\r\n');
            }
        }

        // --- Outbound messages ----------------------------------------------

        /**
         * Send terminal input, as if it had been typed.
         *
         * webterm chunks what leaves through its own data path; this is the
         * direct route the tests and the console use, so it chunks too. The
         * server drops a single input message over MaxPasteBytes rather than
         * killing the session, and the PTY sees one ordered byte stream either
         * way, so a split mid-character is harmless.
         */
        async sendInput(data) {
            if (!this.connection || this.readOnly) return;
            const encoded = this.encoder.encode(data);
            if (encoded.length <= INPUT_CHUNK_SIZE) {
                await this.connection.sendMessage(MSG_INPUT, encoded);
                return;
            }
            for (let off = 0; off < encoded.length; off += INPUT_CHUNK_SIZE) {
                await this.connection.sendMessage(MSG_INPUT, encoded.subarray(off, off + INPUT_CHUNK_SIZE));
            }
        }

        /**
         * Pixel dimensions of the rendered grid. The server forwards these to
         * the PTY winsize, so TUIs that ask for the cell size in pixels (kitty
         * graphics sizing, sixel scaling) get a real answer instead of zeros.
         */
        pixelDimensions() {
            const px = this.webterm ? this.webterm.pixelSize : { width: 0, height: 0 };
            return { widthPx: px.width, heightPx: px.height };
        }

        async sendResize() {
            if (!this.webterm || !this.connection) return;
            const px = this.pixelDimensions();
            const payload = this.encoder.encode(JSON.stringify({
                cols: this.webterm.cols,
                rows: this.webterm.rows,
                widthPx: px.widthPx,
                heightPx: px.heightPx,
            }));
            await this.connection.sendMessage(MSG_RESIZE, payload);
        }

        startPing() {
            if (this.pingInterval) clearInterval(this.pingInterval);
            this.pingInterval = setInterval(() => {
                if (this.connected && this.connection) this.connection.sendMessage(MSG_PING, null);
            }, 30000);
        }

        // --- Page furniture --------------------------------------------------

        setupSettingsPanel() {
            const toggle = document.getElementById('settings-toggle');
            const panel = document.getElementById('settings-panel');
            const apply = document.getElementById('settings-apply');
            const close = document.getElementById('settings-close');
            const transportSelect = document.getElementById('transport-select');
            const rendererSelect = document.getElementById('renderer-select');
            const fontSizeInput = document.getElementById('font-size');
            const fontSizeValue = document.getElementById('font-size-value');
            const copyOnSelectInput = document.getElementById('copy-on-select');
            const cursorBlinkInput = document.getElementById('cursor-blink');
            const contextMenuInput = document.getElementById('browser-context-menu');
            const reservedKeysInput = document.getElementById('capture-reserved-keys');

            // A replaced index.html need not carry the settings panel, and a
            // half-built one is a mistake worth naming. Either way the panel
            // is skipped and the terminal still runs: settings are a
            // convenience and the terminal is the product.
            const required = {
                'settings-toggle': toggle,
                'settings-panel': panel,
                'settings-apply': apply,
                'settings-close': close,
                'transport-select': transportSelect,
                'renderer-select': rendererSelect,
                'font-size': fontSizeInput,
                'font-size-value': fontSizeValue,
                'copy-on-select': copyOnSelectInput,
                'cursor-blink': cursorBlinkInput,
            };
            const missing = Object.keys(required).filter((id) => !required[id]);
            if (missing.length === Object.keys(required).length) return;
            if (missing.length) {
                console.warn('sip: the settings panel is incomplete. Sip turned it off. Missing:', missing.join(', '));
                return;
            }

            transportSelect.value = this.settings.transport;
            rendererSelect.value = this.settings.renderer;
            fontSizeInput.value = this.settings.fontSize;
            fontSizeValue.textContent = this.settings.fontSize + 'px';
            copyOnSelectInput.checked = !!this.settings.copyOnSelect;
            cursorBlinkInput.checked = !!this.settings.cursorBlink;
            if (contextMenuInput) contextMenuInput.checked = !!this.settings.browserContextMenu;
            if (reservedKeysInput) reservedKeysInput.checked = !!this.settings.captureReservedKeys;

            toggle.addEventListener('click', () => {
                panel.classList.toggle('hidden');
                this.updateSettingsInfo();
            });

            close.addEventListener('click', () => panel.classList.add('hidden'));

            fontSizeInput.addEventListener('input', () => {
                fontSizeValue.textContent = fontSizeInput.value + 'px';
            }, { passive: true });

            apply.addEventListener('click', async () => {
                const rendererChanged = rendererSelect.value !== this.settings.renderer;

                this.settings.transport = transportSelect.value;
                this.settings.renderer = rendererSelect.value;
                this.settings.fontSize = parseInt(fontSizeInput.value, 10);
                this.settings.copyOnSelect = copyOnSelectInput.checked;
                this.settings.cursorBlink = cursorBlinkInput.checked;
                if (contextMenuInput) this.settings.browserContextMenu = contextMenuInput.checked;
                if (reservedKeysInput) this.settings.captureReservedKeys = reservedKeysInput.checked;
                this.saveSettings();

                panel.classList.add('hidden');

                // The renderer addon is attached once, when the terminal is
                // opened, so switching it needs a reload rather than a
                // reconnect.
                if (rendererChanged) {
                    window.location.reload();
                    return;
                }

                // Every one of these is read live inside webterm, so applying
                // them needs no re-binding and no reload.
                this.webterm.setOptions({
                    fontSize: this.settings.fontSize,
                    cursorBlink: this.settings.cursorBlink,
                    clipboard: { copyOnSelect: this.settings.copyOnSelect },
                    mouse: { suppressContextMenu: !this.settings.browserContextMenu },
                    keyboard: {
                        captureReservedKeys: this.settings.captureReservedKeys,
                        reservedKeys: RESERVED_KEYS,
                    },
                });

                await this.reconnect();
            });
        }

        updateSettingsInfo() {
            const rendererInfo = document.getElementById('renderer-info');
            const transportInfo = document.getElementById('transport-info');
            rendererInfo.textContent = `Renderer: ${this.currentRenderer}`;
            transportInfo.textContent = `Transport: ${this.currentTransport}`;
        }

        /**
         * The touch layer.
         *
         * On a desktop this installs nothing and returns an inert controller.
         * On a phone it puts up the key bar, reserves the software keyboard's
         * share of the window through the two CSS custom properties that
         * terminal.css pads the container with, and moves the settings gear
         * into the bar, because a floating control on a phone floats over a
         * screen with no room to spare.
         *
         * The key set is the default one from mobile.js unless the deployment
         * named its own with Config.MobileKeys. sip serves arbitrary programs,
         * so the default is keys every terminal program understands and nothing
         * that assumes a keymap: an application that wants its own chords on
         * the bar supplies them.
         */
        setupMobile() {
            if (!SipMobile) return;

            const toggle = document.getElementById('settings-toggle');
            const actions = toggle ? [{
                label: '',
                title: 'Settings',
                run: () => toggle.click(),
            }] : [];

            this.mobile = SipMobile.installKeyBar({
                send: (text) => this.sendInput(text),
                // xterm's own helper textarea is what holds the software
                // keyboard up, so it is what the bar has to keep focus on.
                focusTarget: () => (this.webterm ? this.webterm.xterm.textarea : null),
                isReady: () => this.connected && !this.readOnly,
            }, {
                keys: Array.isArray(sipConfig.mobileKeys) && sipConfig.mobileKeys.length
                    ? sipConfig.mobileKeys
                    : SipMobile.DEFAULT_KEYS,
                rows: Array.isArray(sipConfig.mobileRows) ? sipConfig.mobileRows : null,
                prefix: sipConfig.mobilePrefix || null,
                actions,
                keyBar: sipConfig.mobileKeyBar !== false,
            });

            // The desktop keeps the floating gear and lets it be moved out of
            // the way of whatever is under it.
            if (!this.mobile.enabled && toggle) {
                SipMobile.installDraggable(toggle, { storageKey: 'sip-web-gear-pos', margin: 8 });
            }

            this.setupTouchMouse();
        }

        /**
         * What a finger on the terminal itself does.
         *
         * Separate from the key bar, and installed even when the bar is turned
         * off, because the two answer different questions: the bar is the keys
         * a phone keyboard is missing, this is the mouse a phone does not have.
         * A deployment that wants neither says so twice.
         *
         * The screen element is looked up from the DOM rather than from
         * xterm's internals. .xterm-screen is the element xterm pointed its own
         * gesture recognizer at and the element its mouse handlers measure
         * against, and it is part of xterm's documented DOM, which _core is
         * not.
         */
        setupTouchMouse() {
            const el = this.webterm && this.webterm.xterm.element;
            const screen = el ? el.querySelector('.xterm-screen') : null;
            const opts = sipConfig.mobileMouse || {};
            this.touchMouse = SipMobile.installTouchMouse({
                screen,
                // A tap means the user wants to type here, so the software
                // keyboard comes up with it. The bar owns that: it knows what
                // is holding the keyboard and what it is waiting on.
                onTap: () => this.mobile.focusInput(),
            }, opts);
        }

        /**
         * Let the key bar act on outbound terminal input: fold in its armed
         * modifiers, and let it see the keystroke that finishes a leader chord.
         *
         * Called from SipConnection.send, on every frame of terminal input.
         * Whether there is anything to do is the bar's own question to answer,
         * because it is the bar that knows what it is holding; asking it costs
         * two property reads off a touch device.
         */
        applyBarState(bytes) {
            const m = this.mobile;
            if (!m.enabled || !m.pending) return bytes;
            const text = this.decoder.decode(bytes);
            const out = m.transformInput(text);
            return out === text ? bytes : this.encoder.encode(out);
        }

        /**
         * Rename the browser tab for a title the program sent, falling back to
         * Appearance.Title and then to sip's own name.
         *
         * One place, because the title arrives on two paths — webterm's own
         * OSC handler and the server's MsgTitle frame — and a page script that
         * wants to decorate the tab should not have to know which.
         */
        setTitle(title) {
            const next = title || this.appearance.title || 'Sip';
            this.sawTitle = true;
            if (document.title !== next) document.title = next;
            sipEmit('title', { title: next });
        }

        updateStatus(status, text) {
            if (!this.statusEl || !this.statusTextEl) return;

            this.statusEl.className = status;
            this.statusTextEl.textContent = text;

            if (status === 'connected' || status === 'webtransport') {
                setTimeout(() => this.statusEl.classList.add('hidden'), 2000);
            } else {
                this.statusEl.classList.remove('hidden');
            }
        }
    }

    function start() {
        const sipTerm = new SipTerminal();
        // Handle for the browser tests and for debugging from the console.
        // Internal: the page API is window.sip, and these two names are not
        // part of it. They stay because the suites in clienttests/ use them.
        window.sipTerm = sipTerm;
        sipApi.term = sipTerm;
        sipApi.settings = sipTerm.settings;
        sipClient = sipTerm;
        sipTerm.init().catch(console.error);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
