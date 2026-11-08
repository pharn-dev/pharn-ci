import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type CheckInput, check } from "../src/check.js";
import type { Report } from "../src/report.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// A13 (dependency safety): the fixture cases under fixtures/dependencies/. Each is a diff (change.diff), the tracked
// files at HEAD (files.txt) and the touched manifests and lockfiles at the merge base and at HEAD (base/ and head/, each
// file stored as <path>.txt, or <path>.fixture for a requirements file, so this repository's own check never reads them
// as manifests).

export const REPO_ROOT = "/home/runner/work/demo/demo";

/** The files of one side of a case: `<path>.txt` or `<path>.fixture` read as `<path>`. */
export function sideFiles(dir: string): Array<{ path: string; text: string }> {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => (name.endsWith(".txt") || name.endsWith(".fixture")) && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.replace(/\.(?:txt|fixture)$/, ""), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The check input of a dependency case, with a coverage file that is not found. */
export function dependencyCase(name: string, extra: Partial<CheckInput> = {}): CheckInput {
  const root = `${FIXTURES}dependencies/${name}/`;
  return {
    version: "0.1.0",
    coverage: { missingFile: "coverage/lcov.info" },
    diff: { text: fixture(`dependencies/${name}/change.diff`) },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: fixture(`dependencies/${name}/files.txt`).trim().split("\n"),
    dependencySources: {
      base: { files: sideFiles(`${root}base`), dropped: [] },
      head: { files: sideFiles(`${root}head`), dropped: [] },
    },
    ...extra,
  };
}

/** check() on the input, with the report validated against the schema. */
export function run(input: CheckInput): Report {
  const report = check(input);
  expectValidReport(report);
  return report;
}
