import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-13. check() is loaded inside the test body: the AC test is written before the build
// adds the rules, so nothing the build adds may run while this file loads. The golden inputs are passed as
// packages/core/test/golden.test.ts passes them, and the reports are compared byte for byte with the committed
// golden, never through a file snapshot.

const ROOT = new URL("../../../", import.meta.url);
const REPO_ROOT = "/home/runner/work/demo/demo";
const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;

describe("reports without a policy in force", { timeout: 60_000 }, () => {
  it("AC-13: no policy, a source-none policy and a source-none noApp policy write no policy key and match the golden byte for byte; an app policy writes one", async () => {
    const { check } = await import("@pharn-ci/core");
    const golden = readFileSync(new URL("fixtures/golden/report.json", ROOT), "utf8");
    const inputs = {
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    };

    const plain = check(inputs as never);
    expectValidReport(plain);
    expect("policy" in plain).toBe(false);
    expect(asFile(plain)).toBe(golden);

    for (const [name, policy] of [
      ["source none", { source: "none", version: null, document: null }],
      ["source none, noApp", { source: "none", version: null, document: null, noApp: true }],
    ] as const) {
      const report = check({ ...inputs, policy } as never);
      expectValidReport(report);
      expect("policy" in report, name).toBe(false);
      expect(asFile(report), name).toBe(asFile(plain));
      expect(asFile(report), name).toBe(golden);
    }

    const app = check({ ...inputs, policy: { source: "app", version: 3, document: { version: 1 } } } as never);
    expectValidReport(app);
    expect("policy" in app).toBe(true);
  });
});
