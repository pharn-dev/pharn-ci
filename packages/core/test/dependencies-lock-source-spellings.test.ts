import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/check.js";
import { parsePythonLock } from "../src/dependencies/pythonLock.js";
import { parsePyproject } from "../src/dependencies/pythonManifest.js";
import type { Report } from "../src/report.js";
import { dependencyCase, REPO_ROOT, run } from "./dependencies-helpers.js";
import { CASES, type LockCase } from "./dependencies-lock-source-cases.js";
import { fixture } from "./helpers.js";

// CORE-114 (R4.4): poetry.lock and uv.lock read a package's source from the TOML document tree, so a source written as
// a `[package.source]` sub-table, an inline table or dotted keys (`source.url = …`) is the same source, for both
// formats; the packages themselves may also be a static `package = [ … ]` array. Before, poetry read only the sub-table
// and uv only the inline table (with dotted keys kept as one flat key), so an off-registry source written the other way
// passed D05.
//
// fixtures/dependencies/lock-source-spellings adds one lockfile per format and spelling (sub-table, inline, dotted,
// package array) whose package resolves from a URL outside the allowed registries, each beside a control that spells
// a registry source the same way. Real poetry 2.5.1 (`poetry check --lock`, `poetry install --dry-run`) and uv 0.13.9
// (`uv export --frozen`, `uv sync --frozen --dry-run`) accept all sixteen and install the package from the URL in each
// spelling (recorded in the PR).

const URL_OUT = "resolved from a URL outside the allowed registries";

const d05ByPath = (report: Report) =>
  Object.fromEntries(
    (report.dependencies?.signals ?? [])
      .filter((s) => s.id === "D05")
      .map((s) => [s.path, [s.severity, s.line, s.name ?? null, s.detail]]),
  );

describe("poetry.lock and uv.lock sources in every spelling reach D05", () => {
  const report = run(dependencyCase("lock-source-spellings"));

  it("flags the off-registry source in each spelling, for both formats", () => {
    expect(d05ByPath(report)).toEqual({
      "poetry-dotted/poetry.lock": ["block", 3, "evil-pkg", URL_OUT],
      "poetry-inline/poetry.lock": ["block", 3, "evil-pkg", URL_OUT],
      "poetry-package-array/poetry.lock": ["block", 3, "evil-pkg", URL_OUT],
      "poetry-subtable/poetry.lock": ["block", 3, "evil-pkg", URL_OUT],
      "uv-dotted/uv.lock": ["block", 16, "evil-pkg", URL_OUT],
      "uv-inline/uv.lock": ["block", 16, "evil-pkg", URL_OUT],
      "uv-package-array/uv.lock": ["block", 6, "evil-pkg", URL_OUT],
      "uv-subtable/uv.lock": ["block", 16, "evil-pkg", URL_OUT],
    });
    expect(report.dependencies?.signals.every((s) => s.id === "D05")).toBe(true);
    expect(report.dependencies?.unread).toBeUndefined();
    expect(report.verdict).toBe("fail");
  });

  it("passes a registry source in each spelling, for both formats", () => {
    const flagged = Object.keys(d05ByPath(report));
    for (const control of [
      "poetry-dotted-registry/poetry.lock",
      "poetry-inline-registry/poetry.lock",
      "poetry-package-array-registry/poetry.lock",
      "poetry-subtable-registry/poetry.lock",
      "uv-dotted-registry/uv.lock",
      "uv-inline-registry/uv.lock",
      "uv-package-array-registry/uv.lock",
      "uv-subtable-registry/uv.lock",
    ]) {
      expect(flagged, control).not.toContain(control);
    }
  });

  it("reads the same source from every spelling of one format", () => {
    const source = (dir: string, format: "poetry" | "uv") => {
      const name = format === "poetry" ? "poetry.lock" : "uv.lock";
      const parsed = parsePythonLock(fixture(`dependencies/lock-source-spellings/head/${dir}/${name}.txt`), format);
      return parsed?.entries.map((e) => [e.name, e.version, e.source]);
    };
    for (const format of ["poetry", "uv"] as const) {
      for (const kind of ["", "-registry"]) {
        const spellings = ["subtable", "inline", "dotted", "package-array"].map((s) =>
          source(`${format}-${s}${kind}`, format),
        );
        expect(spellings[0], `${format}${kind}`).toBeDefined();
        for (const other of spellings.slice(1)) expect(other, `${format}${kind}`).toEqual(spellings[0]);
      }
    }
    expect(source("poetry-dotted", "poetry")).toEqual([
      ["evil-pkg", "1.0.0", { kind: "url", allowed: false, text: "https://evil.example/evil-pkg-1.0.0.tar.gz" }],
    ]);
    expect(source("uv-subtable-registry", "uv")?.[1]).toEqual([
      "certifi",
      "2024.7.4",
      { kind: "url", allowed: true, text: "https://pypi.org/simple" },
    ]);
  });

  it("leaves a lockfile whose packages or source are not tables unread, never passed", () => {
    for (const text of [
      'package = "x"\n',
      'package = ["x"]\n',
      '[[package]]\nname = "evil-pkg"\nversion = "1.0.0"\nsource = "https://evil.example/evil-pkg-1.0.0.tar.gz"\n',
    ]) {
      expect(parsePythonLock(text, "poetry"), text).toBeNull();
      expect(parsePythonLock(text, "uv"), text).toBeNull();
    }
    expect(parsePythonLock('[[package]]\nsource.url = "u"\n[package.source]\ntype = "url"\n', "poetry")).toBeNull();
  });
});

describe("pyproject.toml on the nested TOML reader", () => {
  it("reads a dotted key under a dependency table as that dependency's table, where it was one flat name", () => {
    const deps = (text: string) => parsePyproject(text)?.deps.map((d) => [d.section, d.name, d.kind, d.spec, d.line]);
    expect(
      deps(
        '[tool.poetry.dependencies]\npython = "^3.11"\nevil.git = "https://github.com/someone/evil.git"\nok.version = "^1.0"\n' +
          '[tool.uv.sources]\nlib.git = "https://github.com/someone/lib"\n',
      ),
    ).toEqual([
      ["tool.poetry.dependencies", "evil", "git", "git:https://github.com/someone/evil.git", 3],
      ["tool.poetry.dependencies", "ok", "registry", "^1.0", 4],
      ["tool.uv.sources", "lib", "git", "git:https://github.com/someone/lib", 6],
    ]);
  });

  it("refuses a pyproject.toml that defines a key twice, as TOML does", () => {
    expect(parsePyproject('[project]\nname = "a"\nname = "b"\n')).toBeNull();
    expect(parsePyproject('[project]\nname = "a"\n[project]\nversion = "1"\n')).toBeNull();
  });
});

// The CORE-106 spike's poetry and uv cases (dependencies-lock-source-cases.ts), each through check() as one lockfile
// change. A bypass must give D05 or leave the lockfile unread (DEPENDENCY_CHECK_INCOMPLETE, an error); an honest change
// must give neither.

/** check() on one lockfile change. The diff names the file; the reader reads the whole file at each side. */
function input(c: Pick<LockCase, "path" | "base" | "head">): CheckInput {
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

/** The D05 findings as `name@version detail`, or `unread` with the unread reason. */
const outcome = (c: LockCase) => {
  const report = run(input(c));
  const unread = report.dependencies?.unread ?? [];
  if (unread.length > 0) {
    const incomplete = report.messages.find((m) => m.code === "DEPENDENCY_CHECK_INCOMPLETE");
    return [`unread ${unread.map((u) => u.reason).join(",")} ${incomplete?.level}`];
  }
  return (report.dependencies?.signals ?? [])
    .filter((s) => s.id === "D05")
    .map((s) => `${s.name ?? "-"}@${s.version ?? "-"} ${s.detail}`);
};

const byName = new Map(CASES.map((c) => [c.name, c]));
const get = (name: string) => byName.get(name) as LockCase;

describe("the CORE-106 spike's poetry and uv cases", () => {
  it("covers every poetry and uv case of the spike", () => {
    expect(CASES.map((c) => c.name)).toEqual([
      "T-control",
      "T-inline",
      "T-dotted",
      "U-control",
      "U-subtable",
      "T-multiline-string",
      "U-inline-table-across-lines",
      "U-array-across-lines",
      "T-git",
      "T-legacy-private",
      "T-directory",
      "U-git",
      "U-path",
      "U-private-registry",
      "U-url-with-requires-dist",
      "T-full-line-comment",
      "T-description-with-url",
      "T-description-with-key-text",
      "T-moved-block",
      "U-registry-bump",
    ]);
  });

  it.each([
    ["T-control", "evil-pkg@1.0.0 a URL outside the allowed registries"],
    ["T-inline", "evil-pkg@1.0.0 a URL outside the allowed registries"],
    ["T-dotted", "evil-pkg@1.0.0 a URL outside the allowed registries"],
    ["U-control", "evil-pkg@1.0.0 a URL outside the allowed registries"],
    ["U-subtable", "evil-pkg@1.0.0 a URL outside the allowed registries"],
    ["T-multiline-string", "evil-pkg@1.0.0 a URL outside the allowed registries"],
    ["U-inline-table-across-lines", "evil-pkg@1.0.0 a URL outside the allowed registries"],
    // A value on the line after its key inside an inline table is not TOML (poetry refuses it; uv 0.13.9 reads it):
    // the file is unread, an error, never a clean pass.
    ["U-array-across-lines", "unread unparsable error"],
    ["T-git", "evil-pkg@1.0.0 a git repository"],
    ["T-legacy-private", "evil-pkg@1.0.0 a URL outside the allowed registries"],
    ["T-directory", "evil-pkg@1.0.0 a local file"],
    ["U-git", "evil-pkg@1.0.0 a git repository"],
    ["U-path", "evil-pkg@1.0.0 a local file"],
    ["U-private-registry", "evil-pkg@1.0.0 a URL outside the allowed registries"],
    ["U-url-with-requires-dist", "evil-pkg@1.0.0 a URL outside the allowed registries"],
  ])("%s gives D05 or an unread lockfile", (name, expected) => {
    expect(outcome(get(name)).map((o) => o.replace("resolved from ", ""))).toEqual([expected]);
  });

  it.each([
    "T-full-line-comment",
    "T-description-with-url",
    "T-description-with-key-text",
    "T-moved-block",
    "U-registry-bump",
  ])("%s gives neither D05 nor an unread lockfile", (name) => {
    expect(outcome(get(name))).toEqual([]);
  });
});
