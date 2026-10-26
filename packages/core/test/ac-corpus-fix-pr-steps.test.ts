import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// corpus-run-errors-3: scripts/corpus-run.mjs exports `createPrSteps({ git, cache, remoteUrlTemplate, queue, sleep })`
// with `prepare(repo, pr)` and `cleanup(repo, pr)`. Every clone-mutating git call of one repository runs inside that
// repository's queue (from `createKeyedQueue()`), and `prepare` releases the queue when it resolves, so the CLI run
// between `prepare` and `cleanup` stays parallel. The git runner here is a fake: no real clone, no network. Each call
// is recorded on a logical clock (a counter) so the overlap checks do not depend on wall-clock timing. The module is
// imported inside each test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REMOTE = "https://example.invalid/{repo}.git";

type GitResult = {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
};
type Git = (args: string[], options: { cwd: string }) => Promise<GitResult>;
type Pr = { number: number; baseSha: string; headSha: string };
type Queue = { run: <T>(key: string, fn: () => Promise<T>) => Promise<T> };
type Steps = {
  prepare: (repo: string, pr: Pr) => Promise<{ error: string | null }>;
  cleanup: (repo: string, pr: Pr) => Promise<void>;
};
type Run = {
  createKeyedQueue: () => Queue;
  createPrSteps: (options: {
    git: Git;
    cache: string;
    remoteUrlTemplate: string;
    queue: Queue;
    sleep: (ms: number) => Promise<void>;
  }) => Steps;
};

const load = async (): Promise<Run> =>
  (await import(pathToFileURL(join(ROOT, "scripts/corpus-run.mjs")).href)) as unknown as Run;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Call = { args: string[]; cwd: string; repo: string; start: number; end: number };
const overlaps = (x: Call, y: Call): boolean => x.start < y.end && y.start < x.end;

// The repository a call touches: the clone by its URL, every other call by its working directory (or a path in its
// arguments), `<cache>/<owner>__<name>` and `<cache>/.worktrees/<owner>__<name>-<n>`.
const repoOf = (args: string[], cwd: string): string => {
  const text = [cwd, ...args].join(" ");
  if (text.includes("/a/one.git") || text.includes("a__one")) return "a/one";
  if (text.includes("/b/two.git") || text.includes("b__two")) return "b/two";
  return "?";
};

const fakeGit = () => {
  let clock = 0;
  const calls: Call[] = [];
  const git: Git = async (args, { cwd }) => {
    const call: Call = { args, cwd, repo: repoOf(args, cwd), start: clock++, end: Number.POSITIVE_INFINITY };
    calls.push(call);
    await delay(2);
    call.end = clock++;
    return { code: 0, signal: null, stdout: "", stderr: "", timedOut: false, spawnError: null };
  };
  return { git, calls };
};

const fakeSleep = () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    sleeps.push(ms);
  };
  return { sleep, sleeps };
};

const pr = (number: number): Pr => ({
  number,
  baseSha: `${"e".repeat(39)}${number}`,
  headSha: `${"f".repeat(39)}${number}`,
});

const kind = (call: Call): string => (call.args[0] === "worktree" ? `worktree ${call.args[1]}` : (call.args[0] ?? ""));

let cache = "";
afterEach(() => {
  if (cache !== "") rmSync(cache, { recursive: true, force: true });
  cache = "";
});

describe("corpus-run createPrSteps", () => {
  it("AC-8: git calls of one repository never overlap, while two repositories run in parallel", async () => {
    const { createKeyedQueue, createPrSteps } = await load();
    cache = mkdtempSync(join(tmpdir(), "corpus-fix-steps-"));
    const { git, calls } = fakeGit();
    const { sleep } = fakeSleep();
    const steps = createPrSteps({ git, cache, remoteUrlTemplate: REMOTE, queue: createKeyedQueue(), sleep });

    const runs = ["a/one", "b/two"].flatMap((repo) =>
      [1, 2, 3].map(async (n) => {
        const prepared = await steps.prepare(repo, pr(n));
        await steps.cleanup(repo, pr(n));
        return prepared;
      }),
    );
    const results = await Promise.all(runs);

    for (const result of results) expect(result.error).toBeNull();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.repo === "?")).toEqual([]);

    for (const repo of ["a/one", "b/two"]) {
      const mine = calls.filter((call) => call.repo === repo);
      for (let i = 0; i < mine.length; i++) {
        for (let j = i + 1; j < mine.length; j++) {
          expect(overlaps(mine[i] as Call, mine[j] as Call)).toBe(false);
        }
      }
    }

    const one = calls.filter((call) => call.repo === "a/one");
    const two = calls.filter((call) => call.repo === "b/two");
    expect(one.some((x) => two.some((y) => overlaps(x, y)))).toBe(true);

    const kinds = new Set(calls.map(kind));
    for (const expected of ["clone", "fetch", "cat-file", "worktree add", "worktree remove", "worktree prune"]) {
      expect(kinds.has(expected)).toBe(true);
    }
  }, 20_000);

  it("AC-9: prepare releases the repository's queue before cleanup is called", async () => {
    const { createKeyedQueue, createPrSteps } = await load();
    cache = mkdtempSync(join(tmpdir(), "corpus-fix-steps-"));
    const { git, calls } = fakeGit();
    const { sleep } = fakeSleep();
    const steps = createPrSteps({ git, cache, remoteUrlTemplate: REMOTE, queue: createKeyedQueue(), sleep });

    const first = await steps.prepare("a/one", pr(1));
    expect(first.error).toBeNull();

    const second = await Promise.race([
      steps.prepare("a/one", pr(2)),
      delay(10_000).then(() => "prepare for PR 2 did not resolve" as const),
    ]);
    expect(second).not.toBe("prepare for PR 2 did not resolve");
    expect((second as { error: string | null }).error).toBeNull();

    // PR 1's cleanup has still not been called: no worktree of PR 1 was removed.
    const worktree1 = join(cache, ".worktrees", "a__one-1");
    expect(calls.filter((call) => kind(call) === "worktree remove" && call.args.includes(worktree1))).toEqual([]);

    await steps.cleanup("a/one", pr(1));
    await steps.cleanup("a/one", pr(2));
  }, 20_000);
});
