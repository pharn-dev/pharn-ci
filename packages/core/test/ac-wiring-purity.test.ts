import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// purityViolations (packages/core/test/purity-check.ts) is loaded inside each test body: these AC tests are written
// before the build, which creates it. The Biome check depends on the noRestrictedGlobals rule the build adds to
// biome.json.

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const BIOME = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

function biome(args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [BIOME, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

/** Core source texts using each clock or non-determinism form the purity check must catch. */
const IMPURE_FORMS: [string, string][] = [
  ["new Date", "export const now = new Date();\n"],
  ["Date.now", "export const now = Date.now();\n"],
  ["Math.random", "export const r = Math.random();\n"],
  ["Intl", 'export const fmt = Intl.NumberFormat("en");\n'],
  ["performance", "export const t = performance.now();\n"],
  ["crypto", "export const id = crypto.randomUUID();\n"],
  ["setTimeout", "export function later(f: () => void): void {\n  setTimeout(f, 10);\n}\n"],
  ["setInterval", "export function tick(f: () => void): void {\n  setInterval(f, 10);\n}\n"],
  ["Function(", 'export const f = Function("return 1");\n'],
  ["new Function(", 'export const f = new Function("return 1");\n'],
];

/** One sample per global the Biome rule bans in packages/core/src. */
const BANNED_GLOBALS: [string, string][] = [
  ["Date", "export const now = Date.now();\n"],
  ["Intl", 'export const fmt = new Intl.NumberFormat("en");\n'],
  ["performance", "export const t = performance.now();\n"],
  ["crypto", "export const id = crypto.randomUUID();\n"],
  ["setTimeout", "export function later(f: () => void): void {\n  setTimeout(f, 10);\n}\n"],
  ["setInterval", "export function tick(f: () => void): void {\n  setInterval(f, 10);\n}\n"],
  ["Function", 'export const f = Function("return 1");\n'],
];

describe("packages/core purity: clocks and non-determinism", () => {
  it.each(IMPURE_FORMS)("AC-3: the purity check reports a failure for %s", async (_form, text) => {
    const { purityViolations } = await import("./purity-check.js");
    expect(purityViolations(text).length).toBeGreaterThan(0);
  });

  it("AC-3: the purity check passes every current packages/core/src file and a clean sample", async () => {
    const { purityViolations } = await import("./purity-check.js");
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(purityViolations(readFileSync(file, "utf8")), file).toEqual([]);
    // Math.floor and friends stay allowed; only Math.random is non-deterministic.
    expect(purityViolations("export const n = Math.floor(Math.max(1.5, 2));\n")).toEqual([]);
  });

  it("AC-3: Biome reports noRestrictedGlobals for each banned global under packages/core/src, and the current sources lint clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "pharn-ci-biome-"));
    try {
      copyFileSync(join(REPO, "biome.json"), join(dir, "biome.json"));
      mkdirSync(join(dir, "packages/core/src"), { recursive: true });
      for (const [name, text] of BANNED_GLOBALS) {
        const rel = `packages/core/src/sample-${name.toLowerCase()}.ts`;
        writeFileSync(join(dir, rel), text);
        const r = biome(["lint", "--vcs-enabled=false", rel], dir);
        expect(r.status, `biome lint exit status for ${name}`).not.toBe(0);
        expect(r.output, `diagnostic for ${name}`).toContain("noRestrictedGlobals");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const clean = biome(["lint", "packages/core/src"], REPO);
    expect(clean.status, clean.output).toBe(0);
  }, 120_000);
});
