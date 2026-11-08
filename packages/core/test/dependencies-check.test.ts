import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/check.js";
import type { Report } from "../src/report.js";
import { dependencyCase, run } from "./dependencies-helpers.js";
import { fixture } from "./helpers.js";
import { withoutFix } from "./v090-codes.js";

// A13 (dependency safety), D04 and D05 through check(), on the fixture cases under fixtures/dependencies/ (see
// dependencies-helpers.ts). d04-* and d05-* must trigger; clean-bump (a Dependabot bump of this repository, #119),
// lockfile-refresh (a transitive refresh) and workspace must not.

// fix-hints (H6): every message now carries a `fix`; the pinned literals are unchanged, so they are read without it.
const dependencyMessages = (report: Report) =>
  withoutFix(report.messages.filter((m) => m.code.startsWith("DEPENDENCY_")));
const brief = (report: Report) =>
  (report.dependencies?.signals ?? []).map((s) => [
    s.id,
    s.severity,
    s.path,
    s.line,
    s.name ?? null,
    s.version ?? null,
  ]);

describe("dependency safety must not trigger", () => {
  it("clean-bump: a Dependabot bump of this repository (package.json and pnpm-lock.yaml together)", () => {
    const report = run(dependencyCase("clean-bump"));
    expect(report.dependencies).toEqual({ checked: 4, lookups: "off", signals: [] });
    expect(dependencyMessages(report)).toEqual([]);
  });

  it("lockfile-refresh: a lockfile-only refresh of a transitive dependency", () => {
    const report = run(dependencyCase("lockfile-refresh"));
    expect(report.dependencies).toEqual({ checked: 1, lookups: "off", signals: [] });
    expect(dependencyMessages(report)).toEqual([]);
  });

  it("workspace: a member's dependency recorded in the root pnpm importer; a package.json no lockfile governs", () => {
    const report = run(dependencyCase("workspace"));
    expect(report.dependencies?.signals).toEqual([]);
    expect(report.dependencies?.checked).toBe(3);
  });

  it("adds nothing without the sources, in mode never, or when no manifest or lockfile is touched", () => {
    const { dependencySources: _, ...without } = dependencyCase("d04-lock-untouched");
    expect(run(without).dependencies).toBeUndefined();
    expect(
      run(dependencyCase("d04-lock-untouched", { dependencySettings: { input: "never" } })).dependencies,
    ).toBeUndefined();
    const untouched = dependencyCase("d04-lock-untouched", {
      diff: { text: fixture("exercise/warn-no-test/change.diff") },
    });
    const report = run(untouched);
    expect(report.dependencies).toBeUndefined();
    expect(dependencyMessages(report)).toEqual([]);
  });
});

describe("dependency safety must trigger", () => {
  it("d04-lock-untouched: a dependency added to package.json while its pnpm-lock.yaml did not change", () => {
    const report = run(dependencyCase("d04-lock-untouched"));
    expect(brief(report)).toEqual([["D04", "block", "package.json", 6, null, null]]);
    expect(report.dependencies?.signals[0]?.detail).toBe(
      "dependencies changed but the lockfile pnpm-lock.yaml did not",
    );
    expect(dependencyMessages(report)).toEqual([
      {
        level: "error",
        code: "DEPENDENCY_D04",
        text: "1 lockfile drift finding: a manifest's dependencies and its lockfile do not agree, or a lockfile gives a version a different hash than the merge base did: `package.json:6`.",
      },
    ]);
    expect(report.verdict).toBe("fail");
  });

  it("d04-not-recorded: the lockfile changed but does not record one added dependency", () => {
    const report = run(dependencyCase("d04-not-recorded"));
    expect(brief(report)).toEqual([["D04", "block", "package.json", 7, "left-pad", "^1.3.0"]]);
    expect(report.dependencies?.checked).toBe(4);
  });

  it("d04-integrity: a lockfile-only change gives the same version a new hash", () => {
    const report = run(dependencyCase("d04-integrity"));
    expect(brief(report)).toEqual([["D04", "block", "yarn.lock", 10, "lodash", "4.17.21"]]);
    expect(report.dependencies?.signals[0]?.detail).toBe(
      "the same version has a different integrity hash than at the merge base",
    );
  });

  it("d05-manifest: git, URL and local-file specs added to package.json; registry aliases and workspaces pass", () => {
    const report = run(dependencyCase("d05-manifest"));
    expect(brief(report)).toEqual([
      ["D05", "block", "package.json", 7, "from-git", null],
      ["D05", "block", "package.json", 8, "from-tarball", null],
      ["D05", "block", "package.json", 9, "from-disk", null],
    ]);
    expect(report.dependencies?.signals.map((s) => s.detail)).toEqual([
      "declared from a git repository",
      "declared from a URL outside the allowed registries",
      "declared from a local file",
    ]);
    expect(dependencyMessages(report).map((m) => [m.level, m.code])).toEqual([["error", "DEPENDENCY_D05"]]);
  });

  it("d05-lockfile: lockfile entries resolved from another host and from git; a workspace link passes", () => {
    const report = run(dependencyCase("d05-lockfile"));
    expect(brief(report)).toEqual([
      ["D05", "block", "package-lock.json", 21, "from-git", "1.0.0"],
      ["D05", "block", "package-lock.json", 25, "left-pad", "1.3.0"],
    ]);
  });

  it("python-requirements: a new package index and a git requirement; a hashed version bump passes", () => {
    const report = run(dependencyCase("python-requirements"));
    expect(brief(report)).toEqual([
      ["D05", "block", "requirements.txt", 3, null, null],
      ["D05", "block", "requirements.txt", 7, "mypkg", null],
    ]);
    expect(report.dependencies?.signals.map((s) => s.ecosystem)).toEqual(["pypi", "pypi"]);
    expect(report.dependencies?.checked).toBe(3);
  });

  it("python-uv-drift: a dependency added to pyproject.toml while uv.lock did not change", () => {
    const report = run(dependencyCase("python-uv-drift"));
    expect(brief(report)).toEqual([["D04", "block", "pyproject.toml", 8, null, null]]);
    expect(report.dependencies?.signals[0]?.detail).toBe("dependencies changed but the lockfile uv.lock did not");
  });
});

describe("files that could not be read", () => {
  it("names a dropped or unparsable file in unread with one DEPENDENCY_CHECK_INCOMPLETE warning, and judges it no further", () => {
    const input = dependencyCase("d04-not-recorded");
    const sources = input.dependencySources as NonNullable<CheckInput["dependencySources"]>;
    const head = sources.head as { files: Array<{ path: string; text: string }>; dropped: [] };
    const report = run({
      ...input,
      dependencySources: {
        base: sources.base,
        head: {
          files: head.files
            .filter((f) => f.path !== "package-lock.json")
            .map((f) => (f.path === "package.json" ? { ...f, text: "{ not json" } : f)),
          dropped: [{ path: "package-lock.json", reason: "too-large" }],
        },
      },
    });
    expect(report.dependencies?.unread).toEqual([
      { path: "package-lock.json", reason: "too-large" },
      { path: "package.json", reason: "unparsable" },
    ]);
    expect(report.dependencies?.signals).toEqual([]);
    expect(dependencyMessages(report)).toEqual([
      {
        level: "warn",
        code: "DEPENDENCY_CHECK_INCOMPLETE",
        text: "2 manifest or lockfile files could not be read, so dependency safety did not check them: `package-lock.json` (too-large), `package.json` (unparsable).",
      },
    ]);
  });

  it("names every touched file unavailable when a side could not be read", () => {
    const input = dependencyCase("d05-manifest", {
      dependencySources: { base: { unavailable: "x" }, head: { unavailable: "x" } },
    });
    const report = run(input);
    expect(report.dependencies).toEqual({
      checked: 0,
      lookups: "off",
      signals: [],
      unread: [{ path: "package.json", reason: "unavailable" }],
    });
  });

  it("keeps at most 200 signals and counts the rest in truncated", () => {
    const deps = Array.from({ length: 205 }, (_, i) => `    "g${i}": "github:o/g${i}"`).join(",\n");
    const head = `{\n  "dependencies": {\n${deps}\n  }\n}\n`;
    const report = run(
      dependencyCase("d05-manifest", {
        dependencySources: {
          base: { files: [{ path: "package.json", text: "{}" }], dropped: [] },
          head: { files: [{ path: "package.json", text: head }], dropped: [] },
        },
      }),
    );
    expect(report.dependencies?.signals).toHaveLength(200);
    expect(report.dependencies?.truncated).toBe(5);
    expect(dependencyMessages(report)[0]?.text).toMatch(/^205 dependencies come from outside the allowed registries/);
  });
});
