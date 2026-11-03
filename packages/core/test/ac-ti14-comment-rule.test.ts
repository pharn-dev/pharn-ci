import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config.js";
import { findComment, stripComment } from "../src/signals/yamlLines.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// The pharn-ci config reader and TI14 read the same `threshold:` line. They used to disagree on where a comment
// starts: the config opened one after any \s character, TI14 only after a space or a tab, so
// `threshold: 50<U+00A0># lowered` set the gate to 50 while TI14 read "50 # lowered", saw no number and stayed silent.
// Both now call findComment (YAML's rule: space or tab only), and the config refuses a "#" after any other space.

const CONFIG = ".pharn/ci.yml";
const REPO_ROOT = "/home/runner/work/demo/demo";

/** Every UTF-16 code unit `\s` matches, minus the line breaks a diff or config line cannot hold. */
const SPACES = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).filter(
  (ch) => /\s/.test(ch) && ch !== "\n" && ch !== "\r",
);
const YAML_SPACES = new Set([" ", "\t"]);

function edit(removed: string, added: string): string {
  return [
    `diff --git a/${CONFIG} b/${CONFIG}`,
    "index 1111111..2222222 100644",
    `--- a/${CONFIG}`,
    `+++ b/${CONFIG}`,
    "@@ -4 +4 @@ coverage:",
    `-${removed}`,
    `+${added}`,
    "",
  ].join("\n");
}

async function ti14(diff: string) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI14");
}

describe("TI14 and the config read a comment by one rule", () => {
  it("the set under test holds every Unicode space the review named", () => {
    for (const code of [0xa0, 0x1680, 0x2000, 0x200a, 0x202f, 0x205f, 0x3000, 0xfeff]) {
      expect(SPACES).toContain(String.fromCharCode(code));
    }
  });

  it("for every \\s character before #, the config and TI14 agree: a space or tab opens a comment, anything else is refused", async () => {
    for (const ch of SPACES) {
      const label = `U+${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      const line = `  threshold: 50${ch}# lowered`;
      if (YAML_SPACES.has(ch)) {
        expect(parseConfig(`coverage:\n${line}\n`).coverage?.threshold, label).toBe(50);
        expect(stripComment(line), label).toBe("threshold: 50");
      } else {
        expect(() => parseConfig(`coverage:\n${line}\n`), label).toThrow(ConfigError);
        expect(() => parseConfig(`coverage:\n${line}\n`), label).toThrow(/must follow a space or a tab/);
        expect(findComment(line).start, label).toBe(-1);
        expect(findComment(line).lookalike, label).toBe(line.indexOf("#"));
      }
      // Either way a PR that writes the line over a higher threshold gets one TI14 block.
      const signals = await ti14(edit("  threshold: 90", line));
      expect(signals, label).toHaveLength(1);
      expect(signals[0], label).toMatchObject({ severity: "block", path: CONFIG, line: 4 });
    }
  });

  it("names the character in the config error", () => {
    expect(() => parseConfig("coverage:\n  threshold: 50\u00a0# lowered\n")).toThrow(
      'line 2: a "#" comment must follow a space or a tab, not U+00A0; replace the character before "#" with a space',
    );
  });

  it("a # inside quotes or after a space stays as before", () => {
    expect(parseConfig('coverage:\n  exclude: ["a\u00a0#b"]\n').coverage?.exclude).toEqual(["a\u00a0#b"]);
    expect(parseConfig("coverage:\n  threshold: 70 # team floor\n").coverage?.threshold).toBe(70);
    expect(parseConfig("# top\ncoverage:\n  threshold: 70\n").coverage?.threshold).toBe(70);
  });

  it("a threshold padded past the 400-character kept-line cap, which the config still reads, fails closed", async () => {
    const padded = `  threshold:${" ".repeat(400)}50`;
    expect(parseConfig(`coverage:\n${padded}\n`).coverage?.threshold).toBe(50);
    const signals = await ti14(edit("  threshold: 90", padded));
    expect(signals).toHaveLength(1);
    expect(signals[0]?.detail).toBe("Coverage threshold changed from 90 to a value this check cannot compare.");
  });

  it("a threshold raised, kept or written in a form TI14 reads is unchanged", async () => {
    expect(await ti14(edit("  threshold: 80", "  threshold: 90 # raised"))).toEqual([]);
    expect(await ti14(edit("  threshold: 80", "  threshold: 80\t# same"))).toEqual([]);
    expect(await ti14(edit("  threshold: 80", '  threshold: "85"'))).toEqual([]);
  });
});
