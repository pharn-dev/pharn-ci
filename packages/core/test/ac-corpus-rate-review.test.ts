import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// corpus-run-script: scripts/corpus-rate.mjs exits 1 and demotes a signal when one of its block rows has no verdict;
// a warn or info row without a verdict never changes the exit code. The CSVs are written by the tests.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COLUMNS = ["repo", "pr", "signal", "severity", "path", "line", "code", "detail", "verdict", "note"] as const;
const HEADER = COLUMNS.join(",");
const REPO = "local/upstream";

type Row = Partial<Record<(typeof COLUMNS)[number], string>>;
type Entry = { signal: string; unreviewed: number; decision: string };

const dirs: string[] = [];
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "pharn-corpus-rate-review-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const signalRow = (pr: number, signal: string, severity: string, verdict: string): Row => ({
  repo: REPO,
  pr: String(pr),
  signal,
  severity,
  path: `src/t${pr}.test.ts`,
  line: "4",
  code: `TEST_INTEGRITY_${signal}`,
  detail: "fixture signal",
  verdict,
});
const none = (pr: number): Row => ({ repo: REPO, pr: String(pr), signal: "none" });

const writeCsv = (rows: Row[]) => {
  const path = join(freshDir(), "reviewed.csv");
  const records = [HEADER, ...rows.map((row) => COLUMNS.map((column) => row[column] ?? "").join(","))];
  writeFileSync(path, records.map((record) => `${record}\r\n`).join(""));
  return path;
};

const rate = (args: string[]) =>
  spawnSync(process.execPath, ["scripts/corpus-rate.mjs", ...args], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });

describe("corpus-run-script: corpus-rate.mjs and unreviewed rows", () => {
  it("AC-10: one TI04 block row with an empty verdict exits 1, counts one unreviewed row and demotes TI04 to warn", () => {
    const rows: Row[] = [];
    for (let n = 1; n <= 5; n += 1) rows.push(signalRow(n, "TI04", "block", n === 3 ? "" : "TP"));
    for (let n = 6; n <= 40; n += 1) rows.push(none(n));
    const path = writeCsv(rows);

    const json = rate([path, "--format", "json"]);
    expect(json.status, json.stderr).toBe(1);
    const summary = JSON.parse(json.stdout) as { signals: Entry[] };
    const entry = summary.signals.find((candidate) => candidate.signal === "TI04");
    expect(entry, "a TI04 entry").toBeDefined();
    expect(entry?.unreviewed).toBe(1);
    expect(entry?.decision).toBe("demote to warn");

    const md = rate([path]);
    expect(md.status, md.stderr).toBe(1);
    const line = md.stdout.split("\n").find((candidate) => candidate.startsWith("| TI04 |"));
    expect(line, "a `| TI04 |` table line").toBeDefined();
    expect(line).toContain("demote to warn");
  });

  it("AC-10: when only warn or info rows have an empty verdict it exits 0", () => {
    const rows: Row[] = [];
    for (let n = 1; n <= 5; n += 1) rows.push(signalRow(n, "TI04", "block", "TP"));
    rows.push(signalRow(6, "TI02", "warn", ""), signalRow(7, "TI01", "info", ""));
    for (let n = 8; n <= 40; n += 1) rows.push(none(n));
    const path = writeCsv(rows);

    const json = rate([path, "--format", "json"]);
    expect(json.status, json.stderr).toBe(0);
    const md = rate([path]);
    expect(md.status, md.stderr).toBe(0);
  });
});
