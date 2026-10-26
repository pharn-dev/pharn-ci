import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// run() and the fixtures under fixtures/policy-api/ are loaded inside each test body: the AC tests are written before
// the org policy fetch exists, so nothing the build adds may run while the file loads. The Action runs against the
// in-memory harness plus injected policy deps: a fake fetch that records every call, a fake getIDToken (resolving or
// rejecting) and setSecret, the OIDC-env flag and the event payload's repository.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const TOKEN = "tok-SECRET-123"; // gitleaks:allow (a fake OIDC token the test proves is never printed)
const NOW = new Date("2026-10-26T12:00:00.000Z");
const ABSENT = Symbol("absent");

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[] };

interface TokenRunOptions {
  policy: string;
  oidc: boolean;
  /** The token getIDToken resolves, or the error it rejects with. */
  idToken?: string | Error;
  /** payload.repository.full_name, or ABSENT for an event with no repository. */
  repository?: unknown;
}

async function tokenRun(options: TokenRunOptions) {
  const { run } = await import("../src/run.js");
  const repository = options.repository ?? "acme/widgets";
  const payload =
    repository === ABSENT
      ? { ...PR_CONTEXT.payload }
      : { ...PR_CONTEXT.payload, repository: { full_name: repository } };
  const h = harness({
    inputs: { threshold: "80", policy: options.policy },
    context: { ...PR_CONTEXT, payload } as never,
  });
  const calls: string[] = [];
  const tokenCalls: unknown[] = [];
  Object.assign(h.deps, {
    fetch: async (input: unknown) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return new Response(read("fixtures/policy-api/envelope-valid.json"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    getIDToken: async (audience?: string) => {
      tokenCalls.push(audience);
      const token = options.idToken ?? TOKEN;
      if (token instanceof Error) throw token;
      return token;
    },
    setSecret: () => {},
    hasOidcEnv: options.oidc,
    now: () => NOW,
    sleep: async () => {},
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  const report = text === undefined ? undefined : (JSON.parse(text) as Report);
  return { h, report, calls, tokenCalls };
}

type TokenRun = Awaited<ReturnType<typeof tokenRun>>;

function reportOf(r: TokenRun): Report {
  if (r.report === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(r.h.failed)}`);
  expectValidReport(r.report);
  return r.report;
}

const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);
const logLines = (r: TokenRun) => [...r.h.infos, ...r.h.warnings, ...r.h.failed];

describe("no OIDC token, and no valid repository name", () => {
  it("AC-8: with no OIDC env or a rejected getIDToken nothing is fetched and one info line names id-token: write; required makes it an error", async () => {
    const never = reportOf(await tokenRun({ policy: "never", oidc: false }));

    const noEnv = await tokenRun({ policy: "auto", oidc: false });
    expect(noEnv.calls).toEqual([]);
    expect(noEnv.tokenCalls).toEqual([]);
    expect(noEnv.h.infos.filter((line) => line.includes("id-token: write"))).toHaveLength(1);
    expect(reportOf(noEnv)).toEqual(never);

    const rejected = await tokenRun({ policy: "auto", oidc: true, idToken: new Error("boom-detail") });
    expect(rejected.calls).toEqual([]);
    expect(rejected.h.infos.filter((line) => line.includes("id-token: write"))).toHaveLength(1);
    for (const line of logLines(rejected)) expect(line).not.toContain("boom-detail");
    for (const message of reportOf(rejected).messages) expect(message.text).not.toContain("boom-detail");

    for (const [name, options] of [
      ["no OIDC env", { oidc: false }],
      ["getIDToken rejects", { oidc: true, idToken: new Error("boom-detail") }],
    ] as const) {
      const required = await tokenRun({ policy: "required", ...options });
      expect(required.calls, name).toEqual([]);
      const report = reportOf(required);
      const messages = withCode(report, "POLICY_UNAVAILABLE");
      expect(messages, name).toHaveLength(1);
      expect(messages[0]?.level, name).toBe("error");
      expect(messages[0]?.text, name).toContain("no-oidc-token");
      expect(messages[0]?.text, name).not.toContain("boom-detail");
      expect(report.verdict, name).toBe("fail");
    }

    const neverWithEnv = await tokenRun({ policy: "never", oidc: true });
    expect(neverWithEnv.tokenCalls).toEqual([]);
    expect(neverWithEnv.calls).toEqual([]);
  });

  it("AC-9: an absent or malformed repository name requests no token and no policy: no-repository, warn under auto and error under required", async () => {
    const cases: Array<[string, unknown]> = [
      ["absent", ABSENT],
      ["no slash", "acme"],
      ["two slashes", "acme/widgets/extra"],
      ["a space", "ac me/widgets"],
      ["a 40-character owner", `${"o".repeat(40)}/widgets`],
      ["a 101-character name", `acme/${"n".repeat(101)}`],
    ];
    for (const [name, repository] of cases) {
      for (const [policy, level] of [
        ["auto", "warn"],
        ["required", "error"],
      ] as const) {
        const label = `${name} under ${policy}`;
        const r = await tokenRun({ policy, oidc: true, repository });
        expect(r.tokenCalls, label).toEqual([]);
        expect(r.calls, label).toEqual([]);
        const report = reportOf(r);
        const messages = withCode(report, "POLICY_UNAVAILABLE");
        expect(messages, label).toHaveLength(1);
        expect(messages[0]?.level, label).toBe(level);
        expect(messages[0]?.text, label).toContain("no-repository");
        if (policy === "required") expect(report.verdict, label).toBe("fail");
        if (typeof repository === "string") {
          for (const line of logLines(r)) expect(line, label).not.toContain(repository);
          for (const message of report.messages) expect(message.text, label).not.toContain(repository);
        }
      }
    }
  });
});
