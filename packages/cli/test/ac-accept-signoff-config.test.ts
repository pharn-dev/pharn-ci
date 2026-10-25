import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { harness, WORKSPACE } from "../../action/test/harness.js";

// run() and main() are loaded inside each test body: the AC tests are written before the accept label exists, so
// nothing the build adds may run while the file loads. The Action runs on a pull request that carries the label,
// applied by Reviewer-1, on a diff that adds `|| true` to the test script: if the config could reach the label, the
// run would ask for the issue events and accept it.

const ROOT = new URL("../../../", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(`fixtures/${path}`, ROOT), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";
const SHA = "1111111111111111111111111111111111111111";
const LABEL = "pharn/accepted";
const FILES = ["package.json", "src/a.ts", "src/a.test.ts"];
const OR_TRUE = [
  "diff --git a/package.json b/package.json",
  "index 1111111..2222222 100644",
  "--- a/package.json",
  "+++ b/package.json",
  "@@ -7 +7 @@",
  '-    "test": "vitest run",',
  '+    "test": "vitest run || true",',
  "",
].join("\n");
const EVENTS = [
  {
    id: 1,
    event: "labeled",
    actor: { login: "Reviewer-1", type: "User" },
    label: { name: LABEL, color: "0e8a16" },
    created_at: "2026-10-20T10:00:00Z",
  },
];

const CONFIGS = [
  ["accept_label alone", "test_integrity:\n  accept_label: other\n"],
  ["accept_label with mode block", "test_integrity:\n  mode: block\n  accept_label: other\n"],
] as const;

async function actionRun(config: string) {
  const { run } = await import("../../action/src/run.js");
  const h = harness({
    inputs: { "test-integrity": "block" },
    lsFiles: FILES,
    files: { [`${WORKSPACE}/.pharn/ci.yml`]: config },
  });
  const eventCalls: number[] = [];
  const git = h.deps.git;
  h.deps.git = async (args) => (args[0] === "diff" ? OR_TRUE : git(args));
  h.deps.api = {
    ...h.deps.api,
    async compareDiff(_basehead: string) {
      return OR_TRUE;
    },
    async getPullRequestSignoff(_pullNumber: number) {
      return { author: { login: "claude[bot]", type: "Bot" }, labels: [{ name: LABEL, color: "0e8a16" }] };
    },
    async listIssueEvents(issueNumber: number, _page: number) {
      eventCalls.push(issueNumber);
      return { events: EVENTS, hasNext: false };
    },
  } as typeof h.deps.api;
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  const report = text === undefined ? undefined : JSON.parse(text);
  return { h, report, eventCalls };
}

function fakeRepo(config: string) {
  const out: string[] = [];
  const err: string[] = [];
  const contents = new Map([
    [resolve(REPO_ROOT, "coverage/lcov.info"), fixture("golden/coverage.info")],
    [resolve(REPO_ROOT, ".pharn/ci.yml"), config],
  ]);
  const deps = {
    cwd: REPO_ROOT,
    git: async (args: string[]) => {
      if (args.includes("ls-files")) return args.includes("-z") ? `${FILES.join("\0")}\0` : `${FILES.join("\n")}\n`;
      if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
      if (args.includes("diff")) return OR_TRUE;
      return `${SHA}\n`;
    },
    readFile: async (path: string) => contents.get(path) ?? null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  return { deps, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("test_integrity.accept_label in .pharn/ci.yml never sets the label", () => {
  for (const [name, config] of CONFIGS) {
    it(`AC-2: ${name}: the Action step fails pointing at the accept-label input and accepts nothing`, async () => {
      const { h, report, eventCalls } = await actionRun(config);

      expect(h.failed).toHaveLength(1);
      expect(h.failed[0]).toContain("test_integrity.accept_label");
      expect(h.failed[0]).toContain("accept-label");
      expect(eventCalls).toEqual([]);
      expect(report?.testIntegrity?.accepted ?? null).toBeNull();
      expect((report?.messages ?? []).filter((m: { code: string }) => m.code === "TEST_INTEGRITY_ACCEPTED")).toEqual(
        [],
      );

      // The CLI reads the same config and exits 2 naming the key.
      const { main } = await import("../src/main.js");
      const repo = fakeRepo(config);
      const code = await main(["check", "--coverage", "coverage/lcov.info", "--format", "json"], repo.deps as never);
      expect(code).toBe(2);
      expect(repo.stderr()).toContain("test_integrity.accept_label");
    });
  }
});
