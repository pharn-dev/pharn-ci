import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT, WORKSPACE } from "./harness.js";

// run() and the fixtures under fixtures/policy-api/ and fixtures/policy-precedence/root-pkg/ are loaded inside each
// test body: the AC test is written before the org policy exists, so nothing the build adds may run while the file
// loads. The root-pkg fixture is written by the build, so the test first checks that it holds the case the AC
// describes: a change under pkg/ and coverage paths relative to pkg.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const NOW = new Date("2026-10-26T12:00:00.000Z");

type Message = { level: string; code: string; text: string };
type Report = { messages: Message[]; diffCoverage: { files: { path: string }[] } | null };

async function orderedRun(inputs: Record<string, string>, files: Record<string, string>, envelope: string) {
  const { run } = await import("../src/run.js");
  const dir = "fixtures/policy-precedence/root-pkg";
  const diff = read(`${dir}/pr.diff`);
  const context = { ...PR_CONTEXT, payload: { ...PR_CONTEXT.payload, repository: { full_name: "acme/widgets" } } };
  const workspaceFiles: Record<string, string> = { [`${WORKSPACE}/coverage/lcov.info`]: read(`${dir}/coverage.info`) };
  for (const [path, text] of Object.entries(files)) workspaceFiles[`${WORKSPACE}/${path}`] = text;
  const h = harness({
    inputs: { threshold: "80", ...inputs },
    files: workspaceFiles,
    lsFiles: read(`${dir}/files.txt`).trim().split("\n"),
    context: context as never,
  });
  const git = h.deps.git;
  h.deps.git = async (args) => (args[0] === "diff" ? diff : git(args));
  h.deps.api = { ...h.deps.api, compareDiff: async () => diff };
  const calls: string[] = [];
  const tokenCalls: unknown[] = [];
  Object.assign(h.deps, {
    fetch: async (input: unknown) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return new Response(envelope, { status: 200, headers: { "content-type": "application/json" } });
    },
    getIDToken: async (audience?: string) => {
      tokenCalls.push(audience);
      return "tok-SECRET-123";
    },
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async () => {},
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  return { h, report: text === undefined ? undefined : (JSON.parse(text) as Report), calls, tokenCalls };
}

describe("the policy is obtained after the config and before coverage is read", () => {
  it("AC-27: an app coverage.root applies to the coverage paths; a .pharn/ci.yml that does not parse fails the step before any fetch", async () => {
    const dir = "fixtures/policy-precedence/root-pkg";
    expect(read(`${dir}/pr.diff`)).toContain("+++ b/pkg/src/a.ts");
    expect(read(`${dir}/files.txt`).split("\n")).toContain("pkg/src/a.ts");
    expect(read(`${dir}/coverage.info`)).toContain("SF:src/a.ts");

    const envelope = JSON.stringify({
      ...JSON.parse(read("fixtures/policy-api/envelope-valid.json")),
      policy: { version: 1, coverage: { root: "pkg" } },
    });
    const unmatched = (report: Report) => report.messages.filter((m) => m.code === "COVERAGE_PATHS_UNMATCHED");

    // Control: without the policy, the pkg-relative coverage paths match no tracked file.
    const never = await orderedRun({ policy: "never" }, {}, envelope);
    expect(never.report).toBeDefined();
    expect(unmatched(never.report as Report)).toHaveLength(1);

    const applied = await orderedRun({ policy: "auto" }, {}, envelope);
    expect(applied.calls).toHaveLength(1);
    const report = applied.report as Report;
    expect(report).toBeDefined();
    expectValidReport(report);
    expect(unmatched(report)).toEqual([]);
    expect(report.diffCoverage?.files.map((f) => f.path)).toContain("pkg/src/a.ts");

    const broken = await orderedRun({ policy: "auto" }, { ".pharn/ci.yml": "coverage:\n\tthreshold: 90\n" }, envelope);
    expect(broken.h.failed).toHaveLength(1);
    expect(broken.h.failed[0]).toContain(".pharn/ci.yml");
    expect(broken.calls).toEqual([]);
    expect(broken.tokenCalls).toEqual([]);
  });
});
