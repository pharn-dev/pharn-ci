import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// buildUploadMeta() is loaded from @pharn-ci/core inside each test body: the AC tests are written before the upload
// module exists, so nothing the build adds may run while this file loads.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

type Json = Record<string, unknown>;

interface UploadCore {
  buildUploadMeta(
    report: unknown,
    extra: { version: string; createdAt: string; commentUrl: string | null },
  ): Record<string, unknown> | null;
}

const load = async () => (await import("@pharn-ci/core")) as unknown as UploadCore;

const EXTRA = {
  version: "9.8.7-test",
  createdAt: "2026-10-26T12:00:00.000Z",
  commentUrl: "https://github.com/acme/widgets/pull/7#issuecomment-55",
};

/** fixtures/golden/report.json (a Report v2 with no meta), with the given meta when one is passed. */
function reportWith(meta?: Json): Json {
  const golden = JSON.parse(read("fixtures/golden/report.json")) as Json;
  return meta === undefined ? golden : { ...golden, meta };
}

/** A meta with every optional field, its keys deliberately NOT in the upload order. */
const FULL_META: Json = {
  upload: { status: "skipped" },
  isAgentPr: true,
  agentHint: "claude-code",
  coAuthors: ["claude"],
  prLabels: ["agent", "ready"],
  prAuthor: { login: "claude[bot]", type: "Bot" },
  actor: "octocat",
  runAttempt: 2,
  runId: 9,
  scope: "ci/check",
  mergeBase: "c".repeat(40),
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  prNumber: 7,
  repositoryId: 42,
  repository: "acme/widgets",
  event: "pull_request",
};

/** A meta with only the fields every meta carries: no prNumber, baseSha or mergeBase, no optional field. */
const MINIMAL_META: Json = {
  event: "push",
  repository: "acme/widgets",
  headSha: "d".repeat(40),
  scope: "/",
  runId: 11,
  runAttempt: 1,
  upload: { status: "skipped" },
};

// Core's index loads cold, which can take seconds on a loaded host.
describe("upload metadata", { timeout: 60_000 }, () => {
  it("AC-1: a full meta gives every key in the upload order with meta's exact values, and no upload key", async () => {
    const { buildUploadMeta } = await load();
    const meta = buildUploadMeta(reportWith(FULL_META), EXTRA);
    expect(meta).not.toBeNull();
    const m = meta as Json;
    expect(Object.keys(m)).toEqual([
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
    ]);
    expect(m.schemaVersion).toBe(1);
    expect(m.tool).toEqual({ name: "pharn-ci", version: EXTRA.version });
    expect(Object.keys(m.tool as Json)).toEqual(["name", "version"]);
    expect(m.createdAt).toBe(EXTRA.createdAt);
    expect(m.commentUrl).toBe(EXTRA.commentUrl);
    for (const key of [
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
    ]) {
      expect(m[key], key).toEqual(FULL_META[key]);
      expect(typeof m[key], key).toBe(typeof FULL_META[key]);
    }
    expect(Object.hasOwn(m, "upload")).toBe(false);
  });

  it("AC-1: a minimal meta gives null prNumber, baseSha and mergeBase and none of the optional keys", async () => {
    const { buildUploadMeta } = await load();
    const meta = buildUploadMeta(reportWith(MINIMAL_META), { ...EXTRA, commentUrl: null });
    expect(meta).not.toBeNull();
    const m = meta as Json;
    expect(Object.keys(m)).toEqual([
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
    ]);
    expect(m.prNumber).toBeNull();
    expect(m.baseSha).toBeNull();
    expect(m.mergeBase).toBeNull();
    expect(m.commentUrl).toBeNull();
    expect(m.event).toBe("push");
    expect(m.headSha).toBe("d".repeat(40));
    expect(m.scope).toBe("/");
    expect(m.runId).toBe(11);
    expect(m.runAttempt).toBe(1);
    expect(Object.hasOwn(m, "upload")).toBe(false);
  });

  it("AC-1: optional fields holding null, false and empty lists are copied with that exact value and type", async () => {
    const { buildUploadMeta } = await load();
    const meta = buildUploadMeta(
      reportWith({ ...MINIMAL_META, prAuthor: null, agentHint: null, isAgentPr: false, prLabels: [], coAuthors: [] }),
      EXTRA,
    ) as Json;
    expect(meta).not.toBeNull();
    expect(meta.prAuthor).toBeNull();
    expect(meta.agentHint).toBeNull();
    expect(meta.isAgentPr).toBe(false);
    expect(meta.prLabels).toEqual([]);
    expect(meta.coAuthors).toEqual([]);
    expect(Object.hasOwn(meta, "actor")).toBe(false);
    expect(Object.hasOwn(meta, "repositoryId")).toBe(false);
  });

  it("AC-1: a report without meta gives null", async () => {
    const { buildUploadMeta } = await load();
    const report = reportWith();
    expect(Object.hasOwn(report, "meta"), "control: the golden report has no meta").toBe(false);
    expect(buildUploadMeta(report, EXTRA)).toBeNull();
  });
});
