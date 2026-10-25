import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// corpus-run-script: scripts/corpus-rate.mjs reads a reviewed CSV and reports, per signal with a block row, the
// false-block rate (PRs with an FP block row of that signal over every distinct PR in the CSV, error PRs included)
// and the decision: below 1 % with every block row reviewed ships as block, anything else demotes to warn. The CSVs are
// written by the tests, each covering 200 distinct PRs.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COLUMNS = ["repo", "pr", "signal", "severity", "path", "line", "code", "detail", "verdict", "note"] as const;
const HEADER = COLUMNS.join(",");
const REPO = "local/upstream";

type Row = Partial<Record<(typeof COLUMNS)[number], string>>;
type Entry = {
  signal: string;
  blockPrs: number;
  tp: number;
  fp: number;
  unclear: number;
  unreviewed: number;
  rate: number;
  decision: string;
};
type Summary = { prs: number; errors: number; signals: Entry[] };

const dirs: string[] = [];
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "pharn-corpus-rate-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const block = (pr: number, signal: string, verdict: string, line = ""): Row => ({
  repo: REPO,
  pr: String(pr),
  signal,
  severity: "block",
  path: `src/t${pr}.test.ts`,
  line,
  code: `TEST_INTEGRITY_${signal}`,
  detail: "fixture signal",
  verdict,
});
const none = (pr: number): Row => ({ repo: REPO, pr: String(pr), signal: "none" });
const error = (pr: number): Row => ({ repo: REPO, pr: String(pr), signal: "error", detail: "fetch failed" });

const writeCsv = (rows: Row[]) => {
  const path = join(freshDir(), "reviewed.csv");
  const records = [HEADER, ...rows.map((row) => COLUMNS.map((column) => row[column] ?? "").join(","))];
  writeFileSync(path, records.map((record) => `${record}\r\n`).join(""));
  return path;
};

/** PRs 1..200: the given rows for their PRs, a `none` row for every other PR. */
const covering200 = (rows: Row[]) => {
  const used = new Set(rows.map((row) => row.pr));
  const rest: Row[] = [];
  for (let n = 1; n <= 200; n += 1) if (!used.has(String(n))) rest.push(none(n));
  return [...rows, ...rest];
};

const rate = (args: string[]) =>
  spawnSync(process.execPath, ["scripts/corpus-rate.mjs", ...args], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });

const tableLine = (stdout: string, signal: string) =>
  stdout.split("\n").find((line) => line.startsWith(`| ${signal} |`));

const jsonEntry = (path: string, signal: string) => {
  const result = rate([path, "--format", "json"]);
  const summary = JSON.parse(result.stdout) as Summary;
  return { result, summary, entry: summary.signals.find((entry) => entry.signal === signal) };
};

describe("corpus-run-script: corpus-rate.mjs false-block rates and decisions", () => {
  it("AC-8: one FP PR out of 200 gives TI03 a 0.5 % rate and ships as block, in markdown and in JSON", () => {
    const rows: Row[] = [];
    for (let n = 1; n <= 12; n += 1) rows.push(block(n, "TI03", n === 1 ? "FP" : "TP"));
    const path = writeCsv(covering200(rows));

    const md = rate([path]);
    expect(md.status, md.stderr).toBe(0);
    const line = tableLine(md.stdout, "TI03");
    expect(line, "a `| TI03 |` table line").toBeDefined();
    expect(line).toContain("0.5 %");
    expect(line).toContain("ships as block");

    const { result, summary, entry } = jsonEntry(path, "TI03");
    expect(result.status, result.stderr).toBe(0);
    expect(summary.prs).toBe(200);
    expect(summary.errors).toBe(0);
    expect(entry).toMatchObject({
      signal: "TI03",
      blockPrs: 12,
      tp: 11,
      fp: 1,
      unclear: 0,
      unreviewed: 0,
      rate: 0.005,
      decision: "ships as block",
    });
  });

  it("AC-9: three FP PRs out of 200 give TI01 1.5 % and two give exactly 1.0 %, and both demote to warn", () => {
    for (const [fpPrs, text, value] of [
      [3, "1.5 %", 0.015],
      [2, "1.0 %", 0.01],
    ] as const) {
      const rows: Row[] = [];
      for (let n = 1; n <= 10; n += 1) rows.push(block(n, "TI01", n <= fpPrs ? "FP" : "TP"));
      const path = writeCsv(covering200(rows));

      const md = rate([path]);
      expect(md.status, md.stderr).toBe(0);
      const line = tableLine(md.stdout, "TI01");
      expect(line, `a \`| TI01 |\` table line for ${fpPrs} FP PRs`).toBeDefined();
      expect(line).toContain(text);
      expect(line).toContain("demote to warn");

      const { entry } = jsonEntry(path, "TI01");
      expect(entry?.rate).toBeCloseTo(value, 10);
      expect(entry?.fp).toBe(fpPrs);
      expect(entry?.decision).toBe("demote to warn");
    }
  });

  it("AC-11: unclear rows count as reviewed, a PR with two FP rows counts once and error PRs join the 200", () => {
    const rows: Row[] = [];
    for (let n = 1; n <= 20; n += 1) {
      if (n <= 3) rows.push(block(n, "TI03", "unclear"));
      else if (n === 4) rows.push(block(n, "TI03", "FP", "3"), block(n, "TI03", "FP", "9"));
      else rows.push(block(n, "TI03", "TP"));
    }
    for (let n = 21; n <= 25; n += 1) rows.push(error(n));
    const path = writeCsv(covering200(rows));

    const { result, summary, entry } = jsonEntry(path, "TI03");
    expect(result.status, result.stderr).toBe(0);
    expect(summary.prs).toBe(200);
    expect(summary.errors).toBe(5);
    expect(entry).toMatchObject({ unclear: 3, fp: 2, unreviewed: 0, rate: 0.005, decision: "ships as block" });

    const md = rate([path]);
    expect(md.status, md.stderr).toBe(0);
    const line = tableLine(md.stdout, "TI03");
    expect(line, "a `| TI03 |` table line").toBeDefined();
    expect(line).toContain("0.5 %");
    expect(line).toContain("ships as block");
  });
});
