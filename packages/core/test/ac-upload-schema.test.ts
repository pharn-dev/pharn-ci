import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

// The schemas, report.ts and fixtures/upload/bundle-golden/meta.json are read inside each test body: the build writes
// or changes them after this test. The base is main at f563d7d, read with git.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(path, `file://${ROOT}`), "utf8");
const BASE = "f563d7d";
const atBase = (path: string) =>
  execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

type Json = Record<string, unknown>;

const REQUIRED = [
  "schemaVersion",
  "tool",
  "createdAt",
  "event",
  "repository",
  "prNumber",
  "headSha",
  "baseSha",
  "mergeBase",
  "scope",
  "runId",
  "runAttempt",
  "commentUrl",
];

const SENTENCE =
  " UPLOAD_TOO_LARGE (warn: the run was not uploaded because the report is larger than the upload limit; the check ran in full).";
// Re-pinned for E3 item 22 (policy rules): the same description then gains exactly this text, which names the two rule
// codes POLICY_P08 and POLICY_P09; report.ts gains those two MessageCode members. Nothing else may change.
const POLICY_RULES_TEXT =
  " POLICY_P08 (error, or the level the org policy sets for P08: tracked files match a forbidden file pattern of the org policy; the message names up to 20 paths and the count) and POLICY_P09 (error, or warn for an agent settings file whose direction is not judged yet: the change edits a file the org policy guards; the message names up to 20 paths and the count; each reason is in policy.violations).";
const POLICY_RULE_CODES = ["POLICY_P08", "POLICY_P09"];
// Re-pinned for E3 item 24a part B (P11): the same description then gains exactly this text, which names the two codes
// POLICY_P11 and AGENT_PR_DETECTION_INCOMPLETE; report.ts gains those two MessageCode members. Nothing else may change.
const P11_TEXT =
  " POLICY_P11 (error, or warn when the org policy sets agents.protected_paths_mode or the rule to warn: an agent pull request changes paths the org policy protects, or could not be checked because the diff, or the policy file at the merge base, could not be read; the message names up to 20 paths and the evidence as fixed words, never a pattern, label or login) and AGENT_PR_DETECTION_INCOMPLETE (warn: the pull request counts as an agent PR because its evidence could not be read in full, and the org policy protects paths; the message names the reason as one fixed word).";
const P11_CODES = ["POLICY_P11", "AGENT_PR_DETECTION_INCOMPLETE"];
// Re-pinned for E3 item 23 (policy settings): the same description then gains exactly this text, which names the five
// rule codes POLICY_P02 to POLICY_P06 and POLICY_SETTINGS_INVALID; report.ts gains those six MessageCode members.
const POLICY_SETTINGS_TEXT =
  " POLICY_P02, POLICY_P03, POLICY_P04, POLICY_P05 and POLICY_P06 (error, or warn for the additionalDirectories check of P02, or the level the org policy sets for the rule: the committed agent settings or MCP files break org policy rule P02, P03, P04, P05 or P06; the message names up to 20 locations as path and line, and the count; each reason is in policy.violations) and POLICY_SETTINGS_INVALID (warn, or error for a file pharn-ci could not read or a problem a required list depends on: the rules P02 to P06 could not fully use an agent settings or MCP file, or did not run; the message names up to 20 problems as path, line and reason, never file text).";
const POLICY_SETTINGS_CODES = [
  "POLICY_P02",
  "POLICY_P03",
  "POLICY_P04",
  "POLICY_P05",
  "POLICY_P06",
  "POLICY_SETTINGS_INVALID",
];

/** Every object schema inside a JSON Schema document (by `type` naming object, or by `properties`). */
function objectSchemas(value: unknown, path = "$", out: Array<[string, Json]> = []): Array<[string, Json]> {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) objectSchemas(v, `${path}[${i}]`, out);
  } else if (value !== null && typeof value === "object") {
    const node = value as Json;
    const type = node.type;
    const isObject = type === "object" || (Array.isArray(type) && type.includes("object")) || "properties" in node;
    if (isObject) out.push([path, node]);
    for (const [key, v] of Object.entries(node)) {
      // `properties` maps names to schemas; a property named like a keyword is still a schema.
      objectSchemas(v, `${path}.${key}`, out);
    }
  }
  return out;
}

/** Every string in a JSON value. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

const codeWords = (text: string) =>
  [...new Set([...text.matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g)].map((m) => m[0]))].sort();
const upperWords = (text: string) => [...new Set([...text.matchAll(/\b[A-Z][A-Z0-9_]+\b/g)].map((m) => m[0]))].sort();
const added = (head: string[], base: string[]) => head.filter((w) => !base.includes(w));

// git is spawned for the base texts, which can take seconds on a loaded host.
describe("schema/upload-meta.v1.json and the report schema", { timeout: 60_000 }, () => {
  it("AC-10: upload-meta.v1.json compiles strictly, is closed everywhere, accepts the golden meta.json and rejects each malformed copy", () => {
    const schema = JSON.parse(read("schema/upload-meta.v1.json")) as Json;
    expect(schema.$id).toBe("https://pharn.dev/schemas/ci/upload-meta.v1.json");
    const objects = objectSchemas(schema);
    expect(objects.length).toBeGreaterThanOrEqual(3);
    for (const [path, node] of objects) expect(node.additionalProperties, path).toBe(false);

    const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
    const validate = ajv.compile(schema);
    const golden = JSON.parse(read("fixtures/upload/bundle-golden/meta.json")) as Json;
    expect(validate(golden), JSON.stringify(validate.errors)).toBe(true);

    const rejects = (label: string, doc: unknown) => expect(validate(doc), label).toBe(false);
    for (const key of REQUIRED) {
      expect(Object.hasOwn(golden, key), `control: the golden has ${key}`).toBe(true);
      const { [key]: _dropped, ...rest } = golden;
      rejects(`missing ${key}`, rest);
    }
    rejects("an extra key", { ...golden, extra: 1 });
    rejects("an extra key in tool", { ...golden, tool: { ...(golden.tool as Json), extra: 1 } });
    rejects("an extra key in prAuthor", { ...golden, prAuthor: { login: "octocat", type: "User", extra: 1 } });
    rejects("schemaVersion 2", { ...golden, schemaVersion: 2 });
    rejects("tool.name other", { ...golden, tool: { ...(golden.tool as Json), name: "pharn" } });
    for (const createdAt of ["2026-10-26T12:00:00.000+00:00", "2026-10-26 12:00:00Z", "2026-10-26T12:00:00", "x"]) {
      rejects(`createdAt ${createdAt}`, { ...golden, createdAt });
    }
    rejects("an upper-case headSha", { ...golden, headSha: "B".repeat(40) });
    rejects("a 39-character headSha", { ...golden, headSha: "b".repeat(39) });
    rejects("prNumber 0", { ...golden, prNumber: 0 });
    rejects("runAttempt 0", { ...golden, runAttempt: 0 });
    for (const event of ["release", "schedule", "", "PULL_REQUEST"]) rejects(`event ${event}`, { ...golden, event });
    for (const type of ["Admin", "user", ""]) {
      rejects(`prAuthor.type ${type}`, { ...golden, prAuthor: { login: "octocat", type } });
    }

    // Controls: the accepted forms the SPEC names.
    for (const event of ["pull_request", "merge_group", "push", "workflow_run", "workflow_dispatch", "other"]) {
      expect(validate({ ...golden, event }), `event ${event}`).toBe(true);
    }
    for (const type of ["User", "Bot", "Organization"]) {
      expect(validate({ ...golden, prAuthor: { login: "octocat", type } }), `prAuthor.type ${type}`).toBe(true);
    }
    expect(validate({ ...golden, prAuthor: null }), "prAuthor null").toBe(true);
    expect(validate({ ...golden, createdAt: "2026-10-26T12:00:00Z" }), "createdAt without fraction").toBe(true);
    expect(validate({ ...golden, headSha: "e".repeat(64) }), "a 64-character headSha").toBe(true);
    expect(validate({ ...golden, prNumber: null, baseSha: null, mergeBase: null, commentUrl: null })).toBe(true);
  });

  it("AC-11: report.v1.json is byte-identical, report.v2.json gains only the UPLOAD_TOO_LARGE sentence, and report.ts only the MessageCode member", () => {
    expect(read("schema/report.v1.json")).toBe(atBase("schema/report.v1.json"));

    const v2Base = atBase("schema/report.v2.json");
    const v2 = read("schema/report.v2.json");
    const baseDescription = strings(JSON.parse(v2Base)).find((s) => s.includes(" Codes added in v0.4.0:"));
    expect(baseDescription, "control: the base has the v0.4.0 text").toBeDefined();
    const description = strings(JSON.parse(v2)).find((s) => s.includes(" Codes added in v0.4.0:"));
    expect(description).toBe(`${baseDescription}${SENTENCE}${POLICY_RULES_TEXT}${P11_TEXT}${POLICY_SETTINGS_TEXT}`);
    expect(v2.split(" Codes added in v0.4.0:").length - 1).toBe(1);

    // Every other line is the base's.
    const baseLines = v2Base.split("\n");
    const lines = v2.split("\n");
    expect(lines).toHaveLength(baseLines.length);
    const changed = lines.flatMap((line, i) => (line === baseLines[i] ? [] : [i]));
    expect(changed).toHaveLength(1);
    // The parsed documents differ only in that one description.
    const swap = (text: string, from: string, to: string) =>
      JSON.parse(text, (_key, value) => (value === from ? to : value)) as unknown;
    expect(swap(v2, description as string, "X")).toEqual(swap(v2Base, baseDescription as string, "X"));

    expect(added(codeWords(v2), codeWords(v2Base))).toEqual(
      [...POLICY_RULE_CODES, ...P11_CODES, ...POLICY_SETTINGS_CODES, "UPLOAD_TOO_LARGE"].sort(),
    );

    const reportTsBase = atBase("packages/core/src/report.ts");
    const reportTs = read("packages/core/src/report.ts");
    expect(added(upperWords(reportTs), upperWords(reportTsBase))).toEqual(
      [...POLICY_RULE_CODES, ...P11_CODES, ...POLICY_SETTINGS_CODES, "UPLOAD_TOO_LARGE"].sort(),
    );
    const declaration = reportTs.slice(reportTs.indexOf("type MessageCode"));
    const union = declaration.slice(0, declaration.indexOf(";"));
    expect(union.length).toBeGreaterThan(0);
    expect(union).toContain('"UPLOAD_TOO_LARGE"');
  });
});
