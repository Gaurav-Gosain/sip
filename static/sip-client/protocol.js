/**
 * Sip Protocol v2 — Sip-compatible message encoding/decoding.
 */
export const MsgInput = 0x30; // '0'
export const MsgOutput = 0x31; // '1'
export const MsgResize = 0x32; // '2'
export const MsgPing = 0x33; // '3'
export const MsgPong = 0x34; // '4'
export const MsgTitle = 0x35; // '5'
export const MsgOptions = 0x36; // '6'
export const MsgClose = 0x37; // '7'
export const MsgKittyKbd = 0x38; // '8'
/** Encode a WebSocket protocol message: [type][payload] */
export function encodeWSMessage(msgType, payload) {
    const payloadBytes = payload
        ? (typeof payload === 'string' ? new TextEncoder().encode(payload) : payload)
        : new Uint8Array(0);
    const msg = new Uint8Array(1 + payloadBytes.length);
    msg[0] = msgType;
    msg.set(payloadBytes, 1);
    return msg;
}
/** Decode a WebSocket protocol message. Returns [type, payload]. */
export function decodeWSMessage(data) {
    if (data.length === 0)
        throw new Error('empty message');
    return [data[0], data.subarray(1)];
}
/** Encode a WebTransport protocol message: [4-byte length][type][payload] */
export function encodeWTMessage(msgType, payload) {
    const payloadBytes = payload
        ? (typeof payload === 'string' ? new TextEncoder().encode(payload) : payload)
        : new Uint8Array(0);
    const bodyLen = 1 + payloadBytes.length;
    const msg = new Uint8Array(4 + bodyLen);
    new DataView(msg.buffer).setUint32(0, bodyLen, false);
    msg[4] = msgType;
    msg.set(payloadBytes, 5);
    return msg;
}
/**
 * Try to decode a single length-prefixed WebTransport frame from
 * buf[start..len]. Returns null when the buffer does not yet hold a
 * complete message (caller should read more and retry).
 */
export function tryDecodeWTFrame(buf, start, len) {
    const available = len - start;
    if (available < 4)
        return null;
    const msgLen = new DataView(buf.buffer, buf.byteOffset + start).getUint32(0, false);
    if (available < 4 + msgLen)
        return null;
    const msgType = buf[start + 4];
    const payload = buf.slice(start + 5, start + 4 + msgLen);
    return { msgType, payload, consumed: 4 + msgLen };
}
/** Encode a JSON payload as UTF-8 bytes */
export function jsonPayload(obj) {
    return new TextEncoder().encode(JSON.stringify(obj));
}
/** Decode a UTF-8 JSON payload */
export function parseJsonPayload(data) {
    return JSON.parse(new TextDecoder().decode(data));
}
