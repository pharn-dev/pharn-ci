import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../../core/src/version.js";
import { expectValidReport } from "../../core/test/schema.js";

// fix-hints (H6), AC-9. main(), the renderer and the core's fix table are loaded inside the test body: the AC test is
// written before the build adds the `fix` objects and regenerates the golden report.json files. The CLI runs against
// in-memory deps: a fake repo rooted at REPO_ROOT whose git returns the golden directory's diff and files list.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "7d88076280ec86435c3f84ad3c6102e272ab64d5";
const REPO_ROOT = "/home/runner/work/demo/demo";
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const fixture = (path: string) => readFileSync(`${ROOT}fixtures/${path}`, "utf8");

type Fix = { kind: string; target?: string; hint: string };
type Report = { tool: { name: string; version: string }; messages: { code: string; fix?: Fix }[] };

async function runCli(dir: string, argv: string[], files: Record<string, string>) {
  const { main } = await import("../src/main.js");
  const out: string[] = [];
  const err: string[] = [];
  const at = new Map(Object.entries(files).map(([path, text]) => [resolve(REPO_ROOT, path), text]));
  const tracked = fixture(`${dir}/files.txt`).trim().split("\n");
  const deps = {
    cwd: REPO_ROOT,
    git: async (args: string[]) => {
      if (args[0] === "ls-files") return `${tracked.join("\0")}\0`;
      if (args[0] === "ls-tree") return "";
      if (args[0] === "diff") return fixture(`${dir}/pr.diff`);
      if (args[0] === "rev-parse" && args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return `${"2".repeat(40)}\n`;
      return `${"1".repeat(40)}\n`;
    },
    readFile: async (path: string) => at.get(path) ?? null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  const code = await main(argv, deps as never);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

/** The four golden directories and the CLI invocation that reproduces each golden report. */
const GOLDENS: Array<{ dir: string; argv: string[]; files: Record<string, string> }> = [
  {
    dir: "golden",
    argv: ["--coverage", "coverage/lcov.info", "--threshold", "80"],
    files: { "coverage/lcov.info": fixture("golden/coverage.info") },
  },
  {
    dir: "golden-cobertura",
    argv: ["--coverage", "coverage.xml", "--threshold", "80"],
    files: { "coverage.xml": fixture("golden-cobertura/coverage.xml") },
  },
  {
    dir: "golden-multi",
    argv: ["--coverage", "coverage/a/lcov.info", "--coverage", "coverage/b/lcov.info", "--threshold", "80"],
    files: {
      "coverage/a/lcov.info": fixture("golden-multi/coverage-a.info"),
      "coverage/b/lcov.info": fixture("golden-multi/coverage-b.info"),
    },
  },
  {
    dir: "golden-exclusions",
    argv: ["--coverage", "coverage/lcov.info"],
    files: {
      "coverage/lcov.info": fixture("golden-exclusions/coverage.info"),
      ".pharn/ci.yml": fixture("golden-exclusions/ci.yml"),
    },
  },
];

describe("the goldens with fix hints", { timeout: 120_000 }, () => {
  it("AC-9: pharn-ci check --format json on each golden fixture equals its regenerated report.json, every message carries fix, and every golden markdown is byte-identical to the base commit", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as {
      renderMarkdown(report: unknown): string;
      MESSAGE_FIXES?: Record<string, { kind: string; hint: string }>;
    };
    const messages: Array<[string, Report["messages"][number]]> = [];
    for (const { dir, argv, files } of GOLDENS) {
      const run = await runCli(dir, ["check", ...argv, "--format", "json"], files);
      expect([0, 1], `${dir}: exit ${run.code}: ${run.stderr}`).toContain(run.code);
      const report = JSON.parse(run.stdout) as Report;
      expectValidReport(report);

      // The golden files are shared with core tests that pass version "0.1.0"; the CLI reports the package VERSION.
      const golden = JSON.parse(fixture(`${dir}/report.json`)) as Report;
      expect(report, `${dir}/report.json`).toEqual({ ...golden, tool: { ...golden.tool, version: VERSION } });

      for (const message of report.messages) messages.push([dir, message]);

      // The comment is unchanged: the rendered report equals the golden markdown at the base commit, byte for byte.
      const rendered = core.renderMarkdown({ ...report, tool: { ...report.tool, version: "0.1.0" } });
      expect(rendered, `${dir}/report.md`).toBe(git("show", `${BASE}:fixtures/${dir}/report.md`));
      expect(fixture(`${dir}/report.md`), `${dir}/report.md on disk`).toBe(
        git("show", `${BASE}:fixtures/${dir}/report.md`),
      );
    }
    // No rendered golden anywhere under fixtures/ changed.
    const changed = git("diff", "--name-only", BASE, "--", "fixtures/")
      .split("\n")
      .filter((path) => path.endsWith(".md"));
    expect(changed).toEqual([]);

    // Every message of the CLI's JSON carries the table's fix.
    expect(messages.length, "the goldens have messages").toBeGreaterThan(0);
    expect(core.MESSAGE_FIXES, "MESSAGE_FIXES is exported").toBeDefined();
    for (const [dir, message] of messages) {
      expect(message.fix, `${dir} ${message.code} carries fix`).toBeDefined();
      expect(message.fix?.kind, `${dir} ${message.code} kind`).toBe(core.MESSAGE_FIXES?.[message.code]?.kind);
      expect(message.fix?.hint, `${dir} ${message.code} hint`).toBe(core.MESSAGE_FIXES?.[message.code]?.hint);
    }
  });
});
