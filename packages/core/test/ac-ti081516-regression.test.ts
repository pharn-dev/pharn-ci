import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC tests are written before TI08, TI15 and TI16 exist, so nothing the
// build adds may run while the file loads.

const j = (...parts: string[]) => parts.join("");
const TI15 = j("TI", "15");
const NEW_IDS = [j("TI", "08"), TI15, j("TI", "16")];
const NEW_CODES = NEW_IDS.map((id) => j("TEST_INTEGRITY_", id));
const REPO_ROOT = "/home/runner/work/demo/demo";
const EPIC1 = ["TI01", "TI03", "TI04", "TI10", "TI11", "TI13", "TI14"];
const SUMMER = j("SUMMER", "2024");

/** A modified file that adds `lines` at line 12. */
function add(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, `@@ -11,0 +12,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

type Report = Awaited<ReturnType<typeof runDiff>>;
const none = (report: Report, label: string) => {
  for (const id of NEW_IDS) expect(signalsOf(report, id), `${label}: ${id}`).toEqual([]);
  const codes = report.messages.map((m) => String(m.code)).filter((c) => NEW_CODES.includes(c));
  expect(codes, label).toEqual([]);
};

describe("TI08, TI15 and TI16 leave the earlier outputs alone", () => {
  it("AC-15: the golden report is unchanged, the Epic 1 fixtures gain none of the three, and the Skylos nine (hard-coded-answer included) give no TI15", async () => {
    // Control: a change the three detectors read gives a TI15 signal, so the "none" below is a decision, not a gap.
    const control = await runDiff(
      add("src/discount.test.ts", [`  expect(price("${SUMMER}")).toBe(0);`]) +
        add("src/discount.ts", [`  if (code === "${SUMMER}") return 0;`]),
    );
    expect(signalsOf(control, TI15).map((s) => `${s.path}:${s.line}`)).toEqual(["src/discount.ts:12"]);

    // The golden report, byte for byte as fixtures/golden/report.json holds it.
    const { check } = await import("../src/check.js");
    const golden = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expectValidReport(golden);
    expect(`${JSON.stringify(golden, null, 2)}\n`).toBe(fixture("golden/report.json"));
    none(golden, "golden");

    // Each Epic 1 fixture gains none of the three new ids (its own signals are pinned by the Epic 1 tests, which run
    // unchanged).
    for (const id of EPIC1) {
      const names = readdirSync(`${FIXTURES}test-integrity/${id}/`)
        .filter((n) => n.endsWith(".diff"))
        .sort();
      expect(names.length, id).toBeGreaterThan(0);
      for (const name of names) {
        none(await runDiff(fixture(`test-integrity/${id}/${name}`), "block"), `${id}/${name}`);
      }
    }

    // The Skylos nine give none of the three; hard-coded-answer stays an expected miss for TI15.
    const cases = readdirSync(`${FIXTURES}skylos-nine/`).sort();
    expect(cases).toContain("hard-coded-answer");
    for (const name of cases) {
      const report = check({
        version: "0.1.0",
        coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
        diff: { text: fixture(`skylos-nine/${name}/change.diff`) },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: fixture(`skylos-nine/${name}/files.txt`).trim().split("\n"),
        testIntegrityMode: { input: "block" },
      } as Parameters<typeof check>[0]);
      expectValidReport(report);
      none(report, `skylos-nine/${name}`);
    }
  });
});
