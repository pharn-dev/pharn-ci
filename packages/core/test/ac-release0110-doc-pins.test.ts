import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// release-0110: every place outside README.md that names the current release says v0.11.0: the Marketplace quick start,
// SECURITY.md, the five example workflows, the bug-report template's placeholder and the "latest release" line of
// docs/LIMITS.md and docs/THREAT-MODEL.md. Files are read inside the test body.
// CORE-127: the five example workflows pin the v0.11.0 tag's full commit SHA with a `# v0.11.0` comment, like every
// other action in them, instead of the tag name.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const PINNED = ["docs/MARKETPLACE.md", "SECURITY.md", ".github/ISSUE_TEMPLATE/bug_report.yml"];

const EXAMPLES = [
  "examples/workflows/cargo.yml",
  "examples/workflows/dotnet.yml",
  "examples/workflows/jest.yml",
  "examples/workflows/pytest.yml",
  "examples/workflows/vitest.yml",
];

/** The commit the v0.11.0 tag points at (`git rev-list -n1 v0.11.0`). */
const V0110_SHA = "bd7b36ea07588884418f5002ae74afc35135c400";

describe("release-0110: release pins outside the README", () => {
  it("AC-6: MARKETPLACE, SECURITY and the bug-report template pin only pharn-dev/pharn-ci@v0.11.0, the five example workflows pin only the v0.11.0 commit SHA with a # v0.11.0 comment, and LIMITS and THREAT-MODEL name v0.11.0 as the latest release", () => {
    for (const path of PINNED) {
      const refs = [...read(path).matchAll(/pharn-dev\/pharn-ci@([^\s`'"),]+)/g)].map((match) => match[1]);
      expect(refs.length, `${path} names pharn-dev/pharn-ci@<tag>`).toBeGreaterThan(0);
      expect(new Set(refs), `${path} pins v0.11.0 only`).toEqual(new Set(["v0.11.0"]));
    }
    for (const path of EXAMPLES) {
      const pins = [...read(path).matchAll(/pharn-dev\/pharn-ci@([^\s`'"),]+)(.*)$/gm)];
      expect(pins.length, `${path} names pharn-dev/pharn-ci@<sha>`).toBeGreaterThan(0);
      for (const [, ref, rest] of pins) {
        expect(ref, `${path} pins the v0.11.0 commit SHA`).toBe(V0110_SHA);
        expect(rest, `${path} names v0.11.0 after the SHA`).toBe(" # v0.11.0");
      }
    }
    for (const path of ["docs/LIMITS.md", "docs/THREAT-MODEL.md"]) {
      const mentions = read(path)
        .split("\n")
        .flatMap((line) => (line.match(/latest release/gi) ?? []).map(() => line));
      expect(mentions, `${path} has exactly one "latest release" mention`).toHaveLength(1);
      expect(mentions[0], `${path}'s latest release is v0.11.0`).toMatch(/latest release: `v0\.11\.0`/);
    }
  });
});
