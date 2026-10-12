import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { FIXTURES } from "./helpers.js";

const schema = JSON.parse(readFileSync(new URL("../schema/report.v1.json", `file://${FIXTURES}`), "utf8"));

/** Validator for schema/report.v1.json, the source of truth for Report v1. */
export const validateReport = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

/** Assert-style helper with readable failures. */
export function expectValidReport(report: unknown): void {
  if (!validateReport(report)) {
    throw new Error(`Report does not match schema/report.v1.json:\n${JSON.stringify(validateReport.errors, null, 2)}`);
  }
}
