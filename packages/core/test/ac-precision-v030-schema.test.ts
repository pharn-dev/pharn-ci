import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: the TEST_INTEGRITY_TI15 part of the report v2 message-code description states the level `info` in
// modes block and warn. (CORE-132: the comparisons of report.v1.json and of every other report.v2.json byte with an old
// commit were history pins and are removed.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const START = "TEST_INTEGRITY_TI15 (";

/** The [start, end) of the part from `TEST_INTEGRITY_TI15 (` to the next `TEST_INTEGRITY_` code, which must be unique. */
function ti15Part(text: string, label: string): [number, number] {
  const start = text.indexOf(START);
  if (start === -1) throw new Error(`${label}: no "${START}"`);
  if (text.indexOf(START, start + 1) !== -1) throw new Error(`${label}: "${START}" appears more than once`);
  const next = text.indexOf("TEST_INTEGRITY_", start + START.length);
  return [start, next === -1 ? text.length : next];
}

describe("schema: the TI15 level sentence", () => {
  it("AC-9: the v2 TEST_INTEGRITY_TI15 part says info in modes block and warn", () => {
    const now = readFileSync(join(ROOT, "schema/report.v2.json"), "utf8");
    const [ns, ne] = ti15Part(now, "now");
    const part = now.slice(ns, ne);
    expect(part).toContain("info in modes block and warn");
    expect(part).not.toContain("the level is warn");
  });
});
