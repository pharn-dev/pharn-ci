import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The schemas, CHANGELOG, README, LIMITS and THREAT-MODEL document TI02, TI05 and their three message codes, and the
// new fixture directories hold must-trigger and must-not-trigger cases in the agreed shape. Files only; nothing the
// build adds is imported. The base commit is the main commit this increment starts from.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "ad8277c42ca0123fb129d8f9a079ee2b25950025";
const CODES = ["TEST_INTEGRITY_TI02", "TEST_INTEGRITY_TI05", "TEST_INTEGRITY_INDEX_UNAVAILABLE"];

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
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

describe("TI02 and TI05: docs, schema and fixtures", () => {
  it("AC-20: schema/report.v2.json names the three codes in its message-code description, and schema/report.v1.json is byte-identical to the base commit", () => {
    const schema = JSON.parse(read("schema/report.v2.json")) as unknown;
    const description = strings(schema).find((s) => s.includes("Known codes") && s.includes("TEST_INTEGRITY_TI01"));
    expect(description, "the message-code description").toBeDefined();
    for (const code of CODES) expect(description, code).toContain(code);

    const before = execFileSync("git", ["show", `${BASE}:schema/report.v1.json`], { cwd: ROOT, encoding: "utf8" });
    expect(read("schema/report.v1.json")).toBe(before);
  });

  it("AC-20: the CHANGELOG Unreleased Added section names TI02, TI05, the three codes, languages, Python indexing in the CLI and the Action, and the larger dist", () => {
    const unreleased = sectionOf(read("CHANGELOG.md"), /^## \[Unreleased\]/);
    const added = normalize(sectionOf(unreleased, /^### Added/));
    for (const word of ["TI02", "TI05", ...CODES, "languages"]) expect(added, word).toContain(word);
    expect(added).toMatch(/Python/);
    expect(added).toMatch(/\bCLI\b/);
    expect(added).toMatch(/\bAction\b/);
    expect(added, "the larger dist").toMatch(/\bdist\b/);
    expect(added, "the larger dist").toMatch(/larger|size|grows|bigger|\bMB\b/i);
  });

  it("AC-20: the README names TI02 and TI05 among the signals and lists the three codes", () => {
    const readme = read("README.md");
    const section = normalize(sectionOf(readme, /^## Test integrity$/));
    const signals = /The signals so far are (.*?)\. Each /.exec(section)?.[1] ?? section;
    expect(signals).toContain("TI02");
    expect(signals).toContain("TI05");
    const codeRows = lines(readme).filter((line) => /^\|\s*`TEST_INTEGRITY_/.test(line));
    for (const code of CODES) {
      expect(
        codeRows.some((row) => row.includes(`\`${code}\``)),
        `the message-code list has ${code}`,
      ).toBe(true);
    }
  });

  it("AC-20: docs/LIMITS.md has What TI02 misses and What TI05 misses naming the five misses, and section 8 names the source and index caps", () => {
    const limits = read("docs/LIMITS.md");
    const ti02 = normalize(sectionOf(limits, /What TI02 misses/));
    const ti05 = normalize(sectionOf(limits, /What TI05 misses/));
    const both = `${ti02} ${ti05}`;
    expect(both, "a test replaced by a trivial one with the same name").toMatch(/trivial/i);
    expect(both, "a test replaced by a trivial one with the same name").toMatch(/same name/i);
    expect(both, "a weakening that keeps the assertion count").toMatch(/weak/i);
    expect(both, "a weakening that keeps the assertion count").toMatch(/(assertion count|number of assertions)/i);
    expect(both, "assertions in helpers outside the file").toMatch(/helper/i);
    expect(both, "assertions in helpers outside the file").toMatch(/outside|another file|other file|imported/i);
    expect(ti02, "a deleted test matched by a common leaf name in another touched file").toMatch(
      /leaf name|common name/i,
    );
    expect(ti02, "a deleted test matched by a common leaf name in another touched file").toMatch(/touched/i);
    expect(both, "Go test files").toMatch(/\bGo\b/);

    const eight = normalize(sectionOf(limits, /^## 8\. Size limits/));
    expect(eight, "the source caps").toMatch(/512 KiB/);
    expect(eight, "the source caps").toMatch(/16 MiB/);
    expect(eight, "the index caps").toMatch(/syntax-error-heavy|ten syntax errors|10 syntax errors/);
    expect(eight, "the index caps").toMatch(/too-deep|\bdepth\b|\bdeeper\b/i);
    expect(eight, "as limits a user of TI02 and TI05 can hit").toMatch(/TI02|TI05|TEST_INTEGRITY_INDEX_UNAVAILABLE/);
  });

  it("AC-20: docs/THREAT-MODEL.md rows A1, C2 and C3 say the Action parses pull-request test text with the TypeScript parser and the Python subprocess on every pull request that touches tests, and that test names reach the report and the comment", () => {
    const doc = lines(read("docs/THREAT-MODEL.md"));
    const row = (id: string) => {
      const found = doc.find((line) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(line));
      expect(found, `the row ${id}`).toBeDefined();
      return found as string;
    };
    const a1 = row("A1");
    const c2 = row("C2");
    const c3 = row("C3");
    expect(a1).toMatch(/TypeScript/);
    expect(a1).toMatch(/Python|CPython/);
    expect(a1, "A1: on every pull request that touches tests").toMatch(/every pull request/i);
    expect(a1, "A1: the parser is in the Action now").not.toMatch(/not bundled into the action/i);
    expect(c3, "C3: on every pull request that touches tests").toMatch(/every pull request/i);
    expect(c3, "C3: wired into check() now").not.toMatch(/not yet wired/i);
    for (const [id, text] of [
      ["C2", c2],
      ["C3", c3],
    ] as const) {
      expect(text, `${id}: test names`).toMatch(/test names?/i);
      expect(text, `${id}: reach the report`).toMatch(/\breport\b/);
      expect(text, `${id}: and the comment`).toMatch(/\bcomment\b/);
    }
  });

  it("AC-20: fixtures/test-integrity/TI02/ and TI05/ each hold must-trigger and must-not-trigger cases, text files ending .txt and diffs ending .diff of fewer than 1000 lines", () => {
    for (const signal of ["TI02", "TI05"]) {
      const dir = join(ROOT, "fixtures/test-integrity", signal);
      const cases = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      expect(
        cases.filter((name) => /^(block|warn)-/.test(name)).length,
        `${signal}: must-trigger cases`,
      ).toBeGreaterThan(0);
      expect(
        cases.filter((name) => name.startsWith("pass-")).length,
        `${signal}: must-not-trigger cases`,
      ).toBeGreaterThan(0);
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
