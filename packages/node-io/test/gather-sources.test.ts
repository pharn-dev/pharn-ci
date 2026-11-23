import { describe, expect, it } from "vitest";
import type { ResolvedPolicy } from "../../core/src/index.js";
import {
  type GatherSourcesOptions,
  gatherSources,
  headIsInBase,
  loadConfig,
  loadConfigInUse,
  OBJECT_ID,
  readCapped,
} from "../src/index.js";

// CORE-136: the helpers the CLI and the Action share. The git runners here are fakes: a batch call fails the test, so a
// guard that should read nothing is seen to read nothing. ac-gather-sources-parity.test.ts runs both entry points.

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const AGENT_FILES = [".mcp.json", "AGENTS.md", "CLAUDE.md", ".claude/settings.json", "src/a.ts"];
const FILE_POLICY = {
  source: "file",
  path: "policy/org.json",
  document: { version: 1, setup: { forbidden_permissions: ["Bash(curl:*)"] } },
} as unknown as ResolvedPolicy;

function options(over: Partial<GatherSourcesOptions> = {}): GatherSourcesOptions & { lines: string[] } {
  const lines: string[] = [];
  return {
    diff: { parsed: [] },
    base: SHA_A,
    checkout: "head",
    repoFiles: AGENT_FILES,
    testIntegrityMode: undefined,
    dependencySettings: undefined,
    policy: FILE_POLICY,
    log: (line) => lines.push(line),
    warn: (line) => lines.push(`warn ${line}`),
    lines,
    ...over,
  };
}

/** No git call at all: a batch call or a git call other than ls-tree fails. */
const refusingDeps = {
  git: async (args: string[]) => {
    if (args[0] === "ls-tree") return "";
    throw new Error(`unexpected git ${args.join(" ")}`);
  },
  gitBatch: async () => {
    throw new Error("unexpected batch read");
  },
};

describe("gatherSources: when the files at HEAD are read", () => {
  const notHead: { name: string; over: Partial<GatherSourcesOptions>; reason: string }[] = [
    {
      name: "PR-number mode",
      over: { checkout: "pr-number", diff: { text: "" }, base: undefined },
      reason:
        "pr-number mode: the checkout is not the pull request head, so its committed agent config files were not read",
    },
    {
      name: "a compare-API diff",
      over: { checkout: "unknown", diff: { text: "" }, base: undefined },
      reason: "the diff came from the GitHub compare API, so the checkout may not be the pull request head",
    },
    {
      name: "an unavailable diff on a checkout that may not be the head",
      over: { checkout: "unknown", diff: { unavailable: "x" }, base: undefined },
      reason: "the diff is unavailable, so the checkout may not be the pull request head",
    },
  ];
  for (const row of notHead) {
    it(`${row.name}: the head files are unavailable and nothing is read`, async () => {
      const out = await gatherSources(refusingDeps, options(row.over));
      expect(out.agentConfigSources).toEqual({ unavailable: row.reason });
      expect(out.agentInstructionSources).toHaveProperty("unavailable");
      expect(out.policySettingsSources).toHaveProperty("unavailable");
      expect(out.staleInstructionSources).toBeUndefined();
      expect(out.selfModificationSources).toHaveProperty("base.unavailable");
      expect(out.dependencySources).toHaveProperty("base.unavailable");
    });
  }

  it("PR-number mode reads no git ls-tree of the checkout", async () => {
    const calls: string[][] = [];
    const out = await gatherSources(
      {
        ...refusingDeps,
        git: async (args) => {
          calls.push(args);
          return "";
        },
      },
      options({ checkout: "pr-number", diff: { text: "" }, base: undefined }),
    );
    expect(calls).toEqual([]);
    expect(out.repoFileBytes).toBeUndefined();
  });

  it("an unavailable diff on a checkout that is the head reads the head files (drift a)", async () => {
    const inputs: string[] = [];
    const deps = {
      git: async () => "",
      gitBatch: async (_args: string[], input: string) => {
        inputs.push(input);
        throw new Error("fatal: simulated");
      },
    };
    const o = options({ diff: { unavailable: "the base is HEAD" }, base: undefined });
    const out = await gatherSources(deps, o);
    expect(inputs.some((input) => input.includes(".mcp.json"))).toBe(true);
    // The read failed, so the reason is git's, said once in the log channel; never "may not be the head".
    expect(out.agentConfigSources).toHaveProperty("unavailable");
    expect(JSON.stringify(out.agentConfigSources)).not.toContain("may not be the pull request head");
    expect(o.lines.some((line) => line.startsWith("pharn-ci: could not read the agent config files from git"))).toBe(
      true,
    );
    expect(out.testSources).toEqual({
      base: { unavailable: "the diff is unavailable" },
      head: { unavailable: "the diff is unavailable" },
    });
  });

  it("without a batch git runner only an unavailable test source marker and the file sizes are gathered", async () => {
    const out = await gatherSources(
      { git: async () => "" },
      options({ diff: { parsed: [] }, testIntegrityMode: undefined }),
    );
    expect(Object.keys(out).sort()).toEqual(["repoFileBytes", "testSources"]);
    expect(out.testSources).toHaveProperty("base.unavailable", "reading git objects is not available");
  });

  it("a failed git ls-tree is one warning with git's first line", async () => {
    const o = options();
    const out = await gatherSources(
      {
        git: async () => {
          throw new Error("fatal: not a tree\nmore");
        },
      },
      o,
    );
    expect(out.repoFileBytes).toBeUndefined();
    expect(o.lines).toContain(
      "warn pharn-ci: git ls-tree failed, so empty agent setup files are not reported: fatal: not a tree",
    );
  });
});

describe("headIsInBase", () => {
  it("is true only for two equal full commit ids", async () => {
    const answer = (mergeBase: string, head: string) => ({
      git: async (args: string[]) => (args[0] === "merge-base" ? `${mergeBase}\n` : `${head}\n`),
    });
    expect(await headIsInBase(answer(SHA_A, SHA_A), "main")).toBe(true);
    expect(await headIsInBase(answer(SHA_A, SHA_B), "main")).toBe(false);
    expect(await headIsInBase(answer("ok", "ok"), "main")).toBe(false);
    expect(
      await headIsInBase(
        {
          git: async () => {
            throw new Error("fatal");
          },
        },
        "main",
      ),
    ).toBe(false);
    expect(OBJECT_ID.test("c".repeat(64))).toBe(true);
  });
});

describe("loadConfig and loadConfigInUse", () => {
  const files: Record<string, string> = {
    "/repo/.pharn/ci.yml": "coverage:\n  threshold: 80\n",
    "/repo/bad.yml": "x: [\n",
  };
  const readFile = async (path: string) => files[path] ?? null;
  const at = (path: string, name: string, explicit: boolean) => ({ path, name, explicit });

  it("a missing default file is no config; a missing named file, or one that does not parse, is an error naming it", async () => {
    expect(await loadConfig({ readFile }, at("/repo/none.yml", ".pharn/ci.yml", false))).toEqual({});
    await expect(loadConfig({ readFile }, at("/repo/none.yml", "none.yml", true))).rejects.toThrow(
      "config file not found: none.yml",
    );
    await expect(loadConfig({ readFile }, at("/repo/bad.yml", "bad.yml", true))).rejects.toThrow(/^bad\.yml: /);
    expect(await loadConfig({ readFile }, at("/repo/.pharn/ci.yml", ".pharn/ci.yml", false))).toEqual({
      coverage: { threshold: 80 },
    });
  });

  it("with no diff the working tree's copy is used, with no source", async () => {
    const inUse = await loadConfigInUse(
      { git: refusingDeps.git, readFile },
      {
        ...at("/repo/.pharn/ci.yml", ".pharn/ci.yml", false),
        configPath: undefined,
        repoRoot: "/repo",
        diff: null,
        base: SHA_A,
      },
    );
    expect(inUse).toEqual({ config: { coverage: { threshold: 80 } } });
  });
});

describe("readCapped", () => {
  const body = (text: string) => new Response(text);
  it("reads a body up to the cap and refuses one over it", async () => {
    expect(await readCapped(body("hello"), 5)).toBe("hello");
    expect(await readCapped(body("hello!"), 5)).toBeNull();
    expect(await readCapped(new Response(null), 5)).toBe("");
  });
});
