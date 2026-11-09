import { describe, expect, it } from "vitest";
import { checkDependencies, planDependencyLookups } from "../src/dependencies/check.js";
import { resolveDependencySettings } from "../src/dependencies/settings.js";
import { parseUnifiedDiff } from "../src/diff/unified.js";

// d05-private-registry-allowlist, AC-11: a package resolved from an allowed private host is never looked up in a
// public registry, so allowing a host never sends a private package name out of the job (AGENTS.md rule 5). An
// in-memory change adds the unscoped `corp-utils` (resolved from https://npm.corp.example/...) and `left-pad` (from the
// public registry) to package.json and package-lock.json. With lookups on, `left-pad` is planned and `corp-utils` is
// not, whether or not the host is allowed; with the host allowed, `corp-utils` is no D05 finding either.

const HOST = "npm.corp.example";
const LEFT_PAD_INTEGRITY =
  "sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQEmkLlBGSHJmzkh4b9QCXkVuhVVxvdShGQBhn6cU9fROlvw==";
const CHALK_INTEGRITY =
  "sha512-dLitG79d+GV1Nb/VYcCDFivJeK1hiukt9QjRNVOsUtTy1rR1YJsmpGGTZ3qJos+uw7WmWF4wUwBd9jxjocFC2w==";
const CORP_INTEGRITY = `sha512-${"A".repeat(86)}==`;

const manifest = (deps: string[]) =>
  `{\n  "name": "demo",\n  "version": "1.0.0",\n  "dependencies": {\n${deps.map((d) => `    ${d}`).join(",\n")}\n  }\n}\n`;

const entry = (name: string, version: string, resolved: string, integrity: string) =>
  `    "node_modules/${name}": {\n      "version": "${version}",\n      "resolved": "${resolved}",\n      "integrity": "${integrity}"\n    }`;

const lockfile = (deps: string[], entries: string[]) =>
  `{\n  "name": "demo",\n  "version": "1.0.0",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "demo",\n      "version": "1.0.0",\n      "dependencies": {\n${deps.map((d) => `        ${d}`).join(",\n")}\n      }\n    },\n${entries.join(",\n")}\n  }\n}\n`;

const CHALK = entry("chalk", "5.3.0", "https://registry.npmjs.org/chalk/-/chalk-5.3.0.tgz", CHALK_INTEGRITY);
const CORP = entry(
  "corp-utils",
  "2.0.0",
  `https://${HOST}/api/npm/npm/corp-utils/-/corp-utils-2.0.0.tgz`,
  CORP_INTEGRITY,
);
const LEFT_PAD = entry(
  "left-pad",
  "1.3.0",
  "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
  LEFT_PAD_INTEGRITY,
);

const BASE = {
  "package.json": manifest(['"chalk": "^5.3.0"']),
  "package-lock.json": lockfile(['"chalk": "^5.3.0"'], [CHALK]),
};
const ADDED = ['"chalk": "^5.3.0"', '"corp-utils": "^2.0.0"', '"left-pad": "^1.3.0"'];
const HEAD = {
  "package.json": manifest(ADDED),
  "package-lock.json": lockfile(ADDED, [CHALK, CORP, LEFT_PAD]),
};

/** A unified diff that replaces the whole file, so every head line is an added line. */
function wholeFileDiff(path: string, base: string, head: string): string {
  const b = base.replace(/\n$/, "").split("\n");
  const h = head.replace(/\n$/, "").split("\n");
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${b.length} +1,${h.length} @@`,
    ...b.map((line) => `-${line}`),
    ...h.map((line) => `+${line}`),
  ].join("\n");
}

const side = (files: Record<string, string>) => ({
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
  dropped: [] as [],
});

const DIFF = parseUnifiedDiff(
  `${wholeFileDiff("package-lock.json", BASE["package-lock.json"], HEAD["package-lock.json"])}\n${wholeFileDiff(
    "package.json",
    BASE["package.json"],
    HEAD["package.json"],
  )}\n`,
);
const SOURCES = { base: side(BASE), head: side(HEAD) };
const REPO_FILES = ["package-lock.json", "package.json"];

type Signal = { id: string; name?: string };

/** Every finding (an object with an id and a severity) anywhere in the result. */
function signalsIn(value: unknown, found: Signal[] = []): Signal[] {
  if (Array.isArray(value)) {
    for (const item of value) signalsIn(item, found);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string" && typeof record.severity === "string") found.push(record as unknown as Signal);
    else for (const child of Object.values(record)) signalsIn(child, found);
  }
  return found;
}

describe("lookups and allowed private hosts", () => {
  it("AC-11: with lookups on, corp-utils from an allowed private host is not planned, exactly as when the host is not allowed, and it is no D05 finding", () => {
    const notAllowed = resolveDependencySettings({ input: "lookup" });
    const allowed = resolveDependencySettings({ input: "lookup", allowedHosts: [HOST] } as never);
    for (const [name, settings] of [
      ["host not allowed", notAllowed],
      ["host allowed", allowed],
    ] as const) {
      const plan = planDependencyLookups(DIFF, SOURCES as never, REPO_FILES, settings);
      const planned = (plan?.planned ?? []).map((p) => p.name);
      expect(planned, name).toContain("left-pad");
      expect(planned, name).not.toContain("corp-utils");
    }

    const d05 = (settings: typeof allowed) =>
      signalsIn(checkDependencies({ diff: DIFF, sources: SOURCES as never, repoFiles: REPO_FILES, settings }))
        .filter((s) => s.id === "D05")
        .map((s) => s.name);
    expect(d05(notAllowed), "host not allowed").toEqual(["corp-utils"]);
    expect(d05(allowed), "host allowed").toEqual([]);
  });
});
