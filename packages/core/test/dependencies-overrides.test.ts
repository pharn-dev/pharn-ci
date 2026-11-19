import { describe, expect, it } from "vitest";
import { planDependencyLookups } from "../src/dependencies/check.js";
import { parseNpmManifest } from "../src/dependencies/npmManifest.js";
import { resolveDependencySettings } from "../src/dependencies/settings.js";
import { classifyNpmSpec } from "../src/dependencies/specs.js";
import { parseUnifiedDiff } from "../src/diff/unified.js";
import type { Report } from "../src/report.js";
import { dependencyCase, run } from "./dependencies-helpers.js";
import { fixture } from "./helpers.js";

// CORE-115 (R4.5): package.json `overrides` (npm), `resolutions` (yarn) and `pnpm.overrides` are read like the four
// dependency sections, so an override that points a package at a git repository, a URL or a local path is D05 and an
// override added without a lockfile change is D04; and a spec that holds `:` or `/` after the registry protocols
// (`npm:`, `workspace:`, `catalog:`, `patch:`) is off the registry (`ssh://…`, `user@host:x.git`, `https:host/x`).
// `jsr:` is D05 unless `npm.jsr.io` is an allowed host. Fixtures under fixtures/dependencies/ (dependencies-helpers.ts).

const brief = (report: Report) =>
  (report.dependencies?.signals ?? []).map((s) => [s.id, s.line, s.name ?? null, s.detail]);

describe("classifyNpmSpec", () => {
  const table: Array<[string, string, boolean?]> = [
    // Registry: semver ranges, dist-tags, the registry protocols and a `$name` override reference.
    ["^4.17.21", "registry"],
    ["~1.2.3", "registry"],
    ["*", "registry"],
    ["", "registry"],
    ["1.2.3 - 2.3.4", "registry"],
    ["<2.0.0", "registry"],
    [">=1 <2", "registry"],
    ["1.x || 2.x", "registry"],
    ["latest", "registry"],
    ["next-11", "registry"],
    ["$lodash", "registry"],
    ["npm:lodash@4", "registry"],
    ["npm:@scope/x@^1", "registry"],
    ["workspace:*", "registry"],
    ["workspace:^", "registry"],
    ["catalog:", "registry"],
    ["catalog:react18", "registry"],
    ["patch:x@npm%3A1.0.0#./x.patch", "registry"],
    // Git: the prefixes, the owner/repo shorthand, and the three forms that used to read as registry versions.
    ["github:evil/lodash", "git"],
    ["git+https://evil.example/minimist.git", "git"],
    ["a/b#v1", "git"],
    ["ssh://git@host/x.git", "git"],
    ["SSH://git@host/x.git", "git"],
    ["user@host:x.git", "git"],
    ["git@host:x/y", "git"],
    ["a/b#semver:^1", "git"],
    // URL: http(s) tarballs, the `https:host/x` form without slashes, and any other scheme.
    ["https://evil.example/b.tgz", "url", false],
    ["https:host/x", "url", false],
    ["http:host/x", "url", false],
    ["https:registry.npmjs.org/a/-/a-1.tgz", "url", false],
    ["ftp://host/x.tgz", "url", false],
    ["x#a:b", "url", false],
    ["https://registry.npmjs.org/a/-/a-1.tgz", "url", true],
    // Local: the path prefixes keep their class; a scoped-looking path and a Windows path are local too.
    ["file:../x", "file"],
    ["link:../x", "file"],
    ["portal:../x", "file"],
    ["./vendor/x", "file"],
    ["x.tgz", "file"],
    ["@scope/x", "file"],
    ["C:\\pkgs\\x", "file"],
  ];

  it.each(table)("%j is %s", (spec, kind, allowedUrl) => {
    const got = classifyNpmSpec(spec);
    expect(got.kind).toBe(kind);
    if (allowedUrl !== undefined) expect(got.allowedUrl).toBe(allowedUrl);
  });

  it("classes jsr: as a URL on npm.jsr.io, never allowed by default", () => {
    expect(classifyNpmSpec("jsr:@std/path@^1")).toEqual({
      kind: "url",
      allowedUrl: false,
      url: "https://npm.jsr.io/",
      registry: "jsr",
    });
    expect(classifyNpmSpec(" JSR:@std/path ").kind).toBe("url");
  });
});

describe("parseNpmManifest reads the override fields", () => {
  it("walks npm overrides to their string leaves, with `.` naming the parent", () => {
    const parsed = parseNpmManifest(fixture("dependencies/d05-npm-overrides/head/package.json.txt"));
    const overrides = (parsed?.deps ?? [])
      .filter((dep) => dep.section === "overrides")
      .map((dep) => [dep.name, dep.spec, dep.kind, dep.line]);
    expect(overrides).toEqual([
      ["lodash", "github:evil/lodash", "git", 8],
      ["a", "1.0.0", "registry", 10],
      ["b", "https://evil.example/b.tgz", "url", 11],
    ]);
  });

  it("keys a nested leaf by its parent path, so one package under two parents is two overrides", () => {
    const keys = (value: unknown) =>
      (parseNpmManifest(JSON.stringify({ overrides: value }))?.deps ?? []).map((dep) => dep.key);
    const [top, underA, dotA, underC, deep] = keys({
      b: "1",
      a: { b: "1", ".": "1" },
      c: { b: "1" },
      d: { a: { b: "1" } },
    });
    expect(top).toBe("b");
    expect(underA).toMatch(/^#[0-9a-z]+>b$/);
    expect(dotA).toMatch(/^#[0-9a-z]+>\.$/);
    expect(new Set([top, underA, underC, deep]).size).toBe(4);
    // The same path gives the same key in another file (the merge base).
    expect(keys({ a: { b: "2" } })[0]).toBe(underA);
  });

  it("names the replaced package of a yarn pattern and a pnpm selector", () => {
    const text = JSON.stringify({
      overrides: { "@s/x@^1": { "y@2": "1.0.0" }, "z@1.0.0": "2.0.0" },
      resolutions: { "**/minimist": "1.2.8", "a/**/@s/b": "1.0.0", "c@1.0.0/d@npm:2": "3", "@s/e": "1" },
      pnpm: { overrides: { "foo@1>bar@<2": "2.0.0", "@s/q>@s/r": "1", baz: "1" } },
    });
    const parsed = parseNpmManifest(text);
    expect((parsed?.deps ?? []).map((dep) => [dep.section, dep.name, dep.key?.replace(/^#[0-9a-z]+/, "#")])).toEqual([
      ["overrides", "y", "#>y@2"],
      ["overrides", "z", "z@1.0.0"],
      ["resolutions", "minimist", "**/minimist"],
      ["resolutions", "@s/b", "a/**/@s/b"],
      ["resolutions", "d", "c@1.0.0/d@npm:2"],
      ["resolutions", "@s/e", "@s/e"],
      ["pnpm.overrides", "bar", "foo@1>bar@<2"],
      ["pnpm.overrides", "@s/r", "@s/q>@s/r"],
      ["pnpm.overrides", "baz", "baz"],
    ]);
  });

  it("skips non-string, non-object override values and override fields that are not objects", () => {
    const text = JSON.stringify({
      overrides: { a: 1, b: null, c: ["x"], d: { e: true } },
      resolutions: "x",
      pnpm: { overrides: [] },
    });
    expect(parseNpmManifest(text)?.deps).toEqual([]);
    expect(parseNpmManifest(JSON.stringify({ pnpm: "x" }))?.deps).toEqual([]);
  });
});

describe("overrides and spec forms must trigger", () => {
  it("d05-npm-overrides: a git override and a nested tarball override", () => {
    const report = run(dependencyCase("d05-npm-overrides"));
    expect(brief(report)).toEqual([
      ["D05", 8, "lodash", "declared from a git repository in overrides"],
      ["D05", 11, "b", "declared from a URL outside the allowed registries in overrides"],
    ]);
    expect(report.verdict).toBe("fail");
  });

  it("d05-yarn-resolutions: a git resolution for **/minimist", () => {
    const report = run(dependencyCase("d05-yarn-resolutions"));
    expect(brief(report)).toEqual([["D05", 8, "minimist", "declared from a git repository in resolutions"]]);
    expect(report.dependencies?.checked).toBe(2);
  });

  it("d05-pnpm-overrides: a file: override in pnpm.overrides", () => {
    const report = run(dependencyCase("d05-pnpm-overrides"));
    expect(brief(report)).toEqual([["D05", 9, "x", "declared from a local file in pnpm.overrides"]]);
  });

  it("d05-spec-forms: ssh://, scp-like and https: without slashes as dependency values", () => {
    const report = run(dependencyCase("d05-spec-forms"));
    expect(brief(report)).toEqual([
      ["D05", 6, "from-ssh", "declared from a git repository"],
      ["D05", 7, "from-scp", "declared from a git repository"],
      ["D05", 8, "from-https-colon", "declared from a URL outside the allowed registries"],
    ]);
    expect(report.dependencies?.checked).toBe(7);
  });

  it("d05-jsr: a jsr: dependency is D05 naming JSR, and passes only when npm.jsr.io is an allowed host", () => {
    const report = run(dependencyCase("d05-jsr"));
    expect(brief(report)).toEqual([
      ["D05", 6, "@std/path", "declared from the JSR registry, outside the allowed registries"],
    ]);
    expect(report.verdict).toBe("fail");
    const allowed = run(dependencyCase("d05-jsr", { dependencySettings: { allowedHosts: ["npm.jsr.io"] } }));
    expect(allowed.dependencies?.signals).toEqual([]);
    const other = run(dependencyCase("d05-jsr", { dependencySettings: { allowedHosts: ["jsr.io"] } }));
    expect(brief(other)).toEqual(brief(report));
  });

  it("d04-override-lock-untouched: an override added while package-lock.json did not change", () => {
    const report = run(dependencyCase("d04-override-lock-untouched"));
    expect(brief(report)).toEqual([
      ["D04", 8, null, "dependencies changed but the lockfile package-lock.json did not"],
    ]);
    expect(report.verdict).toBe("fail");
  });
});

describe("overrides and spec forms must not trigger", () => {
  it("overrides-registry: registry, $name, npm:, workspace:, catalog:, range and tag overrides with the lockfile updated", () => {
    const report = run(dependencyCase("overrides-registry"));
    expect(report.dependencies).toEqual({ checked: 10, lookups: "off", signals: [] });
    expect(report.messages.filter((m) => m.code.startsWith("DEPENDENCY_"))).toEqual([]);
  });

  it("looks up only an added override's npm: alias target, never the overridden names", () => {
    const input = dependencyCase("overrides-registry");
    const plan = planDependencyLookups(
      parseUnifiedDiff(fixture("dependencies/overrides-registry/change.diff")),
      input.dependencySources as never,
      input.repoFiles,
      resolveDependencySettings({ input: "lookup" }),
    );
    expect(plan).toEqual({ planned: [{ ecosystem: "npm", name: "lodash" }], overCap: 0 });
    const npmOverrides = planDependencyLookups(
      parseUnifiedDiff(fixture("dependencies/d04-override-lock-untouched/change.diff")),
      dependencyCase("d04-override-lock-untouched").dependencySources as never,
      dependencyCase("d04-override-lock-untouched").repoFiles,
      resolveDependencySettings({ input: "lookup" }),
    );
    expect(npmOverrides).toEqual({ planned: [], overCap: 0 });
  });

  it("an override whose value does not change gives nothing", () => {
    const input = dependencyCase("overrides-registry");
    const head = input.dependencySources?.head;
    if (head === undefined || "unavailable" in head) throw new Error("fixture has a head side");
    const report = run({
      ...input,
      dependencySources: { base: head, head },
    });
    expect(report.dependencies?.signals).toEqual([]);
  });
});
