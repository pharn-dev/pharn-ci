import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { coverage, fakeDeps } from "../../cli/test/fake-deps.js";
import { VERSION } from "../../core/src/version.js";
import { runGitBatch } from "../../node-io/src/io.js";
import { harness } from "./harness.js";

// main() and run() are loaded inside the test body: the test is written before the CLI and the Action gather agent
// config sources, so nothing that depends on that may run while the file loads. The default fakes
// (packages/cli/test/fake-deps.ts and packages/action/test/harness.ts) track fixtures/golden/files.txt, which lists
// .claude/settings.json and .mcp.json, and supply no batch git runner. They are used as they are, and once with a
// gitBatch added that reads a real temporary repository whose HEAD commits .mcp.json with a secret (D5).
//
// No complete secret is written in this file (gitleaks, GitHub push protection, and AC-22 runs findSecretSpans over
// this file as committed): the secret is assembled at test time from a prefix and a run cut from ALPHABET.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** `n` distinct characters of ALPHABET, stepping 7 places from `seed` (7 is coprime with 62). */
function cut(n: number, seed: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[(seed + i * 7) % ALPHABET.length];
  return s;
}

const ROOT = new URL("../../../", import.meta.url);
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[] } & Record<string, unknown>;

/** fixtures/golden/report.json as the CLI and the Action report it (they report the package VERSION). */
function goldenReport(): Report {
  const golden = JSON.parse(readFileSync(new URL("fixtures/golden/report.json", ROOT), "utf8"));
  return { ...golden, tool: { ...golden.tool, version: VERSION } };
}

const SECRET = "ghp" + "_" + cut(36, 23);
let dir: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-secrets-fakes-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  writeFileSync(
    join(dir, ".mcp.json"),
    `{\n  "mcpServers": {\n    "github": { "env": { "GITHUB_TOKEN": "${SECRET}" } }\n  }\n}\n`,
  );
  sh("add", "-A");
  sh("commit", "-q", "-m", "agent config");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const servingMcpJson = (args: string[], input: string) => runGitBatch(dir, args, input);
const a7 = (report: Report) => report.messages.filter((m) => m.code.startsWith("AGENT_CONFIG_SECRET_"));
const catFile = (calls: string[][]) => calls.filter((args) => args[0] === "cat-file");

async function cliRun(withBatch: boolean) {
  const { main } = await import("../../cli/src/main.js");
  const fake = fakeDeps(coverage);
  if (withBatch) (fake as unknown as Record<string, unknown>).gitBatch = servingMcpJson;
  const code = await main(["check", "--coverage", "lcov.info", "--threshold", "80", "--format", "json"], fake);
  return { code, fake, report: JSON.parse(fake.out) as Report };
}

async function actionRun(withBatch: boolean) {
  const { run } = await import("../src/run.js");
  const h = harness({ inputs: { threshold: "80" } });
  if (withBatch) (h.deps as unknown as Record<string, unknown>).gitBatch = servingMcpJson;
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  expect(text, "report.json was written").toBeDefined();
  return { h, report: JSON.parse(text as string) as Report };
}

describe("D5: the default fakes gather nothing; a batch git runner fake is scanned", () => {
  it("AC-23: without a batch git runner no cat-file call, no A7 message and the golden verdict and report; with one, AGENT_CONFIG_SECRET_S01 at error", async () => {
    // The CLI golden run: the default fake as it is.
    const cliGolden = await cliRun(false);
    expect(catFile(cliGolden.fake.gitCalls), "CLI without gitBatch: no cat-file call").toEqual([]);
    expect(a7(cliGolden.report), "CLI without gitBatch: no A7 message").toEqual([]);
    expect(cliGolden.code, "CLI golden exit code (fails on its diff coverage)").toBe(1);
    expect(cliGolden.report.verdict, "CLI golden verdict").toBe(goldenReport().verdict);
    expect(cliGolden.report, "CLI without gitBatch: the golden report").toEqual(goldenReport());

    // The Action golden run: the default harness as it is, whose report is the golden report.
    const actionGolden = await actionRun(false);
    expect(catFile(actionGolden.h.gitCalls), "Action without gitBatch: no cat-file call").toEqual([]);
    expect(a7(actionGolden.report), "Action without gitBatch: no A7 message").toEqual([]);
    expect(actionGolden.report, "Action without gitBatch: the golden report").toEqual(goldenReport());

    // The same runs with a batch git runner fake serving .mcp.json with a secret.
    const cliBatch = await cliRun(true);
    expect(
      a7(cliBatch.report)
        .filter((m) => m.code === "AGENT_CONFIG_SECRET_S01")
        .map((m) => m.level),
      "CLI with gitBatch: S01",
    ).toEqual(["error"]);
    expect(cliBatch.fake.out.includes(SECRET), "CLI with gitBatch: no secret printed").toBe(false);

    const actionBatch = await actionRun(true);
    expect(
      a7(actionBatch.report)
        .filter((m) => m.code === "AGENT_CONFIG_SECRET_S01")
        .map((m) => m.level),
      "Action with gitBatch: S01",
    ).toEqual(["error"]);
    expect(JSON.stringify(actionBatch.report).includes(SECRET), "Action with gitBatch: no secret in the report").toBe(
      false,
    );
  }, 60_000);
});
