/*
 * xterm-kitty-overlay.js
 *
 * A kitty graphics protocol implementation that renders images as
 * absolutely-positioned DOM canvases in an overlay above xterm.js,
 * instead of baking them into the cell buffer like xterm-addon-image
 * does. This gives us the semantics tuios's window manager needs:
 *
 *   - Update an existing placement in place (re-emit a=p with the same
 *     i,p -> move the canvas via CSS transform, no stacking).
 *   - Delete a single placement (d=p,i=N,p=M) without wiping the image
 *     bytes, so a subsequent re-place still works.
 *   - Source-region clipping (x,y,w,h) via ctx.drawImage args.
 *   - Track scroll / resize and reposition all placements.
 *
 * Supported kitty protocol subset (what tuios actually emits after its
 * server-side passthrough re-encodes everything into direct transmissions):
 *
 *   Actions:  a=t, a=T, a=p, a=d, a=q
 *   Medium:   t=d (direct base64) only
 *   Formats:  f=24 (RGB), f=32 (RGBA), f=100 (PNG)
 *   Compress: o=z (zlib via DecompressionStream)
 *   Chunks:   m=0, m=1 (accumulated per-image until m=0)
 *   Keys:     i, I, p, s, v, c, r, x, y, w, h, X, Y, z, C, q
 *   Delete:   d=a|A (all), d=i|I (by image id), d=p|P (by placement id)
 *
 * Not supported (intentionally out of scope):
 *   - Animation (a=f, a=a, a=c)
 *   - File / temp file / shared memory transmission (t=f, t=t, t=s) —
 *     tuios already re-encodes these into direct transmissions server-side.
 *   - Unicode placeholder placement (U=1)
 */
(function () {
    "use strict";

    // 'G' = 71; this is the APC payload prefix for kitty graphics.
    const KITTY_APC_IDENT = 71;

    class KittyOverlay {
        constructor(term, container) {
            this.term = term;
            this.container = container;

            // Decoded images, keyed by the guest image id.
            // value: { bitmap: ImageBitmap, width: number, height: number }
            this.images = new Map();

            // Active placements keyed by "imageId/placementId".
            // value: { imageId, placementId, cellX, cellY, cols, rows,
            //          srcX, srcY, srcW, srcH, z, canvas }
            this.placements = new Map();

            // Chunked transmission buffers keyed by imageId (or a special
            // key when imageId is 0, which tuios uses heavily).
            // value: { params, chunks: string[] }
            this.pending = new Map();

            // Placement about to apply when a=T finishes its transmit
            // phase and needs to also place. Keyed like `pending`.
            this.pendingPlacement = new Map();

            // Place commands that arrived before the referenced image
            // finished decoding. createImageBitmap is asynchronous and
            // tuios typically emits a=t then a=p back-to-back in the
            // same render cycle, so the place hits before the bitmap
            // lands in `images`. We queue them here and drain when the
            // decode settles. Keyed by imageId, value is an array of
            // place spec objects.
            this.deferredPlacements = new Map();

            // Image ids for which a decode is currently in-flight. Used
            // so _handlePlace can decide between "retry later" (pending
            // decode) and "drop" (never transmitted).
            this.decoding = new Set();

            // Create the overlay layer. It sits above xterm.js's canvas
            // but below any other UI. We position canvases inside it via
            // absolute CSS with pixel coordinates derived from cell coords.
            this.overlay = document.createElement("div");
            this.overlay.className = "kitty-image-overlay";
            Object.assign(this.overlay.style, {
                position: "absolute",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                overflow: "hidden",
                zIndex: "5",
            });
            // The xterm container must be positioned for absolute children
            // to anchor against it.
            const cs = getComputedStyle(container);
            if (cs.position === "static") container.style.position = "relative";
            container.appendChild(this.overlay);

            this._install();
        }

        // --- Registration and lifecycle -----------------------------------

        _install() {
            // Route kitty APC 'G...' to us. xterm-addon-image should be
            // loaded with kittySupport: false so it doesn't also handle it.
            this.term.parser.registerApcHandler(KITTY_APC_IDENT, (data) =>
                this._onApc(data),
            );

            // Reposition on scroll and resize. xterm.js exposes these via
            // the public API. We use a microtask-batched reposition to
            // avoid layout thrash during rapid updates.
            this._repositionPending = false;
            const schedule = () => {
                if (this._repositionPending) return;
                this._repositionPending = true;
                queueMicrotask(() => {
                    this._repositionPending = false;
                    this._repositionAll();
                });
            };
            this.term.onScroll(schedule);
            this.term.onResize(schedule);
            // Font size / renderer changes also shift cell dimensions.
            window.addEventListener("resize", schedule, { passive: true });
        }

        reset() {
            // Wipe all placements and images (used on terminal reset).
            for (const p of this.placements.values()) {
                if (p.canvas && p.canvas.parentNode) {
                    p.canvas.parentNode.removeChild(p.canvas);
                }
            }
            this.placements.clear();
            this.images.clear();
            this.pending.clear();
            this.pendingPlacement.clear();
        }

        // --- Kitty APC dispatch -------------------------------------------

        _onApc(data) {
            // xterm.js passes the APC payload INCLUDING the ident byte,
            // i.e. data[0] === 'G'. Strip it.
            if (data.charCodeAt(0) === KITTY_APC_IDENT) {
                data = data.slice(1);
            }
            const semi = data.indexOf(";");
            const controlStr = semi >= 0 ? data.slice(0, semi) : data;
            const payload = semi >= 0 ? data.slice(semi + 1) : "";

            const cmd = this._parseControl(controlStr);
            const action = cmd.a || "t";

            try {
                switch (action) {
                    case "t":
                        this._handleTransmit(cmd, payload, false);
                        break;
                    case "T":
                        this._handleTransmit(cmd, payload, true);
                        break;
                    case "p":
                        this._handlePlace(cmd);
                        break;
                    case "d":
                        this._handleDelete(cmd);
                        break;
                    case "q":
                        // Response to queries is handled server-side by
                        // tuios. We're silent here.
                        break;
                    default:
                        // Unknown action: swallow to avoid leaking bytes.
                        break;
                }
            } catch (err) {
                console.warn("[kitty-overlay] handler error:", err, cmd);
            }
            return true;
        }

        _parseControl(str) {
            const out = {};
            if (!str) return out;
            for (const part of str.split(",")) {
                const eq = part.indexOf("=");
                if (eq < 0) continue;
                const key = part.slice(0, eq);
                const val = part.slice(eq + 1);
                // Numeric keys we care about
                if (
                    "iIps vwhxyXYzcrmqCSO".indexOf(key) >= 0 &&
                    val !== "" &&
                    !isNaN(Number(val))
                ) {
                    out[key] = Number(val);
                } else {
                    out[key] = val;
                }
            }
            // Format is numeric
            if (out.f !== undefined) out.f = Number(out.f);
            return out;
        }

        // --- Transmit (and transmit+place) --------------------------------

        _handleTransmit(cmd, payload, andPlace) {
            // Transmission medium: we only support direct base64. tuios
            // server-side re-encodes everything else into direct chunks.
            const medium = cmd.t || "d";
            if (medium !== "d") return;

            const key = this._pendingKey(cmd);

            // Accumulate chunks across multiple APCs. Kitty's m=1 means
            // more chunks follow, m=0 means this is the last (or only).
            let entry = this.pending.get(key);
            if (!entry) {
                entry = { params: { ...cmd }, chunks: [] };
                this.pending.set(key, entry);
                if (andPlace) {
                    // The very first chunk of an a=T stream carries the
                    // placement parameters. Remember the cursor position
                    // so the final placement lands where the guest app
                    // expects, even if the cursor moves during streaming.
                    const cursor = this._currentCursorCell();
                    this.pendingPlacement.set(key, {
                        cellX: cursor.x,
                        cellY: cursor.y,
                        ...cmd,
                    });
                }
            } else {
                // Merge any keys that only appear in later chunks (rare,
                // but chafa sometimes puts placement params on a later
                // chunk). Only fill in missing keys; do NOT clobber ones
                // the first chunk already set.
                for (const k in cmd) {
                    if (entry.params[k] === undefined) {
                        entry.params[k] = cmd[k];
                    }
                }
                if (andPlace && !this.pendingPlacement.has(key)) {
                    const cursor = this._currentCursorCell();
                    this.pendingPlacement.set(key, {
                        cellX: cursor.x,
                        cellY: cursor.y,
                        ...entry.params,
                    });
                }
            }

            if (payload) entry.chunks.push(payload);

            // Not the final chunk yet -> keep buffering.
            if (cmd.m === 1) return;

            // Final chunk. Assemble, decode, build the bitmap, then run
            // any pending placement.
            const fullB64 = entry.chunks.join("");
            const params = entry.params;
            this.pending.delete(key);

            const placementSpec = this.pendingPlacement.get(key);
            this.pendingPlacement.delete(key);

            const imageId = params.i | 0;

            this.decoding.add(imageId);
            this._decodeAndStore(imageId, params, fullB64)
                .then(() => {
                    this.decoding.delete(imageId);
                    if (placementSpec) {
                        this._placeImage(imageId, placementSpec);
                    }
                    // Drain any place commands that arrived while we
                    // were decoding (tuios emits a=t then a=p back to
                    // back; the place lands on the parser thread before
                    // createImageBitmap resolves).
                    const queued = this.deferredPlacements.get(imageId);
                    if (queued) {
                        this.deferredPlacements.delete(imageId);
                        for (const spec of queued) {
                            this._placeImage(imageId, spec);
                        }
                    }
                })
                .catch((err) => {
                    this.decoding.delete(imageId);
                    this.deferredPlacements.delete(imageId);
                    console.warn("[kitty-overlay] decode failed:", err);
                });
        }

        async _decodeAndStore(imageId, params, b64) {
            const raw = this._base64Decode(b64);
            const bytes =
                params.o === "z" ? await this._inflate(raw) : raw;

            const fmt = params.f | 0 || 32;
            const width = params.s | 0;
            const height = params.v | 0;

            let bitmap;
            if (fmt === 100) {
                // PNG bytes
                const blob = new Blob([bytes], { type: "image/png" });
                bitmap = await createImageBitmap(blob);
            } else if (fmt === 24 || fmt === 32) {
                // Raw RGB / RGBA, width x height pixels
                if (!width || !height) throw new Error("missing s/v for raw");
                const rgba =
                    fmt === 32 ? bytes : this._rgbToRgba(bytes, width, height);
                const imageData = new ImageData(
                    new Uint8ClampedArray(
                        rgba.buffer,
                        rgba.byteOffset,
                        rgba.byteLength,
                    ),
                    width,
                    height,
                );
                bitmap = await createImageBitmap(imageData);
            } else {
                throw new Error(`unsupported format f=${fmt}`);
            }

            // If an image with this id already exists we're in a
            // re-transmit path (e.g. per-frame video playback by youterm
            // or mpv, which keeps i= constant and just refreshes the data).
            // Close the previous bitmap to free GPU memory, then re-render
            // every placement that references this id so the new frame is
            // actually shown instead of the stale bitmap the canvases
            // already painted.
            const previous = this.images.get(imageId);
            if (previous && previous.bitmap && previous.bitmap.close) {
                try {
                    previous.bitmap.close();
                } catch (e) {}
            }

            const entry = {
                bitmap,
                width: bitmap.width,
                height: bitmap.height,
            };
            this.images.set(imageId, entry);

            if (previous) {
                for (const placement of this.placements.values()) {
                    if (placement.imageId === imageId) {
                        this._renderPlacement(placement, entry);
                    }
                }
            }
        }

        _base64Decode(b64) {
            const bin = atob(b64);
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        }

        async _inflate(bytes) {
            if (typeof DecompressionStream === "undefined") {
                throw new Error("DecompressionStream unavailable");
            }
            const stream = new Blob([bytes])
                .stream()
                .pipeThrough(new DecompressionStream("deflate"));
            const buf = await new Response(stream).arrayBuffer();
            return new Uint8Array(buf);
        }

        _rgbToRgba(rgb, w, h) {
            const out = new Uint8Array(w * h * 4);
            for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
                out[j] = rgb[i];
                out[j + 1] = rgb[i + 1];
                out[j + 2] = rgb[i + 2];
                out[j + 3] = 255;
            }
            return out;
        }

        // --- Place --------------------------------------------------------

        _handlePlace(cmd) {
            const imageId = cmd.i | 0;
            const cursor = this._currentCursorCell();
            const spec = {
                cellX: cursor.x,
                cellY: cursor.y,
                ...cmd,
            };

            if (this.images.has(imageId)) {
                this._placeImage(imageId, spec);
                return;
            }

            if (this.decoding.has(imageId)) {
                // Decode in flight. Queue the latest spec; if multiple
                // places come in before decode finishes (e.g. tuios's
                // RefreshAllPlacements firing between frames), we only
                // need to apply the most recent position, so replace
                // any previous queued entry for the same placement id.
                let queue = this.deferredPlacements.get(imageId);
                if (!queue) {
                    queue = [];
                    this.deferredPlacements.set(imageId, queue);
                }
                const pid = (spec.p | 0) || 1;
                const existingIdx = queue.findIndex(
                    (s) => ((s.p | 0) || 1) === pid,
                );
                if (existingIdx >= 0) {
                    queue[existingIdx] = spec;
                } else {
                    queue.push(spec);
                }
                return;
            }

            // Image was never transmitted (or got evicted). Drop.
        }

        _placeImage(imageId, spec) {
            const img = this.images.get(imageId);
            if (!img) return;

            const placementId = (spec.p | 0) || 1;
            const key = `${imageId}/${placementId}`;

            // Resolve display cell dimensions. Kitty lets the emitter
            // specify c (cols) and r (rows); if missing, derive from the
            // source rect or the full image via cell pixel size.
            const cellPx = this._cellPixels();
            let cols = spec.c | 0;
            let rows = spec.r | 0;
            const srcW = (spec.w | 0) || img.width;
            const srcH = (spec.h | 0) || img.height;
            if (cols <= 0) {
                cols = Math.max(1, Math.ceil(srcW / cellPx.width));
            }
            if (rows <= 0) {
                rows = Math.max(1, Math.ceil(srcH / cellPx.height));
            }

            const srcX = spec.x | 0;
            const srcY = spec.y | 0;

            let placement = this.placements.get(key);
            if (!placement) {
                const canvas = document.createElement("canvas");
                Object.assign(canvas.style, {
                    position: "absolute",
                    pointerEvents: "none",
                    imageRendering: "auto",
                });
                this.overlay.appendChild(canvas);
                placement = { imageId, placementId, canvas };
                this.placements.set(key, placement);
            }

            placement.cellX = spec.cellX | 0;
            placement.cellY = spec.cellY | 0;
            placement.cols = cols;
            placement.rows = rows;
            placement.srcX = srcX;
            placement.srcY = srcY;
            placement.srcW = srcW;
            placement.srcH = srcH;
            placement.z = (spec.z | 0) || 0;

            this._renderPlacement(placement, img);
            this._positionPlacement(placement);
        }

        _renderPlacement(p, img) {
            const cellPx = this._cellPixels();
            const dpr = window.devicePixelRatio || 1;
            const cssW = p.cols * cellPx.width;
            const cssH = p.rows * cellPx.height;

            const canvas = p.canvas;
            canvas.width = Math.max(1, Math.round(cssW * dpr));
            canvas.height = Math.max(1, Math.round(cssH * dpr));
            canvas.style.width = `${cssW}px`;
            canvas.style.height = `${cssH}px`;
            canvas.style.zIndex = String(p.z);

            const ctx = canvas.getContext("2d");
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssW, cssH);
            // Clamp source rect to the image's native pixel bounds so
            // drawImage never throws InvalidStateError when callers pass
            // a region that overflows the image (tuios does this defensively).
            let sx = p.srcX;
            let sy = p.srcY;
            let sw = p.srcW;
            let sh = p.srcH;
            if (sx < 0) {
                sw += sx;
                sx = 0;
            }
            if (sy < 0) {
                sh += sy;
                sy = 0;
            }
            if (sx + sw > img.width) sw = img.width - sx;
            if (sy + sh > img.height) sh = img.height - sy;
            if (sw > 0 && sh > 0) {
                ctx.drawImage(img.bitmap, sx, sy, sw, sh, 0, 0, cssW, cssH);
            }
        }

        _positionPlacement(p) {
            const cellPx = this._cellPixels();
            // Placements are stored in VIEWPORT-relative cell coordinates.
            // This matches tuios's compositor model: tuios draws on the
            // active screen and does not participate in xterm.js scrollback.
            // If we tracked absolute buffer rows, any LF emitted by the
            // guest (e.g. chafa's ReserveImageSpace) would advance ybase
            // and leave the placement parked in scrollback history,
            // visible only to the user scrolling up. Instead we pin
            // placements to the visible viewport; tuios re-emits a=p on
            // every render cycle to keep positions fresh.
            const left = p.cellX * cellPx.width;
            const top = p.cellY * cellPx.height;
            p.canvas.style.transform = `translate(${left}px, ${top}px)`;

            const rows = this.term.rows;
            const visible = p.cellY + p.rows > 0 && p.cellY < rows;
            p.canvas.style.display = visible ? "block" : "none";
        }

        _repositionAll() {
            // Cell pixel dimensions may have changed (resize / font change);
            // re-render AND reposition.
            for (const p of this.placements.values()) {
                const img = this.images.get(p.imageId);
                if (img) this._renderPlacement(p, img);
                this._positionPlacement(p);
            }
        }

        // --- Delete -------------------------------------------------------

        _handleDelete(cmd) {
            const sel = cmd.d || "a";
            const freeData = sel === sel.toUpperCase();
            const low = sel.toLowerCase();

            switch (low) {
                case "a": {
                    for (const p of this.placements.values()) {
                        this._detachPlacement(p);
                    }
                    this.placements.clear();
                    if (freeData) this.images.clear();
                    break;
                }
                case "i": {
                    const id = cmd.i | 0;
                    const toDelete = [];
                    for (const [k, p] of this.placements) {
                        if (p.imageId === id) toDelete.push(k);
                    }
                    for (const k of toDelete) {
                        this._detachPlacement(this.placements.get(k));
                        this.placements.delete(k);
                    }
                    if (freeData) this.images.delete(id);
                    break;
                }
                case "p": {
                    const id = cmd.i | 0;
                    const pid = cmd.p | 0;
                    const key = `${id}/${pid}`;
                    const p = this.placements.get(key);
                    if (p) {
                        this._detachPlacement(p);
                        this.placements.delete(key);
                    }
                    break;
                }
                default:
                    // Other selectors (n, z, x, y, ...) not implemented.
                    break;
            }
        }

        _detachPlacement(p) {
            if (p && p.canvas && p.canvas.parentNode) {
                p.canvas.parentNode.removeChild(p.canvas);
            }
        }

        // --- Helpers ------------------------------------------------------

        _pendingKey(cmd) {
            // tuios emits many transmits with i=0. We still need to
            // accumulate chunks per-stream. Fall back to a sentinel; kitty
            // only allows one in-flight chunked transmission per id anyway.
            const id = cmd.i | 0;
            return `i:${id}`;
        }

        _currentCursorCell() {
            // Viewport-relative cursor cell. See _positionPlacement for
            // the rationale on storing viewport coordinates rather than
            // absolute buffer rows.
            const buf = this.term.buffer.active;
            return {
                x: buf.cursorX | 0,
                y: buf.cursorY | 0,
            };
        }

        _cellPixels() {
            // Prefer the live render-service dimensions (accurate after
            // any font/size/DPI change). Fall back to computed values from
            // the terminal's options if the private path isn't available.
            try {
                const dims = this.term._core._renderService.dimensions.css.cell;
                if (dims && dims.width && dims.height) {
                    return { width: dims.width, height: dims.height };
                }
            } catch (e) {}
            // Fallback: derive from font size. Rough 0.6:1.2 cell ratio.
            const fs = this.term.options.fontSize || 14;
            return { width: fs * 0.6, height: fs * 1.2 };
        }
    }

    // Expose globally so terminal.js can instantiate it.
    window.KittyOverlay = KittyOverlay;
})();
