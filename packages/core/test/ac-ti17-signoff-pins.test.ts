import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ti17-always-true-matcher-2, AC-25. The fixture walker (ac-accept-signoff-regression, which lists every
// fixtures/test-integrity/<dir>/*.diff), its base-commit text, the TI17 fixture directory and the two tests that pin
// the walker's sha256 are all read inside the test body: the build adds the TI17 fixtures and edits the walker and its
// two pins after this test is written. The walker may only gain ADDED_AFTER_BASE entries: nothing is taken out of the
// set, and the count and digest it pins for the earlier fixtures keep their base literals.

const BASE = "12036e8c485a656eeb9a4a9beb869e51e37b7d80";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WALKER = "packages/action/test/ac-accept-signoff-regression.test.ts";
const PINNERS = [
  "packages/core/test/ac-ti09y-regression.test.ts",
  "packages/action/test/ac-pyparity2-unchanged.test.ts",
];
const ID = ["TI", "17"].join("");
const TI17_DIR = `fixtures/test-integrity/${ID}/`;

const atHead = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const atBase = (path: string) =>
  execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

/** The string literals of the walker's `const ADDED_AFTER_BASE … new Set([ … ])`, with `//` line comments left out. */
function addedAfterBase(text: string): string[] {
  const start = text.indexOf("const ADDED_AFTER_BASE");
  expect(start, "the ADDED_AFTER_BASE declaration").toBeGreaterThan(-1);
  const open = text.indexOf("new Set([", start);
  expect(open, "the ADDED_AFTER_BASE set").toBeGreaterThan(-1);
  const close = text.indexOf("]);", open);
  expect(close, "the end of the ADDED_AFTER_BASE set").toBeGreaterThan(open);
  const body = text
    .slice(open + "new Set([".length, close)
    .split("\n")
    .map((line) => {
      const comment = line.indexOf("//");
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join("\n");
  return [...body.matchAll(/"([^"\\\n]*)"/g)].map((m) => m[1] as string);
}

/** The literal of `const <name> = <literal>;` in the text, exactly once. */
function constLiteral(text: string, name: string): string {
  const matches = [...text.matchAll(new RegExp(`^const ${name} = ([^;\\n]+);`, "gm"))];
  expect(matches, `one const ${name}`).toHaveLength(1);
  return (matches[0] as RegExpMatchArray)[1] as string;
}

describe("the fixture walker accepts the TI17 fixtures and keeps every earlier pin", () => {
  it("AC-25: the walker's ADDED_AFTER_BASE holds every TI17 fixture and every base entry, BEFORE_COUNT (216) and BEFORE_DIGEST keep their base literals, and both sha256 pins of the walker equal its sha256 at HEAD", () => {
    const head = atHead(WALKER);
    const base = atBase(WALKER);

    expect(existsSync(`${ROOT}${TI17_DIR}`), "fixtures/test-integrity/TI17/ exists").toBe(true);
    const fixtures = readdirSync(`${ROOT}${TI17_DIR}`)
      .filter((name) => name.endsWith(".diff") && statSync(`${ROOT}${TI17_DIR}${name}`).isFile())
      .sort();
    expect(fixtures.length, "at least one TI17 .diff fixture").toBeGreaterThan(0);

    const headSet = new Set(addedAfterBase(head));
    const baseSet = addedAfterBase(base);
    expect(baseSet.length, "the base set is read").toBeGreaterThan(0);
    for (const name of fixtures) {
      expect(headSet.has(`${ID}/${name}`), `ADDED_AFTER_BASE holds ${ID}/${name}`).toBe(true);
    }
    for (const entry of baseSet) {
      expect(headSet.has(entry), `ADDED_AFTER_BASE keeps the base entry ${entry}`).toBe(true);
    }

    expect(constLiteral(base, "BEFORE_COUNT"), "the base count").toBe("216");
    expect(constLiteral(head, "BEFORE_COUNT"), "BEFORE_COUNT as at the base").toBe(constLiteral(base, "BEFORE_COUNT"));
    expect(constLiteral(base, "BEFORE_DIGEST"), "the base digest is a sha256 literal").toMatch(/^"[0-9a-f]{64}"$/);
    expect(constLiteral(head, "BEFORE_DIGEST"), "BEFORE_DIGEST as at the base").toBe(
      constLiteral(base, "BEFORE_DIGEST"),
    );

    const sha = createHash("sha256")
      .update(readFileSync(`${ROOT}${WALKER}`))
      .digest("hex");
    const pinPattern = new RegExp(`"${WALKER.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}":\\s*"([0-9a-f]{64})"`, "g");
    for (const pinner of PINNERS) {
      const pins = [...atHead(pinner).matchAll(pinPattern)].map((m) => m[1] as string);
      expect(pins.length, `${pinner} pins the walker`).toBeGreaterThan(0);
      for (const pin of pins) expect(pin, `${pinner}: the walker's sha256 at HEAD`).toBe(sha);
    }
  });
});
