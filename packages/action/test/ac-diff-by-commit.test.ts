import type { Report } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { main } from "../../cli/src/main.js";
import { coverage, fakeDeps } from "../../cli/test/fake-deps.js";
import { expectValidReport } from "../../core/test/schema.js";
import { run } from "../src/run.js";
import { fixture, harness } from "./harness.js";

// CORE-14 follow-up (CodeRabbit on #250): the CLI and the Action resolve the base, HEAD and their merge base once per run
// (CORE-143), and the local diff names the commit ids of that resolution, not the base ref. A fake git whose base ref
// resolves to another commit on any later `rev-parse` shows that the diff, and the base-is-HEAD check, use the first
// answer: a ref that moves mid-run cannot make the two judge different commits.

const FIRST = "1".repeat(40);
const MOVED = "2".repeat(40);
const HEAD_OID = "c".repeat(40);

/** A git double for the run's revisions: `ref` resolves to `first`, then to MOVED on every later call. */
function movingRef(ref: string, first: string) {
  const state = { baseCalls: 0, diffs: [] as string[][] };
  const answer = async (args: string[]): Promise<string | undefined> => {
    if (args[0] === "rev-parse" && args.includes("--verify")) {
      const revision = args.at(-1);
      if (revision === "HEAD^{commit}") return `${HEAD_OID}\n`;
      if (revision === `${ref}^{commit}`) return `${state.baseCalls++ === 0 ? first : MOVED}\n`;
      throw new Error(`fatal: bad revision '${revision}'`);
    }
    // The base is HEAD's ancestor: the merge base is the base, or HEAD itself for a base that is HEAD.
    if (args[0] === "merge-base" && args.length === 3) return `${args[1]}\n`;
    if (args[0] === "diff") {
      state.diffs.push(args);
      // The change exists only between the first base and HEAD; a base that is HEAD has nothing to diff.
      return args.at(-1) === `${FIRST}...${HEAD_OID}` ? fixture("golden/pr.diff") : "";
    }
    return undefined;
  };
  return { state, answer };
}

const codes = (report: Report) => report.messages.map((m) => m.code);

describe("the local diff names the commits of the run's one resolution", () => {
  it("CLI: the diff is FIRST...HEAD although the base ref would resolve to another commit on a second call", async () => {
    const deps = fakeDeps(coverage);
    const fake = movingRef("develop", FIRST);
    const fallback = deps.git.bind(deps);
    deps.git = async (args) => {
      const out = await fake.answer(args);
      if (out === undefined) return fallback(args);
      deps.gitCalls.push(args);
      return out;
    };

    await main(["check", "--coverage", "lcov.info", "--base", "develop", "--format", "json"], deps);
    const report = JSON.parse(deps.out) as Report;
    expectValidReport(report);
    expect(fake.state.diffs.map((args) => args.slice(-2))).toEqual([["--end-of-options", `${FIRST}...${HEAD_OID}`]]);
    expect(fake.state.baseCalls).toBe(1);
    expect(report.diffCoverage?.percent).toBe(71.43);
  });

  it("CLI: a base that resolved to HEAD stays HEAD for the diff and the base-is-HEAD check: DIFF_UNAVAILABLE", async () => {
    const deps = fakeDeps(coverage);
    const fake = movingRef("develop", HEAD_OID);
    const fallback = deps.git.bind(deps);
    deps.git = async (args) => {
      const out = await fake.answer(args);
      if (out === undefined) return fallback(args);
      deps.gitCalls.push(args);
      return out;
    };

    await main(
      ["check", "--coverage", "lcov.info", "--base", "develop", "--threshold", "80", "--format", "json"],
      deps,
    );
    const report = JSON.parse(deps.out) as Report;
    expectValidReport(report);
    expect(fake.state.diffs.map((args) => args.at(-1))).toEqual([`${HEAD_OID}...${HEAD_OID}`]);
    expect(fake.state.baseCalls).toBe(1);
    expect(codes(report)).toContain("DIFF_UNAVAILABLE");
    expect(codes(report)).not.toContain("NO_COVERABLE_CHANGES");
  });

  it("Action: the diff is FIRST...HEAD although origin/<base-ref> would resolve to another commit on a second call", async () => {
    const h = harness({ inputs: { "base-ref": "main" } });
    const fake = movingRef("origin/main", FIRST);
    const fallback = h.deps.git;
    h.deps.git = async (args) => {
      const out = await fake.answer(args);
      if (out === undefined) return fallback(args);
      h.gitCalls.push(args);
      return out;
    };

    const report = await run(h.deps);
    expect(h.failed).toEqual([]);
    expect(fake.state.diffs).toEqual([
      [
        "diff",
        "--unified=0",
        "--no-color",
        "--no-ext-diff",
        "--find-renames",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--end-of-options",
        `${FIRST}...${HEAD_OID}`,
      ],
    ]);
    expect(fake.state.baseCalls).toBe(1);
    expect(report?.diffCoverage?.percent).toBe(71.43);
  });

  it("Action: a base that resolved to HEAD stays HEAD for the diff and the base-is-HEAD check: DIFF_UNAVAILABLE", async () => {
    const h = harness({ inputs: { "base-ref": "main", threshold: "80" } });
    const fake = movingRef("origin/main", HEAD_OID);
    const fallback = h.deps.git;
    h.deps.git = async (args) => {
      const out = await fake.answer(args);
      if (out === undefined) return fallback(args);
      h.gitCalls.push(args);
      return out;
    };

    const report = await run(h.deps);
    expect(fake.state.diffs.map((args) => args.at(-1))).toEqual([`${HEAD_OID}...${HEAD_OID}`]);
    expect(fake.state.baseCalls).toBe(1);
    expect(report?.messages.map((m) => m.code)).toContain("DIFF_UNAVAILABLE");
  });
});
