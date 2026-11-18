import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The schemas are read inside the test body, so the file loads whatever they say. (CORE-133: the LIMITS, PRECISION,
// CHANGELOG, README and THREAT-MODEL wording checks moved out.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

/** sha256 of schema/report.v1.json at the base commit 5860ba4. */
const V1_DIGEST = "c6cfd5b5afeada776fa89028f5ef29e06427d0e32529420184474e52ca77c731";

/** The part of a message-code description from `TEST_INTEGRITY_<id> (` up to the next code it names. */
function codePart(description: string, id: string): string {
  const start = description.indexOf(`TEST_INTEGRITY_${id} (`);
  if (start === -1) throw new Error(`no TEST_INTEGRITY_${id} in the description`);
  const next = description.indexOf("TEST_INTEGRITY_", start + `TEST_INTEGRITY_${id}`.length);
  return description.slice(start, next === -1 ? undefined : next);
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Every `description` string of the schema that names a TEST_INTEGRITY_ message code. */
function codeDescriptions(value: Json): string[] {
  if (value === null || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === "description" && typeof child === "string" && child.includes("TEST_INTEGRITY_TI11 (")) out.push(child);
    out.push(...codeDescriptions(child as Json));
  }
  return out;
}

describe("signal precision: the schemas record the narrower rules", () => {
  it("AC-13: the v2 schema names the caps and v1 is byte-identical", () => {
    const v2 = JSON.parse(read("schema/report.v2.json")) as Json;
    const descriptions = codeDescriptions(v2);
    expect(descriptions, "the v2 message-code description").toHaveLength(1);
    const description = descriptions[0] as string;
    const ti11Code = codePart(description, "TI11");
    expect(ti11Code, "v2: TI11 has no warn path for a removed test step").not.toMatch(/\bjob that ran tests\b/);
    const ti15Code = codePart(description, "TI15");
    expect(ti15Code, "v2: the TI15 cap of 10").toMatch(/\b10\b/);
    expect(ti15Code, "v2: the TI15 cap per change").toMatch(/\bper change\b/);

    const v1 = createHash("sha256")
      .update(readFileSync(`${ROOT}schema/report.v1.json`))
      .digest("hex");
    expect(v1, "schema/report.v1.json is byte-identical to the base commit").toBe(V1_DIGEST);
  });
});
