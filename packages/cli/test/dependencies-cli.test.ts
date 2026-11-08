import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sideFiles } from "../../core/test/dependencies-helpers.js";
import { expectValidReport } from "../../core/test/schema.js";

// A13 (dependency safety) in the CLI: `pharn-ci check` with its real Node deps on a temporary repository whose feature
// branch is the d04-lock-untouched fixture case (a dependency added to package.json, pnpm-lock.yaml left alone) plus a
// git dependency (D05). The CLI runs D04 and D05 from committed objects and never makes a network call, so `lookup`
// runs as `auto` and says so on stderr.

interface Deps {
  stdout(text: string): void;
  stderr(text: string): void;
}
type Report = Record<string, unknown> & {
  verdict: string;
  messages: { level: string; code: string; text: string }[];
  dependencies?: { checked: number; lookups: string; signals: { id: string; path: string; line: number | null }[] };
};

const CASE = new URL("../../../fixtures/dependencies/d04-lock-untouched/", import.meta.url).pathname;
let dir: string;

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-deps-cli-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const write = (side: "base" | "head") => {
    for (const file of sideFiles(`${CASE}${side}`)) {
      mkdirSync(dirname(join(dir, file.path)), { recursive: true });
      const text =
        side === "head" && file.path === "package.json"
          ? file.text.replace(
              '"left-pad": "^1.3.0"',
              '"left-pad": "^1.3.0",\n    "from-git": "github:someone/from-git"',
            )
          : file.text;
      writeFileSync(join(dir, file.path), text);
    }
  };
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  write("base");
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies: {}\n");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/index.ts"), "export const a = 1;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  write("head");
  writeFileSync(join(dir, "src/index.ts"), "export const a = 2;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  mkdirSync(join(dir, "coverage"));
  writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/src/index.ts\nDA:1,1\nend_of_record\n`);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function runCli(extra: string[] = []) {
  const { main } = await import("../src/main.js");
  const { nodeDeps } = await import("../src/nodeDeps.js");
  const deps = nodeDeps(dir) as unknown as Deps;
  let out = "";
  let err = "";
  deps.stdout = (text) => {
    out += text;
  };
  deps.stderr = (text) => {
    err += text;
  };
  const code = await main(
    ["check", "--base", "main", "--coverage", "coverage/lcov.info", "--format", "json", ...extra],
    deps as never,
  );
  if (out === "") return { code, report: undefined, err };
  const report = JSON.parse(out) as Report;
  expectValidReport(report);
  return { code, report, err };
}

describe("pharn-ci check: dependency safety", { timeout: 120_000 }, () => {
  it("reports D04 and D05 from git and fails, with lookups off", async () => {
    const { code, report } = await runCli();
    expect(code).toBe(1);
    expect(report?.dependencies?.lookups).toBe("off");
    expect(report?.dependencies?.signals.map((s) => [s.id, s.path, s.line])).toEqual([
      ["D04", "package.json", 6],
      ["D05", "package.json", 7],
    ]);
    expect(report?.verdict).toBe("fail");
  });

  it("--dependencies lookup makes no network call and says so; never checks nothing", async () => {
    const lookup = await runCli(["--dependencies", "lookup"]);
    expect(lookup.report?.dependencies?.lookups).toBe("off");
    expect(lookup.err).toContain(
      "pharn-ci: the CLI makes no network call, so dependency registry lookups (D01 to D03) are off",
    );
    const never = await runCli(["--dependencies", "never"]);
    expect(never.report?.dependencies).toBeUndefined();
    expect(never.code).toBe(0);
  });

  it("an invalid --dependencies exits 2", async () => {
    const { code, err } = await runCli(["--dependencies", "sometimes"]);
    expect(code).toBe(2);
    expect(err).toContain('--dependencies must be one of: auto, lookup, never (got "sometimes")');
  });
});
