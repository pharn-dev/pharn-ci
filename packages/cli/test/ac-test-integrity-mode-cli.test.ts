import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

// main() is loaded inside each test body: these tests are written before the `--test-integrity` flag exists, so
// nothing that depends on it may run while the file loads.

const ROOT = new URL("../../../", import.meta.url);
const readRoot = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const fixture = (path: string) => readRoot(`fixtures/${path}`);

const REPO_ROOT = "/home/runner/work/demo/demo";
const SHA = "1111111111111111111111111111111111111111";

function fakeRepo(files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const contents = new Map(Object.entries(files).map(([path, text]) => [resolve(REPO_ROOT, path), text]));
  const deps = {
    cwd: REPO_ROOT,
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        const paths = fixture("golden/files.txt").trim().split("\n");
        return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
      }
      if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
      if (args.includes("diff")) return fixture("golden/pr.diff");
      return `${SHA}\n`;
    },
    readFile: async (path: string) => contents.get(path) ?? null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  return { deps, stdout: () => out.join(""), stderr: () => err.join("") };
}

function v2Validator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  ajv.addSchema(JSON.parse(readRoot("schema/report.v1.json")));
  return ajv.compile(JSON.parse(readRoot("schema/report.v2.json")));
}

const CHECK = ["check", "--coverage", "coverage/lcov.info", "--format", "json"];

describe("pharn-ci check --test-integrity", () => {
  it("AC-10: --test-integrity block gives mode block from the input, in a report that passes the v2 schema", async () => {
    const { main } = await import("../src/main.js");
    const repo = fakeRepo({ "coverage/lcov.info": fixture("golden/coverage.info") });
    const code = await main([...CHECK, "--test-integrity", "block"], repo.deps as never);

    expect(code).not.toBe(2);
    const report = JSON.parse(repo.stdout());
    expect(report.schemaVersion).toBe(2);
    expect(report.testIntegrity.mode).toBe("block");
    expect(report.testIntegrity.source).toBe("input");
    const validate = v2Validator();
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
  });

  it("AC-10: --test-integrity maybe exits 2 with nothing on stdout and the allowed values on stderr", async () => {
    const { main } = await import("../src/main.js");
    const repo = fakeRepo({ "coverage/lcov.info": fixture("golden/coverage.info") });
    const code = await main([...CHECK, "--test-integrity", "maybe"], repo.deps as never);

    expect(code).toBe(2);
    expect(repo.stdout()).toBe("");
    for (const allowed of ["block", "warn", "off"]) expect(repo.stderr()).toContain(allowed);
  });
});
