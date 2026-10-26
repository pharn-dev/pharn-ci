import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The documents are read inside the test body, so the file loads whatever they say.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** sha256 of schema/report.v1.json at the base commit 5860ba4. */
const V1_DIGEST = "c6cfd5b5afeada776fa89028f5ef29e06427d0e32529420184474e52ca77c731";

/** The normalized text under the heading line `heading`, up to the next heading of level 1 to `level`. */
function sectionOf(text: string, heading: string, level: number): string {
  const all = lines(text);
  const start = all.indexOf(heading);
  if (start === -1) throw new Error(`no "${heading}" heading`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => new RegExp(`^#{1,${level}} `).test(line));
  return normalize((end === -1 ? rest : rest.slice(0, end)).join("\n"));
}

/** The normalized text of the numbered residual `n` of THREAT-MODEL section 3, up to the next item or heading. */
function residual(text: string, n: number): string {
  const all = lines(text);
  const start = all.findIndex((line) => line.startsWith(`${n}. `));
  if (start === -1) throw new Error(`no residual ${n}`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => /^\d+\. /.test(line) || /^#/.test(line));
  return normalize([all[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n"));
}

/** The part of a message-code description from `TEST_INTEGRITY_<id> (` up to the next code it names. */
function codePart(description: string, id: string): string {
  const start = description.indexOf(`TEST_INTEGRITY_${id} (`);
  if (start === -1) throw new Error(`no TEST_INTEGRITY_${id} in the description`);
  const next = description.indexOf("TEST_INTEGRITY_", start + `TEST_INTEGRITY_${id}`.length);
  return description.slice(start, next === -1 ? undefined : next);
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Every `description` string of the schema that names a TEST_INTEGRITY_ message code. */
function codeDescriptions(value: Json): string[] {
  if (value === null || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === "description" && typeof child === "string" && child.includes("TEST_INTEGRITY_TI11 (")) out.push(child);
    out.push(...codeDescriptions(child as Json));
  }
  return out;
}

describe("signal precision: the documents record the narrower rules", () => {
  it("AC-13: LIMITS names the TI15, TI11, TI09 and TI06 rules, PRECISION §2 names item 18, the CHANGELOG 0.3.0 section names the four rules, the README TI15 row and the v2 schema name the caps, v1 is byte-identical, and THREAT-MODEL residuals 14 and 18 name the moved-job block and the expect-subject reader", () => {
    const limits = read("docs/LIMITS.md");

    const ti15 = sectionOf(limits, "### What TI15 misses", 3);
    expect(ti15, "TI15: the 6-character minimum").toMatch(/\b6\b[^.]{0,60}\b(?:characters?|code units?)\b/);
    expect(ti15, "TI15: the 4-digit minimum").toMatch(/\b4\b[^.]{0,60}\bdigits?\b/);
    expect(ti15, "TI15: the cap of 10 per change").toMatch(/\b10\b[^.]{0,60}\bper change\b/);
    for (const dir of ["examples", "benchmarks", "bench", "docs", "fixtures"]) {
      expect(ti15, `TI15: the excluded directory ${dir}`).toMatch(new RegExp(`\\b${dir}\\b`));
    }
    expect(ti15, "TI15: the package.json package root").toContain("package.json");
    expect(ti15, "TI15: the pyproject.toml package root").toContain("pyproject.toml");

    const ti11 = sectionOf(limits, "### What TI11 misses", 3);
    expect(ti11, "TI11: a test job moved to another workflow file").toMatch(/\bmoved\b[^.]{0,80}\banother workflow\b/);
    expect(ti11, "TI11: a script still run by an unchanged line of another workflow").toMatch(/\bunchanged\b/);
    expect(ti11, "TI11: stays a block").toMatch(/\bblock\b/);
    expect(ti11, "TI11: a known false block").toMatch(/\bfalse block\b/);
    expect(ti11, "TI11: the accept label is the way through").toMatch(/\baccept label\b/);

    const ti09 = sectionOf(limits, "### What TI09 misses", 3);
    expect(ti09, "TI09: projects matched by test.name").toContain("test.name");
    expect(ti09, "TI09: projects matched by displayName").toContain("displayName");

    const ti06 = sectionOf(limits, "### What TI06 misses", 3);
    expect(ti06, "TI06: toBeTypeOf").toContain("toBeTypeOf");
    expect(ti06, "TI06: toHaveLength").toContain("toHaveLength");
    expect(ti06, "TI06: the toBe('function') → toBeTruthy() limit").toMatch(/toBe\(\s*['"]function['"]\s*\)/);
    expect(ti06, "TI06: the toBe('function') → toBeTruthy() limit").toContain("toBeTruthy()");

    const precision = sectionOf(read("docs/PRECISION.md"), "## 2. Precision corpus", 2);
    expect(precision, "PRECISION §2 names item 18").toMatch(/\bitem 18\b/);

    // Shipped in 0.3.0. Before that release one Unreleased › Changed entry named the four; the release PR regrouped the
    // entries for a reader, so TI09, TI15 and TI06 (new in 0.3.0) carry their rules in their Added entries and TI11's
    // command key is under Fixed. Each rule is still named in the 0.3.0 section.
    const changelog = lines(read("CHANGELOG.md"));
    const unreleased = changelog.findIndex((line) => line.startsWith("## [0.3.0]"));
    expect(unreleased, "the 0.3.0 section").toBeGreaterThan(-1);
    const afterUnreleased = changelog.slice(unreleased + 1);
    const unreleasedEnd = afterUnreleased.findIndex((line) => line.startsWith("## "));
    const section = unreleasedEnd === -1 ? afterUnreleased : afterUnreleased.slice(0, unreleasedEnd);
    const entries = normalize(section.join("\n"));
    for (const id of ["TI11", "TI09", "TI15", "TI06"]) {
      expect(entries, `the 0.3.0 entries name ${id}`).toMatch(new RegExp(`\\b${id}\\b`));
    }
    expect(entries, "TI11: a package-manager swap").toContain("package-manager swap");
    expect(entries, "TI09: projects matched by name").toContain("displayName");
    expect(entries, "TI15: at most 10 findings per change").toContain("at most 10 findings per change");
    expect(entries, "TI06: equivalent rewrites").toContain("`typeof`");

    const row = lines(read("README.md")).find((line) => line.startsWith("| `TEST_INTEGRITY_TI15`"));
    expect(row, "the README TEST_INTEGRITY_TI15 row").toBeDefined();
    expect(row, "the README TI15 row: at most 10 findings").toMatch(/\bat most 10\b/);

    const v2 = JSON.parse(read("schema/report.v2.json")) as Json;
    const descriptions = codeDescriptions(v2);
    expect(descriptions, "the v2 message-code description").toHaveLength(1);
    const description = descriptions[0] as string;
    const ti11Code = codePart(description, "TI11");
    expect(ti11Code, "v2: TI11 has no warn path for a removed test step").not.toMatch(/\bjob that ran tests\b/);
    const ti15Code = codePart(description, "TI15");
    expect(ti15Code, "v2: the TI15 cap of 10").toMatch(/\b10\b/);
    expect(ti15Code, "v2: the TI15 cap per change").toMatch(/\bper change\b/);

    const v1 = createHash("sha256")
      .update(readFileSync(`${ROOT}schema/report.v1.json`))
      .digest("hex");
    expect(v1, "schema/report.v1.json is byte-identical to the base commit").toBe(V1_DIGEST);

    const threat = read("docs/THREAT-MODEL.md");
    const fourteen = residual(threat, 14);
    expect(fourteen, "residual 14: a moved test job still blocks").toMatch(/\bjob\b[^.]{0,120}\bblock\b/);
    expect(fourteen, "residual 14: the accept label is the way through").toMatch(/\baccept label\b/);
    const eighteen = residual(threat, 18);
    expect(eighteen, "residual 18: the expect-subject reader").toMatch(/\bexpect\b/);
    expect(eighteen, "residual 18: the subject").toMatch(/\bsubject\b/);
  });
});
