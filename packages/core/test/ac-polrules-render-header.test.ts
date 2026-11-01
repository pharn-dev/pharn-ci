import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-15. check() and renderMarkdown() are loaded inside the test body and
// fixtures/policy-rules/ is read there too: the AC test is written before the build adds the Policy section and the
// fixtures, so nothing the build adds may run while this file loads. The reports use the golden inputs, so the
// comment has a Test integrity section and a Messages section around the Policy section.

type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[] };

interface Core {
  check(input: unknown): Report;
  renderMarkdown(report: Report, options?: { maxRows?: number }): string;
}

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 📜 Policy";

/** The lines of the Policy section, from its heading to the next `### ` heading (exclusive). */
function policySection(md: string): string[] {
  const lines = md.split("\n");
  const at = lines.indexOf(HEADING);
  expect(at, "the Policy heading").toBeGreaterThanOrEqual(0);
  expect(lines.indexOf(HEADING, at + 1), "one Policy heading").toBe(-1);
  const next = lines.findIndex((l, i) => i > at && l.startsWith("### "));
  return lines.slice(at, next === -1 ? undefined : next);
}

/** The Policy section sits after Test integrity and before Messages. */
function expectPlacement(md: string): void {
  const lines = md.split("\n");
  const integrity = lines.indexOf("### 🔍 Test integrity");
  const policy = lines.indexOf(HEADING);
  const messages = lines.findIndex((l) => l.startsWith("### 💬 Messages"));
  expect(integrity).toBeGreaterThanOrEqual(0);
  expect(policy).toBeGreaterThan(integrity);
  expect(messages).toBeGreaterThan(policy);
}

describe("the Policy section header", { timeout: 60_000 }, () => {
  it("AC-15: app v12, file, unavailable (timeout) and a hand-built source-none policy render their header lines, between Test integrity and Messages", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const run = (policy?: unknown) => {
      const report = core.check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden/pr.diff") },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: fixture("golden/files.txt").trim().split("\n"),
        ...(policy === undefined ? {} : { policy }),
      });
      expectValidReport(report);
      return report;
    };

    const app = core.renderMarkdown(
      run({ source: "app", version: 12, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } }),
    );
    expect(policySection(app).slice(0, 3)).toEqual([HEADING, "", "Org policy v12"]);
    expectPlacement(app);

    const file = core.renderMarkdown(
      run({ source: "file", version: null, path: "policy/org.json", document: { version: 1 } }),
    );
    expect(policySection(file).slice(0, 3)).toEqual([
      HEADING,
      "",
      "Policy file — the pull request can edit this file, so it can only tighten the check",
    ]);
    expect(policySection(file).join("\n")).not.toContain("policy/org.json");
    expectPlacement(file);

    const resolved = JSON.parse(fixture("policy-rules/p10-violates/resolved.json"));
    const timedOut = run({ ...resolved, unavailable: { reason: "timeout", required: false } });
    const unavailable = timedOut.messages.find((m) => m.code === "POLICY_UNAVAILABLE");
    expect(unavailable).toBeDefined();
    const unavailableMd = core.renderMarkdown(timedOut);
    const section = policySection(unavailableMd);
    expect(section.slice(0, 4)).toEqual([HEADING, "", "Org policy unavailable (timeout)", ""]);
    // The POLICY_UNAVAILABLE text, on one line, through the renderer's inline escaping.
    const textLine = section[4] ?? "";
    expect(textLine.replace(/\\/g, "")).toBe((unavailable?.text ?? "").replace(/\\/g, ""));
    expectPlacement(unavailableMd);

    const plain = run();
    const handBuilt = { ...plain, policy: { source: "none", version: null, violations: [] } };
    expectValidReport(handBuilt);
    const noneMd = core.renderMarkdown(handBuilt);
    expect(policySection(noneMd).slice(0, 3)).toEqual([HEADING, "", "No org policy"]);
    expectPlacement(noneMd);
  });
});
