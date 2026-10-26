import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before CheckInput has `policy`, so nothing the
// build adds may run while the file loads. The golden inputs are passed as the existing golden tests pass them
// (golden.test.ts, ac-format-golden.test.ts, ac-globs-golden.test.ts), and the reports are compared byte for byte
// with the committed goldens, never through a file snapshot.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const REPO_ROOT = "/home/runner/work/demo/demo";
const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;
const lines = (path: string) => fixture(path).trim().split("\n");

/** sha256 of each golden report.json at the base commit 3ed722f. */
const GOLDENS_AT_BASE: Record<string, string> = {
  golden: "0e2fc1bc1779fadebf210df5f97fdd3a0332ffbc95819c07d81efcaabfd04d6b",
  "golden-cobertura": "eac1c1d0a28453f3662369863801a04f9a937dc1f5dba5faca69d1cdbb28e25a",
  "golden-exclusions": "f32a70ee388a578c97222555e475558684cce277307a17b92c53b0090583236a",
  "golden-multi": "0e2fc1bc1779fadebf210df5f97fdd3a0332ffbc95819c07d81efcaabfd04d6b",
};

/** The existing assertions that compare a whole default Action report with the golden report. */
const WHOLE_REPORT_ASSERTIONS: Array<[string, string]> = [
  ["packages/action/test/ac-stream-action.test.ts", "expect(action.report()).toEqual(goldenReport());"],
  ["packages/cli/test/ac-stream-adapters.test.ts", "expect(action.report()).toEqual(goldenReport());"],
];

function goldenInputs(dir: string): Record<string, unknown> {
  const base = {
    version: "0.1.0",
    diff: { text: fixture(`${dir}/pr.diff`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: lines(`${dir}/files.txt`),
  };
  if (dir === "golden") return { ...base, coverage: { text: fixture("golden/coverage.info"), format: "lcov" } };
  if (dir === "golden-cobertura") {
    return { ...base, coverage: { text: fixture("golden-cobertura/coverage.xml"), format: "auto" } };
  }
  if (dir === "golden-exclusions") {
    // fixtures/golden-exclusions/ci.yml: threshold 80, exclusions src/generated/** and *.gen.ts.
    return {
      ...base,
      coverage: { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
      threshold: 80,
      exclude: ["src/generated/**", "*.gen.ts"],
    };
  }
  return {
    ...base,
    coverage: {
      files: [
        { text: fixture("golden-multi/coverage-a.info"), file: "coverage/a/lcov.info" },
        { text: fixture("golden-multi/coverage-b.info"), file: "coverage/b/lcov.info" },
      ],
      format: "auto",
    },
  };
}

describe("reports with no policy, or a policy of source none", () => {
  it("AC-26: are byte-identical to the base goldens; a timeout policy appends one POLICY_UNAVAILABLE warning last", async () => {
    const { check, parseConfig } = await import("@pharn-ci/core");
    const config = parseConfig(fixture("golden-exclusions/ci.yml")) as { coverage?: { exclude?: string[] } };
    expect(config.coverage?.exclude).toEqual(["src/generated/**", "*.gen.ts"]);

    const NONE = { source: "none", version: null, document: null };
    const TIMEOUT = {
      source: "none",
      version: null,
      document: null,
      unavailable: { reason: "timeout", required: false },
    };
    for (const dir of Object.keys(GOLDENS_AT_BASE)) {
      const golden = read(`fixtures/${dir}/report.json`);
      expect(createHash("sha256").update(golden).digest("hex"), dir).toBe(GOLDENS_AT_BASE[dir]);
      const inputs = goldenInputs(dir);

      const plain = check(inputs as never);
      expectValidReport(plain);
      expect(asFile(plain), dir).toBe(golden);

      const none = check({ ...inputs, policy: NONE } as never);
      expectValidReport(none);
      expect(asFile(none), `${dir} with a policy of source none`).toBe(golden);

      // Control: an unavailable policy adds exactly one message, last, and nothing else.
      const timedOut = check({ ...inputs, policy: TIMEOUT } as never);
      expectValidReport(timedOut);
      const last = timedOut.messages.at(-1) as { level: string; code: string; text: string } | undefined;
      expect(last?.code, dir).toBe("POLICY_UNAVAILABLE");
      expect(last?.level, dir).toBe("warn");
      expect(last?.text, dir).toContain("timeout");
      // The verdict may move from pass to warn with the added warning; every other field is the plain report's.
      // E3 item 22 (policy rules): an unavailable policy now also carries the `policy` object with its one P10 warn
      // violation. It is asserted here, and every other field is still the plain report's.
      const { policy, ...rest } = timedOut;
      expect(policy, dir).toEqual({
        source: "none",
        version: null,
        violations: [
          { id: "P10", severity: "warn", path: null, line: null, detail: "org policy could not be read (timeout)" },
        ],
      });
      expect({ ...rest, verdict: plain.verdict, messages: timedOut.messages.slice(0, -1) }, dir).toEqual(plain);
    }

    for (const [file, assertion] of WHOLE_REPORT_ASSERTIONS) expect(read(file), file).toContain(assertion);
    // The test spends 3 to 4 s on git calls and four full check runs per golden; 30 s keeps it from timing out when the
    // host is loaded (no assertion is changed by this).
  }, 30_000);
});
