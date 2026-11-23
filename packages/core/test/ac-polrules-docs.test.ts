import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// E3 item 22 (policy rules), AC-18. Reads the repository's sources as text; nothing the build adds is loaded.
// (CORE-133: the README, LIMITS and CHANGELOG wording checks moved out; docs-contract.test.ts checks the README code
// rows. CORE-132: the comparison of the schema's code description with an old commit, and the check that each re-pinned
// test names this item, were history pins and are removed; report-v2-compat.test.ts checks every released code.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("sources for the policy rules", { timeout: 60_000 }, () => {
  it("AC-18: report.ts and the hints name the two codes", () => {
    // report.ts MessageCode and the renderer's hints.
    const report = read("packages/core/src/report.ts");
    const messageCode = /export type MessageCode =([\s\S]*?);/.exec(report)?.[1] ?? "";
    expect(messageCode).toContain('"POLICY_P08"');
    expect(messageCode).toContain('"POLICY_P09"');
    const markdown = read("packages/core/src/render/markdown.ts");
    expect(markdown).toContain("MESSAGE_HINTS");
    expect(markdown).toMatch(/^\s*POLICY_P08:\s*["'`]Stop tracking the file /m);
    expect(markdown).toMatch(/^\s*POLICY_P09:\s*["'`]Revert the edit, or ask the policy owner to make it/m);
  });
});
