import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the Skylos sources and the docs are loaded inside each test body: the AC tests are written before TI06 and
// fixtures/skylos-nine-sources/loosened-assertion/ exist, so nothing that depends on them may run while the file
// loads. Each of the nine cases runs through check() as the Skylos AC tests run it, with base and head text for the
// three cases the base-and-head signals read. The fixture text is checked to hold the case before its result is read.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";

const NINE = [
  "deleted-test",
  "added-skip",
  "emptied-assertion",
  "deselect-setting",
  "hard-coded-answer",
  "always-true-matcher",
  "replaced-test",
  "loosened-assertion",
  "edited-expected-value",
] as const;
const CAUGHT: ReadonlyMap<string, string> = new Map([
  ["deleted-test", "TI01"],
  ["added-skip", "TI03"],
  ["emptied-assertion", "TI05"],
  ["replaced-test", "TI02"],
  ["loosened-assertion", "TI06"],
  ["edited-expected-value", "TI07"],
]);
const WITH_SOURCES = new Set(["emptied-assertion", "replaced-test", "loosened-assertion", "edited-expected-value"]);

interface SourceFile {
  path: string;
  text: string;
}
interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

async function runNine(): Promise<Map<string, Signal[]>> {
  const { check } = await import("../src/check.js");
  const out = new Map<string, Signal[]>();
  for (const name of NINE) {
    const sources = WITH_SOURCES.has(name)
      ? {
          testSources: {
            base: { files: sideFiles(`${FIXTURES}skylos-nine-sources/${name}/base`), dropped: [] },
            head: { files: sideFiles(`${FIXTURES}skylos-nine-sources/${name}/head`), dropped: [] },
          },
        }
      : {};
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: fixture(`skylos-nine/${name}/change.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture(`skylos-nine/${name}/files.txt`).trim().split("\n"),
      testIntegrityMode: { input: "block" },
      ...sources,
    } as unknown as Parameters<typeof check>[0]);
    expectValidReport(report);
    out.set(name, report.testIntegrity.signals as unknown as Signal[]);
  }
  return out;
}

const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const ITEM = /^\s*(?:[-*]|\d+\.)\s+/;
const CAUGHT_ITEM = /^- `([a-z-]+)` — caught by (TI\d\d)/;
const MISSED_ITEM = /^- `([a-z-]+)` — missed; planned: (TI\d\d)/;

/** The caught and missed items of the LIMITS "What test integrity does not catch" section, continuation lines joined. */
function parseLimits(text: string): { body: string; caught: Map<string, string>; missed: Map<string, string> } {
  const all = lines(text);
  const start = all.findIndex((line) => line.startsWith("## ") && line.includes("What test integrity does not catch"));
  expect(start, "the LIMITS section").toBeGreaterThan(-1);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const section = end === -1 ? rest : rest.slice(0, end);
  const items: string[] = [];
  let current: string[] | null = null;
  for (const line of section) {
    if (ITEM.test(line)) {
      if (current) items.push(normalize(current.join(" ")));
      current = [`- ${line.replace(ITEM, "")}`];
    } else if (line.trim() === "" || line.startsWith("#")) {
      if (current) items.push(normalize(current.join(" ")));
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  if (current) items.push(normalize(current.join(" ")));
  const caught = new Map<string, string>();
  const missed = new Map<string, string>();
  for (const item of items) {
    const c = CAUGHT_ITEM.exec(item);
    if (c) caught.set(c[1] as string, c[2] as string);
    const m = MISSED_ITEM.exec(item);
    if (m) missed.set(m[1] as string, m[2] as string);
  }
  return { body: normalize(section.join("\n")), caught, missed };
}

describe("Skylos nine: TI06 catches loosened-assertion", () => {
  it("AC-15: loosened-assertion gives a warn TI06, emptied-assertion, replaced-test, deleted-test and added-skip give their TI05, TI02, TI01 and TI03 as before, edited-expected-value its TI07, and the other three give no signal", async () => {
    // The loosened-assertion sources hold the case its diff shows: the emptied-assertion base, and at head line 8
    // loosened to toBeTruthy() with every other line kept.
    const source = (name: string, side: string) =>
      readFileSync(`${FIXTURES}skylos-nine-sources/${name}/${side}/${PATH}.txt`, "utf8");
    expect(source("loosened-assertion", "base"), "the emptied-assertion base text").toBe(
      source("emptied-assertion", "base"),
    );
    const base = source("loosened-assertion", "base").split("\n");
    const head = source("loosened-assertion", "head").split("\n");
    expect(base[7]).toBe("    expect(total([2, 3])).toBe(5);");
    expect(head[7]).toBe("    expect(total([2, 3])).toBeTruthy();");
    expect(
      head.filter((_, i) => i !== 7),
      "every other line kept",
    ).toEqual(base.filter((_, i) => i !== 7));
    const diff = fixture("skylos-nine/loosened-assertion/change.diff");
    expect(diff).toContain("-    expect(total([2, 3])).toBe(5);");
    expect(diff).toContain("+    expect(total([2, 3])).toBeTruthy();");

    const results = await runNine();
    expect(results.size).toBe(9);
    for (const name of NINE) {
      const signals = results.get(name) ?? [];
      const id = CAUGHT.get(name);
      if (id === undefined) {
        expect(signals, `${name}: no signal`).toEqual([]);
        continue;
      }
      expect(signals.length, `${name}: caught`).toBeGreaterThan(0);
      expect([...new Set(signals.map((s) => String(s.id)))], `${name}: only ${id}`).toEqual([id]);
    }
    const loosened = results.get("loosened-assertion") ?? [];
    expect(loosened).toHaveLength(1);
    expect(loosened[0]?.severity).toBe("warn");
    expect(loosened[0]?.path).toBe(PATH);
    expect(loosened[0]?.line, "the head line of the loosened test").toBe(5);
    for (const name of ["emptied-assertion", "replaced-test", "deleted-test", "added-skip"]) {
      for (const s of results.get(name) ?? []) expect(s.severity, `${name} as before`).toBe("block");
    }
    expect([...results].filter(([, s]) => s.length > 0).map(([name]) => name)).toEqual([
      "deleted-test",
      "added-skip",
      "emptied-assertion",
      "replaced-test",
      "loosened-assertion",
      "edited-expected-value",
    ]);
  });

  it("AC-15: docs/LIMITS.md and the README state that 6 of 9 are caught and list those six cases with their signal ids", () => {
    const limits = parseLimits(readFileSync(`${ROOT}docs/LIMITS.md`, "utf8"));
    expect(limits.body).toContain("6 of 9");
    expect(limits.body).not.toContain("4 of 9");
    expect(limits.caught).toEqual(new Map(CAUGHT));
    expect(limits.missed.size).toBe(3);
    expect(new Set([...limits.caught.keys(), ...limits.missed.keys()])).toEqual(new Set(NINE));

    const readme = lines(readFileSync(`${ROOT}README.md`, "utf8"));
    const start = readme.indexOf("## Test integrity");
    expect(start, "the README Test integrity section").toBeGreaterThan(-1);
    const rest = readme.slice(start + 1);
    const end = rest.findIndex((line) => line.startsWith("## "));
    const body = normalize((end === -1 ? rest : rest.slice(0, end)).join("\n"));
    expect(body).toContain("6 of 9");
    expect(body).not.toContain("4 of 9");
    for (const [name, id] of CAUGHT) {
      expect(body, `the README names ${name}`).toContain(name);
      expect(body, `the README names ${id}`).toContain(id);
    }
  });
});
