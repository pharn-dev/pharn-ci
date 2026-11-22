import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileStamp } from "../src/stamp.js";

// CORE-121: fileStamp over a real temporary directory. `pharn-ci test` compares a JUnit file's stamp from before the
// command with its stamp after, so the time and the hash must each change when only that one changes.

const FAILING = readFileSync(fileURLToPath(new URL("../../../fixtures/junit/failing.xml", import.meta.url)), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const MiB = 1024 * 1024;

let dir: string;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-stamp-")));
  mkdirSync(join(dir, "reports"));
  writeFileSync(join(dir, "reports/a.xml"), FAILING);
  symlinkSync(join(dir, "reports/a.xml"), join(dir, "reports/linked.xml"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("fileStamp", () => {
  it("gives the modification time, the size and the sha256 of the bytes", async () => {
    const path = join(dir, "reports/a.xml");
    utimesSync(path, 1_700_000_000, 1_700_000_000);
    expect(await fileStamp(path, MiB)).toEqual({
      mtimeNs: "1700000000000000000",
      size: Buffer.byteLength(FAILING),
      sha256: sha256(FAILING),
    });
  });

  it("changes the time alone for the same bytes written again, and the hash alone for new bytes at the old time", async () => {
    const path = join(dir, "reports/b.xml");
    writeFileSync(path, FAILING);
    utimesSync(path, 1_700_000_000, 1_700_000_000);
    const first = await fileStamp(path, MiB);
    writeFileSync(path, FAILING);
    utimesSync(path, 1_700_000_001, 1_700_000_001);
    const same = await fileStamp(path, MiB);
    expect(same?.sha256).toBe(first?.sha256);
    expect(same?.mtimeNs).not.toBe(first?.mtimeNs);
    writeFileSync(path, FAILING.replace("5000", "4000"));
    utimesSync(path, 1_700_000_001, 1_700_000_001);
    const changed = await fileStamp(path, MiB);
    expect(changed?.mtimeNs).toBe(same?.mtimeNs);
    expect(changed?.sha256).not.toBe(same?.sha256);
  });

  it("does not hash a file larger than the budget", async () => {
    const stamp = await fileStamp(join(dir, "reports/a.xml"), 10);
    expect(stamp?.sha256).toBeNull();
    expect(stamp?.size).toBe(Buffer.byteLength(FAILING));
    const empty = join(dir, "reports/empty.xml");
    writeFileSync(empty, "");
    expect((await fileStamp(empty, 0))?.sha256).toBe(sha256(""));
  });

  it("is null for a missing path, a directory and a symbolic link, which it never follows", async () => {
    expect(await fileStamp(join(dir, "reports/missing.xml"), MiB)).toBeNull();
    expect(await fileStamp(join(dir, "reports/a.xml/under"), MiB)).toBeNull();
    expect(await fileStamp(join(dir, "reports"), MiB)).toBeNull();
    expect(await fileStamp(join(dir, "reports/linked.xml"), MiB)).toBeNull();
  });
});
