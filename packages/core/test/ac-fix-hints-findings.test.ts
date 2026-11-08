import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dependencyCase } from "./dependencies-helpers.js";
import { FIXTURES, fixture } from "./helpers.js";
import { injectionFixture } from "./injection-fixture.js";
import { expectValidReport } from "./schema.js";

// fix-hints (H6), AC-5. check() and the core's fix table are loaded inside the test body: the AC test is written
// before the build adds the table and the `fix` objects, so nothing the build adds may run while this file loads. Every
// run uses fixtures that already exist; every report is validated against schema/report.v2.json.

const REPO_ROOT = "/home/runner/work/demo/demo";

type Fix = { kind: string; target?: string; hint: string };
type Finding = { id: string; path: string | null; line: number | null; fix?: Fix };
type Report = {
  messages: { level: string; code: string; text: string; fix?: Fix }[];
  testIntegrity: { signals: Finding[] };
  policy?: { violations: Finding[] };
  setupHealth?: { stale: Finding[] };
  injection?: { signals: Finding[] };
  dependencies?: { signals: Finding[] };
};
type Entry = { kind: string; hint: string };

/** The kinds the SPEC's Data section gives the ids these fixtures produce. */
const EXPECTED_KIND: Record<string, string> = {
  TI01: "restore-test",
  TI05: "restore-assertion",
  TI11: "revert-config",
  TI14: "revert-config",
  P11: "request-review",
  P13: "revert-config",
  P14: "split-pr",
  SI01: "none",
  SI02: "none",
  SI03: "none",
  PI01: "request-review",
  PI02: "request-review",
  PI03: "request-review",
  D04: "request-review",
  D05: "remove-dependency",
};

async function load() {
  const core = (await import("../src/index.js")) as unknown as {
    check(input: unknown): Report;
    SIGNAL_FIXES?: Record<string, Entry>;
  };
  const run = (input: unknown): Report => {
    const report = core.check(input);
    expectValidReport(report);
    return report;
  };
  return { run, table: core.SIGNAL_FIXES ?? {} };
}

/** The finding's own path, or path:line when the line is not null; no target for a finding with no path. */
const targetOf = (f: Finding) => (f.path === null ? undefined : f.line === null ? f.path : `${f.path}:${f.line}`);

function expectFix(where: string, finding: Finding, table: Record<string, Entry>): void {
  const label = `${where} ${finding.id} ${finding.path}:${finding.line}`;
  const fix = finding.fix;
  expect(fix, `${label} carries fix`).toBeDefined();
  if (fix === undefined) return;
  const entry = table[finding.id];
  expect(entry, `${label}: the table has ${finding.id}`).toBeDefined();
  for (const key of Object.keys(fix)) expect(["kind", "target", "hint"], `${label}: fix.${key}`).toContain(key);
  expect(fix.kind, `${label}: kind`).toBe(entry?.kind);
  if (EXPECTED_KIND[finding.id] !== undefined) expect(fix.kind, `${label}: Data kind`).toBe(EXPECTED_KIND[finding.id]);
  expect(fix.target, `${label}: target`).toBe(targetOf(finding));
  expect(fix.hint, `${label}: hint`).toBe(entry?.hint);
}

function expectAllFindings(report: Report, table: Record<string, Entry>): number {
  const groups: Array<[string, Finding[]]> = [
    ["testIntegrity.signals", report.testIntegrity.signals],
    ["policy.violations", report.policy?.violations ?? []],
    ["setupHealth.stale", report.setupHealth?.stale ?? []],
    ["injection.signals", report.injection?.signals ?? []],
    ["dependencies.signals", report.dependencies?.signals ?? []],
  ];
  let count = 0;
  for (const [where, findings] of groups) {
    for (const finding of findings) {
      expectFix(where, finding, table);
      count++;
    }
  }
  return count;
}

const ids = (findings: Finding[] | undefined) => [...new Set((findings ?? []).map((f) => f.id))].sort();

/** A test-integrity fixture diff under fixtures/test-integrity/, with the coverage and files of test-files-deleted. */
function tiInput(text: string, extra: Record<string, unknown> = {}) {
  return {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
    ...extra,
  };
}

/** The `<logical path>.txt` files under one side of a case directory. */
function sideFiles(dir: string): Array<{ path: string; text: string }> {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The TI05 case fixtures/test-integrity/TI05/block-emptied, with its test sources at base and head. */
function ti05Input() {
  const root = `${FIXTURES}test-integrity/TI05/block-emptied/`;
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);
  return {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: readFileSync(`${root}change.diff`, "utf8") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  };
}

const commit = (message: string) => ({ authorLogin: "octocat", committerLogin: "octocat", message });
const AGENT_FACTS = {
  pr: { author: { login: "claude[bot]", type: "Bot" }, labels: [], commits: [commit("Add the feature\n")] },
};

/** An agent PR that changes a protected workflow (P11) and more files than the policy's cap (P14). */
function policyInput() {
  const document = {
    version: 1,
    agents: { protected_paths: [".github/workflows/**"], max_files: 3 },
  };
  return {
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("policy-rules/p11/workflows/ci.diff") + fixture("policy-rules/p14/files/over-cap.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", ".github/workflows/ci.yml", "README.md", "docs/guide.md", "src/a.ts", "src/b.ts"],
    policy: { source: "app", version: 3, fetchedAt: "2026-11-08T12:00:00.000Z", document },
    agentPrFacts: AGENT_FACTS,
  };
}

/** A change that touches CLAUDE.md, whose stale tokens give SI01, SI02 and SI03 findings. */
function staleInput() {
  const modified = (path: string) => ({ path, oldPath: path, status: "modified", addedLines: [1] });
  return {
    version: "0.7.0",
    coverage: { text: "SF:src/index.ts\nDA:1,1\nend_of_record\n", format: "lcov" },
    diff: { parsed: [modified("src/index.ts"), modified("CLAUDE.md")] },
    threshold: null,
    repoFiles: [
      "AGENTS.md",
      "CLAUDE.md",
      "Makefile",
      "docs/guide.md",
      "docs/setup.md",
      "package.json",
      "src/index.ts",
      "src/util/strings.ts",
    ],
    staleInstructionSources: {
      instructions: {
        files: [
          { path: "CLAUDE.md", text: fixture("stale-instructions/root-claude.md.txt") },
          { path: "AGENTS.md", text: "The entry point is `src/index.ts`.\n" },
        ],
        dropped: [],
      },
      packageJson: { head: fixture("stale-instructions/package.json.txt") },
      makefile: { head: fixture("stale-instructions/Makefile.txt") },
    },
  };
}

function injectionInput(name: string) {
  return {
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: injectionFixture(name) },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
  };
}

describe("fix hints on every finding of a report", { timeout: 120_000 }, () => {
  it("AC-5: test-integrity signals (TI01, TI05, TI14, TI11) carry the table's kind and hint and their path or path:line as target; the reports validate", async () => {
    const { run, table } = await load();
    const cases: Array<[string, unknown]> = [
      ["TI01", tiInput(fixture("test-integrity/TI01/block-root-tests.diff"))],
      ["TI05", ti05Input()],
      ["TI14", tiInput(fixture("test-integrity/TI14/block-threshold-lowered.diff"))],
      ["TI11", tiInput(fixture("test-integrity/TI11/block-test-step-removed.diff"))],
    ];
    const lines = new Set<string>();
    for (const [id, input] of cases) {
      const report = run(input);
      expect(ids(report.testIntegrity.signals), `the ${id} fixture gives ${id}`).toContain(id);
      expect(expectAllFindings(report, table)).toBeGreaterThan(0);
      for (const s of report.testIntegrity.signals) lines.add(s.line === null ? "null" : "number");
    }
    // Control: the fixtures cover both target shapes, a path alone and path:line.
    expect([...lines].sort()).toEqual(["null", "number"]);
  });

  it("AC-5: the P11 and P14 violations of an agent pull request carry the table's kind and hint, and their path or path:line as target", async () => {
    const { run, table } = await load();
    const report = run(policyInput());
    const found = ids(report.policy?.violations);
    expect(found).toContain("P11");
    expect(found).toContain("P14");
    expect(expectAllFindings(report, table)).toBeGreaterThan(1);
  });

  it("AC-5: stale-instruction findings carry the table's kind and hint and path:line as target", async () => {
    const { run, table } = await load();
    const report = run(staleInput());
    expect(ids(report.setupHealth?.stale)).toEqual(["SI01", "SI02", "SI03"]);
    expect(expectAllFindings(report, table)).toBeGreaterThan(0);
    for (const finding of report.setupHealth?.stale ?? []) {
      expect(finding.fix?.target).toBe(`${finding.path}:${finding.line}`);
    }
  });

  it("AC-5: prompt-injection signals carry the table's kind and hint and path:line as target", async () => {
    const { run, table } = await load();
    const trojan = run(injectionInput("trojan-source.diff.txt"));
    expect(ids(trojan.injection?.signals)).toContain("PI01");
    const literature = run(injectionInput("literature-sample.diff.txt"));
    expect(ids(literature.injection?.signals).length).toBeGreaterThan(0);
    expect(expectAllFindings(trojan, table) + expectAllFindings(literature, table)).toBeGreaterThan(1);
  });

  it("AC-5: dependency signals D04 and D05 carry the table's kind and hint and path:line as target", async () => {
    const { run, table } = await load();
    const d04 = run(dependencyCase("d04-integrity"));
    expect(ids(d04.dependencies?.signals)).toEqual(["D04"]);
    const d05 = run(dependencyCase("d05-manifest"));
    expect(ids(d05.dependencies?.signals)).toEqual(["D05"]);
    expect(expectAllFindings(d04, table) + expectAllFindings(d05, table)).toBeGreaterThan(1);
    expect(d04.dependencies?.signals[0]?.fix?.target).toBe("yarn.lock:10");
  });
});
