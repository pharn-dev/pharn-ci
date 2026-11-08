import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dependencyCase } from "./dependencies-helpers.js";
import { fixture } from "./helpers.js";
import { injectionFixture } from "./injection-fixture.js";
import { expectValidReport } from "./schema.js";

// fix-hints (H6), AC-10. check(), buildUploadMeta() and buildUploadBundle() are loaded inside the test body: the AC
// test is written before the build adds the `fix` objects. The report joins the findings of several check() runs on
// existing fixtures, so it has fix on messages and on every kind of finding; it is validated before it is bundled.

const REPO_ROOT = "/home/runner/work/demo/demo";
const ROOT = new URL("../../../", import.meta.url);

type Fix = { kind: string; target?: string; hint: string };
type Json = Record<string, unknown>;
type Report = Json & {
  messages: { code: string; text: string; fix?: Fix }[];
  testIntegrity: { signals: { fix?: Fix }[] };
};

interface Core {
  check(input: unknown): Report;
  buildUploadMeta(
    report: unknown,
    extra: { version: string; createdAt: string; commentUrl: string | null },
  ): Json | null;
  buildUploadBundle(report: unknown, meta: unknown, options?: { messageMaxBytes?: number }): { reportJson: string };
}

const META = {
  event: "pull_request",
  repository: "pharn-dev/pharn-ci",
  repositoryId: 123,
  prNumber: 68,
  headSha: "b".repeat(40),
  baseSha: "a".repeat(40),
  scope: "ci/check",
  runId: 9,
  runAttempt: 1,
  actor: "octocat",
  upload: { status: "skipped" },
};
const commit = (message: string) => ({ authorLogin: "octocat", committerLogin: "octocat", message });

/** The finding arrays of a report, by name. */
const GROUPS = [
  ["testIntegrity", "signals"],
  ["policy", "violations"],
  ["setupHealth", "stale"],
  ["injection", "signals"],
  ["dependencies", "signals"],
] as const;

function findings(report: Json, group: string, key: string): Array<{ fix?: Fix }> {
  return ((report[group] as Json | undefined)?.[key] as Array<{ fix?: Fix }> | undefined) ?? [];
}

/** One report with fix on messages and on findings of every kind: the policy run, joined with the other runs' findings. */
function joinedReport(core: Core): Report {
  const policy = core.check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: {
      text: fixture("policy-rules/p11/workflows/ci.diff") + fixture("test-integrity/TI01/block-root-tests.diff"),
    },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["AGENTS.md", ".github/workflows/ci.yml", "src/a.ts"],
    meta: META,
    policy: {
      source: "app",
      version: 3,
      fetchedAt: "2026-11-08T12:00:00.000Z",
      document: { version: 1, agents: { protected_paths: [".github/workflows/**"] } },
    },
    agentPrFacts: {
      pr: { author: { login: "claude[bot]", type: "Bot" }, labels: [], commits: [commit("Add the feature\n")] },
    },
    testIntegrityMode: { input: "block" },
  });
  const modified = (path: string) => ({ path, oldPath: path, status: "modified", addedLines: [1] });
  const stale = core.check({
    version: "0.1.0",
    coverage: { text: "SF:src/index.ts\nDA:1,1\nend_of_record\n", format: "lcov" },
    diff: { parsed: [modified("src/index.ts"), modified("CLAUDE.md")] },
    threshold: null,
    repoFiles: ["AGENTS.md", "CLAUDE.md", "Makefile", "docs/guide.md", "package.json", "src/index.ts"],
    staleInstructionSources: {
      instructions: {
        files: [{ path: "CLAUDE.md", text: fixture("stale-instructions/root-claude.md.txt") }],
        dropped: [],
      },
      packageJson: { head: fixture("stale-instructions/package.json.txt") },
      makefile: { head: fixture("stale-instructions/Makefile.txt") },
    },
  });
  const injection = core.check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: injectionFixture("trojan-source.diff.txt") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
  });
  const dependencies = core.check(dependencyCase("d05-manifest"));
  const joined = {
    ...policy,
    setupHealth: stale.setupHealth,
    injection: injection.injection,
    dependencies: dependencies.dependencies,
    messages: [...policy.messages, ...stale.messages, ...injection.messages, ...dependencies.messages],
  } as Report;
  expectValidReport(joined);
  return joined;
}

describe("the upload bundle keeps fix hints", { timeout: 120_000 }, () => {
  it("AC-10: the bundle's report.json carries every fix unchanged in kind, target and hint, through redaction and the byte caps, and validates", async () => {
    const core = (await import("../src/index.js")) as unknown as Core;
    const report = joinedReport(core);
    const extra = JSON.parse(readFileSync(new URL("fixtures/upload/extra.json", ROOT), "utf8")) as {
      version: string;
      createdAt: string;
      commentUrl: string | null;
    };
    const meta = core.buildUploadMeta(report, extra);
    expect(meta, "the report has run metadata").not.toBeNull();

    // Every kind of object in the input carries fix.
    expect(report.messages.length).toBeGreaterThan(0);
    for (const m of report.messages) expect(m.fix, `message ${m.code} carries fix`).toBeDefined();
    for (const [group, key] of GROUPS) {
      const list = findings(report, group, key);
      expect(list.length, `${group}.${key} has findings`).toBeGreaterThan(0);
      for (const f of list) expect(f.fix, `${group}.${key} finding carries fix`).toBeDefined();
    }

    for (const options of [undefined, { messageMaxBytes: 100 }]) {
      const label = options === undefined ? "default caps" : "messageMaxBytes 100";
      const uploaded = JSON.parse(core.buildUploadBundle(report, meta, options).reportJson) as Report;
      expectValidReport(uploaded);
      expect(
        uploaded.messages.map((m) => [m.code, m.fix]),
        `${label}: messages`,
      ).toEqual(report.messages.map((m) => [m.code, m.fix]));
      for (const [group, key] of GROUPS) {
        expect(
          findings(uploaded, group, key).map((f) => f.fix),
          `${label}: ${group}.${key}`,
        ).toEqual(findings(report, group, key).map((f) => f.fix));
      }
      if (options !== undefined) {
        // Control: the cap did cut a message's text, and left its fix alone.
        const cut = uploaded.messages.some((m, i) => m.text !== report.messages[i]?.text);
        expect(cut, "a message text was cut at 100 bytes").toBe(true);
      }
    }
  });
});
