import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withoutSchemaLevelEdits } from "./level-edits.js";

// docs-schema-levels: report.v2.json states the block-mode levels #126 shipped, and THREAT-MODEL §3 renders the
// residual numbers that the docs and tests cite. The base is main at 88ecc5e (#126 merged), read with git.
const BASE = "88ecc5e";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const atBase = (path: string) =>
  execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** The text policy rule P14 (agent PR size cap) appends to the message-code description. */
const P14_TEXT =
  " Codes added in v0.6.0: POLICY_P14 (error, or the level the org policy sets for P14: an agent pull request changes more files or lines than the org policy's agents.max_files or agents.max_changed_lines allow, not counting lockfiles, snapshots, *.generated.* files and coverage.exclude paths, or could not be checked because the diff, or the policy file at the merge base, could not be read; the message names the counts, the caps, up to 10 top-level directories and the evidence as fixed words, never file text).";

interface Residual {
  source: number;
  shown: number;
  title: string;
}

/**
 * The §3 items with the number written in the source and the number a CommonMark renderer shows: a list is numbered
 * from its first item, one up per item, and a non-blank line at column 0 that is not an item ends the list.
 */
function residuals(doc: string): Residual[] {
  const lines = doc.slice(doc.indexOf("\n## 3."), doc.indexOf("\n## 4.")).split("\n");
  const out: Residual[] = [];
  let next: number | null = null;
  for (const line of lines) {
    const m = /^(\d+)\. \*\*(.+?)\*\*/.exec(line);
    if (m !== null) {
      const source = Number(m[1]);
      const shown = next ?? source;
      out.push({ source, shown, title: m[2] as string });
      next = shown + 1;
    } else if (line !== "" && !/^\s/.test(line)) {
      next = null;
    }
  }
  return out;
}

describe("docs-schema-levels", () => {
  it("report.v2.json states both block-mode levels and differs from 88ecc5e only by them; report.v1.json is unchanged", () => {
    const now = read("schema/report.v2.json");
    expect(now).toContain(
      "except DIFF_UNAVAILABLE, which is an error when a coverage threshold is set (0 included) or the test-integrity mode is block, and a warn otherwise.",
    );
    expect(now).toContain(
      "TEST_INTEGRITY_INDEX_UNAVAILABLE (warn, or error in mode block when TI02 and TI05, or TI09, did not run at all: touched",
    );
    // Re-pinned for policy rule P14 (agent PR size cap): the code description also gains exactly the v0.6.0 text that
    // names POLICY_P14, at its end; it is taken out too, so every other byte stays pinned.
    expect(now.split(P14_TEXT).length - 1, "the P14 text appears once").toBe(1);
    expect(withoutSchemaLevelEdits(now.replace(P14_TEXT, "")), "report.v2.json without the two insertions").toBe(
      atBase("schema/report.v2.json"),
    );
    expect(read("schema/report.v1.json"), "report.v1.json").toBe(atBase("schema/report.v1.json"));
  });

  it("THREAT-MODEL §3 shows every residual with its source number, keeps the base numbers and titles, and says there is no residual 7", () => {
    const base = residuals(atBase("docs/THREAT-MODEL.md"));
    expect(
      base.map((r) => r.source),
      "control: the base numbers are 1 to 35 without 7",
    ).toEqual(Array.from({ length: 35 }, (_, i) => i + 1).filter((n) => n !== 7));
    expect(
      base.some((r) => r.shown !== r.source),
      "control: at the base a renderer showed other numbers",
    ).toBe(true);
    const doc = read("docs/THREAT-MODEL.md");
    const now = residuals(doc);
    expect(now.slice(0, base.length).map((r) => [r.source, r.title])).toEqual(base.map((r) => [r.source, r.title]));
    expect(now.filter((r) => r.shown !== r.source)).toEqual([]);
    expect(doc).toContain("There is no residual 7:");
  });
});
