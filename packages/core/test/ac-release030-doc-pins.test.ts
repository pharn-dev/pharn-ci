import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// release-030: every place outside README.md that names the current release says v0.3.0: the Marketplace quick start,
// SECURITY.md, the five example workflows, the bug-report template's placeholder and the "latest release" line of
// docs/LIMITS.md and docs/THREAT-MODEL.md. Files are read inside the test body.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const PINNED = [
  "docs/MARKETPLACE.md",
  "SECURITY.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  "examples/workflows/cargo.yml",
  "examples/workflows/dotnet.yml",
  "examples/workflows/jest.yml",
  "examples/workflows/pytest.yml",
  "examples/workflows/vitest.yml",
];

describe("release-030: release pins outside the README", () => {
  it("AC-6: MARKETPLACE, SECURITY, the bug-report template and the five example workflows pin only pharn-dev/pharn-ci@v0.3.0, and LIMITS and THREAT-MODEL name v0.3.0 as the latest release", () => {
    for (const path of PINNED) {
      const refs = [...read(path).matchAll(/pharn-dev\/pharn-ci@([^\s`'"),]+)/g)].map((match) => match[1]);
      expect(refs.length, `${path} names pharn-dev/pharn-ci@<tag>`).toBeGreaterThan(0);
      expect(new Set(refs), `${path} pins v0.3.0 only`).toEqual(new Set(["v0.3.0"]));
    }
    for (const path of ["docs/LIMITS.md", "docs/THREAT-MODEL.md"]) {
      const mentions = read(path)
        .split("\n")
        .flatMap((line) => (line.match(/latest release/gi) ?? []).map(() => line));
      expect(mentions, `${path} has exactly one "latest release" mention`).toHaveLength(1);
      expect(mentions[0], `${path}'s latest release is v0.3.0`).toMatch(/latest release: `v0\.3\.0`/);
    }
  });
});
