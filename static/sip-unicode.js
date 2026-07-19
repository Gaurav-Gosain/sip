/**
 * Unicode width overrides for the xterm.js client.
 *
 * @xterm/addon-unicode-graphemes supplies the UAX 29 segmentation the client
 * depends on, and it is right about nearly everything. It is wrong about
 * U+200B ZERO WIDTH SPACE, which it bills one column. Every other emulator
 * worth comparing against, ghostty-vt and wcwidth included, gives it zero, and
 * unlike the other disagreements this one shows up in ordinary text: ZWSP is
 * the standard line-break opportunity marker, so a paragraph carrying a few of
 * them drifts a column right for each one.
 *
 * Rather than patch the vendored addon, this registers a provider that
 * delegates every call to the addon's own provider and rewrites the result for
 * a short list of codepoints. It reuses the addon's version string, so it
 * simply replaces the addon in the UnicodeService registry and nothing that
 * reads `terminal.unicode.activeVersion` has to know it exists. Being our own
 * file, it survives a bundle update.
 *
 * WHAT IS DELIBERATELY NOT OVERRIDDEN, so nobody "fixes" it later:
 *
 *   U+00AD SOFT HYPHEN. xterm gives 0, ghostty 1. Accepted policy difference.
 *     It could not be changed here anyway: InputHandler.print() drops
 *     codepoint 173 before it ever asks a provider for its width.
 *   Devanagari matra (U+0928 U+093F). xterm gives the cluster 1 column,
 *     ghostty 2. Accepted policy difference; a spacing-mark question, not a
 *     zero-width one, and not reachable from a per-codepoint width table.
 *   U+200C ZERO WIDTH NON-JOINER and U+FEFF ZERO WIDTH NO-BREAK SPACE. Both
 *     already measure zero inside real text (see the zero-width-non-joiner and
 *     zero-width-no-break-space cases in clienttests/grapheme_corpus.spec.mjs,
 *     which pass today). Overriding them would be a no-op at best.
 *   U+200D ZERO WIDTH JOINER. Forcing its width to zero would break emoji ZWJ
 *     sequences outright: the addon returns the joined cluster's accumulated
 *     width through the ZWJ's own property value, and InputHandler feeds that
 *     value back as the preceding join state for the next scalar. Zero it and
 *     a family emoji re-advances at every joiner. Its only failing case is a
 *     lone ZWJ at column 0, which no width table can fix (see below).
 *   The Cf general category as a whole. Too blunt: it contains U+00AD and
 *     U+200D above, plus the Arabic number formatters, which are not the same
 *     question.
 *
 * A lone zero-width codepoint written at column 0 still advances one column.
 * That is not a width decision: with no preceding cell to join onto,
 * InputHandler has nowhere to put the codepoint and writes it into a cell of
 * its own. xterm does the same for a lone combining mark. Between any two
 * characters, which is where ZWSP actually occurs, the override applies.
 */
(function (global) {
    'use strict';

    // Codepoints forced to zero width. Each entry needs a reason above.
    const ZERO_WIDTH = new Set([0x200b]);

    // UnicodeService packs a property value as
    //   (charKind << 3) | (width << 1) | shouldJoin
    // with width in two bits. The delegate's charKind is preserved so the
    // addon's segmentation state machine keeps working across the override.
    const CHAR_KIND_SHIFT = 3;

    function pack(charKind, width, shouldJoin) {
        return ((charKind & 0xffffff) << CHAR_KIND_SHIFT) | ((width & 3) << 1) | (shouldJoin ? 1 : 0);
    }

    class SipUnicodeProvider {
        constructor(delegate) {
            this._delegate = delegate;
            this.version = delegate.version;
        }

        get ambiguousCharsAreWide() {
            return this._delegate.ambiguousCharsAreWide;
        }

        set ambiguousCharsAreWide(value) {
            this._delegate.ambiguousCharsAreWide = value;
        }

        charProperties(codepoint, preceding) {
            const value = this._delegate.charProperties(codepoint, preceding);
            if (!ZERO_WIDTH.has(codepoint)) {
                return value;
            }
            // Zero width, joined onto whatever precedes it. The join is what
            // actually suppresses the advance: InputHandler only skips the
            // cursor increment on the joining branch, so a width of 0 without
            // it would still eat a column. This mirrors what xterm's own
            // UnicodeV6 provider does for every zero-width scalar.
            return pack(value >> CHAR_KIND_SHIFT, 0, preceding !== 0);
        }

        wcwidth(codepoint) {
            return ZERO_WIDTH.has(codepoint) ? 0 : this._delegate.wcwidth(codepoint);
        }
    }

    /**
     * Load the graphemes addon into `term` and layer the overrides on top.
     * Returns true if the override provider is active.
     *
     * The addon's provider instance is captured as it registers itself, which
     * avoids reaching into the addon's private fields. The interception has to
     * go on the prototype, not on an instance: `Terminal.unicode` is a getter
     * that hands back a freshly constructed UnicodeApi on every access, so the
     * object the addon registers through is never the one we read here.
     */
    function install(term, addon) {
        const proto = Object.getPrototypeOf(term.unicode);
        const register = proto.register;
        let delegate = null;

        proto.register = function (provider) {
            if (provider && provider.version === '15-graphemes') {
                delegate = provider;
            }
            return register.call(this, provider);
        };
        try {
            term.loadAddon(addon);
        } finally {
            proto.register = register;
        }

        if (!delegate) {
            return false;
        }
        const unicode = term.unicode;
        // Same version string, so this displaces the addon in the registry.
        // activeVersion has to be re-assigned afterwards: the setter is what
        // resolves the string back to a provider instance.
        unicode.register(new SipUnicodeProvider(delegate));
        unicode.activeVersion = '15-graphemes';
        return true;
    }

    global.SipUnicode = { install, ZERO_WIDTH };
})(globalThis);
