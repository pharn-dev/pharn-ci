import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// check() and renderMarkdown() are loaded inside the test body: the AC tests are written before the accept label
// exists, so nothing the build adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";
const IDS = ["TI01", "TI03", "TI04", "TI10", "TI11", "TI13", "TI14"] as const;
const NAMING = ["TI03", "TI10", "TI13"] as const;
const CUSTOM = "team/tests-ok";
const HOSTILE = "a`b <!-- @x |";

/** The TI01, TI04, TI11 and TI14 hints as renderMarkdown() gave them at the base commit a1089fd. */
const UNCHANGED: Record<string, string> = {
  TI01: "  - Hint: Restore the deleted tests, or say in the PR why they go so a reviewer can confirm it.",
  TI04: "  - Hint: Remove the marker so the whole suite runs, or say in the PR why only the marked tests should run.",
  TI11: "  - Hint: Restore the test step or trigger, or say in the PR why CI stops running these tests so a reviewer can confirm it.",
  TI14: "  - Hint: Restore the threshold or the exclusions, or say in the PR why they change so a reviewer can confirm it.",
};

/** The words the existing render tests look for in each hint. */
const KEPT_WORDS: Record<string, RegExp[]> = {
  TI03: [/review/i, /skip/i, /fail/i, /\bCI\b/, /accept/i, /label/i],
  TI10: [/accept label/i, /review/i, /sign-?off/i],
  TI13: [/accept label/i, /review/i, /sign-?off/i],
};

/** A report with one block signal and one error message for each of the seven ids, and `acceptLabel` when given. */
async function reportWith(acceptLabel: string | undefined) {
  const { check } = await import("@pharn-ci/core");
  const base = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  const signals = IDS.map((id, i) => ({
    id,
    severity: "block",
    path: `src/f${i}.test.ts`,
    line: i + 1,
    detail: `detail-${id}`,
  }));
  const messages = IDS.map((id) => ({ level: "error", code: `TEST_INTEGRITY_${id}`, text: `text-${id}` }));
  return {
    ...base,
    verdict: "fail",
    messages: [...base.messages, ...messages],
    testIntegrity: {
      ...base.testIntegrity,
      verdict: "fail",
      signals,
      ...(acceptLabel === undefined ? {} : { acceptLabel }),
    },
  } as unknown as typeof base;
}

/** The lines of the Test integrity section: from its heading to the line before the next `### ` heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error("no Test integrity heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [HEADING, ...(end === -1 ? rest : rest.slice(0, end))];
}

/** The hint line under the finding of `id` and the one under its message code. */
function hintsOf(markdown: string, id: string): string[] {
  const lines = section(markdown);
  const finding = lines.findIndex((line) => line.includes(`**${id}**`));
  const all = markdown.split("\n");
  const message = all.findIndex((line) => line.includes(`\`TEST_INTEGRITY_${id}\``));
  expect(finding, `finding ${id}`).toBeGreaterThan(-1);
  expect(message, `message ${id}`).toBeGreaterThan(-1);
  const hints = [lines[finding + 1] ?? "", all[message + 1] ?? ""];
  for (const hint of hints) expect(hint.startsWith("  - Hint: "), `hint ${id}`).toBe(true);
  return hints;
}

/** True when `label` occurs once in `line`, as the whole content of one CommonMark code span. */
function inOneCodeSpan(line: string, label: string): boolean {
  const at = line.indexOf(label);
  if (at === -1 || line.indexOf(label, at + 1) !== -1) return false;
  const open = /(`+)( ?)$/.exec(line.slice(0, at));
  const close = /^( ?)(`+)/.exec(line.slice(at + label.length));
  if (open === null || close === null) return false;
  const fence = open[1] as string;
  if (fence !== close[2] || open[2] !== close[1]) return false;
  // A backtick run inside of the fence's own length would close the span early.
  return (label.match(/`+/g) ?? []).every((run) => run.length !== fence.length);
}

describe("the TI03, TI10 and TI13 hints name the accept label", () => {
  it("AC-9: the hints name the configured label, or pharn/accepted, keep their words, and hostile labels stay in one code span", async () => {
    const { renderMarkdown } = await import("@pharn-ci/core");
    const custom = renderMarkdown(await reportWith(CUSTOM));
    const plain = renderMarkdown(await reportWith(undefined));

    for (const id of NAMING) {
      for (const hint of hintsOf(custom, id)) {
        expect(hint, id).toContain(`\`${CUSTOM}\``);
        expect(hint, id).not.toContain("pharn/accepted");
      }
      for (const hint of hintsOf(plain, id)) expect(hint, id).toContain("`pharn/accepted`");
      for (const hint of [...hintsOf(custom, id), ...hintsOf(plain, id)]) {
        expect(hint, id).toMatch(/not the PR author/i);
        expect(hint, id).not.toMatch(/ships/i);
        expect(hint, id).not.toContain("accept-label");
        for (const word of KEPT_WORDS[id] ?? []) expect(hint, `${id} ${word}`).toMatch(word);
      }
    }

    // A label holding a backtick, an HTML comment opener, an at-mention and a pipe: every line holding it is one
    // line with the label inside a single code span.
    const hostile = renderMarkdown(await reportWith(HOSTILE));
    const holding = hostile.split("\n").filter((line) => line.includes("a`b"));
    expect(holding.length).toBeGreaterThanOrEqual(NAMING.length * 2);
    for (const line of holding) expect(inOneCodeSpan(line, HOSTILE), line).toBe(true);
    for (const id of NAMING)
      for (const hint of hintsOf(hostile, id)) expect(inOneCodeSpan(hint, HOSTILE), id).toBe(true);

    // The TI01, TI04, TI11 and TI14 hints are the text they were, with no accept label.
    for (const markdown of [custom, plain, hostile]) {
      for (const [id, text] of Object.entries(UNCHANGED)) {
        expect(hintsOf(markdown, id), id).toEqual([text, text]);
        expect(text).not.toMatch(/accept/i);
      }
    }
  });
});
