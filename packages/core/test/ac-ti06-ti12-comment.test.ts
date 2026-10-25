import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// buildReport (through check()), the signal messages and the renderer are loaded inside the test body: the AC test is
// written before TI06, TI12 and their hints exist, so nothing that depends on them may run while the file loads. The
// report is the golden one with a TI02 block finding, a TI06 and two TI12 warn findings (one with a hostile detail)
// and their messages put in.

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";
/** A backtick, a mention, raw HTML and a markdown link. */
const HOSTILE = 'vi.mock("./x`y") replaces src/x.ts @octocat <img src=x> [x](https://example.com), a source file.';

interface Signal {
  id: string;
  severity: "block" | "warn" | "info";
  path: string;
  line: number | null;
  detail: string;
}

const SIGNALS: Signal[] = [
  {
    id: "TI06",
    severity: "warn",
    path: "src/cart.test.ts",
    line: 9,
    detail: "The test was weakened: toBe → toBeTruthy.",
  },
  {
    id: "TI12",
    severity: "warn",
    path: "src/cart.test.ts",
    line: 3,
    detail:
      'vi.mock("./cart") replaces src/cart.ts, a source file this change also edits, so the test may not run the code under review.',
  },
  { id: "TI12", severity: "warn", path: "src/hostile.test.ts", line: 4, detail: HOSTILE },
  {
    id: "TI02",
    severity: "block",
    path: "src/totals.test.ts",
    line: 12,
    detail: "The test totals › adds the prices was removed and no test of the same name or a similar body is left.",
  },
];

/** The lines of the Test integrity section: from its heading to the line before the next `### ` heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error("no Test integrity heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [HEADING, ...(end === -1 ? rest : rest.slice(0, end))];
}

/**
 * The line read as markdown outside code spans: a backslash-escaped character becomes U+FFFC (inert), and a code span
 * (backtick to backtick, where backslashes are literal) is dropped.
 */
function outsideCode(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const char = line[i] ?? "";
    if (char === "\\" && i + 1 < line.length) {
      out += "￼";
      i += 2;
    } else if (char === "`") {
      const close = line.indexOf("`", i + 1);
      if (close === -1) {
        out += char;
        i++;
      } else {
        i = close + 1;
      }
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

const FINDING = /^- \S+ \*\*(TI\d\d)\*\* `([^`]+)`/;

describe("renderMarkdown(): TI06 and TI12 in the Test integrity section", () => {
  it("AC-14: the TI02 block finding comes before the TI06 and TI12 warn findings, each with the id in bold, path:line in a code span and the detail; the TI06 and TI12 hints name the accept label; a hostile detail stays on one line, inert", async () => {
    const { check } = await import("../src/check.js");
    const { testIntegritySignalMessages, verdictOf } = (await import("../src/report.js")) as unknown as {
      testIntegritySignalMessages(signals: Signal[]): { code: string; level: string; text: string }[];
      verdictOf(messages: unknown[]): string;
    };
    const base = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
      testIntegrityMode: { input: "block" },
    } as Parameters<typeof check>[0]);
    const signalMessages = testIntegritySignalMessages(SIGNALS);
    for (const code of ["TEST_INTEGRITY_TI02", "TEST_INTEGRITY_TI06", "TEST_INTEGRITY_TI12"]) {
      expect(
        signalMessages.filter((m) => m.code === code),
        `one ${code} message`,
      ).toHaveLength(1);
    }
    for (const code of ["TEST_INTEGRITY_TI06", "TEST_INTEGRITY_TI12"]) {
      expect(signalMessages.find((m) => m.code === code)?.level, `${code} is warn`).toBe("warn");
    }
    const others = base.messages.filter((m) => !/^TEST_INTEGRITY_TI\d\d$/.test(String(m.code)));
    const messages = [...others, ...signalMessages];
    const report = {
      ...base,
      verdict: verdictOf(messages),
      messages,
      testIntegrity: { ...base.testIntegrity, mode: "block", source: "input", verdict: "fail", signals: SIGNALS },
    } as unknown as typeof base;
    expectValidReport(report);

    const { renderMarkdown } = await import("../src/render/markdown.js");
    const lines = section(renderMarkdown(report));

    const listed = lines.flatMap((line, at) => {
      const m = FINDING.exec(line);
      return m === null ? [] : [{ id: m[1] as string, where: m[2] as string, at }];
    });
    expect(listed.map((f) => `${f.id} ${f.where}`).sort()).toEqual(
      SIGNALS.map((s) => `${s.id} ${s.path}:${s.line}`).sort(),
    );
    const ti02 = listed.find((f) => f.id === "TI02") as { at: number };
    for (const f of listed.filter((f) => f.id !== "TI02")) {
      expect(ti02.at, `TI02 comes before ${f.id} ${f.where}`).toBeLessThan(f.at);
    }
    for (const signal of SIGNALS.filter((s) => s.detail !== HOSTILE)) {
      const line = lines.find(
        (l) => FINDING.exec(l)?.slice(1, 3).join(" ") === `${signal.id} ${signal.path}:${signal.line}`,
      );
      expect(line, `${signal.id} is listed`).toBeDefined();
      expect(line?.includes(`**${signal.id}**`)).toBe(true);
      expect(line?.includes(`\`${signal.path}:${signal.line}\``)).toBe(true);
      expect(line?.replace(/\\(.)/g, "$1"), "the finding line holds the detail").toContain(signal.detail);
    }

    // The TI06 and TI12 hints sit under their first finding and name the accept label.
    for (const id of ["TI06", "TI12"]) {
      const first = listed.find((f) => f.id === id) as { at: number };
      const hint = lines[first.at + 1] ?? "";
      expect(hint.startsWith("  - Hint: "), `${id} has a hint`).toBe(true);
      expect(hint, `${id} hint names the accept label`).toContain("`pharn/accepted`");
    }

    // The hostile detail: one line, no raw <img, no @octocat mention, no link.
    const at = lines.findIndex((l) => l.includes("`src/hostile.test.ts:4`"));
    expect(at, "the hostile finding is listed").toBeGreaterThan(-1);
    const line = lines[at] as string;
    expect(line, "the whole detail is on the finding line").toMatch(/octocat.*example/);
    const inert = outsideCode(line);
    expect(inert).not.toContain("<img");
    expect(inert).not.toContain("@octocat");
    expect(inert).not.toMatch(/\[[^\]]*\]\(/);
    for (const l of lines) expect(outsideCode(l), `no raw <img in the section: ${l}`).not.toContain("<img");
  });
});
