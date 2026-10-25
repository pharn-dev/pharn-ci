import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { harness } from "./harness.js";

const ROOT = new URL("../../../", import.meta.url);
const readRoot = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

function v2Validator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  ajv.addSchema(JSON.parse(readRoot("schema/report.v1.json")));
  return ajv.compile(JSON.parse(readRoot("schema/report.v2.json")));
}

/** Runs the action with the given context and returns the parsed report.json it wrote. */
async function writtenReport(context: unknown, inputs: Record<string, string> = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({ context: context as never, inputs });
  await run(h.deps);
  const path = h.outputs["report-path"];
  expect(path, "report-path output").toBeDefined();
  return JSON.parse(h.written[path as string] as string);
}

describe("action report.json is Report v2 with meta", () => {
  it("AC-7: a pull_request run writes meta from the run context", async () => {
    const report = await writtenReport({
      eventName: "pull_request",
      sha: "merge000",
      workflow: "ci",
      job: "check",
      runId: 9,
      runAttempt: 2,
      actor: "octocat",
      payload: {
        repository: { full_name: "demo/demo", id: 42 },
        pull_request: { number: 7, base: { sha: "a".repeat(40) }, head: { sha: "b".repeat(40) } },
      },
    });
    expect(report.schemaVersion).toBe(2);
    expect(report.meta).toBeDefined();
    expect(report.meta.event).toBe("pull_request");
    expect(report.meta.repository).toBe("demo/demo");
    expect(report.meta.prNumber).toBe(7);
    expect(report.meta.headSha).toBe("b".repeat(40));
    expect(report.meta.baseSha).toBe("a".repeat(40));
    expect(report.meta.runId).toBe(9);
    expect(report.meta.runAttempt).toBe(2);
    expect(report.meta.upload).toEqual({ status: "skipped" });
    const validate = v2Validator();
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
  });

  it("AC-8: an event outside the schema's list is recorded as other", async () => {
    const report = await writtenReport(
      {
        eventName: "schedule",
        sha: "c".repeat(40),
        workflow: "ci",
        job: "check",
        runId: 9,
        runAttempt: 1,
        payload: { repository: { full_name: "demo/demo", id: 42 } },
      },
      { "base-ref": "a".repeat(40) },
    );
    expect(report.meta).toBeDefined();
    expect(report.meta.event).toBe("other");
    expect(report.meta.headSha).toBe("c".repeat(40));
    const validate = v2Validator();
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
  });
});
