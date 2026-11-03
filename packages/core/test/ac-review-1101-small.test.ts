import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Small fixes from the 2026-11-01 review: findings 26 (__proto__ in the config), 32 (the accepted line shown twice),
// 48 (the mode message names the config in use; upload keys are redacted).

const REPO_ROOT = "/home/runner/work/demo/demo";

async function golden(extra: Record<string, unknown> = {}) {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    ...extra,
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

describe("review 2026-11-01, small fixes", { timeout: 60_000 }, () => {
  it("26: a __proto__ key in .pharn/ci.yml is an error, bare, quoted or nested, and sets nothing", () => {
    for (const text of [
      "__proto__:\n  coverage:\n    threshold: 0\n",
      '"__proto__":\n  coverage:\n    threshold: 0\n',
      "coverage:\n  __proto__:\n    threshold: 0\n",
      "'__proto__': 1\n",
    ]) {
      expect(() => parseConfig(text), text).toThrow(ConfigError);
      expect(() => parseConfig(text), text).toThrow('the key "__proto__" is not allowed');
    }
    expect(({} as Record<string, unknown>).coverage).toBeUndefined();
  });

  it("48: TEST_INTEGRITY_MODE_IGNORED names the config in use; the default keeps its text", async () => {
    const mode = { testIntegrityMode: { input: "block", config: "warn" } };
    const custom = await golden({ ...mode, configPath: "ci/pharn.yml" });
    const named = custom.messages.find((m) => m.code === "TEST_INTEGRITY_MODE_IGNORED");
    expect(named?.text.startsWith("`ci/pharn.yml` sets test_integrity.mode to warn")).toBe(true);

    const fallback = await golden(mode);
    const plain = fallback.messages.find((m) => m.code === "TEST_INTEGRITY_MODE_IGNORED");
    expect(plain?.text.startsWith(".pharn/ci.yml sets test_integrity.mode to warn")).toBe(true);
  });

  it("32: an accepted report shows the accepted line and its hint once, and Messages leaves the message out", async () => {
    const { acceptTestIntegrity, renderMarkdown } = await import("@pharn-ci/core");
    const accepted = acceptTestIntegrity(await golden({ testIntegrityMode: { input: "block" } }), {
      label: "pharn-ci:accept",
      by: "Reviewer-1",
    });
    expect(accepted.messages.some((m) => m.code === "TEST_INTEGRITY_ACCEPTED")).toBe(true);
    const md = renderMarkdown(accepted);
    expect(md.match(/Accepted via label/g)).toHaveLength(1);
    expect(md.match(/remove the label if a later push should be judged again/g)).toHaveLength(1);
    expect(md).not.toContain("was applied by Reviewer-1, who is not the PR author");
  });

  it("48: the upload bundle redacts a secret in a key, not only in values", async () => {
    const { buildUploadBundle } = await import("../src/upload/bundle.js");
    const token = `ghp_${"a".repeat(36)}`;
    const report = await golden();
    const withKey = { ...report, extra: { [token]: "x" } } as unknown as typeof report;
    const bundle = buildUploadBundle(withKey, { schemaVersion: 1 } as never) as unknown as { report: string };
    expect(JSON.stringify(bundle)).not.toContain(token);
  });
});
