import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "./schema.js";

// buildUploadBundle() and buildUploadMeta() are loaded from @pharn-ci/core, and the fixtures under fixtures/upload/
// and schema/upload-meta.v1.json are read, inside the test body: the build writes all of them after this test.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

type Json = Record<string, unknown>;

interface UploadCore {
  buildUploadMeta(
    report: unknown,
    extra: { version: string; createdAt: string; commentUrl: string | null },
  ): Json | null;
  buildUploadBundle(
    report: unknown,
    meta: unknown,
    options?: { messageMaxBytes?: number },
  ): {
    reportJson: string;
    metaJson: string;
  };
}

const META_ORDER = [
  "schemaVersion",
  "tool",
  "createdAt",
  "event",
  "repository",
  "repositoryId",
  "prNumber",
  "headSha",
  "baseSha",
  "mergeBase",
  "scope",
  "runId",
  "runAttempt",
  "actor",
  "prAuthor",
  "prLabels",
  "coAuthors",
  "agentHint",
  "isAgentPr",
  "commentUrl",
];

/** Every object key path of a JSON value, in traversal (insertion) order. */
function keyPaths(value: unknown, path = "$", out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) keyPaths(v, `${path}[${i}]`, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      out.push(`${path}.${key}`);
      keyPaths(v, `${path}.${key}`, out);
    }
  }
  return out;
}

/** A signal excerpt key path (testIntegrity.signals[i].base or .head), which the bundle drops. */
const isExcerpt = (path: string) => /^\$\.testIntegrity\.signals\[\d+\]\.(base|head)(\.|\[|$)/.test(path);

// Core's index loads cold, which can take seconds on a loaded host.
describe("the upload bundle", { timeout: 60_000 }, () => {
  it("AC-2: the bundle of the fixed report and clock equals the goldens byte for byte and validates", async () => {
    const { buildUploadBundle, buildUploadMeta } = (await import("@pharn-ci/core")) as unknown as UploadCore;
    const report = JSON.parse(read("fixtures/upload/report.json")) as Json;
    const extra = JSON.parse(read("fixtures/upload/extra.json")) as {
      version: string;
      createdAt: string;
      commentUrl: string | null;
    };
    const meta = buildUploadMeta(report, extra);
    expect(meta).not.toBeNull();

    const { reportJson, metaJson } = buildUploadBundle(report, meta);
    expect(reportJson).toBe(read("fixtures/upload/bundle-golden/report.json"));
    expect(metaJson).toBe(read("fixtures/upload/bundle-golden/meta.json"));

    // Each text is JSON.stringify(x, null, 2) + "\n".
    const uploadedReport = JSON.parse(reportJson) as Json;
    const uploadedMeta = JSON.parse(metaJson) as Json;
    expect(reportJson).toBe(`${JSON.stringify(uploadedReport, null, 2)}\n`);
    expect(metaJson).toBe(`${JSON.stringify(uploadedMeta, null, 2)}\n`);

    // The input's key order: the report's own (less the dropped excerpts), the meta in the upload order.
    expect(keyPaths(uploadedReport)).toEqual(keyPaths(report).filter((p) => !isExcerpt(p)));
    const metaKeys = Object.keys(uploadedMeta);
    expect(metaKeys).toEqual(META_ORDER.filter((k) => metaKeys.includes(k)));
    expect(uploadedMeta).toEqual(meta);

    // The fixture exercises what the bundle changes: a meta with every optional field and a signal excerpt.
    for (const key of META_ORDER) expect(Object.hasOwn(uploadedMeta, key), `meta.json has ${key}`).toBe(true);
    const inputSignals = (report.testIntegrity as { signals: Json[] }).signals;
    expect(
      inputSignals.some((s) => "base" in s || "head" in s),
      "control: the fixture has an excerpt",
    ).toBe(true);
    for (const signal of (uploadedReport.testIntegrity as { signals: Json[] }).signals) {
      expect(Object.hasOwn(signal, "base")).toBe(false);
      expect(Object.hasOwn(signal, "head")).toBe(false);
    }

    expect((uploadedReport.meta as Json).upload).toEqual({ status: "ok" });
    expectValidReport(uploadedReport);

    const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
    const validate = ajv.compile(JSON.parse(read("schema/upload-meta.v1.json")));
    expect(validate(uploadedMeta), JSON.stringify(validate.errors)).toBe(true);
  });
});
