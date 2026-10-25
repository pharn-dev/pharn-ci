import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { FIXTURES } from "./helpers.js";

const readSchema = (name: string) =>
  JSON.parse(readFileSync(new URL(`../schema/${name}`, `file://${FIXTURES}`), "utf8"));

const v1 = readSchema("report.v1.json");
const v2 = readSchema("report.v2.json");

// Format keywords in report.v2.json are annotations: no format validator is a dependency, and strict mode
// refuses a format it cannot check unless format validation is off.
const OPTIONS = { strict: true, allErrors: true, validateFormats: false } as const;

/** Validator for schema/report.v2.json, the source of truth for the report pharn-ci produces (Report v2). */
export const validateReport = (() => {
  const ajv = new Ajv2020(OPTIONS);
  ajv.addSchema(v1);
  return ajv.compile(v2);
})();

/** Validator for schema/report.v1.json, for tests about the v1 contract itself. */
export const validateReportV1 = new Ajv2020(OPTIONS).compile(v1);

/** Assert-style helper with readable failures. */
export function expectValidReport(report: unknown): void {
  if (!validateReport(report)) {
    throw new Error(`Report does not match schema/report.v2.json:\n${JSON.stringify(validateReport.errors, null, 2)}`);
  }
}
