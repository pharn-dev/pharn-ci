import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import type { ActionContext } from "../src/run.js";

// Review findings 9 and 13. run() and the harness are loaded inside each test body, like the other AC tests.
//
// 9: a failed file listing (`git ls-files`, or the PR head's tree in PR-number mode) used to become an empty list, so
// the checks that use it ran on nothing and passed. It now fails the step, as the CLI does.
// 13: a base that resolves to HEAD or a descendant of it (base-ref: HEAD, or the run's own sha) gives an empty diff,
// which used to pass as NO_COVERABLE_CHANGES. It is now DIFF_UNAVAILABLE: a fail with a threshold.

const HEAD_OID = "c".repeat(40);
const OTHER_OID = "d".repeat(40);
const PR_BASE = "a".repeat(40);

type Report = {
  verdict: string;
  diffCoverage: unknown;
  messages: { code: string; level: string; text: string }[];
};

const codes = (report: Report | undefined) => (report?.messages ?? []).map((m) => m.code);

interface BaseCheck {
  inputs?: Record<string, string>;
  /** What `git merge-base` prints, or how it fails. */
  mergeBase: string | Error;
  /** What `git rev-parse --verify HEAD^{commit}` prints (default: HEAD_OID). */
  head?: string;
  /** The local diff (default: empty). */
  diff?: string;
}

/** The harness with an empty local diff and the given answers to the merge-base check. */
async function baseCheckHarness({ inputs = {}, mergeBase, head = HEAD_OID, diff = "" }: BaseCheck) {
  const { harness } = await import("./harness.js");
  const h = harness({ inputs });
  const fallback = h.deps.git;
  h.deps.git = async (args) => {
    if (args[0] === "diff") {
      h.gitCalls.push(args);
      return diff;
    }
    if (args[0] === "merge-base") {
      h.gitCalls.push(args);
      if (mergeBase instanceof Error) throw mergeBase;
      return `${mergeBase}\n`;
    }
    if (args[0] === "rev-parse" && args.includes("HEAD^{commit}")) {
      h.gitCalls.push(args);
      return `${head}\n`;
    }
    return fallback(args);
  };
  return h;
}

describe("action: a failed file listing fails the step (review finding 9)", () => {
  it("AC-9: fails the step naming git ls-files when it rejects, with no report, comment or outputs", async () => {
    const { run } = await import("../src/run.js");
    const { harness } = await import("./harness.js");
    const h = harness({ lsFilesError: new Error("fatal: not a git repository"), inputs: { threshold: "0" } });

    const report = await run(h.deps);

    expect(report).toBeUndefined();
    expect(h.failed).toHaveLength(1);
    expect(h.failed[0]).toMatch(/^pharn-ci: git ls-files failed/);
    expect(h.failed[0]).toContain("fatal: not a git repository");
    expect(h.warnings.join("\n")).not.toContain("agent setup scan skipped");
    expect(h.outputs.verdict).toBeUndefined();
    expect(Object.keys(h.written).filter((p) => p.endsWith("report.json"))).toEqual([]);
    expect(h.posted).toEqual([]);
  });

  it("AC-9: in PR-number mode, fails the step when the PR head's tree cannot be listed", async () => {
    const { run } = await import("../src/run.js");
    const { harness } = await import("./harness.js");
    const headSha = "2".repeat(40);
    const context: ActionContext = {
      eventName: "workflow_run",
      sha: "4".repeat(40),
      payload: { workflow_run: { id: 99, event: "pull_request", head_sha: headSha } },
    } as never;
    const h = harness({ context, inputs: { "pr-number": "42", "head-sha": headSha, "github-token": "test-token" } });
    const listed: string[] = [];
    h.deps.api = {
      ...h.deps.api,
      getPullRequest: async () => ({ baseSha: "1".repeat(40), headSha }),
      listTree: async (sha: string) => {
        listed.push(sha);
        throw new Error("HTTP 502 Bad Gateway");
      },
    } as never;

    const report = await run(h.deps);

    expect(listed).toEqual([headSha]);
    expect(report).toBeUndefined();
    expect(h.failed).toHaveLength(1);
    expect(h.failed[0]).toMatch(/^pharn-ci: could not list the files of the PR head through the GitHub API/);
    expect(h.failed[0]).toContain("HTTP 502 Bad Gateway");
    expect(h.warnings.join("\n")).not.toContain("agent setup scan skipped");
    expect(h.outputs.verdict).toBeUndefined();
    expect(h.posted).toEqual([]);
    // The step failed before the diff was asked for.
    expect(h.apiCalls.filter((c) => c.startsWith("compare"))).toEqual([]);
  });
});

describe("action: a base that resolves to HEAD is DIFF_UNAVAILABLE (review finding 13)", () => {
  it("AC-13: base-ref set to the HEAD sha with threshold 80 is DIFF_UNAVAILABLE naming base-ref, and fails", async () => {
    const { run } = await import("../src/run.js");
    const h = await baseCheckHarness({ inputs: { "base-ref": HEAD_OID, threshold: "80" }, mergeBase: HEAD_OID });

    const report = (await run(h.deps)) as Report | undefined;

    expect(report).toBeDefined();
    expectValidReport(report);
    expect(report?.verdict).toBe("fail");
    expect(report?.diffCoverage).toBeNull();
    const unavailable = report?.messages.find((m) => m.code === "DIFF_UNAVAILABLE");
    expect(unavailable?.level).toBe("error");
    expect(unavailable?.text).toContain(`base-ref "${HEAD_OID}" resolves to HEAD or a descendant of HEAD`);
    expect(codes(report)).not.toContain("NO_COVERABLE_CHANGES");
    expect(h.failed).toHaveLength(1);
    expect(h.gitCalls).toContainEqual(["merge-base", "--end-of-options", HEAD_OID, "HEAD"]);
    expect(h.gitCalls).toContainEqual(["rev-parse", "--verify", "--quiet", "--end-of-options", "HEAD^{commit}"]);
  });

  it("AC-13: a pull request base that resolves to HEAD is DIFF_UNAVAILABLE too, naming the base", async () => {
    const { run } = await import("../src/run.js");
    const h = await baseCheckHarness({ inputs: { threshold: "80" }, mergeBase: HEAD_OID });

    const report = (await run(h.deps)) as Report | undefined;

    expectValidReport(report);
    expect(report?.verdict).toBe("fail");
    const unavailable = report?.messages.find((m) => m.code === "DIFF_UNAVAILABLE");
    expect(unavailable?.text).toContain(`the base ${PR_BASE} resolves to HEAD or a descendant of HEAD`);
  });

  it("AC-13: with a merge base that is another commit, the empty diff is NO_COVERABLE_CHANGES, as before", async () => {
    const { run } = await import("../src/run.js");
    const h = await baseCheckHarness({ inputs: { "base-ref": HEAD_OID, threshold: "80" }, mergeBase: OTHER_OID });

    const report = (await run(h.deps)) as Report | undefined;

    expectValidReport(report);
    expect(report?.verdict).toBe("pass");
    expect(codes(report)).toContain("NO_COVERABLE_CHANGES");
    expect(codes(report)).not.toContain("DIFF_UNAVAILABLE");
    expect(h.failed).toEqual([]);
  });

  it("AC-13: with merge-base rejecting, the empty diff is NO_COVERABLE_CHANGES, as before", async () => {
    const { run } = await import("../src/run.js");
    const h = await baseCheckHarness({
      inputs: { "base-ref": HEAD_OID, threshold: "80" },
      mergeBase: new Error("fatal: Not a valid commit name"),
    });

    const report = (await run(h.deps)) as Report | undefined;

    expectValidReport(report);
    expect(report?.verdict).toBe("pass");
    expect(codes(report)).toContain("NO_COVERABLE_CHANGES");
    expect(h.failed).toEqual([]);
  });

  it("AC-13: equal answers that are not commit ids are unknown, and the empty diff is used as before", async () => {
    const { run } = await import("../src/run.js");
    const h = await baseCheckHarness({
      inputs: { "base-ref": HEAD_OID, threshold: "80" },
      mergeBase: "ok",
      head: "ok",
    });

    const report = (await run(h.deps)) as Report | undefined;

    expect(report?.verdict).toBe("pass");
    expect(codes(report)).not.toContain("DIFF_UNAVAILABLE");
  });

  it("AC-13: a non-empty diff never asks for the merge base", async () => {
    const { run } = await import("../src/run.js");
    const { fixture } = await import("./harness.js");
    const h = await baseCheckHarness({
      inputs: { "base-ref": HEAD_OID },
      mergeBase: HEAD_OID,
      diff: fixture("golden/pr.diff"),
    });

    const report = (await run(h.deps)) as Report | undefined;

    expect(h.gitCalls.some((a) => a[0] === "merge-base")).toBe(false);
    expect(codes(report)).not.toContain("DIFF_UNAVAILABLE");
    expect((report?.diffCoverage as { percent: number } | null)?.percent).toBe(71.43);
  });
});
