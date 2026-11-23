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

/**
 * Keys whose entries install with the package besides `dependencies`; each must be absent, `false` or empty
 * (`bundleDependencies: true` bundles every dependency).
 */
const ALSO_INSTALLED = ["optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"];

/** One semver comparator: an optional operator, a version of up to three parts (`x` and `*` allowed), tags. */
const COMPARATOR =
  /^(?:[<>]=?|=|\^|~>?)?v?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** A registry version range: comparators joined by spaces, ` - ` and `||`. Anything else (a path, `x.tgz`, a tag) is not. */
function isRange(spec: string): boolean {
  return spec.split("||").every((part) => {
    const tokens = part
      .trim()
      .split(/\s+/)
      .filter((token) => token !== "-");
    return tokens.length > 0 && tokens.every((token) => COMPARATOR.test(token));
  });
}

/** The registry package a spec installs, or undefined when it does not install one from the registry by version. */
function registryPackage(name: string, spec: string): string | undefined {
  if (spec.startsWith("npm:")) {
    const rest = spec.slice(4);
    const at = rest.lastIndexOf("@");
    if (at <= 0) return undefined;
    return isRange(rest.slice(at + 1)) ? rest.slice(0, at) : undefined;
  }
  return isRange(spec) ? name : undefined;
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
    const empty =
      value === undefined ||
      value === false ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);
    if (!empty) found.push(`${key} is not empty`);
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
      "ts.tgz",
      "5.9.3.tgz",
      "./vendor/ts",
      "latest",
      "npm:typescript@ts.tgz",
    ])
      expect(problems({ dependencies: { typescript5: spec } }, allowed), spec).toHaveLength(1);
    for (const spec of ["5.9.3", "^5.9.3", "~5.9", ">=5.0.0 <6", "5.x", "*", "1.2.3 - 2.3.4", "^4 || ^5", "5.0.0-rc.1"])
      expect(problems({ dependencies: { typescript5: `npm:typescript@${spec}` } }, allowed), spec).toEqual([]);
    for (const [key, value] of [
      ["bundleDependencies", true],
      ["bundledDependencies", true],
      ["bundledDependencies", ["typescript5"]],
      ["peerDependencies", { typescript: "^5" }],
    ] as const)
      expect(
        problems({ dependencies: { typescript5: "npm:typescript@5.9.3" }, [key]: value }, allowed),
        `${key}: ${JSON.stringify(value)}`,
      ).toEqual([`${key} is not empty`]);
    for (const value of [false, [], {}])
      expect(
        problems({ dependencies: { typescript5: "npm:typescript@5.9.3" }, bundleDependencies: value }, allowed),
      ).toEqual([]);
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
