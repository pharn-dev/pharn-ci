import { describe, expect, it } from "vitest";
import { agentPrSize, P14_GENERATED_FILES, parseUnifiedDiff } from "../src/index.js";
import { fixture } from "./helpers.js";
import { appPolicy, filePolicy, p14, policyFixture, runP14 } from "./p14-run.js";

// Policy rule P14 (agent PR size cap): what counts. Generated files (lockfiles, snapshots, *.generated.*) and paths the
// run's coverage.exclude matches are left out; a rename is one file; a binary file is a file with no lines; a deleted
// file's lines are removed lines. Every report is validated against schema/report.v2.json.

const policy = () => appPolicy(policyFixture("generated/policy.json"));
const sizeOf = (name: string, excluded: (path: string) => boolean = () => false) =>
  agentPrSize(parseUnifiedDiff(fixture(`policy-rules/p14/${name}`)), excluded);

describe("org policy rule P14: generated files do not count", () => {
  it("the list is one exported constant naming lockfiles, snapshots and *.generated.* files", () => {
    expect(P14_GENERATED_FILES).toEqual([
      "**/package-lock.json",
      "**/npm-shrinkwrap.json",
      "**/pnpm-lock.yaml",
      "**/yarn.lock",
      "**/bun.lock",
      "**/bun.lockb",
      "**/Cargo.lock",
      "**/poetry.lock",
      "**/uv.lock",
      "**/Pipfile.lock",
      "**/composer.lock",
      "**/Gemfile.lock",
      "**/go.sum",
      "**/__snapshots__/**",
      "**/*.snap",
      "**/*.generated.*",
    ]);
    expect(Object.isFrozen(P14_GENERATED_FILES)).toBe(true);
  });

  it("a PR over both caps only because of lockfiles, snapshots or a *.generated.* file passes", () => {
    for (const name of ["generated/lockfile.diff", "generated/snapshot.diff", "generated/generated-name.diff"]) {
      // Counted without the list, the PR would be over both caps (2 files, 10 lines).
      const whole = parseUnifiedDiff(fixture(`policy-rules/p14/${name}`));
      expect(whole.length, name).toBeGreaterThan(2);
      expect(sizeOf(name), name).toEqual({ files: 2, lines: 4, areas: ["src"] });
      expect(p14(runP14({ diff: name, policy: policy() })), name).toEqual([]);
    }
  });

  it("a path the run's coverage.exclude matches does not count; without the exclusion it does", () => {
    expect(p14(runP14({ diff: "generated/excluded.diff", policy: policy(), exclude: ["vendor/**"] }))).toEqual([]);
    expect(p14(runP14({ diff: "generated/excluded.diff", policy: policy() })).map((v) => v.detail)).toEqual([
      "agent PR changes 14 lines (cap 10); split it by area: src, vendor",
      "agent PR changes 3 files (cap 2); split it by area: src, vendor",
    ]);
  });

  it("a PR that edits the config in use or a workflow cannot exclude its own files, unless the exclusions are the app policy's", () => {
    // A file policy cannot set exclusions, so these come from the workflow inputs and the config the PR edits.
    const edited = runP14({
      diff: "generated/excluded-config-edited.diff",
      policy: filePolicy(policyFixture("generated/policy.json")),
      exclude: ["vendor/**"],
    });
    expect(p14(edited).map((v) => v.detail)).toEqual([
      "agent PR changes 14 lines (cap 10); split it by area: .pharn, src, vendor",
      "agent PR changes 3 files (cap 2); split it by area: .pharn, src, vendor",
    ]);
    // An app policy's coverage.exclude replaces every lower layer's, so the PR cannot change it: it applies.
    const app = runP14({
      diff: "generated/excluded-config-edited.diff",
      policy: appPolicy({ ...policyFixture("generated/policy.json"), coverage: { exclude: ["vendor/**"] } }),
      exclude: ["vendor/**"],
    });
    expect(p14(app)).toEqual([]);
    // An app policy without exclusions leaves them to the lower layers, which the PR edits: every file counts.
    const appWithout = runP14({
      diff: "generated/excluded-config-edited.diff",
      policy: policy(),
      exclude: ["vendor/**"],
    });
    expect(p14(appWithout)).toHaveLength(2);
  });

  it("renaming a file to a generated name does not hide it: an entry is left out only when both its paths are", () => {
    const diff = [
      "diff --git a/src/big.ts b/src/big.generated.ts",
      "similarity index 50%",
      "rename from src/big.ts",
      "rename to src/big.generated.ts",
      "--- a/src/big.ts",
      "+++ b/src/big.generated.ts",
      "@@ -1,2 +1,2 @@",
      "-a",
      "-b",
      "+c",
      "+d",
      "",
    ].join("\n");
    expect(agentPrSize(parseUnifiedDiff(diff), () => false)).toEqual({ files: 1, lines: 4, areas: ["src"] });
  });
});

describe("org policy rule P14: renames, binary and deleted files", () => {
  it("a rename counts once, by its added and removed lines, and names both its areas", () => {
    expect(sizeOf("kinds/rename.diff")).toEqual({ files: 2, lines: 4, areas: ["lib", "src"] });
    expect(p14(runP14({ diff: "kinds/rename.diff", policy: appPolicy(policyFixture("kinds/policy.json")) }))).toEqual(
      [],
    );
  });

  it("a binary file counts as a file with no lines", () => {
    expect(sizeOf("kinds/binary.diff")).toEqual({ files: 3, lines: 4, areas: ["assets", "src"] });
    const report = runP14({ diff: "kinds/binary.diff", policy: appPolicy(policyFixture("kinds/policy.json")) });
    expect(p14(report).map((v) => v.detail)).toEqual([
      "agent PR changes 3 files (cap 2); split it by area: assets, src",
    ]);
  });

  it("a deleted file counts its removed lines", () => {
    expect(sizeOf("kinds/delete.diff")).toEqual({ files: 1, lines: 5, areas: ["src"] });
    const report = runP14({ diff: "kinds/delete.diff", policy: appPolicy(policyFixture("kinds/policy.json")) });
    expect(p14(report).map((v) => v.detail)).toEqual(["agent PR changes 5 lines (cap 4); split it by area: src"]);
  });
});
