import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { harness, PR_CONTEXT } from "../../action/test/harness.js";
import { expectValidReport } from "../../core/test/schema.js";

// run(), main(), readPolicyFile() and the fixtures under fixtures/policy-api/ and fixtures/policy-precedence/ are
// loaded inside each test body: the AC tests are written before the file: policy mode exists, so nothing the build
// adds may run while the file loads. Each test builds a real temporary repository (the file: reader lstats every path
// segment, so symbolic links and directories must be real), and the Action and the CLI read it through real file
// reads; git and the GitHub API stay fakes that serve fixtures/golden. The Action's policy deps are injected: a fake
// fetch that records every call and a fake getIDToken that records its audience.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const TOKEN = "tok-SECRET-123"; // gitleaks:allow (a fake OIDC token the test proves is never printed)
const NOW = new Date("2026-10-26T12:00:00.000Z");
const GOLDEN_ROOT = "/home/runner/work/demo/demo";

type Message = { level: string; code: string; text: string };
type Report = {
  messages: Message[];
  diffCoverage: { threshold: number | null; excludedFiles?: string[] } | null;
  testIntegrity: { mode: string; source: string };
};

async function realReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

/** A temporary repository holding the golden coverage file (its paths moved under the new root). */
function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-policy3-")));
  mkdirSync(join(dir, "coverage"), { recursive: true });
  writeFileSync(join(dir, "coverage/lcov.info"), read("fixtures/golden/coverage.info").replaceAll(GOLDEN_ROOT, dir));
  return dir;
}

function put(dir: string, path: string, text: string) {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
}

async function actionRun(dir: string, policy: string, envelope?: string) {
  const { run } = await import("../../action/src/run.js");
  const context = { ...PR_CONTEXT, payload: { ...PR_CONTEXT.payload, repository: { full_name: "acme/widgets" } } };
  const h = harness({ inputs: { policy }, context: context as never });
  const calls: string[] = [];
  const tokenCalls: unknown[] = [];
  Object.assign(h.deps, {
    workspace: dir,
    readFile: realReadFile,
    fetch: async (input: unknown) => {
      calls.push(String(input instanceof Request ? input.url : input));
      if (envelope === undefined) throw new Error("no fetch was expected");
      return new Response(envelope, { status: 200, headers: { "content-type": "application/json" } });
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
  return { h, report: text === undefined ? undefined : (JSON.parse(text) as Report), calls, tokenCalls };
}

async function cliRun(dir: string, extra: string[]) {
  const { main } = await import("../src/main.js");
  const out: string[] = [];
  const err: string[] = [];
  const tracked = read("fixtures/golden/files.txt").trim().split("\n");
  const deps = {
    cwd: dir,
    git: async (args: string[]) => {
      if (args.includes("ls-files")) return args.includes("-z") ? `${tracked.join("\0")}\0` : `${tracked.join("\n")}\n`;
      if (args.includes("--show-toplevel")) return `${dir}\n`;
      if (args[0] === "ls-tree") return "";
      if (args.includes("diff")) return read("fixtures/golden/pr.diff");
      return "1111111111111111111111111111111111111111\n";
    },
    readFile: realReadFile,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  const code = await main(["check", "--coverage", "coverage/lcov.info", "--format", "json", ...extra], deps as never);
  const stdout = out.join("");
  return { code, stdout, stderr: err.join(""), report: stdout === "" ? undefined : (JSON.parse(stdout) as Report) };
}

function reportOf<T extends { report: Report | undefined }>(r: T, label: string): Report {
  if (r.report === undefined) throw new Error(`${label}: no report was written`);
  expectValidReport(r.report);
  return r.report;
}

const policyMessages = (report: Report) => report.messages.filter((m) => m.code.startsWith("POLICY_"));

describe("the file: policy mode", () => {
  it("AC-14: one tightening document as file:, as a served envelope and as --policy-file gives the same effective settings; file mode never fetches", async () => {
    const dir = makeRepo();
    try {
      const document = read("fixtures/policy-precedence/tighten.json");
      put(dir, "policy/org.json", document);
      const envelope = read("fixtures/policy-api/envelope-tighten.json");
      expect(JSON.parse(envelope).policy).toEqual(JSON.parse(document));

      const file = await actionRun(dir, "file:policy/org.json");
      const app = await actionRun(dir, "auto", envelope);
      const fileReport = reportOf(file, "file");
      const appReport = reportOf(app, "app");
      // E3 item 22 (policy rules): the reports now carry a `policy` object whose source differs ("input" for a file,
      // "app" for a served policy); the violations and everything else are still equal.
      const { policy: filePolicy, ...fileRest } = fileReport;
      const { policy: appPolicy, ...appRest } = appReport;
      expect(filePolicy?.source).toBe("input");
      expect(appPolicy?.source).toBe("app");
      expect(filePolicy?.violations).toEqual(appPolicy?.violations);
      expect(fileRest).toEqual(appRest);
      expect(file.calls).toEqual([]);
      expect(file.tokenCalls).toEqual([]);
      expect(app.calls).toHaveLength(1);

      const tightened = JSON.parse(document) as {
        coverage?: { threshold?: number };
        test_integrity?: { mode?: string };
      };
      expect(fileReport.diffCoverage?.threshold).toBe(tightened.coverage?.threshold);
      expect(fileReport.testIntegrity.mode).toBe(tightened.test_integrity?.mode);
      expect(fileReport.testIntegrity.source).toBe("policy");

      const cli = await cliRun(dir, ["--policy-file", "policy/org.json"]);
      expect(cli.code, cli.stderr).not.toBe(2);
      const cliReport = reportOf(cli, "cli");
      expect(cliReport.diffCoverage?.threshold).toBe(fileReport.diffCoverage?.threshold);
      expect(cliReport.diffCoverage?.excludedFiles).toEqual(fileReport.diffCoverage?.excludedFiles);
      expect(cliReport.testIntegrity.mode).toBe(fileReport.testIntegrity.mode);
      expect(cliReport.testIntegrity.source).toBe("policy");
      expect(policyMessages(cliReport)).toEqual(policyMessages(fileReport));

      const nodeIo = (await import("../../node-io/src/index.js")) as unknown as {
        readPolicyFile: (deps: unknown, options: { root: string; path: string; label: string }) => Promise<unknown>;
        lstatPath: unknown;
      };
      const resolved = (await nodeIo.readPolicyFile(
        { readFile: realReadFile, resolvePath: resolve, lstat: nodeIo.lstatPath },
        { root: dir, path: "policy/org.json", label: "the policy input" },
      )) as Record<string, unknown>;
      expect(resolved.source).toBe("file");
      expect(resolved.version).toBeNull();
      expect(resolved.path).toBe("policy/org.json");
      expect("fetchedAt" in resolved).toBe(false);
      expect(resolved.document).toEqual(JSON.parse(document));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AC-15: each bad file: path or document fails the Action step and exits the CLI with 2, with a fixed message that never names the path", async () => {
    const { parsePolicyJson } = await import("@pharn-ci/core");
    const dir = makeRepo();
    try {
      const valid = '{"version":1,"coverage":{"threshold":90}}';
      put(dir, "realdir/p.json", valid);
      symlinkSync(join(dir, "realdir"), join(dir, "linkdir"));
      symlinkSync(join(dir, "realdir/p.json"), join(dir, "link-x.json"));
      mkdirSync(join(dir, "adir"));
      const big = `${valid}${" ".repeat(1_048_577 - valid.length)}`;
      expect(Buffer.byteLength(big)).toBe(1_048_577);
      put(dir, "big-x.json", big);
      put(dir, "bad-x.json", "{bad json");
      const unknown: Record<string, unknown> = { version: 1 };
      for (let i = 0; i < 100; i++) unknown[`k${String(i).padStart(2, "0")}`] = `SECRET-VAL-${i}`;
      put(dir, "invalid-x.json", JSON.stringify(unknown));
      const long = JSON.stringify({ version: 1, coverage: { threshold: 90 }, pad: "z".repeat(300_000) });
      expect(Buffer.byteLength(long)).toBeLessThanOrEqual(1_048_576);
      expect(long.length).toBeGreaterThan(262_144);
      put(dir, "long-x.json", long);
      const lengthError = parsePolicyJson(long);
      expect(lengthError.ok).toBe(false);
      const lengthMessage = lengthError.ok ? "" : (lengthError.errors[0]?.message ?? "");

      const cases: Array<[string, string]> = [
        ["empty", ""],
        ["absolute", "/etc/x.json"],
        ["escaping", "../x.json"],
        ["escaping after a segment", "a/../../x.json"],
        ["through a symbolic-link directory", "linkdir/p.json"],
        ["a symbolic-link file", "link-x.json"],
        ["a directory", "adir"],
        ["missing", "missing-x.json"],
        ["too large", "big-x.json"],
        ["not JSON", "bad-x.json"],
        ["more than 50 errors", "invalid-x.json"],
        ["over 262,144 characters", "long-x.json"],
      ];
      for (const [name, path] of cases) {
        const action = await actionRun(dir, `file:${path}`);
        expect(action.h.failed.length, name).toBeGreaterThan(0);
        const failure = action.h.failed.join("\n");
        expect(failure, name).toMatch(/policy/);
        expect(action.calls, name).toEqual([]);
        expect(action.tokenCalls, name).toEqual([]);

        const cli = await cliRun(dir, ["--policy-file", path]);
        expect(cli.code, name).toBe(2);
        expect(cli.stderr, name).toContain("--policy-file");
        expect(cli.stdout, name).toBe("");

        for (const text of [failure, cli.stderr]) {
          if (path !== "") expect(text, name).not.toContain(path);
          expect(text, name).not.toContain(dir);
          if (name === "too large") expect(text, name).toMatch(/too large/i);
          if (name === "over 262,144 characters") expect(text, name).toContain(lengthMessage);
          if (name === "more than 50 errors") {
            const lines = text.split("\n").filter((line) => line.includes("is not a known key"));
            expect(lines.length, name).toBeGreaterThan(0);
            expect(lines.length, name).toBeLessThanOrEqual(50);
            expect(text, name).not.toContain("SECRET-VAL");
          }
        }
      }

      // A valid document of just under 262,144 characters is accepted by both.
      const under = `${valid}${" ".repeat(262_143 - valid.length)}`;
      expect(under.length).toBe(262_143);
      put(dir, "under-x.json", under);
      const action = await actionRun(dir, "file:under-x.json");
      expect(action.h.failed.filter((m) => !m.includes("below the threshold"))).toEqual([]);
      expect(reportOf(action, "under").diffCoverage?.threshold).toBe(90);
      expect(action.calls).toEqual([]);
      const cli = await cliRun(dir, ["--policy-file", "under-x.json"]);
      expect(cli.code, cli.stderr).not.toBe(2);
      expect(reportOf(cli, "under cli").diffCoverage?.threshold).toBe(90);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
