import { describe, expect, it } from "vitest";

// buildUploadTar() is loaded from @pharn-ci/core inside each test body: the AC tests are written before the upload
// module exists, so nothing the build adds may run while this file loads. The archive is read back by this file's own
// ustar parser, and the expected contents are Node's own UTF-8 encoding of each text (Buffer.from), which writes a
// lone surrogate as U+FFFD (EF BF BD).

interface UploadCore {
  buildUploadTar(entries: readonly { name: string; text: string }[]): Uint8Array;
}

const load = async () => (await import("@pharn-ci/core")) as unknown as UploadCore;

const LONE_SURROGATE = "\uD800";
const ENTRIES = [
  {
    name: "report.json",
    text: `{\n  "ascii": "plain text",\n  "multi": "é € 😀 漢字",\n  "lone": "a${LONE_SURROGATE}b"\n}\n`,
  },
  { name: "meta.json", text: `{ "x": "${"z".repeat(700)}", "y": "ß${LONE_SURROGATE}" }\n` },
];

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

interface ParsedEntry {
  name: string;
  mode: string;
  uid: string;
  gid: string;
  size: string;
  mtime: string;
  checksum: string;
  checksumOk: boolean;
  typeflag: string;
  magic: string;
  version: string;
  devmajor: string;
  devminor: string;
  contents: Uint8Array;
  padding: Uint8Array;
}

/** Reads a ustar archive: one 512-byte header per entry, its contents NUL-padded to 512, then two zero blocks. */
function parseTar(bytes: Uint8Array): { entries: ParsedEntry[]; trailer: Uint8Array } {
  const entries: ParsedEntry[] = [];
  let at = 0;
  while (at + 512 <= bytes.length) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from: number, length: number) => ascii(header.subarray(from, from + length));
    const sizeField = field(124, 12);
    const size = Number.parseInt(sizeField.slice(0, 11), 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : (header[i] as number);
    const checksum = field(148, 8);
    const padded = Math.ceil(size / 512) * 512;
    entries.push({
      name: field(0, 100).replace(/\0+$/, ""),
      mode: field(100, 8),
      uid: field(108, 8),
      gid: field(116, 8),
      size: sizeField,
      mtime: field(136, 12),
      checksum,
      checksumOk: /^[0-7]{6}\0 $/.test(checksum) && Number.parseInt(checksum.slice(0, 6), 8) === sum,
      typeflag: field(156, 1),
      magic: field(257, 6),
      version: field(263, 2),
      devmajor: field(329, 8),
      devminor: field(337, 8),
      contents: bytes.subarray(at + 512, at + 512 + size),
      padding: bytes.subarray(at + 512 + size, at + 512 + padded),
    });
    at += 512 + padded;
  }
  return { entries, trailer: bytes.subarray(at) };
}

// Core's index loads cold, which can take seconds on a loaded host.
describe("the upload tar", { timeout: 60_000 }, () => {
  it("AC-5: two runs give identical bytes, a ustar archive of the entries in order with fixed headers and UTF-8 contents", async () => {
    const { buildUploadTar } = await load();
    const first = buildUploadTar(ENTRIES);
    const second = buildUploadTar(ENTRIES);
    expect(first).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);

    expect(first.length % 512).toBe(0);
    expect(first.length).toBeGreaterThanOrEqual(1024);
    expect(first.subarray(first.length - 1024).every((b) => b === 0)).toBe(true);

    const { entries, trailer } = parseTar(first);
    expect(entries.map((e) => e.name)).toEqual(["report.json", "meta.json"]);
    expect(trailer.length).toBe(1024);
    expect(trailer.every((b) => b === 0)).toBe(true);

    for (const [i, entry] of entries.entries()) {
      const source = ENTRIES[i] as { name: string; text: string };
      const expected = Buffer.from(source.text, "utf8");
      expect(entry.mode, source.name).toBe("0000644\0");
      expect(entry.uid, source.name).toBe("0000000\0");
      expect(entry.gid, source.name).toBe("0000000\0");
      expect(entry.size, source.name).toMatch(/^[0-7]{11}\0$/);
      expect(Number.parseInt(entry.size.slice(0, 11), 8), source.name).toBe(expected.length);
      expect(entry.mtime, source.name).toBe("00000000000\0");
      expect(entry.checksum, source.name).toMatch(/^[0-7]{6}\0 $/);
      expect(entry.checksumOk, `${source.name}: the checksum matches the header sum`).toBe(true);
      expect(entry.typeflag, source.name).toBe("0");
      expect(entry.magic, source.name).toBe("ustar\0");
      expect(entry.version, source.name).toBe("00");
      expect(entry.devmajor, source.name).toBe("0000000\0");
      expect(entry.devminor, source.name).toBe("0000000\0");
      expect(Buffer.from(entry.contents).equals(expected), `${source.name}: the UTF-8 contents`).toBe(true);
      expect(
        entry.padding.every((b) => b === 0),
        `${source.name}: NUL padding`,
      ).toBe(true);
    }

    // The lone surrogate is written as U+FFFD.
    const lone = Buffer.from(entries[0]?.contents ?? []);
    expect(lone.includes(Buffer.from([0x61, 0xef, 0xbf, 0xbd, 0x62]))).toBe(true);
  });

  it("AC-6: an empty, over-long, upper-case, spaced, backslashed or otherwise disallowed entry name throws a RangeError", async () => {
    const { buildUploadTar } = await load();
    // Control: names in the allowed set, up to 100 characters, are written.
    for (const name of ["report.json", "dir/sub-dir/file_1.txt", "a".repeat(100)]) {
      expect(() => buildUploadTar([{ name, text: "x" }]), name).not.toThrow();
    }
    for (const name of [
      "",
      "a".repeat(101),
      "Report.json",
      "report json",
      "dir\\report.json",
      "repört.json",
      "report:json",
      "report*.json",
      "report\0.json",
      "report\n.json",
    ]) {
      expect(() => buildUploadTar([{ name, text: "x" }]), JSON.stringify(name)).toThrow(RangeError);
      expect(
        () =>
          buildUploadTar([
            { name: "report.json", text: "x" },
            { name, text: "y" },
          ]),
        JSON.stringify(name),
      ).toThrow(RangeError);
    }
  });
});
