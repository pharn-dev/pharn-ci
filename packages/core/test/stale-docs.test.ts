import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MESSAGE_HINTS } from "../src/render/markdown.js";

// Stale instructions (Horizon 2 item H3): the schema and the hints say what the signals read and report. (CORE-133:
// the README, LIMITS, THREAT-MODEL, SECURITY and CHANGELOG wording checks moved out; docs-contract.test.ts checks the
// README code rows. CORE-132: the byte-for-byte pins of the setupHealth object and the v0.7.0 code text, kept valid by
// the schema-text helpers of the history pins, are removed; the structure and the codes are checked as they are.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
/** Stale instructions' message codes. */
const SETUP_CODES = ["SETUP_STALE_SI01", "SETUP_STALE_SI02", "SETUP_STALE_SI03", "SETUP_STALE_SI04"];

describe("stale instructions: schema and hints", () => {
  it("report.v2.json carries the optional setupHealth property and names the codes; the codes are MessageCode members with a hint", () => {
    const parsed = JSON.parse(read("schema/report.v2.json")) as {
      properties: Record<string, unknown>;
      required: string[];
      $defs: { message: { properties: { code: { description: string } } } };
    };
    expect(Object.keys(parsed.properties)).toContain("setupHealth");
    expect(parsed.required).not.toContain("setupHealth");
    const description = parsed.$defs.message.properties.code.description;
    const reportTs = read("packages/core/src/report.ts");
    for (const code of SETUP_CODES) {
      expect(description, code).toContain(code);
      expect(reportTs, code).toContain(`"${code}"`);
      expect(typeof MESSAGE_HINTS[code as keyof typeof MESSAGE_HINTS], code).toBe("string");
    }
  });
});
