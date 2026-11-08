import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MESSAGE_HINTS } from "../src/render/markdown.js";
import { V070_CODE_TEXT, V070_SETUP_CODES, V070_SETUP_SCHEMA_TEXT, V070_SETUP_TEXT } from "./v070-codes.js";

// Stale instructions (Horizon 2 item H3): the schema, the hints and the documents say what the signals read and report.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("stale instructions: schema, hints and documents", () => {
  it("report.v2.json carries the setupHealth property and the v0.7.0 code text once each; the codes are MessageCode members with a hint", () => {
    const schema = read("schema/report.v2.json");
    expect(schema.split(V070_SETUP_SCHEMA_TEXT)).toHaveLength(2);
    expect(schema.split(V070_CODE_TEXT)).toHaveLength(2);
    expect(V070_CODE_TEXT.startsWith(` Codes added in v0.7.0: ${V070_SETUP_TEXT}, `)).toBe(true);
    const parsed = JSON.parse(schema) as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(parsed.properties)).toContain("setupHealth");
    expect(parsed.required).not.toContain("setupHealth");
    const reportTs = read("packages/core/src/report.ts");
    for (const code of V070_SETUP_CODES) {
      expect(reportTs, code).toContain(`"${code}"`);
      expect(typeof MESSAGE_HINTS[code as keyof typeof MESSAGE_HINTS], code).toBe("string");
    }
  });

  it("the README, LIMITS, THREAT-MODEL, SECURITY and CHANGELOG describe the new read of the instruction files", () => {
    const readme = read("README.md");
    expect(readme).toContain("## Stale agent instructions");
    expect(readme).toContain("**What is read.** This is a read of the Markdown instruction files");
    for (const code of V070_SETUP_CODES) expect(readme, code).toContain(`| \`${code}\` |`);
    expect(read("docs/LIMITS.md")).toContain("## Stale agent instructions");
    const threat = read("docs/THREAT-MODEL.md");
    expect(threat).toMatch(/^\| C8 {2}\| Agent instruction text, the root `package.json` and `Makefile`/m);
    expect(threat).toContain("40. **The stale-instruction signals read instruction text on every run");
    expect(read("SECURITY.md")).toContain("(stale instructions SI01 to SI04)");
    const unreleased = read("CHANGELOG.md").split("## [0.6.0]")[0] as string;
    expect(unreleased).toContain("Stale agent instructions, signals SI01 to SI04");
  });
});
