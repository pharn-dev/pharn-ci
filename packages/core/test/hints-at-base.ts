// CORE-140 made each code's comment hint its fix.hint, on purpose, so the hint lines of the golden renderings changed.
// The tests that pin a golden rendering by its hash at an older commit fold those lines back to the text they had
// before, the way they fold the other intentional changes back, so every other byte is still checked. Only the hint
// lines of the codes the goldens hold are folded; any other change still changes the hash. The CORE-14 follow-up put
// the setting or key of the old comment hints back into those fix hints, on purpose: the lines below are the hints as
// they render since then.

/** Each golden hint line as it renders now, and the line it was before CORE-140. */
const HINT_LINES_AT_BASE: ReadonlyArray<readonly [string, string]> = [
  [
    "  - Hint: Add tests that run the changed lines listed in the report.",
    "  - Hint: Add tests that exercise the uncovered lines listed in the table above.",
  ],
  [
    "  - Hint: Check that the coverage paths start at the repository root or at `coverage.root`, so every changed file is matched; generated files and files outside the repository need nothing.",
    "  - Hint: Nothing to do if those files are generated or outside the repo; if changed files are missing from the table, check the coverage root.",
  ],
  [
    "  - Hint: Check that the coverage paths start at the repository root, or set the directory they start from (`coverage.root`, the `coverage-root` input or `--coverage-root`).",
    "  - Hint: Write coverage paths relative to the repository root, or set the directory they start from (`coverage.root`, `coverage-root` or `--coverage-root`).",
  ],
];

/** The markdown with each CORE-140 hint line of the goldens folded back to its text before CORE-140. */
export function foldHintsToBase(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => HINT_LINES_AT_BASE.find(([now]) => now === line)?.[1] ?? line)
    .join("\n");
}
