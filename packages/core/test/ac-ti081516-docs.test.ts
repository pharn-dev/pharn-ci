import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The documents are read inside the test body, so the file loads whatever they say.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const atBase = (commit: string, path: string) => execFileSync("git", ["show", `${commit}:${path}`], { cwd: ROOT });
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

const j = (...parts: string[]) => parts.join("");
const IDS = [j("TI", "08"), j("TI", "15"), j("TI", "16")];
const code = (id: string) => j("TEST_INTEGRITY_", id);
const LEVELS: Record<string, string> = {
  [IDS[0] as string]: "warn",
  // precision-v030: TI15 became an info signal (0 of 30 sampled findings were right).
  [IDS[1] as string]: "info",
  [IDS[2] as string]: "info",
};
/** A message-code-like token: upper-case words joined by underscores. */
const CODE_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The paths of every `description` string that names a TEST_INTEGRITY_ message code. */
function codeDescriptionPaths(value: Json, path: string[] = []): string[][] {
  if (value === null || typeof value !== "object") return [];
  const out: string[][] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === "description" && typeof child === "string" && child.includes("TEST_INTEGRITY_"))
      out.push([...path, key]);
    out.push(...codeDescriptionPaths(child as Json, [...path, key]));
  }
  return out;
}

const getAt = (value: Json, path: string[]): Json =>
  path.reduce<Json>(
    (node, key) => (node !== null && typeof node === "object" ? ((node as Record<string, Json>)[key] ?? null) : null),
    value,
  );

function setAside(value: Json, paths: string[][]): Json {
  const copy = JSON.parse(JSON.stringify(value)) as Json;
  for (const path of paths) {
    const parent = getAt(copy, path.slice(0, -1));
    if (parent !== null && typeof parent === "object" && !Array.isArray(parent))
      parent[path.at(-1) as string] = "<set aside>";
  }
  return copy;
}

/** The lines under the heading line `heading` up to the next heading of level 2 to 4. */
function sectionOf(text: string, heading: string): string {
  const all = lines(text);
  const start = all.indexOf(heading);
  if (start === -1) throw new Error(`no "${heading}" heading`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,4} /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

const ITEM = /^\s*(?:[-*]|\d+\.)\s+/;

/** List items, each with its continuation lines joined and whitespace normalized (marker kept as `- `). */
function listItems(text: string): string[] {
  const items: string[] = [];
  let current: string[] | null = null;
  for (const line of lines(text)) {
    if (ITEM.test(line)) {
      if (current) items.push(normalize(current.join(" ")));
      current = [`- ${line.replace(ITEM, "")}`];
    } else if (line.trim() === "" || line.startsWith("#")) {
      if (current) items.push(normalize(current.join(" ")));
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  if (current) items.push(normalize(current.join(" ")));
  return items;
}

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

describe("TI08, TI15 and TI16: schemas and documents", () => {
  it("AC-16: v1 is byte-identical to the base, v2 differs only in a message-code description that names the three codes with their levels, and the CHANGELOG, README, action.yml and LIMITS say what the SPEC asks", () => {
    const pin = /const BASE_COMMIT = "([0-9a-f]{40})"/.exec(read("packages/core/test/ac-test-sources-docs.test.ts"));
    expect(pin, "BASE_COMMIT in ac-test-sources-docs.test.ts").not.toBeNull();
    const base = pin?.[1] as string;

    // schema/report.v1.json is byte-identical to the base.
    expect(readFileSync(`${ROOT}schema/report.v1.json`).equals(atBase(base, "schema/report.v1.json"))).toBe(true);

    // schema/report.v2.json equals the base once the message-code description is set aside on both sides, and the
    // `languages` description, which TI02 and TI05 (ti02-ti05, merged before this change) edit.
    const before = JSON.parse(atBase(base, "schema/report.v2.json").toString("utf8")) as Json;
    const now = JSON.parse(read("schema/report.v2.json")) as Json;
    const paths = codeDescriptionPaths(before);
    expect(paths.map((p) => p.join("/"))).toHaveLength(1);
    const languages = ["properties", "testIntegrity", "properties", "languages", "description"];
    expect(typeof getAt(before, languages), "the languages description at the base").toBe("string");
    // ti07-tests-changed adds the optional `testIntegrity.changes` summary: set aside on both sides too.
    const changes = ["properties", "testIntegrity", "properties", "changes"];
    // agent-pr-detection (E3 item 24a) adds the optional meta.isAgentPr property: the base has none, and setAside puts
    // the marker in its place on both sides, so only that property differs.
    const isAgentPr = ["properties", "meta", "properties", "isAgentPr"];
    expect(setAside(now, [...paths, languages, changes, isAgentPr])).toEqual(
      setAside(before, [...paths, languages, changes, isAgentPr]),
    );
    const [path] = paths as [string[]];
    const beforeText = getAt(before, path) as string;
    const nowText = getAt(now, path);
    expect(typeof nowText).toBe("string");
    const description = nowText as string;
    for (const token of new Set(beforeText.match(CODE_TOKEN) ?? [])) expect(description, token).toContain(token);
    for (const id of IDS) {
      const at = description.indexOf(code(id));
      expect(at, code(id)).toBeGreaterThan(-1);
      const next = description.indexOf("TEST_INTEGRITY_", at + code(id).length);
      const window = description.slice(at, next === -1 ? at + 300 : next);
      expect(window, code(id)).toContain(LEVELS[id] as string);
    }

    // CHANGELOG: the 0.3.0 Added section has a line for each id (before that release they sat under Unreleased).
    const changelog = lines(read("CHANGELOG.md"));
    const unreleased = changelog.findIndex((line) => line.startsWith("## [0.3.0]"));
    expect(unreleased, "## [0.3.0]").toBeGreaterThan(-1);
    const afterUnreleased = changelog.slice(unreleased + 1);
    const nextRelease = afterUnreleased.findIndex((line) => line.startsWith("## ["));
    const unreleasedLines = nextRelease === -1 ? afterUnreleased : afterUnreleased.slice(0, nextRelease);
    const added = unreleasedLines.indexOf("### Added");
    expect(added, "### Added under 0.3.0").toBeGreaterThan(-1);
    const afterAdded = unreleasedLines.slice(added + 1);
    const nextSub = afterAdded.findIndex((line) => line.startsWith("### "));
    const addedLines = nextSub === -1 ? afterAdded : afterAdded.slice(0, nextSub);
    for (const id of IDS)
      expect(
        addedLines.some((line) => line.includes(id)),
        `CHANGELOG Added: ${id}`,
      ).toBe(true);

    // README: the test-integrity input row and the message-code table name the three.
    const readme = lines(read("README.md"));
    const inputRow = readme.find((line) => line.startsWith("| `test-integrity`")) ?? "";
    for (const id of IDS) expect(inputRow, `the test-integrity input row: ${id}`).toContain(id);
    for (const id of IDS) {
      const row = readme.find((line) => line.startsWith(`| \`${code(id)}\``));
      expect(row, `the ${code(id)} message-table row`).toBeDefined();
    }

    // action.yml declares no new input. Re-pinned for the org policy (E3 item 20), which adds exactly the `policy` and
    // `app-url` inputs: both must be declared, and with them set aside the inputs are the base's, in order.
    // Re-pinned again for the run upload (E3 item 21), which adds exactly the `upload` input to the same set-aside.
    const POLICY_INPUTS = ["policy", "app-url", "upload"];
    const inputsNow = actionInputs(read("action.yml"));
    for (const name of POLICY_INPUTS) expect(inputsNow, `action.yml declares ${name}`).toContain(name);
    expect(inputsNow.filter((name) => !POLICY_INPUTS.includes(name))).toEqual(
      actionInputs(atBase(base, "action.yml").toString("utf8")),
    );

    // docs/LIMITS.md: three "What … misses" sections and the hard-coded-answer line.
    const limits = read("docs/LIMITS.md");
    const ti08 = normalize(sectionOf(limits, `### What ${IDS[0]} misses`)).toLowerCase();
    expect(ti08, "the body-only inline rewrite").toContain("inline");
    expect(ti08, "the body-only inline rewrite").toMatch(/template literal|body/);
    expect(ti08, "the rename that only removes lines").toMatch(/renam/);
    expect(ti08, "the rename that only removes lines").toMatch(/remov/);
    const ti15 = normalize(sectionOf(limits, `### What ${IDS[1]} misses`)).toLowerCase();
    expect(ti15, "the detail names the literal's kind and length").toMatch(/detail names [^.]*kind[^.]*length/);
    expect(ti15, "the detail never carries the literal's text").toMatch(/never[^.]*text/);
    expect(ti15, "no detail quotes the literal").not.toMatch(/quotes up to/);
    sectionOf(limits, `### What ${IDS[2]} misses`);

    const item = listItems(limits).find((line) => line.startsWith("- `hard-coded-answer` —"));
    expect(item, "the hard-coded-answer item").toBeDefined();
    const text = item as string;
    expect(text.startsWith(`- \`hard-coded-answer\` — missed; planned: ${IDS[1]}`), text).toBe(true);
    expect(text, "the change adds no test line").toMatch(
      /no (added )?test line|adds no line to a test|no line in a test/i,
    );
    expect(text, "its numbers are one digit").toMatch(/(one|single)[- ]digit/i);
  });
});
