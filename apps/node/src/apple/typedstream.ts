/**
 * The text of a Messages `attributedBody`: an NSAttributedString archived with NSArchiver (Apple's
 * old "typedstream" format). Newer Messages often leave `message.text` empty and keep the body
 * only here.
 *
 * The archive names its classes, then the string's value: … "NSString" 01 <ref> 84 01 2B <length>
 * <UTF-8 bytes>. 0x2B ('+') is the type of a C string; the length is one byte below 0x80, or 0x81
 * then 2 bytes, or 0x82 then 4 bytes (little-endian). Only the first string is the body; the
 * attribute dictionary after it holds more strings.
 */

const CLASS = Buffer.from("NSString");
/** the value's tag: 0x84 (new object), 0x01, '+' */
const VALUE = Buffer.from([0x84, 0x01, 0x2b]);

export function decodeAttributedBody(blob: Buffer | null | undefined): string | null {
  if (!blob?.length) return null;
  let from = 0;
  for (;;) {
    const at = blob.indexOf(CLASS, from);
    if (at < 0) return null;
    // the value starts a few bytes after the class name (its version and a back-reference)
    const window = blob.subarray(at + CLASS.length, at + CLASS.length + 16);
    const tag = window.indexOf(VALUE);
    if (tag >= 0) {
      const p = at + CLASS.length + tag + VALUE.length;
      const text = readString(blob, p);
      if (text !== null) return text;
    }
    from = at + 1;
  }
}

function readString(blob: Buffer, p: number): string | null {
  if (p >= blob.length) return null;
  const head = blob[p];
  let len: number;
  let start: number;
  if (head === 0x81) {
    if (p + 3 > blob.length) return null;
    len = blob.readUInt16LE(p + 1);
    start = p + 3;
  } else if (head === 0x82) {
    if (p + 5 > blob.length) return null;
    len = blob.readUInt32LE(p + 1);
    start = p + 5;
  } else if (head < 0x80) {
    len = head;
    start = p + 1;
  } else return null;
  // a body cut short (we only fetch the start of very long ones) keeps what's there
  const end = Math.min(start + len, blob.length);
  return blob.subarray(start, end).toString("utf8").replace(/�+$/, "");
}

/** `hex(attributedBody)` as sqlite returns it. */
export function decodeAttributedBodyHex(hex: string | null | undefined): string | null {
  if (!hex) return null;
  return decodeAttributedBody(Buffer.from(hex.length % 2 ? hex.slice(0, -1) : hex, "hex"));
}
