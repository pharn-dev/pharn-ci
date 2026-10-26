import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// corpus-run-errors-3: scripts/corpus-run.mjs exports `detailText(text)`, which makes an error-row detail safe to view
// (control characters dropped, a tab becomes a space, a `'` in front of a leading `=`, `+`, `-` or `@`, clipped to 300
// characters with `…`, prefix included), and `cliProblem(result, timeout)`, which keeps choosing the FIRST non-empty
// stderr line of the CLI and passes it through `detailText`. The module is imported inside each test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type CliResult = {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
};
type Run = {
  detailText: (text: string) => string;
  cliProblem: (result: CliResult, timeout: number) => string;
};

const load = async (): Promise<Run> =>
  (await import(pathToFileURL(join(ROOT, "scripts/corpus-run.mjs")).href)) as unknown as Run;

const cliResult = (stderr: string): CliResult => ({
  code: 2,
  signal: null,
  stdout: "",
  stderr,
  timedOut: false,
  spawnError: null,
});

describe("corpus-run detailText and cliProblem", () => {
  it("AC-4: prefixes formula starts, drops control characters and clips to 300 characters", async () => {
    const { detailText } = await load();
    const cases: [string, string][] = [
      ['=HYPERLINK("x")', `'=HYPERLINK("x")`],
      ["+1", "'+1"],
      ["-1", "'-1"],
      ["@SUM(A1)", "'@SUM(A1)"],
      ["fatal: ok", "fatal: ok"],
      ["a\x1b[2Kb\x00c\td", "a[2Kbc d"],
      ["x".repeat(400), `${"x".repeat(299)}…`],
      [`=${"x".repeat(400)}`, `'=${"x".repeat(297)}…`],
    ];
    for (const [input, expected] of cases) {
      const result = detailText(input);
      expect(result).toBe(expected);
      expect(result.length).toBeLessThanOrEqual(300);
    }
  });

  it("AC-5: the CLI step's detail is its first stderr line, made safe", async () => {
    const { cliProblem } = await load();
    expect(cliProblem(cliResult("boom\nsecond line\n"), 300)).toBe("boom");
    expect(cliProblem(cliResult("=1+1\x07 boom\nsecond line\n"), 300)).toBe("'=1+1 boom");
    expect(cliProblem(cliResult("\x1b[2Kboom\n"), 300)).toBe("[2Kboom");
  });
});
