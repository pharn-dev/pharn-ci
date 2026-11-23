import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Report } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { requiredDeps, type StreamedFake } from "../../node-io/test/required-deps.js";
import { BASE_OID, type BaseEntry, fakeConfigGit, HEAD_OID } from "./config-git-fake.js";

// CORE-95, the table test: config state (untouched, edited, added, deleted, base unreadable) x threshold (set, unset) x
// test-integrity mode (block, warn), through the Action's run() and the CLI's main() with --base, over one fake git
// whose merge base holds fixtures/config-at-merge-base/base-ci.yml. run() and main() are loaded inside the test body.
//
// The change adds two lines to src/a.ts (one covered) and two to src/b.ts (none covered). The base config excludes
// src/b.ts, so a run with it measures 50%; a run with no config measures 25%; the copy the "edited" change leaves
// excludes every file ("**"), which the current code would use and pass as NO_COVERABLE_CHANGES.

const FIXTURES = new URL("../../../fixtures/config-at-merge-base/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");
const REPO_ROOT = "/home/runner/work/demo/demo";
const CONFIG = ".pharn/ci.yml";

type State = "untouched" | "edited" | "added" | "deleted" | "unreadable";
type Mode = "block" | "warn";

interface Scenario {
  diff: string;
  /** The working tree's copy of the config, or null when it has none. */
  head: string | null;
  base: Record<string, BaseEntry>;
  noMergeBase?: boolean;
}

function scenario(state: State): Scenario {
  const base = { [CONFIG]: fixture("base-ci.yml") };
  switch (state) {
    case "untouched":
      return { diff: fixture("untouched.diff"), head: fixture("base-ci.yml"), base };
    case "edited":
      return { diff: fixture("exclude-all/change.diff"), head: fixture("exclude-all/ci.yml"), base };
    case "added":
      return { diff: fixture("added/change.diff"), head: fixture("added/ci.yml"), base: {} };
    case "deleted":
      return { diff: fixture("deleted.diff"), head: null, base };
    case "unreadable":
      return { diff: fixture("exclude-all/change.diff"), head: fixture("exclude-all/ci.yml"), base, noMergeBase: true };
  }
}

function repo(s: Scenario) {
  const tracked = fixture("files.txt").trim().split("\n");
  const fallback = async (args: string[]) => {
    if (args[0] === "ls-files") return `${tracked.join("\0")}\0`;
    if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
    if (args[0] === "diff") return s.diff;
    return "";
  };
  const fake = fakeConfigGit({ files: s.base, ...(s.noMergeBase ? { noMergeBase: true } : {}) }, fallback);
  const files = new Map<string, string>([[resolve(REPO_ROOT, "coverage/lcov.info"), fixture("coverage.info")]]);
  if (s.head !== null) files.set(resolve(REPO_ROOT, CONFIG), s.head);
  return { ...fake, readFile: async (path: string) => files.get(path) ?? null };
}

async function actionReport(state: State, threshold: boolean, mode: Mode): Promise<Report> {
  const { run } = await import("../../action/src/run.js");
  const r = repo(scenario(state));
  const inputs: Record<string, string> = {
    "coverage-file": "coverage/lcov.info",
    threshold: threshold ? "80" : "",
    "test-integrity": mode,
    comment: "false",
    policy: "never",
    upload: "never",
  };
  const written = new Map<string, string>();
  const outputs: Record<string, string> = {};
  const failed: string[] = [];
  const deps = {
    ...requiredDeps((): StreamedFake => deps),
    getInput: (name: string) => inputs[name] ?? "",
    context: {
      eventName: "pull_request",
      sha: HEAD_OID,
      repo: { owner: "octo", repo: "demo" },
      payload: { pull_request: { number: 7, base: { sha: BASE_OID }, head: { sha: HEAD_OID } } },
    },
    workspace: REPO_ROOT,
    tempDir: "/home/runner/work/_temp",
    api: {
      compareDiff: async () => {
        throw new Error("no compare call was expected");
      },
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: r.git,
    gitBatch: r.gitBatch,
    readFile: r.readFile,
    listDir: async () => null,
    writeFile: async (path: string, text: string) => {
      written.set(path, text);
    },
    resolvePath: (...segments: string[]) => resolve(...segments),
    info: () => {},
    warning: () => {},
    setOutput: (name: string, value: unknown) => {
      outputs[name] = String(value);
    },
    setFailed: (message: string) => {
      failed.push(message);
    },
    writeSummary: async () => {},
  };
  await run(deps as never);
  const text = written.get(outputs["report-path"] ?? "");
  if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(failed)}`);
  return JSON.parse(text) as Report;
}

async function cliReport(state: State, threshold: boolean, mode: Mode): Promise<{ code: number; report: Report }> {
  const { main } = await import("../src/main.js");
  const r = repo(scenario(state));
  let out = "";
  const deps = {
    ...requiredDeps((): StreamedFake => deps),
    cwd: REPO_ROOT,
    git: r.git,
    gitBatch: r.gitBatch,
    readFile: r.readFile,
    listDir: async () => null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out += text;
    },
    stderr: () => {},
  };
  const argv = ["check", "--base", "main", "--format", "json", "--coverage", "coverage/lcov.info"];
  argv.push("--test-integrity", mode, ...(threshold ? ["--threshold", "80"] : []));
  const code = await main(argv, deps as never);
  return { code, report: JSON.parse(out) as Report };
}

/** What each cell must give, from the rules of CORE-95. */
function expected(state: State, threshold: boolean, mode: Mode) {
  const baseUsed = state === "untouched" || state === "edited" || state === "deleted";
  const gated = threshold || mode === "block";
  // TI14 still reports the exclusion the change adds (the appended "**", or the new file's `exclude:` list), at the
  // mode's level, for the pull requests after it.
  const ti14 = state === "edited" || state === "unreadable" || state === "added";
  const configLevel = state === "untouched" ? null : state === "unreadable" && gated ? "error" : "warn";
  // Every cell warns at least once: no test file exercises the two changed sources (TESTS_NOT_EXERCISING_CHANGES).
  let verdict: string;
  if (threshold) verdict = "fail";
  else if (ti14 && mode === "block") verdict = "fail";
  else verdict = "warn";
  return {
    percent: baseUsed ? 50 : 25,
    excluded: baseUsed ? ["src/b.ts"] : [],
    configLevel,
    ti14,
    verdict,
    threshold: threshold ? 80 : null,
  };
}

const STATES: State[] = ["untouched", "edited", "added", "deleted", "unreadable"];

describe("CORE-95: the config the change edits is read at the merge base", () => {
  it("AC-1: config state x threshold x mode gives the same verdict and CONFIG_CHANGED_IN_DIFF through run() and main() --base", async () => {
    // Control: the edited cell with a threshold fails on the base config's 50%; reading the change's own copy (every
    // file excluded) would pass it as NO_COVERABLE_CHANGES.
    const control = await actionReport("edited", true, "warn");
    expect(control.diffCoverage?.percent, "edited, threshold set: the base config is used").toBe(50);
    expect(control.verdict).toBe("fail");

    for (const state of STATES) {
      for (const threshold of [true, false]) {
        for (const mode of ["block", "warn"] as const) {
          const label = `${state}, threshold ${threshold ? "set" : "unset"}, mode ${mode}`;
          const want = expected(state, threshold, mode);
          const action = await actionReport(state, threshold, mode);
          const cli = await cliReport(state, threshold, mode);
          for (const [who, report] of [
            ["action", action],
            ["cli", cli.report],
          ] as const) {
            const at = `${label} (${who})`;
            expectValidReport(report);
            expect(report.diffCoverage?.percent, at).toBe(want.percent);
            expect(report.diffCoverage?.excludedFiles ?? [], at).toEqual(want.excluded);
            expect(report.diffCoverage?.threshold, at).toBe(want.threshold);
            const config = report.messages.filter((m) => m.code === "CONFIG_CHANGED_IN_DIFF");
            expect(
              config.map((m) => m.level),
              at,
            ).toEqual(want.configLevel === null ? [] : [want.configLevel]);
            const text = config[0]?.text ?? "";
            if (state === "edited" || state === "deleted") {
              expect(text, at).toContain("`.pharn/ci.yml` as it is at the merge base");
              expect(text, at).toContain("applies after merge");
            }
            if (state === "added") expect(text, at).toContain("`.pharn/ci.yml` is new in this change");
            if (state === "unreadable") expect(text, at).toContain("`fetch-depth: 0`");
            const ti14 = report.testIntegrity.signals.filter((s) => s.id === "TI14");
            expect(
              ti14.map((s) => s.severity),
              at,
            ).toEqual(want.ti14 ? [mode] : []);
            const levels = report.messages.map((m) => `${m.code}:${m.level}`).join(", ");
            expect(report.verdict, `${at}: ${levels}`).toBe(want.verdict);
          }
          // The CLI with --base behaves like the Action: the same messages, in the same order, and the exit code.
          // The accept label is the Action's alone (TEST_INTEGRITY_ACCEPT_IGNORED: no labeling event was found).
          const shared = (report: Report) => report.messages.filter((m) => !m.code.startsWith("TEST_INTEGRITY_ACCEPT"));
          const codesOf = (report: Report) => shared(report).map((m) => `${m.code}:${m.level}`);
          expect(codesOf(cli.report), label).toEqual(codesOf(action));
          expect(shared(cli.report), label).toEqual(shared(action));
          expect(cli.code, label).toBe(want.verdict === "fail" ? 1 : 0);
        }
      }
    }
  });
});
