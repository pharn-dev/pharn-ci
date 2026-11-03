import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// action-bundle-size AC-6: a change to the vendored packages/action/dist/typescript.js without a matching rebuild fails
// CI's dist-freshness step (and the release workflow's twin of it).
//
// A temp git repository commits a dist that is a fresh `node scripts/bundle.mjs` output except that one byte of
// typescript.js is changed (the edited vendored file). Then, as the workflows' `pnpm build` does, the bundler writes
// the dist again in that repository, and the step's own `run:` script, extracted from the workflow file, is executed
// with bash there. It must exit 1 with its `::error::` line.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ACTION = join(ROOT, "packages/action");
const DIST = "packages/action/dist";
const STALE_ERROR = "::error::packages/action/dist is stale. Run 'pnpm build' and commit the result.";
const GIT_TIMEOUT_MS = 30_000;
const STEP_TIMEOUT_MS = 60_000;
const baseEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=pharn-ci-ac",
      "-c",
      "user.email=ac@invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=main",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    { cwd, env: baseEnv, stdio: "pipe", timeout: GIT_TIMEOUT_MS },
  );
}

/** Writes the Action bundle (and whatever the bundler writes beside it) to `<repo>/packages/action/dist/index.js`. */
/** The bytes the bundler must write; read once, never checked first (no check-then-use race). */
function readWritten(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (error) {
    throw new Error(`the bundler writes packages/action/dist/typescript.js: ${String(error)}`);
  }
}

function bundleInto(repo: string): void {
  execFileSync(process.execPath, ["../../scripts/bundle.mjs", "src/index.ts", join(repo, DIST, "index.js")], {
    cwd: ACTION,
    stdio: "pipe",
  });
}

/** The `run: |` block of the step named `name` in a workflow file, dedented. */
function stepScript(workflow: string, name: string): string {
  const lines = readFileSync(join(ROOT, workflow), "utf8").split("\n");
  const at = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  expect(at, `${workflow} has a step named "${name}"`).toBeGreaterThan(-1);
  const stepIndent = (lines[at] as string).indexOf("-");
  let i = at + 1;
  for (; i < lines.length; i++) {
    const line = lines[i] as string;
    const indent = line.search(/\S/);
    if (indent !== -1 && indent <= stepIndent) break;
    if (/^\s*run: \|\s*$/.test(line)) break;
  }
  const runLine = lines[i] as string;
  expect(runLine, `the step "${name}" has a "run: |" block`).toMatch(/^\s*run: \|\s*$/);
  const keyIndent = runLine.search(/\S/);
  const body: string[] = [];
  for (i++; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() !== "" && line.search(/\S/) <= keyIndent) break;
    body.push(line);
  }
  const indent = Math.min(...body.filter((l) => l.trim() !== "").map((l) => l.search(/\S/)));
  return `${body
    .map((l) => l.slice(indent))
    .join("\n")
    .trimEnd()}\n`;
}

let prepared: string | undefined;
const tmpRoots: string[] = [];
afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

/**
 * A temp repository whose committed dist is a fresh bundle with one byte of typescript.js changed, after the bundler
 * has written the dist again (the workflows' `pnpm build`). Made once and reused by both tests; removed after them.
 */
function staleRepository(): string {
  if (prepared !== undefined) return prepared;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-ac-bundle-size-freshness-")));
  tmpRoots.push(root);
  const repo = join(root, "repo");
  mkdirSync(join(repo, DIST), { recursive: true });
  git(repo, "init", "-q");
  bundleInto(repo);
  const vendored = join(repo, DIST, "typescript.js");
  const fresh = readWritten(vendored);
  const edited = Buffer.from(fresh);
  const at = Math.floor(edited.length / 2);
  edited[at] = (edited[at] as number) ^ 0x01;
  writeFileSync(vendored, edited);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "a vendored typescript.js edited without a rebuild");

  bundleInto(repo);
  expect(readFileSync(vendored).equals(fresh), "the rebuild writes typescript.js from the installed package").toBe(
    true,
  );
  prepared = repo;
  return repo;
}

function runStep(workflow: string, name: string): { status: number | null; output: string; stdout: string } {
  const repo = staleRepository();
  const script = stepScript(workflow, name);
  // GitHub's default `run:` shell on Linux: bash --noprofile --norc -eo pipefail {0}.
  const run = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    cwd: repo,
    env: baseEnv,
    encoding: "utf8",
    timeout: STEP_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: run.status, stdout: run.stdout ?? "", output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

describe("action-bundle-size: the dist-freshness steps fail on a vendored typescript.js the build does not write", () => {
  it('AC-6: the "Check packages/action/dist is up to date" step of .github/workflows/ci.yml exits 1 with its ::error:: line when the committed packages/action/dist/typescript.js differs from what scripts/bundle.mjs writes', () => {
    const run = runStep(".github/workflows/ci.yml", "Check packages/action/dist is up to date");
    expect(run.status, `the step exits 1\n${run.output.slice(-2000)}`).toBe(1);
    expect(run.stdout.split("\n"), "the step's ::error:: line").toContain(STALE_ERROR);
  }, 300_000);

  it('AC-6: the "Check packages/action/dist matches the sources" step of .github/workflows/release.yml exits 1 with its ::error:: line when the committed packages/action/dist/typescript.js differs from what scripts/bundle.mjs writes', () => {
    const run = runStep(".github/workflows/release.yml", "Check packages/action/dist matches the sources");
    expect(run.status, `the step exits 1\n${run.output.slice(-2000)}`).toBe(1);
    expect(run.stdout.split("\n"), "the step's ::error:: line").toContain(STALE_ERROR);
  }, 300_000);
});
