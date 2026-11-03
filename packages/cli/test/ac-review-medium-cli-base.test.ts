import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { EXIT_FAIL, EXIT_OK, main } from "../src/main.js";
import { nodeDeps } from "../src/nodeDeps.js";
import { coverage, fakeDeps, fixture } from "./fake-deps.js";

// Review finding 13: a --base that resolves to HEAD (or to a commit after it) gives an empty base...HEAD diff, which
// used to pass as NO_COVERABLE_CHANGES while measuring nothing. It is now DIFF_UNAVAILABLE: a fail with a threshold.

type Report = {
  verdict: string;
  diffCoverage: unknown;
  messages: { code: string; level: string; text: string }[];
};

const codes = (report: Report) => report.messages.map((m) => m.code);

describe("cli: a --base that resolves to HEAD (real git repo)", () => {
  let dir: string;
  let revertBase: string;
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  async function runCheck(args: string[]) {
    const deps = nodeDeps(dir);
    let out = "";
    let err = "";
    deps.stdout = (t) => {
      out += t;
    };
    deps.stderr = (t) => {
      err += t;
    };
    const code = await main(["check", "--coverage", "coverage/lcov.info", "--format", "json", ...args], deps);
    return { code, report: JSON.parse(out) as Report, err };
  }

  beforeAll(() => {
    // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
    dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-base-head-")));
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "test@example.com");
    sh("config", "user.name", "test");
    sh("config", "commit.gpgsign", "false");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 2;\n");
    sh("add", ".");
    sh("commit", "-q", "-m", "base");
    sh("checkout", "-q", "-b", "feature");
    writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
    sh("add", ".");
    sh("commit", "-q", "-m", "feature");
    // A branch one commit ahead of feature: from feature it is a descendant of HEAD.
    sh("checkout", "-q", "-b", "ahead");
    writeFileSync(join(dir, "src/extra.ts"), "export const e = 5;\n");
    sh("add", ".");
    sh("commit", "-q", "-m", "ahead");
    // A branch whose two commits change a file and then undo it: base...HEAD is empty although HEAD has new commits.
    sh("checkout", "-q", "-b", "reverted", "feature");
    revertBase = sh("rev-parse", "HEAD").trim();
    writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 9;\nexport const c = 4;\n");
    sh("commit", "-q", "-am", "change");
    writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
    sh("commit", "-q", "-am", "undo");
    sh("checkout", "-q", "feature");
    mkdirSync(join(dir, "coverage"));
    writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nDA:3,0\nend_of_record\n`);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("AC-13: --base HEAD --threshold 80 reports DIFF_UNAVAILABLE naming --base, and exits 1", async () => {
    const { code, report } = await runCheck(["--base", "HEAD", "--threshold", "80"]);

    expectValidReport(report);
    expect(code).toBe(EXIT_FAIL);
    expect(report.verdict).toBe("fail");
    expect(report.diffCoverage).toBeNull();
    const unavailable = report.messages.find((m) => m.code === "DIFF_UNAVAILABLE");
    expect(unavailable?.level).toBe("error");
    expect(unavailable?.text).toContain('--base "HEAD" resolves to HEAD or a descendant of HEAD');
    expect(codes(report)).not.toContain("NO_COVERABLE_CHANGES");
  });

  it("AC-13: --base HEAD with --test-integrity block and a threshold no longer passes", async () => {
    const { code, report } = await runCheck(["--base", "HEAD", "--threshold", "80", "--test-integrity", "block"]);

    expectValidReport(report);
    expect(code).toBe(EXIT_FAIL);
    expect(report.verdict).toBe("fail");
    expect(codes(report)).toContain("DIFF_UNAVAILABLE");
  });

  it("AC-13: a --base that is a descendant of HEAD is DIFF_UNAVAILABLE too", async () => {
    const { code, report } = await runCheck(["--base", "ahead", "--threshold", "80"]);

    expectValidReport(report);
    expect(code).toBe(EXIT_FAIL);
    expect(codes(report)).toContain("DIFF_UNAVAILABLE");
  });

  it("AC-13: without a threshold, --base HEAD warns and exits 0 (the existing DIFF_UNAVAILABLE rule)", async () => {
    const { code, report } = await runCheck(["--base", "HEAD"]);

    expectValidReport(report);
    expect(code).toBe(EXIT_OK);
    expect(report.verdict).toBe("warn");
    expect(report.messages.find((m) => m.code === "DIFF_UNAVAILABLE")?.level).toBe("warn");
  });

  it("AC-13: an empty diff over commits HEAD has and the base lacks is still NO_COVERABLE_CHANGES", async () => {
    sh("checkout", "-q", "reverted");
    try {
      const { code, report } = await runCheck(["--base", revertBase, "--threshold", "80"]);

      expectValidReport(report);
      expect(code).toBe(EXIT_OK);
      expect(report.verdict).toBe("pass");
      expect(codes(report)).toContain("NO_COVERABLE_CHANGES");
      expect(codes(report)).not.toContain("DIFF_UNAVAILABLE");
    } finally {
      sh("checkout", "-q", "feature");
    }
  });

  it("AC-13: a base with commits to measure is measured as before", async () => {
    // Lines 2 and 3 of src/math.ts are added and line 2 is covered: 50%.
    const { code, report } = await runCheck(["--base", "main", "--threshold", "50"]);

    expectValidReport(report);
    expect(code).toBe(EXIT_OK);
    expect(codes(report)).not.toContain("DIFF_UNAVAILABLE");
    expect(report.diffCoverage).not.toBeNull();
  });
});

const HEAD_OID = "c".repeat(40);
const OTHER_OID = "d".repeat(40);

/** The fake CLI deps with an empty diff (unless `diff` is given) and the given answers to the merge-base check. */
function emptyDiffDeps(mergeBase: string | Error, head: string | Error = HEAD_OID, diff = "") {
  const deps = fakeDeps(coverage, { diff });
  const fallback = deps.git.bind(deps);
  deps.git = async (args) => {
    if (args[0] === "merge-base" || (args[0] === "rev-parse" && args.includes("HEAD^{commit}"))) {
      deps.gitCalls.push(args);
      const answer = args[0] === "merge-base" ? mergeBase : head;
      if (answer instanceof Error) throw answer;
      return `${answer}\n`;
    }
    return fallback(args);
  };
  return deps;
}

describe("cli: only a merge base equal to HEAD means nothing to measure", () => {
  const args = ["check", "--coverage", "lcov.info", "--base", "develop", "--threshold", "80", "--format", "json"];

  it("AC-13: an empty diff whose merge base is HEAD is DIFF_UNAVAILABLE, asked with --end-of-options", async () => {
    const deps = emptyDiffDeps(HEAD_OID);

    expect(await main(args, deps)).toBe(EXIT_FAIL);
    const report = JSON.parse(deps.out) as Report;
    expectValidReport(report);
    expect(codes(report)).toContain("DIFF_UNAVAILABLE");
    expect(deps.gitCalls).toContainEqual(["merge-base", "--end-of-options", "develop", "HEAD"]);
    expect(deps.gitCalls).toContainEqual(["rev-parse", "--verify", "--quiet", "--end-of-options", "HEAD^{commit}"]);
  });

  it("AC-13: an empty diff whose merge base is another commit is NO_COVERABLE_CHANGES, as before", async () => {
    const deps = emptyDiffDeps(OTHER_OID);

    expect(await main(args, deps)).toBe(EXIT_OK);
    const report = JSON.parse(deps.out) as Report;
    expectValidReport(report);
    expect(report.verdict).toBe("pass");
    expect(codes(report)).toContain("NO_COVERABLE_CHANGES");
    expect(codes(report)).not.toContain("DIFF_UNAVAILABLE");
  });

  it("AC-13: an empty diff with merge-base rejecting, or equal answers that are not commit ids, is as before", async () => {
    for (const deps of [emptyDiffDeps(new Error("fatal: bad revision")), emptyDiffDeps("ok", "ok")]) {
      expect(await main(args, deps)).toBe(EXIT_OK);
      const report = JSON.parse(deps.out) as Report;
      expect(codes(report)).toContain("NO_COVERABLE_CHANGES");
      expect(codes(report)).not.toContain("DIFF_UNAVAILABLE");
    }
  });

  it("AC-13: a non-empty diff never asks for the merge base", async () => {
    const deps = emptyDiffDeps(HEAD_OID, HEAD_OID, fixture("golden/pr.diff"));

    await main(args, deps);
    expect(deps.gitCalls.some((a) => a[0] === "merge-base")).toBe(false);
    expect(codes(JSON.parse(deps.out) as Report)).not.toContain("DIFF_UNAVAILABLE");
  });
});
