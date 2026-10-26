import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../../core/src/version.js";
import { expectValidReport } from "../../core/test/schema.js";
import { coverage, fakeDeps } from "./fake-deps.js";

// main() is loaded inside the test body: the AC test is written before the --policy-file and --no-policy flags
// exist, so nothing the build adds may run while the file loads. The CLI runs on the default fakes
// (packages/cli/test/fake-deps.ts), whose run with --threshold 80 reports fixtures/golden/report.json.

const ROOT = new URL("../../../", import.meta.url);
const ARGV = ["check", "--coverage", "lcov.info", "--threshold", "80", "--format", "json"];

/** fixtures/golden/report.json as the CLI reports it (the package VERSION). */
function goldenReport() {
  const golden = JSON.parse(readFileSync(new URL("fixtures/golden/report.json", ROOT), "utf8"));
  return { ...golden, tool: { ...golden.tool, version: VERSION } };
}

async function cli(extra: string[]) {
  const { main } = await import("../src/main.js");
  const fake = fakeDeps(coverage);
  const code = await main([...ARGV, ...extra], fake);
  return { code, out: fake.out, err: fake.err };
}

describe("the CLI policy flags", () => {
  it("AC-16: --no-policy equals no flag and the base golden; --policy-file with --no-policy is a usage error naming both", async () => {
    const plain = await cli([]);
    const noPolicy = await cli(["--no-policy"]);

    expect(noPolicy.code, noPolicy.err).toBe(plain.code);
    expect(noPolicy.out).toBe(plain.out);
    const report = JSON.parse(plain.out);
    expectValidReport(report);
    expect(report).toEqual(goldenReport());

    const both = await cli(["--policy-file", "x.json", "--no-policy"]);
    expect(both.code).toBe(2);
    expect(both.out).toBe("");
    expect(both.err).toContain("--policy-file");
    expect(both.err).toContain("--no-policy");
  });
});
