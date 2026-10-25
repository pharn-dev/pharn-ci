import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture, foldCallout } from "./helpers.js";
import { expectValidReport } from "./schema.js";

/** Remove the Test integrity section: its heading, an empty line, one fixed line and an empty line. */
function foldTestIntegrity(markdown: string): string {
  const lines = markdown.split("\n");
  const at = lines.indexOf("### 🔍 Test integrity");
  if (at === -1) throw new Error("foldTestIntegrity: no Test integrity heading");
  lines.splice(at, 4);
  return lines.join("\n");
}

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
// The pr-comment-logo-2 feature then updated the three markdown hashes in this block on purpose: the render gained the
// fixed logo line and an empty line above the heading; the JSON reports, and so their hashes, did not change.
const GOLDEN_JSON_SHA256 = "549b58c8b5f0dbe0e5fdb95ac115d53ce7ecbd1a8c7a20e6c60a9227de5ec537";
const GOLDEN_MD_SHA256 = "a55ed107a7e2f29761b965f4a8a993dfc069807cea5e7fcc19944da3b01fa6fc";
const GOLDEN_COBERTURA_JSON_SHA256 = "09f152cdc9119f7ee3de83a9912bf62dbcceeeb2d59a144765039b33a806feb1";
const GOLDEN_COBERTURA_MD_SHA256 = "54e560874b3950e8624986d021d621cefdfcf2f3ea46686d346532565f7ae2cb";
// fixtures/golden-exclusions/report.{json,md} as committed before this change (the markdown as F-32 committed
// it, both as F-11 changed them above); the partial-mismatch change must not change them. The markdown hash was
// updated on purpose by pr-comment-redesign-2 (the summary table under the verdict heading); the JSON did not change.
// pr-comment-bold-look updated the markdown hash on purpose again (header, section headings, collapsing and footer);
// the JSON did not change.
const EXCLUSIONS_JSON_SHA256 = "5773d3ef5a254c8c35f803665f70e69b881252e941c94e00fbbd479b569688fc";
// pr-comment-logo-2 updated the markdown hash on purpose again (the fixed logo line and an empty line above the
// heading); the JSON did not change.
// pr-comment-verdict-callout turned the overview line into a callout on purpose; every markdown hash in this file is
// taken after folding the callout back into the bare sentence, so each constant is unchanged.
const EXCLUSIONS_MD_SHA256 = "d470c10cfb7ca3d50ba370fccae4176615db8036f96168cc5c61063925562ce7";

type Message = { level: string; code: string; text: string };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;
const lines = (path: string) => fixture(path).trim().split("\n");
const partial = (messages: readonly Message[]) => messages.filter((message) => message.code === CODE);

// report-v2-skeleton (Report v2) set schemaVersion to 2, appended the empty testIntegrity block and changed the
// footer's schema version, on purpose. Every hash in this file predates that, so each comparison maps the v2 output
// back to its v1 form first; the constants are unchanged, and the v2 additions are asserted exactly.
function toV1(report: { schemaVersion?: unknown; testIntegrity?: unknown }): Record<string, unknown> {
  expect(report.schemaVersion).toBe(2);
  expect(report.testIntegrity).toEqual({
    mode: "warn",
    source: "default",
    verdict: "pass",
    signals: [],
    languages: [],
  });
  const { testIntegrity: _testIntegrity, ...v1 } = { ...report, schemaVersion: "1" };
  return v1;
}
function footerToV1(markdown: string): string {
  expect(markdown).toContain("· report schema v2");
  return markdown.replace("· report schema v2", "· report schema v1");
}

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

      // Everything else is the report as it was before this change, in its Report v1 form (the hashes predate v2).
      const without = { ...report, messages: report.messages.filter((message) => message.code !== CODE) };
      expect(sha256(asFile(toV1(without))), `${dir} report.json without the message`).toBe(jsonSha);
      // test-integrity-mode added the "🔍 Test integrity" section on purpose: its four lines are folded out too.
      const markdown = foldCallout(foldTestIntegrity(renderMarkdown(report))).split("\n");
      const messageLines = markdown.filter((line) => line.includes(`\`${CODE}\``));
      expect(messageLines, `${dir} report.md lines naming the code`).toHaveLength(1);
      const at = markdown.findIndex((line) => line.includes(`\`${CODE}\``));
      expect(markdown[at + 1], `${dir} report.md hint line under the message`).toMatch(/^ {2}- Hint: \S/);
      const previous = markdown.filter((_, index) => index !== at && index !== at + 1).join("\n");
      expect(sha256(footerToV1(previous)), `${dir} report.md without the message and its hint`).toBe(mdSha);
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
    expect(sha256(asFile(toV1(JSON.parse(fixture("golden-exclusions/report.json")))))).toBe(EXCLUSIONS_JSON_SHA256);
    expect(sha256(footerToV1(foldCallout(foldTestIntegrity(fixture("golden-exclusions/report.md")))))).toBe(
      EXCLUSIONS_MD_SHA256,
    );
  });
});
