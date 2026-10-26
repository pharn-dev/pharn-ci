import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: the only schema change is the TEST_INTEGRITY_TI15 part of the report v2 message-code description,
// which now states the level `info` in modes block and warn. report.v1.json and every other byte of report.v2.json
// are identical to their copies at b31de0c, the commit this increment starts from (read with git show).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "b31de0c";
const START = "TEST_INTEGRITY_TI15 (";

const readNow = (path: string) => readFileSync(join(ROOT, path));
const readBase = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT }) as Buffer;

/** The [start, end) of the part from `TEST_INTEGRITY_TI15 (` to the next `TEST_INTEGRITY_` code, which must be unique. */
function ti15Part(text: string, label: string): [number, number] {
  const start = text.indexOf(START);
  if (start === -1) throw new Error(`${label}: no "${START}"`);
  if (text.indexOf(START, start + 1) !== -1) throw new Error(`${label}: "${START}" appears more than once`);
  const next = text.indexOf("TEST_INTEGRITY_", start + START.length);
  return [start, next === -1 ? text.length : next];
}

describe("schema: only the TI15 level sentence changes", () => {
  it("AC-9: report.v1.json is byte-identical to b31de0c; the v2 TEST_INTEGRITY_TI15 part says info in modes block and warn; every other v2 byte is unchanged", () => {
    expect(
      readNow("schema/report.v1.json").equals(readBase("schema/report.v1.json")),
      "report.v1.json is byte-identical to its copy at b31de0c",
    ).toBe(true);

    const now = readNow("schema/report.v2.json").toString("utf8");
    const baseBytes = readBase("schema/report.v2.json");
    const base = baseBytes.toString("utf8");
    const [ns, ne] = ti15Part(now, "now");
    const [bs, be] = ti15Part(base, "base");
    expect(base.slice(bs, be), "control: the base part states the level warn").toContain("the level is warn");

    const part = now.slice(ns, ne);
    expect(part).toContain("info in modes block and warn");
    expect(part).not.toContain("the level is warn");
    const restored = now.slice(0, ns) + base.slice(bs, be) + now.slice(ne);
    expect(
      Buffer.from(restored, "utf8").equals(baseBytes),
      "report.v2.json with the TI15 part put back is byte-identical to its copy at b31de0c",
    ).toBe(true);
  });
});
