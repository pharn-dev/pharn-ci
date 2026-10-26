import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { fixture } from "./helpers.js";

// check() is loaded inside the test body (through runDiff): the AC test is written before TI11 reads retired jobs, and
// the fixture it reads is written by the build, so nothing the build adds may run while the file loads.
//
// The inline diffs start from one retired-job change (a job removed whole from ci.yml, the script it ran removed from
// package.json, a test file renamed to another test-file path) and each variant breaks one of its conditions.

const CI = ".github/workflows/ci.yml";
const TEST_STEP = "A step that runs tests was removed from a workflow.";
const RETIRED =
  "A job that ran tests was removed from a workflow together with the script it ran, while this change moves test files; check that another workflow runs them.";
const j = (...parts: string[]) => parts.join("");
const OTHER_IDS = [j("TI", "08"), j("TI", "15"), j("TI", "16")];

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

/** The job `lambda`, removed whole at old-file lines 20 to 25; its test command is the last line, 25. */
const job = (command: string) => [
  "  lambda:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - run: bun install",
  `      - run: ${command}`,
];
const JOB_AT = 20;
const COMMAND_LINE = 25;
const SCRIPT = '    "test:lambda": "vitest run --project lambda",';
const TEST_RENAME = renameOnly("src/adapter/lambda/handler.test.ts", "src/adapter/aws-lambda/handler.test.ts");
const SOURCE_RENAME = renameOnly("src/adapter/lambda/handler.ts", "src/adapter/aws-lambda/handler.ts");

const retired = (parts: {
  workflow?: Array<[number, string[], string[]]>;
  scripts?: [number, string[], string[]];
  rename?: string;
}) =>
  edit(CI, parts.workflow ?? [[JOB_AT, job("bun run test:lambda"), []]]) +
  edit("package.json", [parts.scripts ?? [10, [SCRIPT], []]]) +
  (parts.rename ?? TEST_RENAME);

type Report = Awaited<ReturnType<typeof runDiff>>;
const ti11 = (report: Report) =>
  signalsOf(report, "TI11").map((s) => ({
    id: String(s.id),
    severity: s.severity,
    path: s.path,
    line: s.line,
    detail: s.detail,
  }));

describe("TI11: a lost test command that is not a retired job stays a block", () => {
  it("AC-3: a whole job removed with its script kept, a script added back, only a source file renamed, only the step removed, a non-package-manager command and a later non-retired command each give one block test-step TI11, the mixed file at the later line, and none gives TI08, TI15 or TI16", async () => {
    // Control: the unbroken retired-job change is the retired-job warn, so each variant below differs by one condition.
    expect(ti11(await runDiff(retired({}), "block")), "the unbroken retired-job change").toEqual([
      { id: "TI11", severity: "warn", path: CI, line: COMMAND_LINE, detail: RETIRED },
    ]);

    const variants: Array<[string, string, number]> = [
      [
        "a removed script added back by an added package.json line",
        retired({ scripts: [10, [SCRIPT], ['    "test:lambda": "vitest run --project aws-lambda",']] }),
        COMMAND_LINE,
      ],
      ["only a source file renamed, no test file", retired({ rename: SOURCE_RENAME }), COMMAND_LINE],
      [
        "only the step removed, not its whole job",
        retired({ workflow: [[COMMAND_LINE, ["      - run: bun run test:lambda"], []]] }),
        COMMAND_LINE,
      ],
      [
        "the removed job runs a command that is not a package-manager script",
        retired({ workflow: [[JOB_AT, job("vitest run"), []]] }),
        COMMAND_LINE,
      ],
      [
        "a retired command first and a non-retired command at a later old-file line",
        retired({
          workflow: [
            [JOB_AT, job("bun run test:lambda"), []],
            [40, ["      - run: pnpm test"], []],
          ],
        }),
        40,
      ],
    ];
    for (const [label, diff, line] of variants) {
      const report = await runDiff(diff, "block");
      expect(ti11(report), label).toEqual([{ id: "TI11", severity: "block", path: CI, line, detail: TEST_STEP }]);
      for (const id of OTHER_IDS) expect(signalsOf(report, id), `${label}: no ${id}`).toEqual([]);
    }

    // The fixture: a whole job removed while its script stays in package.json.
    const kept = fixture("test-integrity/TI11/block-job-removed-script-kept.diff");
    expect(kept, "the fixture removes a job header").toMatch(/^-\s{2,}[\w-]+:\s*$/m);
    expect(kept, "the fixture removes runs-on").toMatch(/^-\s+runs-on:/m);
    const report = await runDiff(kept, "block");
    const signals = ti11(report);
    expect(signals, "block-job-removed-script-kept.diff").toHaveLength(1);
    expect(signals[0], "block-job-removed-script-kept.diff").toMatchObject({
      id: "TI11",
      severity: "block",
      detail: TEST_STEP,
    });
    for (const id of OTHER_IDS) expect(signalsOf(report, id), `the fixture: no ${id}`).toEqual([]);
  });
});
