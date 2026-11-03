import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { harness, PR_CONTEXT, WORKSPACE } from "./harness.js";

// run() is loaded inside the test body: the AC test is written before the build removes the policy validator's
// catch-all, so nothing the build changes may run while the file loads. The Action runs against the in-memory harness
// plus injected policy deps (a fake fetch that records every call and answers the policy GET with a valid 200 policy
// response from fixtures/policy-api/, a fake OIDC token). The fault is injected into a helper the policy validator's
// walk calls (policy/grammar.ts codePointLength): while armed, the mock throws one TypeError.

const fault = vi.hoisted(() => ({
  armed: false,
  calls: 0,
  error: new TypeError("AC-3 injected fault in the policy validator"),
}));

vi.mock("../../core/src/policy/grammar.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../core/src/policy/grammar.ts")>();
  return {
    ...real,
    codePointLength: (...args: Parameters<typeof real.codePointLength>) => {
      if (fault.armed) {
        fault.calls++;
        throw fault.error;
      }
      return real.codePointLength(...args);
    },
  };
});

const ROOT = new URL("../../../", import.meta.url);
const apiFixture = (name: string) => readFileSync(new URL(`fixtures/policy-api/${name}`, ROOT), "utf8");

const TOKEN = "tok-AC3-FAKE"; // gitleaks:allow (a fake OIDC token)
const REPO = "acme/widgets";
const NOW = new Date("2026-10-26T12:00:00.000Z");

interface FetchCall {
  url: string;
  method: string;
}

/** A change adding two covered lines to src/a.ts. */
const CHANGE = {
  diff: [
    "diff --git a/src/a.ts b/src/a.ts",
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    "+++ b/src/a.ts",
    "@@ -0,0 +1,2 @@",
    "+export const a = 1;",
    "+export const b = 2;",
    "",
  ].join("\n"),
  files: ["AGENTS.md", "src/a.ts"],
  coverage: "TN:\nSF:src/a.ts\nDA:1,1\nDA:2,1\nend_of_record\n",
};

describe("the Action: an exception from our own policy validator", () => {
  it("AC-3: a fault in the policy validator on a valid app policy response fails the step with a pharn-ci: message, and no report, summary, comment or upload claims the policy was unavailable", async () => {
    const { run } = await import("../src/run.js");
    const h = harness({
      inputs: { policy: "auto", threshold: "80" },
      files: { [`${WORKSPACE}/coverage/lcov.info`]: CHANGE.coverage },
      context: { ...PR_CONTEXT, payload: { ...PR_CONTEXT.payload, repository: { full_name: REPO } } } as never,
      lsFiles: CHANGE.files,
    });
    const git = h.deps.git;
    h.deps.git = async (args) => (args[0] === "diff" ? CHANGE.diff : git(args));
    h.deps.api = { ...h.deps.api, compareDiff: async () => CHANGE.diff };
    const calls: FetchCall[] = [];
    Object.assign(h.deps, {
      fetch: async (input: unknown, init?: RequestInit): Promise<Response> => {
        const request = input instanceof Request ? input : undefined;
        calls.push({
          url: request ? request.url : String(input),
          method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
        });
        return new Response(apiFixture("envelope-valid.json"), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      getIDToken: async () => TOKEN,
      setSecret: () => {},
      hasOidcEnv: true,
      now: () => NOW,
      sleep: async () => {},
    });

    let result: unknown;
    fault.armed = true;
    fault.calls = 0;
    try {
      result = await run(h.deps);
    } finally {
      fault.armed = false;
    }

    expect(fault.calls, "the injected fault was reached through the Action's policy fetch").toBeGreaterThan(0);
    expect(h.failed, "the step failed once").toHaveLength(1);
    expect(h.failed[0], "with a pharn-ci: message").toMatch(/^pharn-ci: /);
    expect(h.failed[0], "naming the validator's own error").toContain(fault.error.message);
    expect(h.failed[0]).not.toMatch(/unavailable/i);
    expect(result, "run() returned no report").toBeUndefined();
    expect(
      Object.keys(h.written).filter((path) => path.endsWith("report.json")),
      "no report.json was written",
    ).toEqual([]);
    expect(h.summary, "no job summary was written").toEqual([]);
    expect(h.posted, "no comment was created or updated").toEqual([]);
    expect(h.apiCalls.filter((c) => c.startsWith("create") || c.startsWith("update"))).toEqual([]);
    expect(calls, "fetch was called for the policy GET only (no upload request)").toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    for (const line of [...h.warnings, ...h.infos]) {
      expect(line, "no log line claims the policy was unavailable").not.toMatch(
        /POLICY_UNAVAILABLE|could not be validated/,
      );
    }
  }, 60_000);
});
