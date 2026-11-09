import { describe, expect, it } from "vitest";
import type { CheckInput } from "../src/check.js";
import { REPO_ROOT, run } from "./dependencies-helpers.js";

// d05-private-registry-allowlist, AC-4: an allowed host covers the manifest and requirements places D05 judges a URL,
// not only lockfile entries. An in-memory change adds a `name @ url` dependency to pyproject.toml, a `--index-url`
// to requirements.txt and a URL dependency to package.json; no lockfile is tracked, so nothing but D05 judges them.
// On a host that is not allowed each line is a D05 finding; with that host allowed, none is.

type Signal = { id: string; path: string; line: number | null };

function changeOn(host: string): CheckInput {
  const pyBase = '[project]\nname = "demo"\nversion = "1.0.0"\ndependencies = [\n  "requests>=2",\n]\n';
  const pyHead = `[project]\nname = "demo"\nversion = "1.0.0"\ndependencies = [\n  "requests>=2",\n  "pkg @ https://${host}/packages/pkg-1.0.tar.gz",\n]\n`;
  const reqBase = "requests==2.31.0\n";
  const reqHead = `--index-url https://${host}/simple\nrequests==2.31.0\n`;
  const npmBase = '{\n  "name": "demo",\n  "version": "1.0.0",\n  "dependencies": {\n    "chalk": "^5.3.0"\n  }\n}\n';
  const npmHead = `{\n  "name": "demo",\n  "version": "1.0.0",\n  "dependencies": {\n    "chalk": "^5.3.0",\n    "x": "https://${host}/x-1.0.0.tgz"\n  }\n}\n`;
  const diff = [
    "diff --git a/package.json b/package.json",
    "index 1111111..2222222 100644",
    "--- a/package.json",
    "+++ b/package.json",
    "@@ -5 +5,2 @@",
    '-    "chalk": "^5.3.0"',
    '+    "chalk": "^5.3.0",',
    `+    "x": "https://${host}/x-1.0.0.tgz"`,
    "diff --git a/pyproject.toml b/pyproject.toml",
    "index 3333333..4444444 100644",
    "--- a/pyproject.toml",
    "+++ b/pyproject.toml",
    "@@ -5,0 +6 @@",
    `+  "pkg @ https://${host}/packages/pkg-1.0.tar.gz",`,
    "diff --git a/requirements.txt b/requirements.txt",
    "index 5555555..6666666 100644",
    "--- a/requirements.txt",
    "+++ b/requirements.txt",
    "@@ -0,0 +1 @@",
    `+--index-url https://${host}/simple`,
    "",
  ].join("\n");
  return {
    version: "0.1.0",
    coverage: { missingFile: "coverage/lcov.info" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["app.py", "package.json", "pyproject.toml", "requirements.txt"],
    dependencySources: {
      base: {
        files: [
          { path: "package.json", text: npmBase },
          { path: "pyproject.toml", text: pyBase },
          { path: "requirements.txt", text: reqBase },
        ],
        dropped: [],
      },
      head: {
        files: [
          { path: "package.json", text: npmHead },
          { path: "pyproject.toml", text: pyHead },
          { path: "requirements.txt", text: reqHead },
        ],
        dropped: [],
      },
    },
  };
}

const d05 = (input: CheckInput) =>
  ((run(input).dependencies?.signals ?? []) as Signal[])
    .filter((s) => s.id === "D05")
    .map((s) => [s.path, s.line])
    .sort();

describe("an allowed host in manifests and requirements files", () => {
  it("AC-4: a pyproject `name @ url`, a requirements --index-url and a package.json URL on the allowed host are not D05; on another host each is", () => {
    const expected = [
      ["package.json", 6],
      ["pyproject.toml", 6],
      ["requirements.txt", 1],
    ];
    expect(d05(changeOn("other.example")), "a host that is not allowed, with no setting").toEqual(expected);
    const setting = { dependencySettings: { allowedHosts: ["pypi.corp.example"] } as never };
    expect(d05({ ...changeOn("other.example"), ...setting }), "a host that is not allowed").toEqual(expected);
    expect(d05({ ...changeOn("pypi.corp.example"), ...setting }), "the allowed host").toEqual([]);
  });
});
