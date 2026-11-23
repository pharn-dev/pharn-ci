import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

// The schemas, report.ts and fixtures/upload/bundle-golden/meta.json are read inside each test body: the build writes
// or changes them after this test. (CORE-132: the comparisons of report.v1.json, report.v2.json and report.ts with an
// old commit were history pins and are removed.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(path, `file://${ROOT}`), "utf8");

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

  it("AC-11: report.ts has the UPLOAD_TOO_LARGE MessageCode member", () => {
    const reportTs = read("packages/core/src/report.ts");
    const declaration = reportTs.slice(reportTs.indexOf("type MessageCode"));
    const union = declaration.slice(0, declaration.indexOf(";"));
    expect(union.length).toBeGreaterThan(0);
    expect(union).toContain('"UPLOAD_TOO_LARGE"');
  });
});
