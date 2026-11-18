import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withoutTi17SchemaEdits } from "./ti17-schema.js";
import { withoutV090SchemaEdits } from "./v090-codes.js";

// purityViolations is loaded inside the test body, like the other AC tests: nothing the build changes runs while the
// file loads.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** sha256 of schema/report.v1.json at the base commit 5a42169. */
const V1_AT_BASE = "c6cfd5b5afeada776fa89028f5ef29e06427d0e32529420184474e52ca77c731";
/**
 * sha256 of JSON.stringify of schema/report.v2.json with the message-code description and the `languages` description
 * taken out, as it was at the base commit 5a42169 and still is. TI02 and TI05 (ti02-ti05) edit exactly those two
 * descriptions, and TI08, TI15 and TI16 (ti08-ti15-ti16) add their codes to the first, so the whole file is no longer
 * byte-identical to the base; the rest of it still is.
 */
const V2_WITHOUT_EDITED_DESCRIPTIONS = "d7a9ec11cf2212f2ff82cf7fd42f27cfa73896151f69281ad595c4fc933c3737";

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

  it("AC-19: the purity checks pass over core's new Python index files, v1 is byte-identical to the base commit and v2 differs from it only in its message-code and languages descriptions", async () => {
    const { purityViolations } = await import("./purity-check.js");
    const dir = join(ROOT, "packages/core/src/testIndex");
    const files = readdirSync(dir).filter((name) => /^python.*\.ts$/.test(name));
    expect(files, "the Python raw-output mapper").toContain("pythonRaw.ts");
    for (const name of files) {
      expect(purityViolations(readFileSync(join(dir, name), "utf8")), name).toEqual([]);
    }

    expect(sha256(readFileSync(join(ROOT, "schema/report.v1.json"))), "schema/report.v1.json").toBe(V1_AT_BASE);
    // Re-pinned for fix-hints (H6): the `$defs.fix` object and the six `fix` properties are taken out first
    // (v090-codes.ts pins them exactly).
    // Re-pinned for ti17-always-true-matcher-2: the TI17 id pattern and code text are taken out first (ti17-schema.ts).
    const v2 = JSON.parse(withoutV090SchemaEdits(withoutTi17SchemaEdits(read("schema/report.v2.json")))) as {
      $defs: { message: { properties: { code: { description?: string } } } };
      properties: {
        testIntegrity: { properties: { languages: { description?: string }; changes?: unknown; exercise?: unknown } };
        meta: { properties: { isAgentPr?: unknown } };
        setupHealth?: unknown;
        injection?: unknown;
        flaky: { description?: string };
        dependencies?: unknown;
      };
    };
    // Re-pinned for flaky tests (A6), which gives the flaky object a description.
    delete v2.properties.flaky.description;
    // Re-pinned for stale instructions (Horizon 2 item H3), which adds the optional top-level setupHealth object.
    delete v2.properties.setupHealth;
    // Re-pinned for H4 (prompt-injection scan), which adds the optional top-level injection object.
    expect(v2.properties.injection, "the injection object H4 adds").toBeDefined();
    delete v2.properties.injection;
    // Re-pinned for dependency safety (A13, v0.8.0), which adds the optional top-level dependencies object.
    expect(v2.properties.dependencies, "the dependencies object A13 adds").toBeDefined();
    delete v2.properties.dependencies;
    delete v2.$defs.message.properties.code.description;
    // A8 step 1 (TESTS_NOT_EXERCISING_CHANGES) adds the optional testIntegrity.exercise property.
    delete v2.properties.testIntegrity.properties.exercise;
    delete v2.properties.testIntegrity.properties.languages.description;
    // ti07-tests-changed adds the optional testIntegrity.changes summary.
    delete v2.properties.testIntegrity.properties.changes;
    // agent-pr-detection (E3 item 24a) adds the optional meta.isAgentPr property
    delete v2.properties.meta.properties.isAgentPr;
    expect(
      sha256(Buffer.from(JSON.stringify(v2))),
      "schema/report.v2.json without the message-code and languages descriptions",
    ).toBe(V2_WITHOUT_EDITED_DESCRIPTIONS);
  });
});
