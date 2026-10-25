import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// baserate-diff-path-check AC-1: a valid sample entry is requested exactly once, at the checked diff path. The script
// runs under `node --import <stub>`, where the stub replaces globalThis.fetch with a recorder; no test reaches the
// network. The stub, the sample and the recorder file live in the test's own temp directory.

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

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Run = { status: number | null; stderr: string; urls: string[]; summary: unknown; out: string };

const runScript = (prs: unknown[]): Run => {
  const dir = mkdtempSync(join(tmpdir(), "pharn-baserate-request-"));
  dirs.push(dir);
  const out = join(dir, "out");
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
  mkdirSync(out, { recursive: true });
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
  const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, "utf8")) : undefined;
  return { status: res.status, stderr: res.stderr ?? "", urls, summary, out };
};

/** A call to diffPath( that is not its own definition. */
const callsDiffPath = (source: string) => /(?<!function\s{1,10})(?<![\w$.])diffPath\s*\(/.test(source);

describe("agent-pr-baserate diff request path", () => {
  it("AC-1: a valid entry is requested once at https://api.github.com/repos/octo/widgets/pulls/7, exits 0 and scans 1", () => {
    const run = runScript([{ bot: "claude", repo: "octo/widgets", number: 7 }]);
    expect(run.urls, run.stderr).toEqual(["https://api.github.com/repos/octo/widgets/pulls/7"]);
    expect(run.status, run.stderr).toBe(0);
    expect((run.summary as { total?: { scanned?: unknown } } | undefined)?.total?.scanned).toBe(1);
    const source = readFileSync(SCRIPT, "utf8");
    expect(callsDiffPath(source), "the script calls diffPath( to check the diff path").toBe(true);
  }, 120_000);
});
