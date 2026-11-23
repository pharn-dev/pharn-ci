import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-50 (binary-diff-not-blind). check() and renderMarkdown() are loaded inside each test body: the AC tests are
// written before the binary findings and their hints exist, so nothing the build changes may run while the file loads.
// The case directories (change.diff, optional base/ and head/ with `<path>.txt` and `<path>.dropped`) are read inside
// the test bodies. The comment hints of TI01, TI10, TI11 and TI14 for a report with no binary finding were recorded on
// the base commit 0942691 with the same check() inputs, and are written here as literals.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CONFIG = ".pharn/ci.yml";
const UNAVAILABLE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const DELETED = "Test file deleted; git shows it as binary, so its text was not read.";
const RENAMED = "Test file renamed away; git shows it as binary, so its text was not read.";
const BINARY = "git shows this file as binary, so its changes could not be read.";
const FIXED = [DELETED, RENAMED, BINARY];
const IDS = ["TI01", "TI10", "TI11", "TI14"];

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Message {
  code: string;
  level: string;
  text: string;
  fix?: { hint?: string };
}
interface Report {
  verdict: string;
  messages: Message[];
  testIntegrity: { signals: Signal[] };
}
interface Side {
  files: { path: string; text: string }[];
  dropped: { path: string; reason: string }[];
}
interface Sources {
  base: Side;
  head: Side;
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function readSide(dir: string): Side | null {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => statSync(join(dir, name)).isFile());
  const side: Side = { files: [], dropped: [] };
  for (const name of names) {
    const text = readFileSync(join(dir, name), "utf8");
    if (name.endsWith(".txt")) side.files.push({ path: name.slice(0, -".txt".length), text });
    else if (name.endsWith(".dropped"))
      side.dropped.push({ path: name.slice(0, -".dropped".length), reason: text.trim() });
  }
  side.files.sort(byPath);
  side.dropped.sort(byPath);
  return side;
}

function loadCase(name: string): { diff: string; sources: Sources | undefined } {
  const dir = `${FIXTURES}test-integrity/${name}`;
  const base = readSide(join(dir, "base"));
  const head = readSide(join(dir, "head"));
  const empty: Side = { files: [], dropped: [] };
  return {
    diff: readFileSync(join(dir, "change.diff"), "utf8"),
    sources: base === null && head === null ? undefined : { base: base ?? empty, head: head ?? empty },
  };
}

async function run(diff: string, sources?: Sources, extra: Record<string, unknown> = {}): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: [
      ".gitattributes",
      ".github/workflows/ci.yml",
      CONFIG,
      "package.json",
      "src/cart.ts",
      ...(sources?.head.files.map((file) => file.path) ?? []),
    ],
    testIntegrityMode: { input: "block" },
    configPath: CONFIG,
    ...(sources === undefined ? {} : { testSources: sources }),
    ...extra,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

/** The `  - Hint:` line under the finding line of signal `id` at `path` in the rendered comment. */
function findingHint(markdown: string, id: string, path: string, name: string): string {
  const lines = markdown.split("\n");
  const at = lines.findIndex((line) => line.includes(`**${id}**`) && line.includes(`\`${path}`));
  expect(at, `${name}: the comment lists the ${id} finding at ${path}`).toBeGreaterThan(-1);
  const hint = lines[at + 1] ?? "";
  expect(hint.startsWith("  - Hint: "), `${name}: a hint line under the ${id} finding`).toBe(true);
  return hint;
}

/** The `  - Hint:` line under the message line that names `code` in the rendered comment. */
function messageHint(markdown: string, code: string, name: string): string {
  const lines = markdown.split("\n");
  const at = lines.findIndex((line) => line.includes(`\`${code}\``));
  expect(at, `${name}: the comment lists ${code}`).toBeGreaterThan(-1);
  const hint = lines.slice(at + 1, at + 4).find((line) => line.startsWith("  - Hint: "));
  expect(hint, `${name}: a hint line under ${code}`).toBeDefined();
  return hint as string;
}

/**
 * Comment hints of a report with no binary finding. The base commit 0942691 recorded them; CORE-140 made each the
 * code's fix.hint (with the accept-label clause at its end for TI10), so these are the fix hints.
 */
const BASE_HINTS: Record<string, string> = {
  TI01: "  - Hint: Restore the deleted test file, or move its tests to a test file that still runs them.",
  TI10: "  - Hint: Restore the test script in package.json so it runs the whole suite and fails when a test fails, or say in the PR why it changes; a reviewer who is not the PR author can record that sign-off by applying the accept label `pharn/accepted`.",
  TI11: "  - Hint: Revert the workflow change so CI runs the tests on pull requests as before.",
  TI14: "  - Hint: Revert the change to the coverage settings of the pharn-ci config so the gate measures the same files as before.",
};

const textEdit = (path: string, header: string, removed: string, added: string) =>
  `${[
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    header,
    `-${removed}`,
    `+${added}`,
  ].join("\n")}\n`;

/** The base-commit inputs of BASE_HINTS: one text finding per id, with the inputs the literals were recorded with. */
async function textReport(diff: string): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: readFileSync(`${FIXTURES}test-files-deleted/files.txt`, "utf8").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

/** Every binary case of AC-1 to AC-14; `noText` marks a case whose binary entries no signal can read text for. */
const CASES: { name: string; noText: boolean }[] = [
  { name: "TI01/block-binary-gitattributes-deleted", noText: true },
  { name: "TI01/block-binary-spec-mjs-deleted", noText: true },
  { name: "TI01/block-binary-test-cts-deleted", noText: true },
  { name: "TI01/block-binary-py-deleted", noText: true },
  { name: "TI01/block-binary-go-deleted", noText: true },
  { name: "TI01/block-binary-renamed-away", noText: true },
  { name: "TI01/pass-binary-not-test-deleted", noText: false },
  { name: "index-unavailable/pass-binary-not-test-modified", noText: false },
  { name: "index-unavailable/binary-modified", noText: false },
  { name: "index-unavailable/binary-modified-python", noText: false },
  { name: "index-unavailable/binary-renamed", noText: false },
  { name: "index-unavailable/binary-added", noText: false },
  { name: "TI10/block-binary-no-sources", noText: true },
  { name: "TI10/block-binary-head-dropped", noText: true },
  { name: "TI10/block-binary-or-true-sources", noText: false },
  { name: "TI10/pass-binary-scripts-equal", noText: false },
  { name: "TI11/block-binary-workflow-modified", noText: true },
  { name: "TI11/block-binary-workflow-deleted", noText: true },
  { name: "TI14/block-binary-config-modified", noText: true },
  { name: "TI14/pass-binary-other-yaml", noText: false },
  { name: "TI09/block-binary-pass-with-no-tests", noText: false },
  { name: "TI09/pass-binary-same-settings", noText: false },
];

/** The lines of a case's texts and of its diff's added and removed lines, trimmed, that are long enough to identify. */
function contentLines(diff: string, sources: Sources | undefined): string[] {
  const texts = [...(sources?.base.files ?? []), ...(sources?.head.files ?? [])].flatMap((f) => f.text.split("\n"));
  const changed = diff
    .split("\n")
    .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++ ") && !l.startsWith("--- "))
    .map((l) => l.slice(1));
  return [...texts, ...changed].map((l) => l.trim()).filter((l) => l.length >= 8);
}

describe("CORE-50: the hints name `.gitattributes` for a binary finding, and the texts hold no file content", () => {
  it("AC-17: the TEST_INTEGRITY_INDEX_UNAVAILABLE comment and fix hints name `.gitattributes` and a `-diff` or binary attribute (fix hint at most 200 characters), the TI01, TI10, TI11 and TI14 comment hints of a binary finding name `.gitattributes`, and without a binary finding those four hints are the base commit's", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const unavailable = await run(loadCase("index-unavailable/binary-modified").diff);
    const messages = unavailable.messages.filter((m) => m.code === UNAVAILABLE);
    expect(messages, `one ${UNAVAILABLE}`).toHaveLength(1);
    const fixHint = messages[0]?.fix?.hint ?? "";
    expect(fixHint, "the fix hint names .gitattributes").toContain(".gitattributes");
    expect(fixHint, "the fix hint names a -diff or binary attribute").toMatch(/-diff|\bbinary\b/);
    expect(fixHint.length, "the fix hint is at most 200 characters").toBeLessThanOrEqual(200);
    const commentHint = messageHint(renderMarkdown(unavailable as never), UNAVAILABLE, "binary-modified");
    expect(commentHint, "the comment hint names .gitattributes").toContain(".gitattributes");
    expect(commentHint, "the comment hint names a -diff or binary attribute").toMatch(/-diff|\bbinary\b/);

    const binaryFindings = [
      ["TI01/block-binary-gitattributes-deleted", "TI01", "src/cart.test.ts"],
      ["TI01/block-binary-renamed-away", "TI01", "src/cart.test.ts"],
      ["TI10/block-binary-no-sources", "TI10", "package.json"],
      ["TI11/block-binary-workflow-modified", "TI11", ".github/workflows/"],
      ["TI14/block-binary-config-modified", "TI14", CONFIG],
    ] as const;
    for (const [name, id, path] of binaryFindings) {
      const { diff, sources } = loadCase(name);
      const report = await run(diff, sources);
      const binary = report.testIntegrity.signals.filter(
        (s) => s.id === id && s.path.startsWith(path) && FIXED.includes(s.detail),
      );
      expect(binary, `${name}: a binary ${id} finding`).toHaveLength(1);
      const hint = findingHint(renderMarkdown(report as never), id, (binary[0] as Signal).path, name);
      expect(hint, `${name}: the ${id} hint names .gitattributes`).toContain(".gitattributes");
    }

    const texts: Record<string, string> = {
      TI01: readFileSync(`${FIXTURES}test-integrity/TI01/block-code-stays.diff`, "utf8"),
      TI10: textEdit("package.json", "@@ -7 +7 @@", '    "test": "vitest run",', '    "test": "vitest run || true",'),
      TI11: readFileSync(`${FIXTURES}test-integrity/TI11/block-coverage-false.diff`, "utf8"),
      TI14: textEdit(CONFIG, "@@ -3 +3 @@", "  threshold: 80", "  threshold: 70"),
    };
    for (const id of IDS) {
      const report = await textReport(texts[id] as string);
      const signals = report.testIntegrity.signals.filter((s) => s.id === id);
      expect(signals, `${id}: one text finding`).toHaveLength(1);
      expect(FIXED, `${id}: not a binary finding`).not.toContain(signals[0]?.detail);
      const signal = signals[0] as Signal;
      const at = signal.line === null ? signal.path : `${signal.path}:${signal.line}`;
      const hint = findingHint(renderMarkdown(report as never), id, at, `${id} text finding`);
      expect(hint, `${id}: the base commit's hint, byte for byte`).toBe(BASE_HINTS[id]);
    }
  });

  it("AC-18: over every binary case of AC-1 to AC-14, each new TI01, TI10, TI11 and TI14 detail is one of the three fixed sentences, and no detail or TEST_INTEGRITY_INDEX_UNAVAILABLE text holds a line of a test, config or workflow text", async () => {
    const seen = new Set<string>();
    for (const { name, noText } of CASES) {
      const { diff, sources } = loadCase(name);
      const report = await run(diff, sources);
      const signals = report.testIntegrity.signals.filter((s) => IDS.includes(s.id));
      if (noText) {
        expect(signals.length, `${name}: a binary finding`).toBeGreaterThan(0);
        for (const s of signals) {
          expect(FIXED, `${name}: ${s.id} ${s.path} has a fixed binary detail`).toContain(s.detail);
          seen.add(s.detail);
        }
      }
      const texts = [
        ...signals.map((s) => `${s.id} detail: ${s.detail}`),
        ...report.messages.filter((m) => m.code === UNAVAILABLE).map((m) => `${UNAVAILABLE}: ${m.text}`),
      ];
      for (const line of contentLines(diff, sources)) {
        for (const text of texts) expect(text, `${name}: holds no file content`).not.toContain(line);
      }
      for (const value of ["vitest run", "|| true", "passWithNoTests", "expect(", "def test_"]) {
        for (const text of texts) expect(text, `${name}: holds no value of a file`).not.toContain(value);
      }
    }
    expect([...seen].sort(), "every fixed sentence is used, and only those").toEqual([...FIXED].sort());
  });
});
