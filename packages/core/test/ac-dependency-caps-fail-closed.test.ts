import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/check.js";
import type { DependencyUnreadReason } from "../src/dependencies/check.js";
import { checkIncompleteMessage } from "../src/dependencies/messages.js";
import type { Report } from "../src/report.js";
import {
  DEPENDENCY_SOURCE_LIMITS,
  planTestSourceReads,
  TEST_SOURCE_DROP_REASONS,
  type TestSourceObject,
} from "../src/testSources.js";
import { dependencyCase, run, sideFiles } from "./dependencies-helpers.js";
import { FIXTURES } from "./helpers.js";

// CORE-100 part 2 (R3.2, decision Q2): a cut the pull request can cause is an error where the check can block. A
// manifest or lockfile that dependency safety could not read because of the file itself (unparsable, over a cap, binary,
// missing at its revision, an unsafe path) gives DEPENDENCY_CHECK_INCOMPLETE at level error; a side git could not read
// at all (`unavailable`, the runner's doing) stays a warning. The per-file cap is 32 MiB, the same as the per-side total.
// Large inputs are generated here, never committed. Every report goes through `run`, which validates it against the
// schema (expectValidReport).

const MIB = 1_048_576;
const incomplete = (report: Report) => report.messages.filter((m) => m.code === "DEPENDENCY_CHECK_INCOMPLETE");
const dependencyCodes = (report: Report) =>
  report.messages.filter((m) => m.code.startsWith("DEPENDENCY_")).map((m) => [m.level, m.code]);
const blob = (size: number): TestSourceObject => ({ type: "blob", size });

/** A dependency case whose head side drops `path` for `reason` instead of holding its text. */
function droppedAtHead(name: string, path: string, reason: (typeof TEST_SOURCE_DROP_REASONS)[number]): CheckInput {
  const input = dependencyCase(name);
  const sources = input.dependencySources as NonNullable<CheckInput["dependencySources"]>;
  const head = sources.head as { files: Array<{ path: string; text: string }> };
  return {
    ...input,
    dependencySources: {
      base: sources.base,
      head: { files: head.files.filter((file) => file.path !== path), dropped: [{ path, reason }] },
    },
  };
}

/** A pnpm-lock.yaml of at least `bytes` bytes: many registry entries, then (with `gitEntry`) one entry resolved from
 * a tarball URL on a git host, which D05 reports as a URL outside the allowed registries. */
function pnpmLock(bytes: number, gitEntry: boolean): string {
  const parts = [
    "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      p0:\n        specifier: 1.0.0\n",
  ];
  parts.push("        version: 1.0.0\n\npackages:\n\n");
  let length = parts.join("").length;
  for (let i = 0; length < bytes; i++) {
    const entry = `  p${i}@1.0.${i}:\n    resolution: {integrity: sha512-${"B".repeat(86)}==}\n    engines: {node: '>=18'}\n\n`;
    parts.push(entry);
    length += entry.length;
  }
  if (gitEntry) {
    parts.push(
      "  from-git@https://codeload.github.com/someone/from-git/tar.gz/0123456789abcdef0123456789abcdef01234567:\n",
      "    resolution: {tarball: https://codeload.github.com/someone/from-git/tar.gz/0123456789abcdef0123456789abcdef01234567}\n",
      "    version: 1.0.0\n",
    );
  }
  return parts.join("");
}

const LOCK_DIFF = [
  "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
  "index 1111111..2222222 100644",
  "--- a/pnpm-lock.yaml",
  "+++ b/pnpm-lock.yaml",
  "@@ -12,0 +13,3 @@ packages:",
  "+  from-git@https://codeload.github.com/someone/from-git/tar.gz/0123456789abcdef0123456789abcdef01234567:",
  "+    resolution: {tarball: https://codeload.github.com/someone/from-git/tar.gz/0123456789abcdef0123456789abcdef01234567}",
  "+    version: 1.0.0",
  "",
].join("\n");

describe("CORE-100 part 2: dependency caps fail closed", () => {
  it("AC-1: an unparsable package.json, pyproject.toml and pnpm-lock.yaml in the diff give DEPENDENCY_CHECK_INCOMPLETE at level error and verdict fail", () => {
    const input = dependencyCase("unparsable");
    const sources = input.dependencySources as NonNullable<CheckInput["dependencySources"]>;
    // Control: the merge-base versions of the same three files are read, so the head edits are what make them unread.
    const readable = run({
      ...input,
      dependencySources: {
        base: sources.base,
        head: { files: sideFiles(`${FIXTURES}dependencies/unparsable/base`), dropped: [] },
      },
    });
    expect(readable.dependencies?.unread, "control: the base versions parse").toBeUndefined();

    const report = run(input);
    expect(report.dependencies?.unread).toEqual([
      { path: "package.json", reason: "unparsable" },
      { path: "pnpm-lock.yaml", reason: "unparsable" },
      { path: "pyproject.toml", reason: "unparsable" },
    ]);
    expect(report.dependencies?.signals).toEqual([]);
    expect(incomplete(report).map((m) => [m.level, m.text])).toEqual([
      [
        "error",
        "3 manifest or lockfile files could not be read, so dependency safety did not check them: `package.json` (unparsable), `pnpm-lock.yaml` (unparsable), `pyproject.toml` (unparsable).",
      ],
    ]);
    expect(report.verdict).toBe("fail");
  });

  it("AC-2: with dependencies: never the same diff gives no dependency message and no dependencies object", () => {
    const on = run(dependencyCase("unparsable"));
    expect(dependencyCodes(on), "control: with dependency safety on it is an error").toEqual([
      ["error", "DEPENDENCY_CHECK_INCOMPLETE"],
    ]);
    const off = run(dependencyCase("unparsable", { dependencySettings: { input: "never" } }));
    expect(off.dependencies).toBeUndefined();
    expect(dependencyCodes(off)).toEqual([]);
    expect(off.verdict).not.toBe("fail");
  });

  it("AC-3: a lockfile over 32 MiB is not read and gives an error whose text names the 32 MiB cap", () => {
    expect(DEPENDENCY_SOURCE_LIMITS).toEqual({ files: 100, fileBytes: 33_554_432, totalBytes: 33_554_432 });
    const at = planTestSourceReads(
      ["pnpm-lock.yaml"],
      new Map([["pnpm-lock.yaml", blob(32 * MIB)]]),
      DEPENDENCY_SOURCE_LIMITS,
    );
    expect(at, "control: a lockfile of exactly 32 MiB is read").toEqual({ read: ["pnpm-lock.yaml"], dropped: [] });
    const over = planTestSourceReads(
      ["pnpm-lock.yaml"],
      new Map([["pnpm-lock.yaml", blob(32 * MIB + 1)]]),
      DEPENDENCY_SOURCE_LIMITS,
    );
    expect(over).toEqual({ read: [], dropped: [{ path: "pnpm-lock.yaml", reason: "too-large" }] });

    const report = run(droppedAtHead("lockfile-refresh", "pnpm-lock.yaml", "too-large"));
    expect(report.dependencies?.unread).toEqual([{ path: "pnpm-lock.yaml", reason: "too-large" }]);
    expect(incomplete(report).map((m) => [m.level, m.text])).toEqual([
      [
        "error",
        "1 manifest or lockfile file could not be read, so dependency safety did not check it: `pnpm-lock.yaml` (too-large: over the 32 MiB cap for one file).",
      ],
    ]);
    expect(report.verdict).toBe("fail");
  });

  it("AC-4: a generated 20 MiB pnpm-lock.yaml is read and judged: its D05 signal appears and nothing is unread", () => {
    const base = pnpmLock(4096, false);
    const head = pnpmLock(20 * MIB, true);
    const bytes = Buffer.byteLength(head, "utf8");
    expect(bytes).toBeGreaterThanOrEqual(20 * MIB);
    const plan = planTestSourceReads(
      ["pnpm-lock.yaml"],
      new Map([["pnpm-lock.yaml", blob(bytes)]]),
      DEPENDENCY_SOURCE_LIMITS,
    );
    expect(plan, "control: the read plan keeps a 20 MiB lockfile").toEqual({ read: ["pnpm-lock.yaml"], dropped: [] });

    const report = run({
      ...dependencyCase("lockfile-refresh"),
      diff: { text: LOCK_DIFF },
      repoFiles: ["pnpm-lock.yaml"],
      dependencySources: {
        base: { files: [{ path: "pnpm-lock.yaml", text: base }], dropped: [] },
        head: { files: [{ path: "pnpm-lock.yaml", text: head }], dropped: [] },
      },
    });
    expect(report.dependencies?.unread).toBeUndefined();
    expect(incomplete(report)).toEqual([]);
    const signals = report.dependencies?.signals ?? [];
    expect(signals.map((s) => [s.id, s.severity, s.path, s.detail])).toEqual([
      ["D05", "block", "pnpm-lock.yaml", "resolved from a URL outside the allowed registries"],
    ]);
    expect(report.dependencies?.checked).toBeGreaterThan(100_000);
    expect(report.verdict).toBe("fail");
  });

  it("AC-5: the level of DEPENDENCY_CHECK_INCOMPLETE by unread reason: error for every reason the pull request can cause, warn only when every file is unavailable", () => {
    const levels: Record<DependencyUnreadReason, "error" | "warn"> = {
      "too-large": "error",
      "over-file-cap": "error",
      "over-total-cap": "error",
      binary: "error",
      missing: "error",
      "unsafe-path": "error",
      unparsable: "error",
      unavailable: "warn",
    };
    expect(Object.keys(levels).sort()).toEqual([...TEST_SOURCE_DROP_REASONS, "unavailable", "unparsable"].sort());
    for (const [reason, level] of Object.entries(levels)) {
      expect(checkIncompleteMessage([{ path: "pnpm-lock.yaml", reason }]).level, reason).toBe(level);
    }
    expect(
      checkIncompleteMessage([
        { path: "a/package.json", reason: "unavailable" },
        { path: "b/package.json", reason: "unavailable" },
      ]).level,
      "every file unavailable",
    ).toBe("warn");
    expect(
      checkIncompleteMessage([
        { path: "a/package.json", reason: "unavailable" },
        { path: "b/pnpm-lock.yaml", reason: "over-total-cap" },
      ]).level,
      "one file the pull request can cause",
    ).toBe("error");

    // Through check(): each drop reason at the head side is an error and fails the verdict; an unreadable side warns.
    for (const reason of TEST_SOURCE_DROP_REASONS) {
      const report = run(droppedAtHead("lockfile-refresh", "pnpm-lock.yaml", reason));
      expect(report.dependencies?.unread, reason).toEqual([{ path: "pnpm-lock.yaml", reason }]);
      expect(dependencyCodes(report), reason).toEqual([["error", "DEPENDENCY_CHECK_INCOMPLETE"]]);
      expect(report.verdict, reason).toBe("fail");
    }
    const unavailable = run(
      dependencyCase("lockfile-refresh", {
        dependencySources: { base: { unavailable: "x" }, head: { unavailable: "x" } },
      }),
    );
    expect(unavailable.dependencies?.unread).toEqual([{ path: "pnpm-lock.yaml", reason: "unavailable" }]);
    expect(dependencyCodes(unavailable)).toEqual([["warn", "DEPENDENCY_CHECK_INCOMPLETE"]]);
    expect(unavailable.verdict).not.toBe("fail");

    // The caps a file went past are named; no other reason gains words.
    const text = (reason: string) => checkIncompleteMessage([{ path: "pnpm-lock.yaml", reason }]).text;
    expect(text("too-large")).toContain("`pnpm-lock.yaml` (too-large: over the 32 MiB cap for one file)");
    expect(text("over-total-cap")).toContain("`pnpm-lock.yaml` (over-total-cap: past the 32 MiB cap for one side)");
    expect(text("over-file-cap")).toContain("`pnpm-lock.yaml` (over-file-cap: past the 100-file cap for one side)");
    for (const reason of ["binary", "missing", "unsafe-path", "unparsable", "unavailable"]) {
      expect(text(reason), reason).toContain(`\`pnpm-lock.yaml\` (${reason}).`);
    }
  });

  it('AC-6: a pyproject.toml whose description holds """A \\"""quoted\\""" word""" stays readable; the same file cut short is an error', () => {
    const input = dependencyCase("python-escaped-description");
    const report = run(input);
    expect(report.dependencies?.unread).toBeUndefined();
    expect(dependencyCodes(report)).toEqual([["error", "DEPENDENCY_D05"]]);

    const sources = input.dependencySources as NonNullable<CheckInput["dependencySources"]>;
    const head = sources.head as { files: Array<{ path: string; text: string }> };
    const cut = run({
      ...input,
      dependencySources: {
        base: sources.base,
        head: {
          files: head.files.map((file) => ({ ...file, text: file.text.replace('word"""', "word") })),
          dropped: [],
        },
      },
    });
    expect(cut.dependencies?.unread).toEqual([{ path: "pyproject.toml", reason: "unparsable" }]);
    expect(dependencyCodes(cut), "control: an unclosed description is an error").toEqual([
      ["error", "DEPENDENCY_CHECK_INCOMPLETE"],
    ]);
  });
});
