import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/check.js";
import { addedLineSources } from "../src/dependencies/lockLines.js";
import { REPO_ROOT, run } from "./dependencies-helpers.js";
import { CASES, PARSE_FIXTURES, type SpikeCase } from "./dependencies-lock-lines-cases.js";
import { fixture } from "./helpers.js";

// CORE-106 spike (R4.1, not merged): D05 for pnpm, yarn berry, poetry and uv read from the lockfile's lines, with the
// merge base's sources (by package name) subtracted. The cases are the R4.3/R4.4 bypass inputs
// (product/review-2026-11-11/repro/parsers), lines after their key, aliases, other spellings, and honest changes.

/** check() on one lockfile change. The diff names the file; the reader judges every head line, so its hunk is moot. */
function input(c: Pick<SpikeCase, "path" | "base" | "head">): CheckInput {
  const header =
    c.base === null
      ? `diff --git a/${c.path} b/${c.path}\nnew file mode 100644\n--- /dev/null\n+++ b/${c.path}\n@@ -0,0 +1 @@\n+x\n`
      : `diff --git a/${c.path} b/${c.path}\n--- a/${c.path}\n+++ b/${c.path}\n@@ -1 +1 @@\n-x\n+x\n`;
  return {
    version: "0.1.0",
    coverage: { missingFile: "coverage/lcov.info" },
    diff: { text: header },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: [c.path],
    dependencySources: {
      base: { files: c.base === null ? [] : [{ path: c.path, text: c.base }], dropped: [] },
      head: { files: [{ path: c.path, text: c.head }], dropped: [] },
    },
  };
}

const d05 = (c: Pick<SpikeCase, "path" | "base" | "head">) =>
  (run(input(c)).dependencies?.signals ?? [])
    .filter((s) => s.id === "D05")
    .map((s) => `${s.name ?? "-"}@${s.version ?? "-"} ${s.detail.replace("resolved from ", "")}`);

const byName = new Map(CASES.map((c) => [c.name, c]));
const get = (name: string) => byName.get(name) as SpikeCase;

const URL_OUT = "a URL outside the allowed registries";

describe("CORE-106 spike: D05 from lockfile lines must trigger", () => {
  it.each([
    ["P-control", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["P-tab", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["P-alias", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["P-spacekey", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["T-control", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["T-inline", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["T-dotted", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["U-control", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["U-subtable", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["P-folded", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["P-plain-next-line", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["P-flow-two-lines", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["P-flow-url-alone", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["T-multiline-string", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["U-inline-table-across-lines", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["P-alias-anchor-at-base", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["P-yaml-tag", "evil-pkg@1.0.0 a local file"],
    ["P-quoted-key", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["P-git", "evil-pkg@1.0.0 a git repository"],
    ["P-directory", "evil-pkg@1.0.0 a local file"],
    ["B-url", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["B-git", `evil@1.0.0 ${URL_OUT}`],
    ["B-file", "local@1.0.0 a local file"],
    ["T-git", "evil-pkg@1.0.0 a git repository"],
    ["T-legacy-private", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["T-directory", "evil-pkg@1.0.0 a local file"],
    ["U-git", "evil-pkg@1.0.0 a git repository"],
    ["U-path", "evil-pkg@1.0.0 a local file"],
    ["U-private-registry", `evil-pkg@1.0.0 ${URL_OUT}`],
    ["U-url-with-requires-dist", `evil-pkg@1.0.0 ${URL_OUT}`],
  ])("%s", (name, expected) => {
    expect(d05(get(name))).toEqual([expected]);
  });

  it("reads the parse fixtures added whole: the same packages the structural readers flagged", () => {
    const got = PARSE_FIXTURES.map((p) => d05({ path: p.path, base: null, head: fixture(p.file) }));
    expect(got).toEqual([
      [`from-tarball@1.0.0 ${URL_OUT}`],
      [`from-git@1.0.0 ${URL_OUT}`],
      ["My_Lib@0.3.0 a git repository", `private-thing@1.2.0 ${URL_OUT}`],
      ["local-tool@0.0.1 a local file", "via-git@2.0.0 a git repository"],
    ]);
  });
});

describe("CORE-106 spike: D05 from lockfile lines must not trigger", () => {
  it.each([
    "B-workspace",
    "B-portal",
    "B-patch",
    "P-full-line-comment",
    "P-trailing-comment",
    "P-registry-add",
    "P-patched-dependency",
    "P-moved-block",
    "P-moved-block-forced",
    "P-reformatted-entry",
    "B-registry-add",
    "T-full-line-comment",
    "T-description-with-url",
    "T-description-with-key-text",
    "T-moved-block",
    "U-registry-bump",
  ])("%s", (name) => {
    expect(d05(get(name))).toEqual([]);
  });

  it("known false positive: a source key in a field the package manager does not read", () => {
    expect(d05(get("P-homepage-like"))).toEqual([`evil-pkg@1.0.0 ${URL_OUT}`]);
  });

  it("the added-lines variant misses an alias whose anchor was at the merge base, and every line of a binary diff", () => {
    const c = get("P-alias-anchor-at-base");
    const headLines = c.head.split("\n");
    const aliasLine = headLines.findIndex((l) => l.includes("*evil")) + 1;
    expect(addedLineSources("pnpm", c.head, new Set([aliasLine]), c.base)).toEqual([]);
    expect(addedLineSources("pnpm", c.head, "all", c.base).map((s) => s.name)).toEqual(["evil-pkg"]);
    const control = get("P-control");
    expect(addedLineSources("pnpm", control.head, new Set(), control.base)).toEqual([]);
  });
});
