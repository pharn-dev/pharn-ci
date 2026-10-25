import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// release-readiness-v020: the figure docs/LIMITS.md states (now 5 of 9) must match what check() does today. The caught
// and missed cases are parsed from the LIMITS section, then each of the nine Skylos cases runs through check() with the
// inputs the Skylos AC tests use, plus the base and head text of the test file for the three cases that need it
// (fixtures/skylos-nine-sources/). check() and the docs are loaded inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const WITH_SOURCES = new Set(["emptied-assertion", "replaced-test", "edited-expected-value"]);

/** The `<logical path>.txt` files under one side of a case's sources, as test-source files sorted by logical path. */
function sideFiles(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
const TITLE = "What test integrity does not catch";
const ACCEPT_MISSES = "### What the accept label misses";

const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const ITEM = /^\s*(?:[-*]|\d+\.)\s+/;
const CAUGHT = /^- `([a-z-]+)` — caught by (TI\d\d)/;
const MISSED = /^- `([a-z-]+)` — missed; planned: (TI\d\d)/;

/** The caught and missed items of the LIMITS section, list items with their continuation lines joined. */
function parseLimits(text: string): { caught: Map<string, string>; missed: Map<string, string> } {
  const all = lines(text);
  const starts = all.flatMap((line, index) => (line.startsWith("## ") && line.includes(TITLE) ? [index] : []));
  expect(starts, `one "## …${TITLE}" heading`).toHaveLength(1);
  const start = starts[0] as number;
  expect(start).toBeGreaterThan(all.indexOf(ACCEPT_MISSES));
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
    const c = CAUGHT.exec(item);
    if (c) caught.set(c[1] as string, c[2] as string);
    const m = MISSED.exec(item);
    if (m) missed.set(m[1] as string, m[2] as string);
  }
  return { caught, missed };
}

describe("release-readiness-v020: the LIMITS 2-of-9 figure matches check()", () => {
  it("AC-3: exactly the two cases LIMITS lists as caught give a signal (only their named id), the seven it lists as missed give none, so the live count is 2 of 9", async () => {
    const { check } = await import("../src/check.js");
    const { caught, missed } = parseLimits(readFileSync(`${ROOT}docs/LIMITS.md`, "utf8"));
    expect(caught.size).toBe(5);
    expect(missed.size).toBe(4);
    const names = [...caught.keys(), ...missed.keys()];
    expect(new Set(names).size).toBe(9);

    const live = new Map<string, string[]>();
    for (const name of names) {
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
      } as Parameters<typeof check>[0]);
      expectValidReport(report);
      live.set(
        name,
        report.testIntegrity.signals.map((signal) => String(signal.id)),
      );
    }

    for (const [name, id] of caught) {
      const ids = live.get(name) ?? [];
      expect(ids.length, name).toBeGreaterThan(0);
      expect([...new Set(ids)], name).toEqual([id]);
    }
    for (const name of missed.keys()) expect(live.get(name), name).toEqual([]);

    const liveCaught = [...live].filter(([, ids]) => ids.length > 0).length;
    expect(`${liveCaught} of ${live.size}`).toBe("5 of 9");
  });
});
