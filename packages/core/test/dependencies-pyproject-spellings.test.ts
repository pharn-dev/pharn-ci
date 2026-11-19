import { describe, expect, it } from "vitest";
import { parsePyproject } from "../src/dependencies/pythonManifest.js";
import type { ParsedManifest } from "../src/dependencies/types.js";
import type { Report } from "../src/report.js";
import { dependencyCase, run } from "./dependencies-helpers.js";
import { fixture } from "./helpers.js";

// CORE-116 (R4.6): pyproject.toml is read from the nested TOML document (parseTomlDocument), so a dependency written as
// its own sub-table (`[tool.poetry.dependencies.evil-pkg]`), as an inline table or with dotted keys is one dependency,
// and the places that name a package source beside the dependency tables are read too: `[build-system] requires`
// (installed and run at build time), `[[tool.poetry.source]]`, `[[tool.uv.index]]` and uv's `index-url`,
// `extra-index-url` and `find-links` (an extra package index, as `--extra-index-url` is in a requirements file). An
// array of sources for one dependency (uv's multiple sources, poetry's multiple constraints) is read item by item.
//
// fixtures/dependencies/pyproject-spellings adds one pyproject.toml per case, each beside a control that spells a
// registry source the same way; real poetry 2.5.1 (`poetry check`) and uv 0.13.9 (`uv lock --dry-run`) accept every
// file (recorded in the PR). fixtures/dependencies/pyproject-d04 changes a poetry dependency written as a sub-table and
// as an inline table next to an untouched poetry.lock, with a control whose lockfile records it and one that changes
// only `[build-system] requires`, which no lockfile records.

const d05ByPath = (report: Report) => {
  const out: Record<string, Array<[number | null, string | null, string]>> = {};
  for (const s of report.dependencies?.signals ?? []) {
    if (s.id !== "D05") continue;
    const list = out[s.path] ?? [];
    list.push([s.line, s.name ?? null, s.detail]);
    out[s.path] = list;
  }
  return out;
};

const GIT = "declared from a git repository";
const INDEX = "adds a package index outside the allowed registries";

const read = (text: string): ParsedManifest => {
  const parsed = parsePyproject(text);
  expect(parsed, text).not.toBeNull();
  return parsed as ParsedManifest;
};
const deps = (text: string) => read(text).deps.map((d) => [d.section, d.name, d.kind, d.spec]);
const indexes = (text: string) => read(text).indexes.map((o) => [o.url, o.line, o.allowed, o.table]);

describe("pyproject.toml sources in every spelling reach D05", () => {
  const report = run(dependencyCase("pyproject-spellings"));

  it("flags each must-trigger case", () => {
    expect(d05ByPath(report)).toEqual({
      "build-system/pyproject.toml": [[4, "evil", GIT]],
      "poetry-constraints-array/pyproject.toml": [[14, "evil-pkg", GIT]],
      "poetry-group-subtable/pyproject.toml": [[10, "evil-pkg", GIT]],
      "poetry-source-allowed-host/pyproject.toml": [[12, null, `${INDEX} in tool.poetry.source`]],
      "poetry-source/pyproject.toml": [[15, null, `${INDEX} in tool.poetry.source`]],
      "poetry-subtable/pyproject.toml": [[13, "evil-pkg", GIT]],
      "uv-index-allowed-host/pyproject.toml": [[9, null, `${INDEX} in tool.uv.index`]],
      "uv-index/pyproject.toml": [
        [9, null, `${INDEX} in tool.uv.index`],
        [14, null, `${INDEX} in tool.uv.index`],
      ],
      "uv-legacy-keys/pyproject.toml": [
        [8, null, `${INDEX} in tool.uv.index-url`],
        [9, null, `${INDEX} in tool.uv.extra-index-url`],
        [10, null, `${INDEX} in tool.uv.find-links`],
      ],
      "uv-sources-array/pyproject.toml": [[10, "evil-pkg", GIT]],
    });
    expect(report.dependencies?.signals.every((s) => s.id === "D05" && s.severity === "block")).toBe(true);
    expect(report.dependencies?.unread).toBeUndefined();
    expect(report.verdict).toBe("fail");
  });

  it("passes each control: a registry version, setuptools, and a source or index on pypi.org", () => {
    const flagged = Object.keys(d05ByPath(report));
    for (const control of [
      "build-system-registry/pyproject.toml",
      "poetry-constraints-array-registry/pyproject.toml",
      "poetry-group-subtable-registry/pyproject.toml",
      "poetry-source-registry/pyproject.toml",
      "poetry-subtable-registry/pyproject.toml",
      "uv-index-registry/pyproject.toml",
      "uv-legacy-keys-registry/pyproject.toml",
      "uv-sources-array-registry/pyproject.toml",
    ]) {
      expect(flagged, control).not.toContain(control);
    }
  });

  it("passes a source or index on a host in dependency-allowed-hosts", () => {
    const allowed = run(
      dependencyCase("pyproject-spellings", { dependencySettings: { allowedHosts: ["pypi.corp.example"] } }),
    );
    const flagged = Object.keys(d05ByPath(allowed));
    expect(flagged).not.toContain("poetry-source-allowed-host/pyproject.toml");
    expect(flagged).not.toContain("uv-index-allowed-host/pyproject.toml");
    expect(flagged).toContain("poetry-source/pyproject.toml");
    expect(flagged).toContain("uv-index/pyproject.toml");
  });

  it("reads the sub-table dependencies the controls declare", () => {
    expect(deps(fixture("dependencies/pyproject-spellings/head/poetry-subtable-registry/pyproject.toml.txt"))).toEqual([
      ["tool.poetry.dependencies", "requests", "registry", "^2.31"],
    ]);
    expect(deps(fixture("dependencies/pyproject-spellings/head/build-system-registry/pyproject.toml.txt"))).toEqual([
      ["build-system.requires", "setuptools", "registry", ">=68"],
    ]);
  });
});

describe("one dependency, every TOML spelling", () => {
  const EVIL = "https://github.com/someone/evil.git";
  const spellings = [
    `[tool.poetry.dependencies.evil]\ngit = "${EVIL}"\nrev = "v1"\n`,
    `[tool.poetry.dependencies]\nevil = { git = "${EVIL}", rev = "v1" }\n`,
    `[tool.poetry.dependencies]\nevil.git = "${EVIL}"\nevil.rev = "v1"\n`,
    `[tool.poetry]\ndependencies.evil = { git = "${EVIL}", rev = "v1" }\n`,
    `[tool]\npoetry.dependencies.evil.git = "${EVIL}"\npoetry.dependencies.evil.rev = "v1"\n`,
    `tool.poetry.dependencies.evil.git = "${EVIL}"\ntool.poetry.dependencies.evil.rev = "v1"\n`,
    `tool = { poetry = { dependencies = { evil = { git = "${EVIL}", rev = "v1" } } } }\n`,
  ];

  it("reads a poetry dependency the same from a sub-table, an inline table and dotted keys", () => {
    for (const text of spellings) {
      expect(deps(text), text).toEqual([["tool.poetry.dependencies", "evil", "git", `git:${EVIL}`]]);
    }
  });

  it("reads the PEP 621, group, poetry group and uv tables in every spelling", () => {
    const same = (texts: string[], expected: unknown[]) => {
      for (const text of texts) expect(deps(text), text).toEqual(expected);
    };
    same(
      [
        '[project]\ndependencies = ["a>=1"]\n',
        'project.dependencies = ["a>=1"]\n',
        'project = { dependencies = ["a>=1"] }\n',
      ],
      [["project.dependencies", "a", "registry", ">=1"]],
    );
    same(
      [
        '[project.optional-dependencies]\ndev = ["b==2"]\n',
        '[project]\noptional-dependencies = { dev = ["b==2"] }\n',
        '[project]\noptional-dependencies.dev = ["b==2"]\n',
      ],
      [["project.optional-dependencies.dev", "b", "registry", "==2"]],
    );
    same(
      ['[dependency-groups]\nlint = ["c"]\n', 'dependency-groups = { lint = ["c"] }\n'],
      [["dependency-groups.lint", "c", "registry", ""]],
    );
    same(
      [
        `[tool.poetry.group.dev.dependencies.d]\ngit = "${EVIL}"\n`,
        `[tool.poetry.group.dev.dependencies]\nd = { git = "${EVIL}" }\n`,
        `[tool.poetry.group.dev]\ndependencies.d.git = "${EVIL}"\n`,
      ],
      [["tool.poetry.group.dev.dependencies", "d", "git", `git:${EVIL}`]],
    );
    same(
      [
        `[tool.uv.sources.e]\ngit = "${EVIL}"\n`,
        `[tool.uv.sources]\ne = { git = "${EVIL}" }\n`,
        `[tool.uv]\nsources.e.git = "${EVIL}"\n`,
      ],
      [["tool.uv.sources", "e", "git", `git:${EVIL}`]],
    );
    same(
      [
        '[build-system]\nrequires = ["setuptools>=68"]\n',
        'build-system.requires = ["setuptools>=68"]\n',
        'build-system = { requires = ["setuptools>=68"] }\n',
      ],
      [["build-system.requires", "setuptools", "registry", ">=68"]],
    );
  });

  it("puts a sub-table dependency at its header's line and keeps file order", () => {
    const parsed = read(
      '[project]\ndependencies = ["a"]\n\n[tool.poetry.dependencies.b]\nversion = "1"\n\n[build-system]\nrequires = ["c"]\n',
    );
    expect(parsed.deps.map((d) => [d.name, d.line])).toEqual([
      ["a", 2],
      ["b", 4],
      ["c", 8],
    ]);
  });

  it("still skips poetry's python entry in every spelling", () => {
    expect(deps('[tool.poetry.dependencies.python]\nversion = "^3.11"\n')).toEqual([]);
    expect(deps('[tool.poetry.group.dev.dependencies]\npython = "^3.11"\n')).toEqual([]);
  });

  it("reads an array of sources item by item, each at its own line, the later items keyed apart", () => {
    const items = (text: string) => read(text).deps.map((d) => [d.name, d.key ?? null, d.kind, d.spec, d.line]);
    expect(
      items(
        `[tool.uv.sources]\nx = [\n  { index = "a" },\n  { path = "./x-1.0.tar.gz" },\n  { path = "../x" },\n  { git = "${EVIL}" },\n]\n`,
      ),
    ).toEqual([
      ["x", null, "registry", "", 3],
      ["x", "x\u00001", "file", "path:./x-1.0.tar.gz", 4],
      ["x", "x\u00003", "git", `git:${EVIL}`, 6],
    ]);
    expect(items('[tool.poetry.dependencies]\nx = [{ version = "^1" }, { version = "^2" }]\n')).toEqual([
      ["x", null, "registry", "^1", 2],
      ["x", "x\u00001", "registry", "^2", 2],
    ]);
    expect(items('[tool.poetry.dependencies]\nx = ["^1"]\n')).toEqual([["x", null, "registry", "", 2]]);
  });

  it("flags a git source a change adds as a later item of an existing array", () => {
    const base = `[tool.uv.sources]\nx = [{ git = "${EVIL}" }]\n`;
    const head = `[tool.uv.sources]\nx = [{ git = "${EVIL}" }, { git = "https://github.com/someone/other.git" }]\n`;
    const report = run({
      version: "0.1.0",
      coverage: { missingFile: "coverage/lcov.info" },
      diff: {
        text: "diff --git a/pyproject.toml b/pyproject.toml\n--- a/pyproject.toml\n+++ b/pyproject.toml\n@@ -2 +2 @@\n-x\n+x\n",
      },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: ["pyproject.toml"],
      dependencySources: {
        base: { files: [{ path: "pyproject.toml", text: base }], dropped: [] },
        head: { files: [{ path: "pyproject.toml", text: head }], dropped: [] },
      },
    });
    expect(report.dependencies?.signals.map((s) => [s.id, s.line, s.name])).toEqual([["D05", 2, "x"]]);
    expect(report.dependencies?.checked).toBe(1);
  });
});

describe("package indexes in pyproject.toml", () => {
  it("reads the url of every poetry source and uv index, in every spelling", () => {
    const evil = "https://pypi.evil.example/simple/";
    for (const text of [
      `[[tool.poetry.source]]\nname = "a"\nurl = "${evil}"\n`,
      `tool.poetry.source = [{ name = "a", url = "${evil}" }]\n`,
      `[tool.poetry]\nsource = [\n  { name = "a", url = "${evil}" },\n]\n`,
    ]) {
      expect(
        indexes(text).map(([url, , allowed, table]) => [url, allowed, table]),
        text,
      ).toEqual([[evil, false, "tool.poetry.source"]]);
    }
    for (const text of [
      `[[tool.uv.index]]\nname = "a"\nurl = "${evil}"\nexplicit = true\n`,
      `tool.uv.index = [{ name = "a", url = "${evil}", default = true }]\n`,
    ]) {
      expect(
        indexes(text).map(([url, , allowed, table]) => [url, allowed, table]),
        text,
      ).toEqual([[evil, false, "tool.uv.index"]]);
    }
  });

  it("reads uv's older index keys, in [tool.uv] and [tool.uv.pip]", () => {
    expect(
      indexes(
        '[tool.uv]\nindex-url = "https://a.example/simple"\nextra-index-url = ["https://pypi.org/simple", "https://b.example/simple"]\n' +
          'find-links = ["./wheels"]\n[tool.uv.pip]\nindex-url = "https://c.example/simple"\nextra-index-url = ["https://d.example/simple"]\nfind-links = ["https://e.example/"]\n',
      ),
    ).toEqual([
      ["https://a.example/simple", 2, false, "tool.uv.index-url"],
      ["https://pypi.org/simple", 3, true, "tool.uv.extra-index-url"],
      ["https://b.example/simple", 3, false, "tool.uv.extra-index-url"],
      ["./wheels", 4, false, "tool.uv.find-links"],
      ["https://c.example/simple", 6, false, "tool.uv.pip.index-url"],
      ["https://d.example/simple", 7, false, "tool.uv.pip.extra-index-url"],
      ["https://e.example/", 8, false, "tool.uv.pip.find-links"],
    ]);
  });

  it("skips a source with no url (poetry's PyPI source) and reads nothing outside the named tables", () => {
    expect(indexes('[[tool.poetry.source]]\nname = "PyPI"\npriority = "primary"\n')).toEqual([]);
    expect(indexes('[[tool.pdm.source]]\nname = "a"\nurl = "https://a.example/simple"\n')).toEqual([]);
    expect(indexes('[project]\nname = "x"\nurls = { Homepage = "https://a.example/" }\n')).toEqual([]);
  });

  it("judges an index only when the change adds its url", () => {
    const base = '[[tool.uv.index]]\nname = "a"\nurl = "https://pypi.evil.example/simple/"\n';
    const head = `${base}\n[project]\nname = "x"\ndependencies = ["requests"]\n`;
    const report = run({
      version: "0.1.0",
      coverage: { missingFile: "coverage/lcov.info" },
      diff: {
        text: 'diff --git a/pyproject.toml b/pyproject.toml\n--- a/pyproject.toml\n+++ b/pyproject.toml\n@@ -3,0 +4,4 @@\n+\n+[project]\n+name = "x"\n+dependencies = ["requests"]\n',
      },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: ["pyproject.toml"],
      dependencySources: {
        base: { files: [{ path: "pyproject.toml", text: base }], dropped: [] },
        head: { files: [{ path: "pyproject.toml", text: head }], dropped: [] },
      },
    });
    expect(report.dependencies?.signals.filter((s) => s.id === "D05")).toEqual([]);
  });
});

describe("a sub-table dependency counts for D04 as an inline one does", () => {
  const report = run(dependencyCase("pyproject-d04"));
  const d04 = (report.dependencies?.signals ?? [])
    .filter((s) => s.id === "D04")
    .map((s) => [s.path, s.line, s.name ?? null, s.detail]);

  it("gives D04 for a sub-table and an inline dependency beside an untouched poetry.lock", () => {
    expect(d04).toEqual([
      ["inline/pyproject.toml", 12, null, "dependencies changed but the lockfile inline/poetry.lock did not"],
      ["subtable/pyproject.toml", 13, null, "dependencies changed but the lockfile subtable/poetry.lock did not"],
    ]);
    expect(report.dependencies?.unread).toBeUndefined();
  });

  it("passes a sub-table dependency the updated poetry.lock records, and a change to build requirements alone", () => {
    const paths = d04.map(([path]) => path);
    expect(paths).not.toContain("subtable-locked/pyproject.toml");
    expect(paths).not.toContain("build-only/pyproject.toml");
  });
});
