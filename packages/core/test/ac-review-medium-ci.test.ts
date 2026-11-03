// Review findings 12 and 16. 12: the `Action pins` script (scripts/check-action-pins.mjs) must see every `uses` key,
// also one written as a YAML flow mapping or with a quoted key, and must not read one out of a comment. 16: the dogfood
// steps in .github/workflows/ci.yml run a tighten-only `file:` policy, so the policy rules run end to end.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { parsePolicyJson } from "../src/policy/parse.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(REPO, "scripts", "check-action-pins.mjs");
const SHA_A = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const SHA_B = "949feb2413d6458794dcd2491c4babbbce0c15c1";
const SHA_C = "0123456789abcdef0123456789abcdef01234567";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs the pins script in a temp dir that holds `.github/workflows/x.yml` with `workflow` as its text. */
function runPins(workflow: string): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "pharn-pins-"));
  temps.push(dir);
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "x.yml"), workflow);
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const steps = (...lines: string[]) => `jobs:\n  a:\n    steps:\n${lines.map((line) => `      ${line}\n`).join("")}`;
const X = join(".github", "workflows", "x.yml");

describe("finding 12: Action pins reads every uses key", () => {
  it("names a flow-mapping uses, a quoted uses key and a plain uses, each on its own 1-based line", () => {
    const run = runPins(
      steps("- { uses: actions/checkout@v4 }", '- "uses": actions/setup-node@v4', "- uses: actions/cache@v4"),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${X}:4  actions/checkout@v4`);
    expect(run.stderr).toContain(`${X}:5  actions/setup-node@v4`);
    expect(run.stderr).toContain(`${X}:6  actions/cache@v4`);
  });

  it("passes the same three when each is pinned to a 40-hex SHA", () => {
    const run = runPins(
      steps(
        `- { uses: actions/checkout@${SHA_A} }`,
        `- "uses": actions/setup-node@${SHA_B}`,
        `- uses: actions/cache@${SHA_C} # v4`,
      ),
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("ok");
  });

  it("ignores a uses in a YAML comment", () => {
    const run = runPins(steps("# uses: actions/checkout@v4", `- uses: actions/cache@${SHA_C} # uses: actions/x@v1`));
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it("passes a local ./ action", () => {
    const run = runPins(steps("- uses: ./local"));
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it("ignores shell text in a run block scalar but still checks the step after it", () => {
    const ok = runPins(steps("- run: |", '    echo "uses: actions/checkout@v4"', "    uses: foo@v1"));
    expect(ok.stderr).toBe("");
    expect(ok.status).toBe(0);
    const bad = runPins(steps("- run: |", "    echo uses: foo@v1", "- uses: actions/cache@v4"));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain(`${X}:6  actions/cache@v4`);
    expect(bad.stderr).not.toContain("foo@v1");
  });

  it("still flags a docker:// ref, as before", () => {
    const run = runPins(steps("- uses: docker://alpine:3.20"));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${X}:4  docker://alpine:3.20`);
  });
});

describe("finding 16: the dogfood steps run a tighten-only file policy", () => {
  const ci = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");

  it("the uses: ./ step sets threshold 80, test-integrity block and the file policy, and no fail-on-threshold", () => {
    const start = ci.indexOf("- name: Dogfood pharn-ci\n");
    expect(start).toBeGreaterThan(-1);
    const end = ci.indexOf("\n      - name:", start + 1);
    const step = ci.slice(start, end === -1 ? undefined : end);
    expect(step).toMatch(/^\s+uses: \.\/$/m);
    expect(step).toMatch(/^\s+threshold: 80$/m);
    expect(step).toMatch(/^\s+test-integrity: block$/m);
    expect(step).toMatch(/^\s+policy: file:\.github\/pharn-policy\.json$/m);
    expect(step).not.toContain("fail-on-threshold");
  });

  it("the second run's env line passes the same threshold, mode and policy", () => {
    const line = ci.split("\n").find((text) => text.includes("INPUT_COVERAGE-FILE="));
    expect(line).toBeDefined();
    expect(line).toContain('"INPUT_THRESHOLD=80"');
    expect(line).toContain('"INPUT_TEST-INTEGRITY=block"');
    expect(line).toContain('"INPUT_POLICY=file:.github/pharn-policy.json"');
  });

  it(".github/pharn-policy.json parses, validates against schema/policy.v1.json and has no agents key", () => {
    const text = readFileSync(join(REPO, ".github", "pharn-policy.json"), "utf8");
    const parsed = parsePolicyJson(text);
    expect(parsed.ok).toBe(true);
    const json = JSON.parse(text) as Record<string, unknown>;
    const schema = JSON.parse(readFileSync(join(REPO, "schema", "policy.v1.json"), "utf8")) as object;
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
    expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
    expect(json).not.toHaveProperty("agents");
    expect(json).toEqual({ version: 1, coverage: { threshold: 80 }, test_integrity: { mode: "block" } });
  });
});
