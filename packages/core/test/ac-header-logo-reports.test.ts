import { describe, expect, it } from "vitest";
import type { DiffCoverageResult } from "../src/diffCoverage.js";
import type { BuildReportInput, Report } from "../src/report.js";
import type { AgentSetupFile } from "../src/setup/scan.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-logo-2 AC-3. check(), buildReport() and the renderer are loaded inside the test body: the AC tests are
// written before the build, so nothing the build changes may run while the file loads.

/** The one fixed logo line, written here so the test does not reuse the renderer's own constant. */
const LOGO =
  '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';

/** U+1F6E1 U+FE0F, the brand mark, and U+00B7, the separator, as the SPEC writes them. */
const HEADING_PREFIX = "## \u{1F6E1}\u{FE0F} pharn-ci · ";

/** Image and URL markers no rendering may carry outside the logo line. */
const BANNED = ["<img", "![", "http://", "https://"];

const AGENTS: AgentSetupFile = { path: "AGENTS.md", kind: "agents-md" };

/** Diff coverage that meets a threshold of 80: one file, both added lines covered. */
const met: DiffCoverageResult = {
  percent: 100,
  threshold: 80,
  coveredLines: 2,
  coverableLines: 2,
  files: [{ path: "src/a.ts", percent: 100, coveredLines: 2, coverableLines: 2, uncoveredLines: [] }],
  meetsThreshold: true,
};

async function build(input: Partial<BuildReportInput>): Promise<Report> {
  const { buildReport } = await import("../src/report.js");
  const report = buildReport({
    version: "0.1.0",
    diffCoverage: met,
    threshold: 80,
    coverageFormat: "lcov",
    agentSetup: { files: [AGENTS] },
    ...input,
  });
  expectValidReport(report);
  return report;
}

interface Hostile {
  repoFiles: string[];
  coverageFile: string;
  baseRef: string;
}

/** Reports built by check() from the PR-controlled inputs of fixtures/render/hostile-paths.json. */
async function hostileReports(): Promise<Report[]> {
  const { check } = await import("../src/check.js");
  const hostile = JSON.parse(fixture("render/hostile-paths.json")) as Hostile;
  const reports = [
    // A missing coverage file whose path is hostile, with hostile tracked paths.
    check({
      version: "0.1.0",
      coverage: { missingFile: hostile.coverageFile },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: hostile.repoFiles,
    }),
    // An unavailable diff whose detail carries the hostile base ref.
    check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { unavailable: hostile.baseRef },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: [...fixture("golden/files.txt").trim().split("\n"), ...hostile.repoFiles],
    }),
  ];
  for (const report of reports) expectValidReport(report);
  return reports;
}

/**
 * The text with every code span removed. A backslash-escaped backtick starts no span; a backtick run with no closing
 * run of the same length is kept as text.
 */
function outsideCodeSpans(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === "\\") {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== "`") {
      out += ch;
      i++;
      continue;
    }
    let run = 0;
    while (text[i + run] === "`") run++;
    const fence = "`".repeat(run);
    let close = i + run;
    let found = -1;
    while (close < text.length) {
      const at = text.indexOf(fence, close);
      if (at === -1) break;
      if (text[at - 1] !== "`" && text[at + run] !== "`") {
        found = at;
        break;
      }
      close = at + 1;
    }
    if (found === -1) {
      out += fence;
      i += run;
    } else {
      i = found + run;
    }
  }
  return out;
}

/** The message lines of the Messages section: lines starting `- ` between its heading and the next heading. */
function messageLines(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => line.startsWith("### 💬 Messages ("));
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("#"));
  return lines.slice(start + 1, end === -1 ? lines.length : end).filter((line) => line.trimStart().startsWith("- "));
}

describe("renderMarkdown(): the logo line opens every rendering, and is the only image or URL", () => {
  it("AC-3: every rendering starts with the logo line, an empty line and the heading; nothing else carries an image or URL", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const pass = await build({});
    expect(pass.verdict).toBe("pass");
    expect(pass.messages).toHaveLength(0);

    const warn = await build({
      diffCoverage: { ...met, threshold: null, meetsThreshold: null },
      threshold: null,
      changedConfigPaths: [".pharn/ci.yml"],
    });
    expect(warn.verdict).toBe("warn");

    const noCoverage = await build({
      diffCoverage: null,
      missing: { reason: "coverage-file-missing", coverageFile: "coverage/lcov.info" },
    });
    expect(noCoverage.diffCoverage).toBeNull();

    const noSetup = await build({ agentSetup: { files: [] } });
    expect(noSetup.agentSetup.files).toHaveLength(0);

    const plain = [pass, warn, noCoverage, noSetup];
    const hostile = await hostileReports();

    for (const report of [...plain, ...hostile]) {
      const lines = renderMarkdown(report).split("\n");
      expect(lines[0], report.verdict).toBe(LOGO);
      expect(lines[1], report.verdict).toBe("");
      expect(lines[2]?.startsWith(HEADING_PREFIX), lines[2]).toBe(true);
    }

    // With the logo line removed, no plain rendering carries an image or URL.
    for (const report of plain) {
      const rest = renderMarkdown(report).split("\n").slice(1).join("\n");
      for (const banned of BANNED) {
        expect(rest, `${report.verdict}: ${banned}`).not.toContain(banned);
      }
    }

    // With the logo line removed, a hostile rendering has no <img outside a code span and no :// on a message line.
    for (const report of hostile) {
      const lines = renderMarkdown(report).split("\n").slice(1);
      expect(outsideCodeSpans(lines.join("\n"))).not.toContain("<img");
      const messages = messageLines(lines);
      expect(messages.length).toBeGreaterThan(0);
      for (const line of messages) {
        expect(line).not.toContain("://");
      }
    }
  });
});
