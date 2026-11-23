import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// AGENTS.md rule 6: keep dependencies minimal and justify every new one. The direct runtime dependencies of the root
// package.json and of every packages/*/package.json must equal the allow-list below, so a PR that adds one fails here
// until it edits this list too, in the same PR, where a reviewer sees it. Each entry maps the dependency's name to the
// registry package it installs, so an alias that swaps the package (`"x": "npm:other@1"`) or a spec that installs from
// outside the registry (git, a URL, a file, a link) fails as well; version ranges are not pinned. devDependencies are
// out of scope; optionalDependencies, peerDependencies and bundled dependencies also install with the package and must
// be empty. Workspace packages are devDependencies today (bundled into the CLI and Action dists), so the list holds none.

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/** Manifest path → dependency name → the registry package it must install. */
const ALLOWED: Record<string, Record<string, string>> = {
  "package.json": {},
  "packages/action/package.json": { "@actions/core": "@actions/core", "@actions/github": "@actions/github" },
  "packages/cli/package.json": {},
  "packages/core/package.json": { typescript5: "typescript" },
  "packages/node-io/package.json": {},
};

/** Keys whose entries install with the package besides `dependencies`; each must be absent or empty. */
const ALSO_INSTALLED = ["optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"];

/** A registry version range: digits, `x`/`*`, dots, comparators, `^`, `~`, hyphens, `||`, spaces and prerelease tags. */
const RANGE = /^[\w.*^~<>=|\s+-]+$/;

/** The registry package a spec installs, or undefined when it does not install one from the registry by version. */
function registryPackage(name: string, spec: string): string | undefined {
  if (spec.startsWith("npm:")) {
    const rest = spec.slice(4);
    const at = rest.lastIndexOf("@");
    if (at <= 0) return undefined;
    return RANGE.test(rest.slice(at + 1)) ? rest.slice(0, at) : undefined;
  }
  return RANGE.test(spec) && !spec.includes(":") ? name : undefined;
}

/** What is wrong with a manifest's runtime dependencies against its allow-list entry; empty when nothing is. */
function problems(manifest: Record<string, unknown>, allowed: Record<string, string>): string[] {
  const found: string[] = [];
  const dependencies = (manifest.dependencies ?? {}) as Record<string, string>;
  for (const [name, spec] of Object.entries(dependencies)) {
    if (!Object.hasOwn(allowed, name)) found.push(`dependencies.${name} is not on the allow-list`);
    else if (registryPackage(name, spec) !== allowed[name])
      found.push(`dependencies.${name} (${spec}) does not install ${allowed[name]} from the registry`);
  }
  for (const name of Object.keys(allowed))
    if (!Object.hasOwn(dependencies, name)) found.push(`dependencies.${name} is on the allow-list but gone`);
  for (const key of ALSO_INSTALLED) {
    const value = manifest[key];
    const count = Array.isArray(value) ? value.length : Object.keys((value ?? {}) as object).length;
    if (count > 0) found.push(`${key} is not empty`);
  }
  return found;
}

const read = (path: string) => JSON.parse(readFileSync(join(REPO, path), "utf8")) as Record<string, unknown>;

describe("AGENTS.md rule 6: direct runtime dependencies", () => {
  it("the manifests checked are the root package.json and every packages/*/package.json", () => {
    const packages = readdirSync(join(REPO, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/package.json`)
      .filter((path) => {
        try {
          return readFileSync(join(REPO, path)).length > 0;
        } catch {
          return false;
        }
      });
    expect(["package.json", ...packages].sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it.each(Object.keys(ALLOWED))("%s has exactly the allowed runtime dependencies", (path) => {
    expect(problems(read(path), ALLOWED[path] as Record<string, string>)).toEqual([]);
  });

  it("control: an added, swapped, off-registry, removed or optional dependency is reported", () => {
    const allowed = { typescript5: "typescript" };
    expect(problems({ dependencies: { typescript5: "npm:typescript@5.9.3" } }, allowed)).toEqual([]);
    expect(problems({ dependencies: { typescript5: "npm:typescript@5.9.3", "left-pad": "^1.3.0" } }, allowed)).toEqual([
      "dependencies.left-pad is not on the allow-list",
    ]);
    for (const spec of [
      "npm:typescript-fork@5.9.3",
      "github:microsoft/TypeScript",
      "file:../ts",
      "https://example.com/ts.tgz",
      "workspace:*",
    ])
      expect(problems({ dependencies: { typescript5: spec } }, allowed), spec).toHaveLength(1);
    expect(problems({}, allowed)).toEqual(["dependencies.typescript5 is on the allow-list but gone"]);
    expect(
      problems(
        { dependencies: { typescript5: "npm:typescript@5.9.3" }, optionalDependencies: { fsevents: "^2.3.3" } },
        allowed,
      ),
    ).toEqual(["optionalDependencies is not empty"]);
    expect(problems({ dependencies: { "@actions/core": "^3.0.1" } }, { "@actions/core": "@actions/core" })).toEqual([]);
  });
});
