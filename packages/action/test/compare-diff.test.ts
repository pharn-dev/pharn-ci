import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getOctokit } from "@actions/github";
import { describe, expect, it, vi } from "vitest";
import { createGitHubApi, diffText } from "../src/api.js";
import { type ActionDeps, run } from "../src/run.js";

// F-14: the compare API's diff body reaches compareDiff through the real Octokit, with only fetch mocked.
// Octokit decodes a body as text only for `text/*` or `charset=utf-8`; anything else arrives as an
// ArrayBuffer, and a JSON body as an object.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (p: string) => readFileSync(new URL(p, FIXTURES), "utf8");
const DIFF = fixture("golden/pr.diff");

/** The GitHub API over a real Octokit whose fetch answers every request with this body and content type. */
function apiAnswering(body: string, contentType: string | null) {
  const fetch = vi.fn(async (_url: string) => {
    const headers = new Headers();
    if (contentType !== null) headers.set("content-type", contentType);
    return new Response(new TextEncoder().encode(body), { status: 200, headers });
  });
  const api = createGitHubApi({
    token: "t0ken",
    repo: () => ({ owner: "acme", repo: "demo" }),
    getOctokit: (token) => getOctokit(token, { request: { fetch } }),
  });
  return { api, fetch };
}

describe("compareDiff through the real Octokit (F-14)", () => {
  it("returns the diff text of a response with charset=utf-8", async () => {
    const { api, fetch } = apiAnswering(DIFF, "application/vnd.github.diff; charset=utf-8");
    expect(await api.compareDiff("a...b")).toBe(DIFF);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.github.com/repos/acme/demo/compare/a...b");
  });

  it("decodes a response without a charset, which Octokit hands over as an ArrayBuffer, as UTF-8", async () => {
    const body = `${DIFF}+// café ✓\n`;
    const { api } = apiAnswering(body, "application/vnd.github.diff");
    expect(await api.compareDiff("a...b")).toBe(body);
  });

  it("rejects a JSON body instead of returning a non-string", async () => {
    const { api } = apiAnswering('{"message":"not a diff"}', "application/json; charset=utf-8");
    await expect(api.compareDiff("a...b")).rejects.toThrow("the compare API returned an object instead of diff text");
  });
});

describe("diffText", () => {
  it("passes text through, decodes binary views, and names what it got otherwise", () => {
    expect(diffText("diff")).toBe("diff");
    expect(diffText(new TextEncoder().encode("é"))).toBe("é");
    expect(diffText(new TextEncoder().encode("é").buffer)).toBe("é");
    expect(() => diffText(null)).toThrow("returned null instead of diff text");
    expect(() => diffText([])).toThrow("returned an array instead of diff text");
    expect(() => diffText(undefined)).toThrow("returned no body instead of diff text");
    expect(() => diffText(42)).toThrow("returned a number instead of diff text");
  });
});

describe("run() with a compare API that answers JSON (F-14)", () => {
  it("degrades to DIFF_UNAVAILABLE with outputs and a summary instead of failing the step", async () => {
    const workspace = "/home/runner/work/demo/demo";
    const { api } = apiAnswering('{"message":"not a diff"}', "application/json");
    const outputs: Record<string, string> = {};
    const failed: string[] = [];
    const warnings: string[] = [];
    const summary: string[] = [];
    const deps: ActionDeps = {
      getInput: (name) => ({ "coverage-file": "coverage/lcov.info", comment: "false" })[name] ?? "",
      context: {
        eventName: "pull_request",
        sha: "merge000",
        payload: { pull_request: { number: 7, base: { sha: "a".repeat(40) }, head: { sha: "b".repeat(40) } } },
      },
      workspace,
      tempDir: "/tmp/runner",
      api,
      // No local history: every git call but ls-files fails, so the diff comes from the compare API.
      git: async (args) => {
        if (args[0] === "ls-files") return `${fixture("golden/files.txt").trim().split("\n").join("\0")}\0`;
        throw new Error("fatal: bad object");
      },
      readFile: async (path) =>
        path === resolve(workspace, "coverage/lcov.info") ? fixture("golden/coverage.info") : null,
      writeFile: async () => {},
      resolvePath: (...segments) => resolve(...segments),
      info: () => {},
      warning: (m) => warnings.push(m),
      setOutput: (name, value) => {
        outputs[name] = value;
      },
      setFailed: (m) => failed.push(m),
      writeSummary: async (m) => {
        summary.push(m);
      },
    };
    const report = await run(deps);
    expect(failed).toEqual([]);
    expect(report?.messages.map((m) => m.code)).toContain("DIFF_UNAVAILABLE");
    expect(outputs.verdict).toBe("warn");
    expect(summary).toHaveLength(1);
    expect(warnings.join("\n")).toContain("the compare API returned an object instead of diff text");
  });
});
