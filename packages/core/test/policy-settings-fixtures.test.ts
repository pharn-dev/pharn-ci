import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { check, type PolicyDocument } from "../src/index.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings): every case directory under fixtures/policy-settings/p0*/ runs through check() with the
// golden coverage and diff. A `violates-*` case gives at least one violation of its rule id, a `complies-*` case none.

const ROOT = fileURLToPath(new URL("../../../fixtures/policy-settings/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";

const directories = (dir: string) => readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());

const cases = directories(ROOT)
  .filter((rule) => /^p0[2-6]$/.test(rule))
  .flatMap((rule) => directories(join(ROOT, rule)).map((name) => ({ rule, name, dir: join(ROOT, rule, name) })));

describe("fixtures/policy-settings cases", () => {
  it("has a case for each of P02 to P06", () => {
    expect(new Set(cases.map((c) => c.rule))).toEqual(new Set(["p02", "p03", "p04", "p05", "p06"]));
  });

  for (const { rule, name, dir } of cases) {
    it(`${rule}/${name}`, () => {
      const read = (file: string) => readFileSync(join(dir, file), "utf8");
      const map = JSON.parse(read("files.json")) as Record<string, string>;
      const document = JSON.parse(read("policy.json")) as PolicyDocument;
      const files = Object.entries(map).map(([path, from]) => ({ path, text: read(from) }));
      const report = check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden/pr.diff") },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: [...fixture("golden/files.txt").trim().split("\n"), ...Object.keys(map)],
        policy: { source: "file", version: null, path: "policy/org.json", document },
        policySettingsSources: { files, dropped: [] },
      });
      expectValidReport(report);
      const id = rule.toUpperCase();
      const found = (report.policy?.violations ?? []).filter((violation) => violation.id === id);
      if (name.startsWith("violates-")) expect(found.length).toBeGreaterThan(0);
      else expect(found).toEqual([]);
    });
  }
});
