import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture, foldCoverageBar, foldIntegrityColumn } from "./helpers.js";
import { foldHintsToBase } from "./hints-at-base.js";
import { expectValidReport } from "./schema.js";

// pr-comment-verdict-callout AC-1. check(), the config parser and the renderer are loaded inside the test body: the AC
// tests are written before the build, so nothing the build changes may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

/**
 * sha256 of each golden markdown file as committed before this increment. The build regenerates the files, so the
 * test pins the earlier content by hash: folding the callout back into the bare overview line must give it back.
 * CORE-124 updated every hash on purpose: each is the same earlier file with the logo line's raw URL naming a commit
 * SHA instead of `main`, and nothing else changed.
 */
const BEFORE_SHA256 = {
  golden: "0d77ffaef143ab97ff456d78688a11f63308217ae20932f0e7b1f6deef3454dc",
  "golden-multi": "0d77ffaef143ab97ff456d78688a11f63308217ae20932f0e7b1f6deef3454dc",
  "golden-cobertura": "fa083a7379c04242b897aa038b2c99818aeaeda74117d01be7ff90f81295a0e0",
  "golden-exclusions": "ef238821e9357aa7fa96c678a67e5e44949c46d68bf54cb8a11357922ddf774f",
  "coverage-paths/package-relative": "d3f9d4874927a0b4a37309188e5fd73669bcffed1277a9fde9e4b74309a30c4c",
} as const;

type Golden = keyof typeof BEFORE_SHA256;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Remove the Test integrity section: its heading, an empty line, one fixed line and an empty line. */
function foldTestIntegrity(markdown: string): string {
  const parts = markdown.split("\n");
  const at = parts.indexOf("### 🔍 Test integrity");
  if (at === -1) throw new Error("foldTestIntegrity: no Test integrity heading");
  parts.splice(at, 4);
  return parts.join("\n");
}

const lines = (path: string) => fixture(path).trim().split("\n");

async function load() {
  const { check } = await import("./text-coverage.js");
  const { parseConfig } = await import("../src/config.js");
  const { renderMarkdown } = await import("../src/render/markdown.js");
  return { check, parseConfig, renderMarkdown };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** Each golden's report, built from its inputs exactly as the test that writes that golden builds it. */
function goldenReport({ check, parseConfig }: Loaded, golden: Golden) {
  const base = { version: "0.1.0", repoRoot: REPO_ROOT, threshold: 80 };
  switch (golden) {
    case "golden":
      return check({
        ...base,
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden/pr.diff") },
        repoFiles: lines("golden/files.txt"),
      });
    case "golden-multi":
      return check({
        ...base,
        coverage: {
          files: [
            { text: fixture("golden-multi/coverage-a.info"), file: "coverage/a/lcov.info" },
            { text: fixture("golden-multi/coverage-b.info"), file: "coverage/b/lcov.info" },
          ],
          format: "auto",
        },
        diff: { text: fixture("golden-multi/pr.diff") },
        repoFiles: lines("golden-multi/files.txt"),
      });
    case "golden-cobertura":
      return check({
        ...base,
        coverage: { text: fixture("golden-cobertura/coverage.xml"), format: "auto" },
        diff: { text: fixture("golden-cobertura/pr.diff") },
        repoFiles: lines("golden-cobertura/files.txt"),
      });
    case "golden-exclusions": {
      const config = parseConfig(fixture("golden-exclusions/ci.yml")) as {
        coverage?: { exclude?: string[]; threshold?: number };
      };
      return check({
        ...base,
        coverage: { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden-exclusions/pr.diff") },
        threshold: config.coverage?.threshold ?? null,
        repoFiles: lines("golden-exclusions/files.txt"),
        exclude: config.coverage?.exclude ?? [],
      });
    }
    case "coverage-paths/package-relative":
      return check({
        ...base,
        coverage: { text: fixture("coverage-paths/package-relative/coverage.info"), format: "lcov" },
        diff: { text: fixture("coverage-paths/package-relative/pr.diff") },
        repoFiles: lines("coverage-paths/package-relative/files.txt"),
      });
  }
}

/** The verdict each golden heading shows, and the callout lines that go with it. */
const EXPECTED: Record<Golden, { heading: string; marker: string; prefix: string }> = {
  golden: { heading: "❌ Fail", marker: "> [!CAUTION]", prefix: "> **Fail** · " },
  "golden-multi": { heading: "❌ Fail", marker: "> [!CAUTION]", prefix: "> **Fail** · " },
  "golden-cobertura": { heading: "❌ Fail", marker: "> [!CAUTION]", prefix: "> **Fail** · " },
  "golden-exclusions": { heading: "✅ Pass", marker: "> [!TIP]", prefix: "> **Pass** · " },
  "coverage-paths/package-relative": { heading: "❌ Fail", marker: "> [!CAUTION]", prefix: "> **Fail** · " },
};

describe("renderMarkdown(): the golden renderings gain the verdict callout and nothing else", () => {
  it("AC-1: each golden rendering is the committed file with its overview line replaced by the two callout lines", async () => {
    const loaded = await load();

    for (const golden of Object.keys(BEFORE_SHA256) as Golden[]) {
      const report = goldenReport(loaded, golden);
      expectValidReport(report);
      const { heading, marker, prefix } = EXPECTED[golden];

      // test-integrity-mode added the "🔍 Test integrity" section on purpose: its four lines are folded out first.
      // The comment-layout change added the summary table's Test integrity column on purpose: it is folded out too.
      // The comment-coverage-bar change added the diff-coverage bar line on purpose: it is folded out too. The
      // package-relative golden's diff coverage is not computed, so it has no bar.
      const markdown = loaded.renderMarkdown(report);
      const unbarred = golden === "coverage-paths/package-relative" ? markdown : foldCoverageBar(markdown);
      // CORE-140 made each hint its code's fix.hint on purpose: the hint lines are folded back too.
      const rendered = foldHintsToBase(foldTestIntegrity(foldIntegrityColumn(unbarred))).split("\n");
      expect(rendered[2]?.endsWith(heading), `${golden}: heading ${rendered[2]}`).toBe(true);
      expect(rendered[4], `${golden}: the alert marker on line 5`).toBe(marker);
      const content = rendered[5] ?? "";
      expect(content.startsWith(prefix), `${golden}: line 6 ${content}`).toBe(true);
      const sentence = content.slice(prefix.length);
      expect(sentence.length, `${golden}: the overview sentence`).toBeGreaterThan(0);

      // Fold the two callout lines back into the bare overview sentence: the result is the file as committed before.
      // Report v2 (report-v2-skeleton) changed the footer's schema version on purpose; map it back before the hash.
      const folded = [...rendered.slice(0, 4), sentence, ...rendered.slice(6)].join("\n");
      expect(folded, `${golden}: footer names report schema v2`).toContain("· report schema v2");
      const foldedV1 = folded.replace("· report schema v2", "· report schema v1");
      expect(sha256(foldedV1), `${golden}: folded rendering equals the committed file before`).toBe(
        BEFORE_SHA256[golden],
      );
    }
  });
});
