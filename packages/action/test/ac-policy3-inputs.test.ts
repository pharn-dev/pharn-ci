import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../../core/src/version.js";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// run(), parseAppUrl() and the fixtures under fixtures/policy-api/ are loaded inside each test body: the AC tests are
// written before the policy and app-url inputs exist, so nothing the build adds may run while the file loads. The
// Action runs against the in-memory harness plus injected policy deps; every file read is recorded.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const TOKEN = "tok-SECRET-123"; // gitleaks:allow (a fake OIDC token the test proves is never printed)
const NOW = new Date("2026-10-26T12:00:00.000Z");

type Message = { level: string; code: string; text: string };

/** fixtures/golden/report.json as the Action reports it (the package VERSION). */
function goldenReport() {
  const golden = JSON.parse(read("fixtures/golden/report.json"));
  return { ...golden, tool: { ...golden.tool, version: VERSION } };
}

async function inputRun(inputs: Record<string, string>) {
  const { run } = await import("../src/run.js");
  const context = { ...PR_CONTEXT, payload: { ...PR_CONTEXT.payload, repository: { full_name: "acme/widgets" } } };
  const h = harness({ inputs: { threshold: "80", ...inputs }, context: context as never });
  const calls: string[] = [];
  const tokenCalls: unknown[] = [];
  const reads: string[] = [];
  const readFile = h.deps.readFile;
  h.deps.readFile = async (path: string) => {
    reads.push(path);
    return readFile(path);
  };
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
      return TOKEN;
    },
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async () => {},
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  return { h, report: text === undefined ? undefined : JSON.parse(text), calls, tokenCalls, reads };
}

const REJECTED_URLS = [
  "http://example.com",
  "http://localhost:8080",
  "http://127.0.0.1:9",
  "https://user:pw@pharn.dev",
  "https://pharn.dev/x?y",
  "https://pharn.dev/#f",
  "https://pharn.dev/api",
  "not a url",
];
/** A distinctive part of each rejected value, which the message must not contain either. */
const URL_PARTS: Record<string, string> = {
  "http://example.com": "example.com",
  "http://localhost:8080": "localhost",
  "http://127.0.0.1:9": "127.0.0.1",
  "https://user:pw@pharn.dev": "user:pw",
  "https://pharn.dev/x?y": "x?y",
  "https://pharn.dev/#f": "#f",
  "https://pharn.dev/api": "pharn.dev/api",
  "not a url": "not a url",
};

describe("the policy and app-url inputs", () => {
  it("AC-11: a rejected app-url fails the step with one fixed message before any config read or fetch; an accepted origin is used with the fixed audience", async () => {
    const { parseAppUrl } = await import("../src/app-client.js");
    const messages = new Set<string>();
    for (const value of REJECTED_URLS) {
      for (const policy of ["never", "auto"]) {
        const label = `${value} with policy ${policy}`;
        const r = await inputRun({ "app-url": value, policy });
        expect(r.h.failed, label).toHaveLength(1);
        const failure = r.h.failed[0] as string;
        expect(failure, label).not.toContain(value);
        expect(failure, label).not.toContain(URL_PARTS[value]);
        expect(
          r.reads.filter((path) => path.endsWith(".pharn/ci.yml")),
          label,
        ).toEqual([]);
        expect(r.calls, label).toEqual([]);
        expect(r.tokenCalls, label).toEqual([]);
        messages.add(failure);

        let thrown: unknown;
        try {
          parseAppUrl(value);
        } catch (error) {
          thrown = error;
        }
        expect(thrown, label).toBeInstanceOf(Error);
        expect(failure, label).toContain((thrown as Error).message);
      }
    }
    expect([...messages]).toHaveLength(1);

    for (const value of ["https://staging.pharn.dev", "https://staging.pharn.dev/"]) {
      const r = await inputRun({ "app-url": value, policy: "auto" });
      expect(r.calls, value).toHaveLength(1);
      expect(new URL(r.calls[0] as string).origin, value).toBe("https://staging.pharn.dev");
      expect(r.tokenCalls, value).toEqual(["pharn.dev"]);
      expect(parseAppUrl(value)).toBeInstanceOf(URL);
      expect(parseAppUrl(value).origin).toBe("https://staging.pharn.dev");
    }

    const empty = await inputRun({ "app-url": "", policy: "auto" });
    expect(empty.calls).toHaveLength(1);
    expect(new URL(empty.calls[0] as string).origin).toBe("https://pharn.dev");
    expect(parseAppUrl("").origin).toBe("https://pharn.dev");
    expect(parseAppUrl("https://pharn.dev").origin).toBe("https://pharn.dev");
  });

  it("AC-12: a policy value outside auto, never, file:<path> and required fails with one fixed message; never with the OIDC env present gives the golden report", async () => {
    const messages = new Set<string>();
    for (const value of ["yes", "Auto", "FILE:x.json", "file", "requried", "off"]) {
      const r = await inputRun({ policy: value });
      expect(r.h.failed, value).toHaveLength(1);
      const failure = r.h.failed[0] as string;
      for (const form of ["auto", "never", "file:<path>", "required"]) expect(failure, value).toContain(form);
      expect(r.calls, value).toEqual([]);
      expect(r.tokenCalls, value).toEqual([]);
      messages.add(failure);
    }
    // One fixed message, whatever the value: it never echoes it.
    expect([...messages]).toHaveLength(1);
    const [fixed] = [...messages] as [string];
    for (const value of ["yes", "Auto", "FILE:x.json", "requried"]) expect(fixed).not.toContain(value);

    const never = await inputRun({ policy: "never" });
    expect(never.tokenCalls).toEqual([]);
    expect(never.calls).toEqual([]);
    expectValidReport(never.report);
    expect(never.report).toEqual(goldenReport());
    expect(never.h.failed.filter((m) => !m.includes("below the threshold"))).toEqual([]);
    expect((never.report.messages as Message[]).filter((m) => m.code.startsWith("POLICY_"))).toEqual([]);
  });
});
