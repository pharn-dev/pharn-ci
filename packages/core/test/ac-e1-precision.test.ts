import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/diff/unified.js";
import { keepSignalFileText } from "../src/signals/signalFiles.js";
import { detectTI11 } from "../src/signals/ti11.js";
import { messagesOf, runDiff, runFixture, signalsOf } from "./ac-e1-fix-shared.js";

// Precision fixes found by the Epic 1 review: forms a signal misread (a block on a harmless edit) or did not read (a
// weakening that passed). Each must-trigger fixture has a must-not-trigger neighbour.

const summary = (report: Awaited<ReturnType<typeof runFixture>>, id: string) =>
  signalsOf(report, id).map((s) => `${s.severity} ${s.path}:${s.line}`);

describe("TI11: a quoted on key", () => {
  it("dropping pull_request from a quoted on list is a block", async () => {
    expect(summary(await runFixture("TI11/block-trigger-quoted-on.diff"), "TI11")).toEqual([
      "block .github/workflows/ci.yml:3",
    ]);
  });
  it("quoting the on key and keeping the trigger is nothing", async () => {
    expect(signalsOf(await runFixture("TI11/pass-on-key-quoted.diff"), "TI11")).toEqual([]);
  });
});

describe("TI11: the test commands of pnpm and Python environment tools", () => {
  it.each([
    ["TI11/block-pnpm-vitest-removed.diff", 24],
    ["TI11/block-uv-pytest-removed.diff", 31],
  ])("%s: the removed step is a block", async (diff, line) => {
    expect(summary(await runFixture(diff), "TI11")).toEqual([`block .github/workflows/ci.yml:${line}`]);
  });

  it("the same command moved within the workflow is nothing", async () => {
    expect(signalsOf(await runFixture("TI11/pass-uv-pytest-moved.diff"), "TI11")).toEqual([]);
  });

  /** A workflow diff that removes one `run:` line. */
  const removing = (command: string) =>
    parseUnifiedDiff(
      [
        "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
        "--- a/.github/workflows/ci.yml",
        "+++ b/.github/workflows/ci.yml",
        "@@ -9 +8,0 @@",
        `-        run: ${command}`,
        "",
      ].join("\n"),
      { keepText: keepSignalFileText() },
    );

  it.each([
    "npm t",
    "pnpm -r test",
    "pnpm --filter core test",
    "pnpm --filter=core run test:unit",
    "npm test --workspaces",
    "pnpm vitest run --coverage",
    "pnpm exec jest --ci",
    "bun x vitest",
    "node --test",
    "node --import tsx --test test/",
    "bun test",
    "deno test -A",
    "uv run pytest -q",
    "poetry run pytest",
    "pipenv run python -m pytest",
    "hatch run python -m unittest",
    "uv run tox",
    "nox",
  ])("removing `%s` is a block", (command) => {
    expect(detectTI11(removing(command), "block").map((s) => s.severity)).toEqual(["block"]);
  });

  it.each(["pnpm tsc", "npm run build", "node scripts/build.mjs", "uv run ruff check", "pnpm lint", "bun install"])(
    "removing `%s` is nothing",
    (command) => {
      expect(detectTI11(removing(command), "block")).toEqual([]);
    },
  );
});

describe("TI10: scripts whose status still comes from the runner", () => {
  it.each([
    ["TI10/pass-echo-banner.diff", "echo before the runner, joined by &&"],
    ["TI10/pass-mocha-timeout.diff", "mocha -t, which is --timeout"],
  ])("%s: %s is nothing", async (diff) => {
    const report = await runFixture(diff);
    expect(signalsOf(report, "TI10")).toEqual([]);
    expect(messagesOf(report, "TEST_INTEGRITY_TI10")).toEqual([]);
  });

  it.each([
    ["TI10/block-semicolon-true.diff", "ignores the exit status"],
    ["TI10/block-or-colon.diff", "ignores the exit status"],
    ["TI10/block-echo-after-run.diff", "prints a message"],
    ["TI10/block-jest-name-filter.diff", "names match a pattern"],
  ])("%s: a block whose detail says it %s", async (diff, words) => {
    const signals = signalsOf(await runFixture(diff), "TI10");
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ severity: "block", path: "package.json", line: 7 });
    expect(signals[0]?.detail).toContain(words);
  });
});

describe("TI13: coverage.py's no-space pragma", () => {
  it("an added `# pragma: nocover` is a block", async () => {
    expect(summary(await runFixture("TI13/block-pragma-nocover.diff"), "TI13")).toEqual(["block src/app.py:13"]);
  });
  it("respelling an existing pragma as `#pragma nocover` is nothing", async () => {
    expect(signalsOf(await runFixture("TI13/pass-pragma-respelled.diff"), "TI13")).toEqual([]);
  });
});

describe("TI03: a Python skip decorator on an existing test", () => {
  it("added above an edited def line of the same test: a block", async () => {
    expect(summary(await runFixture("TI03/block-python-def-edited.diff"), "TI03")).toEqual([
      "block tests/test_user.py:20",
    ]);
  });
  it("added above a context line, with a new test lower in the same hunk (the compare API's diff): a block", async () => {
    expect(summary(await runFixture("TI03/block-python-context-lines.diff"), "TI03")).toEqual([
      "block tests/test_user.py:20",
    ]);
  });
  it("added above a new test right below it: still a warn", async () => {
    const diff = [
      "diff --git a/tests/test_user.py b/tests/test_user.py",
      "--- a/tests/test_user.py",
      "+++ b/tests/test_user.py",
      "@@ -20,0 +21,3 @@",
      '+@pytest.mark.skip(reason="todo")',
      "+def test_brand_new():",
      "+    assert compute() == 3",
      "",
    ].join("\n");
    expect(summary(await runDiff(diff), "TI03")).toEqual(["warn tests/test_user.py:21"]);
  });
});

describe("TI01: a cut file that cannot define tests", () => {
  /** A diff that deletes `path` with `lines` removed lines that define no test. */
  const deleting = (path: string, lines: number) =>
    [
      `diff --git a/${path} b/${path}`,
      "deleted file mode 100644",
      `--- a/${path}`,
      "+++ /dev/null",
      `@@ -1,${lines} +0,0 @@`,
      ...Array.from({ length: lines }, (_, i) => `-${i},`),
      "",
    ].join("\n");

  it("a 5001-line JSON fixture deleted under tests/ is nothing", async () => {
    const report = await runDiff(deleting("tests/fixtures/big.json", 5001));
    expect(signalsOf(report, "TI01")).toEqual([]);
    expect(report.verdict).not.toBe("fail");
  });
  it("a 5001-line test file deleted with no test-defining line kept still counts", async () => {
    expect(summary(await runDiff(deleting("tests/big.test.ts", 5001)), "TI01")).toEqual([
      "block tests/big.test.ts:null",
    ]);
  });
});

describe("the diff reader: line numbers start at 1", () => {
  it("a hand-made `+0,1` hunk numbers its added line 1, so the report stays valid", async () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -0,0 +0,1 @@",
      "+/* istanbul ignore next */",
      "",
    ].join("\n");
    expect(summary(await runDiff(diff), "TI13")).toEqual(["block src/a.ts:1"]);
  });
});
