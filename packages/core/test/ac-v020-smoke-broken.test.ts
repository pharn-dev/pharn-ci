import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-readiness-v020: the release smoke fails loudly on a broken setup. Four setups, each built outside the
// TMPDIR the script is given: a bundle that reports verdict fail, the committed bundle under version 9.9.9, an
// expected-summary.txt with a line the summary lacks, and a bundle that exits 1. Each run must exit non-zero, name
// the failed check, print no `ok` line and leave TMPDIR empty.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/smoke-release.mjs");
const TIMEOUT = 110_000;

/** An action directory whose packages/action/dist/index.js is `source` (an ES module), version 0.1.0. */
function fakeAction(dir: string, source: string): string {
  mkdirSync(join(dir, "packages/action/dist"), { recursive: true });
  writeFileSync(
    join(dir, "packages/action/package.json"),
    `${JSON.stringify({ name: "fake-action", version: "0.1.0", type: "module" })}\n`,
  );
  writeFileSync(join(dir, "packages/action/dist/index.js"), source);
  return dir;
}

/** Run `node <script> <actionDir>` from the repository root with TMPDIR set to a fresh empty directory. */
function runSmoke(script: string, actionDir: string): { status: number | null; output: string; leftover: string[] } {
  const tmp = mkdtempSync(join(tmpdir(), "ac-v020-smoke-broken-tmp-"));
  try {
    const run = spawnSync(process.execPath, [script, actionDir], {
      cwd: ROOT,
      env: { ...process.env, TMPDIR: tmp },
      encoding: "utf8",
      timeout: TIMEOUT,
    });
    return { status: run.status, output: `${run.stdout ?? ""}\n${run.stderr ?? ""}`, leftover: readdirSync(tmp) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** A failed run: a non-zero exit, the check named, no line starting `ok`, TMPDIR empty. */
function expectFailed(result: ReturnType<typeof runSmoke>, needle: string): void {
  expect(typeof result.status, result.output).toBe("number");
  expect(result.status, result.output).not.toBe(0);
  expect(result.output).toContain(needle);
  expect(result.output.split("\n").filter((line) => line.startsWith("ok"))).toEqual([]);
  expect(result.leftover).toEqual([]);
}

/** A setup directory outside the TMPDIR the script gets; removed after the test. */
function withSetup(body: (dir: string) => void): void {
  expect(existsSync(SCRIPT), SCRIPT).toBe(true);
  const dir = mkdtempSync(join(tmpdir(), "ac-v020-smoke-broken-setup-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("release-readiness-v020: the release smoke fails on a broken setup", () => {
  it(
    "AC-12: a bundle that writes verdict fail and exits 0 fails the smoke at verdict",
    () => {
      withSetup((dir) => {
        const action = fakeAction(
          dir,
          'import { appendFileSync } from "node:fs";\nappendFileSync(process.env.GITHUB_OUTPUT, "verdict=fail\\n");\n',
        );
        expectFailed(runSmoke(SCRIPT, action), "verdict");
      });
    },
    TIMEOUT + 10_000,
  );

  it(
    "AC-12: the committed bundle under packages/action/package.json version 9.9.9 fails the smoke naming 9.9.9",
    () => {
      withSetup((dir) => {
        cpSync(join(ROOT, "packages/action/dist"), join(dir, "packages/action/dist"), { recursive: true });
        const pkg = JSON.parse(readFileSync(join(ROOT, "packages/action/package.json"), "utf8"));
        writeFileSync(join(dir, "packages/action/package.json"), `${JSON.stringify({ ...pkg, version: "9.9.9" })}\n`);
        expectFailed(runSmoke(SCRIPT, dir), "9.9.9");
      });
    },
    TIMEOUT + 10_000,
  );

  it(
    "AC-12: a copied script and fixtures/smoke/ whose expected-summary.txt has an extra line fail the smoke naming that line",
    () => {
      withSetup((dir) => {
        mkdirSync(join(dir, "scripts"), { recursive: true });
        cpSync(SCRIPT, join(dir, "scripts/smoke-release.mjs"));
        cpSync(join(ROOT, "fixtures/smoke"), join(dir, "fixtures/smoke"), { recursive: true });
        const expected = join(dir, "fixtures/smoke/expected-summary.txt");
        const text = readFileSync(expected, "utf8");
        appendFileSync(expected, `${text.endsWith("\n") ? "" : "\n"}THIS LINE IS NOT IN THE SUMMARY\n`);
        expectFailed(runSmoke(join(dir, "scripts/smoke-release.mjs"), ROOT), "THIS LINE IS NOT IN THE SUMMARY");
      });
    },
    TIMEOUT + 10_000,
  );

  it(
    "AC-12: a bundle that exits 1 fails the smoke at exit",
    () => {
      withSetup((dir) => {
        const action = fakeAction(dir, "process.exit(1);\n");
        expectFailed(runSmoke(SCRIPT, action), "exit");
      });
    },
    TIMEOUT + 10_000,
  );
});
