import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withoutTi17SchemaEdits } from "./ti17-schema.js";
import { withoutV090SchemaEdits } from "./v090-codes.js";

// The files are read inside the test body, so the file loads whatever they say. (CORE-133: the CHANGELOG, README and
// LIMITS wording checks moved out; docs-contract.test.ts checks the README code rows.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const atBase = (commit: string, path: string) => execFileSync("git", ["show", `${commit}:${path}`], { cwd: ROOT });
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
  it("AC-16: v1 is byte-identical to the base, v2 differs only in a message-code description that names the three codes with their levels, and action.yml declares no other new input", () => {
    const pin = /const BASE_COMMIT = "([0-9a-f]{40})"/.exec(read("packages/core/test/ac-test-sources-docs.test.ts"));
    expect(pin, "BASE_COMMIT in ac-test-sources-docs.test.ts").not.toBeNull();
    const base = pin?.[1] as string;

    // schema/report.v1.json is byte-identical to the base.
    expect(readFileSync(`${ROOT}schema/report.v1.json`).equals(atBase(base, "schema/report.v1.json"))).toBe(true);

    // schema/report.v2.json equals the base once the message-code description is set aside on both sides, and the
    // `languages` description, which TI02 and TI05 (ti02-ti05, merged before this change) edit.
    const before = JSON.parse(atBase(base, "schema/report.v2.json").toString("utf8")) as Json;
    // Re-pinned for fix-hints (H6): the `$defs.fix` object and the six `fix` properties are taken out first
    // (v090-codes.ts pins them exactly).
    // Re-pinned for ti17-always-true-matcher-2: the TI17 id pattern and code text are taken out first (ti17-schema.ts).
    const now = JSON.parse(withoutV090SchemaEdits(withoutTi17SchemaEdits(read("schema/report.v2.json")))) as Json;
    const paths = codeDescriptionPaths(before);
    expect(paths.map((p) => p.join("/"))).toHaveLength(1);
    const languages = ["properties", "testIntegrity", "properties", "languages", "description"];
    expect(typeof getAt(before, languages), "the languages description at the base").toBe("string");
    // ti07-tests-changed adds the optional `testIntegrity.changes` summary: set aside on both sides too.
    const changes = ["properties", "testIntegrity", "properties", "changes"];
    // agent-pr-detection (E3 item 24a) adds the optional meta.isAgentPr property: the base has none, and setAside puts
    // the marker in its place on both sides, so only that property differs.
    const isAgentPr = ["properties", "meta", "properties", "isAgentPr"];
    // A8 step 1 (TESTS_NOT_EXERCISING_CHANGES) adds the optional testIntegrity.exercise property: set aside the same way.
    const exercise = ["properties", "testIntegrity", "properties", "exercise"];
    // Re-pinned for stale instructions (Horizon 2 item H3), which adds the optional top-level setupHealth object: set
    // aside on both sides the same way.
    const setupHealth = ["properties", "setupHealth"];
    // Re-pinned for H4 (prompt-injection scan), which adds the optional top-level injection object: set aside too.
    const injection = ["properties", "injection"];
    // Re-pinned for flaky tests (A6), which gives the flaky object a description: set aside the same way.
    const flaky = ["properties", "flaky", "description"];
    // Re-pinned for dependency safety (A13, v0.8.0), which adds the optional top-level dependencies object: set aside too.
    const dependencies = ["properties", "dependencies"];
    const v080 = [flaky, dependencies];
    expect(setAside(now, [...paths, languages, changes, isAgentPr, exercise, setupHealth, injection, ...v080])).toEqual(
      setAside(before, [...paths, languages, changes, isAgentPr, exercise, setupHealth, injection, ...v080]),
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

    // action.yml declares no new input. Re-pinned for the org policy (E3 item 20), which adds exactly the `policy` and
    // `app-url` inputs: both must be declared, and with them set aside the inputs are the base's, in order.
    // Re-pinned again for the run upload (E3 item 21), which adds exactly the `upload` input to the same set-aside, and
    // for the rename of `fail-on-threshold` to `fail-on-verdict` (review 2026-11-01, finding 27), which adds that one.
    // Re-pinned for flaky tests (A6), which adds exactly the `junit-paths` input to the same set-aside, and for
    // dependency safety (A13, v0.8.0), which adds exactly the `dependencies` input, and for the private registry
    // allow-list (d05-private-registry-allowlist), which adds exactly the `dependency-allowed-hosts` input.
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
    expect(inputsNow.filter((name) => !POLICY_INPUTS.includes(name))).toEqual(
      actionInputs(atBase(base, "action.yml").toString("utf8")),
    );
  });
});
