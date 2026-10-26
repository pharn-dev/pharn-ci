import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// corpus-run-errors-3: `createPrSteps(...).prepare(repo, pr)` from scripts/corpus-run.mjs retries a failed
// `git worktree add` once (2 attempts). Between the attempts, still inside the repository's queue, it removes the
// half-made worktree (`worktree remove --force <path>`, `worktree prune`) and waits 2000 ms through the injected
// `sleep`. After the last failed attempt the detail names the cause line, or the exit code when there is none. A
// failed clone's detail is `clone failed: <cause line>`. The git runner and `sleep` are fakes: no real clone, no
// network, no real wait. The module is imported inside each test body.

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

const result = (code: number, stderr = ""): GitResult => ({
  code,
  signal: null,
  stdout: "",
  stderr,
  timedOut: false,
  spawnError: null,
});

const pr = (number: number): Pr => ({
  number,
  baseSha: `${"e".repeat(39)}${number}`,
  headSha: `${"f".repeat(39)}${number}`,
});

type Call = { args: string[]; cwd: string };
type Answer = (args: string[], cwd: string) => GitResult | undefined;

// A recording fake runner: `answer` may return a failing result for a call; every other call succeeds.
const fakeGit = (answer: Answer) => {
  const calls: Call[] = [];
  const git: Git = async (args, { cwd }) => {
    calls.push({ args, cwd });
    await delay(1);
    return answer(args, cwd) ?? result(0);
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

const isWorktreeAdd = (call: Call, path: string): boolean =>
  call.args[0] === "worktree" && call.args[1] === "add" && call.args.includes(path);

const LOCKED = "Preparing worktree (detached HEAD 1a2b3c4)\nfatal: could not lock config file\n";

const caches: string[] = [];
const newCache = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "corpus-fix-retry-"));
  caches.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of caches.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("corpus-run git worktree add retry", () => {
  it("AC-10: a failed worktree add is cleaned up and retried once inside the repository's queue", async () => {
    const { createKeyedQueue, createPrSteps } = await load();
    const cache = newCache();
    const worktree1 = join(cache, ".worktrees", "a__one-1");
    const worktree2 = join(cache, ".worktrees", "a__one-2");
    let failed = false;
    const { git, calls } = fakeGit((args) => {
      if (!failed && args[0] === "worktree" && args[1] === "add" && args.includes(worktree1)) {
        failed = true;
        return result(128, LOCKED);
      }
      return undefined;
    });
    const { sleep, sleeps } = fakeSleep();
    const steps = createPrSteps({ git, cache, remoteUrlTemplate: REMOTE, queue: createKeyedQueue(), sleep });

    const [first, second] = await Promise.all([steps.prepare("a/one", pr(1)), steps.prepare("a/one", pr(2))]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const attempts = calls.flatMap((call, index) => (isWorktreeAdd(call, worktree1) ? [index] : []));
    expect(attempts).toHaveLength(2);
    expect(sleeps).toEqual([2000]);

    const [firstAttempt, secondAttempt] = attempts as [number, number];
    const between = calls.slice(firstAttempt + 1, secondAttempt);
    expect(
      between.some(
        (call) =>
          call.args[0] === "worktree" &&
          call.args[1] === "remove" &&
          call.args.includes("--force") &&
          call.args.includes(worktree1),
      ),
    ).toBe(true);
    expect(between.some((call) => call.args[0] === "worktree" && call.args[1] === "prune")).toBe(true);

    const pr2 = pr(2);
    const forPr2 = (call: Call): boolean =>
      call.args.some(
        (arg) =>
          arg.includes(pr2.headSha) || arg.includes(pr2.baseSha) || arg.includes(worktree2) || arg.includes("pull/2/"),
      );
    expect(between.filter(forPr2)).toEqual([]);
  }, 20_000);

  it("AC-11: after two failed attempts the detail names the cause line, or the exit code when there is none", async () => {
    const { createKeyedQueue, createPrSteps } = await load();
    const cases: [string, (error: string | null) => void][] = [
      [
        LOCKED,
        (error) => expect(error).toBe("git worktree add failed after 2 attempts: fatal: could not lock config file"),
      ],
      [
        "Preparing worktree (detached HEAD 1a2b3c4)\n",
        (error) => expect(error).toBe("git worktree add failed after 2 attempts (exit code 128)"),
      ],
      [
        `fatal: ${"x".repeat(400)}`,
        (error) => {
          expect(typeof error).toBe("string");
          const text = error as string;
          expect(text).toHaveLength(300);
          expect(text.startsWith("git worktree add failed after 2 attempts: fatal: x")).toBe(true);
          expect(text.endsWith("…")).toBe(true);
        },
      ],
    ];

    for (const [stderr, check] of cases) {
      const cache = newCache();
      const worktree = join(cache, ".worktrees", "a__one-1");
      const { git, calls } = fakeGit((args) =>
        args[0] === "worktree" && args[1] === "add" ? result(128, stderr) : undefined,
      );
      const { sleep, sleeps } = fakeSleep();
      const steps = createPrSteps({ git, cache, remoteUrlTemplate: REMOTE, queue: createKeyedQueue(), sleep });

      const prepared = await steps.prepare("a/one", pr(1));

      expect(calls.filter((call) => isWorktreeAdd(call, worktree))).toHaveLength(2);
      expect(sleeps).toEqual([2000]);
      check(prepared.error);
    }
  }, 20_000);

  it("AC-12: a failed clone's detail is its fatal: line after the clone failed: prefix", async () => {
    const { createKeyedQueue, createPrSteps } = await load();
    const cache = newCache();
    const { git } = fakeGit((args) =>
      args[0] === "clone"
        ? result(128, "Cloning into '/c/a__one'...\nfatal: repository 'https://example.invalid/a/one.git/' not found\n")
        : undefined,
    );
    const { sleep } = fakeSleep();
    const steps = createPrSteps({ git, cache, remoteUrlTemplate: REMOTE, queue: createKeyedQueue(), sleep });

    const prepared = await steps.prepare("a/one", pr(1));

    expect(prepared.error).toBe("clone failed: fatal: repository 'https://example.invalid/a/one.git/' not found");
  }, 20_000);
});
