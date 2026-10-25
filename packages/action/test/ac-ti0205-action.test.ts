import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// run() and createNodeIo() are loaded inside the test body: the AC test is written before the Action runs the Python
// index, so nothing that depends on that may run while the file loads. Git is real (temporary repositories); the
// Python index is an injected fake that records its calls and indexes `def test_*` functions with a small scanner
// written here, so the test needs no python3.

const JS_PATH = "src/a.test.ts";
const PY_PATH = "tests/test_cart.py";

const JS_BASE = 'import { expect, it } from "vitest";\n\nit("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n';
const JS_HEAD = `${JS_BASE}\nit("subtracts", () => {\n  expect(2 - 1).toBe(1);\n});\n`;
const PY_BASE =
  "from cart import total\n\n\ndef test_adds_prices():\n    assert total([2, 3]) == 5\n\n\ndef test_empty_cart():\n    assert total([]) == 0\n";
const PY_HEAD = "from cart import total\n\n\ndef test_adds_prices():\n    assert total([2, 3]) == 5\n";

interface Repo {
  dir: string;
  baseId: string;
  headId: string;
}
const repos: Repo[] = [];

/** A repository whose main commit holds the base files and whose feature commit writes the head files. */
function makeRepo(base: Record<string, string>, head: Record<string, string>): Repo {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-ti0205-action-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const write = (files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
  };
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  write({ "src/math.ts": "export const a = 1;\nexport const b = 2;\n", ...base });
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  const baseId = sh("rev-parse", "HEAD").trim();
  sh("checkout", "-q", "-b", "feature");
  write({ "src/math.ts": "export const a = 1;\nexport const b = 3;\n", ...head });
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  const repo = { dir, baseId, headId: sh("rev-parse", "HEAD").trim() };
  repos.push(repo);
  return repo;
}

let pyRepo: Repo;
let jsRepo: Repo;

beforeAll(() => {
  pyRepo = makeRepo({ [JS_PATH]: JS_BASE, [PY_PATH]: PY_BASE }, { [JS_PATH]: JS_HEAD, [PY_PATH]: PY_HEAD });
  jsRepo = makeRepo({ [JS_PATH]: JS_BASE }, { [JS_PATH]: JS_HEAD });
});

afterAll(() => {
  for (const repo of repos) rmSync(repo.dir, { recursive: true, force: true });
});

/** 32-bit FNV-1a over UTF-16 code units, as 8 lowercase hex digits. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A plain-data index of the top-level `def test_*` functions of a Python text. */
function scanPython(text: string) {
  const lines = text.split("\n");
  const tests = lines.flatMap((line, i) => {
    const match = /^def (test_\w+)\(/.exec(line);
    if (match === null) return [];
    const bodyLines: { text: string; line: number }[] = [];
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j] ?? ""); j++) {
      bodyLines.push({ text: (lines[j] ?? "").trim(), line: j + 1 });
    }
    const body = bodyLines.map((b) => b.text).join(" ");
    const asserts = bodyLines.filter((b) => b.text.startsWith("assert "));
    const name = match[1] as string;
    return [
      {
        kind: "test",
        name,
        nameDynamic: false,
        path: [name],
        line: i + 1,
        endLine: i + 1 + bodyLines.length,
        modifiers: [],
        body,
        bodyHash: fnv1a(body),
        assertionCount: asserts.length,
        assertions: asserts.map((a) => ({
          chain: "assert",
          line: a.line,
          awaited: false,
          inTryCatch: false,
          afterEarlyReturn: false,
        })),
        guards: [],
      },
    ];
  });
  return { parsed: true, syntaxErrors: 0, tests, mocks: [] };
}

type PyFile = { path: string; text: string };

async function actionRun(repo: Repo, inputs: Record<string, string>) {
  const { run } = (await import("../src/run.js")) as unknown as { run(deps: never): Promise<unknown> };
  const { createNodeIo } = await import("../src/node-io.js");
  const lcov = `SF:${repo.dir}/src/math.ts\nDA:1,1\nDA:2,1\nend_of_record\n`;
  const h = harness({
    inputs,
    files: { [`${repo.dir}/coverage/lcov.info`]: lcov },
    context: {
      ...PR_CONTEXT,
      payload: { pull_request: { number: 7, base: { sha: repo.baseId }, head: { sha: repo.headId } } },
    },
  });
  const io = createNodeIo(repo.dir) as unknown as Record<string, unknown>;
  const deps = h.deps as unknown as Record<string, unknown>;
  deps.workspace = repo.dir;
  deps.git = io.git;
  deps.gitStream = io.gitStream;
  if (io.gitBatch) deps.gitBatch = io.gitBatch;
  deps.listDir = io.listDir;
  const calls: PyFile[][] = [];
  deps.indexPython = async (files: readonly PyFile[]) => {
    calls.push(files.map((f) => ({ path: f.path, text: f.text })));
    return { available: true, files: files.map((f) => ({ path: f.path, result: scanPython(f.text) })) };
  };
  await run(h.deps as never);
  const reportText = h.written[h.outputs["report-path"] as string];
  expect(reportText, "the Action wrote report.json").toBeDefined();
  const report = JSON.parse(reportText as string) as {
    testIntegrity: { signals: { id: string; severity: string; path: string; line: number | null; detail: string }[] };
  };
  expectValidReport(report);
  return { calls, report };
}

describe("action: the Python test index", () => {
  it("AC-15: a PR with a modified Python test file calls the Python index once with only Python test files and reports its findings; mode off and a JS/TS-only PR never call it", async () => {
    const py = await actionRun(pyRepo, { "test-integrity": "block" });
    expect(py.calls, "the Python index runs once").toHaveLength(1);
    const sent = py.calls[0] as PyFile[];
    expect(sent.length).toBeGreaterThan(0);
    for (const file of sent) expect(file.path, "only Python test files").toMatch(/(^|\/)test_[^/]*\.py$/);
    expect(
      sent.map((f) => `${f.path}\n${f.text}`).sort(),
      "the base and the head text of the Python test file, and nothing else",
    ).toEqual([`${PY_PATH}\n${PY_BASE}`, `${PY_PATH}\n${PY_HEAD}`].sort());
    const pyFindings = py.report.testIntegrity.signals.filter((s) => String(s.id) === "TI02" && s.path === PY_PATH);
    expect(pyFindings, "the report holds the Python finding").toHaveLength(1);
    expect(pyFindings[0]?.detail).toContain("test_empty_cart");

    const off = await actionRun(pyRepo, { "test-integrity": "off" });
    expect(off.calls, "mode off never calls it").toEqual([]);

    const js = await actionRun(jsRepo, { "test-integrity": "block" });
    expect(js.calls, "a JS/TS-only PR never calls it").toEqual([]);
  }, 60_000);
});
