import { describe, expect, it } from "vitest";

// fix-hints (H6), AC-3. The core's fix tables are loaded inside the test body: the AC test is written before the build
// adds them. No hint may tell the reader to lower a gate, and a hint is one fixed sentence: no placeholder at all, so
// nothing but the finding's own path, line or id (which go in `target`) can ever be put into it.

type Entry = { kind: string; hint: string };
type Tables = { MESSAGE_FIXES?: Record<string, Entry>; SIGNAL_FIXES?: Record<string, Entry> };

const BANNED = [
  "exclude",
  "excluding",
  "exclusion",
  "lower",
  "skip",
  "threshold",
  "ignore",
  "disable",
  "exempt",
  "exemption",
];
const BANNED_WORD = new RegExp(`\\b(?:${BANNED.join("|")})\\b`, "i");
const PLACEHOLDER = /[{}<>$]|%[sd]/;

async function hints(): Promise<Array<[string, string]>> {
  const { MESSAGE_FIXES, SIGNAL_FIXES } = (await import("../src/index.js")) as unknown as Tables;
  expect(MESSAGE_FIXES, "MESSAGE_FIXES is exported").toBeDefined();
  expect(SIGNAL_FIXES, "SIGNAL_FIXES is exported").toBeDefined();
  const all: Array<[string, string]> = [
    ...Object.entries(MESSAGE_FIXES ?? {}).map(([key, e]): [string, string] => [`message ${key}`, e.hint]),
    ...Object.entries(SIGNAL_FIXES ?? {}).map(([key, e]): [string, string] => [`signal ${key}`, e.hint]),
  ];
  expect(all.length, "the tables have entries").toBeGreaterThan(50);
  return all;
}

describe("fix hints: the words a hint may use", () => {
  it("AC-3: no hint contains exclude, excluding, exclusion, lower, skip, threshold, ignore, disable, exempt or exemption (case-insensitive, word boundaries)", async () => {
    // Control: the scan finds every banned word on a word boundary, in any case, and not inside another word.
    for (const word of BANNED) {
      expect(BANNED_WORD.test(`Please ${word} it.`), word).toBe(true);
      expect(BANNED_WORD.test(`Please ${word.toUpperCase()} it.`), word).toBe(true);
    }
    expect(BANNED_WORD.test("Add a coverage-ignore comment.")).toBe(true);
    expect(BANNED_WORD.test("Restore the follower.")).toBe(false);
    expect(BANNED_WORD.test("Add tests that run the changed lines.")).toBe(false);

    for (const [key, hint] of await hints()) {
      expect(BANNED_WORD.exec(hint)?.[0] ?? null, `${key}: "${hint}"`).toBeNull();
    }
  });

  it("AC-3: no hint contains a placeholder: the path, line and id of a finding go only into target", async () => {
    for (const [key, hint] of await hints()) {
      expect(PLACEHOLDER.exec(hint)?.[0] ?? null, `${key}: "${hint}"`).toBeNull();
    }
  });
});
