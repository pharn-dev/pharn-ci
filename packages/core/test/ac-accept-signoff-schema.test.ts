import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport, validateReport } from "./schema.js";

// check() and the accept-label functions are loaded inside the test body: the AC tests are written before the accept
// label exists, so nothing the build adds may run while the file loads.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** sha256 of schema/report.v1.json at the base commit a1089fd. */
const V1_AT_BASE = "c6cfd5b5afeada776fa89028f5ef29e06427d0e32529420184474e52ca77c731";

const REPO_ROOT = "/home/runner/work/demo/demo";
const LABEL = "pharn/accepted";
const CUSTOM = "team/tests-ok";
const REPO_FILES = ["package.json", "src/a.ts", "src/a.test.ts"];
/** `|| true` added to the test script (TI10) and an Istanbul hint added to src/a.ts line 12 (TI13). */
const BLOCK_DIFF = [
  "diff --git a/package.json b/package.json",
  "index 1111111..2222222 100644",
  "--- a/package.json",
  "+++ b/package.json",
  "@@ -7 +7 @@",
  '-    "test": "vitest run",',
  '+    "test": "vitest run || true",',
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -11,0 +12 @@",
  "+/* istanbul ignore next */",
  "",
].join("\n");
/** Line 12 of src/a.ts not covered: diff coverage 0% against a threshold of 80. */
const UNCOVERED = "TN:\nSF:src/a.ts\nDA:12,0\nend_of_record\n";

describe("Report v2 with the accept label", () => {
  it("AC-11: the accepted, ignored and labelled reports validate, a numeric acceptLabel does not, v2 documents the additions and v1 is unchanged", async () => {
    const { check, acceptTestIntegrity, ignoreAcceptLabel, withAcceptLabel } = await import("@pharn-ci/core");
    const checkWith = (coverage: string) =>
      check({
        version: "0.1.0",
        coverage: { text: coverage, format: "lcov" },
        diff: { text: BLOCK_DIFF },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: REPO_FILES,
        testIntegrityMode: { input: "block" },
      } as Parameters<typeof check>[0]);
    const block = checkWith(fixture("golden/coverage.info"));
    const below = checkWith(UNCOVERED);
    expect(block.testIntegrity.signals.map((s) => `${s.id} ${s.severity}`)).toEqual(["TI10 block", "TI13 block"]);

    const honoured = acceptTestIntegrity(block, { label: LABEL, by: "Reviewer-1" });
    const reports: Record<string, unknown> = {
      "AC-4 honoured": honoured,
      "AC-5 custom label honoured": acceptTestIntegrity(withAcceptLabel(block, CUSTOM), {
        label: CUSTOM,
        by: "Reviewer-1",
      }),
      "AC-5 custom label not carried": withAcceptLabel(block, CUSTOM),
      "AC-5 default label": withAcceptLabel(block, LABEL),
      "AC-5 coverage below the threshold": acceptTestIntegrity(below, { label: LABEL, by: "Reviewer-1" }),
      "AC-6 author": ignoreAcceptLabel(block, LABEL, "author"),
      "AC-6 not a user": ignoreAcceptLabel(block, LABEL, "not-user"),
      "AC-7 no event": ignoreAcceptLabel(block, LABEL, "no-event"),
      "AC-7 unreadable": ignoreAcceptLabel(block, LABEL, "unreadable"),
      "AC-8 author last": ignoreAcceptLabel(withAcceptLabel(block, CUSTOM), CUSTOM, "author"),
    };
    for (const [name, report] of Object.entries(reports)) {
      expect(() => expectValidReport(report), name).not.toThrow();
    }
    expect(honoured.testIntegrity.accepted).toEqual({ label: LABEL, by: "Reviewer-1" });
    expect(honoured.messages.map((m) => m.code)).toContain("TEST_INTEGRITY_ACCEPTED");

    // acceptLabel is a string field: a string validates, a number does not.
    const withString = { ...block, testIntegrity: { ...block.testIntegrity, acceptLabel: CUSTOM } };
    const withNumber = { ...block, testIntegrity: { ...block.testIntegrity, acceptLabel: 7 } };
    expect(validateReport(withString), JSON.stringify(validateReport.errors)).toBe(true);
    expect(validateReport(withNumber)).toBe(false);

    // The v2 schema documents the two codes and the field; the v1 schema is the base commit's bytes.
    const v2 = read("schema/report.v2.json");
    for (const name of ["TEST_INTEGRITY_ACCEPTED", "TEST_INTEGRITY_ACCEPT_IGNORED", "acceptLabel"]) {
      expect(v2, name).toContain(name);
    }
    const v1 = readFileSync(new URL("schema/report.v1.json", ROOT));
    expect(createHash("sha256").update(v1).digest("hex")).toBe(V1_AT_BASE);
  });
});
