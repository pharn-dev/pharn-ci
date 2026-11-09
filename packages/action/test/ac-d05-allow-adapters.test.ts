import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sideFiles } from "../../core/test/dependencies-helpers.js";
import { expectValidReport } from "../../core/test/schema.js";
import { runGit, runGitBatch } from "../../node-io/src/io.js";
import { harness, PR_CONTEXT, WORKSPACE } from "./harness.js";

// d05-private-registry-allowlist, AC-1: a lockfile entry resolved from a private registry host the workflow names is
// not a D05 finding, through both adapters. A real temporary repository commits the fixtures/dependencies/d05-lockfile
// case as `main` (base) and `feature` (head), with the head package-lock.json rewritten in memory so left-pad resolves
// from https://npm.corp.example/... and the git entry is gone; a tracked src/index.ts and a coverage file for it make
// every other part of the report pass. The Action reads git from that repository; the CLI runs with its real Node deps.

const CASE = new URL("../../../fixtures/dependencies/d05-lockfile/", import.meta.url).pathname;
const HOST = "npm.corp.example";
const PRIVATE_URL = `https://${HOST}/api/npm/npm/left-pad/-/left-pad-1.3.0.tgz`;

type Report = {
  verdict: string;
  messages: { level: string; code: string; text: string }[];
  dependencies?: { signals: { id: string; name?: string; path: string; line: number | null }[] };
};

let dir: string;
let baseSha: string;
let headSha: string;

/** The head package-lock.json of the case: left-pad from the private host, the git entry removed. */
function privateLockfile(text: string): string {
  const out = text
    .replace("https://packages.example.com/left-pad/-/left-pad-1.3.0.tgz", PRIVATE_URL)
    .replace(
      '    "node_modules/from-git": {\n      "version": "1.0.0",\n      "resolved": "git+ssh://git@github.com/someone/from-git.git#0123456789abcdef0123456789abcdef01234567"\n    },\n',
      "",
    )
    .replace(',\n      "dependencies": {\n        "from-git": "github:someone/from-git#v1.0.0"\n      }', "");
  if (!out.includes(PRIVATE_URL) || out.includes("from-git")) throw new Error("the fixture lockfile changed shape");
  return out;
}

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-d05-allow-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  const write = (side: "base" | "head") => {
    for (const file of sideFiles(`${CASE}${side}`)) {
      mkdirSync(dirname(join(dir, file.path)), { recursive: true });
      const text = side === "head" && file.path === "package-lock.json" ? privateLockfile(file.text) : file.text;
      writeFileSync(join(dir, file.path), text);
    }
  };
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  write("base");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/index.ts"), "export const a = 1;\n");
  mkdirSync(join(dir, "packages/lib"), { recursive: true });
  writeFileSync(join(dir, "packages/lib/package.json"), '{ "name": "lib", "version": "0.1.0" }\n');
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  baseSha = sh("rev-parse", "HEAD");
  sh("checkout", "-q", "-b", "feature");
  write("head");
  sh("add", "-A");
  sh("commit", "-q", "-m", "add left-pad from the private registry");
  headSha = sh("rev-parse", "HEAD");
  mkdirSync(join(dir, "coverage"));
  writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/src/index.ts\nDA:1,1\nend_of_record\n`);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function expectAllowed(text: string) {
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  const d05 = (report.dependencies?.signals ?? []).filter((s) => s.id === "D05");
  expect(d05).toEqual([]);
  expect(report.messages.filter((m) => m.code === "DEPENDENCY_D05")).toEqual([]);
  expect(report.verdict).toBe("pass");
  expect(text).not.toContain(HOST);
}

describe("an allowed private registry host through the adapters", { timeout: 120_000 }, () => {
  it("AC-1: the Action input dependency-allowed-hosts lets a lockfile entry from that host pass, and the report never names the host", async () => {
    const { run } = await import("../src/run.js");
    const h = harness({
      context: {
        ...PR_CONTEXT,
        sha: headSha,
        payload: { pull_request: { number: 7, base: { sha: baseSha }, head: { sha: headSha } } },
      } as never,
      inputs: { policy: "never", upload: "never", comment: "false", "dependency-allowed-hosts": HOST },
      files: { [`${WORKSPACE}/coverage/lcov.info`]: "SF:src/index.ts\nDA:1,1\nend_of_record\n" },
    });
    Object.assign(h.deps, {
      git: (args: string[]) => runGit(dir, args),
      gitBatch: (args: string[], input: string) => runGitBatch(dir, args, input),
    });
    await run(h.deps);
    expect(h.failed).toEqual([]);
    const text = h.written[h.outputs["report-path"] ?? ""];
    expect(text, "the Action wrote no report").toBeDefined();
    expectAllowed(text as string);
  });

  it("AC-1: one CLI --dependency-allowed-host flag lets the same entry pass, and the JSON report never names the host", async () => {
    const { main } = await import("../../cli/src/main.js");
    const { nodeDeps } = await import("../../cli/src/nodeDeps.js");
    const deps = nodeDeps(dir) as unknown as { stdout(text: string): void; stderr(text: string): void };
    let out = "";
    let err = "";
    deps.stdout = (text) => {
      out += text;
    };
    deps.stderr = (text) => {
      err += text;
    };
    const code = await main(
      [
        "check",
        "--base",
        "main",
        "--coverage",
        "coverage/lcov.info",
        "--format",
        "json",
        "--dependency-allowed-host",
        HOST,
      ],
      deps as never,
    );
    expect(code, err).toBe(0);
    expectAllowed(out);
  });
});
