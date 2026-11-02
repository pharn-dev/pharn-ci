import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { MAX_META_SCOPE_CODE_POINTS, type RunMetaContext, runMeta } from "../src/run-meta.js";
import { harness } from "./harness.js";

// meta.scope is `workflow/job`, and the workflow's `name:` is something a pull request can edit. Like the other
// PR-influenced meta strings (labels are cut to 50 code points each), it is now bounded: control characters are
// removed and it is cut to 200 code points at a code-point boundary. A normal scope is unchanged.

const ROOT = new URL("../../../", import.meta.url);
const readRoot = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

function context(workflow: string, job = "check"): RunMetaContext {
  return {
    eventName: "pull_request",
    sha: "merge000",
    workflow,
    job,
    runId: 9,
    runAttempt: 1,
    payload: {
      repository: { full_name: "demo/demo", id: 42 },
      pull_request: { number: 7, base: { sha: "a".repeat(40) }, head: { sha: "b".repeat(40) } },
    },
  };
}

const scopeOf = (workflow: string, job?: string) => runMeta(context(workflow, job), {})?.scope;

describe("meta.scope is capped", () => {
  it("the cap is 200 code points", () => {
    expect(MAX_META_SCOPE_CODE_POINTS).toBe(200);
  });

  it("a normal workflow name and job id are unchanged", () => {
    expect(scopeOf("ci")).toBe("ci/check");
    expect(scopeOf("Build & test (Node 24)", "unit-tests")).toBe("Build & test (Node 24)/unit-tests");
    expect(scopeOf("ünïcödé ✓ 🚀")).toBe("ünïcödé ✓ 🚀/check");
  });

  it("a scope of exactly 200 code points is kept whole", () => {
    const workflow = "w".repeat(200 - "/check".length);
    expect(scopeOf(workflow)).toBe(`${workflow}/check`);
  });

  it("a 5000-character workflow name is cut to 200 code points", () => {
    const scope = scopeOf("x".repeat(5000));
    expect(scope).toBe("x".repeat(200));
  });

  it("the cut never splits a surrogate pair", () => {
    const scope = scopeOf("😀".repeat(5000)) as string;
    expect(Array.from(scope)).toHaveLength(200);
    expect(scope).toBe("😀".repeat(200));
    expect(scope.length).toBe(400);
  });

  it("control characters are removed", () => {
    expect(scopeOf("ci\nfake\u0000name\u001b[31m\u0085", "check\r")).toBe("cifakename[31m/check");
  });

  it("a run whose workflow name is 5000 characters writes a schema-valid report with the capped scope", async () => {
    const { run } = await import("../src/run.js");
    const h = harness({ context: context("y".repeat(5000)) as never });
    await run(h.deps);
    const report = JSON.parse(h.written[h.outputs["report-path"] as string] as string);
    expect(report.meta.scope).toBe("y".repeat(200));
    const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
    ajv.addSchema(JSON.parse(readRoot("schema/report.v1.json")));
    const validate = ajv.compile(JSON.parse(readRoot("schema/report.v2.json")));
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
  });
});
