/** One file of the archive: a name of 1 to 100 of `a-z 0-9 . _ / -`, and its text. */
export interface UploadTarEntry {
  name: string;
  text: string;
}

const NAME = /^[a-z0-9._/-]{1,100}$/;
const BLOCK = 512;

/** The UTF-8 bytes of `text`. A lone surrogate is written as U+FFFD (EF BF BD), as Node's own encoder does. */
function utf8Bytes(text: string): Uint8Array {
  // Three bytes per UTF-16 unit is the most any text needs (a surrogate pair is two units and four bytes).
  const out = new Uint8Array(text.length * 3);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    let point = text.charCodeAt(i);
    if (point >= 0xd800 && point <= 0xdbff) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        point = 0x10000 + ((point - 0xd800) << 10) + (low - 0xdc00);
        i++;
      } else point = 0xfffd;
    } else if (point >= 0xdc00 && point <= 0xdfff) point = 0xfffd;
    if (point < 0x80) {
      out[n++] = point;
    } else if (point < 0x800) {
      out[n++] = 0xc0 | (point >> 6);
      out[n++] = 0x80 | (point & 0x3f);
    } else if (point < 0x10000) {
      out[n++] = 0xe0 | (point >> 12);
      out[n++] = 0x80 | ((point >> 6) & 0x3f);
      out[n++] = 0x80 | (point & 0x3f);
    } else {
      out[n++] = 0xf0 | (point >> 18);
      out[n++] = 0x80 | ((point >> 12) & 0x3f);
      out[n++] = 0x80 | ((point >> 6) & 0x3f);
      out[n++] = 0x80 | (point & 0x3f);
    }
  }
  return out.subarray(0, n);
}

/** Writes an ASCII `text` at `offset` of `block`. */
function put(block: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) block[offset + i] = text.charCodeAt(i);
}

/** `value` in octal, left-padded with zeros to `digits` digits. */
const octal = (value: number, digits: number): string => value.toString(8).padStart(digits, "0");

/** The 512-byte ustar header of a regular file called `name` with `size` bytes: owner 0, mode 0644, time 0. */
function header(name: string, size: number): Uint8Array {
  const block = new Uint8Array(BLOCK);
  put(block, 0, name);
  put(block, 100, "0000644\0");
  put(block, 108, "0000000\0");
  put(block, 116, "0000000\0");
  put(block, 124, `${octal(size, 11)}\0`);
  put(block, 136, "00000000000\0");
  put(block, 148, "        ");
  put(block, 156, "0");
  put(block, 257, "ustar\0");
  put(block, 263, "00");
  put(block, 329, "0000000\0");
  put(block, 337, "0000000\0");
  let sum = 0;
  for (const byte of block) sum += byte;
  put(block, 148, `${octal(sum, 6)}\0 `);
  return block;
}

/**
 * A ustar archive of the entries, in order: each file has a fixed header (owner 0, mode 0644, time 0), its UTF-8
 * contents padded with NUL to 512 bytes, and the archive ends with two zero blocks. The same entries give the same
 * bytes. Throws a RangeError for an entry name outside `^[a-z0-9._/-]{1,100}$`.
 */
export function buildUploadTar(entries: readonly UploadTarEntry[]): Uint8Array {
  for (const entry of entries) {
    if (!NAME.test(entry.name))
      throw new RangeError("a tar entry name must be 1 to 100 of a-z, 0-9, '.', '_', '/', '-'");
  }
  const contents = entries.map((entry) => utf8Bytes(entry.text));
  let total = 2 * BLOCK;
  for (const bytes of contents) total += BLOCK + Math.ceil(bytes.length / BLOCK) * BLOCK;
  const out = new Uint8Array(total);
  let at = 0;
  for (const [i, entry] of entries.entries()) {
    const bytes = contents[i] as Uint8Array;
    out.set(header(entry.name, bytes.length), at);
    out.set(bytes, at + BLOCK);
    at += BLOCK + Math.ceil(bytes.length / BLOCK) * BLOCK;
  }
  return out;
}
