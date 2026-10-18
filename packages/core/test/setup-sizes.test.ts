import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { parseLsTreeSizes } from "../src/setup/sizes.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

const BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
const record = (size: string, path: string, type = "blob") =>
  `100644 ${type} ${BLOB} ${size.padStart(7, " ")}\t${path}`;

describe("parseLsTreeSizes", () => {
  it("reads blob sizes from the fixture and skips submodules and malformed records", () => {
    const text = fixture("setup/ls-tree.txt").trim().split("\n").join("\0");
    expect([...parseLsTreeSizes(text)]).toEqual([
      ["CLAUDE.md", 0],
      ["AGENTS.md", 120],
      ["src/a.ts", 12345],
      ["scripts/run.sh", 42],
    ]);
  });

  it("takes the path verbatim, including a TAB or newline", () => {
    const sizes = parseLsTreeSizes(`${record("0", "a\tb/CLAUDE.md")}\0${record("5", "x\ny/AGENTS.md")}\0`);
    expect([...sizes]).toEqual([
      ["a\tb/CLAUDE.md", 0],
      ["x\ny/AGENTS.md", 5],
    ]);
  });

  it("skips hostile records without throwing", () => {
    const hostile = [
      record("-", "dash.md"),
      record("12", "sub", "commit"),
      "100644 blob onlythree\tpath.md",
      `100644 blob ${BLOB} 1 2\tfive.md`,
      `100644 blob ${BLOB} 12abc\tbad-size.md`,
      `100644 blob ${BLOB} -5\tnegative.md`,
      `100644 blob ${BLOB} 99999999999999999999\ttoo-big.md`,
      `100644 blob ${BLOB} 4\t`,
      "no tab at all",
      "",
    ].join("\0");
    expect(parseLsTreeSizes(hostile).size).toBe(0);
  });

  it("returns an empty map for empty input", () => {
    expect(parseLsTreeSizes("").size).toBe(0);
    expect(parseLsTreeSizes("\0\0").size).toBe(0);
  });
});

function runCheck(repoFiles: string[], repoFileBytes?: Map<string, number>, requireAgentSetup?: boolean) {
  return check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov", file: "coverage/lcov.info" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles,
    ...(repoFileBytes === undefined ? {} : { repoFileBytes }),
    ...(requireAgentSetup === undefined ? {} : { requireAgentSetup }),
  });
}

const emptyMessages = (report: { messages: { code: string; level: string; text: string }[] }) =>
  report.messages.filter((message) => message.code === "AGENT_SETUP_FILE_EMPTY");

const tracked = () => fixture("golden/files.txt").trim().split("\n");

describe("check(): empty agent setup files", () => {
  it("reports one empty file with the singular text and keeps it in the inventory", () => {
    const report = runCheck(tracked(), new Map([["CLAUDE.md", 0]]));
    expectValidReport(report);
    expect(emptyMessages(report)).toEqual([
      { level: "warn", code: "AGENT_SETUP_FILE_EMPTY", text: "1 agent setup file is empty: `CLAUDE.md`." },
    ]);
    expect(report.agentSetup.files.map((file) => file.path)).toContain("CLAUDE.md");
    expect(report.verdict).toBe("warn");
  });

  it("reports several empty files with the plural text naming the first in sorted order", () => {
    const report = runCheck(
      tracked(),
      new Map([
        ["packages/web/CLAUDE.md", 0],
        ["AGENTS.md", 0],
        ["CLAUDE.md", 0],
      ]),
    );
    expectValidReport(report);
    expect(emptyMessages(report).map((message) => message.text)).toEqual([
      "3 agent setup files are empty, for example `AGENTS.md`.",
    ]);
  });

  it("adds no message for a non-empty file, an unknown size, or a non-setup empty file", () => {
    const report = runCheck(
      tracked(),
      new Map([
        ["CLAUDE.md", 7],
        ["src/empty.ts", 0],
      ]),
    );
    expectValidReport(report);
    expect(emptyMessages(report)).toEqual([]);
    expect(report).toEqual(runCheck(tracked()));
  });

  it("leaves the report unchanged when no sizes are given", () => {
    const withoutSizes = runCheck(tracked());
    expect(emptyMessages(withoutSizes)).toEqual([]);
    expect(runCheck(tracked(), new Map())).toEqual(withoutSizes);
  });

  it("does not change NO_AGENT_SETUP_FILES or the requirement because a file is empty", () => {
    const onlyEmpty = ["CLAUDE.md", "src/a.ts"];
    const report = runCheck(onlyEmpty, new Map([["CLAUDE.md", 0]]), true);
    expectValidReport(report);
    expect(report.messages.some((message) => message.code === "NO_AGENT_SETUP_FILES")).toBe(false);
    expect(emptyMessages(report)).toHaveLength(1);
    expect(report.verdict).toBe("warn");

    const none = runCheck(["src/a.ts"], new Map([["src/a.ts", 0]]), true);
    expect(none.messages.some((message) => message.code === "NO_AGENT_SETUP_FILES")).toBe(true);
    expect(emptyMessages(none)).toEqual([]);
  });

  it("quotes a path with a backtick or newline on one line", () => {
    const path = "a`b\nc/CLAUDE.md";
    const report = runCheck([...tracked(), path], new Map([[path, 0]]));
    expectValidReport(report);
    const [message] = emptyMessages(report);
    expect(message?.text).toBe("1 agent setup file is empty: `a'b�c/CLAUDE.md`.");
  });

  it("renders the hint in markdown", () => {
    const report = runCheck(tracked(), new Map([["CLAUDE.md", 0]]));
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("1 agent setup file is empty");
    expect(markdown).toContain("Fill in the empty file or delete it");
  });
});
