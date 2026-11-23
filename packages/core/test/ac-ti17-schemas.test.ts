import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runDiff } from "./ac-e1-fix-shared.js";
import { codeTable } from "./codeTable.js";
import { validateReport } from "./schema.js";

// ti17-always-true-matcher-2, AC-17. Both schemas are read inside the test body. The report signal id pattern accepts
// TI17, the known-codes description names TEST_INTEGRITY_TI17, and the policy schema has a TI17 severity key beside
// TI16 with the two TI-range descriptions naming TI01-TI17. The TI16 signal used as a template is built from a real
// check() run, so the report around the TI17 id is valid in every other field; its marker is built from parts.
// (CORE-132: the byte comparisons of both schemas with an old commit were history pins and are removed.)

const ROOT = new URL("../../../", import.meta.url);
const ID = ["TI", "17"].join("");
const CODE = ["TEST_INTEGRITY_", ID].join("");

const atHead = (file: string) => readFileSync(new URL(`schema/${file}`, ROOT), "utf8");

type PolicySchema = {
  properties: {
    test_integrity: {
      description: string;
      properties: {
        signals: { description: string; properties: Record<string, { description: string; $ref: string }> };
      };
    };
  };
};

describe("schema/report.v2.json and schema/policy.v1.json accept TI17", () => {
  it("AC-17: a TI17 signal is valid and TI18 is not, the known codes name TEST_INTEGRITY_TI17, the policy has a TI17 severity key and no longer calls TI17 an error, and the login pattern accepts an EMU login", async () => {
    // Validation: a real TI16 signal, re-labelled.
    const LINE = ["/", "/"].join("");
    const marker = `  ${LINE} ${["eslint", "-disable-next-line"].join("")} no-console`;
    const diff = [
      "diff --git a/src/a.test.ts b/src/a.test.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.test.ts",
      "+++ b/src/a.test.ts",
      "@@ -11,0 +12 @@",
      `+${marker}`,
      "",
    ].join("\n");
    const report = await runDiff(diff);
    const template = report.testIntegrity.signals.find((s) => String(s.id) === "TI16");
    expect(template, "the template TI16 signal").toBeDefined();
    const withId = (id: string) => ({
      ...report,
      testIntegrity: { ...report.testIntegrity, signals: [{ ...template, id }] },
    });
    expect(validateReport(withId(ID)), JSON.stringify(validateReport.errors)).toBe(true);
    expect(validateReport(withId(["TI", "18"].join(""))), "TI18 is rejected").toBe(false);

    // The code table names TEST_INTEGRITY_TI17 once (CORE-140: the report schema's code description is one sentence and a
    // link to that table), and a message with the code validates.
    expect(
      [...codeTable().keys()].filter((code) => code === CODE),
      "the table names the new code once",
    ).toHaveLength(1);
    expect(
      validateReport({ ...report, messages: [{ level: "warn", code: CODE, text: "x" }] }),
      JSON.stringify(validateReport.errors),
    ).toBe(true);

    // policy.v1.json: a TI17 key like TI16, the two range descriptions edited.
    const policyHead = atHead("policy.v1.json");
    const head = (JSON.parse(policyHead) as PolicySchema).properties.test_integrity;
    const ti17 = head.properties.signals.properties[ID];
    expect(ti17, "the TI17 severity key").toBeDefined();
    expect(ti17?.$ref).toBe(head.properties.signals.properties.TI16?.$ref);
    expect(ti17?.description).toContain(ID);
    expect(head.description).toContain("TI01-TI17");
    expect(head.properties.signals.description).toContain("TI01-TI17");
    expect(head.properties.signals.description, "TI17 is no longer an error").not.toMatch(/TI17 included/);
    expect(policyHead.split(`"${ID}":`).length - 1, "one TI17 key").toBe(1);

    // CORE-44 (Enterprise Managed User logins): the login definition's pattern accepts handle_shortcode.
    type LoginDef = { $defs: { login: { description: string; pattern: string } } };
    const loginHead = (JSON.parse(policyHead) as LoginDef).$defs.login;
    expect(new RegExp(loginHead.pattern, "u").test("mona-lisa_acme"), "the login pattern accepts an EMU login").toBe(
      true,
    );
  });
});
