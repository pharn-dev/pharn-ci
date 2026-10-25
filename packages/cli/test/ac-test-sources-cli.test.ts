import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// check() is observed, not replaced: the mock calls the real check() and records the input the CLI built, which
// nothing the CLI prints shows. main() and nodeDeps() are loaded inside the test body: the test is written before
// the CLI gathers test sources, so nothing that depends on that may run while the file loads.
vi.mock("@pharn-ci/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, check: vi.fn(actual.check as (input: unknown) => unknown) };
});

type Input = Record<string, unknown> & {
  testSources?: {
    base: { files?: { path: string; text: string }[] };
    head: { files?: { path: string; text: string }[] };
  };
};
interface Deps {
  git(args: string[]): Promise<string>;
  gitBatch?(args: string[], input: string): Promise<Uint8Array>;
  stdout(text: string): void;
  stderr(text: string): void;
}

const MAIN_TEXT = 'import { it } from "vitest";\nit("adds", () => {});\n';
const FEATURE_TEXT = 'import { expect, it } from "vitest";\nit("adds", () => expect(1 + 1).toBe(2));\n';

let dir: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-test-sources-cli-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 2;\n");
  writeFileSync(join(dir, "tests/a.test.ts"), MAIN_TEXT);
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
  writeFileSync(join(dir, "tests/a.test.ts"), FEATURE_TEXT);
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  mkdirSync(join(dir, "coverage"));
  // Absolute paths, as packages/cli/test/main.test.ts writes them.
  writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nDA:3,0\nend_of_record\n`);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("pharn-ci check: test sources", () => {
  it("AC-13: gathers base and head text by default, gathers nothing under --test-integrity off, and prints the same report", async () => {
    const { main } = await import("../src/main.js");
    const { nodeDeps } = await import("../src/nodeDeps.js");
    const core = await import("@pharn-ci/core");
    const spy = vi.mocked(core.check);
    const actual = await vi.importActual<{ check(input: unknown): unknown }>("@pharn-ci/core");

    async function runCli(extra: string[]) {
      const deps = nodeDeps(dir) as unknown as Deps;
      const calls: string[][] = [];
      const realGit = deps.git;
      deps.git = (args) => {
        calls.push([...args]);
        return realGit(args);
      };
      const realBatch = deps.gitBatch;
      if (realBatch) {
        deps.gitBatch = (args, input) => {
          calls.push([...args]);
          return realBatch(args, input);
        };
      }
      let out = "";
      deps.stdout = (text) => {
        out += text;
      };
      deps.stderr = () => {};
      spy.mockClear();
      const code = await main(
        ["check", "--base", "main", "--coverage", "coverage/lcov.info", "--format", "json", ...extra],
        deps as never,
      );
      expect(code, `exit code with ${extra.join(" ") || "no extra flags"}`).not.toBe(2);
      expect(spy).toHaveBeenCalled();
      const input = spy.mock.calls.at(-1)?.[0] as unknown as Input;
      return { input, calls, report: JSON.parse(out) };
    }

    const withoutSources = (input: Input) => {
      const { testSources: _ignored, ...rest } = input;
      return rest;
    };

    const gathered = await runCli([]);
    expect(gathered.input.testSources?.base.files).toEqual([{ path: "tests/a.test.ts", text: MAIN_TEXT }]);
    expect(gathered.input.testSources?.head.files).toEqual([{ path: "tests/a.test.ts", text: FEATURE_TEXT }]);
    expect(gathered.report).toEqual(actual.check(withoutSources(gathered.input)));

    const off = await runCli(["--test-integrity", "off"]);
    expect(off.calls.filter((args) => args[0] === "merge-base" || args[0] === "cat-file")).toEqual([]);
    expect(Object.hasOwn(off.input, "testSources")).toBe(false);
    expect(off.report).toEqual(actual.check(withoutSources(off.input)));
  }, 30_000);
});
