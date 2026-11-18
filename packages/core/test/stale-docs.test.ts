import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MESSAGE_HINTS } from "../src/render/markdown.js";
import { withoutR3SchemaTextEdits } from "./r3-schema-text.js";
import { V070_CODE_TEXT, V070_SETUP_CODES, V070_SETUP_SCHEMA_TEXT, V070_SETUP_TEXT } from "./v070-codes.js";
import { withoutV090SchemaEdits } from "./v090-codes.js";

// Stale instructions (Horizon 2 item H3): the schema and the hints say what the signals read and report. (CORE-133:
// the README, LIMITS, THREAT-MODEL, SECURITY and CHANGELOG wording checks moved out; docs-contract.test.ts checks the
// README code rows.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("stale instructions: schema and hints", () => {
  it("report.v2.json carries the setupHealth property and the v0.7.0 code text once each; the codes are MessageCode members with a hint", () => {
    // Re-pinned for fix-hints (H6): the `fix` property of the stale items is part of the setupHealth object's text, so the
    // fix additions are taken out first (v090-codes.ts pins them exactly).
    // Re-pinned for the R3 schema text follow-up: its six description edits (two inside the v0.7.0 code text) are put
    // back first (r3-schema-text.ts pins them exactly).
    const schema = withoutV090SchemaEdits(withoutR3SchemaTextEdits(read("schema/report.v2.json")));
    expect(schema.split(V070_SETUP_SCHEMA_TEXT)).toHaveLength(2);
    expect(schema.split(V070_CODE_TEXT)).toHaveLength(2);
    // Re-pinned for H4 (prompt-injection scan): its INJECTION_ codes sort before SETUP_STALE_ in code-unit order, so they
    // open the one v0.7.0 sentence and the setup part follows them.
    expect(V070_CODE_TEXT.startsWith(" Codes added in v0.7.0: INJECTION_PI01 (")).toBe(true);
    expect(V070_CODE_TEXT).toContain(`, ${V070_SETUP_TEXT}, `);
    const parsed = JSON.parse(schema) as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(parsed.properties)).toContain("setupHealth");
    expect(parsed.required).not.toContain("setupHealth");
    const reportTs = read("packages/core/src/report.ts");
    for (const code of V070_SETUP_CODES) {
      expect(reportTs, code).toContain(`"${code}"`);
      expect(typeof MESSAGE_HINTS[code as keyof typeof MESSAGE_HINTS], code).toBe("string");
    }
  });
});
