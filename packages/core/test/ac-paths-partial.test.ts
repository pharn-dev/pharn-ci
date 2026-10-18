import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the config parser, the renderer and the fixtures are loaded inside each test body: the AC tests are
// written before the partial-mismatch message and fixtures/coverage-paths/ exist, so nothing that depends on them
// may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE = "COVERAGE_PATHS_PARTIALLY_UNMATCHED";

// sha256 of the committed golden outputs before this change. A report that gains exactly the partial-mismatch
// message gives these again once that one message (in the markdown, its bullet and the hint line under it) is
// taken out. The markdown hashes are those of the outputs F-32 committed, which intentionally changed the
// rendering (file rows sorted by coverage, a hint line under each message); the JSON reports did not change.
// F-16 moved `### Messages` above `### Agent setup` on purpose, as F-32 changed the rendering before, so the
// markdown hashes changed once more. F-11 (ai-agnostic-inventory) then updated every hash in this block on
// purpose: AGENTS.md is now credited to four more tools (amp, jules, opencode, zed), so each golden's
// `Agent setup:` line and `agentSetup.summary.tools` changed. The pr-comment-redesign-2 feature then updated the
// three markdown hashes in this block on purpose: the render gained a summary table under the verdict heading; the
// JSON reports, and so their hashes, did not change. The pr-comment-bold-look feature then updated the three markdown
// hashes in this block on purpose: the render changed its header, section headings, collapsing and footer. The golden
// and golden-cobertura markdown hashes now differ only by the footer's coverage format; the JSON reports did not change.
const GOLDEN_JSON_SHA256 = "549b58c8b5f0dbe0e5fdb95ac115d53ce7ecbd1a8c7a20e6c60a9227de5ec537";
const GOLDEN_MD_SHA256 = "b61cd0d636dd1f9e53756354f6ed7b17b8e9b2001a535491912ed619e970591d";
const GOLDEN_COBERTURA_JSON_SHA256 = "09f152cdc9119f7ee3de83a9912bf62dbcceeeb2d59a144765039b33a806feb1";
const GOLDEN_COBERTURA_MD_SHA256 = "7ef7c7562dc407b77282fc89e6413c7b31235f23e8c0a35269d4e147ac77639c";
// fixtures/golden-exclusions/report.{json,md} as committed before this change (the markdown as F-32 committed
// it, both as F-11 changed them above); the partial-mismatch change must not change them. The markdown hash was
// updated on purpose by pr-comment-redesign-2 (the summary table under the verdict heading); the JSON did not change.
// pr-comment-bold-look updated the markdown hash on purpose again (header, section headings, collapsing and footer);
// the JSON did not change.
const EXCLUSIONS_JSON_SHA256 = "5773d3ef5a254c8c35f803665f70e69b881252e941c94e00fbbd479b569688fc";
const EXCLUSIONS_MD_SHA256 = "6ccd0260d4b9bac126eb1d3d7d569aa16d24baebefb11288ff2930385af8ae6e";

type Message = { level: string; code: string; text: string };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;
const lines = (path: string) => fixture(path).trim().split("\n");
const partial = (messages: readonly Message[]) => messages.filter((message) => message.code === CODE);

async function load() {
  const { check } = await import("../src/check.js");
  const { parseConfig } = await import("../src/config.js");
  const { renderMarkdown } = await import("../src/render/markdown.js");
  return { check, parseConfig, renderMarkdown };
}

describe("check(): some coverage paths are not tracked files", () => {
  it("AC-5: reports the untracked count as info and measures the tracked files with the same verdict", async () => {
    const { check } = await load();
    const run = (coveragePath: string) =>
      check({
        version: "0.1.0",
        coverage: { text: fixture(coveragePath), format: "lcov" },
        diff: { text: fixture("coverage-paths/partial/pr.diff") },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: lines("coverage-paths/partial/files.txt"),
      });

    const report = run("coverage-paths/partial/coverage.info");
    expectValidReport(report);
    const messages = partial(report.messages);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("info");
    expect(messages[0]?.text).toMatch(/(?<!\d)2(?!\d)/);
    expect(report.messages.map((message) => message.code)).not.toContain("COVERAGE_PATHS_UNMATCHED");
    expect(report.diffCoverage?.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    expect(report.diffCoverage).toMatchObject({ coveredLines: 1, coverableLines: 2, percent: 50 });

    const trackedOnly = run("coverage-paths/partial/coverage-tracked.info");
    expectValidReport(trackedOnly);
    expect(partial(trackedOnly.messages)).toEqual([]);
    expect(report.diffCoverage).toEqual(trackedOnly.diffCoverage);
    expect(report.verdict).toBe(trackedOnly.verdict);
    expect(report.verdict).toBe("fail");
  });

  it("AC-5: the golden and golden-cobertura reports gain exactly that message with count 1; golden-exclusions is unchanged", async () => {
    const { check, parseConfig, renderMarkdown } = await load();

    for (const [dir, format, jsonSha, mdSha] of [
      ["golden", "lcov", GOLDEN_JSON_SHA256, GOLDEN_MD_SHA256],
      ["golden-cobertura", "auto", GOLDEN_COBERTURA_JSON_SHA256, GOLDEN_COBERTURA_MD_SHA256],
    ] as const) {
      const report = check({
        version: "0.1.0",
        coverage: { text: fixture(`${dir}/coverage.${format === "lcov" ? "info" : "xml"}`), format },
        diff: { text: fixture(`${dir}/pr.diff`) },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: lines(`${dir}/files.txt`),
      });
      expectValidReport(report);
      const messages = partial(report.messages);
      expect(messages, dir).toHaveLength(1);
      expect(messages[0]?.level, dir).toBe("info");
      expect(messages[0]?.text, dir).toMatch(/(?<!\d)1(?!\d)/);

      // Everything else is the report as it was before this change.
      const without = { ...report, messages: report.messages.filter((message) => message.code !== CODE) };
      expect(sha256(asFile(without)), `${dir} report.json without the message`).toBe(jsonSha);
      const markdown = renderMarkdown(report).split("\n");
      const messageLines = markdown.filter((line) => line.includes(`\`${CODE}\``));
      expect(messageLines, `${dir} report.md lines naming the code`).toHaveLength(1);
      const at = markdown.findIndex((line) => line.includes(`\`${CODE}\``));
      expect(markdown[at + 1], `${dir} report.md hint line under the message`).toMatch(/^ {2}- Hint: \S/);
      const previous = markdown.filter((_, index) => index !== at && index !== at + 1).join("\n");
      expect(sha256(previous), `${dir} report.md without the message and its hint`).toBe(mdSha);
    }

    // golden-exclusions, as packages/core/test/exclusions-golden.test.ts builds it: every coverage path is tracked.
    const config = parseConfig(fixture("golden-exclusions/ci.yml")) as {
      coverage?: { exclude?: string[]; threshold?: number };
    };
    const exclusions = check({
      version: "0.1.0",
      coverage: { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden-exclusions/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: config.coverage?.threshold ?? null,
      repoFiles: lines("golden-exclusions/files.txt"),
      exclude: config.coverage?.exclude ?? [],
    } as Parameters<typeof check>[0]);
    expectValidReport(exclusions);
    expect(partial(exclusions.messages)).toEqual([]);
    expect(asFile(exclusions)).toBe(fixture("golden-exclusions/report.json"));
    expect(renderMarkdown(exclusions)).toBe(fixture("golden-exclusions/report.md"));
    expect(sha256(fixture("golden-exclusions/report.json"))).toBe(EXCLUSIONS_JSON_SHA256);
    expect(sha256(fixture("golden-exclusions/report.md"))).toBe(EXCLUSIONS_MD_SHA256);
  });
});
