import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dependencyCase } from "./dependencies-helpers.js";
import { FIXTURES, fixture } from "./helpers.js";
import { injectionFixture } from "./injection-fixture.js";
import { expectValidReport } from "./schema.js";

// fix-hints (H6), AC-6. check() and the core's fix table are loaded inside the test body: the AC test is written
// before the build adds the table and the `fix` objects. The runs are the AC-5 fixtures, all of them existing ones;
// every report is validated against schema/report.v2.json.

const REPO_ROOT = "/home/runner/work/demo/demo";

type Fix = { kind: string; target?: string; hint: string };
type Message = { level: string; code: string; text: string; fix?: Fix };
type Report = { messages: Message[]; testIntegrity: { signals: { id: string }[] } };
type Entry = { kind: string; hint: string };

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

const tiInput = (text: string) => ({
  version: "0.1.0",
  coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
  diff: { text },
  repoRoot: REPO_ROOT,
  threshold: 80,
  repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
  testIntegrityMode: { input: "block" },
});

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

const policyInput = () => ({
  version: "0.1.0",
  coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
  diff: { text: fixture("policy-rules/p11/workflows/ci.diff") + fixture("policy-rules/p14/files/over-cap.diff") },
  repoRoot: REPO_ROOT,
  threshold: null,
  repoFiles: ["AGENTS.md", ".github/workflows/ci.yml", "README.md", "docs/guide.md", "src/a.ts", "src/b.ts"],
  policy: {
    source: "app",
    version: 3,
    fetchedAt: "2026-11-08T12:00:00.000Z",
    document: { version: 1, agents: { protected_paths: [".github/workflows/**"], max_files: 3 } },
  },
  agentPrFacts: {
    pr: { author: { login: "claude[bot]", type: "Bot" }, labels: [], commits: [commit("Add the feature\n")] },
  },
});

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

const injectionInput = (name: string) => ({
  version: "0.1.0",
  coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
  diff: { text: injectionFixture(name) },
  repoRoot: REPO_ROOT,
  threshold: null,
  repoFiles: ["AGENTS.md", "src/a.ts"],
});

const CASES: Array<[string, () => unknown]> = [
  ["TI01", () => tiInput(fixture("test-integrity/TI01/block-root-tests.diff"))],
  ["TI05", ti05Input],
  ["TI14", () => tiInput(fixture("test-integrity/TI14/block-threshold-lowered.diff"))],
  ["TI11", () => tiInput(fixture("test-integrity/TI11/block-test-step-removed.diff"))],
  ["policy P11 and P14", policyInput],
  ["stale instructions", staleInput],
  ["injection trojan-source", () => injectionInput("trojan-source.diff.txt")],
  ["injection literature-sample", () => injectionInput("literature-sample.diff.txt")],
  ["dependencies d04-integrity", () => dependencyCase("d04-integrity")],
  ["dependencies d05-manifest", () => dependencyCase("d05-manifest")],
];

async function reports(): Promise<{ all: Array<[string, Report]>; table: Record<string, Entry> }> {
  const core = (await import("../src/index.js")) as unknown as {
    check(input: unknown): Report;
    MESSAGE_FIXES?: Record<string, Entry>;
  };
  const all = CASES.map(([name, input]): [string, Report] => {
    const report = core.check(input());
    expectValidReport(report);
    return [name, report];
  });
  expect(core.MESSAGE_FIXES, "MESSAGE_FIXES is exported").toBeDefined();
  return { all, table: core.MESSAGE_FIXES ?? {} };
}

describe("fix hints on every message of a report", { timeout: 120_000 }, () => {
  it("AC-6: every message carries fix with the table's kind and hint for its code and no target", async () => {
    const { all, table } = await reports();
    let count = 0;
    for (const [name, report] of all) {
      expect(report.messages.length, `${name}: messages`).toBeGreaterThan(0);
      for (const message of report.messages) {
        const label = `${name} ${message.code}`;
        const entry = table[message.code];
        expect(entry, `${label}: the table has the code`).toBeDefined();
        expect(message.fix, `${label} carries fix`).toBeDefined();
        expect(Object.keys(message.fix ?? {}).sort(), `${label}: kind and hint only`).toEqual(["hint", "kind"]);
        expect(message.fix?.kind, `${label}: kind`).toBe(entry?.kind);
        expect(message.fix?.hint, `${label}: hint`).toBe(entry?.hint);
        expect(message.fix, `${label}: no target`).not.toHaveProperty("target");
        count++;
      }
    }
    expect(count).toBeGreaterThan(10);
  });

  it("AC-6: the TEST_INTEGRITY_<id> message of each signal id present carries fix with its signal's kind", async () => {
    const { all, table } = await reports();
    const seen = new Set<string>();
    for (const [name, report] of all) {
      for (const id of new Set(report.testIntegrity.signals.map((s) => s.id))) {
        const code = `TEST_INTEGRITY_${id}`;
        const message = report.messages.find((m) => m.code === code);
        expect(message, `${name}: the ${code} message`).toBeDefined();
        expect(message?.fix, `${name}: ${code} carries fix`).toBeDefined();
        expect(message?.fix?.kind, `${name}: ${code} kind`).toBe(table[code]?.kind);
        seen.add(id);
      }
    }
    for (const id of ["TI01", "TI05", "TI11", "TI14"]) expect([...seen], id).toContain(id);
    expect(table.TEST_INTEGRITY_TI01?.kind).toBe("restore-test");
    expect(table.TEST_INTEGRITY_TI05?.kind).toBe("restore-assertion");
    expect(table.TEST_INTEGRITY_TI11?.kind).toBe("revert-config");
    expect(table.TEST_INTEGRITY_TI14?.kind).toBe("revert-config");
  });

  it("AC-6: a message whose code has no honest action still carries a none fix with a non-empty hint", async () => {
    const { all } = await reports();
    const none = all.flatMap(([, report]) => report.messages.filter((m) => m.fix?.kind === "none"));
    expect(none.length, "at least one message of kind none").toBeGreaterThan(0);
    for (const message of none) {
      expect((message.fix?.hint ?? "").trim().length, message.code).toBeGreaterThan(0);
    }
  });
});
