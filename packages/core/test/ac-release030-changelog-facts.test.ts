import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-030: the 0.3.0 notes are the Unreleased entries of the base commit, regrouped for a reader with only the
// duplication dropped. Every code span and bold term of the base Unreleased section is still there, the superseded
// intermediate Skylos counts are gone, each new signal has one Added entry with its severity, and the first Changed
// entry tells a 0.2.0 user what can now fail in mode block and how to get the 0.2.0 outcome back. Files are read inside
// the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Main before this increment: the Unreleased section these notes were made from. */
const BASE = "f1dd7e99b90719fbe1602b7b3ff231b0dca38c98";
const HEADING = "## [0.3.0] - 2026-10-26";
/** The new signals of 0.3.0 and the level each always has, when it has one in both modes. */
const SIGNALS: Array<[string, string | null]> = [
  ["TI02", null],
  ["TI05", null],
  ["TI06", "warn"],
  ["TI07", "warn"],
  ["TI08", "warn"],
  ["TI09", null],
  ["TI12", "warn"],
  ["TI15", "info"],
  ["TI16", "info"],
];
const CODES = [...SIGNALS.map(([id]) => `TEST_INTEGRITY_${id}`), "TEST_INTEGRITY_INDEX_UNAVAILABLE"];

const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The lines under the heading line that starts with `heading`, up to the next `## [` line (the heading excluded). */
function section(all: string[], heading: string): string[] {
  const start = all.findIndex((line) => line.startsWith(heading));
  expect(start, `CHANGELOG.md has a ${heading} heading`).toBeGreaterThan(-1);
  const end = all.findIndex((line, i) => i > start && line.startsWith("## ["));
  return all.slice(start + 1, end === -1 ? undefined : end);
}

/** The `- ` entries under `### <group>` of a section, each joined with its continuation lines and normalized. */
function entries(notes: string[], group: string): string[] {
  const at = notes.indexOf(`### ${group}`);
  expect(at, `### ${group}`).toBeGreaterThan(-1);
  const rest = notes.slice(at + 1);
  const end = rest.findIndex((line) => line.startsWith("#"));
  const out: string[] = [];
  for (const line of end === -1 ? rest : rest.slice(0, end)) {
    if (line.startsWith("- ")) out.push(line.slice(2));
    else if (/^\s+\S/.test(line) && out.length > 0) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out.map(normalize);
}

describe("release-030: CHANGELOG.md 0.3.0 notes", () => {
  it("AC-3: the 0.3.0 notes keep every code span and bold term of the base Unreleased section, drop the 4, 5 and 6 of 9 counts, give each new signal one Added entry with its level, name the new codes, report fields, python3, docs/PRECISION.md and 7 and 8 of 9, and lead Changed with what can now fail in mode block and how to get the 0.2.0 outcome back", () => {
    const all = lines(readFileSync(`${ROOT}CHANGELOG.md`, "utf8"));
    const base = lines(execFileSync("git", ["show", `${BASE}:CHANGELOG.md`], { cwd: ROOT, encoding: "utf8" }));
    const notes = section(all, HEADING);
    const text = normalize(notes.join("\n"));
    const before = normalize(section(base, "## [Unreleased]").join("\n"));

    const spans = new Set(before.match(/`[^`]+`/g) ?? []);
    expect(spans.size, "the base Unreleased section has code spans").toBeGreaterThan(100);
    expect(
      [...spans].filter((span) => !text.includes(span)),
      "every code span of the base Unreleased section",
    ).toEqual([]);
    const bold = new Set(before.match(/\*\*[^*]+\*\*/g) ?? []);
    expect(bold.size, "the base Unreleased section has bold terms").toBeGreaterThan(5);
    expect(
      [...bold].filter((term) => !text.includes(term)),
      "every bold term of the base Unreleased section",
    ).toEqual([]);

    for (const stale of ["4 of 9", "5 of 9", "6 of 9"]) expect(text, `no superseded ${stale}`).not.toContain(stale);
    expect(text).toContain("**7 of 9**");
    expect(text).toContain("**8 of 9**");

    const added = entries(notes, "Added");
    for (const [id, level] of SIGNALS) {
      const own = added.filter((entry) => entry.startsWith(`Signal **${id}**`));
      expect(own, `one Added entry for ${id}`).toHaveLength(1);
      expect(own[0], `${id}'s entry names TEST_INTEGRITY_${id}`).toContain(`\`TEST_INTEGRITY_${id}\``);
      if (level !== null) expect(own[0], `${id} is ${level}`).toContain(level);
      else expect(own[0], `${id} is block in mode block`).toMatch(/`block` in mode `block`/);
    }
    for (const code of CODES) expect(text, code).toContain(`\`${code}\``);
    for (const field of ["`testIntegrity.languages`", "`testIntegrity.changes`", "`python3`", "`docs/PRECISION.md`"]) {
      expect(text, field).toContain(field);
    }

    const changed = entries(notes, "Changed");
    const first = changed[0] ?? "";
    expect(first, "the first Changed entry is about mode block").toMatch(/mode `block`/);
    for (const id of ["TI01", "TI02", "TI03", "TI05", "TI09"]) expect(first, `it names ${id}`).toContain(id);
    expect(first, "how to get the 0.2.0 outcome back: mode warn").toContain("`test-integrity: warn`");
    expect(first, "or the accept label").toContain("`pharn/accepted`");
  });
});
