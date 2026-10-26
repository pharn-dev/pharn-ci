import { describe, expect, it } from "vitest";
import { messagesOf, runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { fixture } from "./helpers.js";

// check() is loaded inside the test body (through runDiff). A test job removed from a workflow stays a block even when
// the same change removes the script it ran and renames test files (hono 5466: the jobs moved to another workflow).
// The diff cannot show that another workflow runs the moved tests, and nothing the pull request carries may loosen a
// gate: a tampering change could do exactly these three things. The accept label is the way through for a real move.

const CI = ".github/workflows/ci.yml";
const FIXTURE = "test-integrity/TI11/block-job-moved-with-tests.diff";
const TEST_STEP = "A step that runs tests was removed from a workflow.";
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

function hunk(start: number, removed: string[], added: string[]): string[] {
  const oldPart = removed.length === 0 ? `${start - 1},0` : `${start},${removed.length}`;
  const newPart = added.length === 0 ? `${start - 1},0` : `${start},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

/** A modified file with these `[old start, removed lines, added lines]` hunks. */
function edit(path: string, hunks: Array<[number, string[], string[]]>): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap(([start, removed, added]) => hunk(start, removed, added))].join("\n")}\n`;
}

function renameOnly(from: string, to: string): string {
  return `${[`diff --git a/${from} b/${to}`, "similarity index 100%", `rename from ${from}`, `rename to ${to}`].join(
    "\n",
  )}\n`;
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

describe("TI11: a test job moved away with its script and tests still blocks", () => {
  it("a test job removed whole with its package.json script while test files are renamed gives one TI11 test-step finding at the first lost command: block in mode block, warn in mode warn, none in mode off, and no TI08, TI15 or TI16", async () => {
    const text = fixture(FIXTURE);
    expect(text, "the lambda job header is removed").toMatch(/^-\s+lambda:\s*$/m);
    expect(text, "a removed job holds runs-on").toMatch(/^-\s+runs-on:/m);
    expect(text, "the test:lambda script is removed").toMatch(/^-\s*"test:lambda"\s*:/m);
    expect(text, "a test file is renamed").toMatch(/^rename to \S*(?:test|spec)\S*$/m);
    const first = removedLines(text).find(
      (r) => r.path === CI && /\b(?:npm|pnpm|yarn|bun)\b.*\btest:lambda/.test(r.text),
    );
    expect(first, "the first removed test command of ci.yml").toBeDefined();
    const line = (first as { line: number }).line;

    for (const mode of ["block", "warn"] as const) {
      const report = await runDiff(text, mode);
      expect(ti11(report), `mode ${mode}`).toEqual([{ id: "TI11", severity: mode, path: CI, line, detail: TEST_STEP }]);
      expect(messagesOf(report, "TEST_INTEGRITY_TI11")[0]?.level, `mode ${mode}: the message level`).toBe(
        mode === "block" ? "error" : "warn",
      );
      if (mode === "block") {
        for (const id of OTHER_IDS) expect(signalsOf(report, id), `mode block: no ${id}`).toEqual([]);
      }
    }
    expect(ti11(await runDiff(text, "off")), "mode off").toEqual([]);

    // The same shape written inline: the job removed whole, its script removed, a test file renamed.
    const inline =
      edit(CI, [
        [
          20,
          [
            "  lambda:",
            "    runs-on: ubuntu-latest",
            "    steps:",
            "      - uses: actions/checkout@v4",
            "      - run: bun run test:lambda",
          ],
          [],
        ],
      ]) +
      edit("package.json", [[10, ['    "test:lambda": "vitest run --project lambda",'], []]]) +
      renameOnly("src/adapter/lambda/handler.test.ts", "src/adapter/aws-lambda/handler.test.ts");
    expect(ti11(await runDiff(inline, "block")), "the inline moved job").toEqual([
      { id: "TI11", severity: "block", path: CI, line: 24, detail: TEST_STEP },
    ]);

    // A whole job removed while its script stays in package.json.
    const kept = fixture("test-integrity/TI11/block-job-removed-script-kept.diff");
    const report = await runDiff(kept, "block");
    expect(ti11(report), "block-job-removed-script-kept.diff").toHaveLength(1);
    expect(ti11(report)[0]).toMatchObject({ severity: "block", detail: TEST_STEP });
    for (const id of OTHER_IDS) expect(signalsOf(report, id), `the kept-script fixture: no ${id}`).toEqual([]);
  });
});
