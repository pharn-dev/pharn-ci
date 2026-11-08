import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sideFiles } from "../../core/test/dependencies-helpers.js";
import { expectValidReport } from "../../core/test/schema.js";
import { runGit, runGitBatch } from "../../node-io/src/io.js";
import { REGISTRY_USER_AGENT, registryGet } from "../src/registry-lookup.js";
import { harness, PR_CONTEXT } from "./harness.js";

// A13 (dependency safety) in the Action. A real temporary repository commits the lookups fixture case
// (fixtures/dependencies/lookups/) as a base commit and a head commit, with the head's commit time fixed, and the
// Action reads its diff and the touched manifests and lockfiles from git. The registry is a recorded fake: the test
// asserts every request it gets (host, method, headers, no redirect), never the live network.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const CASE = new URL("fixtures/dependencies/lookups/", ROOT).pathname;
const HEAD_DATE = "2026-11-08T00:00:00Z";

type Report = {
  verdict: string;
  messages: { level: string; code: string; text: string }[];
  dependencies?: {
    checked: number;
    lookups: string;
    signals: { id: string; severity: string; name?: string; path: string; line: number | null }[];
  };
};

let dir: string;
let baseSha: string;
let headSha: string;

function commitSide(side: "base" | "head", message: string, date: string) {
  for (const file of sideFiles(`${CASE}${side}`)) {
    mkdirSync(dirname(join(dir, file.path)), { recursive: true });
    writeFileSync(join(dir, file.path), file.text);
  }
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir, env });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
}

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-deps-action-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  baseSha = commitSide("base", "base", "2026-11-01T00:00:00Z");
  headSha = commitSide("head", "add dependencies", HEAD_DATE);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A recorded registry: the answer of each URL from fixtures/dependencies/registry/, and a 404 for anything else. */
const RECORDED: Record<string, string> = {
  "https://registry.npmjs.org/fresh-thing": "npm-fresh-thing",
  "https://registry.npmjs.org/left-pad": "npm-left-pad",
  "https://registry.npmjs.org/tiny-thing": "npm-tiny-thing",
  "https://api.npmjs.org/downloads/point/last-week/fresh-thing": "npm-downloads-high",
  "https://api.npmjs.org/downloads/point/last-week/left-pad": "npm-downloads-high",
  "https://api.npmjs.org/downloads/point/last-week/tiny-thing": "npm-downloads-low",
  "https://pypi.org/pypi/fresh-flask/json": "pypi-fresh-flask",
  "https://pypi.org/pypi/requests/json": "pypi-requests",
};

function recordedFetch(calls: Array<{ url: string; init: RequestInit }>, fail = false) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (fail) throw new TypeError("fetch failed");
    const name = RECORDED[url];
    if (name === undefined) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    const doc = JSON.parse(read(`fixtures/dependencies/registry/${name}.json`)) as { status: number; body: unknown };
    return new Response(JSON.stringify(doc.body), { status: doc.status });
  };
}

async function actionRun(inputs: Record<string, string>, options: { fail?: boolean; config?: string } = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({
    context: {
      ...PR_CONTEXT,
      sha: headSha,
      payload: { pull_request: { number: 7, base: { sha: baseSha }, head: { sha: headSha } } },
    } as never,
    inputs: { policy: "never", upload: "never", comment: "false", ...inputs },
    files: options.config === undefined ? {} : { "/home/runner/work/demo/demo/.pharn/ci.yml": options.config },
  });
  const calls: Array<{ url: string; init: RequestInit }> = [];
  Object.assign(h.deps, {
    git: (args: string[]) => runGit(dir, args),
    gitBatch: (args: string[], input: string) => runGitBatch(dir, args, input),
    fetch: recordedFetch(calls, options.fail),
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, calls };
}

describe("action: dependency safety", { timeout: 120_000 }, () => {
  it("auto (the default) checks offline and makes no registry request", async () => {
    const { report, calls } = await actionRun({});
    expect(calls).toEqual([]);
    expect(report.dependencies?.lookups).toBe("off");
    expect(report.dependencies?.signals).toEqual([]);
    // 5 package.json and 3 requirements.txt dependencies added, and 5 package-lock.json entries added.
    expect(report.dependencies?.checked).toBe(13);
  });

  it("lookup asks only the three registry hosts, with the package name and nothing else, and reports D01 to D03", async () => {
    const { report, calls, h } = await actionRun({ dependencies: "lookup" });
    expect(calls.map((c) => c.url).sort()).toEqual(
      [
        "https://api.npmjs.org/downloads/point/last-week/fresh-thing",
        "https://api.npmjs.org/downloads/point/last-week/left-pad",
        "https://api.npmjs.org/downloads/point/last-week/tiny-thing",
        "https://pypi.org/pypi/flask-jwt-securex/json",
        "https://pypi.org/pypi/fresh-flask/json",
        "https://pypi.org/pypi/requests/json",
        "https://registry.npmjs.org/fresh-thing",
        "https://registry.npmjs.org/left-pad",
        "https://registry.npmjs.org/reqeusts-helper",
        "https://registry.npmjs.org/tiny-thing",
      ].sort(),
    );
    for (const { init } of calls) {
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("error");
      expect(init.body).toBeUndefined();
      expect(init.headers).toEqual({ Accept: "application/json", "User-Agent": REGISTRY_USER_AGENT });
    }
    // The scoped name is never sent.
    expect(calls.some((c) => c.url.includes("acme"))).toBe(false);
    expect(report.dependencies?.lookups).toBe("done");
    expect(report.dependencies?.signals.map((s) => [s.id, s.name])).toEqual([
      ["D01", "reqeusts-helper"],
      ["D01", "flask-jwt-securex"],
      ["D02", "fresh-thing"],
      ["D02", "fresh-flask"],
      ["D03", "tiny-thing"],
    ]);
    expect(report.verdict).toBe("fail");
    expect(h.infos).toContain(
      "pharn-ci: looking up 7 added packages in the public registries (registry.npmjs.org, api.npmjs.org, pypi.org); only package names are sent",
    );
  });

  it("fails open when the registry cannot be reached", async () => {
    const { report } = await actionRun({ dependencies: "lookup" }, { fail: true });
    expect(report.dependencies?.lookups).toBe("unavailable");
    expect(report.dependencies?.signals).toEqual([]);
    expect(report.messages.find((m) => m.code === "DEPENDENCY_LOOKUP_UNAVAILABLE")?.level).toBe("warn");
  });

  it("never reads nothing and asks nothing, and .pharn/ci.yml cannot turn lookups on over it", async () => {
    const config = "dependencies:\n  lookup: true\n";
    const never = await actionRun({ dependencies: "never", config: ".pharn/ci.yml" }, { config });
    expect(never.calls).toEqual([]);
    expect(never.report.dependencies).toBeUndefined();
    const raised = await actionRun({ config: ".pharn/ci.yml" }, { config });
    expect(raised.report.dependencies?.lookups).toBe("done");
  });

  it("refuses a bad dependencies input before anything is read", async () => {
    const { run } = await import("../src/run.js");
    const h = harness({ inputs: { dependencies: "always" } });
    await run(h.deps);
    expect(h.failed).toEqual(['pharn-ci: dependencies must be one of: auto, lookup, never (got "always")']);
  });
});

describe("registryGet", () => {
  it("never fetches a URL off the three hosts, and refuses a body over 2 MiB unread", async () => {
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(url);
      return new Response("x".repeat(2_097_153), { status: 200 });
    };
    for (const url of [
      "https://evil.example.com/left-pad",
      "http://registry.npmjs.org/left-pad",
      "https://registry.npmjs.org/left-pad?token=1",
      "https://user:pw@registry.npmjs.org/left-pad",
      "https://registry.npmjs.org:444/left-pad",
    ]) {
      expect(await registryGet({ fetch }, url), url).toEqual({ kind: "network" });
    }
    expect(calls).toEqual([]);
    expect(await registryGet({ fetch }, "https://registry.npmjs.org/left-pad")).toEqual({
      kind: "response",
      status: 200,
      tooLarge: true,
    });
    expect(await registryGet({}, "https://registry.npmjs.org/left-pad")).toEqual({ kind: "network" });
  });

  it("times out a slow registry", async () => {
    const fetch = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    expect(await registryGet({ fetch, registryTimeoutMs: 20 }, "https://pypi.org/pypi/x/json")).toEqual({
      kind: "timeout",
    });
  });
});
