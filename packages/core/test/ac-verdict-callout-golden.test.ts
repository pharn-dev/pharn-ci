import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// pr-comment-verdict-callout AC-1. check(), the config parser and the renderer are loaded inside the test body: the AC
// tests are written before the build, so nothing the build changes may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

/**
 * sha256 of each golden markdown file as committed before this increment. The build regenerates the files, so the
 * test pins the earlier content by hash: folding the callout back into the bare overview line must give it back.
 */
const BEFORE_SHA256 = {
  golden: "d0b78ab8646489dcc38cbe54790eb29d599a318cb1888a46e23648579ffee184",
  "golden-multi": "d0b78ab8646489dcc38cbe54790eb29d599a318cb1888a46e23648579ffee184",
  "golden-cobertura": "457bad3073d1f78261cdc0e5f5511fc4c63fe903f6a3056f49a1c9ec04da9bd7",
  "golden-exclusions": "d470c10cfb7ca3d50ba370fccae4176615db8036f96168cc5c61063925562ce7",
  "coverage-paths/package-relative": "4c6c42ea20d6b16186891978429e1bb5d7775d135787c8e9fe0af8e83e616224",
} as const;

type Golden = keyof typeof BEFORE_SHA256;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const lines = (path: string) => fixture(path).trim().split("\n");

async function load() {
  const { check } = await import("../src/check.js");
  const { parseConfig } = await import("../src/config.js");
  const { renderMarkdown } = await import("../src/render/markdown.js");
  return { check, parseConfig, renderMarkdown };
}

type Loaded = Awaited<ReturnType<typeof load>>;
type Input = Parameters<Loaded["check"]>[0];

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
      } as Input);
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
      } as Input);
    case "golden-cobertura":
      return check({
        ...base,
        coverage: { text: fixture("golden-cobertura/coverage.xml"), format: "auto" },
        diff: { text: fixture("golden-cobertura/pr.diff") },
        repoFiles: lines("golden-cobertura/files.txt"),
      } as Input);
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
      } as Input);
    }
    case "coverage-paths/package-relative":
      return check({
        ...base,
        coverage: { text: fixture("coverage-paths/package-relative/coverage.info"), format: "lcov" },
        diff: { text: fixture("coverage-paths/package-relative/pr.diff") },
        repoFiles: lines("coverage-paths/package-relative/files.txt"),
      } as Input);
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

      const rendered = loaded.renderMarkdown(report).split("\n");
      expect(rendered[2]?.endsWith(heading), `${golden}: heading ${rendered[2]}`).toBe(true);
      expect(rendered[4], `${golden}: the alert marker on line 5`).toBe(marker);
      const content = rendered[5] ?? "";
      expect(content.startsWith(prefix), `${golden}: line 6 ${content}`).toBe(true);
      const sentence = content.slice(prefix.length);
      expect(sentence.length, `${golden}: the overview sentence`).toBeGreaterThan(0);

      // Fold the two callout lines back into the bare overview sentence: the result is the file as committed before.
      const folded = [...rendered.slice(0, 4), sentence, ...rendered.slice(6)].join("\n");
      expect(sha256(folded), `${golden}: folded rendering equals the committed file before`).toBe(
        BEFORE_SHA256[golden],
      );
    }
  });
});
