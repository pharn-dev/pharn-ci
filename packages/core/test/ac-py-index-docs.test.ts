import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// purityViolations is loaded inside the test body, like the other AC tests: nothing the build changes runs while the
// file loads.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** sha256 of schema/report.v1.json and schema/report.v2.json at the base commit 5a42169. */
const V1_AT_BASE = "c6cfd5b5afeada776fa89028f5ef29e06427d0e32529420184474e52ca77c731";
const V2_AT_BASE = "67e784e2bc7a71c6d91790aca75ea9a03c8b9e11098ae1dcbae7c7a9537b796d";

/** The numbered entries of THREAT-MODEL.md section 3 (Named residual risks), each with its continuation lines. */
function residualEntries(doc: string): string[] {
  const start = doc.indexOf("\n## 3.");
  const end = doc.indexOf("\n## 4.", start);
  expect(start, "THREAT-MODEL.md has section 3").toBeGreaterThan(-1);
  expect(end, "THREAT-MODEL.md has section 4").toBeGreaterThan(start);
  return doc
    .slice(start, end)
    .split(/\n(?=\d+\.\s)/)
    .filter((entry) => /^\d+\.\s/.test(entry));
}

/** The rows of the surfaces table: lines that start with `| <letter><digits> |`. */
function surfaceRows(doc: string): string[] {
  return doc.split("\n").filter((line) => /^\|\s*[A-Z]\d+\s*\|/.test(line));
}

/** Every path under `dir`, relative to it, directories marked with a trailing slash. */
function walk(dir: string, prefix = ""): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((e) => {
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    return e.isDirectory() ? [`${rel}/`, ...walk(dir, rel)] : [rel];
  });
}

describe("python-test-index: THREAT-MODEL, fixture layout, schemas and purity", () => {
  it("AC-19: THREAT-MODEL holds an entry for the Python subprocess with its sandbox, caps, timeout and core validation", () => {
    const doc = read("docs/THREAT-MODEL.md");
    const candidates = [...surfaceRows(doc), ...residualEntries(doc)];
    const entry = candidates.find((c) => /-I\s+-S\s+-B/.test(c) && /Python/.test(c));
    expect(entry, "a THREAT-MODEL entry for the Python subprocess naming -I -S -B").toBeDefined();
    const text = entry as string;
    expect(text, "the tmpdir cwd").toMatch(/tmpdir|temporary directory/i);
    expect(text, "no shell").toMatch(/shell/i);
    expect(text, "the minimal env").toMatch(/\benv/i);
    expect(text, "the minimal env keeps PATH").toMatch(/\bPATH\b/);
    expect(text, "the file count cap").toMatch(/\b200\b/);
    expect(text, "the per-file cap").toMatch(/512\s*KiB/);
    expect(text, "the total cap").toMatch(/16\s*MiB/);
    expect(text, "the output cap").toMatch(/64\s*MiB/);
    expect(text, "the timeout").toMatch(/timeout/i);
    expect(text, "the 30 s timeout").toMatch(/30\s*s\b/);
    expect(text, "output validation").toMatch(/validat/i);
    expect(text, "output validation in core").toMatch(/core|pythonIndexFromRaw/);
  });

  it("AC-19: row A1 names CPython's parser and keeps the TypeScript parser", () => {
    const doc = read("docs/THREAT-MODEL.md");
    const a1 = doc.split("\n").find((line) => /^\|\s*A1\s*\|/.test(line));
    expect(a1, "the surface row A1").toBeDefined();
    expect(a1).toMatch(/CPython/);
    expect(a1).toMatch(/TypeScript/);
    expect(a1).toMatch(/not hand-written/i);
  });

  it("AC-19: residual risk 20 names a hostile python3 earlier on PATH, CPython parser bugs and the runner's Python version", () => {
    const doc = read("docs/THREAT-MODEL.md");
    const twenty = residualEntries(doc).find((e) => /^20\.\s/.test(e));
    expect(twenty, "residual risk 20").toBeDefined();
    const text = twenty as string;
    expect(text).toMatch(/python3/);
    expect(text, "a hostile python3 earlier on PATH").toMatch(/\bPATH\b/);
    expect(text, "CPython parser bugs").toMatch(/CPython/);
    expect(text, "CPython parser bugs").toMatch(/\bbugs?\b/i);
    expect(text, "the runner's Python version").toMatch(/version/i);
    expect(text, "deciding the grammar").toMatch(/grammar|syntax/i);
  });

  it("AC-19: fixtures/py-index/ holds no directory named test or tests and no .py file", () => {
    const dir = join(ROOT, "fixtures/py-index");
    expect(existsSync(dir), "fixtures/py-index/ exists").toBe(true);
    const paths = walk(dir);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const parts = path.split("/").filter((p) => p !== "");
      if (path.endsWith("/")) expect(["test", "tests"], path).not.toContain(parts.at(-1));
      else expect(path.endsWith(".py"), path).toBe(false);
    }
    for (const name of ["functions", "classes", "unittest", "marks", "mocks", "assertions"]) {
      expect(paths, `the ${name} fixture`).toContain(`test_${name}.py.txt`);
      expect(paths, `the ${name} golden`).toContain(`test_${name}.index.json`);
    }
  });

  it("AC-19: the purity checks pass over core's new Python index files, and both schemas are byte-identical to the base commit", async () => {
    const { purityViolations } = await import("./purity-check.js");
    const dir = join(ROOT, "packages/core/src/testIndex");
    const files = readdirSync(dir).filter((name) => /^python.*\.ts$/.test(name));
    expect(files, "the Python raw-output mapper").toContain("pythonRaw.ts");
    for (const name of files) {
      expect(purityViolations(readFileSync(join(dir, name), "utf8")), name).toEqual([]);
    }

    expect(sha256(readFileSync(join(ROOT, "schema/report.v1.json"))), "schema/report.v1.json").toBe(V1_AT_BASE);
    expect(sha256(readFileSync(join(ROOT, "schema/report.v2.json"))), "schema/report.v2.json").toBe(V2_AT_BASE);
  });
});
