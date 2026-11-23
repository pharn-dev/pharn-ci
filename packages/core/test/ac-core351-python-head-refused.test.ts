import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { PythonTestIndex } from "../src/testIndex/pythonSides.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-351 (AC-3). check() is loaded inside the test body: the AC test is written before a head text the Python index
// refused fails a modified `.py` test file closed in mode block, so nothing the build changes may run while the file
// loads. The Python index ran; the head entry of the one modified file is refused, and its base entry either indexed
// or was refused for the same reason (so the message names that reason either way).

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PATH = "tests/test_c.py";

const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n    assert total([1]) == 1\n";

const DIFF = `${[
  `diff --git a/${PATH} b/${PATH}`,
  "index 1111111..2222222 100644",
  `--- a/${PATH}`,
  `+++ b/${PATH}`,
  "@@ -5,0 +6 @@ def test_adds():",
  "+    assert total([1]) == 1",
].join("\n")}\n`;

const SOURCES = {
  base: { files: [{ path: PATH, text: PY_BASE }], dropped: [] },
  head: { files: [{ path: PATH, text: PY_HEAD }], dropped: [] },
};

type Refusal = "syntax-error" | "parser-threw";

function index(head: Refusal, base: "indexed" | "refused"): PythonTestIndex {
  return {
    available: true,
    base: [
      {
        path: PATH,
        result:
          base === "indexed"
            ? { parsed: true, syntaxErrors: 0, tests: [], mocks: [] }
            : { parsed: false, reason: head },
      },
    ],
    head: [{ path: PATH, result: { parsed: false, reason: head } }],
  };
}

async function run(pythonTestIndex: PythonTestIndex, mode: "block" | "warn"): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [PATH, "src/app.ts", "src/cart.ts"],
    testIntegrityMode: { input: mode },
    testSources: SOURCES,
    pythonTestIndex,
  });
  expectValidReport(report);
  return report;
}

const CASES: [Refusal, "indexed" | "refused"][] = [
  ["syntax-error", "indexed"],
  ["syntax-error", "refused"],
  ["parser-threw", "indexed"],
  ["parser-threw", "refused"],
];

describe("CORE-351: a head text the Python index refused fails a modified .py test file closed in mode block", () => {
  it.each(CASES)(
    "AC-3: a head refused as %s with a base text the index %s gives the TEST_INTEGRITY_INDEX_UNAVAILABLE error naming the file with that reason and the verdict fail in mode block, and a warning in mode warn",
    async (reason, base) => {
      const pythonTestIndex = index(reason, base);

      const block = await run(pythonTestIndex, "block");
      const blockMessages = block.messages.filter((m) => m.code === CODE);
      expect(blockMessages, `block: one ${CODE} message`).toHaveLength(1);
      expect(blockMessages[0]?.text, "block: it names the file with the reason").toContain(
        `\`${PATH}\` (\`${reason}\`)`,
      );
      expect(blockMessages[0]?.level, "block: the message is an error").toBe("error");
      expect(block.verdict, "block: the verdict").toBe("fail");

      const warn = await run(pythonTestIndex, "warn");
      const warnMessages = warn.messages.filter((m) => m.code === CODE);
      expect(warnMessages, `warn: one ${CODE} message`).toHaveLength(1);
      expect(warnMessages[0]?.text, "warn: it names the file with the reason").toContain(`\`${PATH}\` (\`${reason}\`)`);
      expect(warnMessages[0]?.level, "warn: the message is a warning").toBe("warn");
    },
  );
});
