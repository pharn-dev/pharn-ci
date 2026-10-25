import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// corpus-run-script: scripts/corpus-rate.mjs exits 2 and names the problem for a missing file, a header that is not
// exactly the ten columns, a verdict outside empty / TP / FP / unclear (naming the row's repo and PR number) and an
// unknown --format. The CSVs are written by the tests.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HEADER = "repo,pr,signal,severity,path,line,code,detail,verdict,note";

const dirs: string[] = [];
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "pharn-corpus-rate-usage-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const writeText = (records: string[]) => {
  const path = join(freshDir(), "reviewed.csv");
  writeFileSync(path, records.map((record) => `${record}\r\n`).join(""));
  return path;
};

const rate = (args: string[]) =>
  spawnSync(process.execPath, ["scripts/corpus-rate.mjs", ...args], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });

const VALID = [
  HEADER,
  "local/upstream,7,TI03,block,src/a.test.ts,3,TEST_INTEGRITY_TI03,fixture signal,TP,",
  "local/upstream,8,none,,,,,,,",
];

describe("corpus-run-script: corpus-rate.mjs input and usage errors", () => {
  it("AC-12: a path that does not exist exits 2 and stderr names the path", () => {
    const path = join(freshDir(), "absent-reviewed.csv");
    const result = rate([path]);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("absent-reviewed.csv");
  });

  it("AC-12: a header with nine of the ten columns exits 2 and stderr names the header", () => {
    const path = writeText([
      "repo,pr,signal,severity,path,line,code,detail,verdict",
      "local/upstream,7,TI03,block,src/a.test.ts,3,TEST_INTEGRITY_TI03,fixture signal,TP",
    ]);
    const result = rate([path]);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("header");
  });

  it("AC-12: a verdict other than empty, TP, FP or unclear exits 2 and stderr names the row's repo and PR number", () => {
    const path = writeText([
      HEADER,
      "local/upstream,7,TI03,block,src/a.test.ts,3,TEST_INTEGRITY_TI03,fixture signal,maybe,",
      "local/upstream,8,none,,,,,,,",
    ]);
    const result = rate([path]);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("local/upstream");
    expect(result.stderr).toMatch(/(^|\D)7(\D|$)/);
  });

  it("AC-12: an unknown --format exits 2 and stderr names --format", () => {
    const path = writeText(VALID);
    const result = rate([path, "--format", "xml"]);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("--format");
  });
});
