import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// The fixtures and the core functions are loaded inside the test body: fixtures/golden-exclusions/ and the
// exclusion support do not exist before the build, and a read at load time would fail the whole file.

describe("golden: fixture diff + lcov + exclusions -> Report v2", () => {
  it("AC-17: excludes the fixture's generated files and matches the golden JSON and markdown", async () => {
    const { check } = await import("../src/check.js");
    const { parseConfig } = await import("../src/config.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const { matchGlob } = (await import("../src/index.js")) as unknown as {
      matchGlob: (pattern: string, path: string) => boolean;
    };

    const config = parseConfig(fixture("golden-exclusions/ci.yml")) as {
      coverage?: { exclude?: string[]; threshold?: number };
    };
    const exclude = config.coverage?.exclude ?? [];
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden-exclusions/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: config.coverage?.threshold ?? null,
      repoFiles: fixture("golden-exclusions/files.txt").trim().split("\n"),
      exclude,
    } as Parameters<typeof check>[0]);

    // Asserted before the snapshots, so a wrong report fails here instead of being written as a new snapshot.
    expectValidReport(report);
    const excluded = ["schema.gen.ts", "src/generated/api.ts"];
    const dc = report.diffCoverage as ({ excludedFiles?: string[] } & NonNullable<typeof report.diffCoverage>) | null;
    expect(dc?.excludedFiles).toEqual(excluded);
    const kept = dc?.files.map((f) => f.path) ?? [];
    for (const path of excluded) expect(kept).not.toContain(path);
    expect(kept).toEqual(["src/app.ts", "src/util.ts"]);
    expect(dc).toMatchObject({ percent: 80, threshold: 80, coveredLines: 4, coverableLines: 5 });
    expect(report.verdict).toBe("pass");
    expect(report.messages).toEqual([]);

    // One excluded file is matched through a ** pattern, the other through a * pattern.
    const globstar = exclude.filter((p) => p.includes("**"));
    const star = exclude.filter((p) => !p.includes("**") && p.includes("*"));
    expect(globstar.some((p) => matchGlob(p, "src/generated/api.ts"))).toBe(true);
    expect(star.some((p) => matchGlob(p, "schema.gen.ts"))).toBe(true);

    const md = renderMarkdown(report);
    expect(md).toContain(
      [
        "<details><summary>Excluded: 2 files</summary>",
        "",
        "- `schema.gen.ts`",
        "- `src/generated/api.ts`",
        "",
        "</details>",
      ].join("\n"),
    );
    expect(md).toContain("**80%** of changed lines covered (4/5, threshold 80%)");
    expect(md).not.toContain("old.ts");

    await expect(`${JSON.stringify(report, null, 2)}\n`).toMatchFileSnapshot(
      "../../../fixtures/golden-exclusions/report.json",
    );
    await expect(md).toMatchFileSnapshot("../../../fixtures/golden-exclusions/report.md");
  });
});
