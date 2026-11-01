import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-20. Reads the schemas as text, and at the base commit with git; check() and renderMarkdown() are
// loaded inside the test body: the AC test is written before the build adds the code, so nothing the build adds may
// run while this file loads. The base is c6b685b (E3 item 24a part B, main when this was written).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "c6b685b";
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const atCommit = (commit: string, path: string) =>
  execFileSync("git", ["show", `${commit}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const P07_HINT =
  "Make the instruction files in one directory name the same package manager and test runner, or move a file into the package it describes; an agent follows whichever file it reads first.";

/** The upper-case code words of a text (as the pyparity2 pin collects them). */
const words = (text: string) =>
  [...new Set([...text.matchAll(/\b(?:TI\d\d|[A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g)].map((m) => m[0]))].sort();

const codeDescription = (schemaText: string): string =>
  (JSON.parse(schemaText) as { $defs: { message: { properties: { code: { description: string } } } } }).$defs.message
    .properties.code.description;

type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[] };
interface Core {
  check(input: unknown): Report;
  renderMarkdown(report: Report): string;
}

describe("the schema sentence, the hint and the README row for POLICY_P07", { timeout: 60_000 }, () => {
  it("AC-20: report.v2.json appends exactly one POLICY_P07 sentence and changes no other byte; report.v1.json is unchanged; a report with POLICY_P07 validates; the hint is the fixed text; the README table has a POLICY_P07 row", async () => {
    // report.v2.json: the code description is the base one plus the one appended sentence; nothing else changes.
    const baseText = atCommit(BASE, "schema/report.v2.json");
    const nowText = read("schema/report.v2.json");
    const base = codeDescription(baseText);
    const now = codeDescription(nowText);
    expect(now.startsWith(base)).toBe(true);
    // Re-pinned on the rebase onto E3 item 23 (policy settings): its sentence (POLICY_P02 to POLICY_P06 and
    // POLICY_SETTINGS_INVALID) comes first, right after the base; ac-polrules-docs and ac-upload-schema pin it exactly.
    // The P07 sentence is the last one, and only it is judged here.
    const all = now.slice(base.length);
    expect(all.startsWith(" POLICY_P02, POLICY_P03, POLICY_P04, POLICY_P05 and POLICY_P06 ("), all).toBe(true);
    const appended = all.slice(all.indexOf(" POLICY_P07 ("));
    expect(appended.startsWith(" POLICY_P07 ("), appended).toBe(true);
    expect(appended.endsWith("never the file's text)."), appended).toBe(true);
    expect(words(appended)).toEqual(["POLICY_P07"]);
    // Exactly one sentence: no sentence end before the final one outside the parenthesis.
    expect(appended.slice(1).includes(" POLICY_"), appended).toBe(false);
    const encode = (s: string) => JSON.stringify(s).slice(1, -1);
    expect(baseText.split(encode(base))).toHaveLength(2);
    expect(nowText).toBe(baseText.replace(encode(base), () => encode(now)));

    // report.v1.json: byte-identical to the base commit.
    expect(read("schema/report.v1.json")).toBe(atCommit(BASE, "schema/report.v1.json"));

    // A report carrying POLICY_P07 validates and renders the hint.
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const report = core.check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("diff/empty.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: ["AGENTS.md", "CLAUDE.md", "src/a.ts"],
      policy: { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } },
      agentInstructionSources: {
        files: [
          { path: "AGENTS.md", text: "# Agents\n\nRun `pnpm install`.\n" },
          { path: "CLAUDE.md", text: "# Claude\n\nRun `npm install`.\n" },
        ],
        dropped: [],
      },
    });
    expectValidReport(report);
    expect(report.messages.map((m) => m.code)).toContain("POLICY_P07");
    expectValidReport({ ...report, messages: report.messages.filter((m) => m.code === "POLICY_P07") });

    const markdown = core.renderMarkdown(report);
    expect(markdown).toContain(`  - Hint: ${P07_HINT}`);
    const source = read("packages/core/src/render/markdown.ts");
    const hints = source.indexOf("MESSAGE_HINTS");
    expect(hints, "MESSAGE_HINTS in markdown.ts").toBeGreaterThanOrEqual(0);
    const entry = source.indexOf("POLICY_P07:", hints);
    expect(entry, "MESSAGE_HINTS.POLICY_P07 in markdown.ts").toBeGreaterThan(hints);
    expect(source.slice(entry, entry + 400)).toContain(JSON.stringify(P07_HINT));

    // The README message-code table.
    expect(read("README.md")).toMatch(/^\| `POLICY_P07` +\|/m);
  });
});
