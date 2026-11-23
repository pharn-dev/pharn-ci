import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";

// The files are read inside the test body, so the file loads whatever they say. (CORE-133: the CHANGELOG, README and
// LIMITS wording checks moved out; docs-contract.test.ts checks the README code rows. CORE-132: the comparisons of
// report.v1.json, report.v2.json and the action.yml inputs with an old commit were history pins and are removed.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));

const j = (...parts: string[]) => parts.join("");
const IDS = [j("TI", "08"), j("TI", "15"), j("TI", "16")];
const code = (id: string) => j("TEST_INTEGRITY_", id);
const LEVELS: Record<string, string> = {
  [IDS[0] as string]: "warn",
  // precision-v030: TI15 became an info signal (0 of 30 sampled findings were right).
  [IDS[1] as string]: "info",
  [IDS[2] as string]: "info",
};

/** The input names action.yml declares: the two-space keys under `inputs:`. */
function actionInputs(text: string): string[] {
  const all = lines(text);
  const start = all.indexOf("inputs:");
  if (start === -1) throw new Error("action.yml has no inputs:");
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).flatMap((line) => {
    const m = /^ {2}([A-Za-z0-9_-]+):/.exec(line);
    return m ? [m[1] as string] : [];
  });
}

describe("TI08, TI15 and TI16: schemas and action.yml", () => {
  it("AC-16: the code table documents the three codes with their levels, and action.yml declares the inputs added since", () => {
    // CORE-140: the schema's code description became one sentence and a link to the code table of docs/output.md.
    for (const id of IDS) expect(codeRow(code(id)), code(id)).toContain(`\`${LEVELS[id] as string}\``);

    const POLICY_INPUTS = [
      "policy",
      "app-url",
      "upload",
      "fail-on-verdict",
      "junit-paths",
      "dependencies",
      "dependency-allowed-hosts",
    ];
    const inputsNow = actionInputs(read("action.yml"));
    for (const name of POLICY_INPUTS) expect(inputsNow, `action.yml declares ${name}`).toContain(name);
  });
});
