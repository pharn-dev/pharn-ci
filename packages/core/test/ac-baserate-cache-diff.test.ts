import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// baserate-cache-control-chars AC-1: a freshly fetched diff is cached without ESC, form feed, U+009B or DEL, and
// with every tab, newline, carriage return and non-ASCII character kept. The script runs under
// `node --import <stub>`, where the stub replaces globalThis.fetch; no test reaches the network. A pre-written
// sample.json holds one valid PR, so no search runs.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/agent-pr-baserate.mjs");

/** The control characters the cache must drop: ESC, form feed, CSI (U+009B) and DEL. */
const CONTROLS = ["\u001b", "\f", "\u009b", "\u007f"];

// Headers end in LF; the content lines end in CRLF. The added it.skip( line holds the control characters mid-line,
// inside the test name, next to tabs, Polish letters and an emoji.
const DIFF = [
  "diff --git a/src/widget.test.ts b/src/widget.test.ts",
  "--- a/src/widget.test.ts",
  "+++ b/src/widget.test.ts",
  "@@ -1,2 +1,4 @@",
  ' describe("widget", () => {\r',
  '+\tit.skip("zażółć \u001b[31m red \f feed \u009b csi \u007f del 🚀", () => {});\r',
  '+\tconst label = "Łódź\tgęśl 🚀";\r',
  " });\r",
  "",
].join("\n");

const stripControls = (text: string): string => {
  let out = text;
  for (const ch of CONTROLS) out = out.split(ch).join("");
  return out;
};

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const runOnce = (): { status: number | null; stderr: string; out: string } => {
  const dir = mkdtempSync(join(tmpdir(), "pharn-baserate-cache-diff-"));
  dirs.push(dir);
  const out = join(dir, "out");
  const stub = join(dir, "fetch-stub.mjs");
  writeFileSync(
    stub,
    [
      `const DIFF = ${JSON.stringify(DIFF)};`,
      "globalThis.fetch = async () =>",
      '  new Response(DIFF, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });',
      "",
    ].join("\n"),
  );
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "sample.json"),
    `${JSON.stringify(
      { state: "merged", until: "2026-01-01", perRepo: 3, prs: [{ bot: "claude", repo: "octo/widgets", number: 7 }] },
      null,
      2,
    )}\n`,
  );
  const { GITHUB_TOKEN: _unused, ...inherited } = process.env;
  const env: NodeJS.ProcessEnv = { ...inherited, GH_TOKEN: "test-token" };
  const res = spawnSync(process.execPath, ["--import", pathToFileURL(stub).href, SCRIPT, "--out", out], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: res.status, stderr: res.stderr ?? "", out };
};

describe("agent-pr-baserate diff cache", () => {
  it("AC-1: the cached diff equals the served diff minus ESC, form feed, U+009B and DEL, keeping tabs, CR, LF and non-ASCII text", () => {
    const expected = stripControls(DIFF);
    // The expectation itself keeps what must survive.
    expect(expected).toContain("\t");
    expect(expected).toContain("\r\n");
    expect(expected).toContain("zażółć");
    expect(expected).toContain("Łódź");
    expect(expected).toContain("🚀");
    expect(expected).not.toBe(DIFF);

    const run = runOnce();
    const cached = join(run.out, "diffs", "octo__widgets__7.diff");
    expect(existsSync(cached), run.stderr).toBe(true);
    const bytes = readFileSync(cached);
    expect(bytes.equals(Buffer.from(expected, "utf8")), JSON.stringify(bytes.toString("utf8"))).toBe(true);
  }, 120_000);
});
