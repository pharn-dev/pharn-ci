import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withoutTi17SchemaEdits } from "./ti17-schema.js";
import { withoutV090SchemaEdits } from "./v090-codes.js";

// The schemas are read inside the test body, so the file loads whatever they say. (CORE-133: the THREAT-MODEL and
// LIMITS wording checks moved out.)

const ROOT = new URL("../../../", import.meta.url);
const REPO_ROOT = fileURLToPath(ROOT);
/** The commit this increment starts from. */
const BASE_COMMIT = "0873ce23f3595a3497325635b7bf3ee93ea77687";

describe("test sources: schema", () => {
  it("AC-16: the schemas are byte-identical to the base", () => {
    const atBase = (path: string) => execFileSync("git", ["show", `${BASE_COMMIT}:${path}`], { cwd: REPO_ROOT });
    const v1 = "schema/report.v1.json";
    expect(readFileSync(new URL(v1, ROOT)).equals(atBase(v1)), `${v1} is byte-identical to ${BASE_COMMIT}`).toBe(true);

    // TI02 and TI05 (ti02-ti05) document their three message codes and the `languages` field in schema/report.v2.json,
    // and TI08, TI15 and TI16 (ti08-ti15-ti16) add their codes to the same message-code description, so the whole file
    // is no longer byte-identical to the base. ti07-tests-changed adds the optional `testIntegrity.changes` summary. Everything
    // but those two descriptions and that property still is: the schema with them taken out equals the base schema with
    // them taken out.
    const withoutEditedDescriptions = (schema: {
      $defs: { message: { properties: { code: { description?: string } } } };
      properties: {
        testIntegrity: { properties: { languages: { description?: string }; changes?: unknown; exercise?: unknown } };
        meta: { properties: { isAgentPr?: unknown } };
        setupHealth?: unknown;
        injection?: unknown;
        flaky: { description?: string };
        dependencies?: unknown;
      };
    }) => {
      const copy = structuredClone(schema);
      // A8 step 1 (TESTS_NOT_EXERCISING_CHANGES) adds the optional testIntegrity.exercise property.
      delete copy.properties.testIntegrity.properties.exercise;
      delete copy.$defs.message.properties.code.description;
      delete copy.properties.testIntegrity.properties.languages.description;
      delete copy.properties.testIntegrity.properties.changes;
      // agent-pr-detection (E3 item 24a) adds the optional meta.isAgentPr property
      delete copy.properties.meta.properties.isAgentPr;
      // Re-pinned for stale instructions (Horizon 2 item H3), which adds the optional top-level setupHealth object.
      delete copy.properties.setupHealth;
      // Re-pinned for H4 (prompt-injection scan), which adds the optional top-level injection object.
      delete copy.properties.injection;
      // Re-pinned for flaky tests (A6), which gives the flaky object a description.
      delete copy.properties.flaky.description;
      // Re-pinned for dependency safety (A13, v0.8.0), which adds the optional top-level dependencies object.
      delete copy.properties.dependencies;
      return copy;
    };
    const v2 = "schema/report.v2.json";
    // Re-pinned for fix-hints (H6): the `$defs.fix` object and the six `fix` properties are taken out first
    // (v090-codes.ts pins them exactly).
    // Re-pinned for ti17-always-true-matcher-2: the TI17 id pattern and code text are taken out first (ti17-schema.ts).
    expect(
      withoutEditedDescriptions(
        JSON.parse(withoutV090SchemaEdits(withoutTi17SchemaEdits(readFileSync(new URL(v2, ROOT), "utf8")))),
      ),
      `${v2} differs from ${BASE_COMMIT} only in the message-code and languages descriptions`,
    ).toEqual(withoutEditedDescriptions(JSON.parse(atBase(v2).toString("utf8"))));
  });
});
