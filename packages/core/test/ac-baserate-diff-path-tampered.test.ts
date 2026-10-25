import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// baserate-diff-path-check AC-2: a sample.json holding only tampered entries sends no request at all, still exits 0
// and still writes summary.json with nothing scanned. The script runs under `node --import <stub>`, where the stub
// replaces globalThis.fetch with a recorder; no test reaches the network. The stub, the sample and the recorder file
// live in the test's own temp directory.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/agent-pr-baserate.mjs");
const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-export const a = 1;",
  "+export const a = 2;",
  "",
].join("\n");

const TAMPERED: unknown[] = [
  { bot: "claude", repo: "octo/..", number: 7 },
  { bot: "claude", repo: "octo/widgets/../../user", number: 7 },
  { bot: "claude", repo: "octo/widgets?x=1", number: 7 },
  { bot: "claude", repo: "octo/widgets", number: "1" },
  { bot: "claude", repo: "octo/widgets", number: 0 },
  { bot: "claude", repo: "octo/widgets", number: 1.5 },
];

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Run = { status: number | null; stderr: string; urls: string[]; summaryExists: boolean; summary: unknown };

const runScript = (prs: unknown[]): Run => {
  const dir = mkdtempSync(join(tmpdir(), "pharn-baserate-tampered-"));
  dirs.push(dir);
  const out = join(dir, "out");
  mkdirSync(out, { recursive: true });
  const record = join(dir, "requests.txt");
  writeFileSync(record, "");
  const stub = join(dir, "fetch-stub.mjs");
  writeFileSync(
    stub,
    [
      'import { appendFileSync } from "node:fs";',
      `const RECORD = ${JSON.stringify(record)};`,
      `const DIFF = ${JSON.stringify(DIFF)};`,
      "globalThis.fetch = async (input) => {",
      '  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;',
      '  appendFileSync(RECORD, String(url) + "\\n");',
      '  return new Response(DIFF, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });',
      "};",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(out, "sample.json"),
    `${JSON.stringify({ state: "merged", until: "2026-01-01", perRepo: 3, prs }, null, 2)}\n`,
  );
  const { GITHUB_TOKEN: _unused, ...inherited } = process.env;
  const env: NodeJS.ProcessEnv = { ...inherited, GH_TOKEN: "test-token" };
  const res = spawnSync(process.execPath, ["--import", pathToFileURL(stub).href, SCRIPT, "--out", out], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  const urls = readFileSync(record, "utf8")
    .split("\n")
    .filter((line) => line !== "");
  const summaryFile = join(out, "summary.json");
  const summaryExists = existsSync(summaryFile);
  const summary = summaryExists ? JSON.parse(readFileSync(summaryFile, "utf8")) : undefined;
  return { status: res.status, stderr: res.stderr ?? "", urls, summaryExists, summary };
};

/** A call to diffPath( that is not its own definition. */
const callsDiffPath = (source: string) => /(?<!function\s{1,10})(?<![\w$.])diffPath\s*\(/.test(source);

describe("agent-pr-baserate tampered sample entries", () => {
  it("AC-2: tampered repo and number values send no request, exit 0 and write summary.json with nothing scanned", () => {
    const run = runScript(TAMPERED);
    expect(run.urls, run.stderr).toEqual([]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.summaryExists, "summary.json is written").toBe(true);
    expect((run.summary as { total?: { scanned?: unknown } } | undefined)?.total?.scanned).toBe(0);
    const source = readFileSync(SCRIPT, "utf8");
    expect(callsDiffPath(source), "the script calls diffPath( to check the diff path").toBe(true);
  }, 120_000);
});
