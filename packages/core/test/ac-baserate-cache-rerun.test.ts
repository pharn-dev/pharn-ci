import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// baserate-cache-control-chars AC-2: a first run and a re-run served from the cache agree byte for byte, and the
// TI03 excerpt in hits.csv carries no ESC, form feed, U+009B or DEL. The script runs under `node --import <stub>`,
// where the stub replaces globalThis.fetch with a recorder; no test reaches the network. A pre-written sample.json
// holds one valid PR, so no search runs.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/agent-pr-baserate.mjs");

/** The control characters the cache must drop: ESC, form feed, CSI (U+009B) and DEL. */
const CONTROLS = ["\u001b", "\f", "\u009b", "\u007f"];

// The same served diff as AC-1: headers end in LF, content lines in CRLF, and the added it.skip( line holds the
// control characters mid-line, inside the test name, so the TI03 detector matches it before and after the change.
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

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Run = { status: number | null; stderr: string; urls: string[]; summary: string; hits: string };

const writeStub = (dir: string, name: string, record: string, serve: boolean): string => {
  const stub = join(dir, name);
  writeFileSync(
    stub,
    [
      'import { appendFileSync } from "node:fs";',
      `const RECORD = ${JSON.stringify(record)};`,
      `const DIFF = ${JSON.stringify(DIFF)};`,
      `const SERVE = ${JSON.stringify(serve)};`,
      "globalThis.fetch = async (input) => {",
      '  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;',
      '  appendFileSync(RECORD, String(url) + "\\n");',
      '  if (!SERVE) return new Response("unexpected request", { status: 500 });',
      '  return new Response(DIFF, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });',
      "};",
      "",
    ].join("\n"),
  );
  return stub;
};

const run = (dir: string, out: string, label: string, serve: boolean): Run => {
  const record = join(dir, `${label}-requests.txt`);
  writeFileSync(record, "");
  const stub = writeStub(dir, `${label}-fetch-stub.mjs`, record, serve);
  const { GITHUB_TOKEN: _unused, ...inherited } = process.env;
  const env: NodeJS.ProcessEnv = { ...inherited, GH_TOKEN: "test-token" };
  // A fixed --until keeps summary.json the same when the two runs straddle midnight UTC.
  const args = ["--import", pathToFileURL(stub).href, SCRIPT, "--out", out, "--until", "2026-01-01"];
  const res = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  const urls = readFileSync(record, "utf8")
    .split("\n")
    .filter((line) => line !== "");
  const summaryFile = join(out, "summary.json");
  const hitsFile = join(out, "hits.csv");
  return {
    status: res.status,
    stderr: res.stderr ?? "",
    urls,
    summary: existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : "",
    hits: existsSync(hitsFile) ? readFileSync(hitsFile, "utf8") : "",
  };
};

/** The excerpt column of a hits.csv row: everything after the eighth comma (the leading columns hold none). */
const excerptOf = (row: string): string => {
  let at = -1;
  for (let i = 0; i < 8; i++) {
    at = row.indexOf(",", at + 1);
    if (at < 0) return "";
  }
  return row.slice(at + 1);
};

describe("agent-pr-baserate cached re-run", () => {
  it("AC-2: a cached re-run makes no request and matches the first run byte for byte, with a TI03 excerpt free of ESC, form feed, U+009B and DEL", () => {
    const dir = mkdtempSync(join(tmpdir(), "pharn-baserate-cache-rerun-"));
    dirs.push(dir);
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, "sample.json"),
      `${JSON.stringify(
        { state: "merged", until: "2026-01-01", perRepo: 3, prs: [{ bot: "claude", repo: "octo/widgets", number: 7 }] },
        null,
        2,
      )}\n`,
    );

    const first = run(dir, out, "first", true);
    const firstSummary = first.summary;
    const firstHits = first.hits;
    const second = run(dir, out, "second", false);

    expect(second.urls, second.stderr).toEqual([]);
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);

    const summary = JSON.parse(firstSummary) as { total?: { scanned?: unknown; TI03?: unknown } };
    expect(summary.total?.scanned).toBe(1);
    expect(summary.total?.TI03).toBe(1);

    expect(second.summary).toBe(firstSummary);
    expect(second.hits).toBe(firstHits);

    const rows = firstHits.split("\n").filter((line) => line.includes(",TI03,"));
    expect(rows).toHaveLength(1);
    const excerpt = excerptOf(rows[0] ?? "");
    expect(excerpt).toContain("it.skip(");
    for (const ch of CONTROLS) {
      expect(excerpt.includes(ch), `excerpt holds U+${ch.charCodeAt(0).toString(16).padStart(4, "0")}`).toBe(false);
    }
  }, 240_000);
});
