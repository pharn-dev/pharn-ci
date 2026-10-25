import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// check() is loaded inside the test body (through runDiff): the AC tests are written before TI08 exists, so nothing
// the build adds may run while the file loads.

/** The signal id and the snapshot-update flags, built from parts so this file holds none of them as written. */
const ID = ["TI", "08"].join("");
const DASH = "-";
const U = `${DASH}u`;
const UPDATE = `${DASH}${DASH}update`;
const UPDATE_SNAPSHOT = `${UPDATE}Snapshot`;
const UPDATE_SNAPSHOTS = `${UPDATE}-snapshots`;
const SNAPSHOT_UPDATE = `${DASH}${DASH}snapshot-update`;

/** A modified package.json whose script line 7 changes from `removed` to `added`. */
function scriptEdit(removed: string, added: string): string {
  return `${[
    "diff --git a/package.json b/package.json",
    "index 1111111..2222222 100644",
    "--- a/package.json",
    "+++ b/package.json",
    "@@ -7 +7 @@",
    `-    ${removed},`,
    `+    ${added},`,
  ].join("\n")}\n`;
}

/** A package.json the diff adds. */
function addPackage(lines: string[]): string {
  const head = [
    "diff --git a/package.json b/package.json",
    "new file mode 100644",
    "index 0000000..2222222",
    "--- /dev/null",
    "+++ b/package.json",
  ];
  return `${[...head, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

const TRIGGERS: Array<[label: string, diff: string]> = [
  ["-u added to the test script", scriptEdit('"test": "vitest run"', `"test": "vitest run ${U}"`)],
  ["--update added to test:unit", scriptEdit('"test:unit": "vitest run"', `"test:unit": "vitest run ${UPDATE}"`)],
  ["--updateSnapshot added", scriptEdit('"test": "jest --ci"', `"test": "jest --ci ${UPDATE_SNAPSHOT}"`)],
  [
    "--update-snapshots=all added to a playwright test:e2e script",
    scriptEdit('"test:e2e": "playwright test"', `"test:e2e": "playwright test ${UPDATE_SNAPSHOTS}=all"`),
  ],
  ["--snapshot-update added", scriptEdit('"test": "pytest"', `"test": "pytest ${SNAPSHOT_UPDATE}"`)],
];

const CONTROLS: Array<[label: string, diff: string]> = [
  [
    "a test script line that already had -u on its removed line",
    scriptEdit(`"test": "vitest run ${U}"`, `"test": "vitest run ${U} --reporter=dot"`),
  ],
  ["mocha -u bdd in a test script", scriptEdit('"test": "mocha"', `"test": "mocha ${U} bdd"`)],
  ["jest -u in a build:snap script", scriptEdit('"build:snap": "jest"', `"build:snap": "jest ${U}"`)],
  ["--updates in a test script", scriptEdit('"test": "vitest run"', `"test": "vitest run ${UPDATE}s"`)],
  ["jest -u in a newly added package.json", addPackage(["{", '  "scripts": {', `    "test": "jest ${U}"`, "  }", "}"])],
];

describe("TI08 (c): a snapshot-update flag added to a test script", () => {
  it("AC-4: each of the five flags added to a test* script gives one warn signal at the added line; the controls give none", async () => {
    for (const [label, diff] of TRIGGERS) {
      const signals = signalsOf(await runDiff(diff), ID);
      expect(
        signals.map((s) => ({ path: s.path, line: s.line, severity: s.severity })),
        label,
      ).toEqual([{ path: "package.json", line: 7, severity: "warn" }]);
      expect((signals[0]?.detail ?? "").length, label).toBeLessThanOrEqual(300);
    }
    for (const [label, diff] of CONTROLS) {
      expect(signalsOf(await runDiff(diff), ID), label).toEqual([]);
    }
  });
});
