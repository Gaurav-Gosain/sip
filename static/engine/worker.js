// The engine worker. It owns the wasm module (libghostty-vt plus the frame
// builder) and the OffscreenCanvas. Per frame it asks wasm to build the
// instance buffer, rasterizes the few glyphs wasm has not seen before into
// the atlas, uploads the dirty row ranges straight out of wasm memory, and
// issues one instanced draw. No cell ever becomes a JS object.

import { KEYS } from './keys.js';
import { openTransport } from './transport.js';

const ATLAS_W = 2048, ATLAS_H = 1024;
const F_DRAW = 1, F_ATLAS_RESET = 2, F_HELD = 4;
const HOLD_LIMIT_MS = 1000;
const ACK_BYTES = 256 * 1024;
const FRAME_MS = 16;
// Inside one large batch the screen is still mid-flood: 30 fps keeps it
// moving and leaves more of the thread to the parser.
const FLOOD_FRAME_MS = 33;
const WARM_PASSES = 12;

let x; // wasm exports
let e = 0; // engine pointer
let cols = 0, rows = 0, cw = 0, ch = 0, baseline = 0, dpr = 1;
let gl, prog, vao, instBuf, atlasTex, flagTex, uni = {};
let iprog, ivao, ibuf, iuni = {};
let stageCtx, spr = 0, slotRows = 0;
let fontFamily = 'monospace', fontPx = 14;
let lastDraw = 0;
let lastCur = [-1, -1, -1];
let selecting = false, copyOnSelect = false, autoscrollTimer = 0, lastDrag = [0, 0];
let conn = null, net = null, readOnly = false, observe = false, pingTimer = 0;
const encoder = new TextEncoder();
let scheduled = false, rafId = 0, renders = 0, heldSince = 0;
const frameMs = [];
const T = { warmMs: 0, bytes: 0, writeMs: 0, drawMs: 0, rasterMs: 0, msgs: 0, misses: 0 };
const raf = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 16);
const decoder = new TextDecoder();

const u8 = () => new Uint8Array(x.memory.buffer);
const u32 = () => new Uint32Array(x.memory.buffer);

const VS = `#version 300 es
layout(location=0) in uint a_glyph;
layout(location=1) in uint a_fg;
layout(location=2) in uint a_bg;
uniform vec2 u_cell;
uniform vec2 u_view;
uniform int u_cols;
uniform ivec4 u_cursor; // x, y, visible, style
uniform ivec4 u_link; // row, first col, last col, on: the hovered link
flat out int v_link;
uniform vec3 u_curColor;
flat out uint v_glyph;
flat out vec3 v_fg;
flat out vec3 v_bg;
flat out int v_cursor;
out vec2 v_local;
vec3 unpack(uint c) { return vec3(float(c & 255u), float((c >> 8) & 255u), float((c >> 16) & 255u)) / 255.0; }
void main() {
  int col = gl_InstanceID % u_cols;
  int row = gl_InstanceID / u_cols;
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  float w = (a_glyph & (1u << 21)) != 0u ? 0.0 : ((a_glyph & (1u << 20)) != 0u ? 2.0 : 1.0);
  vec2 size = vec2(w, 1.0) * u_cell;
  vec2 px = vec2(float(col), float(row)) * u_cell + corner * size;
  v_local = corner * size;
  v_glyph = a_glyph;
  v_fg = unpack(a_fg);
  v_bg = unpack(a_bg);
  v_cursor = (u_cursor.z != 0 && col == u_cursor.x && row == u_cursor.y) ? u_cursor.w + 1 : 0;
  v_link = (u_link.w != 0 && row == u_link.x && col >= u_link.y && col <= u_link.z) ? 1 : 0;
  vec2 ndc = px / u_view * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D u_atlas;
uniform highp usampler2D u_flags;
uniform vec2 u_cell;
uniform int u_spr;
uniform vec3 u_curColor;
uniform float u_ulY;
uniform float u_ulH;
uniform int u_mode; // 0 whole cell, 1 background only, 2 foreground only (blended)
flat in uint v_glyph;
flat in vec3 v_fg;
flat in vec3 v_bg;
flat in int v_cursor;
flat in int v_link;
in vec2 v_local;
out vec4 o;
void over(inout vec4 f, vec3 c, float a) { f = vec4(mix(f.rgb, c, a), f.a + a * (1.0 - f.a)); }
void main() {
  vec3 fg = v_fg, bg = v_bg;
  // cursor styles from GhosttyRenderStateCursorVisualStyle: 0 bar, 1 block, 2 underline, 3 hollow
  if (v_cursor == 2) { fg = bg; bg = u_curColor; }
  if (u_mode == 1) { o = vec4(bg, 1.0); return; }
  vec4 f = vec4(0.0);
  uint slot = v_glyph & 0xFFFFFu;
  if (slot != 0u) {
    ivec2 sp = ivec2(int(slot) % u_spr, int(slot) / u_spr);
    vec4 t = texelFetch(u_atlas, sp * ivec2(u_cell) + ivec2(v_local), 0);
    float a = t.a;
    if ((v_glyph & (1u << 27)) != 0u) a *= 0.5;
    f = vec4(texelFetch(u_flags, sp, 0).r != 0u ? t.rgb : fg, a);
  }
  float y = v_local.y, xx = v_local.x;
  uint ul = (v_glyph >> 22) & 7u;
  // SGR 4:1 single, 4:2 double, 4:3 curly, 4:4 dotted, 4:5 dashed
  bool line = y >= u_ulY && y < u_ulY + u_ulH;
  if ((ul == 1u || v_link == 1) && line) over(f, fg, 1.0);
  if (ul == 2u && (line || (y >= u_ulY + 2.0 * u_ulH && y < u_ulY + 3.0 * u_ulH))) over(f, fg, 1.0);
  if (ul == 3u) {
    float wave = u_ulY + u_ulH + u_ulH * sin(xx / u_cell.x * 6.2831853);
    float d = abs(y + 0.5 - wave);
    if (d < u_ulH) over(f, fg, clamp(u_ulH - d + 0.5, 0.0, 1.0));
  }
  if (ul == 4u && line && mod(floor(xx / max(u_ulH, 1.0) / 2.0), 2.0) < 1.0) over(f, fg, 1.0);
  if (ul == 5u && line && mod(floor(xx / (u_cell.x * 0.5)), 2.0) < 1.0) over(f, fg, 1.0);
  if ((v_glyph & (1u << 25)) != 0u && abs(y - u_cell.y * 0.5) < u_ulH * 0.5 + 0.01) over(f, fg, 1.0);
  if ((v_glyph & (1u << 26)) != 0u && y < u_ulH) over(f, fg, 1.0);
  if (v_cursor == 1 && xx < 2.0) over(f, u_curColor, 1.0);
  if (v_cursor == 3 && y >= u_cell.y - 2.0) over(f, u_curColor, 1.0);
  if (v_cursor == 4 && (xx < 1.0 || y < 1.0 || y >= u_cell.y - 1.0 || xx >= u_cell.x - 1.0)) over(f, u_curColor, 1.0);
  if (u_mode == 2) { if (f.a <= 0.0) discard; o = f; return; }
  o = vec4(mix(bg, f.rgb, f.a), 1.0);
}`;

// Images: kitty placements (sixel arrives as one) and placeholder cells.
const IVS = `#version 300 es
layout(location=0) in vec4 a_dst; // x, y, w, h in canvas pixels
layout(location=1) in vec4 a_src; // u, v, w, h, normalized
uniform vec2 u_view;
out vec2 v_uv;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 px = a_dst.xy + corner * a_dst.zw;
  v_uv = a_src.xy + corner * a_src.zw;
  vec2 ndc = px / u_view * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`;
const IFS = `#version 300 es
precision highp float;
uniform sampler2D u_img;
in vec2 v_uv;
out vec4 o;
void main() { o = texture(u_img, v_uv); }`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// fontFamily may be one name or a CSS family list ("'A', 'B', monospace").
const familyList = () => (/[,'"]/.test(fontFamily) ? fontFamily : `"${fontFamily}"`) + (/monospace\s*$/.test(fontFamily) ? '' : ', monospace');
const firstFamily = () => fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
function fontString(style) {
  return `${style & 2 ? 'italic ' : ''}${style & 1 ? 'bold ' : ''}${fontPx}px ${familyList()}`;
}

function measure() {
  const c = new OffscreenCanvas(64, 64).getContext('2d');
  c.font = fontString(0);
  const m = c.measureText('M');
  const asc = m.fontBoundingBoxAscent ?? fontPx * 0.8;
  const desc = m.fontBoundingBoxDescent ?? fontPx * 0.2;
  cw = Math.max(1, Math.round(m.width));
  ch = Math.max(1, Math.round(asc + desc));
  baseline = Math.round(asc);
}

function setupGL(canvas) {
  gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return false;
  prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  for (const n of ['u_cell', 'u_view', 'u_cols', 'u_cursor', 'u_curColor', 'u_atlas', 'u_flags', 'u_spr', 'u_ulY', 'u_ulH', 'u_mode', 'u_link']) uni[n] = gl.getUniformLocation(prog, n);
  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, cols * rows * 12, gl.DYNAMIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribIPointer(i, 1, gl.UNSIGNED_INT, 12, i * 4);
    gl.vertexAttribDivisor(i, 1);
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  atlasTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, ATLAS_W, ATLAS_H);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  flagTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, flagTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, spr, slotRows);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  clearAtlas();
  gl.uniform1i(uni.u_atlas, 0);
  gl.uniform1i(uni.u_flags, 1);
  gl.uniform2f(uni.u_cell, cw, ch);
  gl.uniform2f(uni.u_view, cols * cw, rows * ch);
  gl.uniform1i(uni.u_cols, cols);
  gl.uniform1i(uni.u_spr, spr);
  const ulH = Math.max(1, Math.round(dpr));
  gl.uniform1f(uni.u_ulY, Math.min(ch - ulH, baseline + ulH));
  gl.uniform1f(uni.u_ulH, ulH);
  gl.viewport(0, 0, cols * cw, rows * ch);
  gl.uniform1i(uni.u_mode, 0);
  gl.bindVertexArray(vao);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  iprog = null;
  rprog = null;
  return true;
}

// Shaped runs are drawn over the cells by a small instanced pass; the
// program is built the first time a row has one.
const RVS = `#version 300 es
layout(location=0) in uvec4 a_run; // x, y, cells, slot
layout(location=1) in uint a_fg;
uniform vec2 u_cell;
uniform vec2 u_view;
uniform int u_spr;
flat out ivec2 v_origin;
flat out vec3 v_fg;
out vec2 v_local;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 size = vec2(float(a_run.z), 1.0) * u_cell;
  vec2 px = vec2(float(a_run.x), float(a_run.y)) * u_cell + corner * size;
  v_local = corner * size;
  int slot = int(a_run.w);
  v_origin = ivec2(slot % u_spr, slot / u_spr) * ivec2(u_cell);
  v_fg = vec3(float(a_fg & 255u), float((a_fg >> 8) & 255u), float((a_fg >> 16) & 255u)) / 255.0;
  vec2 ndc = px / u_view * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`;
const RFS = `#version 300 es
precision highp float;
uniform highp sampler2D u_atlas;
flat in ivec2 v_origin;
flat in vec3 v_fg;
in vec2 v_local;
out vec4 o;
void main() {
  float a = texelFetch(u_atlas, v_origin + ivec2(v_local), 0).a;
  if (a <= 0.0) discard;
  o = vec4(v_fg, a);
}`;
let rprog = null, rvao, rbuf, runi = {};
function ensureRunGL() {
  if (rprog) return;
  rprog = gl.createProgram();
  gl.attachShader(rprog, compile(gl.VERTEX_SHADER, RVS));
  gl.attachShader(rprog, compile(gl.FRAGMENT_SHADER, RFS));
  gl.linkProgram(rprog);
  if (!gl.getProgramParameter(rprog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(rprog));
  for (const n of ['u_cell', 'u_view', 'u_spr', 'u_atlas']) runi[n] = gl.getUniformLocation(rprog, n);
  rvao = gl.createVertexArray();
  gl.bindVertexArray(rvao);
  rbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, rbuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_INT, 24, 0);
  gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 24, 16);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(vao);
}

function runList() {
  const p = x.eng_runs(e);
  if (!p) return null;
  const n = new Uint32Array(x.memory.buffer, p, 1)[0];
  return n ? new Uint32Array(x.memory.buffer, p + 4, n * 6).slice() : null;
}

function drawRuns(list) {
  ensureRunGL();
  gl.useProgram(rprog);
  gl.bindVertexArray(rvao);
  gl.uniform2f(runi.u_cell, cw, ch);
  gl.uniform2f(runi.u_view, cols * cw, rows * ch);
  gl.uniform1i(runi.u_spr, spr);
  gl.uniform1i(runi.u_atlas, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, rbuf);
  gl.bufferData(gl.ARRAY_BUFFER, list, gl.STREAM_DRAW);
  gl.enable(gl.BLEND);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, list.length / 6);
  gl.useProgram(prog);
  gl.bindVertexArray(vao);
}

// The image program is built the first time an image is drawn, so a terminal
// that never shows one never compiles it.
function ensureImageGL() {
  if (iprog) return;
  // Image program: one instanced quad per placement or placeholder cell.
  iprog = gl.createProgram();
  gl.attachShader(iprog, compile(gl.VERTEX_SHADER, IVS));
  gl.attachShader(iprog, compile(gl.FRAGMENT_SHADER, IFS));
  gl.linkProgram(iprog);
  if (!gl.getProgramParameter(iprog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(iprog));
  iuni = { u_view: gl.getUniformLocation(iprog, 'u_view'), u_img: gl.getUniformLocation(iprog, 'u_img') };
  ivao = gl.createVertexArray();
  gl.bindVertexArray(ivao);
  ibuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
  for (let i = 0; i < 2; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 32, i * 16);
    gl.vertexAttribDivisor(i, 1);
  }
  gl.bindVertexArray(vao);
}

// A lost WebGL context (GPU reset, driver update, too many contexts) comes
// back by rebuilding every GL object and redrawing from wasm, which still
// holds the whole grid. The glyph atlas is rasterized again.
function watchContext(canvas) {
  canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); contextLost = true; });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    images.clear();
    setupGL(canvas);
    x.eng_set_cell(e, cw, ch, ATLAS_W, ATLAS_H);
    warmAscii();
    draw(true);
    self.postMessage({ type: 'contextRestored' });
  });
}
let contextLost = false;

// ---- images -------------------------------------------------------------
const images = new Map(); // id -> { tex, gen, w, h, seen }
let frameNo = 0;

function imageTexture(id) {
  const info = x.eng_image(e, id);
  if (!info) return null;
  const [w, h, fmt, len, ptr, gen] = new Uint32Array(x.memory.buffer, info, 6);
  let img = images.get(id);
  if (img && img.gen === gen) { img.seen = frameNo; return img; }
  if (!w || !h || !len) return null;
  if (!img) { img = { tex: gl.createTexture() }; images.set(id, img); }
  Object.assign(img, { gen, w, h, seen: frameNo });
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, img.tex);
  let data = new Uint8Array(x.memory.buffer, ptr, len), glFmt = gl.RGBA;
  // GhosttyKittyImageFormat: 0 RGB, 1 RGBA, 2 PNG (decoded to RGBA), 3 gray+alpha, 4 gray
  if (fmt === 0) glFmt = gl.RGB;
  else if (fmt === 3 || fmt === 4) {
    const n = w * h, step = fmt === 3 ? 2 : 1, rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { const v = data[i * step]; rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = step === 2 ? data[i * 2 + 1] : 255; }
    data = rgba;
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, glFmt === gl.RGB ? gl.RGB8 : gl.RGBA8, w, h, 0, glFmt, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  T.imageUploads = (T.imageUploads || 0) + 1;
  return img;
}

// Draw the entries of one layer, grouped by image so each texture binds once.
function drawImages(list, layer) {
  ensureImageGL();
  let any = false;
  gl.useProgram(iprog);
  gl.bindVertexArray(ivao);
  gl.uniform2f(iuni.u_view, cols * cw, rows * ch);
  gl.uniform1i(iuni.u_img, 2);
  for (const [id, entries] of list) {
    const sel = entries.filter((en) => en.layer === layer);
    if (!sel.length) continue;
    const img = imageTexture(id);
    if (!img) continue;
    const buf = new Float32Array(sel.length * 8);
    sel.forEach((en, i) => buf.set([en.dx, en.dy, en.dw, en.dh, en.sx / img.w, en.sy / img.h, en.sw / img.w, en.sh / img.h], i * 8));
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, img.tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sel.length);
    any = true;
  }
  gl.useProgram(prog);
  gl.bindVertexArray(vao);
  return any;
}

function gfxList() {
  const n = x.eng_gfx(e);
  if (!n) return null;
  const f = new Float32Array(x.memory.buffer, x.eng_gfx_ptr(e), n * 10);
  const u = new Uint32Array(x.memory.buffer, x.eng_gfx_ptr(e), n * 10);
  const byId = new Map();
  for (let i = 0; i < n; i++) {
    const o = i * 10, id = u[o];
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({ layer: u[o + 1], dx: f[o + 2], dy: f[o + 3], dw: f[o + 4], dh: f[o + 5], sx: f[o + 6], sy: f[o + 7], sw: f[o + 8], sh: f[o + 9] });
  }
  return byId;
}

function evictImages() {
  for (const [id, img] of images) if (frameNo - img.seen > 600) { gl.deleteTexture(img.tex); images.delete(id); }
}

function clearAtlas() {
  if (mode2d) { slot2d.clear(); return; }
  // Glyph pixels need no clearing: every raster uploads its whole slot.
  gl.activeTexture(gl.TEXTURE1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, spr, slotRows, gl.RED_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(spr * slotRows));
}

// Rasterize the glyphs wasm reported as new this frame. Each one already
// has a slot; this draws it on a two-cell staging canvas and uploads that
// rectangle into the slot. The browser's own font fallback picks a system
// font for anything the web font lacks (CJK, emoji, Arabic, Devanagari).
const STAGE_COLS = 32, STAGE_ROWS = 8; // glyphs per staging batch: 32 x 8, two cells each

// A shaped run: the browser lays the whole string out (joining, conjuncts,
// bidi order) and it is fitted into the run's cells: right-aligned for right
// to left text, squeezed only when it is wider than its cells.
let runCtx = null;
function rasterRun(slot, text, width, style, rtl) {
  const w = width * cw;
  if (!runCtx || runCtx.canvas.width < w) {
    runCtx = new OffscreenCanvas(Math.max(w, 64 * cw), ch).getContext('2d', { willReadFrequently: true });
  }
  const c = runCtx;
  c.clearRect(0, 0, w, ch);
  c.save();
  c.font = fontString(style & 3);
  c.fillStyle = '#fff';
  c.textBaseline = 'alphabetic';
  c.direction = rtl ? 'rtl' : 'ltr';
  const natural = c.measureText(text).width;
  const k = natural > w ? w / natural : 1;
  c.beginPath(); c.rect(0, 0, w, ch); c.clip();
  if (rtl) { c.translate(w, 0); c.scale(k, 1); c.textAlign = 'right'; c.fillText(text, 0, baseline); }
  else { c.scale(k, 1); c.textAlign = 'left'; c.fillText(text, 0, baseline); }
  c.restore();
  const d = c.getImageData(0, 0, w, ch).data;
  gl.activeTexture(gl.TEXTURE0);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, (slot % spr) * cw, Math.floor(slot / spr) * ch, w, ch, gl.RGBA, gl.UNSIGNED_BYTE, d);
}

function raster(n) {
  if (mode2d) return note2d(n);
  {
    // Shaped runs first, each on its own; the rest go through the batch.
    const mem = u8(), miss = new Uint32Array(x.memory.buffer, x.eng_miss(e), n * 3), arena = x.eng_arena(e);
    for (let i = 0; i < n; i++) {
      const meta = miss[i * 3 + 2];
      if (!((meta >>> 24) & 4)) continue;
      const off = miss[i * 3 + 1];
      rasterRun(miss[i * 3], decoder.decode(mem.subarray(arena + off, arena + off + (meta & 0xffff))), (meta >>> 16) & 0xff, meta >>> 24, !!((meta >>> 24) & 8));
    }
  }
  const mem = u8();
  const miss = new Uint32Array(x.memory.buffer, x.eng_miss(e), n * 3);
  const arena = x.eng_arena(e);
  const ctx = stageCtx;
  const sw = STAGE_COLS * 2 * cw, per = STAGE_COLS * STAGE_ROWS;
  let font = '';
  const flags = new Uint8Array(1);
  for (let base = 0; base < n; base += per) {
    // Draw up to 256 glyphs on the staging canvas, read it back once,
    // then upload each glyph's rectangle out of that one buffer.
    const count = Math.min(per, n - base);
    const usedRows = Math.ceil(count / STAGE_COLS);
    ctx.clearRect(0, 0, sw, usedRows * ch);
    for (let k = 0; k < count; k++) {
      const i = base + k;
      const off = miss[i * 3 + 1], meta = miss[i * 3 + 2];
      if ((meta >>> 24) & 4) continue; // shaped run, drawn above
      const len = meta & 0xffff, style = meta >>> 24;
      const f = fontString(style);
      if (f !== font) { ctx.font = f; font = f; }
      ctx.save();
      ctx.beginPath();
      ctx.rect((k % STAGE_COLS) * 2 * cw, Math.floor(k / STAGE_COLS) * ch, 2 * cw, ch);
      ctx.clip();
      ctx.fillText(decoder.decode(mem.subarray(arena + off, arena + off + len)), (k % STAGE_COLS) * 2 * cw, Math.floor(k / STAGE_COLS) * ch + baseline);
      ctx.restore();
    }
    const d = ctx.getImageData(0, 0, sw, usedRows * ch).data;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, sw);
    for (let k = 0; k < count; k++) {
      const i = base + k;
      if ((miss[i * 3 + 2] >>> 24) & 4) continue;
      const slot = miss[i * 3], width = (miss[i * 3 + 2] >>> 16) & 0xff;
      const w = cw * width, sx = (k % STAGE_COLS) * 2 * cw, sy = Math.floor(k / STAGE_COLS) * ch;
      gl.activeTexture(gl.TEXTURE0);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, sx);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, sy);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, (slot % spr) * cw, Math.floor(slot / spr) * ch, w, ch, gl.RGBA, gl.UNSIGNED_BYTE, d);
      // A glyph is "colour" when a covered pixel is not white: emoji keep
      // their own colours, everything else is tinted by the cell foreground.
      let color = 0;
      for (let yy = 0; yy < ch && !color; yy++) {
        for (let p = ((sy + yy) * sw + sx) * 4, q = p + w * 4; p < q; p += 4) {
          if (d[p + 3] > 40 && (Math.abs(d[p] - d[p + 1]) > 24 || Math.abs(d[p + 1] - d[p + 2]) > 24 || d[p] < 180)) { color = 1; break; }
        }
      }
      if (color) {
        flags[0] = 1;
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, slot % spr, Math.floor(slot / spr), 1, 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, flags);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, sw);
      }
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }
}

// ---- Canvas2D rung ----------------------------------------------------------
// Used when the worker has no WebGL2 (or when asked). The same wasm frame
// builder and instance buffer; this paints dirty rows with fillText. Slower
// per cell than the instanced draw, still entirely off the main thread.
let mode2d = false, ctx2d = null, prevCur2d = [-1, -1];
const slot2d = new Map(); // slot -> { text, style, width }
const images2d = new Map(); // id -> { canvas, gen, w, h }

function note2d(n) {
  const mem = u8();
  const miss = new Uint32Array(x.memory.buffer, x.eng_miss(e), n * 3);
  const arena = x.eng_arena(e);
  for (let i = 0; i < n; i++) {
    const slot = miss[i * 3], off = miss[i * 3 + 1], meta = miss[i * 3 + 2];
    slot2d.set(slot, { text: decoder.decode(mem.subarray(arena + off, arena + off + (meta & 0xffff))), width: (meta >>> 16) & 0xff, style: meta >>> 24 });
  }
}

const css = (c) => `rgb(${c & 255},${(c >> 8) & 255},${(c >> 16) & 255})`;

function image2d(id) {
  const info = x.eng_image(e, id);
  if (!info) return null;
  const [w, h, fmt, len, ptr, gen] = new Uint32Array(x.memory.buffer, info, 6);
  let img = images2d.get(id);
  if (img && img.gen === gen) return img;
  const src = new Uint8Array(x.memory.buffer, ptr, len), rgba = new Uint8ClampedArray(w * h * 4);
  const step = fmt === 0 ? 3 : fmt === 3 ? 2 : fmt === 4 ? 1 : 4;
  for (let i = 0; i < w * h; i++) {
    if (step >= 3) { rgba[i * 4] = src[i * step]; rgba[i * 4 + 1] = src[i * step + 1]; rgba[i * 4 + 2] = src[i * step + 2]; rgba[i * 4 + 3] = step === 4 ? src[i * 4 + 3] : 255; }
    else { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = src[i * step]; rgba[i * 4 + 3] = step === 2 ? src[i * 2 + 1] : 255; }
  }
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
  img = { canvas: c, gen, w, h };
  images2d.set(id, img);
  T.imageUploads = (T.imageUploads || 0) + 1;
  return img;
}

function images2dLayer(gfx, layer) {
  for (const [id, entries] of gfx) {
    const img = image2d(id);
    if (!img) continue;
    for (const en of entries) if (en.layer === layer) ctx2d.drawImage(img.canvas, en.sx, en.sy, en.sw, en.sh, en.dx, en.dy, en.dw, en.dh);
  }
}

function paintRow2d(y, inst, cur, curColor, pass) {
  const row = inst.subarray(y * cols * 3, (y + 1) * cols * 3);
  const top = y * ch;
  if (pass !== 2) {
    // Backgrounds, in runs of one colour.
    for (let x0 = 0; x0 < cols;) {
      const bg = row[x0 * 3 + 2];
      let x1 = x0 + 1;
      while (x1 < cols && row[x1 * 3 + 2] === bg) x1++;
      ctx2d.fillStyle = css(bg);
      ctx2d.fillRect(x0 * cw, top, (x1 - x0) * cw, ch);
      x0 = x1;
    }
    if (cur[2] && cur[1] === y && cur[3] === 1) { ctx2d.fillStyle = css(curColor); ctx2d.fillRect(cur[0] * cw, top, cw, ch); }
  }
  if (pass === 1) return;
  let font = '';
  for (let xx = 0; xx < cols; xx++) {
    const w0 = row[xx * 3], slot = w0 & 0xfffff;
    const isCur = cur[2] && cur[1] === y && cur[0] === xx;
    const fg = isCur && cur[3] === 1 ? row[xx * 3 + 2] : row[xx * 3 + 1];
    ctx2d.fillStyle = css(fg);
    if (slot) {
      const g = slot2d.get(slot);
      if (g) {
        const f = fontString(g.style);
        if (f !== font) { ctx2d.font = f; font = f; }
        ctx2d.globalAlpha = w0 & (1 << 27) ? 0.5 : 1;
        ctx2d.fillText(g.text, xx * cw, top + baseline);
        ctx2d.globalAlpha = 1;
      }
    }
    const ul = (w0 >>> 22) & 7, ulH = Math.max(1, Math.round(dpr)), ulY = Math.min(ch - ulH, baseline + ulH);
    const isLink = hover && hover.row === y && xx >= hover.x0 && xx <= hover.x1;
    if (ul || isLink) ctx2d.fillRect(xx * cw, top + ulY, cw, ulH);
    if (ul === 2) ctx2d.fillRect(xx * cw, top + ulY + 2 * ulH, cw, ulH);
    if (w0 & (1 << 25)) ctx2d.fillRect(xx * cw, top + (ch >> 1), cw, ulH);
    if (w0 & (1 << 26)) ctx2d.fillRect(xx * cw, top, cw, ulH);
    if (isCur && cur[3] !== 1) {
      ctx2d.fillStyle = css(curColor);
      if (cur[3] === 0) ctx2d.fillRect(xx * cw, top, 2, ch);
      else if (cur[3] === 2) ctx2d.fillRect(xx * cw, top + ch - 2, cw, 2);
      else ctx2d.strokeRect(xx * cw + 0.5, top + 0.5, cw - 1, ch - 1);
    }
  }
}

function paintRun2d(r, i) {
  const g = slot2d.get(r[i + 3]);
  if (!g) return;
  const w = r[i + 2] * cw, x0 = r[i] * cw, top = r[i + 1] * ch, rtl = !!r[i + 5];
  ctx2d.save();
  ctx2d.beginPath(); ctx2d.rect(x0, top, w, ch); ctx2d.clip();
  ctx2d.font = fontString(g.style & 3);
  ctx2d.fillStyle = css(r[i + 4]);
  ctx2d.direction = rtl ? 'rtl' : 'ltr';
  const natural = ctx2d.measureText(g.text).width, k = natural > w ? w / natural : 1;
  ctx2d.translate(rtl ? x0 + w : x0, 0);
  ctx2d.scale(k, 1);
  ctx2d.textAlign = rtl ? 'right' : 'left';
  ctx2d.fillText(g.text, 0, top + baseline);
  ctx2d.restore();
}

function draw2d(force, t0) {
  const mem = u8();
  const dirty = x.eng_row_dirty(e);
  const inst = new Uint32Array(x.memory.buffer, x.eng_inst(e), cols * rows * 3);
  const cur = new Uint32Array(x.memory.buffer, x.eng_cursor(e), 6).slice();
  const curColor = new Uint32Array(x.memory.buffer, x.eng_colors(e), 3)[2];
  frameNo++;
  const gfx = gfxList();
  const paint = new Set();
  for (let y = 0; y < rows; y++) if (force || gfx || mem[dirty + y]) paint.add(y);
  // The cursor's old and new rows, and the hovered link's row.
  if (prevCur2d[1] >= 0 && prevCur2d[1] < rows) paint.add(prevCur2d[1]);
  if (cur[1] < rows) paint.add(cur[1]);
  if (hover) paint.add(hover.row);
  if (gfx) {
    for (const y of paint) paintRow2d(y, inst, cur, curColor, 1);
    images2dLayer(gfx, 1); images2dLayer(gfx, 2);
    for (const y of paint) paintRow2d(y, inst, cur, curColor, 2);
    images2dLayer(gfx, 3);
  } else for (const y of paint) paintRow2d(y, inst, cur, curColor, 0);
  const runs = runList();
  if (runs) for (let i = 0; i < runs.length; i += 6) if (paint.has(runs[i + 1])) paintRun2d(runs, i);
  prevCur2d = [cur[0], cur[1]];
  renders++;
  lastDraw = performance.now();
  if (cur[0] !== lastCur[0] || cur[1] !== lastCur[1] || cur[2] !== lastCur[2]) { lastCur = [cur[0], cur[1], cur[2]]; postCursor(); }
  if (observe) self.postMessage({ type: 'frame', n: renders, t: performance.timeOrigin + lastDraw, cx: cur[0], cy: cur[1] });
  const dt = performance.now() - t0;
  T.drawMs += dt;
  frameMs.push(dt);
  if (frameMs.length > 4096) frameMs.splice(0, 2048);
  return true;
}

function draw(force) {
  const t0 = performance.now();
  const f = x.eng_frame(e, force ? 1 : 0);
  if (f & F_HELD) {
    if (!heldSince) heldSince = t0;
    else if (t0 - heldSince > HOLD_LIMIT_MS) { x.eng_release_hold(e); heldSince = 0; schedule(); }
  } else heldSince = 0;
  if (f & F_ATLAS_RESET) clearAtlas();
  const n = x.eng_miss_n(e);
  if (n) { const tr = performance.now(); raster(n); T.rasterMs += performance.now() - tr; T.misses += n; }
  if (!(f & F_DRAW) && !force) return false;
  if (mode2d) return draw2d(force, t0);
  if (contextLost) return false;
  // Upload dirty row ranges directly from wasm memory: one bufferSubData
  // per contiguous run, no intermediate copy.
  const mem = u8();
  const dirty = x.eng_row_dirty(e), inst = x.eng_inst(e), rowBytes = cols * 12;
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  for (let y = 0; y < rows; ) {
    if (!mem[dirty + y]) { y++; continue; }
    let y1 = y;
    while (y1 < rows && mem[dirty + y1]) y1++;
    gl.bufferSubData(gl.ARRAY_BUFFER, y * rowBytes, mem, inst + y * rowBytes, (y1 - y) * rowBytes);
    y = y1;
  }
  const cur = new Uint32Array(x.memory.buffer, x.eng_cursor(e), 6);
  gl.uniform4i(uni.u_cursor, cur[0], cur[1], cur[2], cur[3]);
  const col = new Uint32Array(x.memory.buffer, x.eng_colors(e), 3)[2];
  gl.uniform3f(uni.u_curColor, (col & 255) / 255, ((col >> 8) & 255) / 255, ((col >> 16) & 255) / 255);
  // With images on screen the cells draw in two passes so placements can sit
  // between the backgrounds and the text, or above the text.
  frameNo++;
  const gfx = gfxList();
  const runs = runList();
  if (!gfx) {
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cols * rows);
    if (runs) { drawRuns(runs); gl.disable(gl.BLEND); }
  } else {
    gl.uniform1i(uni.u_mode, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cols * rows);
    gl.enable(gl.BLEND);
    drawImages(gfx, 1);
    drawImages(gfx, 2);
    gl.uniform1i(uni.u_mode, 2);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cols * rows);
    if (runs) drawRuns(runs);
    drawImages(gfx, 3);
    gl.disable(gl.BLEND);
    gl.uniform1i(uni.u_mode, 0);
    if (frameNo % 300 === 0) evictImages();
  }
  renders++;
  lastDraw = performance.now();
  if (cur[0] !== lastCur[0] || cur[1] !== lastCur[1] || cur[2] !== lastCur[2]) {
    lastCur = [cur[0], cur[1], cur[2]];
    postCursor();
  }
  if (observe) self.postMessage({ type: 'frame', n: renders, t: performance.timeOrigin + lastDraw, cx: cur[0], cy: cur[1] });
  const dt = performance.now() - t0;
  T.drawMs += dt;
  frameMs.push(dt);
  if (frameMs.length > 4096) frameMs.splice(0, 2048);
  return true;
}

// The page moves its IME textarea to the cursor. During a flood the cursor
// moves every frame, and each move costs the main thread a style pass, so
// positions go out at most every 100 ms, with a trailing one so the last
// position always arrives.
const CURSOR_MS = 100;
let cursorSent = 0, cursorTimer = 0;
function postCursor() {
  const now = performance.now();
  if (now - cursorSent >= CURSOR_MS) {
    cursorSent = now;
    self.postMessage({ type: 'cursor', x: lastCur[0], y: lastCur[1], visible: !!lastCur[2] });
  } else if (!cursorTimer) {
    cursorTimer = setTimeout(() => { cursorTimer = 0; cursorSent = 0; postCursor(); }, CURSOR_MS - (now - cursorSent));
  }
}

function schedule() {
  if (scheduled || !e) return;
  scheduled = true;
  rafId = raf(() => {
    scheduled = false;
    draw(false);
    if (heldSince) schedule();
  });
}

function writeBytes(bytes) {
  const tw = performance.now();
  T.msgs++;
  T.bytes += bytes.length;
  // Parse in slices of at most 256 KiB and draw between slices when a frame
  // is overdue, so one large batch cannot hold the screen still.
  const cap = Math.min(x.eng_input_cap(), 256 * 1024);
  const inPtr = x.eng_input(e);
  let drawMs = 0;
  for (let off = 0; off < bytes.length; off += cap) {
    const n = Math.min(cap, bytes.length - off);
    u8().set(bytes.subarray(off, off + n), inPtr);
    x.eng_write_input(e, n);
    if (off + n < bytes.length && performance.now() - lastDraw > FLOOD_FRAME_MS) {
      const d0 = performance.now();
      flushOut();
      draw(false);
      drawMs += performance.now() - d0;
    }
  }
  T.writeMs += performance.now() - tw - drawMs;
}

// Two warm-ups before "ready", both cheap and both paid once:
//  - rasterize printable ASCII (regular and bold) into the atlas;
//  - run a short synthetic stream through the terminal so V8 has compiled
//    the parser's hot functions with its optimizing tier before real output
//    arrives. Without it the first MiB parses about 2x slower.
// The stream only addresses rows that already exist (CUP, no newlines), so
// it allocates no scrollback pages, and a full reset follows. A scratch
// terminal cost 6 MiB of wasm memory that the idle page kept.
function warmUp() {
  const n = x.eng_warm_ascii(e);
  if (n) raster(n);
  let t = '';
  // Mix the sequences real output leans on: sync output, CUP, SGR with
  // 256 and 24-bit colours, wide text, box drawing and plain runs.
  for (let i = 0; i < 300; i++) {
    if (i % rows === 0) t += '\x1b[?2026h';
    t += `\x1b[${1 + (i % rows)};1H\x1b[38;2;${i & 255};${(i * 7) & 255};90;48;2;${(i * 3) & 255};20;30m`;
    t += `w${i} \u2500\u2502 \u6f22\u5b57 \x1b[1;38;5;${i & 255}mbold\x1b[0m ${'abcdefghij'.repeat(Math.max(1, Math.floor(cols / 20)))}\x1b[K`;
    if (i % rows === rows - 1) t += '\x1b[?2026l';
  }
  t += '\x1b[?2026l\x1b[0m';
  const b = new TextEncoder().encode(t);
  const inPtr = x.eng_input(e), cap = x.eng_input_cap();
  for (let k = 0; k < WARM_PASSES; k++) {
    for (let o = 0; o < b.length; o += cap) {
      const len = Math.min(cap, b.length - o);
      u8().set(b.subarray(o, o + len), inPtr);
      x.eng_write_input(e, len);
    }
  }
  x.eng_reset(e);
}

function warmFallbackFonts() {
  const c = new OffscreenCanvas(4 * fontPx, 2 * fontPx).getContext('2d');
  for (const style of [0, 1]) {
    c.font = fontString(style);
    for (const t of ['\u{1F642}', '\u{1F1EF}\u{1F1F5}', '\u2800\u28FF', '\u6F22\uD55C', '\u0645\u0928']) c.fillText(t, 0, fontPx);
  }
}

async function loadFonts(fonts) {
  if (!fonts?.length || !self.FontFace) return;
  await Promise.all(fonts.map(async (f) => {
    const face = new FontFace(f.family || firstFamily(), `url(${f.url})`, { weight: f.weight ?? '400', style: f.style ?? 'normal' });
    await face.load();
    self.fonts.add(face);
  }));
}

const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((p1, p2) => p1 - p2); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3); };

// Send whatever the engine queued for the PTY: encoded keys, mouse
// reports, pastes and the terminal's own replies (DA, DSR, ...). With a
// connection the bytes go straight to the socket; without one they go to
// the page, which forwards them itself.
// Title, bell and clipboard events the terminal raised while parsing.
function drainEvents() {
  const len = x.eng_events_len(e);
  if (!len) return;
  const base = x.eng_events(e);
  const view = new DataView(x.memory.buffer, base, len);
  const mem = u8();
  for (let o = 0; o < len;) {
    const kind = view.getUint32(o, true), n = view.getUint32(o + 4, true);
    const body = mem.subarray(base + o + 8, base + o + 8 + n);
    if (kind === 1) self.postMessage({ type: 'title', title: decoder.decode(body) });
    else if (kind === 2) self.postMessage({ type: 'bell' });
    else if (kind === 3) self.postMessage({ type: 'clipboard', location: ['standard', 'selection', 'primary'][body[0]] ?? 'standard', text: decoder.decode(body.subarray(1)) });
    o += 8 + ((n + 3) & ~3);
  }
  x.eng_events_clear(e);
}

function flushOut() {
  drainEvents();
  const n = x.eng_out_len(e);
  if (!n) return;
  const p = x.eng_out(e);
  const bytes = u8().slice(p, p + n);
  x.eng_out_clear(e);
  if (readOnly) return;
  if (net) net.postMessage({ type: 'input', bytes }, [bytes.buffer]);
  else if (conn) conn.input(bytes);
  else self.postMessage({ type: 'data', bytes }, [bytes.buffer]);
}

// The page keeps a copy of the selected text so a copy event can fill the
// clipboard synchronously, which also works on insecure origins.
const MAX_SELECTION = 4 * 1024 * 1024;
function postSelection() {
  const n = x.eng_selection_text(e);
  const p = x.eng_selection_ptr(e);
  const text = n && n <= MAX_SELECTION ? decoder.decode(u8().subarray(p, p + n)) : '';
  self.postMessage({ type: 'selection', text, copy: copyOnSelect && !!text });
  return text;
}

// After output was parsed: replies out, and a frame if one is overdue.
// OSC 22 pointer shapes, by GhosttyMouseShape value (W3C cursor names).
const SHAPES = ['default', 'context-menu', 'help', 'pointer', 'progress', 'wait', 'cell', 'crosshair', 'text', 'vertical-text', 'alias', 'copy', 'move', 'no-drop', 'not-allowed', 'grab', 'grabbing', 'all-scroll', 'col-resize', 'row-resize', 'n-resize', 'e-resize', 's-resize', 'w-resize', 'ne-resize', 'nw-resize', 'se-resize', 'sw-resize', 'ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize', 'zoom-in', 'zoom-out'];
let lastShape = 0;
function afterOutput() {
  flushOut();
  searchAfterOutput();
  const shape = x.eng_mouse_shape(e);
  if (shape !== lastShape) { lastShape = shape; self.postMessage({ type: 'pointerShape', shape: shape ? SHAPES[shape] ?? 'default' : null }); }
  if (performance.now() - lastDraw > FRAME_MS) {
    if (scheduled) { (self.cancelAnimationFrame || clearTimeout)(rafId); scheduled = false; }
    draw(false);
  } else schedule();
}

// Stage text in the engine's input buffer and return its byte length.
function stage(text) {
  if (!text) return 0;
  const b = encoder.encode(text);
  const n = Math.min(b.length, x.eng_input_cap());
  u8().set(b.subarray(0, n), x.eng_input(e));
  return n;
}

function resizeGrid(c, r) {
  if (x.eng_resize(e, c, r)) return false;
  cols = c; rows = r;
  if (mode2d) {
    ctx2d.canvas.width = cols * cw;
    ctx2d.canvas.height = rows * ch;
    ctx2d.textBaseline = 'alphabetic';
    draw(true);
    conn?.resize(cols, rows, cols * cw, rows * ch);
    net?.postMessage({ type: 'resize', cols, rows, widthPx: cols * cw, heightPx: rows * ch });
    return true;
  }
  gl.canvas.width = cols * cw;
  gl.canvas.height = rows * ch;
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, cols * rows * 12, gl.DYNAMIC_DRAW);
  gl.uniform2f(uni.u_view, cols * cw, rows * ch);
  gl.uniform1i(uni.u_cols, cols);
  gl.viewport(0, 0, cols * cw, rows * ch);
  draw(true);
  conn?.resize(cols, rows, cols * cw, rows * ch);
  net?.postMessage({ type: 'resize', cols, rows, widthPx: cols * cw, heightPx: rows * ch });
  return true;
}

// ---- links ---------------------------------------------------------------
// OSC 8 hyperlinks, and plain http(s) URLs found in the row's text. The
// hovered link is underlined and the page shows a pointer; a click opens
// it (ctrl or cmd click while the program tracks the mouse).
const URL_RE = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g;
let hover = null, linkPress = null, rowCache = { row: -1, frame: -1, text: '', cols: null };
const OPEN_SCHEMES = new Set(['http:', 'https:']);

function plainLinkAt(col, row) {
  if (rowCache.row !== row || rowCache.frame !== renders) {
    const n = x.eng_row_text(e, row);
    const p = x.eng_row_ptr();
    rowCache = { row, frame: renders, text: decoder.decode(u8().slice(p, p + n)), cols: new Uint16Array(x.memory.buffer, x.eng_row_cols(), n).slice() };
  }
  const { text, cols } = rowCache;
  URL_RE.lastIndex = 0;
  for (let mt; (mt = URL_RE.exec(text));) {
    const b0 = encoder.encode(text.slice(0, mt.index)).length;
    const b1 = b0 + encoder.encode(mt[0]).length - 1;
    const x0 = cols[b0], x1 = cols[b1];
    if (col >= x0 && col <= x1) return { uri: mt[0], row, x0, x1 };
  }
  return null;
}

function linkAt(col, row) {
  const n = x.eng_link_at(e, col, row);
  if (n) {
    const uri = decoder.decode(u8().slice(x.eng_link_uri(), x.eng_link_uri() + n));
    const r = new Uint32Array(x.memory.buffer, x.eng_link_range(), 2);
    // Like xterm, only http and https hyperlinks are links.
    return openable(uri) ? { uri, row, x0: r[0], x1: r[1], osc8: true } : null;
  }
  return plainLinkAt(col, row);
}

function setHover(h) {
  const key = h ? `${h.uri}|${h.row}|${h.x0}|${h.x1}` : '';
  const old = hover ? `${hover.uri}|${hover.row}|${hover.x0}|${hover.x1}` : '';
  if (key === old) return;
  hover = h;
  if (!mode2d) gl.uniform4i(uni.u_link, h ? h.row : 0, h ? h.x0 : 0, h ? h.x1 : 0, h ? 1 : 0);
  self.postMessage({ type: 'hover', uri: h ? h.uri : null });
  draw(true);
}

function openable(uri) {
  try { return OPEN_SCHEMES.has(new URL(uri).protocol); } catch { return false; }
}

// ---- search ---------------------------------------------------------------
// Ghostty's search covers the screen and the whole scrollback. Work is done
// in bounded steps between messages so a long history never stalls output.
let searchOpen = false, searchTimer = 0, searchFed = 0;
function searchState(ptr) {
  const [status, total, index] = new Uint32Array(x.memory.buffer, ptr, 3);
  return { total, index: index === 0xFFFFFFFF ? -1 : index, done: status === 2 };
}
function searchPump() {
  searchTimer = 0;
  if (!searchOpen) return;
  const st = searchState(x.eng_search_step(e, 64));
  searchFed = performance.now();
  self.postMessage({ type: 'search', ...st });
  draw(true);
  if (!st.done) searchTimer = setTimeout(searchPump, 0);
}
function searchAfterOutput() {
  // New output can add or move matches: feed again, at most every 100 ms.
  if (searchOpen && !searchTimer) searchTimer = setTimeout(searchPump, Math.max(0, 100 - (performance.now() - searchFed)));
}

// ---- appearance ------------------------------------------------------------
const rgbOf = (v) => {
  if (typeof v === 'number') return v;
  const m = /^#?([0-9a-f]{6})/i.exec(String(v || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return ((n >> 16) & 255) | (((n >> 8) & 255) << 8) | ((n & 255) << 16); // r low
};
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
const XTERM16 = [0x000000, 0xcd0000, 0x00cd00, 0xcdcd00, 0x0000ee, 0xcd00cd, 0x00cdcd, 0xe5e5e5, 0x7f7f7f, 0xff0000, 0x00ff00, 0xffff00, 0x5c5cff, 0xff00ff, 0x00ffff, 0xffffff];
let theme = { fg: 0xd0d0d0, bg: 0x101010, cursor: 0xffffff };

// An xterm.js ITheme: foreground, background, cursor, the 16 named colours
// and extendedAnsi for 16..255. Missing entries keep xterm's defaults.
function applyTheme(t) {
  const pal = new Uint8Array(x.memory.buffer, x.eng_palette_buf(), 768);
  const put = (i, rgbLow) => { pal[i * 3] = rgbLow & 255; pal[i * 3 + 1] = (rgbLow >> 8) & 255; pal[i * 3 + 2] = (rgbLow >> 16) & 255; };
  const hex = (n) => ((n >> 16) & 255) | (((n >> 8) & 255) << 8) | ((n & 255) << 16);
  for (let i = 0; i < 16; i++) put(i, rgbOf(t[ANSI[i]]) ?? hex(XTERM16[i]));
  const lv = [0, 95, 135, 175, 215, 255];
  for (let i = 16; i < 232; i++) { const k = i - 16; put(i, lv[(k / 36) | 0] | (lv[((k / 6) | 0) % 6] << 8) | (lv[k % 6] << 16)); }
  for (let i = 232; i < 256; i++) { const v = 8 + (i - 232) * 10; put(i, v | (v << 8) | (v << 16)); }
  (t.extendedAnsi || []).forEach((c, i) => { const v = rgbOf(c); if (v != null && i + 16 < 256) put(i + 16, v); });
  x.eng_apply_palette(e);
  theme = { fg: rgbOf(t.foreground) ?? theme.fg, bg: rgbOf(t.background) ?? theme.bg, cursor: rgbOf(t.cursor) ?? rgbOf(t.foreground) ?? theme.cursor };
  x.eng_theme(e, theme.fg, theme.bg, theme.cursor);
}

// A new font family or size: measure again, rebuild the atlas geometry and
// the canvas, and tell the page the new cell size so it can fit the grid.
async function applyFont(m) {
  if (m.fontFamily) fontFamily = m.fontFamily;
  if (m.fontSize) fontPx = Math.round(m.fontSize * dpr);
  if (m.fonts) await loadFonts(m.fonts);
  measure();
  x.eng_set_cell(e, cw, ch, ATLAS_W, ATLAS_H);
  spr = x.eng_slots_per_row(e);
  slotRows = Math.floor(ATLAS_H / ch);
  stageCtx = new OffscreenCanvas(STAGE_COLS * 2 * cw, STAGE_ROWS * ch).getContext('2d', { willReadFrequently: true });
  stageCtx.fillStyle = '#fff';
  stageCtx.textBaseline = 'alphabetic';
  if (mode2d) {
    slot2d.clear();
    ctx2d.canvas.width = cols * cw;
    ctx2d.canvas.height = rows * ch;
    ctx2d.textBaseline = 'alphabetic';
    warmAscii();
    draw(true);
    self.postMessage({ type: 'metrics', cw, ch });
    return;
  }
  gl.deleteTexture(flagTex);
  flagTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, flagTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, spr, slotRows);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  clearAtlas();
  gl.useProgram(prog);
  gl.uniform2f(uni.u_cell, cw, ch);
  gl.uniform1i(uni.u_spr, spr);
  const ulH = Math.max(1, Math.round(dpr));
  gl.uniform1f(uni.u_ulY, Math.min(ch - ulH, baseline + ulH));
  gl.uniform1f(uni.u_ulH, ulH);
  gl.canvas.width = cols * cw;
  gl.canvas.height = rows * ch;
  gl.uniform2f(uni.u_view, cols * cw, rows * ch);
  gl.viewport(0, 0, cols * cw, rows * ch);
  warmAscii();
  draw(true);
  self.postMessage({ type: 'metrics', cw, ch });
}

function warmAscii() { const n = x.eng_warm_ascii(e); if (n) raster(n); }

self.onmessage = async ({ data: m }) => {
  try {
    switch (m.type) {
      case 'init': {
        ({ cols, rows } = m);
        dpr = m.dpr || 1;
        fontFamily = m.fontFamily || 'monospace';
        fontPx = Math.round((m.fontSize || 14) * dpr);
        await loadFonts(m.fonts);
        measure();
        const loading = WebAssembly.instantiateStreaming(fetch(m.wasmUrl), {});
        // The first glyph that needs a system fallback font (emoji, CJK,
        // braille) costs about 10 ms while the browser loads that font.
        // Pay it here, while wasm compiles on another thread, instead of in
        // the middle of the first burst of output.
        if (m.warmFonts) warmFallbackFonts();
        const res = await loading;
        x = res.instance.exports;
        e = x.eng_new(cols, rows, m.scrollback ?? 10000, cw, ch, ATLAS_W, ATLAS_H);
        if (!e) throw new Error('eng_new failed');
        const bad = x.eng_selftest(e);
        if (bad) throw new Error('cell layout self-test failed: ' + bad);
        if (m.theme) x.eng_theme(e, m.theme[0], m.theme[1], m.theme[2]);
        spr = x.eng_slots_per_row(e);
        slotRows = Math.floor(ATLAS_H / ch);
        stageCtx = new OffscreenCanvas(STAGE_COLS * 2 * cw, STAGE_ROWS * ch).getContext('2d', { willReadFrequently: true });
        stageCtx.fillStyle = '#fff';
        stageCtx.textBaseline = 'alphabetic';
        m.canvas.width = cols * cw;
        m.canvas.height = rows * ch;
        // The rungs: WebGL2 in this worker, else Canvas2D in this worker.
        let renderer = 'worker-webgl2';
        // debugNoWebGL2 lets a test take the automatic path a browser without
        // WebGL2 in workers takes; Chromium's flags do not reach worker contexts.
        if (m.renderer !== 'canvas2d' && !m.debugNoWebGL2 && setupGL(m.canvas)) watchContext(m.canvas);
        else {
          ctx2d = m.canvas.getContext('2d', { alpha: false });
          if (!ctx2d) throw Object.assign(new Error('Neither WebGL2 nor Canvas2D is available in the worker'), { code: 'no-canvas' });
          mode2d = true;
          renderer = 'worker-canvas2d';
          ctx2d.textBaseline = 'alphabetic';
        }
        const tw = performance.now();
        warmUp();
        T.warmMs = performance.now() - tw;
        draw(true);
        self.postMessage({ type: 'ready', cw, ch, renderer });
        break;
      }
      case 'write': {
        // Acknowledge writes as their bytes are parsed, about every
        // 256 KiB, not once per batch. The sender refills its window while
        // the rest of the batch parses, so the worker never idles waiting
        // for the next message.
        let off = 0, from = 0, pending = 0;
        for (let i = 0; i < m.ids.length; i++) {
          const n = m.lens ? m.lens[i] : m.bytes.length;
          writeBytes(m.bytes.subarray(off, off + n));
          off += n;
          pending += n;
          if (pending >= ACK_BYTES && i + 1 < m.ids.length) {
            self.postMessage({ type: 'written', ids: m.ids.slice(from, i + 1) });
            from = i + 1;
            pending = 0;
          }
        }
        self.postMessage({ type: 'written', ids: m.ids.slice(from) });
        // A flood of write messages can keep the worker busy past its
        // animation frames. afterOutput draws when a frame is overdue, so
        // the screen keeps moving at about 60 fps however fast bytes arrive.
        afterOutput();
        break;
      }
      case 'connect': {
        // The socket lives here: PTY output goes from the network straight
        // into wasm, and input goes from wasm straight to the network.
        conn = openTransport(m.transport, {
          output: (bytes) => { writeBytes(bytes); afterOutput(); },
          title: (title) => self.postMessage({ type: 'title', title }),
          options: (o) => { readOnly = !!o.readOnly; self.postMessage({ type: 'options', options: o }); },
          closed: (err) => { clearInterval(pingTimer); self.postMessage({ type: 'closed', error: err ? String(err) : undefined }); },
          open: () => {
            conn.resize(cols, rows, cols * cw, rows * ch);
            if (m.transport.pingMs) pingTimer = setInterval(() => conn.ping(), m.transport.pingMs);
          },
        });
        await conn.ready;
        self.postMessage({ type: 'result', id: m.id, value: true });
        break;
      }
      case 'net': {
        // The socket lives in the network worker; this port carries its
        // output here and our input there.
        net = m.port;
        net.onmessage = ({ data: d }) => {
          if (d.type === 'output') { writeBytes(d.bytes); net.postMessage({ type: 'ack' }); afterOutput(); }
          else if (d.type === 'open') net.postMessage({ type: 'resize', cols, rows, widthPx: cols * cw, heightPx: rows * ch });
          else if (d.type === 'options') { readOnly = !!d.options.readOnly; self.postMessage(d); }
          else self.postMessage(d); // title, closed
        };
        break;
      }
      case 'key': {
        // A DOM key event. Ghostty's encoder applies the terminal's modes
        // (cursor keys, keypad, kitty keyboard flags, modifyOtherKeys).
        const n = stage(m.text);
        x.eng_key(e, KEYS[m.code] ?? 0, m.mods, m.action, n, m.unshifted || 0, m.composing ? 1 : 0);
        flushOut();
        schedule();
        break;
      }
      case 'send': {
        // Raw bytes from the page, straight to the program.
        const b = m.bytes;
        if (readOnly) break;
        if (net) net.postMessage({ type: 'input', bytes: b }, [b.buffer]);
        else if (conn) conn.input(b);
        else self.postMessage({ type: 'data', bytes: b }, [b.buffer]);
        x.eng_scroll(e, 1 << 30);
        schedule();
        break;
      }
      case 'text':
        x.eng_text(e, stage(m.text));
        flushOut();
        schedule();
        break;
      case 'paste':
        x.eng_paste(e, stage(m.text));
        flushOut();
        schedule();
        break;
      case 'focus':
        x.eng_focus(e, m.focused ? 1 : 0);
        flushOut();
        break;
      case 'pointer': {
        // The program gets mouse reports when it asked for them, unless shift
        // is held; otherwise the left button selects text.
        const px = m.x * dpr, py = m.y * dpr;
        const col = Math.floor(px / cw), row = Math.floor(py / ch);
        const inGrid = col >= 0 && row >= 0 && col < cols && row < rows;
        const tracking = x.eng_mouse_tracking(e);
        const linkMod = (m.mods & (2 | 8)) !== 0; // ctrl or cmd
        // Links: hover while no button is down; a click on one opens it. When
        // the program tracks the mouse, only a ctrl or cmd click does.
        // Moves arrive at most once per frame, so a press re-reads the cell
        // under it instead of trusting the last hover.
        if ((m.action === 2 && !m.pressed && !selecting) || m.action === 0) setHover(inGrid && (!tracking || linkMod) ? linkAt(col, row) : null);
        if (m.button === 1 && hover && (!tracking || linkMod)) {
          if (m.action === 0) linkPress = { col, row, uri: hover.uri };
          else if (m.action === 1 && linkPress && tracking) {
            if (linkPress.col === col && linkPress.row === row && openable(linkPress.uri)) self.postMessage({ type: 'openLink', uri: linkPress.uri });
            linkPress = null;
            break;
          }
          if (tracking) break;
        }
        if (!selecting && tracking && !(m.mods & 1)) {
          x.eng_mouse(e, m.action, m.button, m.mods, px, py, m.pressed ? 1 : 0);
          flushOut();
          break;
        }
        if (m.action === 0 && m.button === 1) {
          selecting = true;
          x.eng_select(e, 0, px, py, m.t, 0);
        } else if (m.action === 2 && selecting) {
          x.eng_select(e, 1, px, py, m.t, m.mods & 4 ? 1 : 0);
          // Held past the top or bottom edge: scroll and extend every 50 ms.
          lastDrag = [px, py];
          if (x.eng_autoscroll(e) && !autoscrollTimer) {
            autoscrollTimer = setInterval(() => {
              if (!selecting || !x.eng_autoscroll(e)) { clearInterval(autoscrollTimer); autoscrollTimer = 0; return; }
              x.eng_select(e, 3, lastDrag[0], lastDrag[1], performance.now(), 0);
              draw(true);
            }, 50);
          }
        } else if (m.action === 1 && selecting) {
          selecting = false;
          clearInterval(autoscrollTimer); autoscrollTimer = 0;
          x.eng_select(e, 2, px, py, m.t, 0);
          const selected = postSelection();
          // A click on a link that did not select anything opens it.
          if (linkPress && !selected && linkPress.col === col && linkPress.row === row && openable(linkPress.uri))
            self.postMessage({ type: 'openLink', uri: linkPress.uri });
          linkPress = null;
        } else break;
        draw(true);
        break;
      }
      case 'search': {
        const st = searchState(x.eng_search(e, stage(m.needle || '')));
        searchOpen = !!m.needle;
        clearTimeout(searchTimer); searchTimer = 0;
        if (searchOpen) searchPump(); else draw(true);
        self.postMessage({ type: 'result', id: m.id, value: st });
        break;
      }
      case 'searchSelect': {
        const st = searchState(x.eng_search_select(e, m.dir === 'prev' ? 2 : 1));
        draw(true);
        self.postMessage({ type: 'result', id: m.id, value: st });
        break;
      }
      case 'debugLoseContext': {
        // For tests: lose the WebGL context and get it back.
        const ext = gl && gl.getExtension('WEBGL_lose_context');
        if (ext) { ext.loseContext(); setTimeout(() => ext.restoreContext(), m.ms ?? 100); }
        self.postMessage({ type: 'result', id: m.id, value: !!ext });
        break;
      }
      case 'setOptions': {
        if (m.theme) applyTheme(m.theme);
        if (m.cursorStyle || 'cursorBlink' in m) x.eng_cursor_default(e, { bar: 0, block: 1, underline: 2, outline: 3 }[m.cursorStyle || 'block'] ?? 1, m.cursorBlink ? 1 : 0);
        if (m.scrollback) x.eng_scrollback_lines(e, m.scrollback);
        if (m.fontSize || m.fontFamily || m.fonts) await applyFont(m);
        draw(true);
        self.postMessage({ type: 'result', id: m.id, value: true });
        break;
      }
      case 'scrollTo':
        x.eng_scroll(e, m.where === 'top' ? -(1 << 30) : 1 << 30);
        draw(true);
        break;
      case 'clearScrollback':
        x.eng_clear_scrollback(e);
        draw(true);
        break;
      case 'selectAll':
        x.eng_select_all(e);
        postSelection();
        draw(true);
        break;
      case 'selectClear':
        x.eng_select_clear(e);
        postSelection();
        draw(true);
        break;
      case 'options':
        if ('copyOnSelect' in m) copyOnSelect = !!m.copyOnSelect;
        break;
      case 'mouse':
        // Coordinates in CSS pixels; the engine works in canvas pixels.
        x.eng_mouse(e, m.action, m.button, m.mods, m.x * dpr, m.y * dpr, m.pressed ? 1 : 0);
        flushOut();
        break;
      case 'wheel': {
        // Mouse reports when the program tracks the mouse, otherwise the
        // viewport scrolls through history.
        if (x.eng_mouse_tracking(e)) {
          const button = m.lines < 0 ? 4 : 5;
          for (let i = 0; i < Math.min(Math.abs(m.lines), 10); i++) x.eng_mouse(e, 0, button, m.mods, m.x * dpr, m.y * dpr, 0);
          flushOut();
        } else {
          x.eng_scroll(e, m.lines);
          schedule();
        }
        break;
      }
      case 'resize':
        self.postMessage({ type: 'result', id: m.id, value: resizeGrid(m.cols, m.rows) });
        break;
      case 'observe':
        observe = !!m.on;
        break;
      case 'scroll':
        x.eng_scroll(e, m.delta);
        schedule();
        break;
      case 'flush':
        if (scheduled) { (self.cancelAnimationFrame || clearTimeout)(rafId); scheduled = false; }
        draw(true);
        if (!mode2d) gl.finish();
        self.postMessage({ type: 'result', id: m.id, value: { renders } });
        break;
      case 'stats':
        self.postMessage({ type: 'result', id: m.id, value: { renders, frames: frameMs.length, renderP50Ms: pct(frameMs, 0.5), renderP99Ms: pct(frameMs, 0.99), ...T, mem: x.memory.buffer.byteLength } });
        break;
      case 'dump': {
        const p = m.kind === 'direct' ? x.eng_dump_direct(e) : x.eng_dump_render(e);
        const text = decoder.decode(u8().slice(p, p + x.eng_dump_len(e)));
        self.postMessage({ type: 'result', id: m.id, value: text });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: m.id !== undefined ? 'result' : 'error', id: m.id, error: String(err && err.stack || err), code: err && err.code });
  }
};
