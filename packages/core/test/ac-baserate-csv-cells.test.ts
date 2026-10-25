import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// baserate-csv-safe-cells AC-1..AC-4: hits.csv cells are cleaned for safe viewing. The script runs under
// `node --import <stub>`, where the stub makes globalThis.fetch throw, so no test reaches the network. A pre-written
// sample.json holds one PR and a pre-written cached diff for it (as if cached before the #15 fix) holds every hit.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/agent-pr-baserate.mjs");

const ESC = "\u001b";
const CSI = "\u009b";

/** The excerpt of the AC-1 hit as the diff holds it, and the same text with ESC and U+009B removed. */
const DIRTY_EXCERPT = `it.skip("renders ${ESC}[31m red ${CSI} csi", () => {});`;
const CLEAN_EXCERPT = 'it.skip("renders [31m red  csi", () => {});';

const PR = {
  bot: "claude",
  repo: "octo/widgets",
  number: 7,
  url: "https://github.com/octo/widgets/pull/7",
  mergedAt: "2025-06-01T10:00:00Z",
};

// One cached diff, four hits: the dirty it.skip( line (AC-1), a deleted `=cmd.test.js` (AC-2, TI01), an added
// pytest skip marker (AC-3, TI03) and an ordinary it.skip( line in its own file (AC-4).
const DIFF = [
  "diff --git a/src/widget.test.ts b/src/widget.test.ts",
  "--- a/src/widget.test.ts",
  "+++ b/src/widget.test.ts",
  "@@ -1,2 +1,3 @@",
  ' describe("widget", () => {',
  `+  ${DIRTY_EXCERPT}`,
  " });",
  "diff --git a/=cmd.test.js b/=cmd.test.js",
  "deleted file mode 100644",
  "--- a/=cmd.test.js",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  '-test("runs the command", () => {});',
  "-// end",
  "diff --git a/tests/test_api.py b/tests/test_api.py",
  "--- a/tests/test_api.py",
  "+++ b/tests/test_api.py",
  "@@ -1,2 +1,3 @@",
  " import pytest",
  '+@pytest.mark.skip(reason="flaky")',
  " def test_api():",
  "diff --git a/src/plain.test.ts b/src/plain.test.ts",
  "--- a/src/plain.test.ts",
  "+++ b/src/plain.test.ts",
  "@@ -1,2 +1,3 @@",
  ' describe("plain", () => {',
  '+  it.skip("plain case", () => {});',
  " });",
  "",
].join("\n");

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Run = { status: number | null; stderr: string; csv: string };

let memo: Run | undefined;

/** Runs the script once (memoised) with no network and returns its exit status, stderr and hits.csv text. */
const runOnce = (): Run => {
  if (memo !== undefined) return memo;
  const dir = mkdtempSync(join(tmpdir(), "pharn-baserate-csv-cells-"));
  dirs.push(dir);
  const out = join(dir, "out");
  mkdirSync(join(out, "diffs"), { recursive: true });
  const stub = join(dir, "fetch-stub.mjs");
  writeFileSync(
    stub,
    'globalThis.fetch = async () => {\n  throw new Error("network access is disabled in this test");\n};\n',
  );
  writeFileSync(
    join(out, "sample.json"),
    `${JSON.stringify({ state: "merged", until: "2026-01-01", perRepo: 3, prs: [PR] }, null, 2)}\n`,
  );
  writeFileSync(join(out, "diffs", "octo__widgets__7.diff"), DIFF);
  const { GITHUB_TOKEN: _unused, ...inherited } = process.env;
  const env: NodeJS.ProcessEnv = { ...inherited, GH_TOKEN: "test-token" };
  const args = ["--import", pathToFileURL(stub).href, SCRIPT, "--out", out, "--until", "2026-01-01"];
  const res = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: "utf8", timeout: 60_000 });
  const hits = join(out, "hits.csv");
  memo = {
    status: res.status,
    stderr: res.stderr ?? "",
    csv: existsSync(hits) ? readFileSync(hits, "utf8") : "",
  };
  return memo;
};

/** RFC 4180 parse: rows of fields, a quoted field may hold commas, newlines and doubled quotes. */
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

/** The parsed rows of hits.csv as objects keyed by the header row. */
const records = (csv: string): Record<string, string>[] => {
  const [header, ...rows] = parseCsv(csv);
  return rows.map((cells) => Object.fromEntries((header ?? []).map((name, i) => [name, cells[i] ?? ""])));
};

describe("agent-pr-baserate hits.csv cells", () => {
  it("AC-1: hits.csv holds no ESC and no U+009B, and the excerpt cell keeps the rest of the excerpt text", () => {
    const run = runOnce();
    expect(run.status, run.stderr).toBe(0);
    expect(run.csv, run.stderr).not.toBe("");
    expect(run.csv.includes(ESC), "hits.csv holds ESC").toBe(false);
    expect(run.csv.includes(CSI), "hits.csv holds U+009B").toBe(false);
    const excerpts = records(run.csv).map((r) => r.excerpt);
    expect(excerpts).toContain(CLEAN_EXCERPT);
  }, 120_000);

  it("AC-2: the TI01 row for a deleted `=cmd.test.js` has the path cell '=cmd.test.js", () => {
    const run = runOnce();
    expect(run.status, run.stderr).toBe(0);
    const ti01 = records(run.csv).filter((r) => r.signal === "TI01");
    expect(ti01.map((r) => r.path)).toEqual(["'=cmd.test.js"]);
    const lines = run.csv.split("\n").filter((line) => line.includes(",TI01,"));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.includes(",'=cmd.test.js,")).toBe(true);
  }, 120_000);

  it("AC-3: the TI03 excerpt cell of the pytest skip marker, read back as a CSV field, starts with '@pytest.mark.skip", () => {
    const run = runOnce();
    expect(run.status, run.stderr).toBe(0);
    const python = records(run.csv).filter((r) => r.signal === "TI03" && r.path === "tests/test_api.py");
    expect(python).toHaveLength(1);
    expect(python[0]?.excerpt.startsWith("'@pytest.mark.skip")).toBe(true);
  }, 120_000);

  it("AC-4: the ordinary it.skip( row is byte for byte the row written before, in the same run as a changed row", () => {
    const run = runOnce();
    expect(run.status, run.stderr).toBe(0);
    const lines = run.csv.split("\n");
    // A changed row in the same run: the TI01 path cell now carries the leading quote.
    expect(lines.some((line) => line.includes(",'=cmd.test.js,"))).toBe(true);
    // The row the current csvCell writes for the ordinary hit, stated as a literal.
    const ORDINARY_ROW =
      'claude,octo/widgets,7,https://github.com/octo/widgets/pull/7,2025-06-01T10:00:00Z,TI03,src/plain.test.ts,2,"it.skip(""plain case"", () => {});"';
    expect(lines.filter((line) => line.includes(",src/plain.test.ts,"))).toEqual([ORDINARY_ROW]);
  }, 120_000);
});
