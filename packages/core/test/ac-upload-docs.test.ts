import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// action.yml is read inside the test body: the build edits it after this test. (CORE-133: the README, THREAT-MODEL,
// LIMITS, SECURITY, MARKETPLACE and CHANGELOG wording checks and the action.yml description wording moved out;
// docs-contract.test.ts checks the README input rows and their defaults.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(path, `file://${ROOT}`), "utf8").replace(/\r\n/g, "\n");

/** The lines after the first line matching `start` and before the next line matching `end` (to the end if none). */
function between(lines: string[], start: (line: string) => boolean, end: (line: string) => boolean): string[] {
  const from = lines.findIndex(start);
  if (from === -1) return [];
  const rest = lines.slice(from + 1);
  const to = rest.findIndex(end);
  return to === -1 ? rest : rest.slice(0, to);
}

/** action.yml inputs or outputs: name -> the lines of its entry. */
function yamlSection(text: string, name: "inputs" | "outputs"): Map<string, string[]> {
  const lines = between(
    text.split("\n"),
    (l) => l === `${name}:`,
    (l) => /^\S/.test(l),
  );
  const entries = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of lines) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      current = m[1] as string;
      entries.set(current, []);
    } else if (current !== undefined && line.startsWith("    ")) {
      entries.get(current)?.push(line.trim());
    }
  }
  return entries;
}

const defaultOf = (entry: string[] | undefined) =>
  entry
    ?.find((l) => l.startsWith("default:"))
    ?.slice("default:".length)
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");

describe("upload metadata in action.yml", () => {
  it("AC-34: action.yml declares the upload input (default auto) and the run-url output", () => {
    const actionYml = read("action.yml");
    const inputs = yamlSection(actionYml, "inputs");
    expect(inputs.has("upload")).toBe(true);
    expect(defaultOf(inputs.get("upload"))).toBe("auto");
    expect(yamlSection(actionYml, "outputs").has("run-url")).toBe(true);
  });
});
