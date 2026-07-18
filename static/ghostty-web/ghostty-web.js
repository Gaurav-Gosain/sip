var gQ = Object.defineProperty;
var IQ = (A, g, B) => g in A ? gQ(A, g, { enumerable: !0, configurable: !0, writable: !0, value: B }) : A[g] = B;
var q = (A, g, B) => (IQ(A, typeof g != "symbol" ? g + "" : g, B), B);
function og(A, g = "utf8") {
  return new TextDecoder(g).decode(A);
}
const QQ = new TextEncoder();
function CQ(A) {
  return QQ.encode(A);
}
const EQ = 1024 * 8, iQ = (() => {
  const A = new Uint8Array(4), g = new Uint32Array(A.buffer);
  return !((g[0] = 1) & A[0]);
})(), cB = {
  int8: globalThis.Int8Array,
  uint8: globalThis.Uint8Array,
  int16: globalThis.Int16Array,
  uint16: globalThis.Uint16Array,
  int32: globalThis.Int32Array,
  uint32: globalThis.Uint32Array,
  uint64: globalThis.BigUint64Array,
  int64: globalThis.BigInt64Array,
  float32: globalThis.Float32Array,
  float64: globalThis.Float64Array
};
class VB {
  /**
   * Create a new IOBuffer.
   * @param data - The data to construct the IOBuffer with.
   * If data is a number, it will be the new buffer's length<br>
   * If data is `undefined`, the buffer will be initialized with a default length of 8Kb<br>
   * If data is an ArrayBuffer, SharedArrayBuffer, an ArrayBufferView (Typed Array), an IOBuffer instance,
   * or a Node.js Buffer, a view will be created over the underlying ArrayBuffer.
   * @param options - An object for the options.
   * @returns A new IOBuffer instance.
   */
  constructor(g = EQ, B = {}) {
    /**
     * Reference to the internal ArrayBuffer object.
     */
    q(this, "buffer");
    /**
     * Byte length of the internal ArrayBuffer.
     */
    q(this, "byteLength");
    /**
     * Byte offset of the internal ArrayBuffer.
     */
    q(this, "byteOffset");
    /**
     * Byte length of the internal ArrayBuffer.
     */
    q(this, "length");
    /**
     * The current offset of the buffer's pointer.
     */
    q(this, "offset");
    q(this, "lastWrittenByte");
    q(this, "littleEndian");
    q(this, "_data");
    q(this, "_mark");
    q(this, "_marks");
    let I = !1;
    typeof g == "number" ? g = new ArrayBuffer(g) : (I = !0, this.lastWrittenByte = g.byteLength);
    const Q = B.offset ? B.offset >>> 0 : 0, C = g.byteLength - Q;
    let E = Q;
    (ArrayBuffer.isView(g) || g instanceof VB) && (g.byteLength !== g.buffer.byteLength && (E = g.byteOffset + Q), g = g.buffer), I ? this.lastWrittenByte = C : this.lastWrittenByte = 0, this.buffer = g, this.length = C, this.byteLength = C, this.byteOffset = E, this.offset = 0, this.littleEndian = !0, this._data = new DataView(this.buffer, E, C), this._mark = 0, this._marks = [];
  }
  /**
   * Checks if the memory allocated to the buffer is sufficient to store more
   * bytes after the offset.
   * @param byteLength - The needed memory in bytes.
   * @returns `true` if there is sufficient space and `false` otherwise.
   */
  available(g = 1) {
    return this.offset + g <= this.length;
  }
  /**
   * Check if little-endian mode is used for reading and writing multi-byte
   * values.
   * @returns `true` if little-endian mode is used, `false` otherwise.
   */
  isLittleEndian() {
    return this.littleEndian;
  }
  /**
   * Set little-endian mode for reading and writing multi-byte values.
   * @returns This.
   */
  setLittleEndian() {
    return this.littleEndian = !0, this;
  }
  /**
   * Check if big-endian mode is used for reading and writing multi-byte values.
   * @returns `true` if big-endian mode is used, `false` otherwise.
   */
  isBigEndian() {
    return !this.littleEndian;
  }
  /**
   * Switches to big-endian mode for reading and writing multi-byte values.
   * @returns This.
   */
  setBigEndian() {
    return this.littleEndian = !1, this;
  }
  /**
   * Move the pointer n bytes forward.
   * @param n - Number of bytes to skip.
   * @returns This.
   */
  skip(g = 1) {
    return this.offset += g, this;
  }
  /**
   * Move the pointer n bytes backward.
   * @param n - Number of bytes to move back.
   * @returns This.
   */
  back(g = 1) {
    return this.offset -= g, this;
  }
  /**
   * Move the pointer to the given offset.
   * @param offset - The offset to move to.
   * @returns This.
   */
  seek(g) {
    return this.offset = g, this;
  }
  /**
   * Store the current pointer offset.
   * @see {@link IOBuffer#reset}
   * @returns This.
   */
  mark() {
    return this._mark = this.offset, this;
  }
  /**
   * Move the pointer back to the last pointer offset set by mark.
   * @see {@link IOBuffer#mark}
   * @returns This.
   */
  reset() {
    return this.offset = this._mark, this;
  }
  /**
   * Push the current pointer offset to the mark stack.
   * @see {@link IOBuffer#popMark}
   * @returns This.
   */
  pushMark() {
    return this._marks.push(this.offset), this;
  }
  /**
   * Pop the last pointer offset from the mark stack, and set the current
   * pointer offset to the popped value.
   * @see {@link IOBuffer#pushMark}
   * @returns This.
   */
  popMark() {
    const g = this._marks.pop();
    if (g === void 0)
      throw new Error("Mark stack empty");
    return this.seek(g), this;
  }
  /**
   * Move the pointer offset back to 0.
   * @returns This.
   */
  rewind() {
    return this.offset = 0, this;
  }
  /**
   * Make sure the buffer has sufficient memory to write a given byteLength at
   * the current pointer offset.
   * If the buffer's memory is insufficient, this method will create a new
   * buffer (a copy) with a length that is twice (byteLength + current offset).
   * @param byteLength - The needed memory in bytes.
   * @returns This.
   */
  ensureAvailable(g = 1) {
    if (!this.available(g)) {
      const I = (this.offset + g) * 2, Q = new Uint8Array(I);
      Q.set(new Uint8Array(this.buffer)), this.buffer = Q.buffer, this.length = I, this.byteLength = I, this._data = new DataView(this.buffer);
    }
    return this;
  }
  /**
   * Read a byte and return false if the byte's value is 0, or true otherwise.
   * Moves pointer forward by one byte.
   * @returns The read boolean.
   */
  readBoolean() {
    return this.readUint8() !== 0;
  }
  /**
   * Read a signed 8-bit integer and move pointer forward by 1 byte.
   * @returns The read byte.
   */
  readInt8() {
    return this._data.getInt8(this.offset++);
  }
  /**
   * Read an unsigned 8-bit integer and move pointer forward by 1 byte.
   * @returns The read byte.
   */
  readUint8() {
    return this._data.getUint8(this.offset++);
  }
  /**
   * Alias for {@link IOBuffer#readUint8}.
   * @returns The read byte.
   */
  readByte() {
    return this.readUint8();
  }
  /**
   * Read `n` bytes and move pointer forward by `n` bytes.
   * @param n - Number of bytes to read.
   * @returns The read bytes.
   */
  readBytes(g = 1) {
    return this.readArray(g, "uint8");
  }
  /**
   * Creates an array of corresponding to the type `type` and size `size`.
   * For example, type `uint8` will create a `Uint8Array`.
   * @param size - size of the resulting array
   * @param type - number type of elements to read
   * @returns The read array.
   */
  readArray(g, B) {
    const I = cB[B].BYTES_PER_ELEMENT * g, Q = this.byteOffset + this.offset, C = this.buffer.slice(Q, Q + I);
    if (this.littleEndian === iQ && B !== "uint8" && B !== "int8") {
      const i = new Uint8Array(this.buffer.slice(Q, Q + I));
      i.reverse();
      const D = new cB[B](i.buffer);
      return this.offset += I, D.reverse(), D;
    }
    const E = new cB[B](C);
    return this.offset += I, E;
  }
  /**
   * Read a 16-bit signed integer and move pointer forward by 2 bytes.
   * @returns The read value.
   */
  readInt16() {
    const g = this._data.getInt16(this.offset, this.littleEndian);
    return this.offset += 2, g;
  }
  /**
   * Read a 16-bit unsigned integer and move pointer forward by 2 bytes.
   * @returns The read value.
   */
  readUint16() {
    const g = this._data.getUint16(this.offset, this.littleEndian);
    return this.offset += 2, g;
  }
  /**
   * Read a 32-bit signed integer and move pointer forward by 4 bytes.
   * @returns The read value.
   */
  readInt32() {
    const g = this._data.getInt32(this.offset, this.littleEndian);
    return this.offset += 4, g;
  }
  /**
   * Read a 32-bit unsigned integer and move pointer forward by 4 bytes.
   * @returns The read value.
   */
  readUint32() {
    const g = this._data.getUint32(this.offset, this.littleEndian);
    return this.offset += 4, g;
  }
  /**
   * Read a 32-bit floating number and move pointer forward by 4 bytes.
   * @returns The read value.
   */
  readFloat32() {
    const g = this._data.getFloat32(this.offset, this.littleEndian);
    return this.offset += 4, g;
  }
  /**
   * Read a 64-bit floating number and move pointer forward by 8 bytes.
   * @returns The read value.
   */
  readFloat64() {
    const g = this._data.getFloat64(this.offset, this.littleEndian);
    return this.offset += 8, g;
  }
  /**
   * Read a 64-bit signed integer number and move pointer forward by 8 bytes.
   * @returns The read value.
   */
  readBigInt64() {
    const g = this._data.getBigInt64(this.offset, this.littleEndian);
    return this.offset += 8, g;
  }
  /**
   * Read a 64-bit unsigned integer number and move pointer forward by 8 bytes.
   * @returns The read value.
   */
  readBigUint64() {
    const g = this._data.getBigUint64(this.offset, this.littleEndian);
    return this.offset += 8, g;
  }
  /**
   * Read a 1-byte ASCII character and move pointer forward by 1 byte.
   * @returns The read character.
   */
  readChar() {
    return String.fromCharCode(this.readInt8());
  }
  /**
   * Read `n` 1-byte ASCII characters and move pointer forward by `n` bytes.
   * @param n - Number of characters to read.
   * @returns The read characters.
   */
  readChars(g = 1) {
    let B = "";
    for (let I = 0; I < g; I++)
      B += this.readChar();
    return B;
  }
  /**
   * Read the next `n` bytes, return a UTF-8 decoded string and move pointer
   * forward by `n` bytes.
   * @param n - Number of bytes to read.
   * @returns The decoded string.
   */
  readUtf8(g = 1) {
    return og(this.readBytes(g));
  }
  /**
   * Read the next `n` bytes, return a string decoded with `encoding` and move pointer
   * forward by `n` bytes.
   * If no encoding is passed, the function is equivalent to @see {@link IOBuffer#readUtf8}
   * @param n - Number of bytes to read.
   * @param encoding - The encoding to use. Default is 'utf8'.
   * @returns The decoded string.
   */
  decodeText(g = 1, B = "utf8") {
    return og(this.readBytes(g), B);
  }
  /**
   * Write 0xff if the passed value is truthy, 0x00 otherwise and move pointer
   * forward by 1 byte.
   * @param value - The value to write.
   * @returns This.
   */
  writeBoolean(g) {
    return this.writeUint8(g ? 255 : 0), this;
  }
  /**
   * Write `value` as an 8-bit signed integer and move pointer forward by 1 byte.
   * @param value - The value to write.
   * @returns This.
   */
  writeInt8(g) {
    return this.ensureAvailable(1), this._data.setInt8(this.offset++, g), this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as an 8-bit unsigned integer and move pointer forward by 1
   * byte.
   * @param value - The value to write.
   * @returns This.
   */
  writeUint8(g) {
    return this.ensureAvailable(1), this._data.setUint8(this.offset++, g), this._updateLastWrittenByte(), this;
  }
  /**
   * An alias for {@link IOBuffer#writeUint8}.
   * @param value - The value to write.
   * @returns This.
   */
  writeByte(g) {
    return this.writeUint8(g);
  }
  /**
   * Write all elements of `bytes` as uint8 values and move pointer forward by
   * `bytes.length` bytes.
   * @param bytes - The array of bytes to write.
   * @returns This.
   */
  writeBytes(g) {
    this.ensureAvailable(g.length);
    for (let B = 0; B < g.length; B++)
      this._data.setUint8(this.offset++, g[B]);
    return this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 16-bit signed integer and move pointer forward by 2
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeInt16(g) {
    return this.ensureAvailable(2), this._data.setInt16(this.offset, g, this.littleEndian), this.offset += 2, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 16-bit unsigned integer and move pointer forward by 2
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeUint16(g) {
    return this.ensureAvailable(2), this._data.setUint16(this.offset, g, this.littleEndian), this.offset += 2, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 32-bit signed integer and move pointer forward by 4
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeInt32(g) {
    return this.ensureAvailable(4), this._data.setInt32(this.offset, g, this.littleEndian), this.offset += 4, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 32-bit unsigned integer and move pointer forward by 4
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeUint32(g) {
    return this.ensureAvailable(4), this._data.setUint32(this.offset, g, this.littleEndian), this.offset += 4, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 32-bit floating number and move pointer forward by 4
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeFloat32(g) {
    return this.ensureAvailable(4), this._data.setFloat32(this.offset, g, this.littleEndian), this.offset += 4, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 64-bit floating number and move pointer forward by 8
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeFloat64(g) {
    return this.ensureAvailable(8), this._data.setFloat64(this.offset, g, this.littleEndian), this.offset += 8, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 64-bit signed bigint and move pointer forward by 8
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeBigInt64(g) {
    return this.ensureAvailable(8), this._data.setBigInt64(this.offset, g, this.littleEndian), this.offset += 8, this._updateLastWrittenByte(), this;
  }
  /**
   * Write `value` as a 64-bit unsigned bigint and move pointer forward by 8
   * bytes.
   * @param value - The value to write.
   * @returns This.
   */
  writeBigUint64(g) {
    return this.ensureAvailable(8), this._data.setBigUint64(this.offset, g, this.littleEndian), this.offset += 8, this._updateLastWrittenByte(), this;
  }
  /**
   * Write the charCode of `str`'s first character as an 8-bit unsigned integer
   * and move pointer forward by 1 byte.
   * @param str - The character to write.
   * @returns This.
   */
  writeChar(g) {
    return this.writeUint8(g.charCodeAt(0));
  }
  /**
   * Write the charCodes of all `str`'s characters as 8-bit unsigned integers
   * and move pointer forward by `str.length` bytes.
   * @param str - The characters to write.
   * @returns This.
   */
  writeChars(g) {
    for (let B = 0; B < g.length; B++)
      this.writeUint8(g.charCodeAt(B));
    return this;
  }
  /**
   * UTF-8 encode and write `str` to the current pointer offset and move pointer
   * forward according to the encoded length.
   * @param str - The string to write.
   * @returns This.
   */
  writeUtf8(g) {
    return this.writeBytes(CQ(g));
  }
  /**
   * Export a Uint8Array view of the internal buffer.
   * The view starts at the byte offset and its length
   * is calculated to stop at the last written byte or the original length.
   * @returns A new Uint8Array view.
   */
  toArray() {
    return new Uint8Array(this.buffer, this.byteOffset, this.lastWrittenByte);
  }
  /**
   *  Get the total number of bytes written so far, regardless of the current offset.
   * @returns - Total number of bytes.
   */
  getWrittenByteLength() {
    return this.lastWrittenByte - this.byteOffset;
  }
  /**
   * Update the last written byte offset
   * @private
   */
  _updateLastWrittenByte() {
    this.offset > this.lastWrittenByte && (this.lastWrittenByte = this.offset);
  }
}
/*! pako 2.1.0 https://github.com/nodeca/pako @license (MIT AND Zlib) */
const oQ = 4, wg = 0, Dg = 1, wQ = 2;
function yA(A) {
  let g = A.length;
  for (; --g >= 0; )
    A[g] = 0;
}
const DQ = 0, CI = 1, sQ = 2, tQ = 3, eQ = 258, _B = 29, ZA = 256, OA = ZA + 1 + _B, NA = 30, $B = 19, EI = 2 * OA + 1, DA = 15, kB = 16, aQ = 7, Ag = 256, iI = 16, oI = 17, wI = 18, pB = (
  /* extra bits for each length code */
  new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0])
), CB = (
  /* extra bits for each distance code */
  new Uint8Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13])
), hQ = (
  /* extra bits for each bit length code */
  new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7])
), DI = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]), GQ = 512, _ = new Array((OA + 2) * 2);
yA(_);
const UA = new Array(NA * 2);
yA(UA);
const xA = new Array(GQ);
yA(xA);
const bA = new Array(eQ - tQ + 1);
yA(bA);
const Bg = new Array(_B);
yA(Bg);
const wB = new Array(NA);
yA(wB);
function MB(A, g, B, I, Q) {
  this.static_tree = A, this.extra_bits = g, this.extra_base = B, this.elems = I, this.max_length = Q, this.has_stree = A && A.length;
}
let sI, tI, eI;
function NB(A, g) {
  this.dyn_tree = A, this.max_code = 0, this.stat_desc = g;
}
const aI = (A) => A < 256 ? xA[A] : xA[256 + (A >>> 7)], jA = (A, g) => {
  A.pending_buf[A.pending++] = g & 255, A.pending_buf[A.pending++] = g >>> 8 & 255;
}, O = (A, g, B) => {
  A.bi_valid > kB - B ? (A.bi_buf |= g << A.bi_valid & 65535, jA(A, A.bi_buf), A.bi_buf = g >> kB - A.bi_valid, A.bi_valid += B - kB) : (A.bi_buf |= g << A.bi_valid & 65535, A.bi_valid += B);
}, Z = (A, g, B) => {
  O(
    A,
    B[g * 2],
    B[g * 2 + 1]
    /*.Len*/
  );
}, hI = (A, g) => {
  let B = 0;
  do
    B |= A & 1, A >>>= 1, B <<= 1;
  while (--g > 0);
  return B >>> 1;
}, cQ = (A) => {
  A.bi_valid === 16 ? (jA(A, A.bi_buf), A.bi_buf = 0, A.bi_valid = 0) : A.bi_valid >= 8 && (A.pending_buf[A.pending++] = A.bi_buf & 255, A.bi_buf >>= 8, A.bi_valid -= 8);
}, kQ = (A, g) => {
  const B = g.dyn_tree, I = g.max_code, Q = g.stat_desc.static_tree, C = g.stat_desc.has_stree, E = g.stat_desc.extra_bits, i = g.stat_desc.extra_base, D = g.stat_desc.max_length;
  let o, w, t, e, s, a, k = 0;
  for (e = 0; e <= DA; e++)
    A.bl_count[e] = 0;
  for (B[A.heap[A.heap_max] * 2 + 1] = 0, o = A.heap_max + 1; o < EI; o++)
    w = A.heap[o], e = B[B[w * 2 + 1] * 2 + 1] + 1, e > D && (e = D, k++), B[w * 2 + 1] = e, !(w > I) && (A.bl_count[e]++, s = 0, w >= i && (s = E[w - i]), a = B[w * 2], A.opt_len += a * (e + s), C && (A.static_len += a * (Q[w * 2 + 1] + s)));
  if (k !== 0) {
    do {
      for (e = D - 1; A.bl_count[e] === 0; )
        e--;
      A.bl_count[e]--, A.bl_count[e + 1] += 2, A.bl_count[D]--, k -= 2;
    } while (k > 0);
    for (e = D; e !== 0; e--)
      for (w = A.bl_count[e]; w !== 0; )
        t = A.heap[--o], !(t > I) && (B[t * 2 + 1] !== e && (A.opt_len += (e - B[t * 2 + 1]) * B[t * 2], B[t * 2 + 1] = e), w--);
  }
}, GI = (A, g, B) => {
  const I = new Array(DA + 1);
  let Q = 0, C, E;
  for (C = 1; C <= DA; C++)
    Q = Q + B[C - 1] << 1, I[C] = Q;
  for (E = 0; E <= g; E++) {
    let i = A[E * 2 + 1];
    i !== 0 && (A[E * 2] = hI(I[i]++, i));
  }
}, MQ = () => {
  let A, g, B, I, Q;
  const C = new Array(DA + 1);
  for (B = 0, I = 0; I < _B - 1; I++)
    for (Bg[I] = B, A = 0; A < 1 << pB[I]; A++)
      bA[B++] = I;
  for (bA[B - 1] = I, Q = 0, I = 0; I < 16; I++)
    for (wB[I] = Q, A = 0; A < 1 << CB[I]; A++)
      xA[Q++] = I;
  for (Q >>= 7; I < NA; I++)
    for (wB[I] = Q << 7, A = 0; A < 1 << CB[I] - 7; A++)
      xA[256 + Q++] = I;
  for (g = 0; g <= DA; g++)
    C[g] = 0;
  for (A = 0; A <= 143; )
    _[A * 2 + 1] = 8, A++, C[8]++;
  for (; A <= 255; )
    _[A * 2 + 1] = 9, A++, C[9]++;
  for (; A <= 279; )
    _[A * 2 + 1] = 7, A++, C[7]++;
  for (; A <= 287; )
    _[A * 2 + 1] = 8, A++, C[8]++;
  for (GI(_, OA + 1, C), A = 0; A < NA; A++)
    UA[A * 2 + 1] = 5, UA[A * 2] = hI(A, 5);
  sI = new MB(_, pB, ZA + 1, OA, DA), tI = new MB(UA, CB, 0, NA, DA), eI = new MB(new Array(0), hQ, 0, $B, aQ);
}, cI = (A) => {
  let g;
  for (g = 0; g < OA; g++)
    A.dyn_ltree[g * 2] = 0;
  for (g = 0; g < NA; g++)
    A.dyn_dtree[g * 2] = 0;
  for (g = 0; g < $B; g++)
    A.bl_tree[g * 2] = 0;
  A.dyn_ltree[Ag * 2] = 1, A.opt_len = A.static_len = 0, A.sym_next = A.matches = 0;
}, kI = (A) => {
  A.bi_valid > 8 ? jA(A, A.bi_buf) : A.bi_valid > 0 && (A.pending_buf[A.pending++] = A.bi_buf), A.bi_buf = 0, A.bi_valid = 0;
}, sg = (A, g, B, I) => {
  const Q = g * 2, C = B * 2;
  return A[Q] < A[C] || A[Q] === A[C] && I[g] <= I[B];
}, rB = (A, g, B) => {
  const I = A.heap[B];
  let Q = B << 1;
  for (; Q <= A.heap_len && (Q < A.heap_len && sg(g, A.heap[Q + 1], A.heap[Q], A.depth) && Q++, !sg(g, I, A.heap[Q], A.depth)); )
    A.heap[B] = A.heap[Q], B = Q, Q <<= 1;
  A.heap[B] = I;
}, tg = (A, g, B) => {
  let I, Q, C = 0, E, i;
  if (A.sym_next !== 0)
    do
      I = A.pending_buf[A.sym_buf + C++] & 255, I += (A.pending_buf[A.sym_buf + C++] & 255) << 8, Q = A.pending_buf[A.sym_buf + C++], I === 0 ? Z(A, Q, g) : (E = bA[Q], Z(A, E + ZA + 1, g), i = pB[E], i !== 0 && (Q -= Bg[E], O(A, Q, i)), I--, E = aI(I), Z(A, E, B), i = CB[E], i !== 0 && (I -= wB[E], O(A, I, i)));
    while (C < A.sym_next);
  Z(A, Ag, g);
}, OB = (A, g) => {
  const B = g.dyn_tree, I = g.stat_desc.static_tree, Q = g.stat_desc.has_stree, C = g.stat_desc.elems;
  let E, i, D = -1, o;
  for (A.heap_len = 0, A.heap_max = EI, E = 0; E < C; E++)
    B[E * 2] !== 0 ? (A.heap[++A.heap_len] = D = E, A.depth[E] = 0) : B[E * 2 + 1] = 0;
  for (; A.heap_len < 2; )
    o = A.heap[++A.heap_len] = D < 2 ? ++D : 0, B[o * 2] = 1, A.depth[o] = 0, A.opt_len--, Q && (A.static_len -= I[o * 2 + 1]);
  for (g.max_code = D, E = A.heap_len >> 1; E >= 1; E--)
    rB(A, B, E);
  o = C;
  do
    E = A.heap[
      1
      /*SMALLEST*/
    ], A.heap[
      1
      /*SMALLEST*/
    ] = A.heap[A.heap_len--], rB(
      A,
      B,
      1
      /*SMALLEST*/
    ), i = A.heap[
      1
      /*SMALLEST*/
    ], A.heap[--A.heap_max] = E, A.heap[--A.heap_max] = i, B[o * 2] = B[E * 2] + B[i * 2], A.depth[o] = (A.depth[E] >= A.depth[i] ? A.depth[E] : A.depth[i]) + 1, B[E * 2 + 1] = B[i * 2 + 1] = o, A.heap[
      1
      /*SMALLEST*/
    ] = o++, rB(
      A,
      B,
      1
      /*SMALLEST*/
    );
  while (A.heap_len >= 2);
  A.heap[--A.heap_max] = A.heap[
    1
    /*SMALLEST*/
  ], kQ(A, g), GI(B, D, A.bl_count);
}, eg = (A, g, B) => {
  let I, Q = -1, C, E = g[0 * 2 + 1], i = 0, D = 7, o = 4;
  for (E === 0 && (D = 138, o = 3), g[(B + 1) * 2 + 1] = 65535, I = 0; I <= B; I++)
    C = E, E = g[(I + 1) * 2 + 1], !(++i < D && C === E) && (i < o ? A.bl_tree[C * 2] += i : C !== 0 ? (C !== Q && A.bl_tree[C * 2]++, A.bl_tree[iI * 2]++) : i <= 10 ? A.bl_tree[oI * 2]++ : A.bl_tree[wI * 2]++, i = 0, Q = C, E === 0 ? (D = 138, o = 3) : C === E ? (D = 6, o = 3) : (D = 7, o = 4));
}, ag = (A, g, B) => {
  let I, Q = -1, C, E = g[0 * 2 + 1], i = 0, D = 7, o = 4;
  for (E === 0 && (D = 138, o = 3), I = 0; I <= B; I++)
    if (C = E, E = g[(I + 1) * 2 + 1], !(++i < D && C === E)) {
      if (i < o)
        do
          Z(A, C, A.bl_tree);
        while (--i !== 0);
      else
        C !== 0 ? (C !== Q && (Z(A, C, A.bl_tree), i--), Z(A, iI, A.bl_tree), O(A, i - 3, 2)) : i <= 10 ? (Z(A, oI, A.bl_tree), O(A, i - 3, 3)) : (Z(A, wI, A.bl_tree), O(A, i - 11, 7));
      i = 0, Q = C, E === 0 ? (D = 138, o = 3) : C === E ? (D = 6, o = 3) : (D = 7, o = 4);
    }
}, NQ = (A) => {
  let g;
  for (eg(A, A.dyn_ltree, A.l_desc.max_code), eg(A, A.dyn_dtree, A.d_desc.max_code), OB(A, A.bl_desc), g = $B - 1; g >= 3 && A.bl_tree[DI[g] * 2 + 1] === 0; g--)
    ;
  return A.opt_len += 3 * (g + 1) + 5 + 5 + 4, g;
}, rQ = (A, g, B, I) => {
  let Q;
  for (O(A, g - 257, 5), O(A, B - 1, 5), O(A, I - 4, 4), Q = 0; Q < I; Q++)
    O(A, A.bl_tree[DI[Q] * 2 + 1], 3);
  ag(A, A.dyn_ltree, g - 1), ag(A, A.dyn_dtree, B - 1);
}, JQ = (A) => {
  let g = 4093624447, B;
  for (B = 0; B <= 31; B++, g >>>= 1)
    if (g & 1 && A.dyn_ltree[B * 2] !== 0)
      return wg;
  if (A.dyn_ltree[9 * 2] !== 0 || A.dyn_ltree[10 * 2] !== 0 || A.dyn_ltree[13 * 2] !== 0)
    return Dg;
  for (B = 32; B < ZA; B++)
    if (A.dyn_ltree[B * 2] !== 0)
      return Dg;
  return wg;
};
let hg = !1;
const nQ = (A) => {
  hg || (MQ(), hg = !0), A.l_desc = new NB(A.dyn_ltree, sI), A.d_desc = new NB(A.dyn_dtree, tI), A.bl_desc = new NB(A.bl_tree, eI), A.bi_buf = 0, A.bi_valid = 0, cI(A);
}, MI = (A, g, B, I) => {
  O(A, (DQ << 1) + (I ? 1 : 0), 3), kI(A), jA(A, B), jA(A, ~B), B && A.pending_buf.set(A.window.subarray(g, g + B), A.pending), A.pending += B;
}, yQ = (A) => {
  O(A, CI << 1, 3), Z(A, Ag, _), cQ(A);
}, FQ = (A, g, B, I) => {
  let Q, C, E = 0;
  A.level > 0 ? (A.strm.data_type === wQ && (A.strm.data_type = JQ(A)), OB(A, A.l_desc), OB(A, A.d_desc), E = NQ(A), Q = A.opt_len + 3 + 7 >>> 3, C = A.static_len + 3 + 7 >>> 3, C <= Q && (Q = C)) : Q = C = B + 5, B + 4 <= Q && g !== -1 ? MI(A, g, B, I) : A.strategy === oQ || C === Q ? (O(A, (CI << 1) + (I ? 1 : 0), 3), tg(A, _, UA)) : (O(A, (sQ << 1) + (I ? 1 : 0), 3), rQ(A, A.l_desc.max_code + 1, A.d_desc.max_code + 1, E + 1), tg(A, A.dyn_ltree, A.dyn_dtree)), cI(A), I && kI(A);
}, HQ = (A, g, B) => (A.pending_buf[A.sym_buf + A.sym_next++] = g, A.pending_buf[A.sym_buf + A.sym_next++] = g >> 8, A.pending_buf[A.sym_buf + A.sym_next++] = B, g === 0 ? A.dyn_ltree[B * 2]++ : (A.matches++, g--, A.dyn_ltree[(bA[B] + ZA + 1) * 2]++, A.dyn_dtree[aI(g) * 2]++), A.sym_next === A.sym_end);
var YQ = nQ, lQ = MI, SQ = FQ, RQ = HQ, KQ = yQ, qQ = {
  _tr_init: YQ,
  _tr_stored_block: lQ,
  _tr_flush_block: SQ,
  _tr_tally: RQ,
  _tr_align: KQ
};
const LQ = (A, g, B, I) => {
  let Q = A & 65535 | 0, C = A >>> 16 & 65535 | 0, E = 0;
  for (; B !== 0; ) {
    E = B > 2e3 ? 2e3 : B, B -= E;
    do
      Q = Q + g[I++] | 0, C = C + Q | 0;
    while (--E);
    Q %= 65521, C %= 65521;
  }
  return Q | C << 16 | 0;
};
var mA = LQ;
const UQ = () => {
  let A, g = [];
  for (var B = 0; B < 256; B++) {
    A = B;
    for (var I = 0; I < 8; I++)
      A = A & 1 ? 3988292384 ^ A >>> 1 : A >>> 1;
    g[B] = A;
  }
  return g;
}, fQ = new Uint32Array(UQ()), dQ = (A, g, B, I) => {
  const Q = fQ, C = I + B;
  A ^= -1;
  for (let E = I; E < C; E++)
    A = A >>> 8 ^ Q[(A ^ g[E]) & 255];
  return A ^ -1;
};
var U = dQ, rA = {
  2: "need dictionary",
  /* Z_NEED_DICT       2  */
  1: "stream end",
  /* Z_STREAM_END      1  */
  0: "",
  /* Z_OK              0  */
  "-1": "file error",
  /* Z_ERRNO         (-1) */
  "-2": "stream error",
  /* Z_STREAM_ERROR  (-2) */
  "-3": "data error",
  /* Z_DATA_ERROR    (-3) */
  "-4": "insufficient memory",
  /* Z_MEM_ERROR     (-4) */
  "-5": "buffer error",
  /* Z_BUF_ERROR     (-5) */
  "-6": "incompatible version"
  /* Z_VERSION_ERROR (-6) */
}, zA = {
  /* Allowed flush values; see deflate() and inflate() below for details */
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_TREES: 6,
  /* Return codes for the compression/decompression functions. Negative values
  * are errors, positive values are used for special but normal events.
  */
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  //Z_VERSION_ERROR: -6,
  /* compression levels */
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  /* Possible values of the data_type field (though see inflate()) */
  Z_BINARY: 0,
  Z_TEXT: 1,
  //Z_ASCII:                1, // = Z_TEXT (deprecated)
  Z_UNKNOWN: 2,
  /* The deflate compression method */
  Z_DEFLATED: 8
  //Z_NULL:                 null // Use -1 or null inline, depending on var type
};
const { _tr_init: pQ, _tr_stored_block: xB, _tr_flush_block: OQ, _tr_tally: IA, _tr_align: xQ } = qQ, {
  Z_NO_FLUSH: QA,
  Z_PARTIAL_FLUSH: bQ,
  Z_FULL_FLUSH: jQ,
  Z_FINISH: m,
  Z_BLOCK: Gg,
  Z_OK: f,
  Z_STREAM_END: cg,
  Z_STREAM_ERROR: z,
  Z_DATA_ERROR: mQ,
  Z_BUF_ERROR: JB,
  Z_DEFAULT_COMPRESSION: TQ,
  Z_FILTERED: uQ,
  Z_HUFFMAN_ONLY: _A,
  Z_RLE: XQ,
  Z_FIXED: ZQ,
  Z_DEFAULT_STRATEGY: zQ,
  Z_UNKNOWN: WQ,
  Z_DEFLATED: eB
} = zA, vQ = 9, PQ = 15, VQ = 8, _Q = 29, $Q = 256, bB = $Q + 1 + _Q, AC = 30, BC = 19, gC = 2 * bB + 1, IC = 15, S = 3, gA = 258, W = gA + S + 1, QC = 32, JA = 42, gg = 57, jB = 69, mB = 73, TB = 91, uB = 103, sA = 113, lA = 666, p = 1, FA = 2, eA = 3, HA = 4, CC = 3, tA = (A, g) => (A.msg = rA[g], g), kg = (A) => A * 2 - (A > 4 ? 9 : 0), BA = (A) => {
  let g = A.length;
  for (; --g >= 0; )
    A[g] = 0;
}, EC = (A) => {
  let g, B, I, Q = A.w_size;
  g = A.hash_size, I = g;
  do
    B = A.head[--I], A.head[I] = B >= Q ? B - Q : 0;
  while (--g);
  g = Q, I = g;
  do
    B = A.prev[--I], A.prev[I] = B >= Q ? B - Q : 0;
  while (--g);
};
let iC = (A, g, B) => (g << A.hash_shift ^ B) & A.hash_mask, CA = iC;
const b = (A) => {
  const g = A.state;
  let B = g.pending;
  B > A.avail_out && (B = A.avail_out), B !== 0 && (A.output.set(g.pending_buf.subarray(g.pending_out, g.pending_out + B), A.next_out), A.next_out += B, g.pending_out += B, A.total_out += B, A.avail_out -= B, g.pending -= B, g.pending === 0 && (g.pending_out = 0));
}, j = (A, g) => {
  OQ(A, A.block_start >= 0 ? A.block_start : -1, A.strstart - A.block_start, g), A.block_start = A.strstart, b(A.strm);
}, K = (A, g) => {
  A.pending_buf[A.pending++] = g;
}, YA = (A, g) => {
  A.pending_buf[A.pending++] = g >>> 8 & 255, A.pending_buf[A.pending++] = g & 255;
}, XB = (A, g, B, I) => {
  let Q = A.avail_in;
  return Q > I && (Q = I), Q === 0 ? 0 : (A.avail_in -= Q, g.set(A.input.subarray(A.next_in, A.next_in + Q), B), A.state.wrap === 1 ? A.adler = mA(A.adler, g, Q, B) : A.state.wrap === 2 && (A.adler = U(A.adler, g, Q, B)), A.next_in += Q, A.total_in += Q, Q);
}, NI = (A, g) => {
  let B = A.max_chain_length, I = A.strstart, Q, C, E = A.prev_length, i = A.nice_match;
  const D = A.strstart > A.w_size - W ? A.strstart - (A.w_size - W) : 0, o = A.window, w = A.w_mask, t = A.prev, e = A.strstart + gA;
  let s = o[I + E - 1], a = o[I + E];
  A.prev_length >= A.good_match && (B >>= 2), i > A.lookahead && (i = A.lookahead);
  do
    if (Q = g, !(o[Q + E] !== a || o[Q + E - 1] !== s || o[Q] !== o[I] || o[++Q] !== o[I + 1])) {
      I += 2, Q++;
      do
        ;
      while (o[++I] === o[++Q] && o[++I] === o[++Q] && o[++I] === o[++Q] && o[++I] === o[++Q] && o[++I] === o[++Q] && o[++I] === o[++Q] && o[++I] === o[++Q] && o[++I] === o[++Q] && I < e);
      if (C = gA - (e - I), I = e - gA, C > E) {
        if (A.match_start = g, E = C, C >= i)
          break;
        s = o[I + E - 1], a = o[I + E];
      }
    }
  while ((g = t[g & w]) > D && --B !== 0);
  return E <= A.lookahead ? E : A.lookahead;
}, nA = (A) => {
  const g = A.w_size;
  let B, I, Q;
  do {
    if (I = A.window_size - A.lookahead - A.strstart, A.strstart >= g + (g - W) && (A.window.set(A.window.subarray(g, g + g - I), 0), A.match_start -= g, A.strstart -= g, A.block_start -= g, A.insert > A.strstart && (A.insert = A.strstart), EC(A), I += g), A.strm.avail_in === 0)
      break;
    if (B = XB(A.strm, A.window, A.strstart + A.lookahead, I), A.lookahead += B, A.lookahead + A.insert >= S)
      for (Q = A.strstart - A.insert, A.ins_h = A.window[Q], A.ins_h = CA(A, A.ins_h, A.window[Q + 1]); A.insert && (A.ins_h = CA(A, A.ins_h, A.window[Q + S - 1]), A.prev[Q & A.w_mask] = A.head[A.ins_h], A.head[A.ins_h] = Q, Q++, A.insert--, !(A.lookahead + A.insert < S)); )
        ;
  } while (A.lookahead < W && A.strm.avail_in !== 0);
}, rI = (A, g) => {
  let B = A.pending_buf_size - 5 > A.w_size ? A.w_size : A.pending_buf_size - 5, I, Q, C, E = 0, i = A.strm.avail_in;
  do {
    if (I = 65535, C = A.bi_valid + 42 >> 3, A.strm.avail_out < C || (C = A.strm.avail_out - C, Q = A.strstart - A.block_start, I > Q + A.strm.avail_in && (I = Q + A.strm.avail_in), I > C && (I = C), I < B && (I === 0 && g !== m || g === QA || I !== Q + A.strm.avail_in)))
      break;
    E = g === m && I === Q + A.strm.avail_in ? 1 : 0, xB(A, 0, 0, E), A.pending_buf[A.pending - 4] = I, A.pending_buf[A.pending - 3] = I >> 8, A.pending_buf[A.pending - 2] = ~I, A.pending_buf[A.pending - 1] = ~I >> 8, b(A.strm), Q && (Q > I && (Q = I), A.strm.output.set(A.window.subarray(A.block_start, A.block_start + Q), A.strm.next_out), A.strm.next_out += Q, A.strm.avail_out -= Q, A.strm.total_out += Q, A.block_start += Q, I -= Q), I && (XB(A.strm, A.strm.output, A.strm.next_out, I), A.strm.next_out += I, A.strm.avail_out -= I, A.strm.total_out += I);
  } while (E === 0);
  return i -= A.strm.avail_in, i && (i >= A.w_size ? (A.matches = 2, A.window.set(A.strm.input.subarray(A.strm.next_in - A.w_size, A.strm.next_in), 0), A.strstart = A.w_size, A.insert = A.strstart) : (A.window_size - A.strstart <= i && (A.strstart -= A.w_size, A.window.set(A.window.subarray(A.w_size, A.w_size + A.strstart), 0), A.matches < 2 && A.matches++, A.insert > A.strstart && (A.insert = A.strstart)), A.window.set(A.strm.input.subarray(A.strm.next_in - i, A.strm.next_in), A.strstart), A.strstart += i, A.insert += i > A.w_size - A.insert ? A.w_size - A.insert : i), A.block_start = A.strstart), A.high_water < A.strstart && (A.high_water = A.strstart), E ? HA : g !== QA && g !== m && A.strm.avail_in === 0 && A.strstart === A.block_start ? FA : (C = A.window_size - A.strstart, A.strm.avail_in > C && A.block_start >= A.w_size && (A.block_start -= A.w_size, A.strstart -= A.w_size, A.window.set(A.window.subarray(A.w_size, A.w_size + A.strstart), 0), A.matches < 2 && A.matches++, C += A.w_size, A.insert > A.strstart && (A.insert = A.strstart)), C > A.strm.avail_in && (C = A.strm.avail_in), C && (XB(A.strm, A.window, A.strstart, C), A.strstart += C, A.insert += C > A.w_size - A.insert ? A.w_size - A.insert : C), A.high_water < A.strstart && (A.high_water = A.strstart), C = A.bi_valid + 42 >> 3, C = A.pending_buf_size - C > 65535 ? 65535 : A.pending_buf_size - C, B = C > A.w_size ? A.w_size : C, Q = A.strstart - A.block_start, (Q >= B || (Q || g === m) && g !== QA && A.strm.avail_in === 0 && Q <= C) && (I = Q > C ? C : Q, E = g === m && A.strm.avail_in === 0 && I === Q ? 1 : 0, xB(A, A.block_start, I, E), A.block_start += I, b(A.strm)), E ? eA : p);
}, nB = (A, g) => {
  let B, I;
  for (; ; ) {
    if (A.lookahead < W) {
      if (nA(A), A.lookahead < W && g === QA)
        return p;
      if (A.lookahead === 0)
        break;
    }
    if (B = 0, A.lookahead >= S && (A.ins_h = CA(A, A.ins_h, A.window[A.strstart + S - 1]), B = A.prev[A.strstart & A.w_mask] = A.head[A.ins_h], A.head[A.ins_h] = A.strstart), B !== 0 && A.strstart - B <= A.w_size - W && (A.match_length = NI(A, B)), A.match_length >= S)
      if (I = IA(A, A.strstart - A.match_start, A.match_length - S), A.lookahead -= A.match_length, A.match_length <= A.max_lazy_match && A.lookahead >= S) {
        A.match_length--;
        do
          A.strstart++, A.ins_h = CA(A, A.ins_h, A.window[A.strstart + S - 1]), B = A.prev[A.strstart & A.w_mask] = A.head[A.ins_h], A.head[A.ins_h] = A.strstart;
        while (--A.match_length !== 0);
        A.strstart++;
      } else
        A.strstart += A.match_length, A.match_length = 0, A.ins_h = A.window[A.strstart], A.ins_h = CA(A, A.ins_h, A.window[A.strstart + 1]);
    else
      I = IA(A, 0, A.window[A.strstart]), A.lookahead--, A.strstart++;
    if (I && (j(A, !1), A.strm.avail_out === 0))
      return p;
  }
  return A.insert = A.strstart < S - 1 ? A.strstart : S - 1, g === m ? (j(A, !0), A.strm.avail_out === 0 ? eA : HA) : A.sym_next && (j(A, !1), A.strm.avail_out === 0) ? p : FA;
}, GA = (A, g) => {
  let B, I, Q;
  for (; ; ) {
    if (A.lookahead < W) {
      if (nA(A), A.lookahead < W && g === QA)
        return p;
      if (A.lookahead === 0)
        break;
    }
    if (B = 0, A.lookahead >= S && (A.ins_h = CA(A, A.ins_h, A.window[A.strstart + S - 1]), B = A.prev[A.strstart & A.w_mask] = A.head[A.ins_h], A.head[A.ins_h] = A.strstart), A.prev_length = A.match_length, A.prev_match = A.match_start, A.match_length = S - 1, B !== 0 && A.prev_length < A.max_lazy_match && A.strstart - B <= A.w_size - W && (A.match_length = NI(A, B), A.match_length <= 5 && (A.strategy === uQ || A.match_length === S && A.strstart - A.match_start > 4096) && (A.match_length = S - 1)), A.prev_length >= S && A.match_length <= A.prev_length) {
      Q = A.strstart + A.lookahead - S, I = IA(A, A.strstart - 1 - A.prev_match, A.prev_length - S), A.lookahead -= A.prev_length - 1, A.prev_length -= 2;
      do
        ++A.strstart <= Q && (A.ins_h = CA(A, A.ins_h, A.window[A.strstart + S - 1]), B = A.prev[A.strstart & A.w_mask] = A.head[A.ins_h], A.head[A.ins_h] = A.strstart);
      while (--A.prev_length !== 0);
      if (A.match_available = 0, A.match_length = S - 1, A.strstart++, I && (j(A, !1), A.strm.avail_out === 0))
        return p;
    } else if (A.match_available) {
      if (I = IA(A, 0, A.window[A.strstart - 1]), I && j(A, !1), A.strstart++, A.lookahead--, A.strm.avail_out === 0)
        return p;
    } else
      A.match_available = 1, A.strstart++, A.lookahead--;
  }
  return A.match_available && (I = IA(A, 0, A.window[A.strstart - 1]), A.match_available = 0), A.insert = A.strstart < S - 1 ? A.strstart : S - 1, g === m ? (j(A, !0), A.strm.avail_out === 0 ? eA : HA) : A.sym_next && (j(A, !1), A.strm.avail_out === 0) ? p : FA;
}, oC = (A, g) => {
  let B, I, Q, C;
  const E = A.window;
  for (; ; ) {
    if (A.lookahead <= gA) {
      if (nA(A), A.lookahead <= gA && g === QA)
        return p;
      if (A.lookahead === 0)
        break;
    }
    if (A.match_length = 0, A.lookahead >= S && A.strstart > 0 && (Q = A.strstart - 1, I = E[Q], I === E[++Q] && I === E[++Q] && I === E[++Q])) {
      C = A.strstart + gA;
      do
        ;
      while (I === E[++Q] && I === E[++Q] && I === E[++Q] && I === E[++Q] && I === E[++Q] && I === E[++Q] && I === E[++Q] && I === E[++Q] && Q < C);
      A.match_length = gA - (C - Q), A.match_length > A.lookahead && (A.match_length = A.lookahead);
    }
    if (A.match_length >= S ? (B = IA(A, 1, A.match_length - S), A.lookahead -= A.match_length, A.strstart += A.match_length, A.match_length = 0) : (B = IA(A, 0, A.window[A.strstart]), A.lookahead--, A.strstart++), B && (j(A, !1), A.strm.avail_out === 0))
      return p;
  }
  return A.insert = 0, g === m ? (j(A, !0), A.strm.avail_out === 0 ? eA : HA) : A.sym_next && (j(A, !1), A.strm.avail_out === 0) ? p : FA;
}, wC = (A, g) => {
  let B;
  for (; ; ) {
    if (A.lookahead === 0 && (nA(A), A.lookahead === 0)) {
      if (g === QA)
        return p;
      break;
    }
    if (A.match_length = 0, B = IA(A, 0, A.window[A.strstart]), A.lookahead--, A.strstart++, B && (j(A, !1), A.strm.avail_out === 0))
      return p;
  }
  return A.insert = 0, g === m ? (j(A, !0), A.strm.avail_out === 0 ? eA : HA) : A.sym_next && (j(A, !1), A.strm.avail_out === 0) ? p : FA;
};
function X(A, g, B, I, Q) {
  this.good_length = A, this.max_lazy = g, this.nice_length = B, this.max_chain = I, this.func = Q;
}
const SA = [
  /*      good lazy nice chain */
  new X(0, 0, 0, 0, rI),
  /* 0 store only */
  new X(4, 4, 8, 4, nB),
  /* 1 max speed, no lazy matches */
  new X(4, 5, 16, 8, nB),
  /* 2 */
  new X(4, 6, 32, 32, nB),
  /* 3 */
  new X(4, 4, 16, 16, GA),
  /* 4 lazy matches */
  new X(8, 16, 32, 32, GA),
  /* 5 */
  new X(8, 16, 128, 128, GA),
  /* 6 */
  new X(8, 32, 128, 256, GA),
  /* 7 */
  new X(32, 128, 258, 1024, GA),
  /* 8 */
  new X(32, 258, 258, 4096, GA)
  /* 9 max compression */
], DC = (A) => {
  A.window_size = 2 * A.w_size, BA(A.head), A.max_lazy_match = SA[A.level].max_lazy, A.good_match = SA[A.level].good_length, A.nice_match = SA[A.level].nice_length, A.max_chain_length = SA[A.level].max_chain, A.strstart = 0, A.block_start = 0, A.lookahead = 0, A.insert = 0, A.match_length = A.prev_length = S - 1, A.match_available = 0, A.ins_h = 0;
};
function sC() {
  this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = eB, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new Uint16Array(gC * 2), this.dyn_dtree = new Uint16Array((2 * AC + 1) * 2), this.bl_tree = new Uint16Array((2 * BC + 1) * 2), BA(this.dyn_ltree), BA(this.dyn_dtree), BA(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new Uint16Array(IC + 1), this.heap = new Uint16Array(2 * bB + 1), BA(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new Uint16Array(2 * bB + 1), BA(this.depth), this.sym_buf = 0, this.lit_bufsize = 0, this.sym_next = 0, this.sym_end = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
}
const WA = (A) => {
  if (!A)
    return 1;
  const g = A.state;
  return !g || g.strm !== A || g.status !== JA && //#ifdef GZIP
  g.status !== gg && //#endif
  g.status !== jB && g.status !== mB && g.status !== TB && g.status !== uB && g.status !== sA && g.status !== lA ? 1 : 0;
}, JI = (A) => {
  if (WA(A))
    return tA(A, z);
  A.total_in = A.total_out = 0, A.data_type = WQ;
  const g = A.state;
  return g.pending = 0, g.pending_out = 0, g.wrap < 0 && (g.wrap = -g.wrap), g.status = //#ifdef GZIP
  g.wrap === 2 ? gg : (
    //#endif
    g.wrap ? JA : sA
  ), A.adler = g.wrap === 2 ? 0 : 1, g.last_flush = -2, pQ(g), f;
}, nI = (A) => {
  const g = JI(A);
  return g === f && DC(A.state), g;
}, tC = (A, g) => WA(A) || A.state.wrap !== 2 ? z : (A.state.gzhead = g, f), yI = (A, g, B, I, Q, C) => {
  if (!A)
    return z;
  let E = 1;
  if (g === TQ && (g = 6), I < 0 ? (E = 0, I = -I) : I > 15 && (E = 2, I -= 16), Q < 1 || Q > vQ || B !== eB || I < 8 || I > 15 || g < 0 || g > 9 || C < 0 || C > ZQ || I === 8 && E !== 1)
    return tA(A, z);
  I === 8 && (I = 9);
  const i = new sC();
  return A.state = i, i.strm = A, i.status = JA, i.wrap = E, i.gzhead = null, i.w_bits = I, i.w_size = 1 << i.w_bits, i.w_mask = i.w_size - 1, i.hash_bits = Q + 7, i.hash_size = 1 << i.hash_bits, i.hash_mask = i.hash_size - 1, i.hash_shift = ~~((i.hash_bits + S - 1) / S), i.window = new Uint8Array(i.w_size * 2), i.head = new Uint16Array(i.hash_size), i.prev = new Uint16Array(i.w_size), i.lit_bufsize = 1 << Q + 6, i.pending_buf_size = i.lit_bufsize * 4, i.pending_buf = new Uint8Array(i.pending_buf_size), i.sym_buf = i.lit_bufsize, i.sym_end = (i.lit_bufsize - 1) * 3, i.level = g, i.strategy = C, i.method = B, nI(A);
}, eC = (A, g) => yI(A, g, eB, PQ, VQ, zQ), aC = (A, g) => {
  if (WA(A) || g > Gg || g < 0)
    return A ? tA(A, z) : z;
  const B = A.state;
  if (!A.output || A.avail_in !== 0 && !A.input || B.status === lA && g !== m)
    return tA(A, A.avail_out === 0 ? JB : z);
  const I = B.last_flush;
  if (B.last_flush = g, B.pending !== 0) {
    if (b(A), A.avail_out === 0)
      return B.last_flush = -1, f;
  } else if (A.avail_in === 0 && kg(g) <= kg(I) && g !== m)
    return tA(A, JB);
  if (B.status === lA && A.avail_in !== 0)
    return tA(A, JB);
  if (B.status === JA && B.wrap === 0 && (B.status = sA), B.status === JA) {
    let Q = eB + (B.w_bits - 8 << 4) << 8, C = -1;
    if (B.strategy >= _A || B.level < 2 ? C = 0 : B.level < 6 ? C = 1 : B.level === 6 ? C = 2 : C = 3, Q |= C << 6, B.strstart !== 0 && (Q |= QC), Q += 31 - Q % 31, YA(B, Q), B.strstart !== 0 && (YA(B, A.adler >>> 16), YA(B, A.adler & 65535)), A.adler = 1, B.status = sA, b(A), B.pending !== 0)
      return B.last_flush = -1, f;
  }
  if (B.status === gg) {
    if (A.adler = 0, K(B, 31), K(B, 139), K(B, 8), B.gzhead)
      K(
        B,
        (B.gzhead.text ? 1 : 0) + (B.gzhead.hcrc ? 2 : 0) + (B.gzhead.extra ? 4 : 0) + (B.gzhead.name ? 8 : 0) + (B.gzhead.comment ? 16 : 0)
      ), K(B, B.gzhead.time & 255), K(B, B.gzhead.time >> 8 & 255), K(B, B.gzhead.time >> 16 & 255), K(B, B.gzhead.time >> 24 & 255), K(B, B.level === 9 ? 2 : B.strategy >= _A || B.level < 2 ? 4 : 0), K(B, B.gzhead.os & 255), B.gzhead.extra && B.gzhead.extra.length && (K(B, B.gzhead.extra.length & 255), K(B, B.gzhead.extra.length >> 8 & 255)), B.gzhead.hcrc && (A.adler = U(A.adler, B.pending_buf, B.pending, 0)), B.gzindex = 0, B.status = jB;
    else if (K(B, 0), K(B, 0), K(B, 0), K(B, 0), K(B, 0), K(B, B.level === 9 ? 2 : B.strategy >= _A || B.level < 2 ? 4 : 0), K(B, CC), B.status = sA, b(A), B.pending !== 0)
      return B.last_flush = -1, f;
  }
  if (B.status === jB) {
    if (B.gzhead.extra) {
      let Q = B.pending, C = (B.gzhead.extra.length & 65535) - B.gzindex;
      for (; B.pending + C > B.pending_buf_size; ) {
        let i = B.pending_buf_size - B.pending;
        if (B.pending_buf.set(B.gzhead.extra.subarray(B.gzindex, B.gzindex + i), B.pending), B.pending = B.pending_buf_size, B.gzhead.hcrc && B.pending > Q && (A.adler = U(A.adler, B.pending_buf, B.pending - Q, Q)), B.gzindex += i, b(A), B.pending !== 0)
          return B.last_flush = -1, f;
        Q = 0, C -= i;
      }
      let E = new Uint8Array(B.gzhead.extra);
      B.pending_buf.set(E.subarray(B.gzindex, B.gzindex + C), B.pending), B.pending += C, B.gzhead.hcrc && B.pending > Q && (A.adler = U(A.adler, B.pending_buf, B.pending - Q, Q)), B.gzindex = 0;
    }
    B.status = mB;
  }
  if (B.status === mB) {
    if (B.gzhead.name) {
      let Q = B.pending, C;
      do {
        if (B.pending === B.pending_buf_size) {
          if (B.gzhead.hcrc && B.pending > Q && (A.adler = U(A.adler, B.pending_buf, B.pending - Q, Q)), b(A), B.pending !== 0)
            return B.last_flush = -1, f;
          Q = 0;
        }
        B.gzindex < B.gzhead.name.length ? C = B.gzhead.name.charCodeAt(B.gzindex++) & 255 : C = 0, K(B, C);
      } while (C !== 0);
      B.gzhead.hcrc && B.pending > Q && (A.adler = U(A.adler, B.pending_buf, B.pending - Q, Q)), B.gzindex = 0;
    }
    B.status = TB;
  }
  if (B.status === TB) {
    if (B.gzhead.comment) {
      let Q = B.pending, C;
      do {
        if (B.pending === B.pending_buf_size) {
          if (B.gzhead.hcrc && B.pending > Q && (A.adler = U(A.adler, B.pending_buf, B.pending - Q, Q)), b(A), B.pending !== 0)
            return B.last_flush = -1, f;
          Q = 0;
        }
        B.gzindex < B.gzhead.comment.length ? C = B.gzhead.comment.charCodeAt(B.gzindex++) & 255 : C = 0, K(B, C);
      } while (C !== 0);
      B.gzhead.hcrc && B.pending > Q && (A.adler = U(A.adler, B.pending_buf, B.pending - Q, Q));
    }
    B.status = uB;
  }
  if (B.status === uB) {
    if (B.gzhead.hcrc) {
      if (B.pending + 2 > B.pending_buf_size && (b(A), B.pending !== 0))
        return B.last_flush = -1, f;
      K(B, A.adler & 255), K(B, A.adler >> 8 & 255), A.adler = 0;
    }
    if (B.status = sA, b(A), B.pending !== 0)
      return B.last_flush = -1, f;
  }
  if (A.avail_in !== 0 || B.lookahead !== 0 || g !== QA && B.status !== lA) {
    let Q = B.level === 0 ? rI(B, g) : B.strategy === _A ? wC(B, g) : B.strategy === XQ ? oC(B, g) : SA[B.level].func(B, g);
    if ((Q === eA || Q === HA) && (B.status = lA), Q === p || Q === eA)
      return A.avail_out === 0 && (B.last_flush = -1), f;
    if (Q === FA && (g === bQ ? xQ(B) : g !== Gg && (xB(B, 0, 0, !1), g === jQ && (BA(B.head), B.lookahead === 0 && (B.strstart = 0, B.block_start = 0, B.insert = 0))), b(A), A.avail_out === 0))
      return B.last_flush = -1, f;
  }
  return g !== m ? f : B.wrap <= 0 ? cg : (B.wrap === 2 ? (K(B, A.adler & 255), K(B, A.adler >> 8 & 255), K(B, A.adler >> 16 & 255), K(B, A.adler >> 24 & 255), K(B, A.total_in & 255), K(B, A.total_in >> 8 & 255), K(B, A.total_in >> 16 & 255), K(B, A.total_in >> 24 & 255)) : (YA(B, A.adler >>> 16), YA(B, A.adler & 65535)), b(A), B.wrap > 0 && (B.wrap = -B.wrap), B.pending !== 0 ? f : cg);
}, hC = (A) => {
  if (WA(A))
    return z;
  const g = A.state.status;
  return A.state = null, g === sA ? tA(A, mQ) : f;
}, GC = (A, g) => {
  let B = g.length;
  if (WA(A))
    return z;
  const I = A.state, Q = I.wrap;
  if (Q === 2 || Q === 1 && I.status !== JA || I.lookahead)
    return z;
  if (Q === 1 && (A.adler = mA(A.adler, g, B, 0)), I.wrap = 0, B >= I.w_size) {
    Q === 0 && (BA(I.head), I.strstart = 0, I.block_start = 0, I.insert = 0);
    let D = new Uint8Array(I.w_size);
    D.set(g.subarray(B - I.w_size, B), 0), g = D, B = I.w_size;
  }
  const C = A.avail_in, E = A.next_in, i = A.input;
  for (A.avail_in = B, A.next_in = 0, A.input = g, nA(I); I.lookahead >= S; ) {
    let D = I.strstart, o = I.lookahead - (S - 1);
    do
      I.ins_h = CA(I, I.ins_h, I.window[D + S - 1]), I.prev[D & I.w_mask] = I.head[I.ins_h], I.head[I.ins_h] = D, D++;
    while (--o);
    I.strstart = D, I.lookahead = S - 1, nA(I);
  }
  return I.strstart += I.lookahead, I.block_start = I.strstart, I.insert = I.lookahead, I.lookahead = 0, I.match_length = I.prev_length = S - 1, I.match_available = 0, A.next_in = E, A.input = i, A.avail_in = C, I.wrap = Q, f;
};
var cC = eC, kC = yI, MC = nI, NC = JI, rC = tC, JC = aC, nC = hC, yC = GC, FC = "pako deflate (from Nodeca project)", fA = {
  deflateInit: cC,
  deflateInit2: kC,
  deflateReset: MC,
  deflateResetKeep: NC,
  deflateSetHeader: rC,
  deflate: JC,
  deflateEnd: nC,
  deflateSetDictionary: yC,
  deflateInfo: FC
};
const HC = (A, g) => Object.prototype.hasOwnProperty.call(A, g);
var YC = function(A) {
  const g = Array.prototype.slice.call(arguments, 1);
  for (; g.length; ) {
    const B = g.shift();
    if (B) {
      if (typeof B != "object")
        throw new TypeError(B + "must be non-object");
      for (const I in B)
        HC(B, I) && (A[I] = B[I]);
    }
  }
  return A;
}, lC = (A) => {
  let g = 0;
  for (let I = 0, Q = A.length; I < Q; I++)
    g += A[I].length;
  const B = new Uint8Array(g);
  for (let I = 0, Q = 0, C = A.length; I < C; I++) {
    let E = A[I];
    B.set(E, Q), Q += E.length;
  }
  return B;
}, aB = {
  assign: YC,
  flattenChunks: lC
};
let FI = !0;
try {
  String.fromCharCode.apply(null, new Uint8Array(1));
} catch {
  FI = !1;
}
const TA = new Uint8Array(256);
for (let A = 0; A < 256; A++)
  TA[A] = A >= 252 ? 6 : A >= 248 ? 5 : A >= 240 ? 4 : A >= 224 ? 3 : A >= 192 ? 2 : 1;
TA[254] = TA[254] = 1;
var SC = (A) => {
  if (typeof TextEncoder == "function" && TextEncoder.prototype.encode)
    return new TextEncoder().encode(A);
  let g, B, I, Q, C, E = A.length, i = 0;
  for (Q = 0; Q < E; Q++)
    B = A.charCodeAt(Q), (B & 64512) === 55296 && Q + 1 < E && (I = A.charCodeAt(Q + 1), (I & 64512) === 56320 && (B = 65536 + (B - 55296 << 10) + (I - 56320), Q++)), i += B < 128 ? 1 : B < 2048 ? 2 : B < 65536 ? 3 : 4;
  for (g = new Uint8Array(i), C = 0, Q = 0; C < i; Q++)
    B = A.charCodeAt(Q), (B & 64512) === 55296 && Q + 1 < E && (I = A.charCodeAt(Q + 1), (I & 64512) === 56320 && (B = 65536 + (B - 55296 << 10) + (I - 56320), Q++)), B < 128 ? g[C++] = B : B < 2048 ? (g[C++] = 192 | B >>> 6, g[C++] = 128 | B & 63) : B < 65536 ? (g[C++] = 224 | B >>> 12, g[C++] = 128 | B >>> 6 & 63, g[C++] = 128 | B & 63) : (g[C++] = 240 | B >>> 18, g[C++] = 128 | B >>> 12 & 63, g[C++] = 128 | B >>> 6 & 63, g[C++] = 128 | B & 63);
  return g;
};
const RC = (A, g) => {
  if (g < 65534 && A.subarray && FI)
    return String.fromCharCode.apply(null, A.length === g ? A : A.subarray(0, g));
  let B = "";
  for (let I = 0; I < g; I++)
    B += String.fromCharCode(A[I]);
  return B;
};
var KC = (A, g) => {
  const B = g || A.length;
  if (typeof TextDecoder == "function" && TextDecoder.prototype.decode)
    return new TextDecoder().decode(A.subarray(0, g));
  let I, Q;
  const C = new Array(B * 2);
  for (Q = 0, I = 0; I < B; ) {
    let E = A[I++];
    if (E < 128) {
      C[Q++] = E;
      continue;
    }
    let i = TA[E];
    if (i > 4) {
      C[Q++] = 65533, I += i - 1;
      continue;
    }
    for (E &= i === 2 ? 31 : i === 3 ? 15 : 7; i > 1 && I < B; )
      E = E << 6 | A[I++] & 63, i--;
    if (i > 1) {
      C[Q++] = 65533;
      continue;
    }
    E < 65536 ? C[Q++] = E : (E -= 65536, C[Q++] = 55296 | E >> 10 & 1023, C[Q++] = 56320 | E & 1023);
  }
  return RC(C, Q);
}, qC = (A, g) => {
  g = g || A.length, g > A.length && (g = A.length);
  let B = g - 1;
  for (; B >= 0 && (A[B] & 192) === 128; )
    B--;
  return B < 0 || B === 0 ? g : B + TA[A[B]] > g ? B : g;
}, uA = {
  string2buf: SC,
  buf2string: KC,
  utf8border: qC
};
function LC() {
  this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
}
var HI = LC;
const YI = Object.prototype.toString, {
  Z_NO_FLUSH: UC,
  Z_SYNC_FLUSH: fC,
  Z_FULL_FLUSH: dC,
  Z_FINISH: pC,
  Z_OK: DB,
  Z_STREAM_END: OC,
  Z_DEFAULT_COMPRESSION: xC,
  Z_DEFAULT_STRATEGY: bC,
  Z_DEFLATED: jC
} = zA;
function Ig(A) {
  this.options = aB.assign({
    level: xC,
    method: jC,
    chunkSize: 16384,
    windowBits: 15,
    memLevel: 8,
    strategy: bC
  }, A || {});
  let g = this.options;
  g.raw && g.windowBits > 0 ? g.windowBits = -g.windowBits : g.gzip && g.windowBits > 0 && g.windowBits < 16 && (g.windowBits += 16), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new HI(), this.strm.avail_out = 0;
  let B = fA.deflateInit2(
    this.strm,
    g.level,
    g.method,
    g.windowBits,
    g.memLevel,
    g.strategy
  );
  if (B !== DB)
    throw new Error(rA[B]);
  if (g.header && fA.deflateSetHeader(this.strm, g.header), g.dictionary) {
    let I;
    if (typeof g.dictionary == "string" ? I = uA.string2buf(g.dictionary) : YI.call(g.dictionary) === "[object ArrayBuffer]" ? I = new Uint8Array(g.dictionary) : I = g.dictionary, B = fA.deflateSetDictionary(this.strm, I), B !== DB)
      throw new Error(rA[B]);
    this._dict_set = !0;
  }
}
Ig.prototype.push = function(A, g) {
  const B = this.strm, I = this.options.chunkSize;
  let Q, C;
  if (this.ended)
    return !1;
  for (g === ~~g ? C = g : C = g === !0 ? pC : UC, typeof A == "string" ? B.input = uA.string2buf(A) : YI.call(A) === "[object ArrayBuffer]" ? B.input = new Uint8Array(A) : B.input = A, B.next_in = 0, B.avail_in = B.input.length; ; ) {
    if (B.avail_out === 0 && (B.output = new Uint8Array(I), B.next_out = 0, B.avail_out = I), (C === fC || C === dC) && B.avail_out <= 6) {
      this.onData(B.output.subarray(0, B.next_out)), B.avail_out = 0;
      continue;
    }
    if (Q = fA.deflate(B, C), Q === OC)
      return B.next_out > 0 && this.onData(B.output.subarray(0, B.next_out)), Q = fA.deflateEnd(this.strm), this.onEnd(Q), this.ended = !0, Q === DB;
    if (B.avail_out === 0) {
      this.onData(B.output);
      continue;
    }
    if (C > 0 && B.next_out > 0) {
      this.onData(B.output.subarray(0, B.next_out)), B.avail_out = 0;
      continue;
    }
    if (B.avail_in === 0)
      break;
  }
  return !0;
};
Ig.prototype.onData = function(A) {
  this.chunks.push(A);
};
Ig.prototype.onEnd = function(A) {
  A === DB && (this.result = aB.flattenChunks(this.chunks)), this.chunks = [], this.err = A, this.msg = this.strm.msg;
};
const $A = 16209, mC = 16191;
var TC = function(g, B) {
  let I, Q, C, E, i, D, o, w, t, e, s, a, k, M, N, n, c, G, J, R, r, F, H, y;
  const Y = g.state;
  I = g.next_in, H = g.input, Q = I + (g.avail_in - 5), C = g.next_out, y = g.output, E = C - (B - g.avail_out), i = C + (g.avail_out - 257), D = Y.dmax, o = Y.wsize, w = Y.whave, t = Y.wnext, e = Y.window, s = Y.hold, a = Y.bits, k = Y.lencode, M = Y.distcode, N = (1 << Y.lenbits) - 1, n = (1 << Y.distbits) - 1;
  A:
    do {
      a < 15 && (s += H[I++] << a, a += 8, s += H[I++] << a, a += 8), c = k[s & N];
      B:
        for (; ; ) {
          if (G = c >>> 24, s >>>= G, a -= G, G = c >>> 16 & 255, G === 0)
            y[C++] = c & 65535;
          else if (G & 16) {
            J = c & 65535, G &= 15, G && (a < G && (s += H[I++] << a, a += 8), J += s & (1 << G) - 1, s >>>= G, a -= G), a < 15 && (s += H[I++] << a, a += 8, s += H[I++] << a, a += 8), c = M[s & n];
            g:
              for (; ; ) {
                if (G = c >>> 24, s >>>= G, a -= G, G = c >>> 16 & 255, G & 16) {
                  if (R = c & 65535, G &= 15, a < G && (s += H[I++] << a, a += 8, a < G && (s += H[I++] << a, a += 8)), R += s & (1 << G) - 1, R > D) {
                    g.msg = "invalid distance too far back", Y.mode = $A;
                    break A;
                  }
                  if (s >>>= G, a -= G, G = C - E, R > G) {
                    if (G = R - G, G > w && Y.sane) {
                      g.msg = "invalid distance too far back", Y.mode = $A;
                      break A;
                    }
                    if (r = 0, F = e, t === 0) {
                      if (r += o - G, G < J) {
                        J -= G;
                        do
                          y[C++] = e[r++];
                        while (--G);
                        r = C - R, F = y;
                      }
                    } else if (t < G) {
                      if (r += o + t - G, G -= t, G < J) {
                        J -= G;
                        do
                          y[C++] = e[r++];
                        while (--G);
                        if (r = 0, t < J) {
                          G = t, J -= G;
                          do
                            y[C++] = e[r++];
                          while (--G);
                          r = C - R, F = y;
                        }
                      }
                    } else if (r += t - G, G < J) {
                      J -= G;
                      do
                        y[C++] = e[r++];
                      while (--G);
                      r = C - R, F = y;
                    }
                    for (; J > 2; )
                      y[C++] = F[r++], y[C++] = F[r++], y[C++] = F[r++], J -= 3;
                    J && (y[C++] = F[r++], J > 1 && (y[C++] = F[r++]));
                  } else {
                    r = C - R;
                    do
                      y[C++] = y[r++], y[C++] = y[r++], y[C++] = y[r++], J -= 3;
                    while (J > 2);
                    J && (y[C++] = y[r++], J > 1 && (y[C++] = y[r++]));
                  }
                } else if (G & 64) {
                  g.msg = "invalid distance code", Y.mode = $A;
                  break A;
                } else {
                  c = M[(c & 65535) + (s & (1 << G) - 1)];
                  continue g;
                }
                break;
              }
          } else if (G & 64)
            if (G & 32) {
              Y.mode = mC;
              break A;
            } else {
              g.msg = "invalid literal/length code", Y.mode = $A;
              break A;
            }
          else {
            c = k[(c & 65535) + (s & (1 << G) - 1)];
            continue B;
          }
          break;
        }
    } while (I < Q && C < i);
  J = a >> 3, I -= J, a -= J << 3, s &= (1 << a) - 1, g.next_in = I, g.next_out = C, g.avail_in = I < Q ? 5 + (Q - I) : 5 - (I - Q), g.avail_out = C < i ? 257 + (i - C) : 257 - (C - i), Y.hold = s, Y.bits = a;
};
const cA = 15, Mg = 852, Ng = 592, rg = 0, yB = 1, Jg = 2, uC = new Uint16Array([
  /* Length codes 257..285 base */
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  13,
  15,
  17,
  19,
  23,
  27,
  31,
  35,
  43,
  51,
  59,
  67,
  83,
  99,
  115,
  131,
  163,
  195,
  227,
  258,
  0,
  0
]), XC = new Uint8Array([
  /* Length codes 257..285 extra */
  16,
  16,
  16,
  16,
  16,
  16,
  16,
  16,
  17,
  17,
  17,
  17,
  18,
  18,
  18,
  18,
  19,
  19,
  19,
  19,
  20,
  20,
  20,
  20,
  21,
  21,
  21,
  21,
  16,
  72,
  78
]), ZC = new Uint16Array([
  /* Distance codes 0..29 base */
  1,
  2,
  3,
  4,
  5,
  7,
  9,
  13,
  17,
  25,
  33,
  49,
  65,
  97,
  129,
  193,
  257,
  385,
  513,
  769,
  1025,
  1537,
  2049,
  3073,
  4097,
  6145,
  8193,
  12289,
  16385,
  24577,
  0,
  0
]), zC = new Uint8Array([
  /* Distance codes 0..29 extra */
  16,
  16,
  16,
  16,
  17,
  17,
  18,
  18,
  19,
  19,
  20,
  20,
  21,
  21,
  22,
  22,
  23,
  23,
  24,
  24,
  25,
  25,
  26,
  26,
  27,
  27,
  28,
  28,
  29,
  29,
  64,
  64
]), WC = (A, g, B, I, Q, C, E, i) => {
  const D = i.bits;
  let o = 0, w = 0, t = 0, e = 0, s = 0, a = 0, k = 0, M = 0, N = 0, n = 0, c, G, J, R, r, F = null, H;
  const y = new Uint16Array(cA + 1), Y = new Uint16Array(cA + 1);
  let EA = null, ig, PA, VA;
  for (o = 0; o <= cA; o++)
    y[o] = 0;
  for (w = 0; w < I; w++)
    y[g[B + w]]++;
  for (s = D, e = cA; e >= 1 && y[e] === 0; e--)
    ;
  if (s > e && (s = e), e === 0)
    return Q[C++] = 1 << 24 | 64 << 16 | 0, Q[C++] = 1 << 24 | 64 << 16 | 0, i.bits = 1, 0;
  for (t = 1; t < e && y[t] === 0; t++)
    ;
  for (s < t && (s = t), M = 1, o = 1; o <= cA; o++)
    if (M <<= 1, M -= y[o], M < 0)
      return -1;
  if (M > 0 && (A === rg || e !== 1))
    return -1;
  for (Y[1] = 0, o = 1; o < cA; o++)
    Y[o + 1] = Y[o] + y[o];
  for (w = 0; w < I; w++)
    g[B + w] !== 0 && (E[Y[g[B + w]]++] = w);
  if (A === rg ? (F = EA = E, H = 20) : A === yB ? (F = uC, EA = XC, H = 257) : (F = ZC, EA = zC, H = 0), n = 0, w = 0, o = t, r = C, a = s, k = 0, J = -1, N = 1 << s, R = N - 1, A === yB && N > Mg || A === Jg && N > Ng)
    return 1;
  for (; ; ) {
    ig = o - k, E[w] + 1 < H ? (PA = 0, VA = E[w]) : E[w] >= H ? (PA = EA[E[w] - H], VA = F[E[w] - H]) : (PA = 32 + 64, VA = 0), c = 1 << o - k, G = 1 << a, t = G;
    do
      G -= c, Q[r + (n >> k) + G] = ig << 24 | PA << 16 | VA | 0;
    while (G !== 0);
    for (c = 1 << o - 1; n & c; )
      c >>= 1;
    if (c !== 0 ? (n &= c - 1, n += c) : n = 0, w++, --y[o] === 0) {
      if (o === e)
        break;
      o = g[B + E[w]];
    }
    if (o > s && (n & R) !== J) {
      for (k === 0 && (k = s), r += t, a = o - k, M = 1 << a; a + k < e && (M -= y[a + k], !(M <= 0)); )
        a++, M <<= 1;
      if (N += 1 << a, A === yB && N > Mg || A === Jg && N > Ng)
        return 1;
      J = n & R, Q[J] = s << 24 | a << 16 | r - C | 0;
    }
  }
  return n !== 0 && (Q[r + n] = o - k << 24 | 64 << 16 | 0), i.bits = s, 0;
};
var dA = WC;
const vC = 0, lI = 1, SI = 2, {
  Z_FINISH: ng,
  Z_BLOCK: PC,
  Z_TREES: AB,
  Z_OK: aA,
  Z_STREAM_END: VC,
  Z_NEED_DICT: _C,
  Z_STREAM_ERROR: T,
  Z_DATA_ERROR: RI,
  Z_MEM_ERROR: KI,
  Z_BUF_ERROR: $C,
  Z_DEFLATED: yg
} = zA, hB = 16180, Fg = 16181, Hg = 16182, Yg = 16183, lg = 16184, Sg = 16185, Rg = 16186, Kg = 16187, qg = 16188, Lg = 16189, sB = 16190, v = 16191, FB = 16192, Ug = 16193, HB = 16194, fg = 16195, dg = 16196, pg = 16197, Og = 16198, BB = 16199, gB = 16200, xg = 16201, bg = 16202, jg = 16203, mg = 16204, Tg = 16205, YB = 16206, ug = 16207, Xg = 16208, L = 16209, qI = 16210, LI = 16211, AE = 852, BE = 592, gE = 15, IE = gE, Zg = (A) => (A >>> 24 & 255) + (A >>> 8 & 65280) + ((A & 65280) << 8) + ((A & 255) << 24);
function QE() {
  this.strm = null, this.mode = 0, this.last = !1, this.wrap = 0, this.havedict = !1, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new Uint16Array(320), this.work = new Uint16Array(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
}
const hA = (A) => {
  if (!A)
    return 1;
  const g = A.state;
  return !g || g.strm !== A || g.mode < hB || g.mode > LI ? 1 : 0;
}, UI = (A) => {
  if (hA(A))
    return T;
  const g = A.state;
  return A.total_in = A.total_out = g.total = 0, A.msg = "", g.wrap && (A.adler = g.wrap & 1), g.mode = hB, g.last = 0, g.havedict = 0, g.flags = -1, g.dmax = 32768, g.head = null, g.hold = 0, g.bits = 0, g.lencode = g.lendyn = new Int32Array(AE), g.distcode = g.distdyn = new Int32Array(BE), g.sane = 1, g.back = -1, aA;
}, fI = (A) => {
  if (hA(A))
    return T;
  const g = A.state;
  return g.wsize = 0, g.whave = 0, g.wnext = 0, UI(A);
}, dI = (A, g) => {
  let B;
  if (hA(A))
    return T;
  const I = A.state;
  return g < 0 ? (B = 0, g = -g) : (B = (g >> 4) + 5, g < 48 && (g &= 15)), g && (g < 8 || g > 15) ? T : (I.window !== null && I.wbits !== g && (I.window = null), I.wrap = B, I.wbits = g, fI(A));
}, pI = (A, g) => {
  if (!A)
    return T;
  const B = new QE();
  A.state = B, B.strm = A, B.window = null, B.mode = hB;
  const I = dI(A, g);
  return I !== aA && (A.state = null), I;
}, CE = (A) => pI(A, IE);
let zg = !0, lB, SB;
const EE = (A) => {
  if (zg) {
    lB = new Int32Array(512), SB = new Int32Array(32);
    let g = 0;
    for (; g < 144; )
      A.lens[g++] = 8;
    for (; g < 256; )
      A.lens[g++] = 9;
    for (; g < 280; )
      A.lens[g++] = 7;
    for (; g < 288; )
      A.lens[g++] = 8;
    for (dA(lI, A.lens, 0, 288, lB, 0, A.work, { bits: 9 }), g = 0; g < 32; )
      A.lens[g++] = 5;
    dA(SI, A.lens, 0, 32, SB, 0, A.work, { bits: 5 }), zg = !1;
  }
  A.lencode = lB, A.lenbits = 9, A.distcode = SB, A.distbits = 5;
}, OI = (A, g, B, I) => {
  let Q;
  const C = A.state;
  return C.window === null && (C.wsize = 1 << C.wbits, C.wnext = 0, C.whave = 0, C.window = new Uint8Array(C.wsize)), I >= C.wsize ? (C.window.set(g.subarray(B - C.wsize, B), 0), C.wnext = 0, C.whave = C.wsize) : (Q = C.wsize - C.wnext, Q > I && (Q = I), C.window.set(g.subarray(B - I, B - I + Q), C.wnext), I -= Q, I ? (C.window.set(g.subarray(B - I, B), 0), C.wnext = I, C.whave = C.wsize) : (C.wnext += Q, C.wnext === C.wsize && (C.wnext = 0), C.whave < C.wsize && (C.whave += Q))), 0;
}, iE = (A, g) => {
  let B, I, Q, C, E, i, D, o, w, t, e, s, a, k, M = 0, N, n, c, G, J, R, r, F;
  const H = new Uint8Array(4);
  let y, Y;
  const EA = (
    /* permutation of code lengths */
    new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15])
  );
  if (hA(A) || !A.output || !A.input && A.avail_in !== 0)
    return T;
  B = A.state, B.mode === v && (B.mode = FB), E = A.next_out, Q = A.output, D = A.avail_out, C = A.next_in, I = A.input, i = A.avail_in, o = B.hold, w = B.bits, t = i, e = D, F = aA;
  A:
    for (; ; )
      switch (B.mode) {
        case hB:
          if (B.wrap === 0) {
            B.mode = FB;
            break;
          }
          for (; w < 16; ) {
            if (i === 0)
              break A;
            i--, o += I[C++] << w, w += 8;
          }
          if (B.wrap & 2 && o === 35615) {
            B.wbits === 0 && (B.wbits = 15), B.check = 0, H[0] = o & 255, H[1] = o >>> 8 & 255, B.check = U(B.check, H, 2, 0), o = 0, w = 0, B.mode = Fg;
            break;
          }
          if (B.head && (B.head.done = !1), !(B.wrap & 1) || /* check if zlib header allowed */
          (((o & 255) << 8) + (o >> 8)) % 31) {
            A.msg = "incorrect header check", B.mode = L;
            break;
          }
          if ((o & 15) !== yg) {
            A.msg = "unknown compression method", B.mode = L;
            break;
          }
          if (o >>>= 4, w -= 4, r = (o & 15) + 8, B.wbits === 0 && (B.wbits = r), r > 15 || r > B.wbits) {
            A.msg = "invalid window size", B.mode = L;
            break;
          }
          B.dmax = 1 << B.wbits, B.flags = 0, A.adler = B.check = 1, B.mode = o & 512 ? Lg : v, o = 0, w = 0;
          break;
        case Fg:
          for (; w < 16; ) {
            if (i === 0)
              break A;
            i--, o += I[C++] << w, w += 8;
          }
          if (B.flags = o, (B.flags & 255) !== yg) {
            A.msg = "unknown compression method", B.mode = L;
            break;
          }
          if (B.flags & 57344) {
            A.msg = "unknown header flags set", B.mode = L;
            break;
          }
          B.head && (B.head.text = o >> 8 & 1), B.flags & 512 && B.wrap & 4 && (H[0] = o & 255, H[1] = o >>> 8 & 255, B.check = U(B.check, H, 2, 0)), o = 0, w = 0, B.mode = Hg;
        case Hg:
          for (; w < 32; ) {
            if (i === 0)
              break A;
            i--, o += I[C++] << w, w += 8;
          }
          B.head && (B.head.time = o), B.flags & 512 && B.wrap & 4 && (H[0] = o & 255, H[1] = o >>> 8 & 255, H[2] = o >>> 16 & 255, H[3] = o >>> 24 & 255, B.check = U(B.check, H, 4, 0)), o = 0, w = 0, B.mode = Yg;
        case Yg:
          for (; w < 16; ) {
            if (i === 0)
              break A;
            i--, o += I[C++] << w, w += 8;
          }
          B.head && (B.head.xflags = o & 255, B.head.os = o >> 8), B.flags & 512 && B.wrap & 4 && (H[0] = o & 255, H[1] = o >>> 8 & 255, B.check = U(B.check, H, 2, 0)), o = 0, w = 0, B.mode = lg;
        case lg:
          if (B.flags & 1024) {
            for (; w < 16; ) {
              if (i === 0)
                break A;
              i--, o += I[C++] << w, w += 8;
            }
            B.length = o, B.head && (B.head.extra_len = o), B.flags & 512 && B.wrap & 4 && (H[0] = o & 255, H[1] = o >>> 8 & 255, B.check = U(B.check, H, 2, 0)), o = 0, w = 0;
          } else
            B.head && (B.head.extra = null);
          B.mode = Sg;
        case Sg:
          if (B.flags & 1024 && (s = B.length, s > i && (s = i), s && (B.head && (r = B.head.extra_len - B.length, B.head.extra || (B.head.extra = new Uint8Array(B.head.extra_len)), B.head.extra.set(
            I.subarray(
              C,
              // extra field is limited to 65536 bytes
              // - no need for additional size check
              C + s
            ),
            /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
            r
          )), B.flags & 512 && B.wrap & 4 && (B.check = U(B.check, I, s, C)), i -= s, C += s, B.length -= s), B.length))
            break A;
          B.length = 0, B.mode = Rg;
        case Rg:
          if (B.flags & 2048) {
            if (i === 0)
              break A;
            s = 0;
            do
              r = I[C + s++], B.head && r && B.length < 65536 && (B.head.name += String.fromCharCode(r));
            while (r && s < i);
            if (B.flags & 512 && B.wrap & 4 && (B.check = U(B.check, I, s, C)), i -= s, C += s, r)
              break A;
          } else
            B.head && (B.head.name = null);
          B.length = 0, B.mode = Kg;
        case Kg:
          if (B.flags & 4096) {
            if (i === 0)
              break A;
            s = 0;
            do
              r = I[C + s++], B.head && r && B.length < 65536 && (B.head.comment += String.fromCharCode(r));
            while (r && s < i);
            if (B.flags & 512 && B.wrap & 4 && (B.check = U(B.check, I, s, C)), i -= s, C += s, r)
              break A;
          } else
            B.head && (B.head.comment = null);
          B.mode = qg;
        case qg:
          if (B.flags & 512) {
            for (; w < 16; ) {
              if (i === 0)
                break A;
              i--, o += I[C++] << w, w += 8;
            }
            if (B.wrap & 4 && o !== (B.check & 65535)) {
              A.msg = "header crc mismatch", B.mode = L;
              break;
            }
            o = 0, w = 0;
          }
          B.head && (B.head.hcrc = B.flags >> 9 & 1, B.head.done = !0), A.adler = B.check = 0, B.mode = v;
          break;
        case Lg:
          for (; w < 32; ) {
            if (i === 0)
              break A;
            i--, o += I[C++] << w, w += 8;
          }
          A.adler = B.check = Zg(o), o = 0, w = 0, B.mode = sB;
        case sB:
          if (B.havedict === 0)
            return A.next_out = E, A.avail_out = D, A.next_in = C, A.avail_in = i, B.hold = o, B.bits = w, _C;
          A.adler = B.check = 1, B.mode = v;
        case v:
          if (g === PC || g === AB)
            break A;
        case FB:
          if (B.last) {
            o >>>= w & 7, w -= w & 7, B.mode = YB;
            break;
          }
          for (; w < 3; ) {
            if (i === 0)
              break A;
            i--, o += I[C++] << w, w += 8;
          }
          switch (B.last = o & 1, o >>>= 1, w -= 1, o & 3) {
            case 0:
              B.mode = Ug;
              break;
            case 1:
              if (EE(B), B.mode = BB, g === AB) {
                o >>>= 2, w -= 2;
                break A;
              }
              break;
            case 2:
              B.mode = dg;
              break;
            case 3:
              A.msg = "invalid block type", B.mode = L;
          }
          o >>>= 2, w -= 2;
          break;
        case Ug:
          for (o >>>= w & 7, w -= w & 7; w < 32; ) {
            if (i === 0)
              break A;
            i--, o += I[C++] << w, w += 8;
          }
          if ((o & 65535) !== (o >>> 16 ^ 65535)) {
            A.msg = "invalid stored block lengths", B.mode = L;
            break;
          }
          if (B.length = o & 65535, o = 0, w = 0, B.mode = HB, g === AB)
            break A;
        case HB:
          B.mode = fg;
        case fg:
          if (s = B.length, s) {
            if (s > i && (s = i), s > D && (s = D), s === 0)
              break A;
            Q.set(I.subarray(C, C + s), E), i -= s, C += s, D -= s, E += s, B.length -= s;
            break;
          }
          B.mode = v;
          break;
        case dg:
          for (; w < 14; ) {
            if (i === 0)
              break A;
            i--, o += I[C++] << w, w += 8;
          }
          if (B.nlen = (o & 31) + 257, o >>>= 5, w -= 5, B.ndist = (o & 31) + 1, o >>>= 5, w -= 5, B.ncode = (o & 15) + 4, o >>>= 4, w -= 4, B.nlen > 286 || B.ndist > 30) {
            A.msg = "too many length or distance symbols", B.mode = L;
            break;
          }
          B.have = 0, B.mode = pg;
        case pg:
          for (; B.have < B.ncode; ) {
            for (; w < 3; ) {
              if (i === 0)
                break A;
              i--, o += I[C++] << w, w += 8;
            }
            B.lens[EA[B.have++]] = o & 7, o >>>= 3, w -= 3;
          }
          for (; B.have < 19; )
            B.lens[EA[B.have++]] = 0;
          if (B.lencode = B.lendyn, B.lenbits = 7, y = { bits: B.lenbits }, F = dA(vC, B.lens, 0, 19, B.lencode, 0, B.work, y), B.lenbits = y.bits, F) {
            A.msg = "invalid code lengths set", B.mode = L;
            break;
          }
          B.have = 0, B.mode = Og;
        case Og:
          for (; B.have < B.nlen + B.ndist; ) {
            for (; M = B.lencode[o & (1 << B.lenbits) - 1], N = M >>> 24, n = M >>> 16 & 255, c = M & 65535, !(N <= w); ) {
              if (i === 0)
                break A;
              i--, o += I[C++] << w, w += 8;
            }
            if (c < 16)
              o >>>= N, w -= N, B.lens[B.have++] = c;
            else {
              if (c === 16) {
                for (Y = N + 2; w < Y; ) {
                  if (i === 0)
                    break A;
                  i--, o += I[C++] << w, w += 8;
                }
                if (o >>>= N, w -= N, B.have === 0) {
                  A.msg = "invalid bit length repeat", B.mode = L;
                  break;
                }
                r = B.lens[B.have - 1], s = 3 + (o & 3), o >>>= 2, w -= 2;
              } else if (c === 17) {
                for (Y = N + 3; w < Y; ) {
                  if (i === 0)
                    break A;
                  i--, o += I[C++] << w, w += 8;
                }
                o >>>= N, w -= N, r = 0, s = 3 + (o & 7), o >>>= 3, w -= 3;
              } else {
                for (Y = N + 7; w < Y; ) {
                  if (i === 0)
                    break A;
                  i--, o += I[C++] << w, w += 8;
                }
                o >>>= N, w -= N, r = 0, s = 11 + (o & 127), o >>>= 7, w -= 7;
              }
              if (B.have + s > B.nlen + B.ndist) {
                A.msg = "invalid bit length repeat", B.mode = L;
                break;
              }
              for (; s--; )
                B.lens[B.have++] = r;
            }
          }
          if (B.mode === L)
            break;
          if (B.lens[256] === 0) {
            A.msg = "invalid code -- missing end-of-block", B.mode = L;
            break;
          }
          if (B.lenbits = 9, y = { bits: B.lenbits }, F = dA(lI, B.lens, 0, B.nlen, B.lencode, 0, B.work, y), B.lenbits = y.bits, F) {
            A.msg = "invalid literal/lengths set", B.mode = L;
            break;
          }
          if (B.distbits = 6, B.distcode = B.distdyn, y = { bits: B.distbits }, F = dA(SI, B.lens, B.nlen, B.ndist, B.distcode, 0, B.work, y), B.distbits = y.bits, F) {
            A.msg = "invalid distances set", B.mode = L;
            break;
          }
          if (B.mode = BB, g === AB)
            break A;
        case BB:
          B.mode = gB;
        case gB:
          if (i >= 6 && D >= 258) {
            A.next_out = E, A.avail_out = D, A.next_in = C, A.avail_in = i, B.hold = o, B.bits = w, TC(A, e), E = A.next_out, Q = A.output, D = A.avail_out, C = A.next_in, I = A.input, i = A.avail_in, o = B.hold, w = B.bits, B.mode === v && (B.back = -1);
            break;
          }
          for (B.back = 0; M = B.lencode[o & (1 << B.lenbits) - 1], N = M >>> 24, n = M >>> 16 & 255, c = M & 65535, !(N <= w); ) {
            if (i === 0)
              break A;
            i--, o += I[C++] << w, w += 8;
          }
          if (n && !(n & 240)) {
            for (G = N, J = n, R = c; M = B.lencode[R + ((o & (1 << G + J) - 1) >> G)], N = M >>> 24, n = M >>> 16 & 255, c = M & 65535, !(G + N <= w); ) {
              if (i === 0)
                break A;
              i--, o += I[C++] << w, w += 8;
            }
            o >>>= G, w -= G, B.back += G;
          }
          if (o >>>= N, w -= N, B.back += N, B.length = c, n === 0) {
            B.mode = Tg;
            break;
          }
          if (n & 32) {
            B.back = -1, B.mode = v;
            break;
          }
          if (n & 64) {
            A.msg = "invalid literal/length code", B.mode = L;
            break;
          }
          B.extra = n & 15, B.mode = xg;
        case xg:
          if (B.extra) {
            for (Y = B.extra; w < Y; ) {
              if (i === 0)
                break A;
              i--, o += I[C++] << w, w += 8;
            }
            B.length += o & (1 << B.extra) - 1, o >>>= B.extra, w -= B.extra, B.back += B.extra;
          }
          B.was = B.length, B.mode = bg;
        case bg:
          for (; M = B.distcode[o & (1 << B.distbits) - 1], N = M >>> 24, n = M >>> 16 & 255, c = M & 65535, !(N <= w); ) {
            if (i === 0)
              break A;
            i--, o += I[C++] << w, w += 8;
          }
          if (!(n & 240)) {
            for (G = N, J = n, R = c; M = B.distcode[R + ((o & (1 << G + J) - 1) >> G)], N = M >>> 24, n = M >>> 16 & 255, c = M & 65535, !(G + N <= w); ) {
              if (i === 0)
                break A;
              i--, o += I[C++] << w, w += 8;
            }
            o >>>= G, w -= G, B.back += G;
          }
          if (o >>>= N, w -= N, B.back += N, n & 64) {
            A.msg = "invalid distance code", B.mode = L;
            break;
          }
          B.offset = c, B.extra = n & 15, B.mode = jg;
        case jg:
          if (B.extra) {
            for (Y = B.extra; w < Y; ) {
              if (i === 0)
                break A;
              i--, o += I[C++] << w, w += 8;
            }
            B.offset += o & (1 << B.extra) - 1, o >>>= B.extra, w -= B.extra, B.back += B.extra;
          }
          if (B.offset > B.dmax) {
            A.msg = "invalid distance too far back", B.mode = L;
            break;
          }
          B.mode = mg;
        case mg:
          if (D === 0)
            break A;
          if (s = e - D, B.offset > s) {
            if (s = B.offset - s, s > B.whave && B.sane) {
              A.msg = "invalid distance too far back", B.mode = L;
              break;
            }
            s > B.wnext ? (s -= B.wnext, a = B.wsize - s) : a = B.wnext - s, s > B.length && (s = B.length), k = B.window;
          } else
            k = Q, a = E - B.offset, s = B.length;
          s > D && (s = D), D -= s, B.length -= s;
          do
            Q[E++] = k[a++];
          while (--s);
          B.length === 0 && (B.mode = gB);
          break;
        case Tg:
          if (D === 0)
            break A;
          Q[E++] = B.length, D--, B.mode = gB;
          break;
        case YB:
          if (B.wrap) {
            for (; w < 32; ) {
              if (i === 0)
                break A;
              i--, o |= I[C++] << w, w += 8;
            }
            if (e -= D, A.total_out += e, B.total += e, B.wrap & 4 && e && (A.adler = B.check = /*UPDATE_CHECK(state.check, put - _out, _out);*/
            B.flags ? U(B.check, Q, e, E - e) : mA(B.check, Q, e, E - e)), e = D, B.wrap & 4 && (B.flags ? o : Zg(o)) !== B.check) {
              A.msg = "incorrect data check", B.mode = L;
              break;
            }
            o = 0, w = 0;
          }
          B.mode = ug;
        case ug:
          if (B.wrap && B.flags) {
            for (; w < 32; ) {
              if (i === 0)
                break A;
              i--, o += I[C++] << w, w += 8;
            }
            if (B.wrap & 4 && o !== (B.total & 4294967295)) {
              A.msg = "incorrect length check", B.mode = L;
              break;
            }
            o = 0, w = 0;
          }
          B.mode = Xg;
        case Xg:
          F = VC;
          break A;
        case L:
          F = RI;
          break A;
        case qI:
          return KI;
        case LI:
        default:
          return T;
      }
  return A.next_out = E, A.avail_out = D, A.next_in = C, A.avail_in = i, B.hold = o, B.bits = w, (B.wsize || e !== A.avail_out && B.mode < L && (B.mode < YB || g !== ng)) && OI(A, A.output, A.next_out, e - A.avail_out), t -= A.avail_in, e -= A.avail_out, A.total_in += t, A.total_out += e, B.total += e, B.wrap & 4 && e && (A.adler = B.check = /*UPDATE_CHECK(state.check, strm.next_out - _out, _out);*/
  B.flags ? U(B.check, Q, e, A.next_out - e) : mA(B.check, Q, e, A.next_out - e)), A.data_type = B.bits + (B.last ? 64 : 0) + (B.mode === v ? 128 : 0) + (B.mode === BB || B.mode === HB ? 256 : 0), (t === 0 && e === 0 || g === ng) && F === aA && (F = $C), F;
}, oE = (A) => {
  if (hA(A))
    return T;
  let g = A.state;
  return g.window && (g.window = null), A.state = null, aA;
}, wE = (A, g) => {
  if (hA(A))
    return T;
  const B = A.state;
  return B.wrap & 2 ? (B.head = g, g.done = !1, aA) : T;
}, DE = (A, g) => {
  const B = g.length;
  let I, Q, C;
  return hA(A) || (I = A.state, I.wrap !== 0 && I.mode !== sB) ? T : I.mode === sB && (Q = 1, Q = mA(Q, g, B, 0), Q !== I.check) ? RI : (C = OI(A, g, B, B), C ? (I.mode = qI, KI) : (I.havedict = 1, aA));
};
var sE = fI, tE = dI, eE = UI, aE = CE, hE = pI, GE = iE, cE = oE, kE = wE, ME = DE, NE = "pako inflate (from Nodeca project)", $ = {
  inflateReset: sE,
  inflateReset2: tE,
  inflateResetKeep: eE,
  inflateInit: aE,
  inflateInit2: hE,
  inflate: GE,
  inflateEnd: cE,
  inflateGetHeader: kE,
  inflateSetDictionary: ME,
  inflateInfo: NE
};
function rE() {
  this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = !1;
}
var JE = rE;
const xI = Object.prototype.toString, {
  Z_NO_FLUSH: nE,
  Z_FINISH: yE,
  Z_OK: XA,
  Z_STREAM_END: RB,
  Z_NEED_DICT: KB,
  Z_STREAM_ERROR: FE,
  Z_DATA_ERROR: Wg,
  Z_MEM_ERROR: HE
} = zA;
function vA(A) {
  this.options = aB.assign({
    chunkSize: 1024 * 64,
    windowBits: 15,
    to: ""
  }, A || {});
  const g = this.options;
  g.raw && g.windowBits >= 0 && g.windowBits < 16 && (g.windowBits = -g.windowBits, g.windowBits === 0 && (g.windowBits = -15)), g.windowBits >= 0 && g.windowBits < 16 && !(A && A.windowBits) && (g.windowBits += 32), g.windowBits > 15 && g.windowBits < 48 && (g.windowBits & 15 || (g.windowBits |= 15)), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new HI(), this.strm.avail_out = 0;
  let B = $.inflateInit2(
    this.strm,
    g.windowBits
  );
  if (B !== XA)
    throw new Error(rA[B]);
  if (this.header = new JE(), $.inflateGetHeader(this.strm, this.header), g.dictionary && (typeof g.dictionary == "string" ? g.dictionary = uA.string2buf(g.dictionary) : xI.call(g.dictionary) === "[object ArrayBuffer]" && (g.dictionary = new Uint8Array(g.dictionary)), g.raw && (B = $.inflateSetDictionary(this.strm, g.dictionary), B !== XA)))
    throw new Error(rA[B]);
}
vA.prototype.push = function(A, g) {
  const B = this.strm, I = this.options.chunkSize, Q = this.options.dictionary;
  let C, E, i;
  if (this.ended)
    return !1;
  for (g === ~~g ? E = g : E = g === !0 ? yE : nE, xI.call(A) === "[object ArrayBuffer]" ? B.input = new Uint8Array(A) : B.input = A, B.next_in = 0, B.avail_in = B.input.length; ; ) {
    for (B.avail_out === 0 && (B.output = new Uint8Array(I), B.next_out = 0, B.avail_out = I), C = $.inflate(B, E), C === KB && Q && (C = $.inflateSetDictionary(B, Q), C === XA ? C = $.inflate(B, E) : C === Wg && (C = KB)); B.avail_in > 0 && C === RB && B.state.wrap > 0 && A[B.next_in] !== 0; )
      $.inflateReset(B), C = $.inflate(B, E);
    switch (C) {
      case FE:
      case Wg:
      case KB:
      case HE:
        return this.onEnd(C), this.ended = !0, !1;
    }
    if (i = B.avail_out, B.next_out && (B.avail_out === 0 || C === RB))
      if (this.options.to === "string") {
        let D = uA.utf8border(B.output, B.next_out), o = B.next_out - D, w = uA.buf2string(B.output, D);
        B.next_out = o, B.avail_out = I - o, o && B.output.set(B.output.subarray(D, D + o), 0), this.onData(w);
      } else
        this.onData(B.output.length === B.next_out ? B.output : B.output.subarray(0, B.next_out));
    if (!(C === XA && i === 0)) {
      if (C === RB)
        return C = $.inflateEnd(this.strm), this.onEnd(C), this.ended = !0, !0;
      if (B.avail_in === 0)
        break;
    }
  }
  return !0;
};
vA.prototype.onData = function(A) {
  this.chunks.push(A);
};
vA.prototype.onEnd = function(A) {
  A === XA && (this.options.to === "string" ? this.result = this.chunks.join("") : this.result = aB.flattenChunks(this.chunks)), this.chunks = [], this.err = A, this.msg = this.strm.msg;
};
function Qg(A, g) {
  const B = new vA(g);
  if (B.push(A), B.err)
    throw B.msg || rA[B.err];
  return B.result;
}
function YE(A, g) {
  return g = g || {}, g.raw = !0, Qg(A, g);
}
var lE = vA, SE = Qg, RE = YE, KE = Qg, qE = zA, LE = {
  Inflate: lE,
  inflate: SE,
  inflateRaw: RE,
  ungzip: KE,
  constants: qE
};
const { Inflate: UE, inflate: fE, inflateRaw: Ki, ungzip: qi } = LE;
var vg = UE, dE = fE;
const bI = [];
for (let A = 0; A < 256; A++) {
  let g = A;
  for (let B = 0; B < 8; B++)
    g & 1 ? g = 3988292384 ^ g >>> 1 : g = g >>> 1;
  bI[A] = g;
}
const Pg = 4294967295;
function pE(A, g, B) {
  let I = A;
  for (let Q = 0; Q < B; Q++)
    I = bI[(I ^ g[Q]) & 255] ^ I >>> 8;
  return I;
}
function OE(A, g) {
  return (pE(Pg, A, g) ^ Pg) >>> 0;
}
function Vg(A, g, B) {
  const I = A.readUint32(), Q = OE(new Uint8Array(A.buffer, A.byteOffset + A.offset - g - 4, g), g);
  if (Q !== I)
    throw new Error(`CRC mismatch for chunk ${B}. Expected ${I}, found ${Q}`);
}
function jI(A, g, B) {
  for (let I = 0; I < B; I++)
    g[I] = A[I];
}
function mI(A, g, B, I) {
  let Q = 0;
  for (; Q < I; Q++)
    g[Q] = A[Q];
  for (; Q < B; Q++)
    g[Q] = A[Q] + g[Q - I] & 255;
}
function TI(A, g, B, I) {
  let Q = 0;
  if (B.length === 0)
    for (; Q < I; Q++)
      g[Q] = A[Q];
  else
    for (; Q < I; Q++)
      g[Q] = A[Q] + B[Q] & 255;
}
function uI(A, g, B, I, Q) {
  let C = 0;
  if (B.length === 0) {
    for (; C < Q; C++)
      g[C] = A[C];
    for (; C < I; C++)
      g[C] = A[C] + (g[C - Q] >> 1) & 255;
  } else {
    for (; C < Q; C++)
      g[C] = A[C] + (B[C] >> 1) & 255;
    for (; C < I; C++)
      g[C] = A[C] + (g[C - Q] + B[C] >> 1) & 255;
  }
}
function XI(A, g, B, I, Q) {
  let C = 0;
  if (B.length === 0) {
    for (; C < Q; C++)
      g[C] = A[C];
    for (; C < I; C++)
      g[C] = A[C] + g[C - Q] & 255;
  } else {
    for (; C < Q; C++)
      g[C] = A[C] + B[C] & 255;
    for (; C < I; C++)
      g[C] = A[C] + xE(g[C - Q], B[C], B[C - Q]) & 255;
  }
}
function xE(A, g, B) {
  const I = A + g - B, Q = Math.abs(I - A), C = Math.abs(I - g), E = Math.abs(I - B);
  return Q <= C && Q <= E ? A : C <= E ? g : B;
}
function bE(A, g, B, I, Q, C) {
  switch (A) {
    case 0:
      jI(g, B, Q);
      break;
    case 1:
      mI(g, B, Q, C);
      break;
    case 2:
      TI(g, B, I, Q);
      break;
    case 3:
      uI(g, B, I, Q, C);
      break;
    case 4:
      XI(g, B, I, Q, C);
      break;
    default:
      throw new Error(`Unsupported filter: ${A}`);
  }
}
const jE = new Uint16Array([255]), mE = new Uint8Array(jE.buffer), TE = mE[0] === 255;
function uE(A) {
  const { data: g, width: B, height: I, channels: Q, depth: C } = A, E = [
    { x: 0, y: 0, xStep: 8, yStep: 8 },
    // Pass 1
    { x: 4, y: 0, xStep: 8, yStep: 8 },
    // Pass 2
    { x: 0, y: 4, xStep: 4, yStep: 8 },
    // Pass 3
    { x: 2, y: 0, xStep: 4, yStep: 4 },
    // Pass 4
    { x: 0, y: 2, xStep: 2, yStep: 4 },
    // Pass 5
    { x: 1, y: 0, xStep: 2, yStep: 2 },
    // Pass 6
    { x: 0, y: 1, xStep: 1, yStep: 2 }
    // Pass 7
  ], i = Math.ceil(C / 8) * Q, D = new Uint8Array(I * B * i);
  let o = 0;
  for (let w = 0; w < 7; w++) {
    const t = E[w], e = Math.ceil((B - t.x) / t.xStep), s = Math.ceil((I - t.y) / t.yStep);
    if (e <= 0 || s <= 0)
      continue;
    const a = e * i, k = new Uint8Array(a);
    for (let M = 0; M < s; M++) {
      const N = g[o++], n = g.subarray(o, o + a);
      o += a;
      const c = new Uint8Array(a);
      bE(N, n, c, k, a, i), k.set(c);
      for (let G = 0; G < e; G++) {
        const J = t.x + G * t.xStep, R = t.y + M * t.yStep;
        if (!(J >= B || R >= I))
          for (let r = 0; r < i; r++)
            D[(R * B + J) * i + r] = c[G * i + r];
      }
    }
  }
  if (C === 16) {
    const w = new Uint16Array(D.buffer);
    if (TE)
      for (let t = 0; t < w.length; t++)
        w[t] = XE(w[t]);
    return w;
  } else
    return D;
}
function XE(A) {
  return (A & 255) << 8 | A >> 8 & 255;
}
const ZE = new Uint16Array([255]), zE = new Uint8Array(ZE.buffer), WE = zE[0] === 255, vE = new Uint8Array(0);
function _g(A) {
  const { data: g, width: B, height: I, channels: Q, depth: C } = A, E = Math.ceil(C / 8) * Q, i = Math.ceil(C / 8 * Q * B), D = new Uint8Array(I * i);
  let o = vE, w = 0, t, e;
  for (let s = 0; s < I; s++) {
    switch (t = g.subarray(w + 1, w + 1 + i), e = D.subarray(s * i, (s + 1) * i), g[w]) {
      case 0:
        jI(t, e, i);
        break;
      case 1:
        mI(t, e, i, E);
        break;
      case 2:
        TI(t, e, o, i);
        break;
      case 3:
        uI(t, e, o, i, E);
        break;
      case 4:
        XI(t, e, o, i, E);
        break;
      default:
        throw new Error(`Unsupported filter: ${g[w]}`);
    }
    o = e, w += i + 1;
  }
  if (C === 16) {
    const s = new Uint16Array(D.buffer);
    if (WE)
      for (let a = 0; a < s.length; a++)
        s[a] = PE(s[a]);
    return s;
  } else
    return D;
}
function PE(A) {
  return (A & 255) << 8 | A >> 8 & 255;
}
const EB = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
function $g(A) {
  if (!VE(A.readBytes(EB.length)))
    throw new Error("wrong PNG signature");
}
function VE(A) {
  if (A.length < EB.length)
    return !1;
  for (let g = 0; g < EB.length; g++)
    if (A[g] !== EB[g])
      return !1;
  return !0;
}
const _E = "tEXt", $E = 0, ZI = new TextDecoder("latin1");
function Ai(A) {
  if (gi(A), A.length === 0 || A.length > 79)
    throw new Error("keyword length must be between 1 and 79");
}
const Bi = /^[\u0000-\u00FF]*$/;
function gi(A) {
  if (!Bi.test(A))
    throw new Error("invalid latin1 text");
}
function Ii(A, g, B) {
  const I = zI(g);
  A[I] = Qi(g, B - I.length - 1);
}
function zI(A) {
  for (A.mark(); A.readByte() !== $E; )
    ;
  const g = A.offset;
  A.reset();
  const B = ZI.decode(A.readBytes(g - A.offset - 1));
  return A.skip(1), Ai(B), B;
}
function Qi(A, g) {
  return ZI.decode(A.readBytes(g));
}
const x = {
  UNKNOWN: -1,
  GREYSCALE: 0,
  TRUECOLOUR: 2,
  INDEXED_COLOUR: 3,
  GREYSCALE_ALPHA: 4,
  TRUECOLOUR_ALPHA: 6
}, qB = {
  UNKNOWN: -1,
  DEFLATE: 0
}, AI = {
  UNKNOWN: -1,
  ADAPTIVE: 0
}, LB = {
  UNKNOWN: -1,
  NO_INTERLACE: 0,
  ADAM7: 1
}, IB = {
  NONE: 0,
  BACKGROUND: 1,
  PREVIOUS: 2
}, UB = {
  SOURCE: 0,
  OVER: 1
};
class Ci extends VB {
  constructor(B, I = {}) {
    super(B);
    q(this, "_checkCrc");
    q(this, "_inflator");
    q(this, "_png");
    q(this, "_apng");
    q(this, "_end");
    q(this, "_hasPalette");
    q(this, "_palette");
    q(this, "_hasTransparency");
    q(this, "_transparency");
    q(this, "_compressionMethod");
    q(this, "_filterMethod");
    q(this, "_interlaceMethod");
    q(this, "_colorType");
    q(this, "_isAnimated");
    q(this, "_numberOfFrames");
    q(this, "_numberOfPlays");
    q(this, "_frames");
    q(this, "_writingDataChunks");
    const { checkCrc: Q = !1 } = I;
    this._checkCrc = Q, this._inflator = new vg(), this._png = {
      width: -1,
      height: -1,
      channels: -1,
      data: new Uint8Array(0),
      depth: 1,
      text: {}
    }, this._apng = {
      width: -1,
      height: -1,
      channels: -1,
      depth: 1,
      numberOfFrames: 1,
      numberOfPlays: 0,
      text: {},
      frames: []
    }, this._end = !1, this._hasPalette = !1, this._palette = [], this._hasTransparency = !1, this._transparency = new Uint16Array(0), this._compressionMethod = qB.UNKNOWN, this._filterMethod = AI.UNKNOWN, this._interlaceMethod = LB.UNKNOWN, this._colorType = x.UNKNOWN, this._isAnimated = !1, this._numberOfFrames = 1, this._numberOfPlays = 0, this._frames = [], this._writingDataChunks = !1, this.setBigEndian();
  }
  decode() {
    for ($g(this); !this._end; ) {
      const B = this.readUint32(), I = this.readChars(4);
      this.decodeChunk(B, I);
    }
    return this.decodeImage(), this._png;
  }
  decodeApng() {
    for ($g(this); !this._end; ) {
      const B = this.readUint32(), I = this.readChars(4);
      this.decodeApngChunk(B, I);
    }
    return this.decodeApngImage(), this._apng;
  }
  // https://www.w3.org/TR/PNG/#5Chunk-layout
  decodeChunk(B, I) {
    const Q = this.offset;
    switch (I) {
      case "IHDR":
        this.decodeIHDR();
        break;
      case "PLTE":
        this.decodePLTE(B);
        break;
      case "IDAT":
        this.decodeIDAT(B);
        break;
      case "IEND":
        this._end = !0;
        break;
      case "tRNS":
        this.decodetRNS(B);
        break;
      case "iCCP":
        this.decodeiCCP(B);
        break;
      case _E:
        Ii(this._png.text, this, B);
        break;
      case "pHYs":
        this.decodepHYs();
        break;
      default:
        this.skip(B);
        break;
    }
    if (this.offset - Q !== B)
      throw new Error(`Length mismatch while decoding chunk ${I}`);
    this._checkCrc ? Vg(this, B + 4, I) : this.skip(4);
  }
  decodeApngChunk(B, I) {
    const Q = this.offset;
    switch (I !== "fdAT" && I !== "IDAT" && this._writingDataChunks && this.pushDataToFrame(), I) {
      case "acTL":
        this.decodeACTL();
        break;
      case "fcTL":
        this.decodeFCTL();
        break;
      case "fdAT":
        this.decodeFDAT(B);
        break;
      default:
        this.decodeChunk(B, I), this.offset = Q + B;
        break;
    }
    if (this.offset - Q !== B)
      throw new Error(`Length mismatch while decoding chunk ${I}`);
    this._checkCrc ? Vg(this, B + 4, I) : this.skip(4);
  }
  // https://www.w3.org/TR/PNG/#11IHDR
  decodeIHDR() {
    const B = this._png;
    B.width = this.readUint32(), B.height = this.readUint32(), B.depth = Ei(this.readUint8());
    const I = this.readUint8();
    this._colorType = I;
    let Q;
    switch (I) {
      case x.GREYSCALE:
        Q = 1;
        break;
      case x.TRUECOLOUR:
        Q = 3;
        break;
      case x.INDEXED_COLOUR:
        Q = 1;
        break;
      case x.GREYSCALE_ALPHA:
        Q = 2;
        break;
      case x.TRUECOLOUR_ALPHA:
        Q = 4;
        break;
      case x.UNKNOWN:
      default:
        throw new Error(`Unknown color type: ${I}`);
    }
    if (this._png.channels = Q, this._compressionMethod = this.readUint8(), this._compressionMethod !== qB.DEFLATE)
      throw new Error(`Unsupported compression method: ${this._compressionMethod}`);
    this._filterMethod = this.readUint8(), this._interlaceMethod = this.readUint8();
  }
  decodeACTL() {
    this._numberOfFrames = this.readUint32(), this._numberOfPlays = this.readUint32(), this._isAnimated = !0;
  }
  decodeFCTL() {
    const B = {
      sequenceNumber: this.readUint32(),
      width: this.readUint32(),
      height: this.readUint32(),
      xOffset: this.readUint32(),
      yOffset: this.readUint32(),
      delayNumber: this.readUint16(),
      delayDenominator: this.readUint16(),
      disposeOp: this.readUint8(),
      blendOp: this.readUint8(),
      data: new Uint8Array(0)
    };
    this._frames.push(B);
  }
  // https://www.w3.org/TR/PNG/#11PLTE
  decodePLTE(B) {
    if (B % 3 !== 0)
      throw new RangeError(`PLTE field length must be a multiple of 3. Got ${B}`);
    const I = B / 3;
    this._hasPalette = !0;
    const Q = [];
    this._palette = Q;
    for (let C = 0; C < I; C++)
      Q.push([this.readUint8(), this.readUint8(), this.readUint8()]);
  }
  // https://www.w3.org/TR/PNG/#11IDAT
  decodeIDAT(B) {
    this._writingDataChunks = !0;
    const I = B, Q = this.offset + this.byteOffset;
    if (this._inflator.push(new Uint8Array(this.buffer, Q, I)), this._inflator.err)
      throw new Error(`Error while decompressing the data: ${this._inflator.err}`);
    this.skip(B);
  }
  decodeFDAT(B) {
    this._writingDataChunks = !0;
    let I = B, Q = this.offset + this.byteOffset;
    if (Q += 4, I -= 4, this._inflator.push(new Uint8Array(this.buffer, Q, I)), this._inflator.err)
      throw new Error(`Error while decompressing the data: ${this._inflator.err}`);
    this.skip(B);
  }
  // https://www.w3.org/TR/PNG/#11tRNS
  decodetRNS(B) {
    switch (this._colorType) {
      case x.GREYSCALE:
      case x.TRUECOLOUR: {
        if (B % 2 !== 0)
          throw new RangeError(`tRNS chunk length must be a multiple of 2. Got ${B}`);
        if (B / 2 > this._png.width * this._png.height)
          throw new Error(`tRNS chunk contains more alpha values than there are pixels (${B / 2} vs ${this._png.width * this._png.height})`);
        this._hasTransparency = !0, this._transparency = new Uint16Array(B / 2);
        for (let I = 0; I < B / 2; I++)
          this._transparency[I] = this.readUint16();
        break;
      }
      case x.INDEXED_COLOUR: {
        if (B > this._palette.length)
          throw new Error(`tRNS chunk contains more alpha values than there are palette colors (${B} vs ${this._palette.length})`);
        let I = 0;
        for (; I < B; I++) {
          const Q = this.readByte();
          this._palette[I].push(Q);
        }
        for (; I < this._palette.length; I++)
          this._palette[I].push(255);
        break;
      }
      case x.UNKNOWN:
      case x.GREYSCALE_ALPHA:
      case x.TRUECOLOUR_ALPHA:
      default:
        throw new Error(`tRNS chunk is not supported for color type ${this._colorType}`);
    }
  }
  // https://www.w3.org/TR/PNG/#11iCCP
  decodeiCCP(B) {
    const I = zI(this), Q = this.readUint8();
    if (Q !== qB.DEFLATE)
      throw new Error(`Unsupported iCCP compression method: ${Q}`);
    const C = this.readBytes(B - I.length - 2);
    this._png.iccEmbeddedProfile = {
      name: I,
      profile: dE(C)
    };
  }
  // https://www.w3.org/TR/PNG/#11pHYs
  decodepHYs() {
    const B = this.readUint32(), I = this.readUint32(), Q = this.readByte();
    this._png.resolution = {
      x: B,
      y: I,
      unit: Q
    };
  }
  decodeApngImage() {
    this._apng.width = this._png.width, this._apng.height = this._png.height, this._apng.channels = this._png.channels, this._apng.depth = this._png.depth, this._apng.numberOfFrames = this._numberOfFrames, this._apng.numberOfPlays = this._numberOfPlays, this._apng.text = this._png.text, this._apng.resolution = this._png.resolution;
    for (let B = 0; B < this._numberOfFrames; B++) {
      const I = {
        sequenceNumber: this._frames[B].sequenceNumber,
        delayNumber: this._frames[B].delayNumber,
        delayDenominator: this._frames[B].delayDenominator,
        data: this._apng.depth === 8 ? new Uint8Array(this._apng.width * this._apng.height * this._apng.channels) : new Uint16Array(this._apng.width * this._apng.height * this._apng.channels)
      }, Q = this._frames.at(B);
      if (Q) {
        if (Q.data = _g({
          data: Q.data,
          width: Q.width,
          height: Q.height,
          channels: this._apng.channels,
          depth: this._apng.depth
        }), this._hasPalette && (this._apng.palette = this._palette), this._hasTransparency && (this._apng.transparency = this._transparency), B === 0 || Q.xOffset === 0 && Q.yOffset === 0 && Q.width === this._png.width && Q.height === this._png.height)
          I.data = Q.data;
        else {
          const C = this._apng.frames.at(B - 1);
          this.disposeFrame(Q, C, I), this.addFrameDataToCanvas(I, Q);
        }
        this._apng.frames.push(I);
      }
    }
    return this._apng;
  }
  disposeFrame(B, I, Q) {
    switch (B.disposeOp) {
      case IB.NONE:
        break;
      case IB.BACKGROUND:
        for (let C = 0; C < this._png.height; C++)
          for (let E = 0; E < this._png.width; E++) {
            const i = (C * B.width + E) * this._png.channels;
            for (let D = 0; D < this._png.channels; D++)
              Q.data[i + D] = 0;
          }
        break;
      case IB.PREVIOUS:
        Q.data.set(I.data);
        break;
      default:
        throw new Error("Unknown disposeOp");
    }
  }
  addFrameDataToCanvas(B, I) {
    const Q = 1 << this._png.depth, C = (E, i) => {
      const D = ((E + I.yOffset) * this._png.width + I.xOffset + i) * this._png.channels, o = (E * I.width + i) * this._png.channels;
      return { index: D, frameIndex: o };
    };
    switch (I.blendOp) {
      case UB.SOURCE:
        for (let E = 0; E < I.height; E++)
          for (let i = 0; i < I.width; i++) {
            const { index: D, frameIndex: o } = C(E, i);
            for (let w = 0; w < this._png.channels; w++)
              B.data[D + w] = I.data[o + w];
          }
        break;
      case UB.OVER:
        for (let E = 0; E < I.height; E++)
          for (let i = 0; i < I.width; i++) {
            const { index: D, frameIndex: o } = C(E, i);
            for (let w = 0; w < this._png.channels; w++) {
              const t = I.data[o + this._png.channels - 1] / Q, e = w % (this._png.channels - 1) === 0 ? 1 : I.data[o + w], s = Math.floor(t * e + (1 - t) * B.data[D + w]);
              B.data[D + w] += s;
            }
          }
        break;
      default:
        throw new Error("Unknown blendOp");
    }
  }
  decodeImage() {
    var I;
    if (this._inflator.err)
      throw new Error(`Error while decompressing the data: ${this._inflator.err}`);
    const B = this._isAnimated ? ((I = this._frames) == null ? void 0 : I.at(0)).data : this._inflator.result;
    if (this._filterMethod !== AI.ADAPTIVE)
      throw new Error(`Filter method ${this._filterMethod} not supported`);
    if (this._interlaceMethod === LB.NO_INTERLACE)
      this._png.data = _g({
        data: B,
        width: this._png.width,
        height: this._png.height,
        channels: this._png.channels,
        depth: this._png.depth
      });
    else if (this._interlaceMethod === LB.ADAM7)
      this._png.data = uE({
        data: B,
        width: this._png.width,
        height: this._png.height,
        channels: this._png.channels,
        depth: this._png.depth
      });
    else
      throw new Error(`Interlace method ${this._interlaceMethod} not supported`);
    this._hasPalette && (this._png.palette = this._palette), this._hasTransparency && (this._png.transparency = this._transparency);
  }
  pushDataToFrame() {
    const B = this._inflator.result, I = this._frames.at(-1);
    I ? I.data = B : this._frames.push({
      sequenceNumber: 0,
      width: this._png.width,
      height: this._png.height,
      xOffset: 0,
      yOffset: 0,
      delayNumber: 0,
      delayDenominator: 0,
      disposeOp: IB.NONE,
      blendOp: UB.SOURCE,
      data: B
    }), this._inflator = new vg(), this._writingDataChunks = !1;
  }
}
function Ei(A) {
  if (A !== 1 && A !== 2 && A !== 4 && A !== 8 && A !== 16)
    throw new Error(`invalid bit depth: ${A}`);
  return A;
}
function ii(A, g) {
  return new Ci(A, g).decode();
}
var Cg = /* @__PURE__ */ ((A) => (A[A.CURSOR_KEY_APPLICATION = 0] = "CURSOR_KEY_APPLICATION", A[A.KEYPAD_KEY_APPLICATION = 1] = "KEYPAD_KEY_APPLICATION", A[A.IGNORE_KEYPAD_WITH_NUMLOCK = 2] = "IGNORE_KEYPAD_WITH_NUMLOCK", A[A.ALT_ESC_PREFIX = 3] = "ALT_ESC_PREFIX", A[A.MODIFY_OTHER_KEYS_STATE_2 = 4] = "MODIFY_OTHER_KEYS_STATE_2", A[A.KITTY_KEYBOARD_FLAGS = 5] = "KITTY_KEYBOARD_FLAGS", A))(Cg || {}), WI = /* @__PURE__ */ ((A) => (A[A.RELEASE = 0] = "RELEASE", A[A.PRESS = 1] = "PRESS", A[A.REPEAT = 2] = "REPEAT", A))(WI || {}), h = /* @__PURE__ */ ((A) => (A[A.UNIDENTIFIED = 0] = "UNIDENTIFIED", A[A.GRAVE = 1] = "GRAVE", A[A.BACKSLASH = 2] = "BACKSLASH", A[A.BRACKET_LEFT = 3] = "BRACKET_LEFT", A[A.BRACKET_RIGHT = 4] = "BRACKET_RIGHT", A[A.COMMA = 5] = "COMMA", A[A.ZERO = 6] = "ZERO", A[A.ONE = 7] = "ONE", A[A.TWO = 8] = "TWO", A[A.THREE = 9] = "THREE", A[A.FOUR = 10] = "FOUR", A[A.FIVE = 11] = "FIVE", A[A.SIX = 12] = "SIX", A[A.SEVEN = 13] = "SEVEN", A[A.EIGHT = 14] = "EIGHT", A[A.NINE = 15] = "NINE", A[A.EQUAL = 16] = "EQUAL", A[A.INTL_BACKSLASH = 17] = "INTL_BACKSLASH", A[A.INTL_RO = 18] = "INTL_RO", A[A.INTL_YEN = 19] = "INTL_YEN", A[A.A = 20] = "A", A[A.B = 21] = "B", A[A.C = 22] = "C", A[A.D = 23] = "D", A[A.E = 24] = "E", A[A.F = 25] = "F", A[A.G = 26] = "G", A[A.H = 27] = "H", A[A.I = 28] = "I", A[A.J = 29] = "J", A[A.K = 30] = "K", A[A.L = 31] = "L", A[A.M = 32] = "M", A[A.N = 33] = "N", A[A.O = 34] = "O", A[A.P = 35] = "P", A[A.Q = 36] = "Q", A[A.R = 37] = "R", A[A.S = 38] = "S", A[A.T = 39] = "T", A[A.U = 40] = "U", A[A.V = 41] = "V", A[A.W = 42] = "W", A[A.X = 43] = "X", A[A.Y = 44] = "Y", A[A.Z = 45] = "Z", A[A.MINUS = 46] = "MINUS", A[A.PERIOD = 47] = "PERIOD", A[A.QUOTE = 48] = "QUOTE", A[A.SEMICOLON = 49] = "SEMICOLON", A[A.SLASH = 50] = "SLASH", A[A.ALT_LEFT = 51] = "ALT_LEFT", A[A.ALT_RIGHT = 52] = "ALT_RIGHT", A[A.BACKSPACE = 53] = "BACKSPACE", A[A.CAPS_LOCK = 54] = "CAPS_LOCK", A[A.CONTEXT_MENU = 55] = "CONTEXT_MENU", A[A.CONTROL_LEFT = 56] = "CONTROL_LEFT", A[A.CONTROL_RIGHT = 57] = "CONTROL_RIGHT", A[A.ENTER = 58] = "ENTER", A[A.META_LEFT = 59] = "META_LEFT", A[A.META_RIGHT = 60] = "META_RIGHT", A[A.SHIFT_LEFT = 61] = "SHIFT_LEFT", A[A.SHIFT_RIGHT = 62] = "SHIFT_RIGHT", A[A.SPACE = 63] = "SPACE", A[A.TAB = 64] = "TAB", A[A.CONVERT = 65] = "CONVERT", A[A.KANA_MODE = 66] = "KANA_MODE", A[A.NON_CONVERT = 67] = "NON_CONVERT", A[A.DELETE = 68] = "DELETE", A[A.END = 69] = "END", A[A.HELP = 70] = "HELP", A[A.HOME = 71] = "HOME", A[A.INSERT = 72] = "INSERT", A[A.PAGE_DOWN = 73] = "PAGE_DOWN", A[A.PAGE_UP = 74] = "PAGE_UP", A[A.DOWN = 75] = "DOWN", A[A.LEFT = 76] = "LEFT", A[A.RIGHT = 77] = "RIGHT", A[A.UP = 78] = "UP", A[A.NUM_LOCK = 79] = "NUM_LOCK", A[A.KP_0 = 80] = "KP_0", A[A.KP_1 = 81] = "KP_1", A[A.KP_2 = 82] = "KP_2", A[A.KP_3 = 83] = "KP_3", A[A.KP_4 = 84] = "KP_4", A[A.KP_5 = 85] = "KP_5", A[A.KP_6 = 86] = "KP_6", A[A.KP_7 = 87] = "KP_7", A[A.KP_8 = 88] = "KP_8", A[A.KP_9 = 89] = "KP_9", A[A.KP_PLUS = 90] = "KP_PLUS", A[A.KP_BACKSPACE = 91] = "KP_BACKSPACE", A[A.KP_CLEAR = 92] = "KP_CLEAR", A[A.KP_CLEAR_ENTRY = 93] = "KP_CLEAR_ENTRY", A[A.KP_COMMA = 94] = "KP_COMMA", A[A.KP_PERIOD = 95] = "KP_PERIOD", A[A.KP_DIVIDE = 96] = "KP_DIVIDE", A[A.KP_ENTER = 97] = "KP_ENTER", A[A.KP_EQUAL = 98] = "KP_EQUAL", A[A.KP_MEMORY_ADD = 99] = "KP_MEMORY_ADD", A[A.KP_MEMORY_CLEAR = 100] = "KP_MEMORY_CLEAR", A[A.KP_MEMORY_RECALL = 101] = "KP_MEMORY_RECALL", A[A.KP_MEMORY_STORE = 102] = "KP_MEMORY_STORE", A[A.KP_MEMORY_SUBTRACT = 103] = "KP_MEMORY_SUBTRACT", A[A.KP_MULTIPLY = 104] = "KP_MULTIPLY", A[A.KP_PAREN_LEFT = 105] = "KP_PAREN_LEFT", A[A.KP_PAREN_RIGHT = 106] = "KP_PAREN_RIGHT", A[A.KP_MINUS = 107] = "KP_MINUS", A[A.KP_SEPARATOR = 108] = "KP_SEPARATOR", A[A.NUMPAD_UP = 109] = "NUMPAD_UP", A[A.NUMPAD_DOWN = 110] = "NUMPAD_DOWN", A[A.NUMPAD_RIGHT = 111] = "NUMPAD_RIGHT", A[A.NUMPAD_LEFT = 112] = "NUMPAD_LEFT", A[A.NUMPAD_BEGIN = 113] = "NUMPAD_BEGIN", A[A.NUMPAD_HOME = 114] = "NUMPAD_HOME", A[A.NUMPAD_END = 115] = "NUMPAD_END", A[A.NUMPAD_INSERT = 116] = "NUMPAD_INSERT", A[A.NUMPAD_DELETE = 117] = "NUMPAD_DELETE", A[A.NUMPAD_PAGE_UP = 118] = "NUMPAD_PAGE_UP", A[A.NUMPAD_PAGE_DOWN = 119] = "NUMPAD_PAGE_DOWN", A[A.ESCAPE = 120] = "ESCAPE", A[A.F1 = 121] = "F1", A[A.F2 = 122] = "F2", A[A.F3 = 123] = "F3", A[A.F4 = 124] = "F4", A[A.F5 = 125] = "F5", A[A.F6 = 126] = "F6", A[A.F7 = 127] = "F7", A[A.F8 = 128] = "F8", A[A.F9 = 129] = "F9", A[A.F10 = 130] = "F10", A[A.F11 = 131] = "F11", A[A.F12 = 132] = "F12", A[A.F13 = 133] = "F13", A[A.F14 = 134] = "F14", A[A.F15 = 135] = "F15", A[A.F16 = 136] = "F16", A[A.F17 = 137] = "F17", A[A.F18 = 138] = "F18", A[A.F19 = 139] = "F19", A[A.F20 = 140] = "F20", A[A.F21 = 141] = "F21", A[A.F22 = 142] = "F22", A[A.F23 = 143] = "F23", A[A.F24 = 144] = "F24", A[A.F25 = 145] = "F25", A[A.FN_LOCK = 146] = "FN_LOCK", A[A.PRINT_SCREEN = 147] = "PRINT_SCREEN", A[A.SCROLL_LOCK = 148] = "SCROLL_LOCK", A[A.PAUSE = 149] = "PAUSE", A[A.BROWSER_BACK = 150] = "BROWSER_BACK", A[A.BROWSER_FAVORITES = 151] = "BROWSER_FAVORITES", A[A.BROWSER_FORWARD = 152] = "BROWSER_FORWARD", A[A.BROWSER_HOME = 153] = "BROWSER_HOME", A[A.BROWSER_REFRESH = 154] = "BROWSER_REFRESH", A[A.BROWSER_SEARCH = 155] = "BROWSER_SEARCH", A[A.BROWSER_STOP = 156] = "BROWSER_STOP", A[A.EJECT = 157] = "EJECT", A[A.LAUNCH_APP_1 = 158] = "LAUNCH_APP_1", A[A.LAUNCH_APP_2 = 159] = "LAUNCH_APP_2", A[A.LAUNCH_MAIL = 160] = "LAUNCH_MAIL", A[A.MEDIA_PLAY_PAUSE = 161] = "MEDIA_PLAY_PAUSE", A[A.MEDIA_SELECT = 162] = "MEDIA_SELECT", A[A.MEDIA_STOP = 163] = "MEDIA_STOP", A[A.MEDIA_TRACK_NEXT = 164] = "MEDIA_TRACK_NEXT", A[A.MEDIA_TRACK_PREVIOUS = 165] = "MEDIA_TRACK_PREVIOUS", A[A.POWER = 166] = "POWER", A[A.SLEEP = 167] = "SLEEP", A[A.AUDIO_VOLUME_DOWN = 168] = "AUDIO_VOLUME_DOWN", A[A.AUDIO_VOLUME_MUTE = 169] = "AUDIO_VOLUME_MUTE", A[A.AUDIO_VOLUME_UP = 170] = "AUDIO_VOLUME_UP", A[A.WAKE_UP = 171] = "WAKE_UP", A[A.COPY = 172] = "COPY", A[A.CUT = 173] = "CUT", A[A.PASTE = 174] = "PASTE", A))(h || {}), P = /* @__PURE__ */ ((A) => (A[A.NONE = 0] = "NONE", A[A.SHIFT = 1] = "SHIFT", A[A.CTRL = 2] = "CTRL", A[A.ALT = 4] = "ALT", A[A.SUPER = 8] = "SUPER", A[A.CAPSLOCK = 16] = "CAPSLOCK", A[A.NUMLOCK = 32] = "NUMLOCK", A))(P || {}), iB = /* @__PURE__ */ ((A) => (A[A.NONE = 0] = "NONE", A[A.PARTIAL = 1] = "PARTIAL", A[A.FULL = 2] = "FULL", A))(iB || {}), d = /* @__PURE__ */ ((A) => (A[A.COLS = 1] = "COLS", A[A.ROWS = 2] = "ROWS", A[A.DIRTY = 3] = "DIRTY", A[A.ROW_ITERATOR = 4] = "ROW_ITERATOR", A[A.COLOR_BACKGROUND = 5] = "COLOR_BACKGROUND", A[A.COLOR_FOREGROUND = 6] = "COLOR_FOREGROUND", A[A.COLOR_CURSOR = 7] = "COLOR_CURSOR", A[A.COLOR_CURSOR_HAS_VALUE = 8] = "COLOR_CURSOR_HAS_VALUE", A[A.COLOR_PALETTE = 9] = "COLOR_PALETTE", A[A.CURSOR_VISUAL_STYLE = 10] = "CURSOR_VISUAL_STYLE", A[A.CURSOR_VISIBLE = 11] = "CURSOR_VISIBLE", A[A.CURSOR_BLINKING = 12] = "CURSOR_BLINKING", A[A.CURSOR_PASSWORD_INPUT = 13] = "CURSOR_PASSWORD_INPUT", A[A.CURSOR_VIEWPORT_HAS_VALUE = 14] = "CURSOR_VIEWPORT_HAS_VALUE", A[A.CURSOR_VIEWPORT_X = 15] = "CURSOR_VIEWPORT_X", A[A.CURSOR_VIEWPORT_Y = 16] = "CURSOR_VIEWPORT_Y", A[A.CURSOR_VIEWPORT_WIDE_TAIL = 17] = "CURSOR_VIEWPORT_WIDE_TAIL", A))(d || {}), vI = /* @__PURE__ */ ((A) => (A[A.DIRTY = 0] = "DIRTY", A))(vI || {}), ZB = /* @__PURE__ */ ((A) => (A[A.BAR = 0] = "BAR", A[A.BLOCK = 1] = "BLOCK", A[A.UNDERLINE = 2] = "UNDERLINE", A[A.BLOCK_HOLLOW = 3] = "BLOCK_HOLLOW", A))(ZB || {}), iA = /* @__PURE__ */ ((A) => (A[A.COLS = 1] = "COLS", A[A.ROWS = 2] = "ROWS", A[A.CURSOR_X = 3] = "CURSOR_X", A[A.CURSOR_Y = 4] = "CURSOR_Y", A[A.CURSOR_PENDING_WRAP = 5] = "CURSOR_PENDING_WRAP", A[A.ACTIVE_SCREEN = 6] = "ACTIVE_SCREEN", A[A.CURSOR_VISIBLE = 7] = "CURSOR_VISIBLE", A[A.KITTY_KEYBOARD_FLAGS = 8] = "KITTY_KEYBOARD_FLAGS", A[A.SCROLLBAR = 9] = "SCROLLBAR", A[A.CURSOR_STYLE = 10] = "CURSOR_STYLE", A[A.MOUSE_TRACKING = 11] = "MOUSE_TRACKING", A[A.TITLE = 12] = "TITLE", A[A.PWD = 13] = "PWD", A[A.TOTAL_ROWS = 14] = "TOTAL_ROWS", A[A.SCROLLBACK_ROWS = 15] = "SCROLLBACK_ROWS", A[A.WIDTH_PX = 16] = "WIDTH_PX", A[A.HEIGHT_PX = 17] = "HEIGHT_PX", A[A.COLOR_FOREGROUND = 18] = "COLOR_FOREGROUND", A[A.COLOR_BACKGROUND = 19] = "COLOR_BACKGROUND", A[A.COLOR_CURSOR = 20] = "COLOR_CURSOR", A[A.COLOR_PALETTE = 21] = "COLOR_PALETTE", A[A.COLOR_FOREGROUND_DEFAULT = 22] = "COLOR_FOREGROUND_DEFAULT", A[A.COLOR_BACKGROUND_DEFAULT = 23] = "COLOR_BACKGROUND_DEFAULT", A[A.COLOR_CURSOR_DEFAULT = 24] = "COLOR_CURSOR_DEFAULT", A[A.COLOR_PALETTE_DEFAULT = 25] = "COLOR_PALETTE_DEFAULT", A[A.KITTY_IMAGE_STORAGE_LIMIT = 26] = "KITTY_IMAGE_STORAGE_LIMIT", A[A.KITTY_GRAPHICS = 30] = "KITTY_GRAPHICS", A))(iA || {}), AA = /* @__PURE__ */ ((A) => (A[A.USERDATA = 0] = "USERDATA", A[A.WRITE_PTY = 1] = "WRITE_PTY", A[A.BELL = 2] = "BELL", A[A.ENQUIRY = 3] = "ENQUIRY", A[A.XTVERSION = 4] = "XTVERSION", A[A.TITLE_CHANGED = 5] = "TITLE_CHANGED", A[A.SIZE = 6] = "SIZE", A[A.COLOR_FOREGROUND = 11] = "COLOR_FOREGROUND", A[A.COLOR_BACKGROUND = 12] = "COLOR_BACKGROUND", A[A.COLOR_CURSOR = 13] = "COLOR_CURSOR", A[A.COLOR_PALETTE = 14] = "COLOR_PALETTE", A[A.KITTY_IMAGE_STORAGE_LIMIT = 15] = "KITTY_IMAGE_STORAGE_LIMIT", A))(AA || {}), PI = /* @__PURE__ */ ((A) => (A[A.USERDATA = 0] = "USERDATA", A[A.DECODE_PNG = 1] = "DECODE_PNG", A[A.LOG = 2] = "LOG", A))(PI || {}), VI = /* @__PURE__ */ ((A) => (A[A.PLACEMENT_ITERATOR = 1] = "PLACEMENT_ITERATOR", A))(VI || {}), zB = /* @__PURE__ */ ((A) => (A[A.IMAGE_ID = 1] = "IMAGE_ID", A[A.PLACEMENT_ID = 2] = "PLACEMENT_ID", A[A.IS_VIRTUAL = 3] = "IS_VIRTUAL", A[A.X_OFFSET = 4] = "X_OFFSET", A[A.Y_OFFSET = 5] = "Y_OFFSET", A[A.SOURCE_X = 6] = "SOURCE_X", A[A.SOURCE_Y = 7] = "SOURCE_Y", A[A.SOURCE_WIDTH = 8] = "SOURCE_WIDTH", A[A.SOURCE_HEIGHT = 9] = "SOURCE_HEIGHT", A[A.COLUMNS = 10] = "COLUMNS", A[A.ROWS = 11] = "ROWS", A[A.Z = 12] = "Z", A))(zB || {}), kA = /* @__PURE__ */ ((A) => (A[A.ID = 1] = "ID", A[A.NUMBER = 2] = "NUMBER", A[A.WIDTH = 3] = "WIDTH", A[A.HEIGHT = 4] = "HEIGHT", A[A.FORMAT = 5] = "FORMAT", A[A.COMPRESSION = 6] = "COMPRESSION", A[A.DATA_PTR = 7] = "DATA_PTR", A[A.DATA_LEN = 8] = "DATA_LEN", A))(kA || {}), RA = /* @__PURE__ */ ((A) => (A[A.RGB = 0] = "RGB", A[A.RGBA = 1] = "RGBA", A[A.PNG = 2] = "PNG", A[A.GRAY_ALPHA = 3] = "GRAY_ALPHA", A[A.GRAY = 4] = "GRAY", A))(RA || {});
const QB = 48;
var _I = /* @__PURE__ */ ((A) => (A[A.PRIMARY = 0] = "PRIMARY", A[A.ALTERNATE = 1] = "ALTERNATE", A))(_I || {}), oA = /* @__PURE__ */ ((A) => (A[A.DIRTY = 1] = "DIRTY", A[A.RAW = 2] = "RAW", A[A.CELLS = 3] = "CELLS", A))(oA || {}), $I = /* @__PURE__ */ ((A) => (A[A.DIRTY = 0] = "DIRTY", A))($I || {}), V = /* @__PURE__ */ ((A) => (A[A.RAW = 1] = "RAW", A[A.STYLE = 2] = "STYLE", A[A.GRAPHEMES_LEN = 3] = "GRAPHEMES_LEN", A[A.GRAPHEMES_BUF = 4] = "GRAPHEMES_BUF", A[A.BG_COLOR = 5] = "BG_COLOR", A[A.FG_COLOR = 6] = "FG_COLOR", A))(V || {}), WB = /* @__PURE__ */ ((A) => (A[A.WRAP = 1] = "WRAP", A[A.WRAP_CONTINUATION = 2] = "WRAP_CONTINUATION", A[A.GRAPHEME = 3] = "GRAPHEME", A[A.STYLED = 4] = "STYLED", A[A.HYPERLINK = 5] = "HYPERLINK", A))(WB || {}), KA = /* @__PURE__ */ ((A) => (A[A.ACTIVE = 0] = "ACTIVE", A[A.VIEWPORT = 1] = "VIEWPORT", A[A.SCREEN = 2] = "SCREEN", A[A.HISTORY = 3] = "HISTORY", A))(KA || {}), MA = /* @__PURE__ */ ((A) => (A[A.CODEPOINT = 1] = "CODEPOINT", A[A.CONTENT_TAG = 2] = "CONTENT_TAG", A[A.WIDE = 3] = "WIDE", A[A.HAS_TEXT = 4] = "HAS_TEXT", A[A.HAS_STYLING = 5] = "HAS_STYLING", A[A.STYLE_ID = 6] = "STYLE_ID", A[A.HAS_HYPERLINK = 7] = "HAS_HYPERLINK", A[A.PROTECTED = 8] = "PROTECTED", A[A.SEMANTIC_CONTENT = 9] = "SEMANTIC_CONTENT", A[A.COLOR_PALETTE = 10] = "COLOR_PALETTE", A[A.COLOR_RGB = 11] = "COLOR_RGB", A))(MA || {}), wA = /* @__PURE__ */ ((A) => (A[A.NARROW = 0] = "NARROW", A[A.WIDE = 1] = "WIDE", A[A.SPACER_TAIL = 2] = "SPACER_TAIL", A[A.SPACER_HEAD = 3] = "SPACER_HEAD", A))(wA || {});
function BI(A, g) {
  return A & 32767 | (g ? 32768 : 0);
}
var l = /* @__PURE__ */ ((A) => (A[A.BOLD = 1] = "BOLD", A[A.ITALIC = 2] = "ITALIC", A[A.UNDERLINE = 4] = "UNDERLINE", A[A.STRIKETHROUGH = 8] = "STRIKETHROUGH", A[A.INVERSE = 16] = "INVERSE", A[A.INVISIBLE = 32] = "INVISIBLE", A[A.BLINK = 64] = "BLINK", A[A.FAINT = 128] = "FAINT", A))(l || {});
const oi = new Uint8Array([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  24,
  3,
  96,
  4,
  127,
  127,
  127,
  127,
  0,
  96,
  3,
  127,
  127,
  127,
  1,
  127,
  96,
  5,
  127,
  127,
  127,
  127,
  127,
  1,
  127,
  2,
  54,
  3,
  3,
  101,
  110,
  118,
  12,
  119,
  114,
  105,
  116,
  101,
  95,
  112,
  116,
  121,
  95,
  99,
  98,
  0,
  0,
  3,
  101,
  110,
  118,
  7,
  115,
  105,
  122,
  101,
  95,
  99,
  98,
  0,
  1,
  3,
  101,
  110,
  118,
  13,
  100,
  101,
  99,
  111,
  100,
  101,
  95,
  112,
  110,
  103,
  95,
  99,
  98,
  0,
  2,
  3,
  4,
  3,
  0,
  1,
  2,
  7,
  45,
  3,
  13,
  119,
  114,
  105,
  116,
  101,
  95,
  112,
  116,
  121,
  95,
  102,
  119,
  100,
  0,
  3,
  8,
  115,
  105,
  122,
  101,
  95,
  102,
  119,
  100,
  0,
  4,
  14,
  100,
  101,
  99,
  111,
  100,
  101,
  95,
  112,
  110,
  103,
  95,
  102,
  119,
  100,
  0,
  5,
  10,
  40,
  3,
  12,
  0,
  32,
  0,
  32,
  1,
  32,
  2,
  32,
  3,
  16,
  0,
  11,
  10,
  0,
  32,
  0,
  32,
  1,
  32,
  2,
  16,
  1,
  11,
  14,
  0,
  32,
  0,
  32,
  1,
  32,
  2,
  32,
  3,
  32,
  4,
  16,
  2,
  11
]);
let fB = null;
function wi(A, g, B) {
  fB || (fB = new WebAssembly.Module(oi));
  const I = new WebAssembly.Instance(fB, {
    env: {
      write_pty_cb: A,
      size_cb: g,
      decode_png_cb: B
    }
  });
  return {
    writePtyFwd: I.exports.write_pty_fwd,
    sizeFwd: I.exports.size_fwd,
    decodePngFwd: I.exports.decode_png_fwd
  };
}
class pA {
  constructor(g) {
    this.exports = g.exports, this.memory = this.exports.memory;
  }
  createKeyEncoder() {
    return new Di(this.exports);
  }
  createTerminal(g = 80, B = 24, I) {
    return new si(this.exports, this.memory, g, B, I);
  }
  static async load(g) {
    if (g)
      return pA.loadFromPath(g);
    const B = new URL("./ghostty-vt.wasm", self.location), I = [];
    if (B.protocol === "file:") {
      let C = B.pathname;
      C.match(/^\/[A-Za-z]:\//) && (C = C.slice(1)), I.push(C);
    }
    I.push(B.href, "./ghostty-vt.wasm", "/ghostty-vt.wasm");
    let Q = null;
    for (const C of I)
      try {
        return await pA.loadFromPath(C);
      } catch (E) {
        Q = E instanceof Error ? E : new Error(String(E));
      }
    throw Q || new Error("Failed to load Ghostty WASM");
  }
  static async loadFromPath(g) {
    let B;
    if (typeof Bun < "u" && typeof Bun.file == "function")
      try {
        const C = Bun.file(g);
        await C.exists() && (B = await C.arrayBuffer());
      } catch {
      }
    if (!B)
      try {
        const E = await ((await Promise.reject(new Error("no node shim")))).readFile(g);
        B = E.buffer.slice(E.byteOffset, E.byteOffset + E.byteLength);
      } catch {
      }
    if (!B) {
      const C = await fetch(g);
      if (!C.ok)
        throw new Error(`Failed to fetch WASM: ${C.status} ${C.statusText}`);
      if (B = await C.arrayBuffer(), B.byteLength === 0)
        throw new Error(`WASM file is empty (0 bytes). Check path: ${g}`);
    }
    if (!B)
      throw new Error(`Could not load WASM from path: ${g}`);
    const I = await WebAssembly.compile(B), Q = await WebAssembly.instantiate(I, {
      env: {
        log: (C, E) => {
          const i = new Uint8Array(
            Q.exports.memory.buffer,
            C,
            E
          );
          console.log("[ghostty-vt]", new TextDecoder().decode(i));
        }
      }
    });
    return new pA(Q);
  }
}
class Di {
  constructor(g) {
    this.encoder = 0, this.exports = g;
    const B = this.exports.ghostty_wasm_alloc_opaque(), I = this.exports.ghostty_key_encoder_new(0, B);
    if (I !== 0)
      throw new Error(`Failed to create key encoder: ${I}`);
    const Q = new DataView(this.exports.memory.buffer);
    this.encoder = Q.getUint32(B, !0), this.exports.ghostty_wasm_free_opaque(B);
  }
  setOption(g, B) {
    const I = this.exports.ghostty_wasm_alloc_u8();
    new DataView(this.exports.memory.buffer).setUint8(I, typeof B == "boolean" ? B ? 1 : 0 : B), this.exports.ghostty_key_encoder_setopt(this.encoder, g, I), this.exports.ghostty_wasm_free_u8(I);
  }
  setKittyFlags(g) {
    this.setOption(Cg.KITTY_KEYBOARD_FLAGS, g);
  }
  encode(g) {
    const B = this.exports.ghostty_wasm_alloc_opaque(), I = this.exports.ghostty_key_event_new(0, B);
    if (I !== 0)
      throw new Error(`Failed to create key event: ${I}`);
    const Q = new DataView(this.exports.memory.buffer), C = Q.getUint32(B, !0);
    if (this.exports.ghostty_wasm_free_opaque(B), this.exports.ghostty_key_event_set_action(C, g.action), this.exports.ghostty_key_event_set_key(C, g.key), this.exports.ghostty_key_event_set_mods(C, g.mods), g.utf8) {
      const s = new TextEncoder().encode(g.utf8), a = this.exports.ghostty_wasm_alloc_u8_array(s.length);
      new Uint8Array(this.exports.memory.buffer).set(s, a), this.exports.ghostty_key_event_set_utf8(C, a, s.length), this.exports.ghostty_wasm_free_u8_array(a, s.length);
    }
    const E = 32, i = this.exports.ghostty_wasm_alloc_u8_array(E), D = this.exports.ghostty_wasm_alloc_usize(), o = this.exports.ghostty_key_encoder_encode(
      this.encoder,
      C,
      i,
      E,
      D
    );
    if (o !== 0)
      throw this.exports.ghostty_wasm_free_u8_array(i, E), this.exports.ghostty_wasm_free_usize(D), this.exports.ghostty_key_event_free(C), new Error(`Failed to encode key: ${o}`);
    const w = Q.getUint32(D, !0), t = new Uint8Array(this.exports.memory.buffer, i, w).slice();
    return this.exports.ghostty_wasm_free_u8_array(i, E), this.exports.ghostty_wasm_free_usize(D), this.exports.ghostty_key_event_free(C), t;
  }
  dispose() {
    this.encoder && (this.exports.ghostty_key_encoder_free(this.encoder), this.encoder = 0);
  }
}
const AQ = class vB {
  constructor(g, B, I = 80, Q = 24, C) {
    this.renderHandle = 0, this.rowIter = 0, this.rowCells = 0, this.cellPool = [], this.cellWidthPx = 0, this.cellHeightPx = 0, this.rowDirtyCache = null, this.rowWrapCache = null, this.pendingResponses = [], this.exports = g, this.memory = B, this._cols = I, this._rows = Q;
    const E = 8, i = this.exports.ghostty_wasm_alloc_u8_array(E);
    if (i === 0)
      throw new Error("Failed to allocate terminal options");
    const D = this.exports.ghostty_wasm_alloc_opaque();
    if (D === 0)
      throw this.exports.ghostty_wasm_free_u8_array(i, E), new Error("Failed to allocate terminal handle");
    try {
      const o = new DataView(this.memory.buffer, i, E);
      o.setUint16(0, I, !0), o.setUint16(2, Q, !0), o.setUint32(4, (C == null ? void 0 : C.scrollbackLimit) ?? 1e4, !0);
      const w = this.exports.ghostty_terminal_new(0, D, i);
      if (w !== 0)
        throw new Error(`ghostty_terminal_new failed: ${w}`);
      this.handle = new DataView(this.memory.buffer).getUint32(D, !0);
    } finally {
      this.exports.ghostty_wasm_free_u8_array(i, E), this.exports.ghostty_wasm_free_opaque(D);
    }
    if (!this.handle)
      throw new Error("Failed to create terminal");
    try {
      this.installCallbacks(), C && this.applyConfig(C), this.exports.ghostty_terminal_mode_set(this.handle, BI(2027, !1), !0), this.setKittyImageStorageLimit(64 * 1024 * 1024);
    } catch (o) {
      throw this.cleanupOnConstructorFailure(), o;
    }
    this.renderHandle = this.allocOpaqueOrFail(
      "ghostty_render_state_new",
      (o) => this.exports.ghostty_render_state_new(0, o)
    ), this.rowIter = this.allocOpaqueOrFail(
      "ghostty_render_state_row_iterator_new",
      (o) => this.exports.ghostty_render_state_row_iterator_new(0, o)
    ), this.rowCells = this.allocOpaqueOrFail(
      "ghostty_render_state_row_cells_new",
      (o) => this.exports.ghostty_render_state_row_cells_new(0, o)
    ), this.initCellPool();
  }
  /**
   * Allocate an opaque handle through one of the new(allocator, *outHandle)
   * factory functions. Wraps the boilerplate of: alloc out-pointer, call
   * factory, check Result, read the handle, free out-pointer.
   *
   * If the factory call fails, frees any already-acquired terminal/render
   * resources so the caller-throwing flow doesn't leak across the partially
   * constructed object.
   */
  allocOpaqueOrFail(g, B) {
    const I = this.exports.ghostty_wasm_alloc_opaque();
    if (I === 0)
      throw this.cleanupOnConstructorFailure(), new Error(`Failed to allocate handle for ${g}`);
    try {
      const Q = B(I);
      if (Q !== 0)
        throw this.cleanupOnConstructorFailure(), new Error(`${g} failed: ${Q}`);
      return new DataView(this.memory.buffer).getUint32(I, !0);
    } finally {
      this.exports.ghostty_wasm_free_opaque(I);
    }
  }
  /**
   * Apply user-supplied colors + palette overrides to the freshly-created
   * terminal via ghostty_terminal_set(COLOR_*).
   *
   * For the palette: the new C ABI takes a full 256-entry array, but coder's
   * config carries only the legacy 16 ANSI entries (each as a 0xRRGGBB int,
   * 0 meaning "use default"). To preserve indices ≥16 we read the existing
   * default palette first, overlay the non-zero entries from config, and
   * write the merged 768-byte buffer back.
   */
  applyConfig(g) {
    if (g.fgColor && this.setColorOption(AA.COLOR_FOREGROUND, g.fgColor), g.bgColor && this.setColorOption(AA.COLOR_BACKGROUND, g.bgColor), g.cursorColor && this.setColorOption(AA.COLOR_CURSOR, g.cursorColor), g.palette && g.palette.some((B) => B !== 0)) {
      const I = this.exports.ghostty_wasm_alloc_u8_array(768);
      try {
        this.exports.ghostty_terminal_get(
          this.handle,
          iA.COLOR_PALETTE_DEFAULT,
          I
        ) !== 0 && new Uint8Array(this.memory.buffer, I, 768).fill(0);
        const C = new Uint8Array(this.memory.buffer, I, 768), E = Math.min(g.palette.length, 16);
        for (let i = 0; i < E; i++) {
          const D = g.palette[i];
          D !== 0 && (C[i * 3 + 0] = D >> 16 & 255, C[i * 3 + 1] = D >> 8 & 255, C[i * 3 + 2] = D & 255);
        }
        this.exports.ghostty_terminal_set(this.handle, AA.COLOR_PALETTE, I), this.__sipViewportValid = !1;
      } finally {
        this.exports.ghostty_wasm_free_u8_array(I, 768);
      }
    }
  }
  setColorOption(g, B) {
    const I = this.exports.ghostty_wasm_alloc_u8_array(3), Q = new Uint8Array(this.memory.buffer, I, 3);
    Q[0] = B >> 16 & 255, Q[1] = B >> 8 & 255, Q[2] = B & 255, this.exports.ghostty_terminal_set(this.handle, g, I), this.exports.ghostty_wasm_free_u8_array(I, 3), this.__sipViewportValid = !1;
  }
  /**
   * Release any resources that have been allocated by the constructor up to
   * this point. Called when a subsequent step fails so we don't leak handles
   * before the throw propagates.
   */
  cleanupOnConstructorFailure() {
    this.callbackRegistry && (this.callbackRegistry.instancesByHandle.delete(this.handle), this.callbackRegistry = void 0), this.rowCells && (this.exports.ghostty_render_state_row_cells_free(this.rowCells), this.rowCells = 0), this.rowIter && (this.exports.ghostty_render_state_row_iterator_free(this.rowIter), this.rowIter = 0), this.renderHandle && (this.exports.ghostty_render_state_free(this.renderHandle), this.renderHandle = 0), this.handle && this.exports.ghostty_terminal_free(this.handle);
  }
  // ==========================================================================
  // RenderState scratch helpers
  //
  // The new render-state API exposes a single ghostty_render_state_get(state,
  // key, *out) entry point keyed by GhosttyRenderStateData. Each helper
  // allocates a small scratch buffer of the right size, performs the read,
  // and frees. Per-call allocation is intentionally simple; if profiling
  // shows it's hot, we can replace these with a single reusable scratch
  // buffer carved up by offset.
  // ==========================================================================
  rsGetU8(g) {
    const B = this.exports.ghostty_wasm_alloc_u8();
    this.exports.ghostty_render_state_get(this.renderHandle, g, B);
    const I = new DataView(this.memory.buffer).getUint8(B);
    return this.exports.ghostty_wasm_free_u8(B), I;
  }
  rsGetU16(g) {
    const B = this.exports.ghostty_wasm_alloc_u8_array(2);
    this.exports.ghostty_render_state_get(this.renderHandle, g, B);
    const I = new DataView(this.memory.buffer).getUint16(B, !0);
    return this.exports.ghostty_wasm_free_u8_array(B, 2), I;
  }
  rsGetU32(g) {
    const B = this.exports.ghostty_wasm_alloc_u8_array(4);
    this.exports.ghostty_render_state_get(this.renderHandle, g, B);
    const I = new DataView(this.memory.buffer).getUint32(B, !0);
    return this.exports.ghostty_wasm_free_u8_array(B, 4), I;
  }
  rsGetRgb(g) {
    const B = this.exports.ghostty_wasm_alloc_u8_array(3);
    this.exports.ghostty_render_state_get(this.renderHandle, g, B);
    const I = new Uint8Array(this.memory.buffer, B, 3), Q = { r: I[0], g: I[1], b: I[2] };
    return this.exports.ghostty_wasm_free_u8_array(B, 3), Q;
  }
  // ==========================================================================
  // Terminal property scratch helpers
  //
  // Same pattern as rsGet* but against ghostty_terminal_get(terminal, key,
  // *out). The TerminalData enum encodes the value type; pick the matching
  // helper by output size.
  // ==========================================================================
  tGetU8(g) {
    const B = this.exports.ghostty_wasm_alloc_u8();
    this.exports.ghostty_terminal_get(this.handle, g, B);
    const I = new DataView(this.memory.buffer).getUint8(B);
    return this.exports.ghostty_wasm_free_u8(B), I;
  }
  tGetU32(g) {
    const B = this.exports.ghostty_wasm_alloc_u8_array(4);
    this.exports.ghostty_terminal_get(this.handle, g, B);
    const I = new DataView(this.memory.buffer).getUint32(B, !0);
    return this.exports.ghostty_wasm_free_u8_array(B, 4), I;
  }
  get cols() {
    return this._cols;
  }
  get rows() {
    return this._rows;
  }
  // ==========================================================================
  // Lifecycle
  // ==========================================================================
  write(g) {
    const B = typeof g == "string" ? new TextEncoder().encode(g) : g, I = this.exports.ghostty_wasm_alloc_u8_array(B.length);
    new Uint8Array(this.memory.buffer).set(B, I), this.exports.ghostty_terminal_vt_write(this.handle, I, B.length), this.exports.ghostty_wasm_free_u8_array(I, B.length), this.__sipViewportValid = !1;
  }
  resize(g, B) {
    g === this._cols && B === this._rows || (this.__sipViewportValid = !1, this._cols = g, this._rows = B, this.exports.ghostty_terminal_resize(
      this.handle,
      g,
      B,
      this.cellWidthPx,
      this.cellHeightPx
    ), this.initCellPool());
  }
  /**
   * Set the maximum bytes of image data the terminal will retain across
   * all kitty graphics images. Zero disables kitty graphics entirely
   * (transmissions will be parsed and dropped). Set this BEFORE any
   * image-bearing data is written to the terminal — there's no
   * retroactive recovery of dropped images.
   *
   * Input is uint64_t* on the C side, so we use a u32-pair little-endian
   * write to keep the byte count exact even past 4GB (probably overkill
   * but free).
   */
  setKittyImageStorageLimit(g) {
    const B = this.exports.ghostty_wasm_alloc_u8_array(8), I = new DataView(this.memory.buffer), Q = g >>> 0, C = Math.floor(g / 4294967296) >>> 0;
    I.setUint32(B + 0, Q, !0), I.setUint32(B + 4, C, !0), this.exports.ghostty_terminal_set(this.handle, AA.KITTY_IMAGE_STORAGE_LIMIT, B), this.exports.ghostty_wasm_free_u8_array(B, 8);
  }
  // ==========================================================================
  // Kitty graphics — placement iteration + image data lookup.
  //
  // The renderer calls these per frame: iterate visible placements, look up
  // pixel data for each, composite onto the canvas. All handles returned
  // here (storage, image) are borrowed from the terminal and invalidated by
  // ANY mutating terminal call (vt_write, resize, reset, ...).
  // Callers must finish any read/copy before the next mutation.
  // ==========================================================================
  /**
   * Get the kitty graphics storage handle for the active screen, or null
   * if storage is disabled or no images are stored. Cheap to call; returns
   * a borrowed pointer.
   */
  getKittyGraphics() {
    const g = this.exports.ghostty_wasm_alloc_u8_array(4);
    try {
      if (this.exports.ghostty_terminal_get(this.handle, iA.KITTY_GRAPHICS, g) !== 0)
        return null;
      const I = new DataView(this.memory.buffer).getUint32(g, !0);
      return I === 0 ? null : I;
    } finally {
      this.exports.ghostty_wasm_free_u8_array(g, 4);
    }
  }
  /**
   * Iterate placements in the active screen, yielding render-ready info
   * for each. The optional `onlyVisible` flag (default true) drops
   * placements that don't intersect the viewport — most renderers want
   * this. Use `false` if you need to track invalidated regions for
   * partial damage.
   *
   * Internally this uses the upstream placement iterator + the one-shot
   * placement_render_info call (fills 12 fields in one WASM crossing
   * instead of 5 separate getters).
   */
  *iterPlacements(g, B = !0) {
    const I = this.exports.ghostty_wasm_alloc_opaque();
    if (I === 0)
      return;
    let Q = 0;
    try {
      if (this.exports.ghostty_kitty_graphics_placement_iterator_new(0, I) !== 0 || (Q = new DataView(this.memory.buffer).getUint32(I, !0), Q === 0))
        return;
      const E = this.exports.ghostty_wasm_alloc_u8_array(4);
      try {
        new DataView(this.memory.buffer).setUint32(E, Q, !0), this.exports.ghostty_kitty_graphics_get(
          g,
          VI.PLACEMENT_ITERATOR,
          E
        );
      } finally {
        this.exports.ghostty_wasm_free_u8_array(E, 4);
      }
      const i = this.exports.ghostty_wasm_alloc_u8_array(4), D = this.exports.ghostty_wasm_alloc_u8_array(QB);
      new DataView(this.memory.buffer).setUint32(D, QB, !0);
      try {
        for (; this.exports.ghostty_kitty_graphics_placement_next(Q); ) {
          this.exports.ghostty_kitty_graphics_placement_get(
            Q,
            zB.IMAGE_ID,
            i
          );
          const o = new DataView(this.memory.buffer).getUint32(i, !0), w = this.exports.ghostty_kitty_graphics_image(g, o);
          if (w === 0 || (new DataView(this.memory.buffer).setUint32(
            D,
            QB,
            !0
          ), this.exports.ghostty_kitty_graphics_placement_render_info(
            Q,
            w,
            this.handle,
            D
          ) !== 0))
            continue;
          this.exports.ghostty_kitty_graphics_placement_get(
            Q,
            zB.IS_VIRTUAL,
            i
            // reuse the 4-byte slot; the value is a bool but written as u8
          );
          const e = new DataView(this.memory.buffer).getUint8(i) !== 0, s = new DataView(this.memory.buffer), a = {
            imageId: o,
            pixelWidth: s.getUint32(D + 4, !0),
            pixelHeight: s.getUint32(D + 8, !0),
            gridCols: s.getUint32(D + 12, !0),
            gridRows: s.getUint32(D + 16, !0),
            viewportCol: s.getInt32(D + 20, !0),
            viewportRow: s.getInt32(D + 24, !0),
            viewportVisible: s.getUint8(D + 28) !== 0,
            sourceX: s.getUint32(D + 32, !0),
            sourceY: s.getUint32(D + 36, !0),
            sourceWidth: s.getUint32(D + 40, !0),
            sourceHeight: s.getUint32(D + 44, !0),
            isVirtual: e
          };
          B && !a.viewportVisible || (yield a);
        }
      } finally {
        this.exports.ghostty_wasm_free_u8_array(i, 4), this.exports.ghostty_wasm_free_u8_array(D, QB);
      }
    } finally {
      Q !== 0 && this.exports.ghostty_kitty_graphics_placement_iterator_free(Q), this.exports.ghostty_wasm_free_opaque(I);
    }
  }
  /**
   * Get the pixel data + metadata for an image by id. Returns null if the
   * image isn't stored or isn't in a format we can hand the renderer
   * directly (RGB / RGBA / GRAY / GRAY_ALPHA).
   *
   * The returned `data` is a borrowed view into WASM memory — copy before
   * the next vt_write if you need to retain. Most callers will turn this
   * into an ImageData / canvas immediately and discard the view.
   */
  getKittyImagePixels(g, B) {
    const I = this.exports.ghostty_kitty_graphics_image(g, B);
    if (I === 0)
      return null;
    const Q = this.exports.ghostty_wasm_alloc_u8_array(4);
    try {
      const C = new DataView(this.memory.buffer), E = (e) => this.exports.ghostty_kitty_graphics_image_get(I, e, Q) !== 0 ? 0 : new DataView(this.memory.buffer).getUint32(Q, !0), i = E(kA.WIDTH), D = E(kA.HEIGHT), o = E(kA.FORMAT), w = E(kA.DATA_PTR), t = E(kA.DATA_LEN);
      return i === 0 || D === 0 || w === 0 || t === 0 ? null : {
        width: i,
        height: D,
        format: o,
        data: new Uint8Array(this.memory.buffer, w, t)
      };
    } finally {
      this.exports.ghostty_wasm_free_u8_array(Q, 4);
    }
  }
  /**
   * Push the renderer's per-cell pixel size into the WASM terminal.
   *
   * The new C ABI doesn't expose a separate "set pixel size" call —
   * dimensions only flow through ghostty_terminal_resize, which takes
   * (cols, rows, cell_width_px, cell_height_px). We cache the cell pixel
   * dims on the instance so subsequent resize() calls keep the values
   * stable, and short-circuit when nothing has changed.
   *
   * The width/height arguments are PER-CELL CSS pixels — matches what
   * the renderer reports via getMetrics(). Coder's old setPixelSize
   * took TOTAL screen pixels (cell_width * cols, cell_height * rows);
   * we renamed to avoid silent value mis-passing.
   *
   * Affects in-band size reports (CSI 14/16/18 t) and kitty graphics
   * placement sizing. Until called, those query paths return zero.
   */
  setCellPixelSize(g, B) {
    const I = Math.max(1, Math.round(g)), Q = Math.max(1, Math.round(B));
    I === this.cellWidthPx && Q === this.cellHeightPx || (this.__sipViewportValid = !1, this.cellWidthPx = I, this.cellHeightPx = Q, this.exports.ghostty_terminal_resize(this.handle, this._cols, this._rows, I, Q));
  }
  free() {
    this.callbackRegistry && this.callbackRegistry.instancesByHandle.delete(this.handle), this.rowCells && (this.exports.ghostty_render_state_row_cells_free(this.rowCells), this.rowCells = 0), this.rowIter && (this.exports.ghostty_render_state_row_iterator_free(this.rowIter), this.rowIter = 0), this.renderHandle && (this.exports.ghostty_render_state_free(this.renderHandle), this.renderHandle = 0), this.exports.ghostty_terminal_free(this.handle);
  }
  // ==========================================================================
  // RenderState API - The key performance optimization
  // ==========================================================================
  /**
   * Update render state from terminal.
   *
   * This syncs the RenderState with the current Terminal state.
   * The dirty state (full/partial/none) is stored in the WASM RenderState
   * and can be queried via isRowDirty(). When dirty==full, isRowDirty()
   * returns true for ALL rows.
   *
   * The WASM layer automatically detects screen switches (normal <-> alternate)
   * and returns FULL dirty state when switching screens (e.g., vim exit).
   *
   * Safe to call multiple times - dirty state persists until markClean().
   */
  update() {
    const g = this.exports.ghostty_render_state_update(this.renderHandle, this.handle);
    if (g !== 0)
      throw new Error(`ghostty_render_state_update failed: ${g}`);
    return this.rowDirtyCache = null, this.rowWrapCache = null, this.rsGetU32(d.DIRTY);
  }
  /**
   * Get cursor state from render state.
   * Calls update() first; safe to call repeatedly within a frame.
   */
  getCursor() {
    this.update();
    const g = this.rsGetU8(d.CURSOR_VIEWPORT_HAS_VALUE) !== 0, B = this.rsGetU8(d.CURSOR_VISIBLE) !== 0, I = this.rsGetU8(d.CURSOR_BLINKING) !== 0, Q = this.rsGetU32(d.CURSOR_VISUAL_STYLE), C = g ? this.rsGetU16(d.CURSOR_VIEWPORT_X) : -1, E = g ? this.rsGetU16(d.CURSOR_VIEWPORT_Y) : -1, i = Q === ZB.BAR ? "bar" : Q === ZB.UNDERLINE ? "underline" : "block";
    return {
      x: Math.max(0, C),
      y: Math.max(0, E),
      viewportX: C,
      viewportY: E,
      visible: B,
      blinking: I,
      style: i
    };
  }
  /**
   * Get default fg/bg/cursor colors from render state.
   */
  getColors() {
    this.update();
    const g = this.rsGetRgb(d.COLOR_BACKGROUND), B = this.rsGetRgb(d.COLOR_FOREGROUND), Q = this.rsGetU8(d.COLOR_CURSOR_HAS_VALUE) !== 0 ? this.rsGetRgb(d.COLOR_CURSOR) : null;
    return { background: g, foreground: B, cursor: Q };
  }
  /**
   * Check if a specific row is dirty.
   *
   * Backed by a per-row cache populated lazily — first call after update()
   * walks the iterator once and reads the dirty flag for each row, then
   * subsequent calls are O(1). getViewport() also populates the cache as a
   * side effect so a typical "update → for-each-row isRowDirty → getViewport"
   * render loop only iterates rows once.
   */
  isRowDirty(g) {
    return g < 0 || g >= this._rows ? !1 : (this.rowDirtyCache === null && this.refreshRowMetaCache(), this.rowDirtyCache[g] ?? !1);
  }
  /**
   * Check if a row is soft-wrapped (continues onto the next row).
   *
   * Same cache discipline as isRowDirty: lazy-populated on first call after
   * update(), or as a side effect of getViewport.
   */
  isRowWrapped(g) {
    return g < 0 || g >= this._rows ? !1 : (this.rowWrapCache === null && this.refreshRowMetaCache(), this.rowWrapCache[g] ?? !1);
  }
  /**
   * Walk the row iterator once and capture per-row dirty + wrap flags.
   *
   * Calls update() first since callers (isRowDirty / isRowWrapped) typically
   * query right after a terminal write, before any explicit render-state
   * refresh has happened. Same idempotency guarantee as getCursor/getColors:
   * if no terminal change occurred since the last update, this is cheap.
   *
   * Reads ROW_DATA_DIRTY directly from the iterator, then ROW_DATA_RAW to
   * obtain the GhosttyRow (u64) needed to call ghostty_row_get(WRAP_*). The
   * row value is only valid for the current iterator position; we read it
   * inline before advancing.
   */
  refreshRowMetaCache() {
    this.update();
    const g = new Array(this._rows).fill(!1), B = new Array(this._rows).fill(!1);
    this.populateHandle(
      (E) => this.exports.ghostty_render_state_get(this.renderHandle, d.ROW_ITERATOR, E),
      this.rowIter
    );
    const I = this.exports.ghostty_wasm_alloc_u8(), Q = this.exports.ghostty_wasm_alloc_u8_array(8), C = this.exports.ghostty_wasm_alloc_u8();
    try {
      let E = 0;
      for (; E < this._rows && this.exports.ghostty_render_state_row_iterator_next(this.rowIter); ) {
        const i = new DataView(this.memory.buffer);
        this.exports.ghostty_render_state_row_get(this.rowIter, oA.DIRTY, I), g[E] = i.getUint8(I) !== 0, this.exports.ghostty_render_state_row_get(this.rowIter, oA.RAW, Q);
        const D = new DataView(this.memory.buffer).getBigUint64(Q, !0);
        this.exports.ghostty_row_get(D, WB.WRAP_CONTINUATION, C), B[E] = new DataView(this.memory.buffer).getUint8(C) !== 0, E++;
      }
    } finally {
      this.exports.ghostty_wasm_free_u8(I), this.exports.ghostty_wasm_free_u8_array(Q, 8), this.exports.ghostty_wasm_free_u8(C);
    }
    this.rowDirtyCache = g, this.rowWrapCache = B;
  }
  /**
   * Mark render state as clean — clears both global and per-row dirty.
   *
   * Per the upstream contract, "setting one dirty state doesn't unset the
   * other." Global dirty is cleared via _set(OPTION_DIRTY, FALSE); per-row
   * dirty is cleared by walking the row iterator and calling _row_set on
   * each. Without the per-row pass, the next update() would still report
   * the old per-row flags as dirty even though the terminal hasn't changed.
   */
  markClean() {
    const g = this.exports.ghostty_wasm_alloc_u8_array(4);
    new DataView(this.memory.buffer).setUint32(g, iB.NONE, !0), this.exports.ghostty_render_state_set(this.renderHandle, vI.DIRTY, g), this.exports.ghostty_wasm_free_u8_array(g, 4), this.populateHandle(
      (I) => this.exports.ghostty_render_state_get(this.renderHandle, d.ROW_ITERATOR, I),
      this.rowIter
    );
    const B = this.exports.ghostty_wasm_alloc_u8();
    for (new DataView(this.memory.buffer).setUint8(B, 0); this.exports.ghostty_render_state_row_iterator_next(this.rowIter); )
      this.exports.ghostty_render_state_row_set(this.rowIter, $I.DIRTY, B);
    this.exports.ghostty_wasm_free_u8(B), this.rowDirtyCache = null, this.__sipViewportValid = !1;
  }
  /**
   * Populate the cellPool from the current render state and return it.
   *
   * The new C ABI replaces coder's single ghostty_render_state_get_viewport()
   * buffer-fill with a row iterator + per-row cells iterator. We allocate
   * both iterators once at construction time and re-populate them per call:
   *
   *   _get(state, ROW_ITERATOR, &rowIter)
   *   while (row_iterator_next(rowIter)) {
   *     _row_get(rowIter, ROW_DATA_CELLS, &rowCells)
   *     while (row_cells_next(rowCells)) {
   *       _row_cells_get(rowCells, GRAPHEMES_LEN, &len)
   *       _row_cells_get(rowCells, GRAPHEMES_BUF, &codepoint)  // if len > 0
   *       _row_cells_get(rowCells, FG_COLOR/BG_COLOR, &rgb)    // INVALID_VALUE if unset
   *     }
   *   }
   *
   * This is intentionally minimal: we capture codepoint + fg/bg only.
   * Style flags, cell width (double-width), and hyperlink IDs are deferred
   * — they require parsing the GhosttyStyle sized struct and the per-cell
   * ghostty_cell_get(WIDE)/HAS_HYPERLINK paths. The cellPool fields keep
   * placeholder defaults (flags=0, width=1, hyperlink_id=0).
   *
   * Performance: ~3-4 WASM crossings per visible cell. For an 80x24 viewport
   * that's ~6k crossings per frame. Profile before optimizing — likely
   * candidates are _row_cells_get_multi for batched reads, or RAW + a
   * cached layout map for direct memory access.
   */
  getViewport() {
    // __sip: per-frame memo. getLine() slices a single row out of a full
    // getViewport() walk, and the render loop calls getLine() once per
    // damaged row, so an unmemoized getViewport made the frame
    // O(rows^2 * cols) wasm crossings. The pool can only go stale on an
    // actual grid mutation, so the memo is invalidated in write(), resize(),
    // setCellPixelSize() and markClean() rather than on a timer.
    if (this.__sipViewportValid)
      return this.rowDirtyCache = this.__sipRowDirtySnap, this.rowWrapCache = this.__sipRowWrapSnap, this.cellPool;
    this.update(), this.zeroCellPool(), this.populateHandle(
      (e) => this.exports.ghostty_render_state_get(this.renderHandle, d.ROW_ITERATOR, e),
      this.rowIter
    );
    const g = 72, B = this.exports.ghostty_wasm_alloc_u8_array(4), I = this.exports.ghostty_wasm_alloc_u8_array(3), Q = this.exports.ghostty_wasm_alloc_u8(), C = this.exports.ghostty_wasm_alloc_u8_array(8), E = this.exports.ghostty_wasm_alloc_u8(), i = this.exports.ghostty_wasm_alloc_u8_array(g);
    new DataView(this.memory.buffer).setUint32(i, g, !0);
    const D = this.exports.ghostty_wasm_alloc_u8_array(8), o = this.exports.ghostty_wasm_alloc_u8_array(4), w = new Array(this._rows).fill(!1), t = new Array(this._rows).fill(!1);
    try {
      let e = 0;
      for (; e < this._rows && this.exports.ghostty_render_state_row_iterator_next(this.rowIter); ) {
        this.exports.ghostty_render_state_row_get(this.rowIter, oA.DIRTY, Q), w[e] = new DataView(this.memory.buffer).getUint8(Q) !== 0, this.exports.ghostty_render_state_row_get(this.rowIter, oA.RAW, C);
        const s = new DataView(this.memory.buffer).getBigUint64(C, !0);
        this.exports.ghostty_row_get(s, WB.WRAP_CONTINUATION, E), t[e] = new DataView(this.memory.buffer).getUint8(E) !== 0, this.populateHandle(
          (k) => this.exports.ghostty_render_state_row_get(this.rowIter, oA.CELLS, k),
          this.rowCells
        );
        let a = 0;
        for (; a < this._cols && this.exports.ghostty_render_state_row_cells_next(this.rowCells); ) {
          const k = this.cellPool[e * this._cols + a];
          this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            V.GRAPHEMES_LEN,
            B
          );
          const N = new DataView(this.memory.buffer).getUint32(B, !0);
          if (k.grapheme_len = N > 0 ? N - 1 : 0, N > 0 ? (this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            V.GRAPHEMES_BUF,
            B
          ), k.codepoint = new DataView(this.memory.buffer).getUint32(B, !0)) : k.codepoint = 0, k.fg_r = k.fg_g = k.fg_b = 0, k.bg_r = k.bg_g = k.bg_b = 0, this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            V.FG_COLOR,
            I
          ) === 0) {
            const G = new Uint8Array(this.memory.buffer, I, 3);
            k.fg_r = G[0], k.fg_g = G[1], k.fg_b = G[2];
          }
          if (this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            V.BG_COLOR,
            I
          ) === 0) {
            const G = new Uint8Array(this.memory.buffer, I, 3);
            k.bg_r = G[0], k.bg_g = G[1], k.bg_b = G[2];
          }
          this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            V.STYLE,
            i
          );
          {
            const G = new Uint8Array(this.memory.buffer, i, g);
            let J = 0;
            G[56] && (J |= l.BOLD), G[57] && (J |= l.ITALIC), G[58] && (J |= l.FAINT), G[59] && (J |= l.BLINK), G[60] && (J |= l.INVERSE), G[61] && (J |= l.INVISIBLE), G[62] && (J |= l.STRIKETHROUGH), new DataView(this.memory.buffer).getInt32(i + 64, !0) !== 0 && (J |= l.UNDERLINE), k.flags = J;
          }
          this.exports.ghostty_render_state_row_cells_get(
            this.rowCells,
            V.RAW,
            D
          );
          const n = new DataView(this.memory.buffer).getBigUint64(D, !0);
          this.exports.ghostty_cell_get(n, MA.WIDE, o);
          const c = new DataView(this.memory.buffer).getUint32(o, !0);
          k.width = c === wA.WIDE ? 2 : c === wA.SPACER_TAIL || c === wA.SPACER_HEAD ? 0 : 1, this.exports.ghostty_cell_get(n, MA.HAS_HYPERLINK, o), k.hyperlink_id = new DataView(this.memory.buffer).getUint8(o) !== 0 ? 1 : 0, a++;
        }
        e++;
      }
    } finally {
      this.exports.ghostty_wasm_free_u8_array(B, 4), this.exports.ghostty_wasm_free_u8_array(I, 3), this.exports.ghostty_wasm_free_u8(Q), this.exports.ghostty_wasm_free_u8_array(C, 8), this.exports.ghostty_wasm_free_u8(E), this.exports.ghostty_wasm_free_u8_array(i, g), this.exports.ghostty_wasm_free_u8_array(D, 8), this.exports.ghostty_wasm_free_u8_array(o, 4);
    }
    return this.rowDirtyCache = w, this.rowWrapCache = t, this.__sipRowDirtySnap = w, this.__sipRowWrapSnap = t, this.__sipViewportValid = !0, this.cellPool;
  }
  /**
   * Helper for the in/out pointer pattern used by ROW_ITERATOR / ROW_DATA_CELLS:
   * write a handle into a 4-byte slot, hand the slot to a populator, then
   * free the slot. The handle value itself is unchanged; the populator uses
   * it to find and rebind the iterator's internal data.
   */
  populateHandle(g, B) {
    const I = this.exports.ghostty_wasm_alloc_u8_array(4);
    new DataView(this.memory.buffer).setUint32(I, B, !0), g(I), this.exports.ghostty_wasm_free_u8_array(I, 4);
  }
  /**
   * Reset every cell in the pool to "empty" so cells we don't visit during
   * iteration (e.g. iterator stopped early, or grid resized down) don't
   * carry stale values from a previous frame.
   */
  zeroCellPool() {
    for (let g = 0; g < this.cellPool.length; g++) {
      const B = this.cellPool[g];
      B.codepoint = 0, B.fg_r = B.fg_g = B.fg_b = 0, B.bg_r = B.bg_g = B.bg_b = 0, B.flags = 0, B.width = 1, B.hyperlink_id = 0, B.grapheme_len = 0;
    }
  }
  // ==========================================================================
  // Compatibility methods (delegate to render state)
  // ==========================================================================
  /**
   * Get line - for compatibility, extracts from viewport.
   * Ensures render state is fresh by calling update().
   * Returns a COPY of the cells to avoid pool reference issues.
   */
  getLine(g) {
    if (g < 0 || g >= this._rows)
      return null;
    this.update();
    const B = this.getViewport(), I = g * this._cols;
    return B.slice(I, I + this._cols).map((Q) => ({ ...Q }));
  }
  /** For compatibility with old API */
  isDirty() {
    return this.update() !== iB.NONE;
  }
  /**
   * Check if a full redraw is needed (screen change, resize, etc.)
   * Note: This calls update() to ensure fresh state. Safe to call multiple times.
   */
  needsFullRedraw() {
    return this.update() === iB.FULL;
  }
  /** Mark render state as clean after rendering */
  clearDirty() {
    this.markClean();
  }
  // ==========================================================================
  // Terminal modes
  // ==========================================================================
  isAlternateScreen() {
    return this.tGetU32(iA.ACTIVE_SCREEN) === _I.ALTERNATE;
  }
  hasBracketedPaste() {
    return this.getMode(2004, !1);
  }
  hasFocusEvents() {
    return this.getMode(1004, !1);
  }
  hasMouseTracking() {
    return this.tGetU8(iA.MOUSE_TRACKING) !== 0;
  }
  // ==========================================================================
  // Extended API (scrollback, modes, etc.)
  // ==========================================================================
  /** Get dimensions - for compatibility */
  getDimensions() {
    return { cols: this._cols, rows: this._rows };
  }
  /** Get number of scrollback lines (history, not including active screen) */
  getScrollbackLength() {
    return this.tGetU32(iA.SCROLLBACK_ROWS);
  }
  /**
   * Get a line from the scrollback buffer.
   * @param offset 0 = oldest scrollback line, (scrollbackLength-1) = most
   *   recent scrollback line.
   *
   * Uses ghostty_terminal_grid_ref with POINT_TAG_HISTORY to address rows
   * outside the active viewport. The render-state row iterator only walks
   * the viewport, so scrollback access has to go through grid_ref.
   *
   * Cell content is currently codepoint-only; fg/bg colors, style flags,
   * and hyperlinks are deferred (defaults: 0 colors, flags=0, width=1).
   * The text-extraction tests that drove this commit only check codepoints.
   */
  getScrollbackLine(g) {
    return this.readGridLine(KA.HISTORY, g);
  }
  /**
   * Get the hyperlink URI for a cell at the given position in the active
   * viewport. Returns null when no hyperlink is attached.
   */
  getHyperlinkUri(g, B) {
    return g < 0 || g >= this._rows || B < 0 || B >= this._cols ? null : this.readHyperlinkUri(KA.ACTIVE, g, B);
  }
  /**
   * Get the hyperlink URI for a cell in the scrollback buffer.
   */
  getScrollbackHyperlinkUri(g, B) {
    return B < 0 || B >= this._cols ? null : this.readHyperlinkUri(KA.HISTORY, g, B);
  }
  // ==========================================================================
  // grid_ref helpers
  //
  // GhosttyPoint  : 24 bytes (tag@0:u32, value@8:union 16 bytes).
  //                 The union's first member is GhosttyPointCoordinate
  //                 (x@0:u16, y@4:u32).
  // GhosttyGridRef: 12 bytes — sized struct (size@0:u32, node@4:opaque,
  //                 x@8:u16, y@10:u16). x/y are public so we can step
  //                 along a row by mutating ref.x in place rather than
  //                 re-resolving the point per cell.
  //
  // A grid ref is invalidated by ANY terminal mutation. The whole helper
  // body must run between vt_writes — read everything we need, copy out,
  // free.
  // ==========================================================================
  readGridLine(g, B) {
    const I = this.allocPoint(g, 0, B), Q = this.exports.ghostty_wasm_alloc_u8_array(12);
    new DataView(this.memory.buffer).setUint32(Q, 12, !0);
    try {
      if (this.exports.ghostty_terminal_grid_ref(this.handle, I, Q) !== 0)
        return null;
      const C = 768, E = this.exports.ghostty_wasm_alloc_u8_array(C), D = this.exports.ghostty_terminal_get(this.handle, iA.COLOR_PALETTE, E) === 0 ? new Uint8Array(this.memory.buffer, E, C).slice() : null, o = new Array(this._cols), w = this.exports.ghostty_wasm_alloc_u8_array(8), t = this.exports.ghostty_wasm_alloc_u8_array(4), e = this.exports.ghostty_wasm_alloc_u8_array(4), s = 72, a = this.exports.ghostty_wasm_alloc_u8_array(s);
      new DataView(this.memory.buffer).setUint32(a, s, !0);
      try {
        for (let k = 0; k < this._cols; k++) {
          if (new DataView(this.memory.buffer).setUint16(Q + 8, k, !0), this.exports.ghostty_grid_ref_cell(Q, w) !== 0) {
            o[k] = this.makeEmptyCell();
            continue;
          }
          const N = new DataView(this.memory.buffer).getBigUint64(w, !0);
          this.exports.ghostty_cell_get(N, MA.CODEPOINT, t);
          const n = new DataView(this.memory.buffer).getUint32(t, !0);
          this.exports.ghostty_cell_get(N, MA.WIDE, e);
          const c = new DataView(this.memory.buffer).getUint32(e, !0), G = c === wA.WIDE ? 2 : c === wA.SPACER_TAIL || c === wA.SPACER_HEAD ? 0 : 1;
          this.exports.ghostty_cell_get(N, MA.HAS_HYPERLINK, e);
          const J = new DataView(this.memory.buffer).getUint8(e) !== 0;
          new DataView(this.memory.buffer).setUint32(a, s, !0);
          const R = this.exports.ghostty_grid_ref_style(Q, a) === 0, r = this.makeEmptyCell();
          if (r.codepoint = n, r.width = G, r.hyperlink_id = J ? 1 : 0, R) {
            const F = new Uint8Array(this.memory.buffer, a, s), H = new DataView(this.memory.buffer);
            let y = 0;
            F[56] && (y |= l.BOLD), F[57] && (y |= l.ITALIC), F[58] && (y |= l.FAINT), F[59] && (y |= l.BLINK), F[60] && (y |= l.INVERSE), F[61] && (y |= l.INVISIBLE), F[62] && (y |= l.STRIKETHROUGH), H.getInt32(a + 64, !0) !== 0 && (y |= l.UNDERLINE), r.flags = y, this.resolveStyleColor(
              a + 8,
              D,
              r,
              /*isFg=*/
              !0
            ), this.resolveStyleColor(
              a + 24,
              D,
              r,
              /*isFg=*/
              !1
            );
          }
          o[k] = r;
        }
      } finally {
        this.exports.ghostty_wasm_free_u8_array(w, 8), this.exports.ghostty_wasm_free_u8_array(t, 4), this.exports.ghostty_wasm_free_u8_array(e, 4), this.exports.ghostty_wasm_free_u8_array(a, s), this.exports.ghostty_wasm_free_u8_array(E, C);
      }
      return o;
    } finally {
      this.exports.ghostty_wasm_free_u8_array(I, 24), this.exports.ghostty_wasm_free_u8_array(Q, 12);
    }
  }
  /**
   * Decode a GhosttyStyleColor (16 bytes at colorPtr — tag@0:u32,
   * value@8:union) and write the resolved RGB into the cell's fg_*
   * or bg_* triple. Tag values: NONE=0 (leaves zeros so the renderer's
   * theme fallback kicks in), PALETTE=1 (looks up the terminal's
   * effective palette), RGB=2 (direct read).
   */
  resolveStyleColor(g, B, I, Q) {
    const C = new DataView(this.memory.buffer), E = C.getUint32(g + 0, !0);
    let i = 0, D = 0, o = 0;
    if (E === 1 && B) {
      const w = C.getUint8(g + 8);
      i = B[w * 3 + 0], D = B[w * 3 + 1], o = B[w * 3 + 2];
    } else
      E === 2 && (i = C.getUint8(g + 8), D = C.getUint8(g + 9), o = C.getUint8(g + 10));
    Q ? (I.fg_r = i, I.fg_g = D, I.fg_b = o) : (I.bg_r = i, I.bg_g = D, I.bg_b = o);
  }
  readHyperlinkUri(g, B, I) {
    const Q = this.allocPoint(g, I, B), C = this.exports.ghostty_wasm_alloc_u8_array(12);
    new DataView(this.memory.buffer).setUint32(C, 12, !0);
    try {
      if (this.exports.ghostty_terminal_grid_ref(this.handle, Q, C) !== 0)
        return null;
      const E = this.exports.ghostty_wasm_alloc_usize();
      try {
        this.exports.ghostty_grid_ref_hyperlink_uri(C, 0, 0, E);
        const i = new DataView(this.memory.buffer).getUint32(E, !0);
        if (i === 0)
          return null;
        const D = this.exports.ghostty_wasm_alloc_u8_array(i);
        try {
          if (this.exports.ghostty_grid_ref_hyperlink_uri(C, D, i, E) !== 0)
            return null;
          const w = new DataView(this.memory.buffer).getUint32(E, !0), t = new Uint8Array(this.memory.buffer, D, w);
          return new TextDecoder().decode(t.slice());
        } finally {
          this.exports.ghostty_wasm_free_u8_array(D, i);
        }
      } finally {
        this.exports.ghostty_wasm_free_usize(E);
      }
    } finally {
      this.exports.ghostty_wasm_free_u8_array(Q, 24), this.exports.ghostty_wasm_free_u8_array(C, 12);
    }
  }
  allocPoint(g, B, I) {
    const Q = this.exports.ghostty_wasm_alloc_u8_array(24), C = new DataView(this.memory.buffer);
    return new Uint8Array(this.memory.buffer, Q, 24).fill(0), C.setUint32(Q + 0, g, !0), C.setUint16(Q + 8, B, !0), C.setUint32(Q + 12, I, !0), Q;
  }
  makeEmptyCell() {
    return {
      codepoint: 0,
      fg_r: 0,
      fg_g: 0,
      fg_b: 0,
      bg_r: 0,
      bg_g: 0,
      bg_b: 0,
      flags: 0,
      width: 1,
      hyperlink_id: 0,
      grapheme_len: 0
    };
  }
  /**
   * Whether any terminal response bytes are queued for readResponse().
   *
   * Responses are delivered synchronously during vt_write() by the
   * WRITE_PTY callback (e.g. DSR replies, XTVERSION, in-band size reports).
   * They sit in pendingResponses until drained.
   */
  hasResponse() {
    return this.pendingResponses.length > 0;
  }
  /**
   * Drain queued response bytes, decode as UTF-8, return as a single
   * string. Multiple callback invocations are concatenated. Returns null
   * when nothing's pending so the demo's echo loop can short-circuit.
   */
  readResponse() {
    if (this.pendingResponses.length === 0)
      return null;
    let g = 0;
    for (const Q of this.pendingResponses)
      g += Q.length;
    const B = new Uint8Array(g);
    let I = 0;
    for (const Q of this.pendingResponses)
      B.set(Q, I), I += Q.length;
    return this.pendingResponses.length = 0, new TextDecoder().decode(B);
  }
  /**
   * Install the WRITE_PTY and SIZE trampoline callbacks.
   *
   * Trampolines are shared across all terminals that come from the
   * same WASM instance, but NOT across instances — terminal handles are
   * only unique within their parent module, and table indices in module
   * A are meaningless in module B's table. So we keep a per-table
   * registry (WeakMap keyed on the indirect function table) that owns
   * the slot indices plus the handle→instance routing map for that
   * table.
   *
   * On first use for a given table we instantiate the trampolines,
   * `table.grow(2)`, and write both into the new slots. Subsequent
   * terminals from the same module reuse the registry and just
   * register their handle in instancesByHandle.
   */
  installCallbacks() {
    const g = this.exports.__indirect_function_table;
    let B = vB.callbackRegistries.get(g);
    if (!B) {
      const I = /* @__PURE__ */ new Map(), Q = (k, M, N, n) => {
        const c = I.get(k);
        c && c.pendingResponses.push(new Uint8Array(c.memory.buffer, N, n).slice());
      }, C = (k, M, N) => {
        const n = I.get(k);
        if (!n || n.cellWidthPx === 0 || n.cellHeightPx === 0)
          return 0;
        const c = new DataView(n.memory.buffer);
        return c.setUint16(N + 0, n._rows, !0), c.setUint16(N + 2, n._cols, !0), c.setUint32(N + 4, n.cellWidthPx, !0), c.setUint32(N + 8, n.cellHeightPx, !0), 1;
      }, E = this.exports, i = this.memory, D = (k, M, N, n, c) => {
        try {
          const G = new Uint8Array(i.buffer, N, n).slice(), J = ii(G), R = ti(J);
          if (!R)
            return 0;
          const r = E.ghostty_alloc(M, R.length);
          if (r === 0)
            return 0;
          new Uint8Array(i.buffer, r, R.length).set(R);
          const F = new DataView(i.buffer);
          return F.setUint32(c + 0, J.width, !0), F.setUint32(c + 4, J.height, !0), F.setUint32(c + 8, r, !0), F.setUint32(c + 12, R.length, !0), 1;
        } catch {
          return 0;
        }
      }, { writePtyFwd: o, sizeFwd: w, decodePngFwd: t } = wi(
        Q,
        C,
        D
      ), e = g.grow(1);
      g.set(e, o);
      const s = g.grow(1);
      g.set(s, w);
      const a = g.grow(1);
      g.set(a, t), B = { writePtyIndex: e, sizeIndex: s, decodePngIndex: a, instancesByHandle: I }, vB.callbackRegistries.set(g, B), this.exports.ghostty_sys_set(PI.DECODE_PNG, a);
    }
    B.instancesByHandle.set(this.handle, this), this.callbackRegistry = B, this.exports.ghostty_terminal_set(
      this.handle,
      AA.WRITE_PTY,
      B.writePtyIndex
    ), this.exports.ghostty_terminal_set(this.handle, AA.SIZE, B.sizeIndex);
  }
  /**
   * Query arbitrary terminal mode by number.
   * @param mode Mode number (e.g., 25 for cursor visibility, 2004 for bracketed paste)
   * @param isAnsi True for ANSI modes, false for DEC modes (default: false)
   */
  getMode(g, B = !1) {
    const I = BI(g, B), Q = this.exports.ghostty_wasm_alloc_u8();
    this.exports.ghostty_terminal_mode_get(this.handle, I, Q);
    const C = new DataView(this.memory.buffer).getUint8(Q);
    return this.exports.ghostty_wasm_free_u8(Q), C !== 0;
  }
  // ==========================================================================
  // Private helpers
  // ==========================================================================
  initCellPool() {
    const g = this._cols * this._rows;
    if (this.cellPool.length < g)
      for (let B = this.cellPool.length; B < g; B++)
        this.cellPool.push({
          codepoint: 0,
          fg_r: 204,
          fg_g: 204,
          fg_b: 204,
          bg_r: 0,
          bg_g: 0,
          bg_b: 0,
          flags: 0,
          width: 1,
          hyperlink_id: 0,
          grapheme_len: 0
        });
  }
  /**
   * Get all codepoints for a grapheme cluster at the given position.
   * For most cells this returns a single codepoint, but for complex scripts
   * (Hindi, emoji with ZWJ, etc.) it returns multiple codepoints.
   * @returns Array of codepoints, or null on error
   */
  getGrapheme(g, B) {
    if (g < 0 || g >= this._rows || B < 0 || B >= this._cols)
      return null;
    this.update(), this.populateHandle(
      (i) => this.exports.ghostty_render_state_get(this.renderHandle, d.ROW_ITERATOR, i),
      this.rowIter
    );
    for (let i = 0; i <= g; i++)
      if (!this.exports.ghostty_render_state_row_iterator_next(this.rowIter))
        return null;
    if (this.populateHandle(
      (i) => this.exports.ghostty_render_state_row_get(this.rowIter, oA.CELLS, i),
      this.rowCells
    ), this.exports.ghostty_render_state_row_cells_select(this.rowCells, B) !== 0)
      return null;
    const I = this.exports.ghostty_wasm_alloc_u8_array(4);
    let Q = 0;
    try {
      this.exports.ghostty_render_state_row_cells_get(
        this.rowCells,
        V.GRAPHEMES_LEN,
        I
      ), Q = new DataView(this.memory.buffer).getUint32(I, !0);
    } finally {
      this.exports.ghostty_wasm_free_u8_array(I, 4);
    }
    if (Q === 0)
      return [];
    const C = Q * 4, E = this.exports.ghostty_wasm_alloc_u8_array(C);
    try {
      return this.exports.ghostty_render_state_row_cells_get(
        this.rowCells,
        V.GRAPHEMES_BUF,
        E
      ), Array.from(new Uint32Array(this.memory.buffer, E, Q));
    } finally {
      this.exports.ghostty_wasm_free_u8_array(E, C);
    }
  }
  /**
   * Get a string representation of the grapheme at the given position.
   * This properly handles complex scripts like Hindi, emoji with ZWJ, etc.
   */
  getGraphemeString(g, B) {
    const I = this.getGrapheme(g, B);
    return !I || I.length === 0 ? " " : String.fromCodePoint(...I);
  }
  /**
   * Get all codepoints for a grapheme cluster in the scrollback buffer.
   * @param offset Scrollback line offset (0 = oldest)
   * @param col Column index
   * @returns Array of codepoints, or null on error
   */
  getScrollbackGrapheme(g, B) {
    if (B < 0 || B >= this._cols)
      return null;
    const I = this.allocPoint(KA.HISTORY, B, g), Q = this.exports.ghostty_wasm_alloc_u8_array(12);
    new DataView(this.memory.buffer).setUint32(Q, 12, !0);
    try {
      if (this.exports.ghostty_terminal_grid_ref(this.handle, I, Q) !== 0)
        return null;
      const C = this.exports.ghostty_wasm_alloc_usize();
      try {
        this.exports.ghostty_grid_ref_graphemes(Q, 0, 0, C);
        const E = new DataView(this.memory.buffer).getUint32(C, !0);
        if (E === 0)
          return [];
        const i = E * 4, D = this.exports.ghostty_wasm_alloc_u8_array(i);
        try {
          if (this.exports.ghostty_grid_ref_graphemes(Q, D, E, C) !== 0)
            return null;
          const w = new DataView(this.memory.buffer).getUint32(C, !0);
          return Array.from(new Uint32Array(this.memory.buffer, D, w));
        } finally {
          this.exports.ghostty_wasm_free_u8_array(D, i);
        }
      } finally {
        this.exports.ghostty_wasm_free_usize(C);
      }
    } finally {
      this.exports.ghostty_wasm_free_u8_array(I, 24), this.exports.ghostty_wasm_free_u8_array(Q, 12);
    }
  }
  /**
   * Get a string representation of a grapheme in the scrollback buffer.
   */
  getScrollbackGraphemeString(g, B) {
    const I = this.getScrollbackGrapheme(g, B);
    return !I || I.length === 0 ? " " : String.fromCodePoint(...I);
  }
};
AQ.callbackRegistries = /* @__PURE__ */ new WeakMap();
let si = AQ;
function ti(A) {
  const { width: g, height: B, channels: I, depth: Q, data: C, palette: E, transparency: i } = A, D = g * B, o = new Uint8Array(D * 4);
  if (E && E.length > 0) {
    for (let t = 0, e = 0; t < D; t++, e += 4) {
      const s = C[t] ?? 0, a = E[s] ?? E[0];
      o[e] = a[0], o[e + 1] = a[1], o[e + 2] = a[2], o[e + 3] = a.length >= 4 ? a[3] : i && s < i.length ? i[s] : 255;
    }
    return o;
  }
  const w = (t) => Q === 16 ? C[t] >> 8 : C[t] ?? 0;
  switch (I) {
    case 4:
      for (let t = 0, e = 0; t < D * 4; t += 4, e += 4)
        o[e] = w(t), o[e + 1] = w(t + 1), o[e + 2] = w(t + 2), o[e + 3] = w(t + 3);
      return o;
    case 3:
      for (let t = 0, e = 0; t < D * 3; t += 3, e += 4)
        o[e] = w(t), o[e + 1] = w(t + 1), o[e + 2] = w(t + 2), o[e + 3] = 255;
      return o;
    case 2:
      for (let t = 0, e = 0; t < D * 2; t += 2, e += 4) {
        const s = w(t);
        o[e] = s, o[e + 1] = s, o[e + 2] = s, o[e + 3] = w(t + 1);
      }
      return o;
    case 1:
      for (let t = 0, e = 0; t < D; t++, e += 4) {
        const s = w(t);
        o[e] = s, o[e + 1] = s, o[e + 2] = s, o[e + 3] = 255;
      }
      return o;
    default:
      return null;
  }
}
class u {
  constructor() {
    this.listeners = [], this.event = (g) => (this.listeners.push(g), {
      dispose: () => {
        const B = this.listeners.indexOf(g);
        B >= 0 && this.listeners.splice(B, 1);
      }
    });
  }
  fire(g) {
    for (const B of this.listeners)
      B(g);
  }
  dispose() {
    this.listeners = [];
  }
}
class ei {
  constructor(g) {
    this.bufferChangeEmitter = new u(), this.terminal = g;
  }
  get active() {
    const g = this.terminal.wasmTerm;
    return g ? g.isAlternateScreen() ? this.alternate : this.normal : this.normal;
  }
  get normal() {
    return this._normalBuffer || (this._normalBuffer = new gI(this.terminal, "normal")), this._normalBuffer;
  }
  get alternate() {
    return this._alternateBuffer || (this._alternateBuffer = new gI(this.terminal, "alternate")), this._alternateBuffer;
  }
  get onBufferChange() {
    return this.bufferChangeEmitter.event;
  }
  /**
   * Internal: Fire buffer change event when screen switches
   * Should be called by Terminal when detecting screen change
   */
  _fireBufferChange(g) {
    this.bufferChangeEmitter.fire(g);
  }
}
class gI {
  constructor(g, B) {
    this.terminal = g, this.bufferType = B;
    const I = {
      codepoint: 0,
      fg_r: 204,
      fg_g: 204,
      fg_b: 204,
      bg_r: 0,
      bg_g: 0,
      bg_b: 0,
      flags: 0,
      width: 1,
      hyperlink_id: 0,
      grapheme_len: 0
    };
    this.nullCell = new PB(I, 0);
  }
  get type() {
    return this.bufferType;
  }
  get cursorX() {
    const g = this.getWasmTerm();
    return g ? g.getCursor().x : 0;
  }
  get cursorY() {
    const g = this.getWasmTerm();
    return g ? g.getCursor().y : 0;
  }
  get viewportY() {
    return 0;
  }
  get baseY() {
    return 0;
  }
  get length() {
    const g = this.getWasmTerm();
    return g ? this.bufferType === "alternate" ? g.rows : g.getScrollbackLength() + g.rows : 0;
  }
  getLine(g) {
    const B = this.getWasmTerm();
    if (!B || g < 0 || g >= this.length)
      return;
    const I = B.getScrollbackLength();
    let Q, C, E;
    if (this.bufferType === "normal" && g < I) {
      const i = g;
      Q = B.getScrollbackLine(i), E = !1;
    } else
      C = this.bufferType === "normal" ? g - I : g, Q = B.getLine(C), E = B.isRowWrapped(C);
    if (Q)
      return new ai(Q, E, B.cols);
  }
  getNullCell() {
    return this.nullCell;
  }
  getWasmTerm() {
    return this.terminal.wasmTerm;
  }
}
class ai {
  constructor(g, B, I) {
    this.cells = g, this._isWrapped = B, this._length = I;
  }
  get length() {
    return this._length;
  }
  get isWrapped() {
    return this._isWrapped;
  }
  getCell(g) {
    if (!(g < 0 || g >= this._length))
      return g >= this.cells.length ? new PB(
        {
          codepoint: 0,
          fg_r: 204,
          fg_g: 204,
          fg_b: 204,
          bg_r: 0,
          bg_g: 0,
          bg_b: 0,
          flags: 0,
          width: 1,
          hyperlink_id: 0,
          grapheme_len: 0
        },
        g
      ) : new PB(this.cells[g], g);
  }
  translateToString(g = !1, B = 0, I = this._length) {
    const Q = Math.max(0, Math.min(B, this._length)), C = Math.max(Q, Math.min(I, this._length));
    let E = "";
    for (let i = Q; i < C; i++) {
      const D = this.getCell(i);
      if (D) {
        const o = D.getChars();
        E += o;
      }
    }
    return g && (E = E.trimEnd()), E;
  }
}
class PB {
  constructor(g, B) {
    this.cell = g, this.x = B;
  }
  getChars() {
    const g = this.cell.codepoint;
    return g === 0 ? "" : g < 0 || g > 1114111 || g >= 55296 && g <= 57343 ? "�" : String.fromCodePoint(g);
  }
  getCode() {
    return this.cell.codepoint;
  }
  getWidth() {
    return this.cell.width;
  }
  getFgColorMode() {
    return -1;
  }
  getBgColorMode() {
    return -1;
  }
  getFgColor() {
    return this.cell.fg_r << 16 | this.cell.fg_g << 8 | this.cell.fg_b;
  }
  getBgColor() {
    return this.cell.bg_r << 16 | this.cell.bg_g << 8 | this.cell.bg_b;
  }
  isBold() {
    return this.cell.flags & l.BOLD ? 1 : 0;
  }
  isItalic() {
    return this.cell.flags & l.ITALIC ? 1 : 0;
  }
  isUnderline() {
    return this.cell.flags & l.UNDERLINE ? 1 : 0;
  }
  isStrikethrough() {
    return this.cell.flags & l.STRIKETHROUGH ? 1 : 0;
  }
  isBlink() {
    return this.cell.flags & l.BLINK ? 1 : 0;
  }
  isInverse() {
    return this.cell.flags & l.INVERSE ? 1 : 0;
  }
  isInvisible() {
    return this.cell.flags & l.INVISIBLE ? 1 : 0;
  }
  isFaint() {
    return this.cell.flags & l.FAINT ? 1 : 0;
  }
  /**
   * Get hyperlink ID for this cell (0 = no link)
   * Used by link detection system
   */
  getHyperlinkId() {
    return this.cell.hyperlink_id;
  }
  /**
   * Get the Unicode codepoint for this cell
   * Used by link detection system
   */
  getCodepoint() {
    return this.cell.codepoint;
  }
  /**
   * Check if cell has dim/faint attribute
   * Added for IBufferCell compatibility
   */
  isDim() {
    return (this.cell.flags & l.FAINT) !== 0;
  }
}
const hi = {
  // Letters
  KeyA: h.A,
  KeyB: h.B,
  KeyC: h.C,
  KeyD: h.D,
  KeyE: h.E,
  KeyF: h.F,
  KeyG: h.G,
  KeyH: h.H,
  KeyI: h.I,
  KeyJ: h.J,
  KeyK: h.K,
  KeyL: h.L,
  KeyM: h.M,
  KeyN: h.N,
  KeyO: h.O,
  KeyP: h.P,
  KeyQ: h.Q,
  KeyR: h.R,
  KeyS: h.S,
  KeyT: h.T,
  KeyU: h.U,
  KeyV: h.V,
  KeyW: h.W,
  KeyX: h.X,
  KeyY: h.Y,
  KeyZ: h.Z,
  // Numbers
  Digit1: h.ONE,
  Digit2: h.TWO,
  Digit3: h.THREE,
  Digit4: h.FOUR,
  Digit5: h.FIVE,
  Digit6: h.SIX,
  Digit7: h.SEVEN,
  Digit8: h.EIGHT,
  Digit9: h.NINE,
  Digit0: h.ZERO,
  // Special keys
  Enter: h.ENTER,
  Escape: h.ESCAPE,
  Backspace: h.BACKSPACE,
  Tab: h.TAB,
  Space: h.SPACE,
  // Punctuation
  Minus: h.MINUS,
  Equal: h.EQUAL,
  BracketLeft: h.BRACKET_LEFT,
  BracketRight: h.BRACKET_RIGHT,
  Backslash: h.BACKSLASH,
  Semicolon: h.SEMICOLON,
  Quote: h.QUOTE,
  Backquote: h.GRAVE,
  Comma: h.COMMA,
  Period: h.PERIOD,
  Slash: h.SLASH,
  // Function keys
  CapsLock: h.CAPS_LOCK,
  F1: h.F1,
  F2: h.F2,
  F3: h.F3,
  F4: h.F4,
  F5: h.F5,
  F6: h.F6,
  F7: h.F7,
  F8: h.F8,
  F9: h.F9,
  F10: h.F10,
  F11: h.F11,
  F12: h.F12,
  // Special function keys
  PrintScreen: h.PRINT_SCREEN,
  ScrollLock: h.SCROLL_LOCK,
  Pause: h.PAUSE,
  Insert: h.INSERT,
  Home: h.HOME,
  PageUp: h.PAGE_UP,
  Delete: h.DELETE,
  End: h.END,
  PageDown: h.PAGE_DOWN,
  // Arrow keys
  ArrowRight: h.RIGHT,
  ArrowLeft: h.LEFT,
  ArrowDown: h.DOWN,
  ArrowUp: h.UP,
  // Keypad
  NumLock: h.NUM_LOCK,
  NumpadDivide: h.KP_DIVIDE,
  NumpadMultiply: h.KP_MULTIPLY,
  NumpadSubtract: h.KP_MINUS,
  NumpadAdd: h.KP_PLUS,
  NumpadEnter: h.KP_ENTER,
  Numpad1: h.KP_1,
  Numpad2: h.KP_2,
  Numpad3: h.KP_3,
  Numpad4: h.KP_4,
  Numpad5: h.KP_5,
  Numpad6: h.KP_6,
  Numpad7: h.KP_7,
  Numpad8: h.KP_8,
  Numpad9: h.KP_9,
  Numpad0: h.KP_0,
  NumpadDecimal: h.KP_PERIOD,
  // International
  IntlBackslash: h.INTL_BACKSLASH,
  ContextMenu: h.CONTEXT_MENU,
  // Additional function keys
  F13: h.F13,
  F14: h.F14,
  F15: h.F15,
  F16: h.F16,
  F17: h.F17,
  F18: h.F18,
  F19: h.F19,
  F20: h.F20,
  F21: h.F21,
  F22: h.F22,
  F23: h.F23,
  F24: h.F24
}, BQ = class qA {
  /**
   * Create a new InputHandler
   * @param ghostty - Ghostty instance (for creating KeyEncoder)
   * @param container - DOM element to attach listeners to
   * @param onData - Callback for terminal data (escape sequences to send to PTY)
   * @param onBell - Callback for bell/beep event
   * @param onKey - Optional callback for raw key events
   * @param customKeyEventHandler - Optional custom key event handler
   * @param getMode - Optional callback to query terminal mode state (for application cursor mode)
   * @param onCopy - Optional callback to handle copy (Cmd+C/Ctrl+C with selection)
   * @param inputElement - Optional input element for beforeinput events
   * @param mouseConfig - Optional mouse tracking configuration
   */
  constructor(g, B, I, Q, C, E, i, D, o, w) {
    this.keydownListener = null, this.keyupListener = null, this.altIsMeta = !0, this.getKittyFlagsCallback = null, this.keypressListener = null, this.pasteListener = null, this.beforeInputListener = null, this.compositionStartListener = null, this.compositionUpdateListener = null, this.compositionEndListener = null, this.mousedownListener = null, this.mouseupListener = null, this.mousemoveListener = null, this.wheelListener = null, this.isComposing = !1, this.isDisposed = !1, this.mouseButtonsPressed = 0, this.lastKeyDownData = null, this.lastKeyDownTime = 0, this.lastPasteData = null, this.lastPasteTime = 0, this.lastPasteSource = null, this.lastCompositionData = null, this.lastCompositionTime = 0, this.lastBeforeInputData = null, this.lastBeforeInputTime = 0, this.encoder = g.createKeyEncoder(), this.container = B, this.inputElement = o, this.onDataCallback = I, this.onBellCallback = Q, this.onKeyCallback = C, this.customKeyEventHandler = E, this.getModeCallback = i, this.onCopyCallback = D, this.mouseConfig = w, this.attach();
  }
  /**
   * Set custom key event handler (for runtime updates)
   */
  setCustomKeyEventHandler(g) {
    this.customKeyEventHandler = g;
  }
  /**
   * Attach keyboard event listeners to container
   */
  attach() {
    typeof this.container.hasAttribute == "function" && typeof this.container.setAttribute == "function" && (this.container.hasAttribute("tabindex") || this.container.setAttribute("tabindex", "0"), this.container.style && (this.container.style.outline = "none")), this.keydownListener = this.handleKeyDown.bind(this), this.container.addEventListener("keydown", this.keydownListener), this.keyupListener = this.handleKeyUp.bind(this), this.container.addEventListener("keyup", this.keyupListener), this.pasteListener = this.handlePaste.bind(this), this.container.addEventListener("paste", this.pasteListener), this.inputElement && this.inputElement !== this.container && this.inputElement.addEventListener("paste", this.pasteListener), this.inputElement && (this.beforeInputListener = this.handleBeforeInput.bind(this), this.inputElement.addEventListener("beforeinput", this.beforeInputListener)), this.compositionStartListener = this.handleCompositionStart.bind(this), this.container.addEventListener("compositionstart", this.compositionStartListener), this.compositionUpdateListener = this.handleCompositionUpdate.bind(this), this.container.addEventListener("compositionupdate", this.compositionUpdateListener), this.compositionEndListener = this.handleCompositionEnd.bind(this), this.container.addEventListener("compositionend", this.compositionEndListener), this.mousedownListener = this.handleMouseDown.bind(this), this.container.addEventListener("mousedown", this.mousedownListener), this.mouseupListener = this.handleMouseUp.bind(this), this.container.addEventListener("mouseup", this.mouseupListener), this.mousemoveListener = this.handleMouseMove.bind(this), this.container.addEventListener("mousemove", this.mousemoveListener), this.wheelListener = this.handleWheel.bind(this), this.container.addEventListener("wheel", this.wheelListener, { passive: !1 });
  }
  /**
   * Map KeyboardEvent.code to USB HID Key enum value
   * @param code - KeyboardEvent.code value
   * @returns Key enum value or null if unmapped
   */
  mapKeyCode(g) {
    return hi[g] ?? null;
  }
  /**
   * Extract modifier flags from KeyboardEvent
   * @param event - KeyboardEvent
   * @returns Mods flags
   */
  extractModifiers(g) {
    let B = P.NONE;
    return g.shiftKey && (B |= P.SHIFT), g.ctrlKey && (B |= P.CTRL), g.altKey && (B |= P.ALT), g.metaKey && (B |= P.SUPER), B;
  }
  /**
   * Check if this is a printable character with no special modifiers
   * @param event - KeyboardEvent
   * @returns true if printable character
   */
  isPrintableCharacter(g) {
    return g.ctrlKey && !g.altKey || g.altKey && !g.ctrlKey || g.metaKey ? !1 : g.key.length === 1;
  }
  /**
   * __sip: recover a physical `code` from `event.key`.
   *
   * An IME can deliver a chord with the physical code stripped -- empty, or
   * "Unidentified" -- while `event.key` still names the character. Without
   * this the chord hits the unmapped-code path and is swallowed outright, so
   * Ctrl+L sends nothing at all rather than 0x0c. Only single characters are
   * recovered; anything else has no physical key to name.
   */
  sipCodeFromKey(g) {
    if (typeof g != "string" || g.length !== 1)
      return null;
    if (g >= "a" && g <= "z")
      return "Key" + g.toUpperCase();
    if (g >= "A" && g <= "Z")
      return "Key" + g;
    if (g >= "0" && g <= "9")
      return "Digit" + g;
    return null;
  }
  /**
   * Handle keydown event
   * @param event - KeyboardEvent
   */
  handleKeyDown(g) {
    if (this.isDisposed)
      return;
    // __sip: a modifier chord is never an IME composition, so it must not be
    // swallowed by the composition guard. Firefox on Linux with ibus/fcitx
    // reports keyCode 229 (the "IME is processing" sentinel) for ordinary
    // keys, and this guard used to return WITHOUT preventDefault. The browser
    // then went on to fire beforeinput, whose insertText path emitted the bare
    // printable character: Ctrl+L sent "l" (0x6c) instead of 0x0c, and every
    // chord degraded the same way.
    //
    // Ctrl+Alt is deliberately NOT treated as a chord here: that combination is
    // AltGr on many layouts and genuinely does compose characters. This is the
    // same test isPrintableCharacter() uses, inverted.
    const sipChord = g.ctrlKey && !g.altKey || g.altKey && !g.ctrlKey || g.metaKey;
    if (!sipChord && (this.isComposing || g.isComposing || g.keyCode === 229))
      return;
    sipChord && (this.__sipChordAt = Date.now());
    if (this.onKeyCallback && this.onKeyCallback({ key: g.key, domEvent: g }), this.customKeyEventHandler && this.customKeyEventHandler(g)) {
      g.preventDefault();
      return;
    }
    if (g.metaKey && !g.altKey && g.code === "KeyV")
      return;
    if (!g.altKey && (g.ctrlKey && g.shiftKey && g.code === "KeyV" || g.shiftKey && g.code === "Insert")) {
      g.preventDefault(), this.pasteFromClipboard();
      return;
    }
    if (g.metaKey && !g.altKey && g.code === "KeyC") {
      this.onCopyCallback && this.onCopyCallback() && g.preventDefault();
      return;
    }
    if (g.ctrlKey && g.shiftKey && !g.altKey && g.code === "KeyC") {
      this.onCopyCallback && this.onCopyCallback(), g.preventDefault();
      return;
    }
    const K = this.getKittyFlagsCallback ? this.getKittyFlagsCallback() : 0;
    if (K === 0 && this.isPrintableCharacter(g)) {
      g.preventDefault(), this.onDataCallback(g.key), this.recordKeyDownData(g.key);
      return;
    }
    let B = this.mapKeyCode(g.code);
    if (B === null && sipChord) {
      // __sip: an IME can strip the physical code off a chord while leaving
      // event.key intact. Re-derive a code from the key so the chord takes the
      // normal encoder path below, instead of being swallowed and sending
      // nothing at all.
      const o = this.sipCodeFromKey(g.key);
      o && (B = this.mapKeyCode(o));
    }
    if (B === null) {
      // __sip: an unmapped code must not fall through to the text path while a
      // chord is held, or beforeinput emits the bare character. Unmodified keys
      // still fall through on purpose: that is the mobile/IME input route.
      sipChord && g.preventDefault();
      return;
    }
    const I = this.extractModifiers(g);
    if (K === 0 && (I === P.NONE || I === P.SHIFT)) {
      let C = null;
      switch (B) {
        case h.ENTER:
          C = "\r";
          break;
        case h.TAB:
          I === P.SHIFT ? C = "\x1B[Z" : C = "	";
          break;
        case h.BACKSPACE:
          C = "";
          break;
        case h.ESCAPE:
          C = "\x1B";
          break;
        case h.HOME:
          C = "\x1B[H";
          break;
        case h.END:
          C = "\x1B[F";
          break;
        case h.INSERT:
          C = "\x1B[2~";
          break;
        case h.DELETE:
          C = "\x1B[3~";
          break;
        case h.PAGE_UP:
          C = "\x1B[5~";
          break;
        case h.PAGE_DOWN:
          C = "\x1B[6~";
          break;
        case h.F1:
          C = "\x1BOP";
          break;
        case h.F2:
          C = "\x1BOQ";
          break;
        case h.F3:
          C = "\x1BOR";
          break;
        case h.F4:
          C = "\x1BOS";
          break;
        case h.F5:
          C = "\x1B[15~";
          break;
        case h.F6:
          C = "\x1B[17~";
          break;
        case h.F7:
          C = "\x1B[18~";
          break;
        case h.F8:
          C = "\x1B[19~";
          break;
        case h.F9:
          C = "\x1B[20~";
          break;
        case h.F10:
          C = "\x1B[21~";
          break;
        case h.F11:
          C = "\x1B[23~";
          break;
        case h.F12:
          C = "\x1B[24~";
          break;
      }
      if (C !== null) {
        g.preventDefault(), this.onDataCallback(C), this.recordKeyDownData(C);
        return;
      }
    }
    const Q = WI.PRESS;
    try {
      if (this.getModeCallback) {
        const o = this.getModeCallback(1);
        this.encoder.setOption(Cg.CURSOR_KEY_APPLICATION, o);
      }
      this.getKittyFlagsCallback && this.encoder.setKittyFlags(K), this.encoder.setOption(Cg.ALT_ESC_PREFIX, this.altIsMeta);
      const C = g.key.length === 1 ? g.key : void 0, E = this.encoder.encode({
        action: Q,
        key: B,
        mods: I,
        utf8: C
      }), D = new TextDecoder().decode(E);
      g.preventDefault(), g.stopPropagation(), D.length > 0 && (this.onDataCallback(D), this.recordKeyDownData(D));
    } catch (C) {
      console.warn("Failed to encode key:", g.code, C);
    }
  }
  /**
   * Handle keyup event. Only emits when the kitty keyboard protocol's
   * report-event-types flag (bit 0x2) is negotiated; otherwise key releases
   * are not reported.
   */
  handleKeyUp(g) {
    if (this.isDisposed)
      return;
    // __sip: mirror handleKeyDown. A chord is never a composition, and under
    // the kitty protocol's report-event-types flag a swallowed release leaves
    // the application believing the key is still held down.
    const Y = g.ctrlKey && !g.altKey || g.altKey && !g.ctrlKey || g.metaKey;
    if (!Y && (this.isComposing || g.isComposing || g.keyCode === 229))
      return;
    const K = this.getKittyFlagsCallback ? this.getKittyFlagsCallback() : 0;
    if (!(K & 2))
      return;
    let B = this.mapKeyCode(g.code);
    if (B === null && Y) {
      const o = this.sipCodeFromKey(g.key);
      o && (B = this.mapKeyCode(o));
    }
    if (B === null)
      return;
    const I = this.extractModifiers(g);
    try {
      this.encoder.setKittyFlags(K), this.encoder.setOption(Cg.ALT_ESC_PREFIX, this.altIsMeta);
      const C = g.key.length === 1 ? g.key : void 0, E = this.encoder.encode({
        action: WI.RELEASE,
        key: B,
        mods: I,
        utf8: C
      }), D = new TextDecoder().decode(E);
      D.length > 0 && (g.preventDefault(), g.stopPropagation(), this.onDataCallback(D));
    } catch (C) {
      console.warn("Failed to encode key release:", g.code, C);
    }
  }
  /**
   * Handle paste event from clipboard
   * @param event - ClipboardEvent
   */
  handlePaste(g) {
    if (this.isDisposed)
      return;
    g.preventDefault(), g.stopPropagation();
    const B = g.clipboardData;
    if (!B) {
      console.warn("No clipboard data available");
      return;
    }
    const I = B.getData("text/plain");
    if (!I) {
      console.warn("No text in clipboard");
      return;
    }
    this.shouldIgnorePasteEvent(I, "paste") || (this.emitPasteData(I), this.recordPasteData(I, "paste"));
  }
  /**
   * Read the clipboard and paste it (keyboard-initiated paste, e.g.
   * Ctrl+Shift+V / Shift+Insert, which do not fire a native paste event).
   */
  pasteFromClipboard() {
    if (typeof navigator > "u" || !navigator.clipboard || !navigator.clipboard.readText)
      return;
    navigator.clipboard.readText().then((g) => {
      !g || this.isDisposed || this.shouldIgnorePasteEvent(g, "paste") || (this.emitPasteData(g), this.recordPasteData(g, "paste"));
    }).catch(() => {
    });
  }
  /**
   * Handle beforeinput event (mobile/IME input)
   * @param event - InputEvent
   */
  handleBeforeInput(g) {
    if (this.isDisposed || this.isComposing || g.isComposing)
      return;
    // __sip: belt and braces for the chord leak fixed in handleKeyDown. Any
    // text insertion arriving immediately after a chord keydown is that chord
    // escaping as its bare character, never something the user typed. Swallow
    // it rather than sending "l" for Ctrl+L.
    if (this.__sipChordAt && Date.now() - this.__sipChordAt < 50 && (g.inputType === "insertText" || g.inputType === "insertReplacementText")) {
      g.preventDefault(), g.stopPropagation();
      return;
    }
    const B = g.inputType, I = g.data ?? "";
    let Q = null;
    switch (B) {
      case "insertText":
      case "insertReplacementText":
        Q = I.length > 0 ? I.replace(/\n/g, "\r") : null;
        break;
      case "insertLineBreak":
      case "insertParagraph":
        Q = "\r";
        break;
      case "deleteContentBackward":
        Q = "";
        break;
      case "deleteContentForward":
        Q = "\x1B[3~";
        break;
      case "insertFromPaste":
        if (!I)
          return;
        if (this.shouldIgnorePasteEvent(I, "beforeinput")) {
          g.preventDefault(), g.stopPropagation();
          return;
        }
        g.preventDefault(), g.stopPropagation(), this.emitPasteData(I), this.recordPasteData(I, "beforeinput");
        return;
      default:
        return;
    }
    if (Q) {
      if (this.shouldIgnoreBeforeInput(Q)) {
        g.preventDefault(), g.stopPropagation();
        return;
      }
      if (I && this.shouldIgnoreBeforeInputFromComposition(I)) {
        g.preventDefault(), g.stopPropagation();
        return;
      }
      g.preventDefault(), g.stopPropagation(), this.onDataCallback(Q), I && this.recordBeforeInputData(I);
    }
  }
  /**
   * Handle compositionstart event
   */
  handleCompositionStart(g) {
    this.isDisposed || (this.isComposing = !0);
  }
  /**
   * Handle compositionupdate event
   */
  handleCompositionUpdate(g) {
    this.isDisposed;
  }
  /**
   * Handle compositionend event
   */
  handleCompositionEnd(g) {
    if (this.isDisposed)
      return;
    this.isComposing = !1;
    const B = g.data;
    if (B && B.length > 0) {
      if (this.shouldIgnoreCompositionEnd(B)) {
        this.cleanupCompositionTextNodes();
        return;
      }
      this.onDataCallback(B), this.recordCompositionData(B);
    }
    this.cleanupCompositionTextNodes();
  }
  /**
   * Cleanup text nodes in container after composition
   */
  cleanupCompositionTextNodes() {
    if (this.container && this.container.childNodes)
      for (let g = this.container.childNodes.length - 1; g >= 0; g--) {
        const B = this.container.childNodes[g];
        B.nodeType === 3 && this.container.removeChild(B);
      }
  }
  // ==========================================================================
  // Mouse Event Handling (for terminal mouse tracking)
  // ==========================================================================
  /**
   * Convert pixel coordinates to terminal cell coordinates
   */
  pixelToCell(g) {
    if (!this.mouseConfig)
      return null;
    const B = this.mouseConfig.getCellDimensions(), I = this.mouseConfig.getCanvasOffset();
    if (B.width <= 0 || B.height <= 0)
      return null;
    const Q = g.clientX - I.left, C = g.clientY - I.top, E = Math.floor(Q / B.width) + 1, i = Math.floor(C / B.height) + 1;
    return {
      col: Math.max(1, E),
      row: Math.max(1, i)
    };
  }
  /**
   * Get modifier flags for mouse event
   */
  getMouseModifiers(g) {
    let B = 0;
    return g.shiftKey && (B |= 4), g.metaKey && (B |= 8), g.ctrlKey && (B |= 16), B;
  }
  /**
   * Encode mouse event as SGR sequence
   * SGR format: \x1b[<Btn;Col;RowM (press/motion) or \x1b[<Btn;Col;Rowm (release)
   */
  encodeMouseSGR(g, B, I, Q, C) {
    return `\x1B[<${g + C};${B};${I}${Q ? "m" : "M"}`;
  }
  /**
   * Encode mouse event as X10/normal sequence (legacy format)
   * Format: \x1b[M<Btn+32><Col+32><Row+32>
   */
  encodeMouseX10(g, B, I, Q) {
    const C = g + Q + 32, E = String.fromCharCode(Math.min(B + 32, 255)), i = String.fromCharCode(Math.min(I + 32, 255));
    return `\x1B[M${String.fromCharCode(C)}${E}${i}`;
  }
  /**
   * Send mouse event to terminal
   */
  sendMouseEvent(g, B, I, Q, C) {
    var o, w;
    const E = this.getMouseModifiers(C), i = ((w = (o = this.mouseConfig) == null ? void 0 : o.hasSgrMouseMode) == null ? void 0 : w.call(o)) ?? !0;
    let D;
    if (i)
      D = this.encodeMouseSGR(g, B, I, Q, E);
    else {
      const t = Q ? 3 : g;
      D = this.encodeMouseX10(t, B, I, E);
    }
    this.onDataCallback(D);
  }
  /**
   * Handle mousedown event
   */
  handleMouseDown(g) {
    var Q;
    if (this.isDisposed || !((Q = this.mouseConfig) != null && Q.hasMouseTracking()))
      return;
    if (g.shiftKey)
      return;
    const B = this.pixelToCell(g);
    if (!B)
      return;
    const I = g.button;
    this.mouseButtonsPressed |= 1 << I, this.sendMouseEvent(I, B.col, B.row, !1, g);
  }
  /**
   * Handle mouseup event
   */
  handleMouseUp(g) {
    var Q;
    if (this.isDisposed || !((Q = this.mouseConfig) != null && Q.hasMouseTracking()))
      return;
    if (g.shiftKey && this.mouseButtonsPressed === 0)
      return;
    const B = this.pixelToCell(g);
    if (!B)
      return;
    const I = g.button;
    this.mouseButtonsPressed &= ~(1 << I), this.sendMouseEvent(I, B.col, B.row, !0, g);
  }
  /**
   * Handle mousemove event
   */
  handleMouseMove(g) {
    var E, i, D;
    if (this.isDisposed || !((E = this.mouseConfig) != null && E.hasMouseTracking()))
      return;
    if (g.shiftKey && this.mouseButtonsPressed === 0)
      return;
    const B = ((i = this.getModeCallback) == null ? void 0 : i.call(this, 1002)) ?? !1, I = ((D = this.getModeCallback) == null ? void 0 : D.call(this, 1003)) ?? !1;
    if (!B && !I || B && !I && this.mouseButtonsPressed === 0)
      return;
    const Q = this.pixelToCell(g);
    if (!Q)
      return;
    let C = 32;
    this.mouseButtonsPressed & 1 ? C += 0 : this.mouseButtonsPressed & 2 ? C += 1 : this.mouseButtonsPressed & 4 ? C += 2 : C += 3, this.sendMouseEvent(C, Q.col, Q.row, !1, g);
  }
  /**
   * Handle wheel event (scroll)
   */
  handleWheel(g) {
    var Q;
    if (this.isDisposed || !((Q = this.mouseConfig) != null && Q.hasMouseTracking()))
      return;
    const B = this.pixelToCell(g);
    if (!B)
      return;
    const I = g.deltaY < 0 ? 64 : 65;
    this.sendMouseEvent(I, B.col, B.row, !1, g), g.preventDefault();
  }
  /**
   * Emit paste data with bracketed paste support
   */
  emitPasteData(g) {
    var I;
    const Q = this.sanitizePasteData(g);
    ((I = this.getModeCallback) == null ? void 0 : I.call(this, 2004)) ?? !1 ? this.onDataCallback("\x1B[200~" + Q + "\x1B[201~") : this.onDataCallback(Q);
  }
  /**
   * Sanitize pasted text: normalize line endings to CR and strip C0 control
   * characters (including ESC) so the payload cannot break out of bracketed
   * paste (e.g. an embedded \x1b[201~) or inject escape sequences.
   */
  sanitizePasteData(g) {
    return g.replace(/\r\n/g, "\r").replace(/\n/g, "\r").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  }
  /**
   * Record keydown data for beforeinput de-duplication
   */
  recordKeyDownData(g) {
    this.lastKeyDownData = g, this.lastKeyDownTime = this.getNow();
  }
  /**
   * Record paste data for beforeinput de-duplication
   */
  recordPasteData(g, B) {
    this.lastPasteData = g, this.lastPasteTime = this.getNow(), this.lastPasteSource = B;
  }
  /**
   * Check if beforeinput should be ignored due to a recent keydown
   */
  shouldIgnoreBeforeInput(g) {
    if (!this.lastKeyDownData)
      return !1;
    const I = this.getNow() - this.lastKeyDownTime < qA.BEFORE_INPUT_IGNORE_MS && this.lastKeyDownData === g;
    return this.lastKeyDownData = null, I;
  }
  /**
   * Check if beforeinput text should be ignored due to a recent composition end
   */
  shouldIgnoreBeforeInputFromComposition(g) {
    if (!this.lastCompositionData)
      return !1;
    const I = this.getNow() - this.lastCompositionTime < qA.BEFORE_INPUT_IGNORE_MS && this.lastCompositionData === g;
    return I && (this.lastCompositionData = null), I;
  }
  /**
   * Check if composition end should be ignored due to a recent beforeinput text
   */
  shouldIgnoreCompositionEnd(g) {
    if (!this.lastBeforeInputData)
      return !1;
    const I = this.getNow() - this.lastBeforeInputTime < qA.BEFORE_INPUT_IGNORE_MS && this.lastBeforeInputData === g;
    return I && (this.lastBeforeInputData = null), I;
  }
  /**
   * Record beforeinput text for composition de-duplication
   */
  recordBeforeInputData(g) {
    this.lastBeforeInputData = g, this.lastBeforeInputTime = this.getNow();
  }
  /**
   * Record composition end data for beforeinput de-duplication
   */
  recordCompositionData(g) {
    this.lastCompositionData = g, this.lastCompositionTime = this.getNow();
  }
  /**
   * Check if paste should be ignored due to a recent paste event from another source
   */
  shouldIgnorePasteEvent(g, B) {
    if (!this.lastPasteData || this.lastPasteSource === B)
      return !1;
    const Q = this.getNow() - this.lastPasteTime < qA.BEFORE_INPUT_IGNORE_MS && this.lastPasteData === g;
    return Q && (this.lastPasteData = null, this.lastPasteSource = null), Q;
  }
  /**
   * Get current time in milliseconds
   */
  getNow() {
    return typeof performance < "u" && typeof performance.now == "function" ? performance.now() : Date.now();
  }
  /**
   * Dispose the InputHandler and remove event listeners
   */
  dispose() {
    this.isDisposed || (this.keydownListener && (this.container.removeEventListener("keydown", this.keydownListener), this.keydownListener = null), this.keyupListener && (this.container.removeEventListener("keyup", this.keyupListener), this.keyupListener = null), this.keypressListener && (this.container.removeEventListener("keypress", this.keypressListener), this.keypressListener = null), this.pasteListener && (this.container.removeEventListener("paste", this.pasteListener), this.inputElement && this.inputElement !== this.container && this.inputElement.removeEventListener("paste", this.pasteListener), this.pasteListener = null), this.beforeInputListener && this.inputElement && (this.inputElement.removeEventListener("beforeinput", this.beforeInputListener), this.beforeInputListener = null), this.compositionStartListener && (this.container.removeEventListener("compositionstart", this.compositionStartListener), this.compositionStartListener = null), this.compositionUpdateListener && (this.container.removeEventListener("compositionupdate", this.compositionUpdateListener), this.compositionUpdateListener = null), this.compositionEndListener && (this.container.removeEventListener("compositionend", this.compositionEndListener), this.compositionEndListener = null), this.mousedownListener && (this.container.removeEventListener("mousedown", this.mousedownListener), this.mousedownListener = null), this.mouseupListener && (this.container.removeEventListener("mouseup", this.mouseupListener), this.mouseupListener = null), this.mousemoveListener && (this.container.removeEventListener("mousemove", this.mousemoveListener), this.mousemoveListener = null), this.wheelListener && (this.container.removeEventListener("wheel", this.wheelListener), this.wheelListener = null), this.isDisposed = !0);
  }
  /**
   * Check if handler is disposed
   */
  isActive() {
    return !this.isDisposed;
  }
};
BQ.BEFORE_INPUT_IGNORE_MS = 100;
let Gi = BQ;
class ci {
  // Terminal instance for buffer access
  constructor(g) {
    this.terminal = g, this.providers = [], this.linkCache = /* @__PURE__ */ new Map(), this.scannedRows = /* @__PURE__ */ new Set();
  }
  /**
   * Register a link provider
   */
  registerProvider(g) {
    this.providers.push(g), this.invalidateCache();
  }
  /**
   * Get link at the specified buffer position
   * @param col Column (0-based)
   * @param row Absolute row in buffer (0-based)
   * @returns Link at position, or undefined if none
   */
  async getLinkAt(g, B) {
    const I = this.terminal.buffer.active.getLine(B);
    if (!(!I || g < 0 || g >= I.length || !I.getCell(g))) {
      for (const C of this.linkCache.values())
        if (this.isPositionInLink(g, B, C))
          return C;
      this.scannedRows.has(B) || await this.scanRow(B);
      for (const C of this.linkCache.values())
        if (this.isPositionInLink(g, B, C))
          return C;
    }
  }
  /**
   * Scan a row for links using all registered providers
   */
  async scanRow(g) {
    this.scannedRows.add(g);
    const B = [];
    for (const I of this.providers) {
      const Q = await new Promise((C) => {
        I.provideLinks(g, C);
      });
      Q && B.push(...Q);
    }
    for (const I of B)
      this.cacheLink(I);
  }
  /**
   * Cache a link for fast lookup
   *
   * Note: We cache by position range, not hyperlink_id, because the WASM
   * returns hyperlink_id as a boolean (0 or 1), not a unique identifier.
   * The actual unique identifier is the URI which is retrieved separately.
   */
  cacheLink(g) {
    const { start: B, end: I } = g.range, Q = `r${B.y}:${B.x}-${I.x}`;
    this.linkCache.has(Q) || this.linkCache.set(Q, g);
  }
  /**
   * Check if a position is within a link's range
   */
  isPositionInLink(g, B, I) {
    const { start: Q, end: C } = I.range;
    return B < Q.y || B > C.y ? !1 : Q.y === C.y ? g >= Q.x && g <= C.x : B === Q.y ? g >= Q.x : B === C.y ? g <= C.x : !0;
  }
  /**
   * Invalidate cache when terminal content changes
   * Should be called on terminal write, resize, or clear
   */
  invalidateCache() {
    this.linkCache.clear(), this.scannedRows.clear();
  }
  /**
   * Invalidate cache for specific rows
   * Used when only part of the terminal changed
   */
  invalidateRows(g, B) {
    for (let Q = g; Q <= B; Q++)
      this.scannedRows.delete(Q);
    const I = [];
    for (const [Q, C] of this.linkCache.entries()) {
      const { start: E, end: i } = C.range;
      (E.y >= g && E.y <= B || i.y >= g && i.y <= B || E.y < g && i.y > B) && I.push(Q);
    }
    for (const Q of I)
      this.linkCache.delete(Q);
  }
  /**
   * Dispose and cleanup
   */
  dispose() {
    var g;
    this.linkCache.clear(), this.scannedRows.clear();
    for (const B of this.providers)
      (g = B.dispose) == null || g.call(B);
    this.providers = [];
  }
}
class ki {
  constructor(g) {
    this.terminal = g;
  }
  /**
   * Provide all OSC 8 links on the given row
   * Note: This may return links that span multiple rows
   */
  provideLinks(g, B) {
    const I = [], Q = /* @__PURE__ */ new Set(), C = this.terminal.buffer.active.getLine(g);
    if (!C) {
      B(void 0);
      return;
    }
    for (let E = 0; E < C.length; E++) {
      if (Q.has(E))
        continue;
      const i = C.getCell(E);
      if (!i || i.getHyperlinkId() === 0 || !this.terminal.wasmTerm)
        continue;
      const o = this.terminal.wasmTerm.getScrollbackLength(), w = g - o;
      let t;
      if (w < 0 ? t = this.terminal.wasmTerm.getScrollbackHyperlinkUri(g, E) : t = this.terminal.wasmTerm.getHyperlinkUri(w, E), t) {
        let e = E;
        for (let a = E + 1; a < C.length; a++) {
          const k = C.getCell(a);
          if (!k || k.getHyperlinkId() === 0 || (w < 0 ? this.terminal.wasmTerm.getScrollbackHyperlinkUri(g, a) : this.terminal.wasmTerm.getHyperlinkUri(w, a)) !== t)
            break;
          e = a;
        }
        for (let a = E; a <= e; a++)
          Q.add(a);
        const s = {
          start: { x: E, y: g },
          end: { x: e, y: g }
        };
        I.push({
          text: t,
          range: s,
          activate: (a) => {
            (a.ctrlKey || a.metaKey) && window.open(t, "_blank", "noopener,noreferrer");
          }
        });
      }
    }
    B(I.length > 0 ? I : void 0);
  }
  /**
   * Find the full extent of a link by scanning for contiguous cells
   * with the same hyperlink_id. Handles multi-line links.
   */
  findLinkRange(g, B, I) {
    const Q = this.terminal.buffer.active;
    let C = B, E = I;
    for (; E > 0; ) {
      const w = Q.getLine(C);
      if (!w)
        break;
      const t = w.getCell(E - 1);
      if (!t || t.getHyperlinkId() !== g)
        break;
      E--;
    }
    if (E === 0 && C > 0) {
      let w = C - 1;
      for (; w >= 0; ) {
        const t = Q.getLine(w);
        if (!t || t.length === 0)
          break;
        const e = t.getCell(t.length - 1);
        if (!e || e.getHyperlinkId() !== g)
          break;
        C = w, E = 0;
        for (let s = t.length - 1; s >= 0; s--) {
          const a = t.getCell(s);
          if (!a || a.getHyperlinkId() !== g) {
            E = s + 1;
            break;
          }
        }
        if (E === 0)
          w--;
        else
          break;
      }
    }
    let i = B, D = I;
    const o = Q.getLine(i);
    if (o) {
      for (; D < o.length - 1; ) {
        const w = o.getCell(D + 1);
        if (!w || w.getHyperlinkId() !== g)
          break;
        D++;
      }
      if (D === o.length - 1) {
        let w = i + 1;
        const t = Q.length;
        for (; w < t; ) {
          const e = Q.getLine(w);
          if (!e || e.length === 0)
            break;
          const s = e.getCell(0);
          if (!s || s.getHyperlinkId() !== g)
            break;
          i = w, D = 0;
          for (let a = 0; a < e.length; a++) {
            const k = e.getCell(a);
            if (!k)
              break;
            if (k.getHyperlinkId() !== g) {
              D = a - 1;
              break;
            }
            D = a;
          }
          if (D === e.length - 1)
            w++;
          else
            break;
        }
      }
    }
    return {
      start: { x: E, y: C },
      end: { x: D, y: i }
    };
  }
  dispose() {
  }
}
const Eg = class LA {
  constructor(g) {
    this.terminal = g;
  }
  /**
   * Provide all regex-detected URLs on the given row
   */
  provideLinks(g, B) {
    const I = [], Q = this.terminal.buffer.active.getLine(g);
    if (!Q) {
      B(void 0);
      return;
    }
    const C = this.lineToText(Q);
    LA.URL_REGEX.lastIndex = 0;
    let E = LA.URL_REGEX.exec(C);
    for (; E !== null; ) {
      let i = E[0];
      const D = E.index;
      let o = E.index + i.length - 1;
      const w = i.replace(LA.TRAILING_PUNCTUATION, "");
      w.length < i.length && (i = w, o = D + i.length - 1), i.length > 8 && I.push({
        text: i,
        range: {
          start: { x: D, y: g },
          end: { x: o, y: g }
        },
        activate: (t) => {
          (t.ctrlKey || t.metaKey) && window.open(i, "_blank", "noopener,noreferrer");
        }
      }), E = LA.URL_REGEX.exec(C);
    }
    B(I.length > 0 ? I : void 0);
  }
  /**
   * Convert a buffer line to plain text string
   */
  lineToText(g) {
    const B = [];
    for (let I = 0; I < g.length; I++) {
      const Q = g.getCell(I);
      if (!Q) {
        B.push(" ");
        continue;
      }
      const C = Q.getCodepoint();
      C === 0 || C < 32 ? B.push(" ") : B.push(String.fromCodePoint(C));
    }
    return B.join("");
  }
  dispose() {
  }
};
Eg.URL_REGEX = /(?:https?:\/\/|mailto:|ftp:\/\/|ssh:\/\/|git:\/\/|tel:|magnet:|gemini:\/\/|gopher:\/\/|news:)[\w\-.~:\/?#@!$&*+,;=%]+/gi;
Eg.TRAILING_PUNCTUATION = /[.,;!?)\]]+$/;
let Mi = Eg;
const Ni = [
  773,
  781,
  782,
  784,
  786,
  829,
  830,
  831,
  838,
  842,
  843,
  844,
  848,
  849,
  850,
  855,
  859,
  867,
  868,
  869,
  870,
  871,
  872,
  873,
  874,
  875,
  876,
  877,
  878,
  879,
  1155,
  1156,
  1157,
  1158,
  1159,
  1426,
  1427,
  1428,
  1429,
  1431,
  1432,
  1433,
  1436,
  1437,
  1438,
  1439,
  1440,
  1441,
  1448,
  1449,
  1451,
  1452,
  1455,
  1476,
  1552,
  1553,
  1554,
  1555,
  1556,
  1557,
  1558,
  1559,
  1623,
  1624,
  1625,
  1626,
  1627,
  1629,
  1630,
  1750,
  1751,
  1752,
  1753,
  1754,
  1755,
  1756,
  1759,
  1760,
  1761,
  1762,
  1764,
  1767,
  1768,
  1771,
  1772,
  1840,
  1842,
  1843,
  1845,
  1846,
  1850,
  1853,
  1855,
  1856,
  1857,
  1859,
  1861,
  1863,
  1865,
  1866,
  2027,
  2028,
  2029,
  2030,
  2031,
  2032,
  2033,
  2035,
  2070,
  2071,
  2072,
  2073,
  2075,
  2076,
  2077,
  2078,
  2079,
  2080,
  2081,
  2082,
  2083,
  2085,
  2086,
  2087,
  2089,
  2090,
  2091,
  2092,
  2093,
  2385,
  2387,
  2388,
  3970,
  3971,
  3974,
  3975,
  4957,
  4958,
  4959,
  6109,
  6458,
  6679,
  6773,
  6774,
  6775,
  6776,
  6777,
  6778,
  6779,
  6780,
  7019,
  7021,
  7022,
  7023,
  7024,
  7025,
  7026,
  7027,
  7376,
  7377,
  7378,
  7386,
  7387,
  7392,
  7616,
  7617,
  7619,
  7620,
  7621,
  7622,
  7623,
  7624,
  7625,
  7627,
  7628,
  7633,
  7634,
  7635,
  7636,
  7637,
  7638,
  7639,
  7640,
  7641,
  7642,
  7643,
  7644,
  7645,
  7646,
  7647,
  7648,
  7649,
  7650,
  7651,
  7652,
  7653,
  7654,
  7678,
  8400,
  8401,
  8404,
  8405,
  8406,
  8407,
  8411,
  8412,
  8417,
  8423,
  8425,
  8432,
  11503,
  11504,
  11505,
  11744,
  11745,
  11746,
  11747,
  11748,
  11749,
  11750,
  11751,
  11752,
  11753,
  11754,
  11755,
  11756,
  11757,
  11758,
  11759,
  11760,
  11761,
  11762,
  11763,
  11764,
  11765,
  11766,
  11767,
  11768,
  11769,
  11770,
  11771,
  11772,
  11773,
  11774,
  11775,
  42607,
  42620,
  42621,
  42736,
  42737,
  43232,
  43233,
  43234,
  43235,
  43236,
  43237,
  43238,
  43239,
  43240,
  43241,
  43242,
  43243,
  43244,
  43245,
  43246,
  43247,
  43248,
  43249,
  43696,
  43698,
  43699,
  43703,
  43704,
  43710,
  43711,
  43713,
  65056,
  65057,
  65058,
  65059,
  65060,
  65061,
  65062,
  68111,
  68152,
  119173,
  119174,
  119175,
  119176,
  119177,
  119210,
  119211,
  119212,
  119213,
  119362,
  119363,
  119364
], ri = new Map(Ni.map((A, g) => [A, g]));
function dB(A) {
  return ri.get(A) ?? -1;
}
const Ji = 1109742, II = {
  foreground: "#d4d4d4",
  background: "#1e1e1e",
  cursor: "#ffffff",
  cursorAccent: "#1e1e1e",
  // Selection colors: solid colors that replace cell bg/fg when selected
  // Using Ghostty's approach: selection bg = default fg, selection fg = default bg
  selectionBackground: "#d4d4d4",
  selectionForeground: "#1e1e1e",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff"
};
function kSig(A) {
  let g = A.length >>> 0;
  const B = Math.max(1, A.length >> 5 | 0);
  for (let I = 0; I < A.length; I += B)
    g = Math.imul(g, 31) + A[I] >>> 0;
  return A.length > 0 ? Math.imul(g, 31) + A[A.length - 1] >>> 0 : g;
}
function QI(A, g) {
  return A.width === g.width && A.height === g.height && A.format === g.format && A.dataPtr === g.data.byteOffset && A.dataLen === g.data.length && A.sig === kSig(g.data);
}
class ni {
  constructor(g, B = {}) {
    this.cursorVisible = !0, this.lastCursorPosition = { x: 0, y: 0 }, this.lastViewportY = 0, this.currentBuffer = null, this.kittyImageCache = /* @__PURE__ */ new Map(), this.kittyVirtualPlacements = /* @__PURE__ */ new Map(), this.currentDirectPlacements = [], this.lastKittyDirectSigs = /* @__PURE__ */ new Map(), this.kittyDamagedRows = /* @__PURE__ */ new Set(), this.currentRenderBuffer = null, this.currentKittyGraphics = null, this.currentSelectionCoords = null, this.hoveredHyperlinkId = 0, this.previousHoveredHyperlinkId = 0, this.hoveredLinkRange = null, this.previousHoveredLinkRange = null, this.canvas = g;
    const I = g.getContext("2d", { alpha: !0 });
    if (!I)
      throw new Error("Failed to get 2D rendering context");
    this.ctx = I, this.fontSize = B.fontSize ?? 15, this.fontFamily = B.fontFamily ?? "monospace", this.cursorStyle = B.cursorStyle ?? "block", this.cursorBlink = B.cursorBlink ?? !1, this.theme = { ...II, ...B.theme }, this.devicePixelRatio = B.devicePixelRatio ?? window.devicePixelRatio ?? 1, this.palette = [
      this.theme.black,
      this.theme.red,
      this.theme.green,
      this.theme.yellow,
      this.theme.blue,
      this.theme.magenta,
      this.theme.cyan,
      this.theme.white,
      this.theme.brightBlack,
      this.theme.brightRed,
      this.theme.brightGreen,
      this.theme.brightYellow,
      this.theme.brightBlue,
      this.theme.brightMagenta,
      this.theme.brightCyan,
      this.theme.brightWhite
    ], this.metrics = this.measureFont(), this.cursorBlink && this.startCursorBlink();
  }
  // ==========================================================================
  // Font Metrics Measurement
  // ==========================================================================
  measureFont() {
    const B = document.createElement("canvas").getContext("2d");
    B.font = `${this.fontSize}px ${this.fontFamily}`;
    const I = B.measureText("M"), Q = Math.ceil(I.width);
    let C = I.fontBoundingBoxAscent, E = I.fontBoundingBoxDescent;
    if (!(C > 0) || !(E > 0)) {
      const G = B.measureText("Mg|_j");
      C = G.actualBoundingBoxAscent, E = G.actualBoundingBoxDescent;
    }
    C > 0 || (C = this.fontSize * 0.8), E > 0 || (E = this.fontSize * 0.2);
    const i = Math.ceil(C + E), D = Math.round(C);
    return { width: Q, height: i, baseline: D };
  }
  /**
   * Remeasure font metrics (call after font loads or changes)
   */
  remeasureFont() {
    this.metrics = this.measureFont();
  }
  // ==========================================================================
  // Color Conversion
  // ==========================================================================
  rgbToCSS(g, B, I) {
    return `rgb(${g}, ${B}, ${I})`;
  }
  // ==========================================================================
  // Canvas Sizing
  // ==========================================================================
  /**
   * Resize canvas to fit terminal dimensions
   */
  resize(g, B) {
    const I = g * this.metrics.width, Q = B * this.metrics.height;
    this.canvas.style.width = `${I}px`, this.canvas.style.height = `${Q}px`, this.canvas.width = I * this.devicePixelRatio, this.canvas.height = Q * this.devicePixelRatio, this.ctx.scale(this.devicePixelRatio, this.devicePixelRatio), this.ctx.textBaseline = "alphabetic", this.ctx.textAlign = "left", this.__sipRenderHook ? this.ctx.clearRect(0, 0, I, Q) : (this.ctx.fillStyle = this.theme.background, this.ctx.fillRect(0, 0, I, Q));
  }
  // ==========================================================================
  // Main Rendering
  // ==========================================================================
  /**
   * Render the terminal buffer to canvas
   */
  render(g, B = !1, I = 0, Q, C = 1) {
    var n;
    this.__sipLastFontIdx = -1; this.__sipLastFill = null; this.__sipLastFillPacked = -1;
    this.currentBuffer = g, this.currentRenderBuffer = g, this.currentViewportY = I;
    const E = g.getCursor(), i = g.getDimensions();
    this.precomputeKittyState(g, i.rows);
    const D = Q ? Q.getScrollbackLength() : 0;
    (n = g.needsFullRedraw) != null && n.call(g) && (B = !0), (this.canvas.width !== i.cols * this.metrics.width * this.devicePixelRatio || this.canvas.height !== i.rows * this.metrics.height * this.devicePixelRatio) && (this.resize(i.cols, i.rows), B = !0), I !== this.lastViewportY && (B = !0, this.lastViewportY = I);
    const w = E.x !== this.lastCursorPosition.x || E.y !== this.lastCursorPosition.y;
    if (w || this.cursorBlink) {
      if (!B && !g.isRowDirty(E.y)) {
        const c = g.getLine(E.y);
        c && this.renderLine(c, E.y, i.cols);
      }
      if (w && this.lastCursorPosition.y !== E.y && !B && !g.isRowDirty(this.lastCursorPosition.y)) {
        const c = g.getLine(this.lastCursorPosition.y);
        c && this.renderLine(c, this.lastCursorPosition.y, i.cols);
      }
    }
    const t = this.selectionManager && this.selectionManager.hasSelection(), e = /* @__PURE__ */ new Set();
    if (this.currentSelectionCoords = t ? this.selectionManager.getSelectionCoords() : null, this.currentSelectionCoords) {
      const c = this.currentSelectionCoords;
      for (let G = c.startRow; G <= c.endRow; G++)
        e.add(G);
    }
    if (this.selectionManager) {
      const c = this.selectionManager.getDirtySelectionRows();
      if (c.size > 0) {
        for (const G of c)
          e.add(G);
        this.selectionManager.clearDirtySelectionRows();
      }
    }
    const s = /* @__PURE__ */ new Set(), a = this.hoveredHyperlinkId !== this.previousHoveredHyperlinkId, k = this.__sipLinkRangeChanged(this.hoveredLinkRange, this.previousHoveredLinkRange);
    if (a) {
      for (let c = 0; c < i.rows; c++) {
        let G = null;
        if (I > 0)
          if (c < I && Q) {
            const J = D - Math.floor(I) + c;
            G = Q.getScrollbackLine(J);
          } else {
            const J = c - Math.floor(I);
            G = g.getLine(J);
          }
        else
          G = g.getLine(c);
        if (G) {
          for (const J of G)
            if (J.hyperlink_id === this.hoveredHyperlinkId || J.hyperlink_id === this.previousHoveredHyperlinkId) {
              s.add(c);
              break;
            }
        }
      }
      this.previousHoveredHyperlinkId = this.hoveredHyperlinkId;
    }
    if (k) {
      if (this.previousHoveredLinkRange)
        for (let c = this.previousHoveredLinkRange.startY; c <= this.previousHoveredLinkRange.endY; c++)
          s.add(c);
      if (this.hoveredLinkRange)
        for (let c = this.hoveredLinkRange.startY; c <= this.hoveredLinkRange.endY; c++)
          s.add(c);
      this.previousHoveredLinkRange = this.hoveredLinkRange;
    }
    let M = !1;
    const N = /* @__PURE__ */ new Set();
    for (let c = 0; c < i.rows; c++)
      (I > 0 ? !0 : B || g.isRowDirty(c) || e.has(c) || s.has(c) || this.kittyDamagedRows.has(c)) && (N.add(c), c > 0 && N.add(c - 1), c < i.rows - 1 && N.add(c + 1));
    for (let c = 0; c < i.rows; c++) {
      if (!N.has(c))
        continue;
      M = !0;
      let G = null;
      // __sip: under the vtgl hook renderLine only clears the 2D overlay row
      // and never reads the cells, so skip the getLine that would otherwise
      // pull the row out of a full viewport walk for nothing.
      if (this.__sipRenderHook) {
        this.renderLine(null, c, i.cols);
        continue;
      }
      if (I > 0)
        if (c < I && Q) {
          const J = D - Math.floor(I) + c;
          G = Q.getScrollbackLine(J);
        } else {
          const J = I > 0 ? c - Math.floor(I) : c;
          G = g.getLine(J);
        }
      else
        G = g.getLine(c);
      G && this.renderLine(G, c, i.cols);
    }
    this.__sipRenderHook && this.__sipRenderHook(g, B, I, Q);
    this.currentDirectPlacements.length > 0 && M && this.renderKittyImages(I), I === 0 && E.visible && this.cursorVisible && this.renderCursor(E.x, E.y), Q && C > 0 && this.renderScrollbar(I, D, i.rows, C), this.lastCursorPosition = { x: E.x, y: E.y }, g.clearDirty();
  }
  /**
   * Render a single line using two-pass approach:
   * 1. First pass: Draw all cell backgrounds
   * 2. Second pass: Draw all cell text and decorations
   *
   * This two-pass approach is necessary for proper rendering of complex scripts
   * like Devanagari where diacritics (like vowel sign ि) can extend LEFT of the
   * base character into the previous cell's visual area. If we draw backgrounds
   * and text in a single pass (cell by cell), the background of cell N would
   * cover any left-extending portions of graphemes from cell N-1.
   */
  /**
   * __sip: compare two hovered-link ranges by field.
   *
   * This ran as two JSON.stringify calls per frame to compare two small
   * objects. Constant cost rather than a hot one, but a serializer has no
   * business in a per-frame path.
   */
  __sipLinkRangeChanged(g, B) {
    return g === B ? !1 : !g || !B ? !0 : g.startX !== B.startX || g.startY !== B.startY || g.endX !== B.endX || g.endY !== B.endY;
  }
  renderLine(g, B, I) {
    const Q = B * this.metrics.height, C = I * this.metrics.width;
    if (this.__sipRenderHook) { this.ctx.clearRect(0, Q, C, this.metrics.height); return; }
    this.ctx.clearRect(0, Q, C, this.metrics.height), this.ctx.fillStyle = this.theme.background, this.ctx.fillRect(0, Q, C, this.metrics.height);
    for (let E = 0; E < g.length; E++) {
      const i = g[E];
      i.width !== 0 && this.renderCellBackground(i, E, B);
    }
    for (let E = 0; E < g.length; E++) {
      const i = g[E];
      i.width !== 0 && this.renderCellText(i, E, B);
    }
  }
  /**
   * Render a cell's background only (Pass 1 of two-pass rendering)
   * Selection highlighting is integrated here to avoid z-order issues with
   * complex glyphs (like Devanagari) that extend outside their cell bounds.
   */
  renderCellBackground(g, B, I) {
    const Q = B * this.metrics.width, C = I * this.metrics.height, E = this.metrics.width * g.width;
    if (this.isInSelection(B, I)) {
      const sel = this.theme.selectionBackground;
      if (this.__sipLastFill !== sel) { this.ctx.fillStyle = sel; this.__sipLastFill = sel; }
      this.ctx.fillRect(Q, C, E, this.metrics.height);
      return;
    }
    let D = g.bg_r, o = g.bg_g, w = g.bg_b;
    g.flags & l.INVERSE && (D = g.fg_r, o = g.fg_g, w = g.fg_b);
    if (!(D === 0 && o === 0 && w === 0)) {
      const css = this.rgbToCSS(D, o, w);
      if (this.__sipLastFill !== css) { this.ctx.fillStyle = css; this.__sipLastFill = css; }
      this.ctx.fillRect(Q, C, E, this.metrics.height);
    }
  }
  /**
   * Render a cell's text and decorations (Pass 2 of two-pass rendering)
   * Selection foreground color is applied here to match the selection background.
   */
  renderCellText(g, B, I, Q) {
    var s;
    const C = B * this.metrics.width, E = I * this.metrics.height, i = this.metrics.width * g.width;
    if (g.codepoint === Ji && this.renderPlaceholderCell(g, B, I) || g.flags & l.INVISIBLE)
      return;
    const D = this.isInSelection(B, I);
    const styleIdx = g.flags & 3;
    if (!this.__sipFontStrs || this.__sipFontFor !== (this.fontSize + "|" + this.fontFamily)) {
      const fs = this.fontSize, ff = this.fontFamily;
      this.__sipFontStrs = [
        fs + "px " + ff,
        "bold " + fs + "px " + ff,
        "italic " + fs + "px " + ff,
        "italic bold " + fs + "px " + ff,
      ];
      this.__sipFontFor = fs + "|" + ff;
      this.__sipLastFontIdx = -1;
    }
    if (this.__sipLastFontIdx !== styleIdx) {
      this.ctx.font = this.__sipFontStrs[styleIdx];
      this.__sipLastFontIdx = styleIdx;
    }
    let fillStr;
    if (Q) fillStr = Q;
    else if (D) fillStr = this.theme.selectionForeground;
    else {
      let a = g.fg_r, k = g.fg_g, M = g.fg_b;
      if (g.flags & l.INVERSE) { a = g.bg_r; k = g.bg_g; M = g.bg_b; }
      if (a === 0 && k === 0 && M === 0) fillStr = this.theme.foreground;
      else {
        const packed = (a << 16) | (k << 8) | M;
        if (this.__sipLastFillPacked === packed && this.__sipLastFillStr) fillStr = this.__sipLastFillStr;
        else { fillStr = this.rgbToCSS(a, k, M); this.__sipLastFillPacked = packed; this.__sipLastFillStr = fillStr; }
      }
    }
    if (this.__sipLastFill !== fillStr) { this.ctx.fillStyle = fillStr; this.__sipLastFill = fillStr; }
    g.flags & l.FAINT && (this.ctx.globalAlpha = 0.5);
    const w = C, t = E + this.metrics.baseline;
    let e;
    if (g.grapheme_len > 0 && ((s = this.currentBuffer) != null && s.getGraphemeString) ? e = this.currentBuffer.getGraphemeString(I, B) : e = String.fromCodePoint(g.codepoint || 32), (g.grapheme_len === 0 && (g.codepoint === 32 || g.codepoint === 0) ? void 0 : this.ctx.fillText(e, w, t)), g.flags & l.FAINT && (this.ctx.globalAlpha = 1), g.flags & l.UNDERLINE) {
      const a = E + this.metrics.baseline + 2;
      this.ctx.strokeStyle = this.ctx.fillStyle, this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(C, a), this.ctx.lineTo(C + i, a), this.ctx.stroke();
    }
    if (g.flags & l.STRIKETHROUGH) {
      const a = E + this.metrics.height / 2;
      this.ctx.strokeStyle = this.ctx.fillStyle, this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(C, a), this.ctx.lineTo(C + i, a), this.ctx.stroke();
    }
    if (g.hyperlink_id > 0 && g.hyperlink_id === this.hoveredHyperlinkId) {
      const k = E + this.metrics.baseline + 2;
      this.ctx.strokeStyle = "#4A90E2", this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(C, k), this.ctx.lineTo(C + i, k), this.ctx.stroke();
    }
    if (this.hoveredLinkRange) {
      const a = this.hoveredLinkRange;
      if (I === a.startY && B >= a.startX && (I < a.endY || B <= a.endX) || I > a.startY && I < a.endY || I === a.endY && B <= a.endX && (I > a.startY || B >= a.startX)) {
        const M = E + this.metrics.baseline + 2;
        this.ctx.strokeStyle = "#4A90E2", this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(C, M), this.ctx.lineTo(C + i, M), this.ctx.stroke();
      }
    }
  }
  /**
   * Composite all visible kitty graphics placements onto the canvas.
   * Cheap when no graphics are active (one method check, one terminal_get).
   * Decode work is amortized across frames via kittyImageCache.
   */
  /**
   * Walk the placement iterator once at frame start, partitioning the
   * results: virtual placements go into kittyVirtualPlacements (keyed
   * by image id) for placeholder-cell lookup; direct visible placements
   * stay implicit and get re-iterated by renderKittyImages later.
   *
   * Also caches the storage handle for renderPlaceholderCell so the
   * per-cell hot path doesn't have to re-resolve it.
   */
  precomputeKittyState(g, B) {
    var E;
    this.kittyVirtualPlacements.clear(), this.currentDirectPlacements = [], this.kittyDamagedRows.clear(), this.currentKittyGraphics = null;
    const I = /* @__PURE__ */ new Map(), Q = this.metrics.height, C = (i, D) => {
      const o = Math.max(0, Math.floor(i)), w = Math.min(B, Math.ceil(i + D / Q));
      for (let t = o; t < w; t++)
        this.kittyDamagedRows.add(t);
    };
    if (g.getKittyGraphics && g.iterPlacements) {
      const i = g.getKittyGraphics();
      if (i !== null) {
        this.currentKittyGraphics = i;
        for (const D of g.iterPlacements(i, !1)) {
          if (D.isVirtual) {
            this.kittyVirtualPlacements.set(D.imageId, D);
            continue;
          }
          this.currentDirectPlacements.push(D);
          const o = (E = g.getKittyImagePixels) == null ? void 0 : E.call(g, i, D.imageId), w = {
            viewportCol: D.viewportCol,
            viewportRow: D.viewportRow,
            pixelWidth: D.pixelWidth,
            pixelHeight: D.pixelHeight,
            sourceX: D.sourceX,
            sourceY: D.sourceY,
            sourceWidth: D.sourceWidth,
            sourceHeight: D.sourceHeight,
            imgWidth: (o == null ? void 0 : o.width) ?? 0,
            imgHeight: (o == null ? void 0 : o.height) ?? 0,
            imgFormat: (o == null ? void 0 : o.format) ?? 0,
            dataPtr: (o == null ? void 0 : o.data.byteOffset) ?? 0,
            dataLen: (o == null ? void 0 : o.data.length) ?? 0,
            imgSig: o == null ? 0 : kSig(o.data)
          };
          I.set(D.imageId, w);
          const t = this.lastKittyDirectSigs.get(D.imageId);
          (!t || t.viewportCol !== w.viewportCol || t.viewportRow !== w.viewportRow || t.pixelWidth !== w.pixelWidth || t.pixelHeight !== w.pixelHeight || t.sourceX !== w.sourceX || t.sourceY !== w.sourceY || t.sourceWidth !== w.sourceWidth || t.sourceHeight !== w.sourceHeight || t.imgWidth !== w.imgWidth || t.imgHeight !== w.imgHeight || t.imgFormat !== w.imgFormat || t.dataPtr !== w.dataPtr || t.dataLen !== w.dataLen || t.imgSig !== w.imgSig) && (C(w.viewportRow, w.pixelHeight), t && C(t.viewportRow, t.pixelHeight));
        }
      }
    }
    for (const [i, D] of this.lastKittyDirectSigs)
      I.has(i) || C(D.viewportRow, D.pixelHeight);
    this.lastKittyDirectSigs = I;
    if (this.kittyImageCache.size > 0) {
      const live = /* @__PURE__ */ new Set(this.kittyVirtualPlacements.keys());
      for (const D of this.currentDirectPlacements)
        live.add(D.imageId);
      for (const id of this.kittyImageCache.keys())
        live.has(id) || this.kittyImageCache.delete(id);
    }
  }
  /**
   * Get (or decode + cache) the canvas-ready bitmap for a kitty image.
   * Returns null if the image isn't stored or decode fails. Shared by
   * renderKittyImages (direct placements) and renderPlaceholderCell
   * (unicode-placeholder cells).
   */
  getOrDecodeKittyImage(g, B, I) {
    var i;
    const Q = this.kittyImageCache.get(I), C = (i = g.getKittyImagePixels) == null ? void 0 : i.call(g, B, I);
    if (!C)
      return (Q == null ? void 0 : Q.canvas) ?? null;
    if (Q && QI(Q, C))
      return Q.canvas;
    const E = this.decodeKittyImageToCanvas(C);
    return E ? (this.kittyImageCache.set(I, {
      canvas: E,
      width: C.width,
      height: C.height,
      format: C.format,
      dataPtr: C.data.byteOffset,
      dataLen: C.data.length,
      sig: kSig(C.data)
    }), E) : null;
  }
  /**
   * Substitute a cell's text rendering with a slice of a kitty graphics
   * image. Called from renderCellText when the cell's codepoint is
   * U+10EEEE.
   *
   * Decodes the image_id from cell.fg_*  (low 24 bits; high byte from
   * an optional third combining diacritic) and the row/col-of-image
   * from the first two combining diacritics on the cell. Looks up the
   * virtual placement (from precomputeKittyState) for grid dims, then
   * draws the matching slice scaled to one terminal cell.
   *
   * Returns true if the cell was handled as a placeholder; false to
   * fall through to normal text rendering (e.g., unknown image, no
   * matching virtual placement, or malformed diacritics).
   */
  renderPlaceholderCell(g, B, I) {
    var G;
    const Q = this.currentRenderBuffer, C = this.currentKittyGraphics;
    if (!Q || C === null || !Q.getGrapheme)
      return !1;
    const vy = Math.floor(this.currentViewportY || 0);
    let E;
    if (vy > 0 && I < vy) {
      const sb = Q.getScrollbackLength ? Q.getScrollbackLength() : 0;
      E = Q.getScrollbackGrapheme ? Q.getScrollbackGrapheme(sb - vy + I, B) : null;
    } else
      E = Q.getGrapheme(I - vy, B);
    if (!E || E.length < 3)
      return !1;
    const i = dB(E[1]), D = dB(E[2]);
    if (i < 0 || D < 0)
      return !1;
    const o = g.fg_r << 16 | g.fg_g << 8 | g.fg_b;
    let w = o;
    if (E.length >= 4) {
      const J = dB(E[3]);
      J >= 0 && (w = J << 24 | o);
    }
    const t = this.kittyVirtualPlacements.get(w);
    if (!t)
      return !1;
    const e = (G = Q.getKittyImagePixels) == null ? void 0 : G.call(Q, C, w);
    if (!e)
      return !1;
    const s = this.getOrDecodeKittyImage(Q, C, w);
    if (!s)
      return !1;
    const a = e.width / t.gridCols, k = e.height / t.gridRows, M = D * a, N = i * k, n = B * this.metrics.width, c = I * this.metrics.height;
    return this.ctx.drawImage(
      s,
      M,
      N,
      a,
      k,
      n,
      c,
      this.metrics.width,
      this.metrics.height
    ), !0;
  }
  renderKittyImages(vy = 0) {
    const g = this.currentRenderBuffer, B = this.currentKittyGraphics, S = Math.floor(vy || 0), rows = g ? g.getDimensions().rows : 0;
    if (!(!g || B === null || !g.getKittyImagePixels))
      for (const I of this.currentDirectPlacements) {
        let Q = this.kittyImageCache.get(I.imageId);
        const C = g.getKittyImagePixels(B, I.imageId);
        if (C) {
          const destRow = I.viewportRow + S, rowSpan = Math.ceil(I.pixelHeight / this.metrics.height);
          if (destRow + rowSpan <= 0 || destRow >= rows)
            continue;
          if (!Q || !QI(Q, C)) {
            const E = this.decodeKittyImageToCanvas(C);
            if (!E)
              continue;
            Q = {
              canvas: E,
              width: C.width,
              height: C.height,
              format: C.format,
              dataPtr: C.data.byteOffset,
              dataLen: C.data.length,
              sig: kSig(C.data)
            }, this.kittyImageCache.set(I.imageId, Q);
          }
          this.ctx.drawImage(
            Q.canvas,
            I.sourceX,
            I.sourceY,
            I.sourceWidth,
            I.sourceHeight,
            I.viewportCol * this.metrics.width,
            destRow * this.metrics.height,
            I.pixelWidth,
            I.pixelHeight
          );
        }
      }
  }
  /**
   * Decode a kitty graphics image into a canvas suitable for drawImage.
   * Expands non-RGBA formats into RGBA via putImageData; PNG payloads
   * (which require a JS-side decoder set up via ghostty_sys_set) are
   * not supported in this MVP and return null.
   */
  decodeKittyImageToCanvas(g) {
    const { width: B, height: I, format: Q, data: C } = g;
    if (B === 0 || I === 0)
      return null;
    const E = new Uint8ClampedArray(new ArrayBuffer(B * I * 4));
    switch (Q) {
      case RA.RGBA:
        E.set(C.length > E.length ? C.subarray(0, E.length) : C);
        break;
      case RA.RGB:
        for (let o = 0, w = 0; o < C.length; o += 3, w += 4)
          E[w] = C[o], E[w + 1] = C[o + 1], E[w + 2] = C[o + 2], E[w + 3] = 255;
        break;
      case RA.GRAY:
        for (let o = 0, w = 0; o < C.length; o++, w += 4) {
          const t = C[o];
          E[w] = t, E[w + 1] = t, E[w + 2] = t, E[w + 3] = 255;
        }
        break;
      case RA.GRAY_ALPHA:
        for (let o = 0, w = 0; o < C.length; o += 2, w += 4) {
          const t = C[o];
          E[w] = t, E[w + 1] = t, E[w + 2] = t, E[w + 3] = C[o + 1];
        }
        break;
      default:
        return null;
    }
    const i = document.createElement("canvas");
    i.width = B, i.height = I;
    const D = i.getContext("2d");
    return D ? (D.putImageData(new ImageData(E, B, I), 0, 0), i) : null;
  }
  /**
   * Render cursor
   */
  renderCursor(g, B) {
    var C;
    const I = g * this.metrics.width, Q = B * this.metrics.height;
    switch (this.ctx.fillStyle = this.theme.cursor, this.cursorStyle) {
      case "block":
        this.ctx.fillRect(I, Q, this.metrics.width, this.metrics.height);
        {
          const D = (C = this.currentBuffer) == null ? void 0 : C.getLine(B);
          D != null && D[g] && (this.ctx.save(), this.ctx.beginPath(), this.ctx.rect(I, Q, this.metrics.width, this.metrics.height), this.ctx.clip(), this.renderCellText(D[g], g, B, this.theme.cursorAccent), this.ctx.restore());
        }
        break;
      case "underline":
        const E = Math.max(2, Math.floor(this.metrics.height * 0.15));
        this.ctx.fillRect(
          I,
          Q + this.metrics.height - E,
          this.metrics.width,
          E
        );
        break;
      case "bar":
        const i = Math.max(2, Math.floor(this.metrics.width * 0.15));
        this.ctx.fillRect(I, Q, i, this.metrics.height);
        break;
    }
  }
  // ==========================================================================
  // Cursor Blinking
  // ==========================================================================
  startCursorBlink() {
    this.cursorBlinkInterval = window.setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
    }, 530);
  }
  stopCursorBlink() {
    this.cursorBlinkInterval !== void 0 && (clearInterval(this.cursorBlinkInterval), this.cursorBlinkInterval = void 0), this.cursorVisible = !0;
  }
  // ==========================================================================
  // Public API
  // ==========================================================================
  /**
   * Update theme colors
   */
  setTheme(g) {
    this.theme = { ...II, ...g }, this.palette = [
      this.theme.black,
      this.theme.red,
      this.theme.green,
      this.theme.yellow,
      this.theme.blue,
      this.theme.magenta,
      this.theme.cyan,
      this.theme.white,
      this.theme.brightBlack,
      this.theme.brightRed,
      this.theme.brightGreen,
      this.theme.brightYellow,
      this.theme.brightBlue,
      this.theme.brightMagenta,
      this.theme.brightCyan,
      this.theme.brightWhite
    ];
  }
  /**
   * Update font size
   */
  setFontSize(g) {
    this.fontSize = g, this.metrics = this.measureFont();
  }
  /**
   * Update font family
   */
  setFontFamily(g) {
    this.fontFamily = g, this.metrics = this.measureFont();
  }
  /**
   * Update cursor style
   */
  setCursorStyle(g) {
    this.cursorStyle = g;
  }
  /**
   * Enable/disable cursor blinking
   */
  setCursorBlink(g) {
    g && !this.cursorBlink ? (this.cursorBlink = !0, this.startCursorBlink()) : !g && this.cursorBlink && (this.cursorBlink = !1, this.stopCursorBlink());
  }
  /**
   * Get current font metrics
   */
  /**
   * Render scrollbar (Phase 2)
   * Shows scroll position and allows click/drag interaction
   * @param opacity Opacity level (0-1) for fade in/out effect
   */
  renderScrollbar(g, B, I, Q = 1) {
    const C = this.ctx, E = this.canvas.height / this.devicePixelRatio, i = this.canvas.width / this.devicePixelRatio, D = 8, o = i - D - 4, w = 4, t = E - w * 2;
    if (C.clearRect(o - 2, 0, D + 6, E), C.fillStyle = this.theme.background, C.fillRect(o - 2, 0, D + 6, E), Q <= 0 || B === 0)
      return;
    const e = B + I, s = Math.max(20, I / e * t), a = g / B, k = w + (t - s) * (1 - a);
    C.fillStyle = `rgba(128, 128, 128, ${0.1 * Q})`, C.fillRect(o, w, D, t);
    const N = g > 0 ? 0.5 : 0.3;
    C.fillStyle = `rgba(128, 128, 128, ${N * Q})`, C.fillRect(o, k, D, s);
  }
  getMetrics() {
    return { ...this.metrics };
  }
  /**
   * Get canvas element (needed by SelectionManager)
   */
  getCanvas() {
    return this.canvas;
  }
  /**
   * Set selection manager (for rendering selection)
   */
  setSelectionManager(g) {
    this.selectionManager = g;
  }
  /**
   * Check if a cell at (x, y) is within the current selection.
   * Uses cached selection coordinates for performance.
   */
  isInSelection(g, B) {
    const I = this.currentSelectionCoords;
    if (!I)
      return !1;
    const { startCol: Q, startRow: C, endCol: E, endRow: i } = I;
    return C === i ? B === C && g >= Q && g <= E : B === C ? g >= Q : B === i ? g <= E : B > C && B < i;
  }
  /**
   * Set the currently hovered hyperlink ID for rendering underlines
   */
  setHoveredHyperlinkId(g) {
    this.hoveredHyperlinkId = g;
  }
  /**
   * Set the currently hovered link range for rendering underlines (for regex-detected URLs)
   * Pass null to clear the hover state
   */
  setHoveredLinkRange(g) {
    this.hoveredLinkRange = g;
  }
  /**
   * Get character cell width (for coordinate conversion)
   */
  get charWidth() {
    return this.metrics.width;
  }
  /**
   * Get character cell height (for coordinate conversion)
   */
  get charHeight() {
    return this.metrics.height;
  }
  /**
   * Clear entire canvas
   */
  clear() {
    this.kittyImageCache.clear(), this.kittyVirtualPlacements.clear(), this.lastKittyDirectSigs.clear(), this.currentDirectPlacements = [], this.currentKittyGraphics = null, this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height), this.ctx.fillStyle = this.theme.background, this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
  /**
   * Cleanup resources
   */
  dispose() {
    this.stopCursorBlink();
  }
}
const GB = class oB {
  // ms between scroll steps
  constructor(g, B, I, Q) {
    this.selectionStart = null, this.selectionEnd = null, this.isSelecting = !1, this.mouseDownX = 0, this.mouseDownY = 0, this.dragThresholdMet = !1, this.mouseDownTarget = null, this.dirtySelectionRows = /* @__PURE__ */ new Set(), this.selectionChangedEmitter = new u(), this.boundMouseUpHandler = null, this.boundContextMenuHandler = null, this.boundClickHandler = null, this.boundDocumentMouseMoveHandler = null, this.autoScrollInterval = null, this.autoScrollDirection = 0, this.terminal = g, this.renderer = B, this.wasmTerm = I, this.textarea = Q, this.attachEventListeners();
  }
  // pixels from edge to trigger scroll
  /**
   * Get current viewport Y position (how many lines scrolled into history)
   */
  getViewportY() {
    const g = typeof this.terminal.getViewportY == "function" ? this.terminal.getViewportY() : this.terminal.viewportY || 0;
    return Math.max(0, Math.floor(g));
  }
  /**
   * Convert viewport row to absolute buffer row
   * Absolute row is an index into combined buffer: scrollback (0 to len-1) + screen (len to len+rows-1)
   */
  viewportRowToAbsolute(g) {
    const B = this.wasmTerm.getScrollbackLength(), I = this.getViewportY();
    return B + g - I;
  }
  /**
   * Convert absolute buffer row to viewport row (may be outside visible range)
   */
  absoluteRowToViewport(g) {
    const B = this.wasmTerm.getScrollbackLength(), I = this.getViewportY();
    return g - B + I;
  }
  // ==========================================================================
  // Public API
  // ==========================================================================
  /**
   * Get the selected text as a string
   */
  getSelection() {
    if (!this.selectionStart || !this.selectionEnd)
      return "";
    let { col: g, absoluteRow: B } = this.selectionStart, { col: I, absoluteRow: Q } = this.selectionEnd;
    (B > Q || B === Q && g > I) && ([g, I] = [I, g], [B, Q] = [Q, B]);
    const C = this.wasmTerm.getScrollbackLength();
    let E = "";
    for (let i = B; i <= Q; i++) {
      let D = null;
      if (i < C)
        D = this.wasmTerm.getScrollbackLine(i);
      else {
        const s = i - C;
        D = this.wasmTerm.getLine(s);
      }
      if (!D)
        continue;
      let o = -1;
      const w = i === B ? g : 0, t = i === Q ? I : D.length - 1;
      let e = "";
      for (let s = w; s <= t; s++) {
        const a = D[s];
        if (a && a.codepoint !== 0) {
          let k;
          if (a.grapheme_len > 0)
            if (i < C)
              k = this.wasmTerm.getScrollbackGraphemeString(i, s);
            else {
              const M = i - C;
              k = this.wasmTerm.getGraphemeString(M, s);
            }
          else
            k = String.fromCodePoint(a.codepoint);
          e += k, k.trim() && (o = e.length);
        } else if (!a || a.width !== 0)
          e += " ";
      }
      o >= 0 ? e = e.substring(0, o) : e = "", E += e, i < Q && (E += `
`);
    }
    return E;
  }
  /**
   * Check if there's an active selection
   */
  hasSelection() {
    return !(!this.selectionStart || !this.selectionEnd || this.isSelecting && !this.dragThresholdMet);
  }
  /**
   * Copy the current selection to clipboard
   * @returns true if there was text to copy, false otherwise
   */
  copySelection() {
    if (!this.hasSelection())
      return !1;
    const g = this.getSelection();
    return g ? (this.copyToClipboard(g), !0) : !1;
  }
  /**
   * Clear the selection
   */
  clearSelection() {
    if (!this.hasSelection())
      return;
    const g = this.normalizeSelection();
    if (g)
      for (let B = g.startRow; B <= g.endRow; B++)
        this.dirtySelectionRows.add(B);
    this.selectionStart = null, this.selectionEnd = null, this.isSelecting = !1, this.requestRender();
  }
  /**
   * Select all text in the terminal
   */
  selectAll() {
    const g = this.wasmTerm.getDimensions(), B = this.getViewportY();
    this.selectionStart = { col: 0, absoluteRow: B }, this.selectionEnd = { col: g.cols - 1, absoluteRow: B + g.rows - 1 }, this.requestRender(), this.selectionChangedEmitter.fire();
  }
  /**
   * Select text at specific column and row with length
   * xterm.js compatible API
   */
  select(g, B, I) {
    const Q = this.wasmTerm.getDimensions();
    B = Math.max(0, Math.min(B, Q.rows - 1)), g = Math.max(0, Math.min(g, Q.cols - 1));
    let C = B, E = g + I - 1;
    for (; E >= Q.cols; )
      E -= Q.cols, C++;
    C = Math.min(C, Q.rows - 1);
    const i = this.getViewportY();
    this.selectionStart = { col: g, absoluteRow: i + B }, this.selectionEnd = { col: E, absoluteRow: i + C }, this.requestRender(), this.selectionChangedEmitter.fire();
  }
  /**
   * Select entire lines from start to end
   * xterm.js compatible API
   */
  selectLines(g, B) {
    const I = this.wasmTerm.getDimensions();
    g = Math.max(0, Math.min(g, I.rows - 1)), B = Math.max(0, Math.min(B, I.rows - 1)), g > B && ([g, B] = [B, g]), this.selectionStart = { col: 0, absoluteRow: this.viewportRowToAbsolute(g) }, this.selectionEnd = { col: I.cols - 1, absoluteRow: this.viewportRowToAbsolute(B) }, this.requestRender(), this.selectionChangedEmitter.fire();
  }
  /**
   * Get selection position as buffer range
   * xterm.js compatible API
   */
  getSelectionPosition() {
    const g = this.normalizeSelection();
    if (g)
      return {
        start: { x: g.startCol, y: g.startRow },
        end: { x: g.endCol, y: g.endRow }
      };
  }
  /**
   * Deselect all text
   * xterm.js compatible API
   */
  deselect() {
    this.clearSelection(), this.selectionChangedEmitter.fire();
  }
  /**
   * Focus the terminal (make it receive keyboard input)
   */
  focus() {
    const g = this.renderer.getCanvas();
    g.parentElement && g.parentElement.focus();
  }
  /**
   * Get current selection coordinates (for rendering)
   */
  getSelectionCoords() {
    return this.normalizeSelection();
  }
  /**
   * Get dirty selection rows that need redraw (for clearing old highlight)
   */
  getDirtySelectionRows() {
    return this.dirtySelectionRows;
  }
  /**
   * Clear the dirty selection rows tracking (after redraw)
   */
  clearDirtySelectionRows() {
    this.dirtySelectionRows.clear();
  }
  /**
   * Get selection change event accessor
   */
  get onSelectionChange() {
    return this.selectionChangedEmitter.event;
  }
  /**
   * Cleanup resources
   */
  dispose() {
    this.selectionChangedEmitter.dispose(), this.stopAutoScroll(), this.boundMouseUpHandler && (document.removeEventListener("mouseup", this.boundMouseUpHandler), this.boundMouseUpHandler = null), this.boundDocumentMouseMoveHandler && (document.removeEventListener("mousemove", this.boundDocumentMouseMoveHandler), this.boundDocumentMouseMoveHandler = null), this.boundContextMenuHandler && (this.renderer.getCanvas().removeEventListener("contextmenu", this.boundContextMenuHandler), this.boundContextMenuHandler = null), this.boundClickHandler && (document.removeEventListener("click", this.boundClickHandler), this.boundClickHandler = null);
  }
  // ==========================================================================
  // Private Methods
  // ==========================================================================
  /**
   * Attach mouse event listeners to canvas
   */
  attachEventListeners() {
    const g = this.renderer.getCanvas();
    g.addEventListener("mousedown", (B) => {
      if (B.button === 0) {
        g.parentElement && g.parentElement.focus();
        const I = this.pixelToCell(B.offsetX, B.offsetY);
        this.hasSelection() && this.clearSelection();
        const C = this.viewportRowToAbsolute(I.row);
        this.selectionStart = { col: I.col, absoluteRow: C }, this.selectionEnd = { col: I.col, absoluteRow: C }, this.isSelecting = !0, this.mouseDownX = B.offsetX, this.mouseDownY = B.offsetY, this.dragThresholdMet = !1;
      }
    }), g.addEventListener("mousemove", (B) => {
      if (this.isSelecting) {
        if (!this.dragThresholdMet) {
          const C = B.offsetX - this.mouseDownX, E = B.offsetY - this.mouseDownY, i = this.renderer.getMetrics().width * 0.5;
          if (C * C + E * E < i * i)
            return;
          this.dragThresholdMet = !0;
        }
        this.markCurrentSelectionDirty();
        const I = this.pixelToCell(B.offsetX, B.offsetY), Q = this.viewportRowToAbsolute(I.row);
        this.selectionEnd = { col: I.col, absoluteRow: Q }, this.requestRender(), this.updateAutoScroll(B.offsetY, g.clientHeight);
      }
    }), g.addEventListener("mouseleave", (B) => {
      if (this.isSelecting) {
        const I = g.getBoundingClientRect();
        B.clientY < I.top ? this.startAutoScroll(-1) : B.clientY > I.bottom && this.startAutoScroll(1);
      }
    }), g.addEventListener("mouseenter", () => {
      this.isSelecting && this.stopAutoScroll();
    }), this.boundDocumentMouseMoveHandler = (B) => {
      if (this.isSelecting) {
        if (!this.dragThresholdMet) {
          const D = B.clientX - (g.getBoundingClientRect().left + this.mouseDownX), o = B.clientY - (g.getBoundingClientRect().top + this.mouseDownY), w = this.renderer.getMetrics().width * 0.5;
          if (D * D + o * o < w * w)
            return;
          this.dragThresholdMet = !0;
        }
        const I = g.getBoundingClientRect(), Q = Math.max(I.left, Math.min(B.clientX, I.right)), C = Math.max(I.top, Math.min(B.clientY, I.bottom)), E = Q - I.left, i = C - I.top;
        if ((B.clientX < I.left || B.clientX > I.right || B.clientY < I.top || B.clientY > I.bottom) && (B.clientY < I.top ? this.startAutoScroll(-1) : B.clientY > I.bottom ? this.startAutoScroll(1) : this.stopAutoScroll(), this.autoScrollDirection === 0)) {
          this.markCurrentSelectionDirty();
          const D = this.pixelToCell(E, i), o = this.viewportRowToAbsolute(D.row);
          this.selectionEnd = { col: D.col, absoluteRow: o }, this.requestRender();
        }
      }
    }, document.addEventListener("mousemove", this.boundDocumentMouseMoveHandler), document.addEventListener("mousedown", (B) => {
      this.mouseDownTarget = B.target;
    }), this.boundMouseUpHandler = (B) => {
      if (this.isSelecting) {
        if (this.isSelecting = !1, this.stopAutoScroll(), !this.dragThresholdMet) {
          this.clearSelection();
          return;
        }
        if (this.hasSelection()) {
          const I = this.getSelection();
          I && (this.copyToClipboard(I), this.selectionChangedEmitter.fire());
        }
      }
    }, document.addEventListener("mouseup", this.boundMouseUpHandler), g.addEventListener("click", (B) => {
      if (B.detail === 2) {
        const I = this.pixelToCell(B.offsetX, B.offsetY), Q = this.getWordAtCell(I.col, I.row);
        if (Q) {
          const C = this.viewportRowToAbsolute(I.row);
          this.selectionStart = { col: Q.startCol, absoluteRow: C }, this.selectionEnd = { col: Q.endCol, absoluteRow: C }, this.requestRender();
          const E = this.getSelection();
          E && (this.copyToClipboard(E), this.selectionChangedEmitter.fire());
        }
      } else if (B.detail >= 3) {
        const I = this.pixelToCell(B.offsetX, B.offsetY), Q = this.viewportRowToAbsolute(I.row), C = this.wasmTerm.getScrollbackLength();
        let E = null;
        if (Q < C)
          E = this.wasmTerm.getScrollbackLine(Q);
        else {
          const D = Q - C;
          E = this.wasmTerm.getLine(D);
        }
        let i = -1;
        if (E) {
          for (let D = E.length - 1; D >= 0; D--)
            if (E[D] && E[D].codepoint !== 0 && E[D].codepoint !== 32) {
              i = D;
              break;
            }
        }
        if (i >= 0) {
          this.selectionStart = { col: 0, absoluteRow: Q }, this.selectionEnd = { col: i, absoluteRow: Q }, this.requestRender();
          const D = this.getSelection();
          D && (this.copyToClipboard(D), this.selectionChangedEmitter.fire());
        }
      }
    }), this.boundContextMenuHandler = (B) => {
      if (this.renderer.getCanvas().getBoundingClientRect(), this.textarea.style.position = "fixed", this.textarea.style.left = `${B.clientX}px`, this.textarea.style.top = `${B.clientY}px`, this.textarea.style.width = "1px", this.textarea.style.height = "1px", this.textarea.style.zIndex = "1000", this.textarea.style.opacity = "0", this.textarea.style.pointerEvents = "auto", this.hasSelection()) {
        const Q = this.getSelection();
        this.textarea.value = Q, this.textarea.select(), this.textarea.setSelectionRange(0, Q.length);
      } else
        this.textarea.value = "";
      this.textarea.focus(), setTimeout(() => {
        const Q = () => {
          this.textarea.style.pointerEvents = "none", this.textarea.style.zIndex = "-10", this.textarea.style.width = "0", this.textarea.style.height = "0", this.textarea.style.left = "0", this.textarea.style.top = "0", this.textarea.value = "", document.removeEventListener("click", Q), document.removeEventListener("contextmenu", Q), this.textarea.removeEventListener("blur", Q);
        };
        document.addEventListener("click", Q, { once: !0 }), document.addEventListener("contextmenu", Q, { once: !0 }), this.textarea.addEventListener("blur", Q, { once: !0 });
      }, 10);
    }, g.addEventListener("contextmenu", this.boundContextMenuHandler), this.boundClickHandler = (B) => {
      if (this.isSelecting || this.mouseDownTarget && g.contains(this.mouseDownTarget))
        return;
      const Q = B.target;
      g.contains(Q) || this.hasSelection() && this.clearSelection();
    }, document.addEventListener("click", this.boundClickHandler);
  }
  /**
   * Mark current selection rows as dirty for redraw
   */
  markCurrentSelectionDirty() {
    const g = this.normalizeSelection();
    if (g)
      for (let B = g.startRow; B <= g.endRow; B++)
        this.dirtySelectionRows.add(B);
  }
  /**
   * Update auto-scroll based on mouse Y position within canvas
   */
  updateAutoScroll(g, B) {
    const I = oB.AUTO_SCROLL_EDGE_SIZE;
    g < I ? this.startAutoScroll(-1) : g > B - I ? this.startAutoScroll(1) : this.stopAutoScroll();
  }
  /**
   * Start auto-scrolling in the given direction
   */
  startAutoScroll(g) {
    this.autoScrollInterval !== null && this.autoScrollDirection === g || (this.stopAutoScroll(), this.autoScrollDirection = g, this.autoScrollInterval = setInterval(() => {
      if (!this.isSelecting) {
        this.stopAutoScroll();
        return;
      }
      const B = oB.AUTO_SCROLL_SPEED * this.autoScrollDirection;
      if (this.terminal.scrollLines(B), this.selectionEnd) {
        const I = this.wasmTerm.getDimensions();
        if (this.autoScrollDirection < 0) {
          const Q = this.viewportRowToAbsolute(0);
          Q < this.selectionEnd.absoluteRow && (this.selectionEnd = { col: 0, absoluteRow: Q });
        } else {
          const Q = this.viewportRowToAbsolute(I.rows - 1);
          Q > this.selectionEnd.absoluteRow && (this.selectionEnd = { col: I.cols - 1, absoluteRow: Q });
        }
      }
      this.requestRender();
    }, oB.AUTO_SCROLL_INTERVAL));
  }
  /**
   * Stop auto-scrolling
   */
  stopAutoScroll() {
    this.autoScrollInterval !== null && (clearInterval(this.autoScrollInterval), this.autoScrollInterval = null), this.autoScrollDirection = 0;
  }
  /**
   * Convert pixel coordinates to terminal cell coordinates
   */
  pixelToCell(g, B) {
    const I = this.renderer.getMetrics(), Q = Math.floor(g / I.width), C = Math.floor(B / I.height);
    return {
      col: Math.max(0, Math.min(Q, this.terminal.cols - 1)),
      row: Math.max(0, Math.min(C, this.terminal.rows - 1))
    };
  }
  /**
   * Normalize selection coordinates (handle backward selection)
   * Returns coordinates in VIEWPORT space for rendering, clamped to visible area
   */
  normalizeSelection() {
    if (!this.selectionStart || !this.selectionEnd)
      return null;
    let { col: g, absoluteRow: B } = this.selectionStart, { col: I, absoluteRow: Q } = this.selectionEnd;
    (B > Q || B === Q && g > I) && ([g, I] = [I, g], [B, Q] = [Q, B]);
    let C = this.absoluteRowToViewport(B), E = this.absoluteRowToViewport(Q);
    const i = this.wasmTerm.getDimensions(), D = i.rows - 1;
    return E < 0 || C > D ? null : (C < 0 && (C = 0, g = 0), E > D && (E = D, I = i.cols - 1), { startCol: g, startRow: C, endCol: I, endRow: E });
  }
  /**
   * Get word boundaries at a cell position
   */
  getWordAtCell(g, B) {
    const I = this.viewportRowToAbsolute(B), Q = this.wasmTerm.getScrollbackLength();
    let C;
    if (I < Q)
      C = this.wasmTerm.getScrollbackLine(I);
    else {
      const o = I - Q;
      C = this.wasmTerm.getLine(o);
    }
    if (!C)
      return null;
    const E = (o) => {
      if (!o || o.codepoint === 0)
        return !1;
      const w = String.fromCodePoint(o.codepoint);
      return /[\w\-./~@+]/.test(w);
    };
    if (!E(C[g]))
      return null;
    let i = g;
    for (; i > 0 && E(C[i - 1]); )
      i--;
    let D = g;
    for (; D < C.length - 1 && E(C[D + 1]); )
      D++;
    return { startCol: i, endCol: D };
  }
  /**
   * Copy text to clipboard
   *
   * Strategy (modern APIs first):
   * 1. Try ClipboardItem API (works in Safari and modern browsers)
   *    - Safari requires the ClipboardItem to be created synchronously within user gesture
   * 2. Try navigator.clipboard.writeText (modern async API, may fail in Safari)
   * 3. Fall back to execCommand (legacy, for older browsers)
   */
  copyToClipboard(g) {
    if (navigator.clipboard && typeof ClipboardItem < "u")
      try {
        const B = new Blob([g], { type: "text/plain" }), I = new ClipboardItem({
          "text/plain": B
        });
        navigator.clipboard.write([I]).catch((Q) => {
          console.warn("ClipboardItem write failed, trying writeText:", Q), this.copyWithWriteText(g);
        });
        return;
      } catch {
      }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(g).catch((B) => {
        console.warn("Clipboard writeText failed, trying execCommand:", B), this.copyWithExecCommand(g);
      });
      return;
    }
    this.copyWithExecCommand(g);
  }
  /**
   * Copy using navigator.clipboard.writeText
   */
  copyWithWriteText(g) {
    navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(g).catch((B) => {
      console.warn("Clipboard writeText failed, trying execCommand:", B), this.copyWithExecCommand(g);
    }) : this.copyWithExecCommand(g);
  }
  /**
   * Copy using legacy execCommand (fallback for older browsers)
   */
  copyWithExecCommand(g) {
    const B = document.activeElement;
    try {
      const I = this.textarea;
      I.value = g, I.style.position = "fixed", I.style.left = "-9999px", I.style.top = "0", I.style.width = "1px", I.style.height = "1px", I.style.opacity = "0", I.focus(), I.select(), I.setSelectionRange(0, g.length);
      const Q = document.execCommand("copy");
      B && B.focus(), Q || console.warn("execCommand copy failed");
    } catch (I) {
      console.warn("execCommand copy threw:", I), B && B.focus();
    }
  }
  /**
   * Request a render update (triggers selection overlay redraw)
   */
  requestRender() {
  }
};
GB.AUTO_SCROLL_EDGE_SIZE = 30;
GB.AUTO_SCROLL_SPEED = 3;
GB.AUTO_SCROLL_INTERVAL = 50;
let yi = GB;
class Li {
  // 200ms fade animation
  constructor(g = {}) {
    this.unicode = {
      get activeVersion() {
        return "15.1";
      }
    }, this.dataEmitter = new u(), this.resizeEmitter = new u(), this.bellEmitter = new u(), this.selectionChangeEmitter = new u(), this.keyEmitter = new u(), this.titleChangeEmitter = new u(), this.scrollEmitter = new u(), this.renderEmitter = new u(), this.cursorMoveEmitter = new u(), this.onData = this.dataEmitter.event, this.onResize = this.resizeEmitter.event, this.onBell = this.bellEmitter.event, this.onSelectionChange = this.selectionChangeEmitter.event, this.onKey = this.keyEmitter.event, this.onTitleChange = this.titleChangeEmitter.event, this.onScroll = this.scrollEmitter.event, this.onRender = this.renderEmitter.event, this.onCursorMove = this.cursorMoveEmitter.event, this.isOpen = !1, this.isDisposed = !1, this.writeQueue = [], this.addons = [], this.currentTitle = "", this.viewportY = 0, this.targetViewportY = 0, this.lastCursorY = 0, this.isDraggingScrollbar = !1, this.scrollbarDragStart = null, this.scrollbarDragStartViewportY = 0, this.scrollbarVisible = !1, this.scrollbarOpacity = 0, this.SCROLLBAR_HIDE_DELAY_MS = 1500, this.SCROLLBAR_FADE_DURATION_MS = 200, this.animateScroll = () => {
      if (!this.wasmTerm || this.scrollAnimationStartTime === void 0)
        return;
      const I = this.options.smoothScrollDuration ?? 100, Q = this.targetViewportY - this.viewportY;
      if (Math.abs(Q) < 0.01) {
        this.viewportY = this.targetViewportY, this.scrollEmitter.fire(Math.floor(this.viewportY)), this.getScrollbackLength() > 0 && this.showScrollbar(), this.scrollAnimationFrame = void 0, this.scrollAnimationStartTime = void 0, this.scrollAnimationStartY = void 0;
        return;
      }
      const i = 1 - (1 / (I / 1e3 * 60)) ** 2;
      this.viewportY += Q * i;
      const D = Math.floor(this.viewportY);
      this.scrollEmitter.fire(D), this.getScrollbackLength() > 0 && this.showScrollbar(), this.scrollAnimationFrame = requestAnimationFrame(this.animateScroll);
    }, this.handleMouseMove = (I) => {
      if (!(!this.canvas || !this.renderer || !this.wasmTerm)) {
        if (this.isDraggingScrollbar) {
          this.processScrollbarDrag(I);
          return;
        }
        if (this.linkDetector) {
          if (this.mouseMoveThrottleTimeout) {
            this.pendingMouseMove = I;
            return;
          }
          this.processMouseMove(I), this.mouseMoveThrottleTimeout = window.setTimeout(() => {
            if (this.mouseMoveThrottleTimeout = void 0, this.pendingMouseMove) {
              const Q = this.pendingMouseMove;
              this.pendingMouseMove = void 0, this.processMouseMove(Q);
            }
          }, 16);
        }
      }
    }, this.handleMouseLeave = () => {
      var I, Q;
      this.renderer && this.wasmTerm && ((this.renderer.hoveredHyperlinkId || 0) > 0 && this.renderer.setHoveredHyperlinkId(0), this.renderer.setHoveredLinkRange(null)), this.currentHoveredLink && ((Q = (I = this.currentHoveredLink).hover) == null || Q.call(I, !1), this.currentHoveredLink = void 0, this.element && (this.element.style.cursor = "text", this.canvas && (this.canvas.style.cursor = "text")));
    }, this.handleClick = async (I) => {
      if (!this.canvas || !this.renderer || !this.linkDetector || !this.wasmTerm)
        return;
      const Q = this.canvas.getBoundingClientRect(), C = Math.floor((I.clientX - Q.left) / this.renderer.charWidth), i = Math.floor((I.clientY - Q.top) / this.renderer.charHeight), D = this.wasmTerm.getScrollbackLength();
      let o;
      const w = this.getViewportY(), t = Math.max(0, Math.floor(w));
      if (t > 0)
        if (i < t)
          o = D - t + i;
        else {
          const s = i - t;
          o = D + s;
        }
      else
        o = D + i;
      const e = await this.linkDetector.getLinkAt(C, o);
      e && (e.activate(I), (I.ctrlKey || I.metaKey) && I.preventDefault());
    }, this.handleWheel = (I) => {
      var C, E, i;
      if (I.preventDefault(), I.stopPropagation(), this.customWheelEventHandler && this.customWheelEventHandler(I))
        return;
      if (((C = this.wasmTerm) == null ? void 0 : C.isAlternateScreen()) ?? !1) {
        const D = I.deltaY > 0 ? "down" : "up", o = Math.min(Math.abs(Math.round(I.deltaY / 33)), 5);
        for (let w = 0; w < o; w++)
          D === "up" ? this.dataEmitter.fire("\x1B[A") : this.dataEmitter.fire("\x1B[B");
      } else {
        let D;
        if (I.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
          const o = ((i = (E = this.renderer) == null ? void 0 : E.getMetrics()) == null ? void 0 : i.height) ?? 20;
          D = I.deltaY / o;
        } else
          I.deltaMode === WheelEvent.DOM_DELTA_LINE ? D = I.deltaY : I.deltaMode === WheelEvent.DOM_DELTA_PAGE ? D = I.deltaY * this.rows : D = I.deltaY / 33;
        if (D !== 0) {
          const o = this.viewportY - D;
          this.smoothScrollTo(o);
        }
      }
    }, this.handleMouseDown = (I) => {
      if (!this.canvas || !this.renderer || !this.wasmTerm)
        return;
      const Q = this.wasmTerm.getScrollbackLength();
      if (Q === 0)
        return;
      const C = this.canvas.getBoundingClientRect(), E = I.clientX - C.left, i = I.clientY - C.top, D = C.width, o = C.height, w = 8, t = D - w - 4, e = 4;
      if (E >= t && E <= t + w) {
        I.preventDefault(), I.stopPropagation(), I.stopImmediatePropagation();
        const s = o - e * 2, a = this.rows, k = Q + a, M = Math.max(20, a / k * s), N = this.viewportY / Q, n = e + (s - M) * (1 - N);
        if (i >= n && i <= n + M)
          this.isDraggingScrollbar = !0, this.scrollbarDragStart = i, this.scrollbarDragStartViewportY = this.viewportY, this.canvas && (this.canvas.style.userSelect = "none", this.canvas.style.webkitUserSelect = "none");
        else {
          const G = 1 - (i - e) / s, J = Math.round(G * Q);
          this.scrollToLine(Math.max(0, Math.min(Q, J)));
        }
      }
    }, this.handleMouseUp = () => {
      this.isDraggingScrollbar && (this.isDraggingScrollbar = !1, this.scrollbarDragStart = null, this.canvas && (this.canvas.style.userSelect = "", this.canvas.style.webkitUserSelect = ""), this.scrollbarVisible && this.getScrollbackLength() > 0 && this.showScrollbar());
    }, this.ghostty = g.ghostty ?? Si();
    const B = {
      cols: g.cols ?? 80,
      rows: g.rows ?? 24,
      cursorBlink: g.cursorBlink ?? !1,
      cursorStyle: g.cursorStyle ?? "block",
      theme: g.theme ?? {},
      scrollback: g.scrollback ?? 1e4,
      fontSize: g.fontSize ?? 15,
      fontFamily: g.fontFamily ?? "monospace",
      allowTransparency: g.allowTransparency ?? !1,
      convertEol: g.convertEol ?? !1,
      disableStdin: g.disableStdin ?? !1,
      altIsMeta: g.altIsMeta ?? !0,
      smoothScrollDuration: g.smoothScrollDuration ?? 100
      // Default: 100ms smooth scroll
    };
    this.options = new Proxy(B, {
      set: (I, Q, C) => {
        const E = I[Q];
        return I[Q] = C, this.isOpen && this.handleOptionChange(Q, C, E), !0;
      }
    }), this.cols = this.options.cols, this.rows = this.options.rows, this.buffer = new ei(this);
  }
  // ==========================================================================
  // Option Change Handling (for mutable options)
  // ==========================================================================
  /**
   * Handle runtime option changes (called when options are modified after terminal is open)
   * This enables xterm.js compatibility where options can be changed at runtime
   */
  handleOptionChange(g, B, I) {
    if (B !== I)
      switch (g) {
        case "disableStdin":
          break;
        case "cursorBlink":
        case "cursorStyle":
          this.renderer && (this.renderer.setCursorStyle(this.options.cursorStyle), this.renderer.setCursorBlink(this.options.cursorBlink));
          this.__sipDirty = !0;
          break;
        case "theme":
          this.renderer && console.warn("ghostty-web: theme changes after open() are not yet fully supported");
          break;
        case "fontSize":
          this.renderer && (this.renderer.setFontSize(this.options.fontSize), this.handleFontChange());
          break;
        case "fontFamily":
          this.renderer && (this.renderer.setFontFamily(this.options.fontFamily), this.handleFontChange());
          this.__sipDirty=!0;
          break;
        case "cols":
        case "rows":
          this.resize(this.options.cols, this.options.rows);
          break;
      }
  }
  /**
   * Handle font changes (fontSize or fontFamily)
   * Updates canvas size to match new font metrics and forces a full re-render
   */
  handleFontChange() {
    if (!this.renderer || !this.wasmTerm || !this.canvas)
      return;
    this.selectionManager && this.selectionManager.clearSelection(), this.renderer.resize(this.cols, this.rows);
    const g = this.renderer.getMetrics();
    this.canvas.width = g.width * this.cols, this.canvas.height = g.height * this.rows, this.canvas.style.width = `${g.width * this.cols}px`, this.canvas.style.height = `${g.height * this.rows}px`, this.updateWasmPixelSize(), this.renderer.render(this.wasmTerm, !0, this.viewportY, this);
  }
  /**
   * Parse a CSS color string to 0xRRGGBB format.
   * Returns 0 if the color is undefined or invalid.
   */
  parseColorToHex(g) {
    if (!g)
      return 0;
    if (g.startsWith("#")) {
      let I = g.slice(1);
      I.length === 3 && (I = I[0] + I[0] + I[1] + I[1] + I[2] + I[2]);
      const Q = Number.parseInt(I, 16);
      return Number.isNaN(Q) ? 0 : Q;
    }
    const B = g.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (B) {
      const I = Number.parseInt(B[1], 10), Q = Number.parseInt(B[2], 10), C = Number.parseInt(B[3], 10);
      return I << 16 | Q << 8 | C;
    }
    return 0;
  }
  /**
   * Convert terminal options to WASM terminal config.
   */
  buildWasmConfig() {
    const g = this.options.theme, B = this.options.scrollback;
    if (!g && B === 1e4)
      return;
    const I = [
      this.parseColorToHex(g == null ? void 0 : g.black),
      this.parseColorToHex(g == null ? void 0 : g.red),
      this.parseColorToHex(g == null ? void 0 : g.green),
      this.parseColorToHex(g == null ? void 0 : g.yellow),
      this.parseColorToHex(g == null ? void 0 : g.blue),
      this.parseColorToHex(g == null ? void 0 : g.magenta),
      this.parseColorToHex(g == null ? void 0 : g.cyan),
      this.parseColorToHex(g == null ? void 0 : g.white),
      this.parseColorToHex(g == null ? void 0 : g.brightBlack),
      this.parseColorToHex(g == null ? void 0 : g.brightRed),
      this.parseColorToHex(g == null ? void 0 : g.brightGreen),
      this.parseColorToHex(g == null ? void 0 : g.brightYellow),
      this.parseColorToHex(g == null ? void 0 : g.brightBlue),
      this.parseColorToHex(g == null ? void 0 : g.brightMagenta),
      this.parseColorToHex(g == null ? void 0 : g.brightCyan),
      this.parseColorToHex(g == null ? void 0 : g.brightWhite)
    ];
    return {
      scrollbackLimit: B,
      fgColor: this.parseColorToHex(g == null ? void 0 : g.foreground),
      bgColor: this.parseColorToHex(g == null ? void 0 : g.background),
      cursorColor: this.parseColorToHex(g == null ? void 0 : g.cursor),
      palette: I
    };
  }
  // ==========================================================================
  // Lifecycle Methods
  // ==========================================================================
  /**
   * Open terminal in a parent element
   *
   * Initializes all components and starts rendering.
   * Requires a pre-loaded Ghostty instance passed to the constructor.
   */
  open(g) {
    if (this.isOpen)
      throw new Error("Terminal is already open");
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    this.element = g, this.isOpen = !0;
    try {
      g.hasAttribute("tabindex") || g.setAttribute("tabindex", "0"), g.setAttribute("contenteditable", "true"), g.addEventListener("beforeinput", (D) => {
        D.target === g && D.preventDefault();
      }), g.setAttribute("role", "textbox"), g.setAttribute("aria-label", "Terminal input"), g.setAttribute("aria-multiline", "true");
      const B = this.buildWasmConfig();
      this.wasmTerm = this.ghostty.createTerminal(this.cols, this.rows, B), this.canvas = document.createElement("canvas"), this.canvas.style.display = "block", this.canvas.style.cursor = "text", g.appendChild(this.canvas), this.textarea = document.createElement("textarea"), this.textarea.setAttribute("autocorrect", "off"), this.textarea.setAttribute("autocapitalize", "off"), this.textarea.setAttribute("spellcheck", "false"), this.textarea.setAttribute("tabindex", "0"), this.textarea.setAttribute("aria-label", "Terminal input"), this.textarea.style.position = "absolute", this.textarea.style.left = "0", this.textarea.style.top = "0", this.textarea.style.width = "1px", this.textarea.style.height = "1px", this.textarea.style.padding = "0", this.textarea.style.border = "none", this.textarea.style.margin = "0", this.textarea.style.opacity = "0", this.textarea.style.clipPath = "inset(50%)", this.textarea.style.overflow = "hidden", this.textarea.style.whiteSpace = "nowrap", this.textarea.style.resize = "none", g.appendChild(this.textarea);
      const I = this.textarea;
      this.canvas.addEventListener("mousedown", (D) => {
        D.preventDefault(), I.focus();
      }), this.canvas.addEventListener("touchend", (D) => {
        D.preventDefault(), I.focus();
      }), this.renderer = new ni(this.canvas, {
        fontSize: this.options.fontSize,
        fontFamily: this.options.fontFamily,
        cursorStyle: this.options.cursorStyle,
        cursorBlink: this.options.cursorBlink,
        theme: this.options.theme
      }), this.renderer.resize(this.cols, this.rows), this.updateWasmPixelSize();
      const Q = this.canvas, C = this.renderer, E = this.wasmTerm, i = {
        hasMouseTracking: () => (E == null ? void 0 : E.hasMouseTracking()) ?? !1,
        hasSgrMouseMode: () => (E == null ? void 0 : E.getMode(1006, !1)) ?? !0,
        // SGR extended mode
        getCellDimensions: () => ({
          width: C.charWidth,
          height: C.charHeight
        }),
        getCanvasOffset: () => {
          const D = Q.getBoundingClientRect();
          return { left: D.left, top: D.top };
        }
      };
      this.inputHandler = new Gi(
        this.ghostty,
        g,
        (D) => {
          var o;
          this.options.disableStdin || ((o = this.selectionManager) == null || o.clearSelection(), this.dataEmitter.fire(D));
        },
        () => {
          this.bellEmitter.fire();
        },
        (D) => {
          this.keyEmitter.fire(D);
        },
        this.customKeyEventHandler,
        (D) => {
          var o;
          return ((o = this.wasmTerm) == null ? void 0 : o.getMode(D, !1)) ?? !1;
        },
        () => this.copySelection(),
        this.textarea,
        i
      ), this.inputHandler.getKittyFlagsCallback = () => {
        var o;
        return ((o = this.wasmTerm) == null ? void 0 : o.tGetU32(iA.KITTY_KEYBOARD_FLAGS)) ?? 0;
      }, this.inputHandler.altIsMeta = this.options.altIsMeta !== !1, this.selectionManager = new yi(
        this,
        this.renderer,
        this.wasmTerm,
        this.textarea
      ), this.renderer.setSelectionManager(this.selectionManager), this.selectionManager.onSelectionChange(() => {
        this.selectionChangeEmitter.fire();
      }), this.linkDetector = new ci(this), this.linkDetector.registerProvider(new ki(this)), this.linkDetector.registerProvider(new Mi(this)), g.addEventListener("mousedown", this.handleMouseDown, { capture: !0 }), g.addEventListener("mousemove", this.handleMouseMove), g.addEventListener("mouseleave", this.handleMouseLeave), g.addEventListener("click", this.handleClick), document.addEventListener("mouseup", this.handleMouseUp), g.addEventListener("wheel", this.handleWheel, { passive: !1, capture: !0 }), this.renderer.render(this.wasmTerm, !0, this.viewportY, this, this.scrollbarOpacity), this.startRenderLoop(), this.focus();
    } catch (B) {
      throw this.isOpen = !1, this.cleanupComponents(), new Error(`Failed to open terminal: ${B}`);
    }
  }
  /**
   * Write data to terminal
   */
  write(g, B) {
    this.assertOpen(), this.options.convertEol && typeof g == "string" && (g = g.replace(/\n/g, `\r
`)), this.writeInternal(g, B);
  }
  /**
   * Internal write implementation (extracted from write())
   */
  writeInternal(g, B) {
    var I;
    this.wasmTerm.write(g), this.__sipDirty=!0, this.processTerminalResponses(), typeof g == "string" && g.includes("\x07") ? this.bellEmitter.fire() : g instanceof Uint8Array && g.includes(7) && this.bellEmitter.fire(), (I = this.linkDetector) == null || I.invalidateCache(), this.viewportY !== 0 && this.scrollToBottom(), typeof g == "string" && g.includes("\x1B]") && this.checkForTitleChange(g), B && requestAnimationFrame(B);
  }
  /**
   * Write data with newline
   */
  writeln(g, B) {
    if (typeof g == "string")
      this.write(g + `\r
`, B);
    else {
      const I = new Uint8Array(g.length + 2);
      I.set(g), I[g.length] = 13, I[g.length + 1] = 10, this.write(I, B);
    }
  }
  /**
   * Paste text into terminal (triggers bracketed paste if supported)
   */
  paste(g) {
    this.assertOpen(), !this.options.disableStdin && (this.wasmTerm.hasBracketedPaste() ? this.dataEmitter.fire("\x1B[200~" + g + "\x1B[201~") : this.dataEmitter.fire(g));
  }
  /**
   * Input data into terminal (as if typed by user)
   *
   * @param data - Data to input
   * @param wasUserInput - If true, triggers onData event (default: false for compat with some apps)
   */
  input(g, B = !1) {
    this.assertOpen(), !this.options.disableStdin && (B ? this.dataEmitter.fire(g) : this.write(g));
  }
  /**
   * Resize terminal
   */
  resize(g, B) {
    if (this.assertOpen(), !(g === this.cols && B === this.rows)) {
      this.cancelRenderLoop();
      try {
        this.cols = g, this.rows = B, this.wasmTerm.resize(g, B), this.renderer.resize(g, B);
        const I = this.renderer.getMetrics();
        this.canvas.width = I.width * g, this.canvas.height = I.height * B, this.canvas.style.width = `${I.width * g}px`, this.canvas.style.height = `${I.height * B}px`, this.updateWasmPixelSize(), this.resizeEmitter.fire({ cols: g, rows: B }), this.renderer.render(this.wasmTerm, !0, this.viewportY, this);
      } catch (I) {
        console.error("Terminal resize failed:", I);
      }
      this.flushWriteQueue(), this.startRenderLoop();
    }
  }
  /**
   * Clear terminal screen
   */
  clear() {
    this.assertOpen(), this.wasmTerm.write("\x1B[2J\x1B[H"), this.__sipDirty=!0;
  }
  /**
   * Reset terminal state
   */
  reset() {
    this.assertOpen(), this.wasmTerm && this.wasmTerm.free();
    const g = this.buildWasmConfig();
    this.wasmTerm = this.ghostty.createTerminal(this.cols, this.rows, g), this.updateWasmPixelSize(), this.renderer.clear(), this.currentTitle = "";
  }
  /**
   * Focus terminal input
   */
  focus() {
    this.isOpen && this.element && (this.element.focus(), setTimeout(() => {
      var g;
      (g = this.element) == null || g.focus();
    }, 0));
  }
  /**
   * Blur terminal (remove focus)
   */
  blur() {
    this.isOpen && this.element && this.element.blur();
  }
  /**
   * Load an addon
   */
  loadAddon(g) {
    g.activate(this), this.addons.push(g);
  }
  // ==========================================================================
  // Selection API (xterm.js compatible)
  // ==========================================================================
  /**
   * Get the selected text as a string
   */
  getSelection() {
    var g;
    return ((g = this.selectionManager) == null ? void 0 : g.getSelection()) || "";
  }
  /**
   * Check if there's an active selection
   */
  hasSelection() {
    var g;
    return ((g = this.selectionManager) == null ? void 0 : g.hasSelection()) || !1;
  }
  /**
   * Clear the current selection
   */
  clearSelection() {
    var g;
    (g = this.selectionManager) == null || g.clearSelection();
  }
  /**
   * Copy the current selection to clipboard
   * @returns true if there was text to copy, false otherwise
   */
  copySelection() {
    var g;
    return ((g = this.selectionManager) == null ? void 0 : g.copySelection()) || !1;
  }
  /**
   * Select all text in the terminal
   */
  selectAll() {
    var g;
    (g = this.selectionManager) == null || g.selectAll();
  }
  /**
   * Select text at specific column and row with length
   */
  select(g, B, I) {
    var Q;
    (Q = this.selectionManager) == null || Q.select(g, B, I);
  }
  /**
   * Select entire lines from start to end
   */
  selectLines(g, B) {
    var I;
    (I = this.selectionManager) == null || I.selectLines(g, B);
  }
  /**
   * Get selection position as buffer range
   */
  /**
   * Get the current viewport Y position.
   *
   * This is the number of lines scrolled back from the bottom of the
   * scrollback buffer. It may be fractional during smooth scrolling.
   */
  getViewportY() {
    return this.viewportY;
  }
  getSelectionPosition() {
    var g;
    return (g = this.selectionManager) == null ? void 0 : g.getSelectionPosition();
  }
  // ==========================================================================
  // Phase 1: Custom Event Handlers
  // ==========================================================================
  /**
   * Attach a custom keyboard event handler
   * Returns true to prevent default handling
   */
  attachCustomKeyEventHandler(g) {
    this.customKeyEventHandler = g, this.inputHandler && this.inputHandler.setCustomKeyEventHandler(g);
  }
  /**
   * Attach a custom wheel event handler (Phase 2)
   * Returns true to prevent default handling
   */
  attachCustomWheelEventHandler(g) {
    this.customWheelEventHandler = g;
  }
  // ==========================================================================
  // Link Detection Methods
  // ==========================================================================
  /**
   * Register a custom link provider
   * Multiple providers can be registered to detect different types of links
   *
   * @example
   * ```typescript
   * term.registerLinkProvider({
   *   provideLinks(y, callback) {
   *     // Detect URLs, file paths, etc.
   *     callback(detectedLinks);
   *   }
   * });
   * ```
   */
  registerLinkProvider(g) {
    if (!this.linkDetector)
      throw new Error("Terminal must be opened before registering link providers");
    this.linkDetector.registerProvider(g);
  }
  // ==========================================================================
  // Phase 2: Scrolling Methods
  // ==========================================================================
  /**
   * Scroll viewport by a number of lines
   * @param amount Number of lines to scroll (positive = down, negative = up)
   */
  scrollLines(g) {
    if (!this.wasmTerm)
      throw new Error("Terminal not open");
    const B = this.getScrollbackLength(), Q = Math.max(0, Math.min(B, this.viewportY - g));
    Q !== this.viewportY && (this.viewportY = Q, this.scrollEmitter.fire(this.viewportY), B > 0 && this.showScrollbar());
  }
  /**
   * Scroll viewport by a number of pages
   * @param amount Number of pages to scroll (positive = down, negative = up)
   */
  scrollPages(g) {
    this.scrollLines(g * this.rows);
  }
  /**
   * Scroll viewport to the top of the scrollback buffer
   */
  scrollToTop() {
    const g = this.getScrollbackLength();
    g > 0 && this.viewportY !== g && (this.viewportY = g, this.scrollEmitter.fire(this.viewportY), this.showScrollbar());
  }
  /**
   * Scroll viewport to the bottom (current output)
   */
  scrollToBottom() {
    this.viewportY !== 0 && (this.viewportY = 0, this.scrollEmitter.fire(this.viewportY), this.getScrollbackLength() > 0 && this.showScrollbar());
  }
  /**
   * Scroll viewport to a specific line in the buffer
   * @param line Line number (0 = top of scrollback, scrollbackLength = bottom)
   */
  scrollToLine(g) {
    const B = this.getScrollbackLength(), I = Math.max(0, Math.min(B, g));
    I !== this.viewportY && (this.viewportY = I, this.scrollEmitter.fire(this.viewportY), B > 0 && this.showScrollbar());
  }
  /**
   * Smoothly scroll to a target viewport position
   * @param targetY Target viewport Y position (in lines, can be fractional)
   */
  smoothScrollTo(g) {
    if (!this.wasmTerm)
      return;
    const B = this.getScrollbackLength(), Q = Math.max(0, Math.min(B, g));
    if ((this.options.smoothScrollDuration ?? 100) === 0) {
      this.viewportY = Q, this.targetViewportY = Q, this.scrollEmitter.fire(Math.floor(this.viewportY)), B > 0 && this.showScrollbar();
      return;
    }
    this.targetViewportY = Q, !this.scrollAnimationFrame && (this.scrollAnimationStartTime = Date.now(), this.scrollAnimationStartY = this.viewportY, this.animateScroll());
  }
  // ==========================================================================
  // Lifecycle
  // ==========================================================================
  /**
   * Dispose terminal and clean up resources
   */
  dispose() {
    if (!this.isDisposed) {
      this.isDisposed = !0, this.isOpen = !1, this.cancelRenderLoop(), this.writeQueue.length = 0, this.scrollAnimationFrame && (cancelAnimationFrame(this.scrollAnimationFrame), this.scrollAnimationFrame = void 0), this.mouseMoveThrottleTimeout && (clearTimeout(this.mouseMoveThrottleTimeout), this.mouseMoveThrottleTimeout = void 0), this.pendingMouseMove = void 0;
      for (const g of this.addons)
        g.dispose();
      this.addons = [], this.cleanupComponents(), this.dataEmitter.dispose(), this.resizeEmitter.dispose(), this.bellEmitter.dispose(), this.selectionChangeEmitter.dispose(), this.keyEmitter.dispose(), this.titleChangeEmitter.dispose(), this.scrollEmitter.dispose(), this.renderEmitter.dispose(), this.cursorMoveEmitter.dispose();
    }
  }
  // ==========================================================================
  // Private Methods
  // ==========================================================================
  /**
   * Push the renderer's per-cell pixel size into the WASM terminal.
   *
   * Called from setup, open(), and resize() — everywhere the renderer
   * may have rebuilt its FontMetrics. Affects in-band size reports
   * (CSI 14/16/18 t) and kitty graphics placement sizing; without it
   * the terminal returns zeros for those queries.
   *
   * GhosttyTerminal.setCellPixelSize short-circuits when the values
   * haven't changed, so this is cheap to call from any of the above.
   */
  updateWasmPixelSize() {
    if (!this.renderer || !this.wasmTerm)
      return;
    const g = this.renderer.getMetrics();
    this.wasmTerm.setCellPixelSize(g.width, g.height);
  }
  /**
   * Cancel the render loop
   */
  cancelRenderLoop() {
    this.animationFrameId && (cancelAnimationFrame(this.animationFrameId), this.animationFrameId = void 0);
  }
  /**
   * Flush any writes that were queued during resize
   */
  flushWriteQueue() {
    for (; this.writeQueue.length > 0; ) {
      const g = this.writeQueue.shift();
      this.wasmTerm.write(g);
      this.__sipDirty = !0;
    }
  }
  /**
   * Start the render loop
   */
  startRenderLoop() {
    if (this.animationFrameId)
      return;
    this.__sipDirty = !0;
    this.__sipLast = { curX: -1, curY: -1, vp: -1, op: -1, blink: null, sel: 0 };
    const g = () => {
      if (!this.isDisposed && this.isOpen) {
        const r = this.renderer, last = this.__sipLast;
        const cur = this.wasmTerm.getCursor();
        const sel = this.selectionManager && this.selectionManager.hasSelection ? (this.selectionManager.hasSelection() ? 1 : 0) : 0;
        const blinkChanged = !!(r && r.cursorBlink) && r.cursorVisible !== last.blink;
        const cursorMoved = cur.x !== last.curX || cur.y !== last.curY;
        const vpChanged = this.viewportY !== last.vp;
        const opChanged = this.scrollbarOpacity !== last.op;
        const selChanged = sel !== last.sel;
        if (this.__sipDirty || blinkChanged || cursorMoved || vpChanged || opChanged || selChanged) {
          this.__sipDirty = !1;
          last.curX = cur.x; last.curY = cur.y;
          last.vp = this.viewportY; last.op = this.scrollbarOpacity;
          last.blink = r ? r.cursorVisible : null; last.sel = sel;
          r.render(this.wasmTerm, !1, this.viewportY, this, this.scrollbarOpacity);
          cur.y !== this.lastCursorY && (this.lastCursorY = cur.y, this.cursorMoveEmitter.fire());
        }
        this.animationFrameId = requestAnimationFrame(g);
      }
    };
    g();
  }
  /**
   * Get a line from native WASM scrollback buffer
   * Implements IScrollbackProvider
   */
  getScrollbackLine(g) {
    return this.wasmTerm ? this.wasmTerm.getScrollbackLine(g) : null;
  }
  /**
   * Get scrollback length from native WASM
   * Implements IScrollbackProvider
   */
  getScrollbackLength() {
    return this.wasmTerm ? this.wasmTerm.getScrollbackLength() : 0;
  }
  /**
   * Clean up components (called on dispose or error)
   */
  cleanupComponents() {
    this.selectionManager && (this.selectionManager.dispose(), this.selectionManager = void 0), this.inputHandler && (this.inputHandler.dispose(), this.inputHandler = void 0), this.renderer && (this.renderer.dispose(), this.renderer = void 0), this.canvas && this.canvas.parentNode && (this.canvas.parentNode.removeChild(this.canvas), this.canvas = void 0), this.textarea && this.textarea.parentNode && (this.textarea.parentNode.removeChild(this.textarea), this.textarea = void 0), this.element && (this.element.removeEventListener("wheel", this.handleWheel), this.element.removeEventListener("mousedown", this.handleMouseDown, { capture: !0 }), this.element.removeEventListener("mousemove", this.handleMouseMove), this.element.removeEventListener("mouseleave", this.handleMouseLeave), this.element.removeEventListener("click", this.handleClick), this.element.removeAttribute("contenteditable"), this.element.removeAttribute("role"), this.element.removeAttribute("aria-label"), this.element.removeAttribute("aria-multiline")), this.isOpen && typeof document < "u" && document.removeEventListener("mouseup", this.handleMouseUp), this.scrollbarHideTimeout && (window.clearTimeout(this.scrollbarHideTimeout), this.scrollbarHideTimeout = void 0), this.linkDetector && (this.linkDetector.dispose(), this.linkDetector = void 0), this.wasmTerm && (this.wasmTerm.free(), this.wasmTerm = void 0), this.ghostty = void 0, this.element = void 0, this.textarea = void 0;
  }
  /**
   * Assert terminal is open (throw if not)
   */
  assertOpen() {
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    if (!this.isOpen)
      throw new Error("Terminal must be opened before use. Call terminal.open(parent) first.");
  }
  /**
   * Process mouse move for link detection (internal, called by throttled handler)
   */
  processMouseMove(g) {
    if (!this.canvas || !this.renderer || !this.linkDetector || !this.wasmTerm)
      return;
    const B = this.canvas.getBoundingClientRect(), I = Math.floor((g.clientX - B.left) / this.renderer.charWidth), C = Math.floor((g.clientY - B.top) / this.renderer.charHeight);
    let E = 0, i = null;
    const D = this.getViewportY(), o = Math.max(0, Math.floor(D));
    if (o > 0) {
      const k = this.wasmTerm.getScrollbackLength();
      if (C < o) {
        const M = k - o + C;
        i = this.wasmTerm.getScrollbackLine(M);
      } else {
        const M = C - o;
        i = this.wasmTerm.getLine(M);
      }
    } else
      i = this.wasmTerm.getLine(C);
    i && I >= 0 && I < i.length && (E = i[I].hyperlink_id);
    const w = this.renderer.hoveredHyperlinkId || 0;
    E !== w && this.renderer.setHoveredHyperlinkId(E);
    const t = this.wasmTerm.getScrollbackLength();
    let e;
    const s = this.getViewportY(), a = Math.max(0, Math.floor(s));
    if (a > 0)
      if (C < a)
        e = t - a + C;
      else {
        const k = C - a;
        e = t + k;
      }
    else
      e = t + C;
    this.linkDetector.getLinkAt(I, e).then((k) => {
      var M, N, n, c;
      if (k !== this.currentHoveredLink) {
        (N = (M = this.currentHoveredLink) == null ? void 0 : M.hover) == null || N.call(M, !1), this.currentHoveredLink = k, (n = k == null ? void 0 : k.hover) == null || n.call(k, !0);
        const G = k ? "pointer" : "text";
        if (this.element && (this.element.style.cursor = G), this.canvas && (this.canvas.style.cursor = G), this.renderer)
          if (k) {
            const J = ((c = this.wasmTerm) == null ? void 0 : c.getScrollbackLength()) || 0, R = this.getViewportY(), r = Math.max(0, Math.floor(R)), F = k.range.start.y - J + r, H = k.range.end.y - J + r;
            F < this.rows && H >= 0 ? this.renderer.setHoveredLinkRange({
              startX: k.range.start.x,
              startY: Math.max(0, F),
              endX: k.range.end.x,
              endY: Math.min(this.rows - 1, H)
            }) : this.renderer.setHoveredLinkRange(null);
          } else
            this.renderer.setHoveredLinkRange(null);
      }
    }).catch((k) => {
      console.warn("Link detection error:", k);
    });
  }
  /**
   * Process scrollbar drag movement
   */
  processScrollbarDrag(g) {
    if (!this.canvas || !this.renderer || !this.wasmTerm || this.scrollbarDragStart === null)
      return;
    const B = this.wasmTerm.getScrollbackLength();
    if (B === 0)
      return;
    const I = this.canvas.getBoundingClientRect(), C = g.clientY - I.top - this.scrollbarDragStart, D = I.height - 4 * 2, o = this.rows, w = B + o, t = Math.max(20, o / w * D), e = -C / (D - t), s = Math.round(e * B), a = this.scrollbarDragStartViewportY + s;
    this.scrollToLine(Math.max(0, Math.min(B, a)));
  }
  /**
   * Show scrollbar with fade-in and schedule auto-hide
   */
  showScrollbar() {
    this.scrollbarHideTimeout && (window.clearTimeout(this.scrollbarHideTimeout), this.scrollbarHideTimeout = void 0), this.scrollbarVisible ? this.scrollbarOpacity = 1 : (this.scrollbarVisible = !0, this.scrollbarOpacity = 0, this.fadeInScrollbar()), this.isDraggingScrollbar || (this.scrollbarHideTimeout = window.setTimeout(() => {
      this.hideScrollbar();
    }, this.SCROLLBAR_HIDE_DELAY_MS));
  }
  /**
   * Hide scrollbar with fade-out
   */
  hideScrollbar() {
    this.scrollbarHideTimeout && (window.clearTimeout(this.scrollbarHideTimeout), this.scrollbarHideTimeout = void 0), this.scrollbarVisible && this.fadeOutScrollbar();
  }
  /**
   * Fade in scrollbar
   */
  fadeInScrollbar() {
    const g = Date.now(), B = () => {
      const I = Date.now() - g, Q = Math.min(I / this.SCROLLBAR_FADE_DURATION_MS, 1);
      this.scrollbarOpacity = Q, this.renderer && this.wasmTerm && this.renderer.render(this.wasmTerm, !1, this.viewportY, this, this.scrollbarOpacity), Q < 1 && requestAnimationFrame(B);
    };
    B();
  }
  /**
   * Fade out scrollbar
   */
  fadeOutScrollbar() {
    const g = Date.now(), B = this.scrollbarOpacity, I = () => {
      const Q = Date.now() - g, C = Math.min(Q / this.SCROLLBAR_FADE_DURATION_MS, 1);
      this.scrollbarOpacity = B * (1 - C), this.renderer && this.wasmTerm && this.renderer.render(this.wasmTerm, !1, this.viewportY, this, this.scrollbarOpacity), C < 1 ? requestAnimationFrame(I) : (this.scrollbarVisible = !1, this.scrollbarOpacity = 0, this.renderer && this.wasmTerm && this.renderer.render(this.wasmTerm, !1, this.viewportY, this, 0));
    };
    I();
  }
  /**
   * Process any pending terminal responses and emit them via onData.
   *
   * This handles escape sequences that require the terminal to send a response
   * back to the PTY, such as:
   * - DSR 6 (cursor position): Shell sends \x1b[6n, terminal responds with \x1b[row;colR
   * - DSR 5 (operating status): Shell sends \x1b[5n, terminal responds with \x1b[0n
   *
   * Without this, shells like nushell that rely on cursor position queries
   * will hang waiting for a response that never comes.
   *
   * Note: We loop to read all pending responses, not just one. This is important
   * when multiple queries are processed in a single write() call (e.g., when
   * buffered data is written all at once during terminal initialization).
   */
  processTerminalResponses() {
    if (this.wasmTerm)
      for (; ; ) {
        const g = this.wasmTerm.readResponse();
        if (g === null)
          break;
        this.dataEmitter.fire(g);
      }
  }
  /**
   * Check for title changes in written data (OSC sequences)
   * Simplified implementation - looks for OSC 0, 1, 2
   */
  checkForTitleChange(g) {
    const B = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
    let I = null;
    for (; (I = B.exec(g)) !== null; ) {
      const Q = I[1], C = I[2];
      (Q === "0" || Q === "2") && C !== this.currentTitle && (this.currentTitle = C, this.titleChangeEmitter.fire(C));
    }
  }
  // ============================================================================
  // Terminal Modes
  // ============================================================================
  /**
   * Query terminal mode state
   *
   * @param mode Mode number (e.g., 2004 for bracketed paste)
   * @param isAnsi True for ANSI modes, false for DEC modes (default: false)
   * @returns true if mode is enabled
   */
  getMode(g, B = !1) {
    return this.assertOpen(), this.wasmTerm.getMode(g, B);
  }
  /**
   * Check if bracketed paste mode is enabled
   */
  hasBracketedPaste() {
    return this.assertOpen(), this.wasmTerm.hasBracketedPaste();
  }
  /**
   * Check if focus event reporting is enabled
   */
  hasFocusEvents() {
    return this.assertOpen(), this.wasmTerm.hasFocusEvents();
  }
  /**
   * Check if mouse tracking is enabled
   */
  hasMouseTracking() {
    return this.assertOpen(), this.wasmTerm.hasMouseTracking();
  }
}
const Fi = 2, Hi = 1, Yi = 15, li = 100;
class Ui {
  constructor() {
    this._isResizing = !1;
  }
  /**
   * Activate the addon (called by Terminal.loadAddon)
   */
  activate(g) {
    this._terminal = g;
  }
  /**
   * Dispose the addon and clean up resources
   */
  dispose() {
    this._resizeObserver && (this._resizeObserver.disconnect(), this._resizeObserver = void 0), this._resizeDebounceTimer && (clearTimeout(this._resizeDebounceTimer), this._resizeDebounceTimer = void 0), this._lastCols = void 0, this._lastRows = void 0, this._terminal = void 0;
  }
  /**
   * Fit the terminal to its container
   *
   * Calculates optimal dimensions and resizes the terminal.
   * Does nothing if dimensions cannot be calculated or haven't changed.
   */
  fit() {
    if (this._isResizing)
      return;
    const g = this.proposeDimensions();
    if (!g || !this._terminal)
      return;
    const B = this._terminal, I = B.cols, Q = B.rows;
    if (!(g.cols === this._lastCols && g.rows === this._lastRows || g.cols === I && g.rows === Q)) {
      this._lastCols = g.cols, this._lastRows = g.rows, this._isResizing = !0;
      try {
        B.resize && typeof B.resize == "function" && B.resize(g.cols, g.rows);
      } finally {
        setTimeout(() => {
          this._isResizing = !1;
        }, 50);
      }
    }
  }
  /**
   * Propose dimensions to fit the terminal to its container
   *
   * Calculates cols and rows based on:
   * - Terminal container element dimensions (clientWidth/Height)
   * - Terminal element padding
   * - Font metrics (character cell size)
   * - Scrollbar width reservation
   *
   * @returns Proposed dimensions or undefined if cannot calculate
   */
  proposeDimensions() {
    var M;
    if (!((M = this._terminal) != null && M.element))
      return;
    const B = this._terminal.renderer;
    if (!B || typeof B.getMetrics != "function")
      return;
    const I = B.getMetrics();
    if (!I || I.width === 0 || I.height === 0)
      return;
    const Q = this._terminal.element;
    if (typeof Q.clientWidth > "u")
      return;
    const C = window.getComputedStyle(Q), E = Number.parseInt(C.getPropertyValue("padding-top")) || 0, i = Number.parseInt(C.getPropertyValue("padding-bottom")) || 0, D = Number.parseInt(C.getPropertyValue("padding-left")) || 0, o = Number.parseInt(C.getPropertyValue("padding-right")) || 0, w = Q.clientWidth, t = Q.clientHeight;
    if (w === 0 || t === 0)
      return;
    const e = w - D - o - Yi, s = t - E - i, a = Math.max(Fi, Math.floor(e / I.width)), k = Math.max(Hi, Math.floor(s / I.height));
    return { cols: a, rows: k };
  }
  /**
   * Observe the terminal's container for resize events
   *
   * Sets up a ResizeObserver to automatically call fit() when the
   * container size changes. Resize events are debounced to avoid
   * excessive calls during window drag operations.
   *
   * Call dispose() to stop observing.
   */
  observeResize() {
    var g;
    (g = this._terminal) != null && g.element && (this._resizeObserver || (this._resizeObserver = new ResizeObserver((B) => {
      this._isResizing || !B[0] || (this._resizeDebounceTimer && clearTimeout(this._resizeDebounceTimer), this._resizeDebounceTimer = setTimeout(() => {
        this.fit();
      }, li));
    }), this._resizeObserver.observe(this._terminal.element)));
  }
}
let tB = null;
async function fi(g) {
  tB || (tB = await pA.load(g));
}
function Si() {
  if (!tB)
    throw new Error(
      `ghostty-web not initialized. Call init() before creating Terminal instances.
Example:
  import { init, Terminal } from "ghostty-web";
  await init();
  const term = new Terminal();

For tests, pass a Ghostty instance directly:
  import { Ghostty, Terminal } from "ghostty-web";
  const ghostty = await Ghostty.load();
  const term = new Terminal({ ghostty });`
    );
  return tB;
}
export {
  ni as CanvasRenderer,
  l as CellFlags,
  iB as DirtyState,
  u as EventEmitter,
  Ui as FitAddon,
  pA as Ghostty,
  si as GhosttyTerminal,
  Gi as InputHandler,
  h as Key,
  WI as KeyAction,
  Di as KeyEncoder,
  Cg as KeyEncoderOption,
  ci as LinkDetector,
  P as Mods,
  ki as OSC8LinkProvider,
  yi as SelectionManager,
  Li as Terminal,
  Mi as UrlRegexProvider,
  Si as getGhostty,
  fi as init
};
