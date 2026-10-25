import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the Skylos sources and the docs are loaded inside each test body: the AC tests are written before TI02,
// TI05 and fixtures/skylos-nine-sources/ exist, so nothing that depends on them may run while the file loads. Each of
// the nine cases runs through check() as the Skylos AC tests run it, with base and head text for the three cases the
// base-and-head signals read. The fixture text is checked to hold the case before its result is read.

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
  ["edited-expected-value", "TI07"],
]);
const WITH_SOURCES = new Set(["emptied-assertion", "replaced-test", "edited-expected-value"]);

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

describe("Skylos nine: TI05 and TI02 catch emptied-assertion and replaced-test", () => {
  it("AC-17: emptied-assertion gives a block TI05, replaced-test a block TI02, edited-expected-value a warn TI07, deleted-test and added-skip their TI01 and TI03 as before, and the other four no signal", async () => {
    // The two sources hold the case their diff shows: the expect on the edited line at base, a bare call at head;
    // and the removed test's name at base, the new name at head.
    const emptied = (side: string) =>
      readFileSync(`${FIXTURES}skylos-nine-sources/emptied-assertion/${side}/${PATH}.txt`, "utf8").split("\n");
    expect(emptied("base")[7]).toContain("expect(total([2, 3])).toBe(5);");
    expect(emptied("head")[7]).toContain("total([2, 3]);");
    expect(emptied("head")[7]).not.toContain("expect");
    const replaced = (side: string) =>
      readFileSync(`${FIXTURES}skylos-nine-sources/replaced-test/${side}/${PATH}.txt`, "utf8").split("\n");
    expect(replaced("base")[14]).toContain('it("rejects a negative price"');
    expect(replaced("head")[14]).toContain('it("accepts an empty cart"');
    expect(replaced("head").join("\n")).not.toContain("rejects a negative price");

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
    const emptiedSignal = results.get("emptied-assertion")?.[0];
    expect(emptiedSignal?.severity).toBe("block");
    expect(emptiedSignal?.path).toBe(PATH);
    const replacedSignal = results.get("replaced-test")?.[0];
    expect(replacedSignal?.severity).toBe("block");
    expect(replacedSignal?.path).toBe(PATH);
    expect(replacedSignal?.line).toBe(15);
    expect([...results].filter(([, s]) => s.length > 0).map(([name]) => name)).toEqual([
      "deleted-test",
      "added-skip",
      "emptied-assertion",
      "replaced-test",
      "edited-expected-value",
    ]);
  });

  it("AC-17: docs/LIMITS.md and the README state that 5 of 9 are caught and list those five cases with their signal ids", () => {
    const limits = parseLimits(readFileSync(`${ROOT}docs/LIMITS.md`, "utf8"));
    expect(limits.body).toContain("5 of 9");
    expect(limits.caught).toEqual(new Map(CAUGHT));
    expect(limits.missed.size).toBe(4);
    expect(new Set([...limits.caught.keys(), ...limits.missed.keys()])).toEqual(new Set(NINE));

    const readme = lines(readFileSync(`${ROOT}README.md`, "utf8"));
    const start = readme.indexOf("## Test integrity");
    expect(start, "the README Test integrity section").toBeGreaterThan(-1);
    const rest = readme.slice(start + 1);
    const end = rest.findIndex((line) => line.startsWith("## "));
    const body = normalize((end === -1 ? rest : rest.slice(0, end)).join("\n"));
    expect(body).toContain("5 of 9");
    expect(body).not.toContain("2 of 9");
    for (const [name, id] of CAUGHT) {
      expect(body, `the README names ${name}`).toContain(name);
      expect(body, `the README names ${id}`).toContain(id);
    }
  });
});
