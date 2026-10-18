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
// markdown hashes changed once more.
const GOLDEN_JSON_SHA256 = "647b7ba7088c13dd9a35e1e543c82135e17d8d754c212f5768a6f1ddbfe49f3d";
const GOLDEN_MD_SHA256 = "625c0fe399c49aca5aabdc560db4a1e412fac63d07c29d47b74e30c3b2783d43";
const GOLDEN_COBERTURA_JSON_SHA256 = "4aa93c70eaf2e1f4f1b6d30d7fe2aecc0ff2373e5a67bd5323bfddd836e036dc";
const GOLDEN_COBERTURA_MD_SHA256 = "625c0fe399c49aca5aabdc560db4a1e412fac63d07c29d47b74e30c3b2783d43";
// fixtures/golden-exclusions/report.{json,md} as committed before this change (the markdown as F-32 committed
// it); they must not change.
const EXCLUSIONS_JSON_SHA256 = "c4e07ded4197d694c9df1a91202a9ee741d1bf2376ce2ece5e62ba39f75a4e52";
const EXCLUSIONS_MD_SHA256 = "b190b519dbe7110bc663a67173d295376b049256298999cec34f706e2bf6049a";

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
