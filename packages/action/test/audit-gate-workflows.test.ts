import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Production dependencies are bundled into packages/action/dist and run in every consumer's workflow, so CI and the
// release job both fail on a moderate, high or critical advisory in one (review HIGH 6). This keeps the step from being dropped
// or moved before the install it needs.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const AUDIT = "- run: pnpm audit --prod --audit-level=moderate";
const INSTALL = "- run: pnpm install --frozen-lockfile";

function stepLines(workflow: string): string[] {
  const text = readFileSync(join(ROOT, ".github/workflows", workflow), "utf8");
  return text.split("\n").map((line) => line.trim());
}

describe("pnpm audit gate in the workflows", () => {
  it.each([
    ["ci.yml", "- run: pnpm lint"],
    ["release.yml", "- run: pnpm build"],
  ])("%s runs the production audit once, after install and before %s", (workflow, later) => {
    const lines = stepLines(workflow);
    const audits = lines.filter((line) => line === AUDIT);
    expect(audits).toHaveLength(1);
    const audit = lines.indexOf(AUDIT);
    const install = lines.indexOf(INSTALL);
    expect(install).toBeGreaterThanOrEqual(0);
    expect(audit).toBeGreaterThan(install);
    expect(audit).toBeLessThan(lines.indexOf(later));
  });
});
