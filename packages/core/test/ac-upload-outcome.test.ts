import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "./schema.js";

// withUploadOutcome() and UPLOAD_REPORT_MAX_BYTES are loaded from @pharn-ci/core inside each test body: the AC tests
// are written before the upload module exists, so nothing the build adds may run while this file loads.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

type Json = Record<string, unknown>;
type Message = { level: string; code: string; text: string };

interface UploadCore {
  withUploadOutcome(report: unknown, outcome: unknown): Json;
  UPLOAD_REPORT_MAX_BYTES: number;
}

const load = async () => (await import("@pharn-ci/core")) as unknown as UploadCore;

const TOO_LARGE_TEXT =
  "The run was not uploaded to pharn.dev: the report is larger than the upload limit. The check ran in full; only the history on pharn.dev misses this run.";
const tooLargeText = (n: number) =>
  `The run was not uploaded to pharn.dev: the report is larger than the upload limit (${n} bytes). The check ran in full; only the history on pharn.dev misses this run.`;

const META = {
  event: "pull_request",
  repository: "acme/widgets",
  repositoryId: 42,
  prNumber: 7,
  headSha: "b".repeat(40),
  baseSha: "a".repeat(40),
  scope: "ci/check",
  runId: 9,
  runAttempt: 1,
  actor: "octocat",
  upload: { status: "skipped" },
};

const INFO: Message = {
  level: "info",
  code: "COVERAGE_PATHS_PARTIALLY_UNMATCHED",
  text: "1 file path in the coverage report is not a tracked file in the repository; its coverage is not used.",
};
const WARN: Message = { level: "warn", code: "TEST_INTEGRITY_TEXT_TRUNCATED", text: "a test file was cut at the cap." };
const ERROR: Message = {
  level: "error",
  code: "DIFF_COVERAGE_BELOW_THRESHOLD",
  text: "Diff coverage 71.43% is below the threshold of 80%.",
};

/** fixtures/golden/report.json with the verdict and messages given, with or without meta. */
function report(verdict: "pass" | "warn" | "fail", withMeta = true): Json {
  const golden = JSON.parse(read("fixtures/golden/report.json")) as Json;
  const messages = verdict === "pass" ? [INFO] : verdict === "warn" ? [INFO, WARN] : [ERROR, INFO];
  const base = { ...golden, verdict, messages };
  return withMeta ? { ...base, meta: structuredClone(META) } : base;
}

const OUTCOMES = [
  { status: "ok", runUrl: "https://pharn.dev/acme/widgets/runs/9-1" },
  { status: "skipped", reason: "input-never" },
  { status: "skipped", reason: "no-meta" },
  { status: "skipped", reason: "no-oidc" },
  { status: "skipped", reason: "no-installation" },
  { status: "failed", reason: "upload-url:network" },
  { status: "too_large", maxBytes: 1234 },
  { status: "too_large", maxBytes: null },
] as const;

// Core's index loads cold, which can take seconds on a loaded host.
describe("the upload outcome in the report", { timeout: 60_000 }, () => {
  it("AC-7: meta.upload is exactly the status (and runUrl for ok); only too_large adds UPLOAD_TOO_LARGE and moves pass to warn; nothing is mutated and every result is valid", async () => {
    const { withUploadOutcome, UPLOAD_REPORT_MAX_BYTES } = await load();
    expect(UPLOAD_REPORT_MAX_BYTES).toBe(5242880);

    for (const verdict of ["pass", "warn", "fail"] as const) {
      const input = report(verdict);
      expectValidReport(input);
      for (const outcome of OUTCOMES) {
        const label = `${verdict} + ${JSON.stringify(outcome)}`;
        const before = structuredClone(input);
        const result = withUploadOutcome(input, outcome);
        expect(input, `${label}: the input is not mutated`).toEqual(before);
        expectValidReport(result);

        const upload = (result.meta as Json).upload;
        if (outcome.status === "ok") expect(upload, label).toEqual({ status: "ok", runUrl: outcome.runUrl });
        else expect(upload, label).toEqual({ status: outcome.status });

        if (outcome.status === "too_large") {
          const text = outcome.maxBytes === null ? TOO_LARGE_TEXT : tooLargeText(outcome.maxBytes);
          expect(result.messages, label).toEqual([
            ...(input.messages as Message[]),
            { level: "warn", code: "UPLOAD_TOO_LARGE", text },
          ]);
          expect(result.verdict, label).toBe(verdict === "pass" ? "warn" : verdict);
        } else {
          expect(result.messages, label).toEqual(input.messages);
          expect(result.verdict, label).toBe(verdict);
        }
        const { meta: resultMeta, ...resultRest } = result;
        const { meta: inputMeta, ...inputRest } = input;
        expect({ ...resultRest, messages: [], verdict: "" }, `${label}: nothing else changes`).toEqual({
          ...inputRest,
          messages: [],
          verdict: "",
        });
        const { upload: _u1, ...resultMetaRest } = resultMeta as Json;
        const { upload: _u2, ...inputMetaRest } = inputMeta as Json;
        expect(resultMetaRest, `${label}: the rest of meta is kept`).toEqual(inputMetaRest);
      }
    }
  });

  it("AC-7: a report without meta is returned unchanged for every outcome", async () => {
    const { withUploadOutcome } = await load();
    for (const verdict of ["pass", "warn", "fail"] as const) {
      const input = report(verdict, false);
      for (const outcome of OUTCOMES) {
        const before = structuredClone(input);
        const result = withUploadOutcome(input, outcome);
        expect(result, `${verdict} + ${JSON.stringify(outcome)}`).toEqual(before);
        expect(Object.hasOwn(result, "meta")).toBe(false);
      }
    }
  });
});
