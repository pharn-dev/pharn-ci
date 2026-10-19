import { describe, expect, it } from "vitest";
import { EXIT_ERROR, main } from "../src/main.js";
import { fakeDeps } from "./fake-deps.js";

// A flag value that starts with "-" used to surface parseArgs' "Did you forget to specify the option argument?",
// which misleads: the value was given. The CLI now says how to write it.
describe("cli: flag values starting with '-'", () => {
  it.each([
    [
      ["check", "--coverage", "x", "--threshold", "-1"],
      '--threshold -1: a value starting with "-" must be written --threshold=-1',
    ],
    [["check", "--coverage", "x", "--base", "-x"], '--base -x: a value starting with "-" must be written --base=-x'],
    [["check", "--coverage", "-x"], '--coverage -x: a value starting with "-" must be written --coverage=-x'],
    // repeatable flag: the offending occurrence is named, not an earlier valid one
    [
      ["check", "--exclude", "a", "--exclude", "-b"],
      '--exclude -b: a value starting with "-" must be written --exclude=-b',
    ],
    // a following flag is also read as a value starting with "-"
    [["check", "--format", "--threshold=5"], '--format --threshold=5: a value starting with "-" must be written'],
  ])("exits 2 and explains the --flag=value form for %j", async (argv, message) => {
    const deps = fakeDeps({});
    expect(await main(argv, deps)).toBe(EXIT_ERROR);
    expect(deps.err).toContain(message);
    expect(deps.err).not.toContain("Did you forget");
    expect(deps.out).toBe("");
  });

  it("keeps parseArgs' own text for a flag with no value and for unknown options", async () => {
    const missing = fakeDeps({});
    expect(await main(["check", "--threshold"], missing)).toBe(EXIT_ERROR);
    expect(missing.err).toContain("argument missing");
    expect(missing.err).not.toContain("must be written");

    const unknown = fakeDeps({});
    expect(await main(["check", "--nope"], unknown)).toBe(EXIT_ERROR);
    expect(unknown.err).toContain("Unknown option");
  });

  it("follows the advice: --threshold=-1 reaches the real range error", async () => {
    const deps = fakeDeps({});
    expect(await main(["check", "--coverage", "x", "--threshold=-1"], deps)).toBe(EXIT_ERROR);
    expect(deps.err).toContain("--threshold must be a number between 0 and 100");
  });
});
