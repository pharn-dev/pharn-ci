import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// purityViolations is loaded inside the test body, like the other AC tests: nothing the build changes runs while the
// file loads. (CORE-132: the digest of report.v2.json as at an old commit, kept valid by the schema-text helpers of the
// history pins, is removed; report.v1.json, which never changes, keeps its digest.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** sha256 of schema/report.v1.json at the base commit 5a42169. */
const V1_AT_BASE = "c6cfd5b5afeada776fa89028f5ef29e06427d0e32529420184474e52ca77c731";

/** Every path under `dir`, relative to it, directories marked with a trailing slash. */
function walk(dir: string, prefix = ""): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((e) => {
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    return e.isDirectory() ? [`${rel}/`, ...walk(dir, rel)] : [rel];
  });
}

// CORE-133: the THREAT-MODEL wording checks moved out.
describe("python-test-index: fixture layout, schemas and purity", () => {
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

  it("AC-19: the purity checks pass over core's new Python index files and v1 is byte-identical to the base commit", async () => {
    const { purityViolations } = await import("./purity-check.js");
    const dir = join(ROOT, "packages/core/src/testIndex");
    const files = readdirSync(dir).filter((name) => /^python.*\.ts$/.test(name));
    expect(files, "the Python raw-output mapper").toContain("pythonRaw.ts");
    for (const name of files) {
      expect(purityViolations(readFileSync(join(dir, name), "utf8")), name).toEqual([]);
    }

    expect(sha256(readFileSync(join(ROOT, "schema/report.v1.json"))), "schema/report.v1.json").toBe(V1_AT_BASE);
  });
});
