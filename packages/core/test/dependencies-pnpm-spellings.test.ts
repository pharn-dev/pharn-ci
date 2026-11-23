import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/check.js";
import { parsePnpmLock } from "../src/dependencies/pnpmLock.js";
import type { ParsedLockfile } from "../src/dependencies/types.js";
import type { Report } from "../src/report.js";
import { dependencyCase, REPO_ROOT, run } from "./dependencies-helpers.js";
import { CASES, type PnpmCase, URL_OUT } from "./dependencies-pnpm-spellings-cases.js";
import { fixture } from "./helpers.js";
import { withoutFix } from "./without-fix.js";

// CORE-110 (R4.3): pnpm-lock.yaml is read the way pnpm reads it (js-yaml): a key may have spaces or tabs before its
// colon and a run of spaces or tabs after it, so a tarball written that way is judged (D05) and an integrity written that
// way is compared (D04). What pnpm never writes and the reader cannot read faithfully (an anchor, alias, tag, block
// scalar or merge key; a value on the line after its key; a flow mapping across lines; a duplicated key; a tab in the
// indentation; a source key whose value is no plain string) makes the lockfile unparsable: it is named unread and the
// check fails with DEPENDENCY_CHECK_INCOMPLETE, never passes silently.
//
// fixtures/dependencies/pnpm-spellings holds the ticket's inputs (product/review-2026-11-11/repro/parsers/mkpnpm.sh:
// control, tab, spacekey, alias), each must-trigger spelling beside a registry control in the same spelling, and three
// integrity changes (D04). dependencies-pnpm-spellings-cases.ts holds the CORE-106 spike's pnpm table plus the cases
// this ticket adds.

const d05ByPath = (report: Report) =>
  Object.fromEntries(
    (report.dependencies?.signals ?? [])
      .filter((s) => s.id === "D05")
      .map((s) => [s.path, [s.severity, s.line, s.name ?? null, s.version ?? null, s.detail]]),
  );
const d04ByPath = (report: Report) =>
  Object.fromEntries(
    (report.dependencies?.signals ?? [])
      .filter((s) => s.id === "D04")
      .map((s) => [s.path, [s.severity, s.line, s.name ?? null, s.version ?? null]]),
  );

const URL_D05 = `resolved from ${URL_OUT}`;

describe("pnpm-lock.yaml spellings (fixtures/dependencies/pnpm-spellings)", () => {
  const report = run(dependencyCase("pnpm-spellings"));

  it("must trigger D05: the tab form, the space-before-colon form, quoted keys and the flow control", () => {
    expect(d05ByPath(report)).toEqual({
      "control/pnpm-lock.yaml": ["block", 20, "evil-pkg", "1.0.0", URL_D05],
      "quoted-key/pnpm-lock.yaml": ["block", 20, "evil-pkg", "1.0.0", URL_D05],
      "spacekey/pnpm-lock.yaml": ["block", 20, "evil-pkg", "1.0.0", URL_D05],
      "tab/pnpm-lock.yaml": ["block", 20, "evil-pkg", "1.0.0", URL_D05],
    });
  });

  it("must trigger D04: a changed integrity written with a tab or a space before the colon", () => {
    expect(d04ByPath(report)).toEqual({
      "integrity-spacekey/pnpm-lock.yaml": ["block", 17, "left-pad", "1.3.0"],
      "integrity-tab/pnpm-lock.yaml": ["block", 17, "left-pad", "1.3.0"],
    });
  });

  it("reports the alias form as an unreadable lockfile, and reads every other spelling", () => {
    expect(report.dependencies?.unread).toEqual([{ path: "alias/pnpm-lock.yaml", reason: "unparsable" }]);
    const incomplete = withoutFix(report.messages.filter((m) => m.code === "DEPENDENCY_CHECK_INCOMPLETE"));
    expect(incomplete.map((m) => [m.level, m.text])).toEqual([
      [
        "error",
        "1 manifest or lockfile file could not be read, so dependency safety did not check it: `alias/pnpm-lock.yaml` (unparsable).",
      ],
    ]);
    expect(report.verdict).toBe("fail");
  });

  it("must not trigger: each spelling on the registry, and an unchanged integrity respelled", () => {
    const flagged = new Set((report.dependencies?.signals ?? []).map((s) => s.path));
    for (const control of [
      "tab-registry/pnpm-lock.yaml",
      "spacekey-registry/pnpm-lock.yaml",
      "quoted-registry/pnpm-lock.yaml",
      "integrity-same/pnpm-lock.yaml",
    ]) {
      expect(flagged.has(control), control).toBe(false);
    }
    expect(report.dependencies?.signals).toHaveLength(6);
  });

  it("reads the same entries from each spelling of the same lockfile", () => {
    const entries = (dir: string) => {
      const parsed = parsePnpmLock(fixture(`dependencies/pnpm-spellings/head/${dir}/pnpm-lock.yaml.txt`));
      expect(parsed, dir).not.toBeNull();
      return (parsed as ParsedLockfile).entries.map((e) => [e.key, e.name, e.version, e.integrity, e.source]);
    };
    const control = entries("control");
    for (const dir of ["tab", "spacekey", "quoted-key"]) expect(entries(dir), dir).toEqual(control);
    expect(entries("integrity-tab")).toEqual(entries("integrity-spacekey"));
  });
});

/** check() on one pnpm-lock.yaml change (the spike's harness): the reader judges both whole files, so the hunk is moot. */
function input(c: Pick<PnpmCase, "base" | "head">): CheckInput {
  const path = "pnpm-lock.yaml";
  const header =
    c.base === null
      ? `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+x\n`
      : `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-x\n+x\n`;
  return {
    version: "0.1.0",
    coverage: { missingFile: "coverage/lcov.info" },
    diff: { text: header },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: [path],
    dependencySources: {
      base: { files: c.base === null ? [] : [{ path, text: c.base }], dropped: [] },
      head: { files: [{ path, text: c.head }], dropped: [] },
    },
  };
}

function outcome(c: PnpmCase): PnpmCase["expect"] {
  const report = run(input(c));
  const unread = report.dependencies?.unread ?? [];
  const d05 = (report.dependencies?.signals ?? []).filter((s) => s.id === "D05");
  if (unread.length > 0) {
    expect(unread, c.name).toEqual([{ path: "pnpm-lock.yaml", reason: "unparsable" }]);
    expect(d05, c.name).toEqual([]);
    expect(report.verdict, c.name).toBe("fail");
    return "unread";
  }
  if (d05.length === 0) return "clean";
  expect(
    d05.map((s) => [s.name, s.version]),
    c.name,
  ).toEqual([["evil-pkg", "1.0.0"]]);
  return { d05: (d05[0] as { detail: string }).detail.replace("resolved from ", "") };
}

describe("the CORE-106 spike's pnpm cases and the CORE-110 additions", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(outcome(c)).toEqual(c.expect);
  });

  it("every bypass gives D05 or an unread lockfile, never a clean pass", () => {
    const bypasses = [
      "P-tab",
      "P-spacekey",
      "P-alias",
      "P-folded",
      "P-plain-next-line",
      "P-flow-two-lines",
      "P-flow-url-alone",
      "P-alias-anchor-at-base",
      "P-yaml-tag",
      "P-git",
      "P-directory",
    ];
    for (const name of bypasses) {
      const c = CASES.find((x) => x.name === name) as PnpmCase;
      expect(c.expect, name).not.toBe("clean");
    }
    const honest = [
      "P-full-line-comment",
      "P-trailing-comment",
      "P-registry-add",
      "P-patched-dependency",
      "P-moved-block",
      "P-moved-block-forced",
      "P-reformatted-entry",
      "P-homepage-like",
    ];
    for (const name of honest) expect((CASES.find((x) => x.name === name) as PnpmCase).expect, name).toBe("clean");
  });
});

describe("parsePnpmLock on what pnpm never writes", () => {
  const lock = (body: string) => parsePnpmLock(`lockfileVersion: '9.0'\n${body}`);

  it.each([
    ["an alias", "a: *x\n"],
    ["an anchor", "a: &x b\n"],
    ["a tag", "a: !!str b\n"],
    ["a literal block scalar", "a: |\n  b\n"],
    ["a folded block scalar", "a: >-\n  b\n"],
    ["a merge key", "a:\n  <<: {b: c}\n"],
    ["a merge key in a flow mapping", "a: {<<: {b: c}}\n"],
    ["an anchor on a key", "&x a: b\n"],
    ["a complex key", "? [a]\n: b\n"],
    ["an explicit key with no value line", "? a\nb: c\n"],
    ["an explicit key at the end", "? a\n"],
    ["a lone CR", "a: b\rc: d\n"],
    ["a value on the next line", "a:\n  b\n"],
    ["a flow mapping across lines", "a: {b: c,\n  d: e}\n"],
    ["an unclosed quote", "a: 'b\n"],
    ["text after a closing quote", "a: 'b' c\n"],
    ["a duplicated key", "a: b\na: c\n"],
    ["a key duplicated by its spelling", "a: b\n'a' : c\n"],
    ["a duplicated flow key", "a: {b: c, b: d}\n"],
    ["a tab in the indentation", "a:\n\tb: c\n"],
    ["a child under a scalar", "a: b\n  c: d\n"],
    ["a child under a flow mapping", "a: {b: c}\n  d: e\n"],
    ["a colon and space in a plain value", "a: b: c\n"],
    ["a document marker after content", "a: b\n---\nc: d\n"],
    ["a document end marker", "a: b\n...\n"],
    ["a directive", "%YAML 1.2\n"],
    ["an empty key", ": b\n"],
  ])("refuses %s", (_label, body) => {
    expect(lock(body)).toBeNull();
  });

  it("reads comments, quoted keys, tabs after a colon, an empty flow mapping and a lone leading document marker", () => {
    const parsed = parsePnpmLock(
      `---\n# c\nlockfileVersion: '9.0' # trailing\nimporters:\n  .: {}\npackages:\n  'a@1.0.0' :\n    resolution:\t{integrity:\tsha512-x, tarball: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz' } # c\n  "b@2.0.0":\n    resolution:  {}\n`,
    );
    expect(parsed).not.toBeNull();
    expect((parsed as ParsedLockfile).entries.map((e) => [e.key, e.integrity, e.source.kind])).toEqual([
      ["a@1.0.0", "sha512-x", "url"],
      ["b@2.0.0", null, "registry"],
    ]);
  });
});
