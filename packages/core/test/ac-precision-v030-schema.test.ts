import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: the only schema change is the TEST_INTEGRITY_TI15 part of the report v2 message-code description,
// which now states the level `info` in modes block and warn. report.v1.json and every other byte of report.v2.json
// are identical to their copies at b31de0c, the commit this increment starts from (read with git show).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "b31de0c";
const START = "TEST_INTEGRITY_TI15 (";

// Re-pinned for the agent-config secrets change (E3 item 26): report.v2.json may also carry one appended text, the one
// starting ` Codes added in v0.4.0:` right after the final sentence of the message-code description, which names the 12
// AGENT_CONFIG_SECRET_ codes. It is cut out of the current schema before the comparison with b31de0c; everything else
// is as before.
const FINAL_SENTENCE = "No code is removed or renamed before 1.0.";
const APPENDED_START = " Codes added in v0.4.0:";
const SECRET_CODES = [
  ...Array.from({ length: 11 }, (_, i) => `AGENT_CONFIG_SECRET_S${String(i + 1).padStart(2, "0")}`),
  "AGENT_CONFIG_SECRET_UNSCANNED",
];

// agent-pr-detection (E3 item 24a) adds the optional meta.isAgentPr property: the four lines it inserts after the
// `agentHint` line of meta.properties.
const IS_AGENT_PR_LINES = [
  '        "isAgentPr": {',
  '          "description": "true when the pull request counts as an agent PR, including when detection could not read all of its evidence; false when the run has no pull request.",',
  '          "type": "boolean"',
  "        },",
  "",
].join("\n");

const readNow = (path: string) => readFileSync(join(ROOT, path));
const readBase = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT }) as Buffer;

/** The text without the appended agent-config secrets text, and that text (to the end of the JSON string). */
function cutAppended(text: string): { cut: string; appended: string } {
  const at = text.indexOf(FINAL_SENTENCE) + FINAL_SENTENCE.length;
  let end = at;
  while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
  return { cut: text.slice(0, at) + text.slice(end), appended: text.slice(at, end) };
}

/** The [start, end) of the part from `TEST_INTEGRITY_TI15 (` to the next `TEST_INTEGRITY_` code, which must be unique. */
function ti15Part(text: string, label: string): [number, number] {
  const start = text.indexOf(START);
  if (start === -1) throw new Error(`${label}: no "${START}"`);
  if (text.indexOf(START, start + 1) !== -1) throw new Error(`${label}: "${START}" appears more than once`);
  const next = text.indexOf("TEST_INTEGRITY_", start + START.length);
  return [start, next === -1 ? text.length : next];
}

describe("schema: only the TI15 level sentence changes", () => {
  it("AC-9: report.v1.json is byte-identical to b31de0c; the v2 TEST_INTEGRITY_TI15 part says info in modes block and warn; every other v2 byte is unchanged", () => {
    expect(
      readNow("schema/report.v1.json").equals(readBase("schema/report.v1.json")),
      "report.v1.json is byte-identical to its copy at b31de0c",
    ).toBe(true);

    // agent-pr-detection (E3 item 24a) adds the optional meta.isAgentPr property
    // Its four inserted lines appear once in the current schema and are cut out before the comparison with the base.
    const withIsAgentPr = readNow("schema/report.v2.json").toString("utf8");
    expect(withIsAgentPr.split(IS_AGENT_PR_LINES).length - 1, "the four isAgentPr lines appear once").toBe(1);
    const current = withIsAgentPr.replace(IS_AGENT_PR_LINES, "");
    const { cut: now, appended } = cutAppended(current);
    expect(appended.startsWith(APPENDED_START), "the appended text starts right after the final sentence").toBe(true);
    for (const code of SECRET_CODES) expect(appended, `the appended text names ${code}`).toContain(code);
    const baseBytes = readBase("schema/report.v2.json");
    const base = baseBytes.toString("utf8");
    const [ns, ne] = ti15Part(now, "now");
    const [bs, be] = ti15Part(base, "base");
    expect(base.slice(bs, be), "control: the base part states the level warn").toContain("the level is warn");

    const part = now.slice(ns, ne);
    expect(part).toContain("info in modes block and warn");
    expect(part).not.toContain("the level is warn");
    const restored = now.slice(0, ns) + base.slice(bs, be) + now.slice(ne);
    expect(
      Buffer.from(restored, "utf8").equals(baseBytes),
      "report.v2.json with the TI15 part put back is byte-identical to its copy at b31de0c",
    ).toBe(true);
  });
});
