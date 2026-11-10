import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runDiff } from "./ac-e1-fix-shared.js";
import { validateReport } from "./schema.js";

// ti17-always-true-matcher-2, AC-17. Both schemas are read inside the test body, at HEAD and at the base commit (git).
// The only edits allowed (AGENTS.md rule 2, the operator's versioned decision) are: the report signal id pattern
// accepts TI17, the known-codes description gains one inserted passage naming TEST_INTEGRITY_TI17, the policy schema
// gains a TI17 severity key beside TI16, and the policy's two TI-range descriptions change. With exactly those taken
// out, each file must be byte-identical to the base. The TI16 signal used as a template is built from a real check()
// run, so the report around the TI17 id is valid in every other field; its marker is built from parts.

const BASE = "12036e8c485a656eeb9a4a9beb869e51e37b7d80";
const ROOT = new URL("../../../", import.meta.url);
const ID = ["TI", "17"].join("");
const CODE = ["TEST_INTEGRITY_", ID].join("");
const OLD_PATTERN = '"pattern": "^TI(0[1-9]|1[0-6])$"';
const NEW_PATTERN = '"pattern": "^TI(0[1-9]|1[0-7])$"';

const atHead = (file: string) => readFileSync(new URL(`schema/${file}`, ROOT), "utf8");
const atBase = (file: string) =>
  execFileSync("git", ["show", `${BASE}:schema/${file}`], { cwd: fileURLToPath(ROOT), encoding: "utf8" });

/** Replace `from` by `to`, requiring exactly one occurrence. */
function replaceOnce(text: string, from: string, to: string, label: string): string {
  const first = text.indexOf(from);
  expect(first, `${label}: present`).toBeGreaterThan(-1);
  expect(text.indexOf(from, first + 1), `${label}: exactly once`).toBe(-1);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

/** The text `head` inserts into `base` when `head` is `base` with one contiguous insertion, else null. */
function insertion(base: string, head: string): string | null {
  let prefix = 0;
  while (prefix < base.length && base[prefix] === head[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    base[base.length - 1 - suffix] === head[head.length - 1 - suffix] &&
    head.length - suffix > prefix
  ) {
    suffix++;
  }
  if (prefix + suffix !== base.length) return null;
  return head.slice(prefix, head.length - suffix);
}

/** JSON text of a string value, as it sits in the file (both schemas are written without escaped slashes). */
const quoted = (value: string) => JSON.stringify(value);

type ReportSchema = { $defs: { message: { properties: { code: { description: string } } } } };
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

describe("schema/report.v2.json and schema/policy.v1.json accept TI17 and change nothing else", () => {
  it("AC-17: a TI17 signal is valid and TI18 is not, the known codes name TEST_INTEGRITY_TI17, the policy has a TI17 severity key and no longer calls TI17 an error, and with those edits out both files equal the base commit byte for byte", async () => {
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

    // report.v2.json: the code description gains one insertion naming TEST_INTEGRITY_TI17; the pattern accepts TI17.
    const reportHead = atHead("report.v2.json");
    const reportBase = atBase("report.v2.json");
    const headCodes = (JSON.parse(reportHead) as ReportSchema).$defs.message.properties.code.description;
    const baseCodes = (JSON.parse(reportBase) as ReportSchema).$defs.message.properties.code.description;
    const inserted = insertion(baseCodes, headCodes);
    expect(inserted, "the code description is the base one with one insertion").not.toBeNull();
    // Where a pure insertion starts can shift by a few characters (equal text on either side), so the new code is
    // checked on the descriptions: once at HEAD, never at the base.
    expect(headCodes.split(CODE).length - 1, "the description names the new code once").toBe(1);
    expect(baseCodes, "the base description does not").not.toContain(CODE);
    let reportBack = replaceOnce(reportHead, NEW_PATTERN, OLD_PATTERN, "the TI17 signal id pattern");
    reportBack = replaceOnce(reportBack, quoted(headCodes), quoted(baseCodes), "the code description");
    expect(reportBack === reportBase, "report.v2.json equals the base once the TI17 edits are out").toBe(true);

    // policy.v1.json: a TI17 key like TI16, the two range descriptions edited, nothing else.
    const policyHead = atHead("policy.v1.json");
    const policyBase = atBase("policy.v1.json");
    const head = (JSON.parse(policyHead) as PolicySchema).properties.test_integrity;
    const base = (JSON.parse(policyBase) as PolicySchema).properties.test_integrity;
    const ti17 = head.properties.signals.properties[ID];
    expect(ti17, "the TI17 severity key").toBeDefined();
    expect(ti17?.$ref).toBe(head.properties.signals.properties.TI16?.$ref);
    expect(ti17?.description).toContain(ID);
    expect(head.description).toContain("TI01-TI17");
    expect(head.properties.signals.description).toContain("TI01-TI17");
    expect(head.properties.signals.description, "TI17 is no longer an error").not.toMatch(/TI17 included/);

    // The TI17 member is removed as it sits in the text: right after the TI16 member, a flat object, once.
    const ti16At = policyHead.indexOf('"TI16": {');
    expect(ti16At, "the TI16 key").toBeGreaterThan(-1);
    const ti16End = policyHead.indexOf("}", ti16At) + 1;
    const member = new RegExp(`^,\\s*"${ID}":\\s*\\{[^{}]*\\}`).exec(policyHead.slice(ti16End));
    expect(member, "the TI17 key directly follows TI16").not.toBeNull();
    expect(policyHead.split(`"${ID}":`).length - 1, "one TI17 key").toBe(1);
    let policyBack = policyHead.slice(0, ti16End) + policyHead.slice(ti16End + (member?.[0].length ?? 0));
    policyBack = replaceOnce(policyBack, quoted(head.description), quoted(base.description), "the section description");
    policyBack = replaceOnce(
      policyBack,
      quoted(head.properties.signals.description),
      quoted(base.properties.signals.description),
      "the signals description",
    );
    expect(policyBack === policyBase, "policy.v1.json equals the base once the TI17 edits are out").toBe(true);
  });
});
