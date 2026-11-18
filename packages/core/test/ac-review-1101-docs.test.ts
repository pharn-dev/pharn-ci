import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Pins for the 2026-11-01 review that are not document wording. (CORE-133: the README, SECURITY, THREAT-MODEL,
// LIMITS, action.yml description, MARKETPLACE and AGENTS.md wording checks moved out.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

describe("the release workflow says what the review found (review 2026-11-01)", () => {
  it("Release verify refuses a HEAD that is not the release merge commit", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain('SUBJECT="$(git log -1 --format=%s)"');
    expect(release).toContain("^chore:\\ release\\ ");
  });
});
