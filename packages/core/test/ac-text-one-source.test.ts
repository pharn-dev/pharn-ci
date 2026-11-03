import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The searched trees include this file's own directory, so this source never spells the comparator body: its regex is
// joined from tokens below. The cut detectors are likewise written so their own source does not match them.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TREES = ["packages/core/src", "packages/node-io/src", "packages/core/test"];
const SHARED = "packages/core/src/text.ts";

/** The comparator body, a, b, then the -1 / 1 / 0 ternary, with any whitespace between its tokens. */
const BODY_TOKENS = ["a", "<", "b", "\\?", "-1", ":", "a", ">", "b", "\\?", "1", ":", "0"];
const BODY = new RegExp(`\\b${BODY_TOKENS.join("\\s*")}\\b`, "g");

/**
 * A surrogate-safe cut of a file's own: a definition of an `isHighSurrogate` helper, a ternary that picks a cut end
 * from a high-surrogate range test, or a `const high` cut-end decision. The non-cut surrogate code (a lone-surrogate
 * replacement, a UTF-8 decoder or encoder, a code-point count, a test's own lone-surrogate check) matches none.
 */
const OWN_CUT: { label: string; pattern: RegExp }[] = [
  { label: "an isHighSurrogate definition", pattern: /\b(?:function|const|let|var)\s+isHighSurrogate\b/ },
  { label: "a cut end chosen by a high-surrogate test", pattern: /<=\s*0xdbff\s*\?/i },
  { label: "a `const high` cut-end decision", pattern: /\bconst\s+high\s*=/ },
];

/** Every .ts file under `dir`, as a repository-relative POSIX path. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...tsFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

function sources(): { path: string; text: string }[] {
  const files = TREES.flatMap(tsFiles);
  return files.map((path) => ({
    path: relative(REPO_ROOT, join(REPO_ROOT, path)),
    text: readFileSync(join(REPO_ROOT, path), "utf8"),
  }));
}

describe("text helpers: one source", () => {
  it("AC-1: the comparator body appears exactly once, in core's text.ts, which exports byCodeUnit, and no other file defines a surrogate-safe cut of its own", async () => {
    const all = sources();
    expect(all.length, "the three trees hold .ts sources").toBeGreaterThan(100);
    expect(
      all.some((s) => s.path === SHARED),
      "core's text.ts is searched",
    ).toBe(true);

    const bodies = all
      .map((s) => ({ path: s.path, count: s.text.match(BODY)?.length ?? 0 }))
      .filter((hit) => hit.count > 0);
    expect(bodies, "the comparator body: once, in core's text.ts").toEqual([{ path: SHARED, count: 1 }]);

    const ownCuts = all
      .filter((s) => s.path !== SHARED)
      .flatMap((s) => OWN_CUT.filter(({ pattern }) => pattern.test(s.text)).map(({ label }) => `${s.path}: ${label}`));
    expect(ownCuts, "no file but core's text.ts defines a surrogate-safe cut").toEqual([]);

    const { byCodeUnit } = (await import("../src/text.js")) as unknown as {
      byCodeUnit: (a: string, b: string) => number;
    };
    expect(typeof byCodeUnit, "text.ts exports byCodeUnit").toBe("function");
    expect(byCodeUnit("a", "b")).toBe(-1);
    expect(byCodeUnit("b", "a")).toBe(1);
    expect(byCodeUnit("a", "a")).toBe(0);
    const mixed = ["b", "\u{1f600}", "￿", "A", "a", "é", ""];
    expect([...mixed].sort(byCodeUnit), "code-unit order").toEqual([...mixed].sort());
  }, 120_000);
});
