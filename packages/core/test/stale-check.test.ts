import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DiffFile } from "../src/diff/unified.js";
import {
  type CheckInput,
  check,
  detectStaleInstructions,
  type StaleInstructionSources,
  scanAgentSetup,
  staleInstructionPaths,
} from "../src/index.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { withoutFix } from "./v090-codes.js";

// Stale instructions (Horizon 2 item H3) through check(): the report's setupHealth object and SETUP_STALE_* messages,
// validated against schema/report.v2.json; nothing without a diff or without the sources.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPO_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "Makefile",
  "docs/guide.md",
  "docs/setup.md",
  "package.json",
  "src/index.ts",
  "src/util/strings.ts",
];
const modified = (path: string, addedLines: number[] = [1]): DiffFile => ({
  path,
  oldPath: path,
  status: "modified",
  addedLines,
});

function input(diff: CheckInput["diff"], staleInstructionSources?: StaleInstructionSources): CheckInput {
  return {
    version: "0.7.0",
    coverage: { text: "SF:src/index.ts\nDA:1,1\nend_of_record\n", format: "lcov" },
    diff,
    threshold: null,
    repoFiles: REPO_FILES,
    ...(staleInstructionSources === undefined ? {} : { staleInstructionSources }),
  };
}

const SOURCES: StaleInstructionSources = {
  instructions: {
    files: [
      { path: "CLAUDE.md", text: fixture("stale-instructions/root-claude.md.txt") },
      { path: "AGENTS.md", text: "The entry point is `src/index.ts`.\n" },
    ],
    dropped: [],
  },
  packageJson: { head: fixture("stale-instructions/package.json.txt") },
  makefile: { head: fixture("stale-instructions/Makefile.txt") },
};

describe("check() and stale instructions", () => {
  it("a change that touches CLAUDE.md reports its stale tokens in setupHealth and one warn message per id; the report validates", () => {
    const report = check(input({ parsed: [modified("src/index.ts"), modified("CLAUDE.md")] }, SOURCES));
    expectValidReport(report);
    expect(report.verdict).toBe("warn");
    expect(report.setupHealth?.stale.map((f) => `${f.id} ${f.path}:${f.line} ${f.token}`)).toEqual([
      "SI01 CLAUDE.md:4 pnpm run format",
      "SI01 CLAUDE.md:5 npm run typecheck",
      "SI01 CLAUDE.md:6 yarn run e2e",
      "SI01 CLAUDE.md:7 bun run docs",
      "SI01 CLAUDE.md:8 make deploy",
      "SI02 CLAUDE.md:11 scripts/changelog.sh",
      "SI02 CLAUDE.md:12 config/app.yml",
      "SI02 CLAUDE.md:13 missing-helper.ts",
      "SI03 CLAUDE.md:15 docs/install.md",
      "SI03 CLAUDE.md:16 docs/conventions.md",
    ]);
    const stale = report.messages.filter((m) => m.code.startsWith("SETUP_STALE_"));
    expect(stale.map((m) => `${m.level} ${m.code}`)).toEqual([
      "warn SETUP_STALE_SI01",
      "warn SETUP_STALE_SI02",
      "warn SETUP_STALE_SI03",
    ]);
    expect(stale[0]?.text).toContain("`CLAUDE.md:4`, `CLAUDE.md:5`, `CLAUDE.md:6`, `CLAUDE.md:7`, `CLAUDE.md:8`.");
  });

  it("SI04 alone is info, so the verdict stays pass", () => {
    const sources: StaleInstructionSources = {
      ...SOURCES,
      commitTimes: { head: 2_000_000_000, files: [{ path: "AGENTS.md", time: 1_000_000_000 }] },
    };
    const report = check(input({ parsed: [modified("src/index.ts")] }, sources));
    expectValidReport(report);
    // fix-hints (H6): every finding now carries a `fix`; the pinned literal is unchanged, so it is read without it.
    expect(withoutFix(report.setupHealth?.stale)).toEqual([
      { id: "SI04", path: "AGENTS.md", line: 1, kind: "path", token: "src/index.ts" },
    ]);
    expect(report.messages.filter((m) => m.code.startsWith("SETUP_STALE_")).map((m) => m.level)).toEqual(["info"]);
    expect(report.verdict).toBe("pass");
  });

  it("must not trigger: without a diff, without the sources, or with an untouched file and nothing removed, the report is the one it was", () => {
    const touched: DiffFile[] = [modified("src/index.ts"), modified("CLAUDE.md")];
    const plain = check(input({ parsed: touched }));
    expect(plain.setupHealth).toBeUndefined();
    const noDiff = check(input({ unavailable: "no base" }, SOURCES));
    expect(noDiff).toEqual(check(input({ unavailable: "no base" })));
    expect(noDiff.setupHealth).toBeUndefined();
    const untouched = check(input({ parsed: [modified("src/index.ts")] }, SOURCES));
    expect(untouched).toEqual(check(input({ parsed: [modified("src/index.ts")] })));
    const unreadable = check(input({ parsed: touched }, { instructions: { unavailable: "git failed" } }));
    expect(unreadable).toEqual(plain);
  });

  it("this repository's own instruction files give no finding, even when a change touches every one of them", () => {
    const repoFiles = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    const agentSetup = scanAgentSetup(repoFiles);
    const paths = staleInstructionPaths(agentSetup);
    expect(paths, "control: the repository has instruction files").toContain("AGENTS.md");
    const { findings } = detectStaleInstructions({
      sources: {
        instructions: {
          files: paths.map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") })),
          dropped: [],
        },
        packageJson: { head: readFileSync(join(ROOT, "package.json"), "utf8") },
        makefile: { head: null },
      },
      diff: paths.map((path) => modified(path)),
      repoFiles,
      agentSetup,
    });
    expect(findings).toEqual([]);
  });
});
