import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The schemas, the core entry point, CHANGELOG, README, LIMITS and THREAT-MODEL document TI06, TI12 and their message
// codes, and the new fixture directories hold must-trigger and must-not-trigger cases in the agreed shape. Files are
// read and the core entry point is loaded inside each test body. The base commit is the main commit this increment
// starts from.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "98693cf95fa521affc2d0a2eec1a7ae0f312b8cb";
const CODES = ["TEST_INTEGRITY_TI06", "TEST_INTEGRITY_TI12"];
const NEW_CODES = "New codes may be added within v2";

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const readBase = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8" });
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The text under the first heading line `heading` matches, up to the next heading of the same or a higher level. */
function sectionOf(markdown: string, heading: RegExp): string {
  const all = lines(markdown);
  const start = all.findIndex((line) => /^#{1,6} /.test(line) && heading.test(line));
  if (start === -1) throw new Error(`no heading matching ${heading}`);
  const level = /^#+/.exec(all[start] as string)?.[0].length ?? 6;
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => {
    const m = /^(#+) /.exec(line);
    return m !== null && (m[1] as string).length <= level;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The top-level `- ` list items of a markdown text, each with its indented continuation lines, raw. */
function listItems(text: string): string[] {
  const items: string[] = [];
  let current: string[] | null = null;
  for (const line of lines(text)) {
    if (line.startsWith("- ")) {
      if (current) items.push(current.join("\n"));
      current = [line];
    } else if (current && line.startsWith("  ")) {
      current.push(line);
    } else {
      if (current) items.push(current.join("\n"));
      current = null;
    }
  }
  if (current) items.push(current.join("\n"));
  return items;
}

/** Every string value in a JSON document. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Every file under `dir`, relative to it. */
function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => statSync(join(dir, name)).isFile());
}

/** A row of a markdown table whose first cell is `id`. */
function row(doc: string[], id: string): string {
  const found = doc.find((line) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(line));
  expect(found, `the row ${id}`).toBeDefined();
  return found as string;
}

describe("TI06 and TI12: docs, schema, exports and fixtures", () => {
  it("AC-18: schema/report.v2.json names TEST_INTEGRITY_TI06 and TEST_INTEGRITY_TI12 in its message-code description before 'New codes may be added within v2', and schema/report.v1.json is byte-identical to the base commit", () => {
    const schema = JSON.parse(read("schema/report.v2.json")) as unknown;
    const description = strings(schema).find((s) => s.includes("Known codes") && s.includes(NEW_CODES));
    expect(description, "the message-code description").toBeDefined();
    const cut = (description as string).indexOf(NEW_CODES);
    for (const code of CODES) {
      const at = (description as string).indexOf(code);
      expect(at, code).toBeGreaterThan(-1);
      expect(at, `${code} before "${NEW_CODES}"`).toBeLessThan(cut);
    }
    expect(read("schema/report.v1.json")).toBe(readBase("schema/report.v1.json"));
  });

  it("AC-18: @pharn-ci/core exports the functions detectTI06 and detectTI12", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
    expect(typeof core.detectTI06).toBe("function");
    expect(typeof core.detectTI12).toBe("function");
  });

  it("AC-18: the CHANGELOG Unreleased Added section has an entry naming TI06 and TI12 and keeps #91's entry unchanged", () => {
    const addedNow = listItems(sectionOf(sectionOf(read("CHANGELOG.md"), /^## \[Unreleased\]/), /^### Added/));
    const addedBase = listItems(sectionOf(sectionOf(readBase("CHANGELOG.md"), /^## \[Unreleased\]/), /^### Added/));
    const earlier = addedBase.filter((item) => item.includes("**TI02**") && item.includes("**TI05**"));
    expect(earlier, "#91's entry at the base commit").toHaveLength(1);
    expect(addedNow, "#91's entry, byte for byte").toContain(earlier[0]);
    expect(
      addedNow.some((item) => item !== earlier[0] && item.includes("TI06") && item.includes("TI12")),
      "a new entry names TI06 and TI12",
    ).toBe(true);
  });

  it("AC-18: the README names TI06 and TI12 among the signals, lists both codes and says 7 of 9", () => {
    const readme = read("README.md");
    const section = normalize(sectionOf(readme, /^## Test integrity$/));
    const signals = /The signals so far are (.*?)\. Each /.exec(section)?.[1] ?? section;
    expect(signals).toContain("TI06");
    expect(signals).toContain("TI12");
    // TI09 (after TI06 and TI12) moved deselect-setting to caught.
    expect(section).toContain("7 of 9");
    const codeRows = lines(readme).filter((line) => /^\|\s*`TEST_INTEGRITY_/.test(line));
    for (const code of CODES) {
      expect(
        codeRows.some((r) => r.includes(`\`${code}\``)),
        `the message-code list has ${code}`,
      ).toBe(true);
    }
  });

  it("AC-18: docs/LIMITS.md has 'What TI06 misses' and 'What TI12 misses' naming their misses, and its TI05 section points at TI06 for weakening", () => {
    const limits = read("docs/LIMITS.md");
    const ti06 = normalize(sectionOf(limits, /What TI06 misses/));
    expect(ti06, "semantic weakening that keeps the matcher").toMatch(/semantic/i);
    expect(ti06, "semantic weakening that keeps the matcher").toMatch(/keeps? the (same )?matcher|same matcher/i);
    expect(ti06, "custom matchers").toMatch(/custom matchers?/i);
    expect(ti06, "assertions in helpers").toMatch(/helper/i);
    expect(ti06, "chai-style chains").toMatch(/chai/i);
    expect(ti06, "arguments past the 4000-character body cut").toMatch(/4000|4,000/);
    expect(ti06, "arguments past the 4000-character body cut").toMatch(/argument/i);
    expect(ti06, "a test matched only to another file").toMatch(/(another|other) (test )?file/i);

    const ti12 = normalize(sectionOf(limits, /What TI12 misses/));
    expect(ti12, "bare specifiers").toMatch(/bare/i);
    expect(ti12, "alias specifiers").toMatch(/alias/i);
    expect(ti12, "mocks in setup files").toMatch(/setup files?/i);
    expect(ti12, "patch.object and other non-string targets").toContain("patch.object");
    expect(ti12, "patch.object and other non-string targets").toMatch(/non-string|not a string/i);
    expect(ti12, "monkeypatch.setattr object forms").toContain("monkeypatch.setattr");
    expect(ti12, "monkeypatch.setattr object forms").toMatch(/object forms?/i);
    expect(ti12, "mocks moved from a deleted test file").toMatch(/deleted test files?/i);

    const ti05 = normalize(sectionOf(limits, /What TI05 misses/));
    expect(ti05, "the TI05 section points at TI06").toContain("TI06");
    expect(ti05, "for weakening").toMatch(/weak/i);
  });

  it("AC-18: docs/THREAT-MODEL.md row A1 says TI06 scans normalized test bodies with linear-time patterns, and row C2 says TI12 puts a mock's sanitized specifier, cut to 120 code units, into the report and the comment", () => {
    const doc = lines(read("docs/THREAT-MODEL.md"));
    const a1 = row(doc, "A1");
    expect(a1).toContain("TI06");
    expect(a1).toMatch(/normali[sz]ed/i);
    expect(a1).toMatch(/test bod(y|ies)/i);
    expect(a1).toMatch(/linear/i);
    const c2 = row(doc, "C2");
    expect(c2).toContain("TI12");
    expect(c2).toMatch(/specifier/i);
    expect(c2).toMatch(/saniti[sz]ed/i);
    expect(c2).toMatch(/\b120\b/);
    expect(c2).toMatch(/\breport\b/);
    expect(c2).toMatch(/\bcomment\b/);
  });

  it("AC-18: fixtures/test-integrity/TI06/ and TI12/ each hold at least four warn-* and four pass-* cases, a Python case of each kind, text files ending .txt and diffs ending .diff of fewer than 1000 lines", () => {
    for (const signal of ["TI06", "TI12"]) {
      const dir = join(ROOT, "fixtures/test-integrity", signal);
      const cases = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      const warn = cases.filter((name) => name.startsWith("warn-"));
      const pass = cases.filter((name) => name.startsWith("pass-"));
      expect(warn.length, `${signal}: warn-* cases`).toBeGreaterThanOrEqual(4);
      expect(pass.length, `${signal}: pass-* cases`).toBeGreaterThanOrEqual(4);
      const python = (name: string) => walk(join(dir, name)).some((file) => file.endsWith(".py.txt"));
      expect(warn.some(python), `${signal}: a Python warn-* case`).toBe(true);
      expect(pass.some(python), `${signal}: a Python pass-* case`).toBe(true);
      for (const name of cases) {
        const files = walk(join(dir, name));
        expect(files, `${signal}/${name}: a diff`).toContain("change.diff");
        for (const file of files) {
          const path = `${signal}/${name}/${file}`;
          if (file.endsWith(".diff")) {
            const count = readFileSync(join(dir, name, file), "utf8").split("\n").length;
            expect(count, `${path}: fewer than 1000 lines`).toBeLessThan(1000);
          } else {
            expect(file.endsWith(".txt"), `${path}: a text file ends in .txt`).toBe(true);
          }
        }
      }
    }
  });
});
