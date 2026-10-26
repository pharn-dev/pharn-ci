import { describe, expect, it } from "vitest";
import { messagesOf, runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { fixture } from "./helpers.js";

// check() is loaded inside the test body (through runDiff): the AC test is written before TI11 reads retired jobs, and
// the fixture it reads is written by the build, so nothing the build adds may run while the file loads.

const CI = ".github/workflows/ci.yml";
const FIXTURE = "test-integrity/TI11/warn-job-retired-tests-moved.diff";
const RETIRED =
  "A job that ran tests was removed from a workflow together with the script it ran, while this change moves test files; check that another workflow runs them.";
const j = (...parts: string[]) => parts.join("");
const OTHER_IDS = [j("TI", "08"), j("TI", "15"), j("TI", "16")];

/** Every removed line of a unified diff, with its old-file path and old-file line number. */
function removedLines(diff: string): Array<{ path: string; line: number; text: string }> {
  const out: Array<{ path: string; line: number; text: string }> = [];
  let path = "";
  let old = 0;
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      inHunk = false;
      path = "";
      continue;
    }
    if (!inHunk) {
      if (raw.startsWith("--- a/")) path = raw.slice("--- a/".length);
      const start = /^@@ -(\d+)/.exec(raw);
      if (start) {
        old = Number(start[1]);
        inHunk = true;
      }
      continue;
    }
    const start = /^@@ -(\d+)/.exec(raw);
    if (start) {
      old = Number(start[1]);
    } else if (raw.startsWith("-")) {
      out.push({ path, line: old, text: raw.slice(1) });
      old++;
    } else if (raw.startsWith(" ")) {
      old++;
    }
  }
  return out;
}

type Report = Awaited<ReturnType<typeof runDiff>>;
const ti11 = (report: Report) =>
  signalsOf(report, "TI11").map((s) => ({
    id: String(s.id),
    severity: s.severity,
    path: s.path,
    line: s.line,
    detail: s.detail,
  }));

describe("TI11: a test job retired together with its script while its tests move", () => {
  it("AC-2: the retired-job fixture gives one warn TI11 with the retired-job sentence at the first removed test command in modes block and warn, a warn verdict and a warn TEST_INTEGRITY_TI11 message, nothing in mode off, and no TI08, TI15 or TI16", async () => {
    const text = fixture(FIXTURE);

    // The fixture holds the case: the jobs lambda and lambda-edge removed whole from ci.yml, their scripts removed from
    // package.json, and a test file renamed to another test-file path.
    expect(text).toContain(`diff --git a/${CI} b/${CI}`);
    expect(text, "the lambda job header is removed").toMatch(/^-\s+lambda:\s*$/m);
    expect(text, "the lambda-edge job header is removed").toMatch(/^-\s+lambda-edge:\s*$/m);
    expect(text, "a removed job holds runs-on").toMatch(/^-\s+runs-on:/m);
    expect(text, "the test:lambda script is removed").toMatch(/^-\s*"test:lambda"\s*:/m);
    expect(text, "the test:lambda-edge script is removed").toMatch(/^-\s*"test:lambda-edge"\s*:/m);
    expect(text, "a test file is renamed from").toMatch(/^rename from \S*(?:test|spec)\S*$/m);
    expect(text, "to a test file").toMatch(/^rename to \S*(?:test|spec)\S*$/m);
    const first = removedLines(text).find(
      (r) => r.path === CI && /\b(?:npm|pnpm|yarn|bun)\b.*\btest:lambda/.test(r.text),
    );
    expect(first, "the first removed test command of ci.yml").toBeDefined();
    const line = (first as { line: number }).line;

    for (const mode of ["block", "warn"] as const) {
      const report = await runDiff(text, mode);
      expect(ti11(report), `mode ${mode}`).toEqual([{ id: "TI11", severity: "warn", path: CI, line, detail: RETIRED }]);
      expect(report.testIntegrity.verdict, `mode ${mode}: the verdict`).toBe("warn");
      const messages = messagesOf(report, "TEST_INTEGRITY_TI11");
      expect(messages, `mode ${mode}: one TEST_INTEGRITY_TI11 message`).toHaveLength(1);
      expect(messages[0]?.level, `mode ${mode}: the message level`).toBe("warn");
      if (mode === "block") {
        for (const id of OTHER_IDS) expect(signalsOf(report, id), `mode block: no ${id}`).toEqual([]);
      }
    }

    const off = await runDiff(text, "off");
    expect(ti11(off), "mode off").toEqual([]);
  });
});
