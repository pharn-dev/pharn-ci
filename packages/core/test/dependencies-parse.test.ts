import { describe, expect, it } from "vitest";
import { lockChanges, manifestChanges, recordsDependency } from "../src/dependencies/compare.js";
import {
  isReportableNpmName,
  isReportablePypiName,
  isReportableVersion,
  normalizePypiName,
} from "../src/dependencies/names.js";
import { parseNpmLock } from "../src/dependencies/npmLock.js";
import { parseNpmManifest } from "../src/dependencies/npmManifest.js";
import { candidateLockfiles, classifyDependencyFile, selectDependencyPaths } from "../src/dependencies/paths.js";
import { parsePnpmLock } from "../src/dependencies/pnpmLock.js";
import { parsePythonLock } from "../src/dependencies/pythonLock.js";
import { parsePyproject, parseRequirements } from "../src/dependencies/pythonManifest.js";
import { classifyNpmSpec } from "../src/dependencies/specs.js";
import { parseToml } from "../src/dependencies/toml.js";
import type { ParsedLockfile } from "../src/dependencies/types.js";
import { isAllowedRegistryUrl, urlParts } from "../src/dependencies/urls.js";
import { parseYarnLock } from "../src/dependencies/yarnLock.js";
import { parseUnifiedDiff } from "../src/diff/unified.js";
import { fixture } from "./helpers.js";

// A13 (dependency safety): the hand-written readers of manifests and lockfiles, on the fixtures under
// fixtures/dependencies/ (each stored as <name>.txt, or .fixture for a requirements file, so this repository's own check
// never reads them as manifests).

const lock = (parsed: ParsedLockfile | null): ParsedLockfile => {
  expect(parsed).not.toBeNull();
  return parsed as ParsedLockfile;
};
const sources = (parsed: ParsedLockfile) =>
  Object.fromEntries(parsed.entries.map((e) => [e.key, "text" in e.source ? `${e.source.kind}` : e.source.kind]));

describe("names, versions and URLs", () => {
  it("allows npm and PyPI names by their grammar and refuses anything else", () => {
    for (const name of ["left-pad", "@scope/thing", "lodash.merge", "JSONStream", "a_b~c"]) {
      expect(isReportableNpmName(name), name).toBe(true);
    }
    for (const name of ["", "@scope", "@/x", ".hidden", "_x", "a b", "a/b", "x".repeat(215), "https://x", "a\u0000b"]) {
      expect(isReportableNpmName(name), JSON.stringify(name)).toBe(false);
    }
    expect(isReportablePypiName("Flask_JWT.ext-2")).toBe(true);
    for (const name of ["-x", "x-", "a b", "a@b", ""]) expect(isReportablePypiName(name), name).toBe(false);
    expect(normalizePypiName("Flask__JWT..Ext")).toBe("flask-jwt-ext");
  });

  it("reports a version spec only when it holds no URL, path, alias or git character", () => {
    for (const spec of ["^1.2.3", "~1.0", ">=2,<3", "1.x || 2.x", "*", "latest", "==2.32.3", "1.0.0-beta.1+build"]) {
      expect(isReportableVersion(spec), spec).toBe(true);
    }
    for (const spec of [
      "https://x.y/z.tgz",
      "git+ssh://git@h/x",
      "file:../x",
      "npm:x@1",
      "a/b",
      "workspace:*",
      " 1",
      "",
    ]) {
      expect(isReportableVersion(spec), spec).toBe(false);
    }
    expect(isReportableVersion("1".repeat(101))).toBe(false);
  });

  it("allows only https URLs on the registry hosts, without credentials or a port", () => {
    expect(isAllowedRegistryUrl("https://registry.npmjs.org/a/-/a-1.0.0.tgz")).toBe(true);
    expect(isAllowedRegistryUrl("https://files.pythonhosted.org/packages/x.whl")).toBe(true);
    expect(isAllowedRegistryUrl("https://REGISTRY.YARNPKG.COM/a")).toBe(true);
    for (const url of [
      "http://registry.npmjs.org/a",
      "https://registry.npmjs.org.evil.com/a",
      "https://user:token@registry.npmjs.org/a",
      "https://registry.npmjs.org:8443/a",
      "https://evil.com/registry.npmjs.org/a",
      "registry.npmjs.org/a",
    ]) {
      expect(isAllowedRegistryUrl(url), url).toBe(false);
    }
    expect(urlParts("git+ssh://git@github.com/a/b.git")).toEqual({
      scheme: "git+ssh",
      host: "github.com",
      userinfo: true,
      port: false,
    });
  });

  it("classifies npm specs by prefix", () => {
    const kinds = (spec: string) => classifyNpmSpec(spec).kind;
    expect(["^1.0.0", "latest", "npm:chalk@5", "workspace:*", "catalog:", "patch:x@1#p.patch", ""].map(kinds)).toEqual(
      Array(7).fill("registry"),
    );
    expect(["github:a/b", "git+https://h/a.git", "git://h/a", "a/b#v1", "gitlab:a/b"].map(kinds)).toEqual(
      Array(5).fill("git"),
    );
    expect(["file:../x", "link:../x", "./vendor/x", "../x", "/abs/x", "x.tgz"].map(kinds)).toEqual(
      Array(6).fill("file"),
    );
    expect(classifyNpmSpec("https://registry.npmjs.org/a/-/a-1.tgz")).toEqual({ kind: "url", allowedUrl: true });
    expect(classifyNpmSpec("https://example.com/a.tgz")).toEqual({ kind: "url", allowedUrl: false });
  });
});

describe("paths", () => {
  it("classifies manifests and lockfiles by basename, never under node_modules", () => {
    expect(classifyDependencyFile("package.json")?.format).toBe("package-json");
    expect(classifyDependencyFile("a/b/pnpm-lock.yaml")?.format).toBe("pnpm");
    expect(classifyDependencyFile("requirements-dev.txt")?.format).toBe("requirements");
    expect(classifyDependencyFile("requirements/base.txt")?.format).toBe("requirements");
    expect(classifyDependencyFile("uv.lock")?.format).toBe("uv");
    for (const path of [
      "node_modules/x/package.json",
      "fixtures/dependencies/clean-bump/head/package.json.txt",
      "fixtures/dependencies/lookups/head/requirements.txt.fixture",
      "docs/requirements.md",
      "Package.json",
    ]) {
      expect(classifyDependencyFile(path), path).toBeNull();
    }
  });

  it("finds the lockfiles of the nearest directory that has one", () => {
    const tracked = new Set(["pnpm-lock.yaml", "packages/app/package.json", "py/pyproject.toml", "py/uv.lock"]);
    expect(candidateLockfiles("packages/app/package.json", "npm", "package-json", tracked)).toEqual(["pnpm-lock.yaml"]);
    expect(candidateLockfiles("py/pyproject.toml", "pypi", "pyproject", tracked)).toEqual(["py/uv.lock"]);
    expect(candidateLockfiles("requirements.txt", "pypi", "requirements", tracked)).toEqual([]);
  });

  it("selects the touched manifests and lockfiles, and an ancestor lockfile of a changed package.json", () => {
    const diff = parseUnifiedDiff(fixture("dependencies/workspace/change.diff"));
    const repoFiles = fixture("dependencies/workspace/files.txt").trim().split("\n");
    expect(selectDependencyPaths(diff, repoFiles)).toEqual({
      base: ["packages/app/package.json", "pnpm-lock.yaml", "tools/sample/package.json"],
      head: ["packages/app/package.json", "pnpm-lock.yaml", "tools/sample/package.json"],
    });
  });
});

describe("manifests", () => {
  it("reads the four package.json sections with key lines and spec kinds", () => {
    const parsed = parseNpmManifest(fixture("dependencies/d05-manifest/head/package.json.txt"));
    expect(parsed?.deps.map((d) => [d.name, d.section, d.line, d.kind])).toEqual([
      ["chalk", "dependencies", 5, "registry"],
      ["chalk-alias", "dependencies", 6, "registry"],
      ["from-git", "dependencies", 7, "git"],
      ["from-tarball", "dependencies", 8, "url"],
      ["from-disk", "dependencies", 9, "file"],
      ["workspace-lib", "dependencies", 10, "registry"],
    ]);
    expect(parseNpmManifest("not json")).toBeNull();
    expect(parseNpmManifest("[1]")).toBeNull();
  });

  it("reads requirements files: continuations, comments, hashes, editables, direct references and index options", () => {
    const parsed = parseRequirements(fixture("dependencies/python-requirements/head/requirements.txt.fixture"));
    expect(parsed.deps.map((d) => [d.name, d.spec, d.line, d.kind])).toEqual([
      ["requests", "==2.32.3", 5, "registry"],
      ["mypkg", "git+https://github.com/someone/mypkg.git@v1.0", 7, "git"],
      ["flask", ">=3.0", 8, "registry"],
    ]);
    expect(parsed.indexes).toEqual([
      { url: "https://pypi.org/simple", line: 2, allowed: true },
      { url: "https://pkgs.example.com/simple", line: 3, allowed: false },
    ]);
    const urls = parseRequirements(
      "https://example.com/x-1.0.tar.gz#egg=x\n./vendor/y-1.0.whl\n-e git+https://h/z.git#egg=z\n",
    );
    expect(urls.deps.map((d) => [d.name, d.named, d.kind, d.allowedUrl])).toEqual([
      ["x", true, "url", false],
      ["./vendor/y-1.0.whl", false, "file", undefined],
      ["z", true, "git", undefined],
    ]);
  });

  it("reads pyproject.toml: PEP 621, optional dependencies, dependency groups, poetry and uv sources", () => {
    const parsed = parsePyproject(fixture("dependencies/parse/pyproject.toml.txt"));
    expect(parsed?.deps.map((d) => [d.section, d.name, d.kind, d.line])).toEqual([
      ["project.dependencies", "requests", "registry", 12],
      ["project.dependencies", "my-lib", "git", 13],
      ["project.dependencies", "wheel-dep", "url", 14],
      ["project.optional-dependencies.dev", "pytest", "registry", 18],
      ["project.optional-dependencies.dev", "ruff", "registry", 18],
      ["dependency-groups.lint", "mypy", "registry", 21],
      ["tool.poetry.dependencies", "httpx", "registry", 25],
      ["tool.poetry.dependencies", "from-git", "git", 26],
      ["tool.poetry.dependencies", "pinned", "registry", 28],
      ["tool.poetry.group.test.dependencies", "hypothesis", "registry", 31],
      ["tool.uv.sources", "my-lib", "git", 34],
    ]);
    expect(parsed?.deps.find((d) => d.name === "wheel-dep")?.allowedUrl).toBe(true);
    expect(parsed?.deps.find((d) => d.name === "requests")?.spec).toBe(">=2.31,<3");
    expect(parsePyproject("[project\nname = 1")).toBeNull();
  });

  it("reads TOML strings, arrays across lines and inline tables, and refuses broken TOML", () => {
    const tables = parseToml('a = "x\\u0041"\n[t]\nb = [\n  "1", # c\n  { k = \'v\' },\n]\n[[arr]]\nc = 1979-05-27\n');
    expect(tables?.map((t) => [t.path.join("."), t.array, [...t.entries.keys()]])).toEqual([
      ["", false, ["a"]],
      ["t", false, ["b"]],
      ["arr", true, ["c"]],
    ]);
    expect(tables?.[0]?.entries.get("a")).toEqual({ type: "string", value: "xA", line: 1 });
    for (const bad of ['a = "open', "a = [1,", "[t", "a = { b = 1", "= 1", 'a = "x" y']) {
      expect(parseToml(bad), bad).toBeNull();
    }
  });
});

describe("lockfiles", () => {
  it("reads package-lock.json v3: importers, entries, links and sources", () => {
    const parsed = lock(parseNpmLock(fixture("dependencies/d05-lockfile/head/package-lock.json.txt")));
    expect([...(parsed.importers?.keys() ?? [])]).toEqual(["", "packages/lib"]);
    expect(parsed.importers?.get("")?.get("left-pad")).toBe("^1.3.0");
    expect(sources(parsed)).toEqual({
      "node_modules/chalk": "url",
      "node_modules/from-git": "git",
      "node_modules/left-pad": "url",
      "node_modules/lib": "link",
    });
    const leftPad = parsed.entries.find((e) => e.name === "left-pad");
    expect(leftPad?.source).toEqual({
      kind: "url",
      allowed: false,
      text: "https://packages.example.com/left-pad/-/left-pad-1.3.0.tgz",
    });
  });

  it("reads package-lock.json v1: the nested tree, a git version as its source, no importers", () => {
    const parsed = lock(parseNpmLock(fixture("dependencies/parse/package-lock-v1.json.txt")));
    expect(parsed.importers).toBeNull();
    expect(parsed.entries.map((e) => [e.key, e.version, e.source.kind])).toEqual([
      ["node_modules/debug", "2.6.9", "url"],
      ["node_modules/debug/node_modules/ms", "2.0.0", "url"],
      ["node_modules/from-git", "github:someone/from-git#0123456789abcdef0123456789abcdef01234567", "git"],
    ]);
  });

  it("reads pnpm-lock.yaml v9 and v6: importers, peer suffixes, flow and block resolutions, tarballs", () => {
    const v9 = lock(parsePnpmLock(fixture("dependencies/clean-bump/head/pnpm-lock.yaml.txt")));
    expect([...(v9.importers?.keys() ?? [])]).toEqual(["", "packages/core"]);
    expect(v9.importers?.get("")?.get("@biomejs/biome")).toBe("2.6.4");
    expect(v9.importers?.get("packages/core")?.get("typescript5")).toBe("npm:typescript@5.9.3");
    expect(v9.entries.map((e) => [e.name, e.version, e.integrity?.slice(0, 10)])).toEqual([
      ["@biomejs/biome", "2.6.4", "sha512-8sK"],
      ["@types/node", "26.6.6", "sha512-MzQ"],
      ["undici-types", "8.9.0", "sha512-KTD"],
    ]);
    const v6 = lock(parsePnpmLock(fixture("dependencies/parse/pnpm-v6.yaml.txt")));
    expect(v6.importers?.get("")?.get("typescript")).toBe("^5.4.0");
    expect(v6.entries.map((e) => [e.name, e.version, e.source.kind, e.integrity === null])).toEqual([
      ["@babel/core", "7.24.0", "registry", false],
      ["from-tarball", "1.0.0", "url", true],
      ["typescript", "5.4.5", "registry", false],
    ]);
    expect(parsePnpmLock("packages: {}\n")).toBeNull();
  });

  it("reads yarn.lock classic and berry: header specs, workspace links, protocols and virtual packages", () => {
    const classic = lock(parseYarnLock(fixture("dependencies/d04-integrity/base/yarn.lock.txt")));
    expect(classic.format).toBe("yarn");
    expect([...(classic.specs ?? [])]).toEqual(["chalk@^5.3.0", "lodash@^4.17.21", "minimist@^1.2.0"]);
    expect(classic.entries.map((e) => [e.name, e.version, e.source.kind, e.line])).toEqual([
      ["chalk", "5.3.0", "url", 5],
      ["lodash", "4.17.21", "url", 10],
      ["minimist", "1.2.0", "url", 15],
    ]);
    const berry = lock(parseYarnLock(fixture("dependencies/parse/yarn-berry.lock.txt")));
    expect(berry.format).toBe("yarn-berry");
    expect(berry.entries.map((e) => [e.name, e.source.kind])).toEqual([
      ["@scope/thing", "registry"],
      ["app", "link"],
      ["from-git", "url"],
      ["lodash", "registry"],
      ["peer-user", "registry"],
    ]);
    expect(berry.specs?.has("lodash@npm:^4.17.0")).toBe(true);
    const quoted = lock(
      parseYarnLock('# yarn lockfile v1\n\n"@babel/x@^7.0.0", "@babel/x@^7.1.0":\n  version "7.1.0"\n'),
    );
    expect([...(quoted.specs ?? [])]).toEqual(["@babel/x@^7.0.0", "@babel/x@^7.1.0"]);
    expect(quoted.entries[0]?.name).toBe("@babel/x");
  });

  it("reads poetry.lock and uv.lock sources, normalizing names", () => {
    const poetry = lock(parsePythonLock(fixture("dependencies/parse/poetry.lock.txt"), "poetry"));
    expect(poetry.entries.map((e) => [e.key, e.source.kind, "allowed" in e.source ? e.source.allowed : null])).toEqual([
      ["certifi@2024.7.4", "registry", null],
      ["my-lib@0.3.0", "git", null],
      ["private-thing@1.2.0", "url", false],
    ]);
    const uv = lock(parsePythonLock(fixture("dependencies/parse/uv.lock.txt"), "uv"));
    expect(uv.entries.map((e) => [e.key, e.source.kind])).toEqual([
      ["app@0.1.0", "link"],
      ["httpx@0.27.0", "url"],
      ["local-tool@0.0.1", "file"],
      ["via-git@2.0.0", "git"],
    ]);
    expect(uv.entries[1]?.source).toEqual({ kind: "url", allowed: true, text: "https://pypi.org/simple" });
    expect([...(uv.names ?? [])]).toEqual(["app", "httpx", "local-tool", "via-git"]);
  });
});

describe("comparing", () => {
  it("finds added, changed and removed manifest dependencies", () => {
    const base = parseNpmManifest(fixture("dependencies/clean-bump/base/package.json.txt"));
    const head = parseNpmManifest(fixture("dependencies/clean-bump/head/package.json.txt"));
    const changes = manifestChanges(base, head as NonNullable<typeof head>);
    expect(changes.added).toEqual([]);
    expect(changes.removed).toEqual([]);
    expect(changes.changed.map((d) => [d.name, d.spec])).toEqual([
      ["@biomejs/biome", "2.6.4"],
      ["@types/node", "^26.6.6"],
    ]);
  });

  it("flags the same version with a new hash of the same algorithm, never an algorithm change or a moved registry", () => {
    const base = parseYarnLock(fixture("dependencies/d04-integrity/base/yarn.lock.txt"));
    const head = lock(parseYarnLock(fixture("dependencies/d04-integrity/head/yarn.lock.txt")));
    const changes = lockChanges(base, head);
    expect(changes.integrityChanged.map((e) => e.name)).toEqual(["lodash"]);
    expect(changes.sourceNew.map((e) => e.name)).toEqual(["chalk"]);
    expect(changes.changed.map((e) => e.name)).toEqual(["chalk", "lodash", "minimist"]);
  });

  it("checks a declared dependency against the importer, the yarn headers or the Python names", () => {
    const head = lock(parseNpmLock(fixture("dependencies/d04-not-recorded/head/package-lock.json.txt")));
    const dep = (name: string, spec: string) => ({
      name,
      named: true,
      spec,
      section: "dependencies",
      line: 1,
      kind: "registry" as const,
    });
    expect(recordsDependency(head, "", dep("is-odd", "^3.0.1"))).toBe(true);
    expect(recordsDependency(head, "", dep("left-pad", "^1.3.0"))).toBe(false);
    expect(recordsDependency(head, "packages/x", dep("is-odd", "^3.0.1"))).toBeNull();
    const yarn = lock(parseYarnLock(fixture("dependencies/parse/yarn-berry.lock.txt")));
    expect(recordsDependency(yarn, "", dep("lodash", "^4.17.21"))).toBe(true);
    expect(recordsDependency(yarn, "", dep("lodash", "^5.0.0"))).toBe(false);
    const uv = lock(parsePythonLock(fixture("dependencies/parse/uv.lock.txt"), "uv"));
    expect(recordsDependency(uv, "", dep("HTTPX", ">=0.27"))).toBe(true);
    expect(recordsDependency(uv, "", dep("requests", ">=2"))).toBe(false);
  });
});
