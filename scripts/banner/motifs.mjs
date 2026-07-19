// Motifs for the README banner generator.
//
// A motif is the decorative panel on the right third of the banner. Each one is
// a literal diagram of what the project does, drawn as inline SVG, so it
// carries information rather than being stock art. Every motif is a pure
// function of its parameters: no randomness, no clock, no network, so the same
// config always produces byte-identical output.
//
// Signature: (palette, opts) -> SVG markup string. The panel defaults to a
// 360x270 viewBox, the shape the README banner reserves on its right third, and
// `opts.w` / `opts.h` widen it for layouts with a different aspect: the social
// preview draws the same motif as a wide band under the wordmark. Every motif
// scales off those two numbers rather than the constants, so a motif drawn into
// a band is re-laid-out for it, not stretched.

export const MOTIF_W = 360;
export const MOTIF_H = 270;

// Panel dimensions for one call. Kept in one place so a motif never reads the
// module constants directly and silently ignores a caller's band size.
const box = (o) => [o.w ?? MOTIF_W, o.h ?? MOTIF_H];

// Deterministic PRNG (mulberry32) for motifs that want scatter without hand
// placing every element. Seeded from the config so output stays stable.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Categorical dot palette shared by the motifs that need several hues. Matches
// the reference banner's node colors.
const DOTS = [
  '#79a1f6', '#50bcb4', '#6eb7e1', '#59d0c7',
  '#ba99f6', '#f6758d', '#9ccd68', '#cba061',
];

// --- graph -----------------------------------------------------------------
// Nodes joined by edges. Used by turbograph, whose subject is a similarity
// graph, and kept here so the reference banner stays regenerable.
function graph(p, o = {}) {
  const [W, H] = box(o);
  const r = rng(o.seed ?? 7);
  const n = o.nodes ?? 13;
  const pts = [];
  // Poisson-ish scatter: reject candidates that land too close to a placed one.
  for (let i = 0; i < n; i++) {
    let best = null, bestD = -1;
    for (let k = 0; k < 24; k++) {
      const c = { x: 24 + r() * (W - 48), y: 20 + r() * (H - 40) };
      const d = pts.reduce((m, q) => Math.min(m, Math.hypot(q.x - c.x, q.y - c.y)), 1e9);
      if (d > bestD) { bestD = d; best = c; }
    }
    best.r = 5 + r() * 4;
    best.c = DOTS[i % DOTS.length];
    pts.push(best);
  }
  // Connect each node to its two nearest neighbours, deduplicated.
  const edges = new Set();
  pts.forEach((a, i) => {
    pts.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
      .filter((e) => e.j !== i)
      .sort((x, y) => x.d - y.d)
      .slice(0, 2)
      .forEach((e) => edges.add([Math.min(i, e.j), Math.max(i, e.j)].join(',')));
  });
  const lines = [...edges].map((k) => {
    const [i, j] = k.split(',').map(Number);
    return `<line x1="${pts[i].x.toFixed(1)}" y1="${pts[i].y.toFixed(1)}" x2="${pts[j].x.toFixed(1)}" y2="${pts[j].y.toFixed(1)}" stroke="${p.accent}" stroke-opacity=".26" stroke-width="1"/>`;
  }).join('');
  const dots = pts.map((q) => `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${q.r.toFixed(1)}" fill="${q.c}" filter="url(#soft)"/>`).join('');
  return lines + dots;
}

// --- cells -----------------------------------------------------------------
// A terminal cell grid with a run of cells lit up, the way an assertion
// highlights the region of the screen it matched. For tuitest, whose subject is
// reading a real terminal grid back out of a headless program.
//
// Two hand-placed shapes, because a run set laid out for a tall panel leaves a
// wide band mostly empty on the right. The tall one fills the banner's right
// third; the wide one fills the social preview's band and reads as the bottom of
// a real screen. Both light the same thing: a two-line matched region.
const TALL_CELLS = {
  cols: 24, rows: 14,
  runs: [
    [1, 2, 9], [1, 13, 6],
    [3, 2, 14], [4, 2, 7], [4, 11, 8],
    [6, 4, 11], [7, 4, 6],
    [9, 2, 5], [9, 9, 12],
    [10, 2, 17],
    [12, 2, 8],
  ],
  hot: [[6, 4, 11], [7, 4, 6]],
};

const WIDE_CELLS = {
  cols: 45, rows: 6,
  runs: [
    [0, 1, 12], [0, 15, 7], [0, 25, 14],
    [1, 1, 19], [1, 23, 9], [1, 35, 6],
    [2, 3, 16], [2, 22, 6], [2, 31, 11],
    [3, 3, 11], [3, 17, 8],
    [4, 1, 7], [4, 10, 18], [4, 31, 5], [4, 38, 5],
    [5, 1, 14], [5, 18, 10], [5, 30, 9],
  ],
  hot: [[2, 3, 16], [3, 3, 11]],
};

function cells(p, o = {}) {
  const [W, H] = box(o);
  const wide = (o.cols ?? (W > MOTIF_W * 1.5 ? WIDE_CELLS.cols : 24)) > 30;
  const shape = wide ? WIDE_CELLS : TALL_CELLS;
  const cols = o.cols ?? shape.cols, rows = o.rows ?? shape.rows;
  const cw = W / cols, ch = H / rows;
  // Hand-placed lit runs: row, start col, length. Reads as text on a screen.
  const runs = o.runs ?? shape.runs;
  const hot = o.hot ?? shape.hot; // the matched assertion region
  const key = (r, c) => `${r}:${c}`;
  const lit = new Set(), hotSet = new Set();
  runs.forEach(([r, c, l]) => { for (let i = 0; i < l; i++) lit.add(key(r, c + i)); });
  hot.forEach(([r, c, l]) => { for (let i = 0; i < l; i++) hotSet.add(key(r, c + i)); });

  let out = '';
  // Faint grid so the cell structure is visible where nothing is lit.
  for (let c = 0; c <= cols; c++) out += `<line x1="${(c * cw).toFixed(1)}" y1="0" x2="${(c * cw).toFixed(1)}" y2="${H}" stroke="${p.accent}" stroke-opacity=".07" stroke-width="1"/>`;
  for (let r = 0; r <= rows; r++) out += `<line x1="0" y1="${(r * ch).toFixed(1)}" x2="${W}" y2="${(r * ch).toFixed(1)}" stroke="${p.accent}" stroke-opacity=".07" stroke-width="1"/>`;
  // Highlight band behind the matched region.
  hot.forEach(([r, c, l]) => {
    out += `<rect x="${(c * cw - 2).toFixed(1)}" y="${(r * ch - 1).toFixed(1)}" width="${(l * cw + 4).toFixed(1)}" height="${(ch + 2).toFixed(1)}" fill="${p.accent}" fill-opacity=".13" rx="2"/>`;
  });
  // Cell glyph stand-ins: a bar per occupied cell, hot ones in the accent.
  for (const k of lit) {
    const [r, c] = k.split(':').map(Number);
    const isHot = hotSet.has(k);
    out += `<rect x="${(c * cw + cw * 0.18).toFixed(1)}" y="${(r * ch + ch * 0.26).toFixed(1)}" width="${(cw * 0.64).toFixed(1)}" height="${(ch * 0.46).toFixed(1)}" rx="1.5" fill="${isHot ? p.accent : p.fg}" fill-opacity="${isHot ? '.92' : '.30'}"/>`;
  }
  // Block cursor parked after the last lit run.
  const [cr, cc, cl] = runs[runs.length - 1];
  out += `<rect x="${((cc + cl) * cw + 1).toFixed(1)}" y="${(cr * ch + 1).toFixed(1)}" width="${(cw - 2).toFixed(1)}" height="${(ch - 2).toFixed(1)}" rx="2" fill="${p.accent}" fill-opacity=".85" filter="url(#soft)"/>`;
  return out;
}

// --- atlas -----------------------------------------------------------------
// Shelf-packed rectangles of mixed sizes, which is exactly how vtgl allocates
// glyph slots: rows of uniform height, filled left to right, a new shelf opened
// when the current one runs out of width.
function atlas(p, o = {}) {
  const [W, H] = box(o);
  const r = rng(o.seed ?? 11);
  const shelves = o.shelves ?? [18, 26, 18, 34, 22, 26, 18, 30, 22];
  const gap = 5;
  let y = 4, out = '', i = 0;
  // Outer atlas page boundary.
  out += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${p.accent}" stroke-opacity=".22" stroke-width="1" rx="4"/>`;
  for (const h of shelves) {
    if (y + h > H - 4) break;
    // Shelf baseline, the packer's horizontal rule.
    out += `<line x1="2" y1="${(y + h + gap / 2).toFixed(1)}" x2="${W - 2}" y2="${(y + h + gap / 2).toFixed(1)}" stroke="${p.accent}" stroke-opacity=".13" stroke-width="1"/>`;
    let x = 4;
    while (x < W - 10) {
      // Slot widths cluster around the shelf height: narrow cells, wide cells
      // for double-width glyphs, occasionally square for emoji.
      const wide = r() < 0.18;
      const w = Math.round(wide ? h * (1.6 + r() * 0.5) : h * (0.5 + r() * 0.35));
      if (x + w > W - 4) break;
      // Occupied slots stay faint: the motif has to sit at the same visual
      // weight as the other three, and a full page of packed rectangles turns
      // into a solid slab long before the opacity looks high on its own.
      const fresh = r() < 0.14; // slots uploaded this frame, in the accent
      out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fresh ? p.accent : p.fg}" fill-opacity="${fresh ? (0.45 + r() * 0.35).toFixed(2) : (0.05 + r() * 0.09).toFixed(2)}"${fresh ? ' filter="url(#soft)"' : ''}/>`;
      x += w + gap;
      i++;
    }
    y += h + gap * 2;
  }
  return out;
}

// --- chrome ----------------------------------------------------------------
// Overlapping window frames with traffic lights and a tab strip, for webterm,
// whose visible surface is the window chrome it draws around a terminal.
function chrome(p, o = {}) {
  const frames = o.frames ?? [
    { x: 0, y: 44, w: 268, h: 178, o: 0.30, accent: false },
    { x: 24, y: 24, w: 292, h: 196, o: 0.55, accent: false },
    { x: 52, y: 2, w: 306, h: 214, o: 1.0, accent: true },
  ];
  const lights = ['#f6758d', '#cba061', '#9ccd68'];
  let out = '';
  for (const f of frames) {
    const bar = 26;
    out += `<g opacity="${f.o}">`;
    out += `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8" fill="#0e131b" stroke="${p.accent}" stroke-opacity="${f.accent ? 0.42 : 0.2}" stroke-width="1"/>`;
    // Title bar, separated by a hairline the way a real chrome divides it.
    out += `<path d="M${f.x} ${f.y + bar} H${f.x + f.w}" stroke="${p.accent}" stroke-opacity="${f.accent ? 0.34 : 0.16}" stroke-width="1"/>`;
    lights.forEach((c, i) => {
      out += `<circle cx="${f.x + 16 + i * 15}" cy="${f.y + bar / 2}" r="4.5" fill="${c}" fill-opacity="${f.accent ? 0.95 : 0.5}"${f.accent ? ' filter="url(#soft)"' : ''}/>`;
    });
    if (f.accent) {
      // Tab pill on the frontmost frame.
      out += `<rect x="${f.x + 74}" y="${f.y + 6}" width="86" height="${bar - 11}" rx="4" fill="${p.accent}" fill-opacity=".16"/>`;
      out += `<rect x="${f.x + 164}" y="${f.y + 6}" width="70" height="${bar - 11}" rx="4" fill="${p.fg}" fill-opacity=".07"/>`;
      // Inline image placement, the thing webterm draws that a plain terminal
      // in the browser does not.
      out += `<rect x="${f.x + 16}" y="${f.y + bar + 16}" width="104" height="72" rx="4" fill="${p.accent}" fill-opacity=".22"/>`;
      out += `<path d="M${f.x + 22} ${f.y + bar + 76} l24 -28 l18 20 l14 -12 l30 32 z" fill="${p.accent}" fill-opacity=".55"/>`;
      out += `<circle cx="${f.x + 96}" cy="${f.y + bar + 34}" r="7" fill="${p.accent}" fill-opacity=".6"/>`;
      // Prompt and output lines beside and below the image.
      const line = (x, yy, w, op) => `<rect x="${x}" y="${yy}" width="${w}" height="5" rx="2.5" fill="${p.fg}" fill-opacity="${op}"/>`;
      out += line(f.x + 132, f.y + bar + 18, 120, 0.3);
      out += line(f.x + 132, f.y + bar + 34, 92, 0.22);
      out += line(f.x + 132, f.y + bar + 50, 140, 0.22);
      out += line(f.x + 132, f.y + bar + 66, 76, 0.18);
      out += line(f.x + 16, f.y + bar + 104, 150, 0.26);
      out += line(f.x + 16, f.y + bar + 120, 108, 0.2);
      out += line(f.x + 16, f.y + bar + 136, 186, 0.2);
      // Cursor.
      out += `<rect x="${f.x + 208}" y="${f.y + bar + 134}" width="9" height="9" rx="2" fill="${p.accent}" fill-opacity=".9" filter="url(#soft)"/>`;
    }
    out += '</g>';
  }
  return out;
}

// --- browser ---------------------------------------------------------------
// One browser window with a real terminal grid inside it, for sip, whose whole
// subject is that the thing in the tab is a pseudo-terminal rather than a
// picture of one. The frame is a browser frame and not a terminal frame: dots
// and an address pill, not traffic lights and a tab strip, because the point is
// where the terminal is, not that it has a window around it.
//
// Inside the viewport the grid carries the three things sip does that a plain
// text stream in a websocket does not: an inline image placement, a selection
// band over a run of cells, and a block cursor. Both shapes below light the
// same three.
//
// Unlike `chrome`, this is laid out from the box it is given rather than from
// fixed rectangles, so the social preview's wide band is a short, wide browser
// window with a short, wide terminal in it rather than a clipped tall one.
const TALL_BROWSER = {
  cols: 28, rows: 9,
  image: { col: 1, row: 0, cols: 11, rows: 4 },
  runs: [
    [0, 14, 10], [1, 14, 7], [2, 14, 12], [3, 14, 8],
    [5, 1, 17], [6, 1, 24], [7, 1, 13],
  ],
  hot: [[6, 1, 24]],
  cursor: [7, 14],
  url: 96,
};

const WIDE_BROWSER = {
  cols: 72, rows: 4,
  image: { col: 1, row: 0, cols: 15, rows: 3 },
  runs: [
    [0, 18, 22], [0, 43, 15],
    [1, 18, 30], [1, 51, 12],
    [2, 18, 14], [2, 35, 26],
    [3, 1, 14], [3, 18, 20], [3, 41, 9],
  ],
  hot: [[2, 35, 26]],
  cursor: [3, 51],
  url: 260,
};

function browser(p, o = {}) {
  const [W, H] = box(o);
  // The band is more than three times as wide as it is tall; the banner panel
  // is about four thirds. Nothing sits between the two, so one threshold picks
  // the shape rather than interpolating a layout that suits neither.
  const shape = o.shape ? (o.shape === 'wide' ? WIDE_BROWSER : TALL_BROWSER)
    : (W / H > 3 ? WIDE_BROWSER : TALL_BROWSER);
  const bar = W / H > 3 ? 26 : 30;
  let out = '';

  // Window frame and the hairline under the address bar.
  out += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="#0e131b" stroke="${p.accent}" stroke-opacity=".32" stroke-width="1"/>`;
  out += `<path d="M0 ${bar} H${W}" stroke="${p.accent}" stroke-opacity=".22" stroke-width="1"/>`;

  // Window dots, drawn in the foreground grey rather than in traffic-light
  // colours: three saturated circles are the loudest thing in a motif this
  // size, and they would pull the eye to the frame instead of to the grid.
  for (let i = 0; i < 3; i++) {
    out += `<circle cx="${16 + i * 15}" cy="${(bar / 2).toFixed(1)}" r="4" fill="${p.fg}" fill-opacity=".22"/>`;
  }

  // Address pill. The accent dot at its left is the lock: sip refuses a
  // non-loopback bind without TLS, so the padlock is part of what it is.
  const px = 70, pw = W - px - 16, ph = bar - 12;
  out += `<rect x="${px}" y="6" width="${pw}" height="${ph}" rx="${(ph / 2).toFixed(1)}" fill="${p.fg}" fill-opacity=".05" stroke="${p.accent}" stroke-opacity=".14" stroke-width="1"/>`;
  out += `<circle cx="${px + 13}" cy="${(bar / 2).toFixed(1)}" r="3" fill="${p.accent}" fill-opacity=".65"/>`;
  out += `<rect x="${px + 24}" y="${(bar / 2 - 2).toFixed(1)}" width="${shape.url}" height="4" rx="2" fill="${p.fg}" fill-opacity=".24"/>`;

  // Terminal surface, inset inside the viewport the way a page gutters it.
  const tx = 12, ty = bar + 10, tw = W - 24, th = H - bar - 22;
  const { cols, rows } = shape;
  const cw = tw / cols, ch = th / rows;
  const cx = (c) => tx + c * cw, cy = (r) => ty + r * ch;

  // Faint cell grid, so the surface reads as a character grid and not as a
  // panel with some bars on it.
  for (let c = 0; c <= cols; c++) out += `<line x1="${cx(c).toFixed(1)}" y1="${ty}" x2="${cx(c).toFixed(1)}" y2="${(ty + th).toFixed(1)}" stroke="${p.accent}" stroke-opacity=".06" stroke-width="1"/>`;
  for (let r = 0; r <= rows; r++) out += `<line x1="${tx}" y1="${cy(r).toFixed(1)}" x2="${(tx + tw).toFixed(1)}" y2="${cy(r).toFixed(1)}" stroke="${p.accent}" stroke-opacity=".06" stroke-width="1"/>`;

  // Kitty graphics placement, drawn on the cell grid it actually occupies. It
  // is a placement over cells rather than a floating picture because that is
  // what the overlay does: the image is anchored to a buffer row and scrolls
  // with it.
  const im = shape.image;
  const ix = cx(im.col), iy = cy(im.row), iw = im.cols * cw, ih = im.rows * ch;
  out += `<rect x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" width="${iw.toFixed(1)}" height="${ih.toFixed(1)}" rx="3" fill="${p.accent}" fill-opacity=".2"/>`;
  // Absolute points on a flat base. Closing a peak path back to a start that is
  // above the base leaves the whole range standing on a slope, which is what a
  // relative path built out of the peaks alone does.
  const mx = (f) => (ix + iw * f).toFixed(1), my = (f) => (iy + ih * f).toFixed(1);
  out += `<path d="M${mx(0.06)} ${my(0.95)} L${mx(0.34)} ${my(0.38)} L${mx(0.53)} ${my(0.68)} L${mx(0.66)} ${my(0.5)} L${mx(0.94)} ${my(0.95)} Z" fill="${p.accent}" fill-opacity=".55"/>`;
  out += `<circle cx="${(ix + iw * 0.74).toFixed(1)}" cy="${(iy + ih * 0.27).toFixed(1)}" r="${(Math.min(iw, ih) * 0.11).toFixed(1)}" fill="${p.accent}" fill-opacity=".6"/>`;

  // Selection band behind the copied run, then the glyph stand-ins. The
  // selected run is drawn in the accent, which is what the browser's own
  // selection does to a run of cells and what OSC 52 then sends on.
  const key = (r, c) => `${r}:${c}`;
  const lit = new Set(), hotSet = new Set();
  shape.runs.forEach(([r, c, l]) => { for (let i = 0; i < l; i++) lit.add(key(r, c + i)); });
  shape.hot.forEach(([r, c, l]) => { for (let i = 0; i < l; i++) hotSet.add(key(r, c + i)); });
  shape.hot.forEach(([r, c, l]) => {
    out += `<rect x="${(cx(c) - 2).toFixed(1)}" y="${(cy(r) - 1).toFixed(1)}" width="${(l * cw + 4).toFixed(1)}" height="${(ch + 2).toFixed(1)}" rx="2" fill="${p.accent}" fill-opacity=".16"/>`;
  });
  for (const k of lit) {
    const [r, c] = k.split(':').map(Number);
    const isHot = hotSet.has(k);
    out += `<rect x="${(cx(c) + cw * 0.18).toFixed(1)}" y="${(cy(r) + ch * 0.28).toFixed(1)}" width="${(cw * 0.64).toFixed(1)}" height="${(ch * 0.44).toFixed(1)}" rx="1.5" fill="${isHot ? p.accent : p.fg}" fill-opacity="${isHot ? '.9' : '.3'}"/>`;
  }

  // Block cursor, the one element that is allowed to bloom.
  const [ur, uc] = shape.cursor;
  out += `<rect x="${(cx(uc) + 1).toFixed(1)}" y="${(cy(ur) + 2).toFixed(1)}" width="${(cw - 2).toFixed(1)}" height="${(ch - 4).toFixed(1)}" rx="2" fill="${p.accent}" fill-opacity=".85" filter="url(#soft)"/>`;
  return out;
}

export const MOTIFS = { graph, cells, atlas, chrome, browser, none: () => '' };
