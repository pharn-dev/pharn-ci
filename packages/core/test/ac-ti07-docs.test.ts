import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

// The docs are read inside each test body: the AC tests are written before the TI07 and tests-changed docs exist.

const doc = (path: string) => readFileSync(`${FIXTURES}../${path}`, "utf8");

/** The lines of a section: from its heading line to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const at = lines.indexOf(heading);
  if (at === -1) throw new Error(`no heading ${heading}`);
  const level = (/^#+/.exec(heading)?.[0] ?? "").length;
  const end = lines.findIndex(
    (line, i) => i > at && /^#+ /.test(line) && (/^#+/.exec(line)?.[0] ?? "").length <= level,
  );
  return lines.slice(at, end === -1 ? lines.length : end).join("\n");
}

/** Paragraphs (blank-line separated, joined to one line) and, inside tables, each row on its own. */
function units(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) out.push(current.join(" ").replace(/\s+/g, " "));
    current = [];
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "") flush();
    else if (line.startsWith("|")) {
      flush();
      out.push(line);
    } else current.push(line.trim());
  }
  flush();
  return out;
}

/** The list items of a markdown list section, each item joined with its continuation lines. */
function bullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) out.push(line.slice(2));
    else if (/^\s+\S/.test(line) && out.length > 0) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

describe("docs: TI07 and the tests-changed summary", () => {
  it("AC-15: docs/LIMITS.md has a What TI07 misses section naming each limit", () => {
    const misses = section(doc("docs/LIMITS.md"), "### What TI07 misses").replace(/\s+/g, " ");
    const limits: Array<[string, RegExp]> = [
      ["the expected value changed with the input", /\binput\b/i],
      ["a literal that grows or shrinks in token count", /token count|grows or shrinks/i],
      ["expected values built from variables", /\bvariables?\b/i],
      ["expected values built from helpers", /\bhelpers?\b/i],
      ["matchers outside the list", /matchers?\b[^.]*\b(outside|not (in|on))\b[^.]*\blists?\b/i],
      ["custom assertion helpers", /custom assertion helpers?/i],
      ["bodies past the 4000-character cut", /4000|4,000/],
      ["matched pairs only", /matched pairs?/i],
      ["a source change anywhere in the diff counts", /anywhere in the (diff|change)/i],
    ];
    for (const [what, pattern] of limits) expect(misses, what).toMatch(pattern);
  });

  it('AC-15: docs/LIMITS.md has a "Tests-changed summary" note naming the four kinds, the caps and what is not listed', () => {
    const text = doc("docs/LIMITS.md");
    const at = text.search(/Tests-changed summary/i);
    expect(at, "a Tests-changed summary note").toBeGreaterThan(-1);
    const rest = text.slice(at);
    const next = rest.slice(1).search(/^#{1,4} /m);
    const note = (next === -1 ? rest : rest.slice(0, next + 1)).replace(/\s+/g, " ");
    for (const kind of ["added", "removed", "modified", "renamed"])
      expect(note, kind).toMatch(new RegExp(`\\b${kind}\\b`, "i"));
    expect(note, "the 200-entry cap").toMatch(/\b200\b/);
    expect(note, "the 120-character cap").toMatch(/\b120\b/);
    expect(note, "the 50-row comment cap").toMatch(/\b50\b/);
    expect(note, "deleted test files are not listed").toMatch(/\bdeleted\b/i);
    expect(note, "unindexed files are not listed").toMatch(/(not|n't) be indexed|unindexed|not indexed/i);
  });

  it("AC-15: docs/LIMITS.md lists TI07 among the shipped signals in What test integrity does not catch", () => {
    const notCaught = section(doc("docs/LIMITS.md"), "## What test integrity does not catch").replace(/\s+/g, " ");
    const shipped = /The test-integrity signals that ship today \(([^)]*)\)/.exec(notCaught);
    expect(shipped, "the shipped list").not.toBeNull();
    expect(shipped?.[1]).toMatch(/\bTI07\b/);
  });

  it("AC-15: the README Test integrity section names TI07 and the collapsed Tests changed table", () => {
    const readme = section(doc("README.md"), "## Test integrity").replace(/\s+/g, " ");
    expect(readme).toMatch(/\bTI07\b/);
    expect(readme).toMatch(/Tests changed/);
    expect(readme).toMatch(/collapsed/i);
  });

  it("AC-15: CHANGELOG Unreleased › Added has one line for TI07 and one for the tests-changed summary", () => {
    const unreleased = section(doc("CHANGELOG.md"), "## [Unreleased]");
    const added = bullets(section(unreleased, "### Added"));
    const ti07 = added.filter((b) => /\bTI07\b/.test(b));
    const summary = added.filter((b) => /tests[- ]changed|testIntegrity\.changes/i.test(b));
    expect(ti07, "a TI07 line").toHaveLength(1);
    expect(summary.length, "a tests-changed summary line").toBeGreaterThan(0);
    expect(
      summary.some((b) => b !== ti07[0]),
      "the summary has its own line",
    ).toBe(true);
  });

  it("AC-15: docs/THREAT-MODEL.md says TI07 and the summary read the already-parsed test index, and that test names reach report.json capped at 120 characters with control characters turned into spaces", () => {
    const parts = units(doc("docs/THREAT-MODEL.md"));
    expect(
      parts.some((p) => /\bTI07\b/.test(p) && /already[- ]parsed/i.test(p) && /test index/i.test(p)),
      "TI07 and the summary read the already-parsed test index",
    ).toBe(true);
    expect(
      parts.some((p) => /\bTI07\b/.test(p) && /summary|testIntegrity\.changes/i.test(p)),
      "the summary is named beside TI07",
    ).toBe(true);
    expect(
      parts.some(
        (p) =>
          /test names?/i.test(p) &&
          /report\.json/.test(p) &&
          /\b120\b/.test(p) &&
          /control characters?/i.test(p) &&
          /\bspaces?\b/i.test(p),
      ),
      "test names reach report.json capped at 120 characters, control characters as spaces",
    ).toBe(true);
  });
});
