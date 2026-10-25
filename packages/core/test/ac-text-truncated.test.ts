import { describe, expect, it } from "vitest";
import { acceptTestIntegrity } from "../src/acceptLabel.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { messagesOf, runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { expectValidReport } from "./schema.js";

// The diff reader keeps at most 5000 changed lines of a file. When a signal reads that file, a finding past the cut is
// not seen, and the report says so with TEST_INTEGRITY_TEXT_TRUNCATED (warn) instead of passing in silence. The diffs
// are built here, as in ac-ti01-diff-caps: a 5000-line fixture would make ac-stream-diff (which cuts every fixture at
// every character) run for minutes.

const CODE = "TEST_INTEGRITY_TEXT_TRUNCATED";
const CUT = 5000;

/** A diff that adds `added` lines to `path` (a modified file), or deletes `removed` lines with the file. */
function bigDiff(path: string, lines: { added?: string[]; removed?: string[] }): string {
  const added = lines.added ?? [];
  const removed = lines.removed ?? [];
  const deleted = added.length === 0;
  const head = deleted
    ? [
        `diff --git a/${path} b/${path}`,
        "deleted file mode 100644",
        "index 1111111..0000000",
        `--- a/${path}`,
        "+++ /dev/null",
      ]
    : [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  const hunk = deleted ? `@@ -1,${removed.length} +0,0 @@` : `@@ -10,0 +11,${added.length} @@`;
  return `${[...head, hunk, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)].join("\n")}\n`;
}

const pad = (n: number, text: (i: number) => string) => Array.from({ length: n }, (_, i) => text(i + 1));

/** A test file whose added lines run past the cut, with an `.only` after it. */
const ONLY_PAST_CUT = bigDiff("src/big.test.ts", {
  added: [...pad(CUT, (i) => `// ${i}`), "it.only('creates a user', () => {});"],
});

describe("TEST_INTEGRITY_TEXT_TRUNCATED", () => {
  it("a .only past the cut in a test file: no TI04, but a warn message names the file, so the check is not a silent pass", async () => {
    // Control: the same .only inside the cut is a TI04 block.
    const inside = bigDiff("src/big.test.ts", {
      added: [...pad(10, (i) => `// ${i}`), "it.only('creates a user', () => {});"],
    });
    expect(signalsOf(await runDiff(inside), "TI04")).toHaveLength(1);

    const report = await runDiff(ONLY_PAST_CUT);
    expect(signalsOf(report, "TI04")).toEqual([]);
    const messages = messagesOf(report, CODE);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("warn");
    expect(messages[0]?.text).toBe(
      "This change is too large to check in full in `src/big.test.ts`: test integrity reads the first 5000 changed lines of a file, so a weakened test past them is not seen.",
    );
    expect(report.verdict).not.toBe("pass");

    const markdown = renderMarkdown(report);
    expect(markdown).toContain(`\`${CODE}\``);
    expect(markdown).toContain("Review the named files by hand for skipped, focused or weakened tests");
  });

  it.each([
    ["the pharn-ci config", ".pharn/ci.yml", (i: number) => `# ${i}`],
    ["a workflow", ".github/workflows/ci.yml", (i: number) => `# ${i}`],
    ["a package.json", "package.json", (i: number) => `    "k${i}": "v",`],
    ["a source file", "src/app.ts", (i: number) => `export const v${i} = ${i};`],
  ])("names %s cut at the bound", async (_label, path, line) => {
    const messages = messagesOf(await runDiff(bigDiff(path, { added: pad(CUT + 1, line) })), CODE);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toContain(`\`${path}\``);
  });

  it("is given in mode warn too, and not in mode off", async () => {
    expect(messagesOf(await runDiff(ONLY_PAST_CUT, "warn"), CODE)).toHaveLength(1);
    expect(messagesOf(await runDiff(ONLY_PAST_CUT, "off"), CODE)).toEqual([]);
  });

  it("stays after an accept-label sign-off, which only downgrades signals", async () => {
    const accepted = acceptTestIntegrity(await runDiff(ONLY_PAST_CUT), { label: "pharn/accepted", by: "Reviewer-1" });
    expectValidReport(accepted);
    expect(messagesOf(accepted, CODE)).toHaveLength(1);
    expect(accepted.verdict).toBe("warn");
  });

  it.each([
    [
      "a snapshot under __tests__ cut at the bound, which no signal reads",
      bigDiff("src/__tests__/__snapshots__/app.test.ts.snap", { added: pad(CUT + 1, (i) => `r${i}`) }),
    ],
    [
      "a deleted test-directory fixture cut at the bound, which has no added lines",
      bigDiff("tests/fixtures/big.json", { removed: pad(CUT + 1, (i) => `${i},`) }),
    ],
    ["a file under the bound", bigDiff("src/big.test.ts", { added: pad(CUT - 1, (i) => `// ${i}`) })],
  ])("%s gives no message", async (_label, diff) => {
    expect(messagesOf(await runDiff(diff), CODE)).toEqual([]);
  });
});
