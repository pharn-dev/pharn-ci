import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// F-10, inventory quality: an empty agent setup file. main() is loaded inside each test body: the AC tests are written
// before the build, so nothing that depends on the new `git ls-tree` wiring may run while the file loads. The CLI runs
// against in-memory deps: the golden coverage, diff and tracked-files list, and a fake git whose `ls-tree` answer is
// built here with CLAUDE.md at size 0 (or which rejects `ls-tree`).

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const BLOB_SHA = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

const trackedPaths = () => fixture("golden/files.txt").trim().split("\n");

/** `git ls-tree -r -l -z --full-tree HEAD` output: `<mode> <type> <object> <size>\t<path>`, NUL-terminated, the
 * size space-padded as git pads it. CLAUDE.md is empty; every other tracked file has content. */
function lsTreeOutput(paths: readonly string[]): string {
  return paths
    .map((path) => {
      const size = path === "CLAUDE.md" ? 0 : 120;
      return `100644 blob ${BLOB_SHA} ${String(size).padStart(7, " ")}\t${path}\0`;
    })
    .join("");
}

function fakeGit(lsTree: "sizes" | "fails") {
  const paths = trackedPaths();
  return async (args: string[]) => {
    if (args.includes("ls-tree")) {
      if (lsTree === "fails") throw new Error("fatal: not a valid object name HEAD");
      const expectedArgs = ["-r", "-l", "-z", "--full-tree", "HEAD"];
      if (!expectedArgs.every((arg) => args.includes(arg))) throw new Error(`unexpected ls-tree: ${args.join(" ")}`);
      return lsTreeOutput(paths);
    }
    if (args.includes("ls-files")) return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
    if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
    if (args.includes("diff")) return fixture("golden/pr.diff");
    // Any other call (rev-parse and the like) resolves a commit.
    return `${BASE_SHA}\n`;
  };
}

type Report = {
  verdict: string;
  messages: { code: string; level: string; text: string }[];
  agentSetup: { files: { path: string }[] };
};

async function runCli(lsTree: "sizes" | "fails") {
  const { main } = await import("../src/main.js");
  const out: string[] = [];
  const err: string[] = [];
  const contents = new Map([[resolve(REPO_ROOT, "coverage/lcov.info"), fixture("golden/coverage.info")]]);
  const deps = {
    cwd: REPO_ROOT,
    git: fakeGit(lsTree),
    readFile: async (path: string) => contents.get(path) ?? null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  const code = await main(["check", "--coverage", "coverage/lcov.info", "--format", "json"], deps);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

const emptyMessages = (report: Report) =>
  report.messages.filter((message) => message.code === "AGENT_SETUP_FILE_EMPTY");

describe("inventory quality: empty agent setup files through the CLI", () => {
  it("AC-3: an empty CLAUDE.md in git ls-tree gives one AGENT_SETUP_FILE_EMPTY warning, keeps the file listed, and exits 0", async () => {
    const { EXIT_OK } = await import("../src/main.js");
    const cli = await runCli("sizes");
    const report: Report = JSON.parse(cli.stdout);
    expectValidReport(report);
    expect(emptyMessages(report)).toEqual([
      { level: "warn", code: "AGENT_SETUP_FILE_EMPTY", text: "1 agent setup file is empty: `CLAUDE.md`." },
    ]);
    expect(report.agentSetup.files.map((file) => file.path)).toContain("CLAUDE.md");
    expect(report.verdict).toBe("warn");
    expect(cli.code).toBe(EXIT_OK);
    expect(cli.code).toBe(0);
  });

  it("AC-3: a failing git ls-tree gives no AGENT_SETUP_FILE_EMPTY message, still reports, never exits 2, and notes the missing sizes once on stderr", async () => {
    const cli = await runCli("fails");
    const report: Report = JSON.parse(cli.stdout);
    expectValidReport(report);
    expect(emptyMessages(report)).toEqual([]);
    expect(report.agentSetup.files.map((file) => file.path)).toContain("CLAUDE.md");
    expect([0, 1]).toContain(cli.code);
    expect(cli.code).toBe(report.verdict === "fail" ? 1 : 0);
    // stderr also carries the CLI's other notes (the auto-detected coverage format); exactly one line is about the
    // failed `git ls-tree`.
    const notes = cli.stderr.split("\n").filter((line) => line.includes("ls-tree"));
    expect(notes).toHaveLength(1);
  });
});
