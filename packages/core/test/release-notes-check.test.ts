import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// scripts/check-release-notes.mjs is the CHANGELOG gate of .github/workflows/release.yml (`Release verify`). It runs
// here exactly as the workflow runs it: `node scripts/check-release-notes.mjs <version> <changelog>`, on the
// changelogs in fixtures/release/.

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const check = (version: string, fixture: string) => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-release-notes.mjs", version, `fixtures/release/${fixture}`],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
};

describe("scripts/check-release-notes.mjs", () => {
  it("is what release.yml runs, with the version from an env var, before install", () => {
    const workflow = read(".github/workflows/release.yml");
    const call = workflow.indexOf('node scripts/check-release-notes.mjs "$VERSION" CHANGELOG.md');
    expect(call, "release.yml runs the check").toBeGreaterThan(-1);
    expect(call, "the check runs before pnpm install").toBeLessThan(workflow.indexOf("pnpm install"));
    expect(workflow, "the extracted notes are checked for the placeholder").toContain(
      `grep -q 'YYYY-MM-DD' "$RUNNER_TEMP/notes/notes.md"`,
    );
    expect(workflow, "the extracted notes are checked for the maintainer instruction").toContain(
      "grep -qi 'the maintainer replaces'",
    );
  });

  it("accepts a dated heading whose notes carry no placeholder (later sections are not its notes)", () => {
    const { status, out } = check("0.1.0", "dated.md");
    expect(out).toContain("ok");
    expect(status).toBe(0);
  });

  it("rejects the YYYY-MM-DD placeholder in the heading", () => {
    const { status, out } = check("0.1.0", "placeholder-heading.md");
    expect(status).toBe(1);
    expect(out).toContain("::error::");
    expect(out).toContain("must be exactly '## [0.1.0] - <release date as YYYY-MM-DD>'");
  });

  it("rejects the YYYY-MM-DD placeholder in the release notes under a dated heading", () => {
    const { status, out } = check("0.1.0", "placeholder-in-notes.md");
    expect(status).toBe(1);
    expect(out).toContain("::error::the '## [0.1.0]' release notes still contain the YYYY-MM-DD placeholder");
  });

  it("rejects the maintainer instruction sentence, even across a line break", () => {
    const { status, out } = check("0.1.0", "instruction.md");
    expect(status).toBe(1);
    expect(out).toContain("still contain the maintainer instruction");
    expect(out).not.toContain("YYYY-MM-DD placeholder");
  });

  it("rejects the shape of the repo's own pre-release CHANGELOG (placeholder heading and instruction)", () => {
    const changelog = read("CHANGELOG.md");
    const atHead = changelog.includes("## [0.1.0] - YYYY-MM-DD");
    if (!atHead) return; // 0.1.0 has been dated; the fixtures above still cover the gate.
    const result = spawnSync(process.execPath, ["scripts/check-release-notes.mjs", "0.1.0", "CHANGELOG.md"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("must be exactly");
    expect(result.stdout).toContain("YYYY-MM-DD placeholder");
    expect(result.stdout).toContain("maintainer instruction");
  });

  it("rejects a date that is not a calendar date, and text after the date", () => {
    expect(check("0.1.0", "invalid-date.md").out).toContain("is not a calendar date");
    expect(check("0.1.0", "invalid-date.md").status).toBe(1);
    expect(check("0.1.0", "trailing-text.md").out).toContain("must be exactly");
    expect(check("0.1.0", "trailing-text.md").status).toBe(1);
  });

  it("rejects a version with no section, two headings for one version, and a version that is not X.Y.Z", () => {
    const wrong = check("0.2.0", "dated.md");
    expect(wrong.status).toBe(1);
    expect(wrong.out).toContain("has no '## [0.2.0] - <date>' section");

    const prefixOnly = check("0.1", "dated.md");
    expect(prefixOnly.status).toBe(1);
    expect(prefixOnly.out).toContain('version "0.1" is not X.Y.Z');

    const duplicate = check("0.1.0", "duplicate.md");
    expect(duplicate.status).toBe(1);
    expect(duplicate.out).toContain("has 2 '## [0.1.0]' headings");
  });
});
