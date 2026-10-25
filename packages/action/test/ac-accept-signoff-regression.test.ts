import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// check() and renderMarkdown() are loaded inside the test body: the AC tests are written before the accept label
// exists, so nothing the build adds may run while the file loads. The committed dist must hold the accept label, so
// this test fails until the build rebuilds it.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const REPO_ROOT = "/home/runner/work/demo/demo";
const DEFAULT_FILES = read("fixtures/test-files-deleted/files.txt").trim().split("\n");
const MODES = ["block", "warn"] as const;

/**
 * sha256 of the JSON list of { fixture, mode, signals, messages } over every diff under fixtures/test-integrity/ (in
 * directory and name order) in modes block and warn, holding each report's test-integrity signals and its
 * TEST_INTEGRITY_* messages, as check() gave them at the base commit a1089fd.
 */
const BEFORE_DIGEST = "bf9469aaaac4d178af40fad47909e08507a87aae1fbce788f111ba5c87f66bbf";
const BEFORE_COUNT = 216;

/**
 * Fixtures added after the digest above was taken. They are left out of it, so it keeps pinning every earlier fixture
 * to the signals and messages it gave at the base commit; each of them is asserted by its own AC test (the E1 gate
 * fixes: ac-ti01-rename-edited, ac-ti03-cap, ac-ti14-config-forms and ac-e1-precision).
 */
const ADDED_AFTER_BASE: ReadonlySet<string> = new Set([
  "TI01/block-rename-away-edited.diff",
  "TI01/pass-rename-to-test-edited.diff",
  "TI03/block-behind-twenty-warns.diff",
  "TI03/block-python-context-lines.diff",
  "TI03/block-python-def-edited.diff",
  "TI03/warn-twenty-five-conditional.diff",
  "TI10/block-echo-after-run.diff",
  "TI10/block-jest-name-filter.diff",
  "TI10/block-or-colon.diff",
  "TI10/block-semicolon-true.diff",
  "TI10/pass-echo-banner.diff",
  "TI10/pass-mocha-timeout.diff",
  "TI11/block-pnpm-vitest-removed.diff",
  "TI11/block-trigger-quoted-on.diff",
  "TI11/block-uv-pytest-removed.diff",
  "TI11/pass-on-key-quoted.diff",
  "TI11/pass-uv-pytest-moved.diff",
  "TI13/block-pragma-nocover.diff",
  "TI13/pass-pragma-respelled.diff",
  "TI14/block-exclude-quoted-key-block.diff",
  "TI14/block-exclude-quoted-key.diff",
  "TI14/block-threshold-escaped.diff",
  "TI14/block-threshold-long-decimals.diff",
  "TI14/block-threshold-quoted-key.diff",
  "TI14/block-threshold-single-quoted.diff",
  "TI14/pass-key-requoted.diff",
  "TI14/pass-threshold-quoted-raised.diff",
]);

/** The TI01, TI04, TI11 and TI14 hints as renderMarkdown() gave them at the base commit a1089fd. */
const UNCHANGED_HINTS: Record<string, string> = {
  TI01: "  - Hint: Restore the deleted tests, or say in the PR why they go so a reviewer can confirm it.",
  TI04: "  - Hint: Remove the marker so the whole suite runs, or say in the PR why only the marked tests should run.",
  TI11: "  - Hint: Restore the test step or trigger, or say in the PR why CI stops running these tests so a reviewer can confirm it.",
  TI14: "  - Hint: Restore the threshold or the exclusions, or say in the PR why they change so a reviewer can confirm it.",
};

/** sha256 of each file under fixtures/golden/ at the base commit a1089fd. */
const GOLDEN_AT_BASE: Record<string, string> = {
  "coverage.info": "0aa356d8e8aa03dc96e98b7ff2dfc26af0888eeaff2e5558ce98d296806f2c64",
  "files.txt": "8c694183dc3c240752248fa93715d2a8cdb113f58e427c4fd58899b95905bdc9",
  "pr.diff": "613b371c079015a6bccaf613cbbe7a755d519bb16fe055ca2c1e8f116c6595e0",
  "report.json": "0e2fc1bc1779fadebf210df5f97fdd3a0332ffbc95819c07d81efcaabfd04d6b",
  "report.md": "1103b31eedd5e224d1028a3e79e6208445502b58b09370d59d91b6e1d37272f2",
};

/** The tracked files for a fixture: its sibling `<name>.files.txt` when there is one, else the default list. */
function filesFor(dir: string, name: string): string[] {
  const sibling = new URL(`fixtures/test-integrity/${dir}/${name.replace(/\.diff$/, ".files.txt")}`, ROOT);
  if (!existsSync(sibling)) return DEFAULT_FILES;
  return readFileSync(sibling, "utf8").trim().split("\n");
}

/** The exclusion patterns the TI14 fixture that appends an item is judged against: the items it appends. */
function excludeFor(name: string, text: string): string[] {
  if (name !== "TI14/block-exclude-appended.diff") return [];
  return text
    .split("\n")
    .filter((line) => /^\+\s+- /.test(line))
    .map((line) => line.replace(/^\+\s+- /, "").replace(/^["']|["']$/g, ""));
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/** The summary table without the Test integrity column, as it was at the base commit. Throws if the table is missing. */
function foldIntegrityColumn(markdown: string): string {
  const lines = markdown.split("\n");
  const at = lines.indexOf("| Verdict | Diff coverage | Test integrity | Agent setup |");
  if (at === -1 || lines[at + 1] !== "| --- | --- | --- | --- |") throw new Error("no four-column summary table");
  const cells = (lines[at + 2] ?? "").split(" | ");
  if (cells.length !== 4) throw new Error(`the summary row has ${cells.length} cells`);
  lines.splice(
    at,
    3,
    "| Verdict | Diff coverage | Agent setup |",
    "| --- | --- | --- |",
    [cells[0], cells[1], cells[3]].join(" | "),
  );
  return lines.join("\n");
}

describe("the accept label leaves the existing signals, hints, golden outputs and dist alone", () => {
  it("AC-14: the dist is a fresh bundle holding the accept label; fixtures, hints and golden outputs are as before", async () => {
    // The committed packages/action/dist holds the accept label and is a fresh bundle of packages/action/src.
    const actionDir = fileURLToPath(new URL("packages/action/", ROOT));
    const committed = read("packages/action/dist/index.js");
    expect(committed).toContain("accept-label");
    expect(committed).toContain("TEST_INTEGRITY_ACCEPT_IGNORED");
    const out = mkdtempSync(join(tmpdir(), "pharn-ci-bundle-"));
    try {
      const outfile = join(out, "index.js");
      execFileSync(process.execPath, ["../../scripts/bundle.mjs", "src/index.ts", outfile], { cwd: actionDir });
      expect(sha256(committed)).toBe(sha256(readFileSync(outfile, "utf8")));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }

    // The fixtures/golden outputs are the base commit's bytes.
    const goldenNames = readdirSync(new URL("fixtures/golden/", ROOT)).sort();
    expect(goldenNames).toEqual(Object.keys(GOLDEN_AT_BASE).sort());
    for (const name of goldenNames) {
      const bytes = readFileSync(new URL(`fixtures/golden/${name}`, ROOT));
      // The comment-layout change added the summary table's Test integrity column on purpose: it is folded out of
      // report.md before the hash, so every other byte is still the base commit's.
      const asAtBase = name === "report.md" ? foldIntegrityColumn(bytes.toString("utf8")) : bytes;
      expect(sha256(asAtBase), name).toBe(GOLDEN_AT_BASE[name]);
    }

    // Every test-integrity fixture gives the signals and messages it gave, with the same TI01/TI04/TI11/TI14 hints.
    const { check, renderMarkdown } = await import("@pharn-ci/core");
    const records: unknown[] = [];
    for (const dir of readdirSync(new URL("fixtures/test-integrity/", ROOT)).sort()) {
      const names = readdirSync(new URL(`fixtures/test-integrity/${dir}/`, ROOT))
        .filter((name) => name.endsWith(".diff") && !ADDED_AFTER_BASE.has(`${dir}/${name}`))
        .sort();
      for (const name of names) {
        const key = `${dir}/${name}`;
        const text = read(`fixtures/test-integrity/${key}`);
        for (const mode of MODES) {
          const report = check({
            version: "0.1.0",
            coverage: { text: read("fixtures/test-files-deleted/coverage.info"), format: "lcov" },
            diff: { text },
            repoRoot: REPO_ROOT,
            threshold: 80,
            repoFiles: filesFor(dir, name),
            exclude: excludeFor(key, text),
            testIntegrityMode: { input: mode },
          } as Parameters<typeof check>[0]);
          const messages = report.messages.filter((m) => String(m.code).startsWith("TEST_INTEGRITY_"));
          records.push({ fixture: key, mode, signals: report.testIntegrity.signals, messages });

          // The TI01, TI04, TI11 and TI14 hints under each finding and each message are the text they were.
          const lines = renderMarkdown(report).split("\n");
          lines.forEach((line, i) => {
            const id = /^- \S+ \*\*(TI\d\d)\*\* /.exec(line)?.[1] ?? /`TEST_INTEGRITY_(TI\d\d)`/.exec(line)?.[1];
            const hint = id === undefined ? undefined : UNCHANGED_HINTS[id];
            if (hint !== undefined) expect(lines[i + 1], `${key} ${mode} ${id}`).toBe(hint);
          });
        }
      }
    }
    expect(records).toHaveLength(BEFORE_COUNT);
    expect(sha256(JSON.stringify(records))).toBe(BEFORE_DIGEST);
  }, 120_000);
});
