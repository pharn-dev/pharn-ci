import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { withFixHints } from "../src/fix/attach.js";
import { MESSAGE_FIXES, SIGNAL_FIXES } from "../src/fix/table.js";
import { POLICY_SIGNAL_IDS } from "../src/policy/limits.js";
import { validatePolicy } from "../src/policy/validate.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { type Report, type TestIntegritySignal, testIntegritySignalMessages, verdictOf } from "../src/report.js";
import { TEST_INTEGRITY_SIGNAL_IDS, TEST_INTEGRITY_SIGNALS } from "../src/signals/registry.js";
import { codeTable } from "./codeTable.js";
import { fixture } from "./helpers.js";
import { expectValidReport, validateReport } from "./schema.js";
import { check } from "./text-coverage.js";

// CORE-140: one registry of the test-integrity signals. The ids are written once, in packages/core/src/signals/
// registry.ts; the policy's ids, the message codes, their fix entries, the report messages and the comment's hints
// derive from it, and each code has one advice text: the comment shows the code's fix.hint, with the accept-label
// clause at its end where the code has one.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "packages/core/src");
const REGISTRY = "signals/registry.ts";
const ACCEPT =
  "; a reviewer who is not the PR author can record that sign-off by applying the accept label `pharn/accepted`.";

/** The distinct test-integrity ids a source file writes as a string literal or an object key. */
function writtenIds(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const ids = [
    ...code.matchAll(/["'`](?:TEST_INTEGRITY_)?(TI\d\d)["'`]/g),
    ...code.matchAll(/^\s*(?:TEST_INTEGRITY_)?(TI\d\d)\s*:/gm),
  ].map((m) => m[1] as string);
  return [...new Set(ids)].sort();
}

/** The golden report with the given signals and their messages put in, fix hints attached, validated. */
function reportWith(signals: TestIntegritySignal[]): Report {
  const base = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  const others = base.messages.filter((m) => !/^TEST_INTEGRITY_TI\d\d$/.test(String(m.code)));
  const messages = [...others, ...testIntegritySignalMessages(signals)];
  const report = withFixHints({
    ...base,
    verdict: verdictOf(messages),
    messages,
    testIntegrity: { ...base.testIntegrity, mode: "block", source: "input", verdict: "fail", signals },
  } as Report);
  expectValidReport(report);
  return report;
}

describe("the signal registry", () => {
  it("lists TI01 to TIn once each, in order, TI17 among them; TI15 has no message (not emitted) and every other id has one", () => {
    const ids = TEST_INTEGRITY_SIGNALS.map((s) => s.id);
    expect(ids.length).toBeGreaterThanOrEqual(17);
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => `TI${String(i + 1).padStart(2, "0")}`));
    expect(TEST_INTEGRITY_SIGNAL_IDS).toEqual(ids);
    for (const signal of TEST_INTEGRITY_SIGNALS) {
      expect("message" in signal, signal.id).toBe(signal.id !== "TI15");
    }
  });

  it("is the one hand-written list of signal ids in packages/core/src", () => {
    const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .map((name) => name.split("\\").join("/"))
      .filter((name) => name.endsWith(".ts"));
    // Control: the scan finds the registry's list, and a list written another way.
    expect(writtenIds(readFileSync(join(SRC, REGISTRY), "utf8"))).toEqual([...TEST_INTEGRITY_SIGNAL_IDS]);
    expect(writtenIds('const A = new Set(["TI01", "TI10"]);\nconst B = {\n  TEST_INTEGRITY_TI02: 1,\n};')).toEqual([
      "TI01",
      "TI02",
      "TI10",
    ]);
    expect(writtenIds('// "TI01", "TI02"\nexport const id = "TI03";')).toEqual(["TI03"]);
    const lists = files
      .filter((name) => name !== REGISTRY)
      .map((name) => [name, writtenIds(readFileSync(join(SRC, name), "utf8"))] as const)
      .filter(([, ids]) => ids.length > 1)
      .map(([name, ids]) => `${name}: ${ids.join(" ")}`);
    expect(lists, "files that write more than one signal id").toEqual([]);
  });

  it("feeds the policy's ids, the message codes, their fix entries, the schemas and the code table", () => {
    expect(POLICY_SIGNAL_IDS).toEqual(TEST_INTEGRITY_SIGNAL_IDS);
    // TI15 stays a valid policy key and a valid code although it is not emitted.
    expect(validatePolicy({ version: 1, test_integrity: { signals: { TI15: "off" } } }).ok).toBe(true);
    expect(validatePolicy({ version: 1, test_integrity: { signals: { TI18: "off" } } }).ok).toBe(false);
    const policySchema = JSON.parse(readFileSync(join(ROOT, "schema/policy.v1.json"), "utf8"));
    expect(Object.keys(policySchema.properties.test_integrity.properties.signals.properties)).toEqual([
      ...TEST_INTEGRITY_SIGNAL_IDS,
    ]);
    const table = codeTable();
    const report = JSON.parse(fixture("golden/report.json")) as Report;
    for (const signal of TEST_INTEGRITY_SIGNALS) {
      const code = `TEST_INTEGRITY_${signal.id}` as keyof typeof MESSAGE_FIXES;
      // One entry object: the signal's fix is the code's fix.
      expect(MESSAGE_FIXES[code], code).toBe(signal.fix);
      expect(SIGNAL_FIXES[signal.id], signal.id).toBe(signal.fix);
      expect(table.has(code), `the code table has ${code}`).toBe(true);
      expect(validateReport({ ...report, messages: [{ level: "info", code, text: "x" }] }), code).toBe(true);
    }
  });

  it("each code has one advice text: the comment's hint under a finding is its fix.hint, with the accept-label clause where the code has one", () => {
    for (const severity of ["warn", "block"] as const) {
      const emitted = TEST_INTEGRITY_SIGNALS.filter((s) => "message" in s);
      const signals = emitted.map(
        (s, i) =>
          ({
            id: s.id,
            severity,
            path: `src/t${i}.test.ts`,
            line: 1,
            detail: `A ${s.id} finding.`,
          }) as TestIntegritySignal,
      );
      const report = reportWith(signals);
      const lines = renderMarkdown(report).split("\n");
      for (const signal of emitted) {
        const at = lines.findIndex((line) => line.includes(`**${signal.id}**`));
        expect(at, `${signal.id} is listed`).toBeGreaterThan(-1);
        const finding = report.testIntegrity.signals.find((s) => s.id === signal.id);
        const accept =
          ("accept" in signal && signal.accept === "always") ||
          ("accept" in signal && signal.accept === "block" && severity === "block");
        const hint = finding?.fix?.hint ?? "";
        expect(lines[at + 1], `${signal.id} ${severity}`).toBe(
          `  - Hint: ${accept ? `${hint.slice(0, -1)}${ACCEPT}` : hint}`,
        );
      }
    }
  });
});
