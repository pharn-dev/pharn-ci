import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The schemas and the core entry point document TI06, TI12 and their message codes, and the new fixture directories
// hold must-trigger and must-not-trigger cases in the agreed shape. Files are read and the core entry point is loaded
// inside each test body. The base commit is the main commit this increment starts from. (CORE-133: the CHANGELOG,
// README, LIMITS and THREAT-MODEL wording checks moved out; docs-contract.test.ts checks the README code rows.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "98693cf95fa521affc2d0a2eec1a7ae0f312b8cb";
const CODES = ["TEST_INTEGRITY_TI06", "TEST_INTEGRITY_TI12"];
const NEW_CODES = "New codes may be added within v2";

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const readBase = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8" });

/** Every string value in a JSON document. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Every file under `dir`, relative to it. */
function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => statSync(join(dir, name)).isFile());
}

describe("TI06 and TI12: schema, exports and fixtures", () => {
  it("AC-18: schema/report.v2.json names TEST_INTEGRITY_TI06 and TEST_INTEGRITY_TI12 in its message-code description before 'New codes may be added within v2', and schema/report.v1.json is byte-identical to the base commit", () => {
    const schema = JSON.parse(read("schema/report.v2.json")) as unknown;
    const description = strings(schema).find((s) => s.includes("Known codes") && s.includes(NEW_CODES));
    expect(description, "the message-code description").toBeDefined();
    const cut = (description as string).indexOf(NEW_CODES);
    for (const code of CODES) {
      const at = (description as string).indexOf(code);
      expect(at, code).toBeGreaterThan(-1);
      expect(at, `${code} before "${NEW_CODES}"`).toBeLessThan(cut);
    }
    expect(read("schema/report.v1.json")).toBe(readBase("schema/report.v1.json"));
  });

  it("AC-18: @pharn-ci/core exports the functions detectTI06 and detectTI12", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
    expect(typeof core.detectTI06).toBe("function");
    expect(typeof core.detectTI12).toBe("function");
  });

  it("AC-18: fixtures/test-integrity/TI06/ and TI12/ each hold at least four warn-* and four pass-* cases, a Python case of each kind, text files ending .txt and diffs ending .diff of fewer than 1000 lines", () => {
    for (const signal of ["TI06", "TI12"]) {
      const dir = join(ROOT, "fixtures/test-integrity", signal);
      const cases = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      const warn = cases.filter((name) => name.startsWith("warn-"));
      const pass = cases.filter((name) => name.startsWith("pass-"));
      expect(warn.length, `${signal}: warn-* cases`).toBeGreaterThanOrEqual(4);
      expect(pass.length, `${signal}: pass-* cases`).toBeGreaterThanOrEqual(4);
      const python = (name: string) => walk(join(dir, name)).some((file) => file.endsWith(".py.txt"));
      expect(warn.some(python), `${signal}: a Python warn-* case`).toBe(true);
      expect(pass.some(python), `${signal}: a Python pass-* case`).toBe(true);
      for (const name of cases) {
        const files = walk(join(dir, name));
        expect(files, `${signal}/${name}: a diff`).toContain("change.diff");
        for (const file of files) {
          const path = `${signal}/${name}/${file}`;
          if (file.endsWith(".diff")) {
            const count = readFileSync(join(dir, name, file), "utf8").split("\n").length;
            expect(count, `${path}: fewer than 1000 lines`).toBeLessThan(1000);
          } else {
            expect(file.endsWith(".txt"), `${path}: a text file ends in .txt`).toBe(true);
          }
        }
      }
    }
  });
});
