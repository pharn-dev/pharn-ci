import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-69. check(), renderMarkdown() and withAcceptLabel() are loaded inside the test body: the AC test is written
// before the comment hint names the accept label on the new per-file and truncation errors, so nothing the build
// changes may run while the file loads. The head text of the AC-1 and AC-2 inputs holds a fixed marker that must reach
// neither the report nor the comment: the messages name paths and fixed reason codes, never file content.

const MARKER = "CORE69-MARKER-7f3a";
const UNAVAILABLE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const TRUNCATED = "TEST_INTEGRITY_TEXT_TRUNCATED";

interface Message {
  code: string;
  level: string;
  text: string;
  fix?: { hint?: string };
}
interface Report {
  verdict: string;
  messages: Message[];
}

const BASE = [
  'import { expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
  'it("rejects a negative price", () => {',
  '  expect(() => total([-1])).toThrow("negative price");',
  "});",
  "",
].join("\n");
const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

function modified(path: string, header: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, header, ...lines].join("\n")}\n`;
}
const addOne = (path: string) => modified(path, "@@ -5,0 +6 @@", ["+  expect(total([1])).toBe(1);"]);
const readable = (path: string, base: string, head: string) => ({
  base: { files: [{ path, text: base }], dropped: [] },
  head: { files: [{ path, text: head }], dropped: [] },
});

async function run(input: Record<string, unknown>): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [
      "src/a.test.ts",
      "src/big.test.ts",
      "src/cart.ts",
      "src/deep.test.ts",
      "src/long.test.ts",
      "tests/test_c.py",
    ],
    testIntegrityMode: { input: "block" },
    ...input,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

/** The `  - Hint:` line under the message line that names `code` in the rendered comment. */
function hintFor(markdown: string, code: string, name: string): string {
  const lines = markdown.split("\n");
  const at = lines.findIndex((line) => line.includes(`\`${code}\``));
  expect(at, `${name}: the comment lists ${code}`).toBeGreaterThan(-1);
  const hint = lines.slice(at + 1, at + 4).find((line) => line.startsWith("  - Hint: "));
  expect(hint, `${name}: a hint line under ${code}`).toBeDefined();
  return hint as string;
}

describe("CORE-69: the new errors leak no file text, carry a fix hint, and offer the accept label only where it counts", () => {
  it("AC-19: no head text reaches the report or the comment; every unreadable and cut message has a fix hint; the comment hint names the accept label on the AC-1, AC-2 and AC-5 errors and not on the AC-4 whole-run error or the AC-12 warning", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const { withAcceptLabel } = await import("../src/acceptLabel.js");

    const deepLine = `const deep = ${"[".repeat(2000)}${"]".repeat(2000)};`;
    const ac1 = await run({
      diff: { text: modified("src/deep.test.ts", "@@ -10,0 +11 @@", [`+${deepLine}`]) },
      testSources: readable("src/deep.test.ts", BASE, `${BASE}// ${MARKER}\n${deepLine}\n`),
    });
    const ac2 = await run({
      diff: { text: modified("src/big.test.ts", "@@ -10,0 +11 @@", ["+/* padding */"]) },
      testSources: readable("src/big.test.ts", BASE, `${BASE}/* ${MARKER} ${"x".repeat(530_000)} */\n`),
    });
    const long = Array.from({ length: 5001 }, (_, i) => `// line ${i + 1}`);
    const ac5 = await run({
      diff: {
        text: modified(
          "src/long.test.ts",
          `@@ -10,0 +11,${long.length} @@`,
          long.map((l) => `+${l}`),
        ),
      },
      testSources: readable("src/long.test.ts", BASE, `${BASE}${long.join("\n")}\n`),
    });
    const ac4 = await run({
      diff: {
        text: modified("tests/test_c.py", "@@ -6,4 +5,0 @@", [
          "-",
          "-",
          "-def test_empty():",
          "-    assert total([]) == 0",
        ]),
      },
      testSources: readable("tests/test_c.py", PY_BASE, PY_HEAD),
      pythonTestIndex: { available: false, reason: "python-not-found", detail: "python3: command not found" },
    });
    const ac12 = await run({
      diff: { text: addOne("src/a.test.ts") },
      testSources: {
        base: { files: [], dropped: [{ path: "src/a.test.ts", reason: "too-large" }] },
        head: { files: [], dropped: [{ path: "src/a.test.ts", reason: "too-large" }] },
      },
    });
    const relabelled = withAcceptLabel(structuredClone(ac1) as never, "team/ok") as unknown as Report;
    expectValidReport(relabelled);

    const cases = [
      { name: "AC-1", report: ac1, code: UNAVAILABLE, label: "pharn/accepted" },
      { name: "AC-2", report: ac2, code: UNAVAILABLE, label: "pharn/accepted" },
      { name: "AC-5", report: ac5, code: TRUNCATED, label: "pharn/accepted" },
      { name: "AC-1 with the label team/ok", report: relabelled, code: UNAVAILABLE, label: "team/ok" },
      { name: "AC-4", report: ac4, code: UNAVAILABLE, label: null },
      { name: "AC-12", report: ac12, code: UNAVAILABLE, label: null },
    ] as const;

    for (const { name, report, code, label } of cases) {
      const markdown = renderMarkdown(report as never);
      expect(JSON.stringify(report), `${name}: the report holds no head text`).not.toContain(MARKER);
      expect(markdown, `${name}: the comment holds no head text`).not.toContain(MARKER);

      const messages = report.messages.filter((m) => m.code === UNAVAILABLE || m.code === TRUNCATED);
      expect(messages.length, `${name}: the report holds the message`).toBeGreaterThan(0);
      for (const m of messages) {
        expect(typeof m.fix?.hint, `${name}: ${m.code} has a fix hint`).toBe("string");
        expect((m.fix?.hint ?? "").trim().length, `${name}: ${m.code} fix hint is not empty`).toBeGreaterThan(0);
      }

      const hint = hintFor(markdown, code, name);
      if (label === null) {
        expect(hint, `${name}: the hint does not offer the accept label`).not.toContain("accept label");
      } else {
        expect(hint, `${name}: the hint offers the accept label`).toContain("accept label");
        expect(hint, `${name}: the hint names the label`).toContain(`\`${label}\``);
      }
    }
  });
});
