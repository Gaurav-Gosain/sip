# vendored vtgl

`vtgl.js` is a built artifact, not source. Do not edit it here.

Upstream: the `vtgl` package, MIT licensed. `LICENSE` is a copy of its license
file. The banner comment on the first line of `vtgl.js` records the upstream
version and the git revision the artifact was built from.

To refresh the vendored copy, run `npm run build:vendor` in the vtgl checkout
and copy `dist/vtgl.vendor.js` here as `vtgl.js`. The build emits a single
minified ESM module with no external dependencies, which is why it can be
loaded directly by the browser with no bundling step on the sip side.

vtgl is the glyph-atlas renderer used by the `renderer=webgl` option. It is a
pure renderer: it consumes a read-only view of terminal state and produces
pixels. It does not parse escape sequences and does not contain a VT. The VT
remains ghostty-vt.wasm under `static/ghostty-web/`; `static/sip-client/vtgl_source.js`
adapts the wasm buffer to the interface vtgl consumes.
