import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the renderer are loaded inside the test body: the AC test is written before TI02, TI05 and their hints
// exist, so nothing that depends on them may run while the file loads. The report comes from check() over sources
// written here: 11 TI02 findings (one with a hostile name, one warn), 2 TI05 findings (block and warn) and a file
// whose head text was dropped.

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";
const CART = "src/cart.test.ts";
const TOTALS = "src/totals.test.ts";
const DROPPED = "src/c.test.ts";
const HEADER = ['import { describe, expect, it } from "vitest";', 'import { total } from "./cart.js";', ""];
/** The test's name in the source: a backtick, a mention, raw HTML, an escaped newline and a markdown link. */
const HOSTILE_LINE = 'it("hostile ` @octocat <img src=x>\\n[x](https://example.com)", () => {';

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
  messages: { code: string; level: string; text: string }[];
}

/** A `--unified=0` diff of `path` that removes the base lines whose index `removed` holds (0-based). */
function deletionDiff(path: string, baseLines: readonly string[], removed: ReadonlySet<number>): string {
  const out = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  let kept = 0;
  for (let i = 0; i < baseLines.length; ) {
    if (!removed.has(i)) {
      kept++;
      i++;
      continue;
    }
    let j = i;
    while (j < baseLines.length && removed.has(j)) j++;
    out.push(`@@ -${i + 1},${j - i} +${kept},0 @@`, ...baseLines.slice(i, j).map((line) => `-${line}`));
    i = j;
  }
  return `${out.join("\n")}\n`;
}

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

async function buildReport(): Promise<Report> {
  // src/cart.test.ts: nine named tests, the hostile one and an .each test removed; one test kept.
  const cartBase = [...HEADER];
  for (let i = 0; i < 9; i++) {
    cartBase.push(`it("removes case ${i}", () => {`, `  expect(removed${i}Value()).toEqual({ id: ${i} });`, "});");
  }
  cartBase.push(HOSTILE_LINE, "  expect(hostileValue()).toBe(1);", "});");
  cartBase.push('it.each([[1, 2]])("adds %s", (a, b) => {', "  expect(tableSum(a, b)).toBe(a + b);", "});");
  const removedCount = cartBase.length - HEADER.length;
  cartBase.push('it("keeps working", () => {', "  expect(total([])).toBe(0);", "});", "");
  const cartRemoved = new Set(Array.from({ length: removedCount }, (_, k) => HEADER.length + k));
  const cartHead = cartBase.filter((_, i) => !cartRemoved.has(i));

  // src/totals.test.ts: one test emptied (block), one whose assertions become a helper call (warn).
  const totalsBase = [
    ...HEADER,
    'it("totals two prices", () => {',
    "  const sum = total([2, 3]);",
    "  expect(sum).toBe(5);",
    "  expect(sum).toBeGreaterThan(0);",
    "});",
    'it("totals a valid cart", () => {',
    "  const cart = total([4]);",
    "  expect(cart).toBe(4);",
    "  expect(cart).toBeLessThan(5);",
    "});",
    "",
  ];
  const totalsHead = [
    ...HEADER,
    'it("totals two prices", () => {',
    "  const sum = total([2, 3]);",
    "});",
    'it("totals a valid cart", () => {',
    "  const cart = total([4]);",
    "  expectValidCart(cart);",
    "});",
    "",
  ];
  const totalsDiff = [
    `diff --git a/${TOTALS} b/${TOTALS}`,
    "index 1111111..2222222 100644",
    `--- a/${TOTALS}`,
    `+++ b/${TOTALS}`,
    "@@ -6,2 +5,0 @@",
    "-  expect(sum).toBe(5);",
    "-  expect(sum).toBeGreaterThan(0);",
    "@@ -11,2 +9 @@",
    "-  expect(cart).toBe(4);",
    "-  expect(cart).toBeLessThan(5);",
    "+  expectValidCart(cart);",
    "",
  ].join("\n");
  const droppedDiff = [
    `diff --git a/${DROPPED} b/${DROPPED}`,
    "index 1111111..2222222 100644",
    `--- a/${DROPPED}`,
    `+++ b/${DROPPED}`,
    "@@ -4 +4 @@",
    '-it("a", () => {',
    '+it("b", () => {',
    "",
  ].join("\n");

  const text = (lines: string[]) => lines.join("\n");
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: deletionDiff(CART, cartBase, cartRemoved) + totalsDiff + droppedDiff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [DROPPED, CART, "src/cart.ts", TOTALS],
    testSources: {
      base: {
        files: [
          { path: DROPPED, text: `${text(HEADER)}\nit("a", () => {});\n` },
          { path: CART, text: text(cartBase) },
          { path: TOTALS, text: text(totalsBase) },
        ],
        dropped: [],
      },
      head: {
        files: [
          { path: CART, text: text(cartHead) },
          { path: TOTALS, text: text(totalsHead) },
        ],
        dropped: [{ path: DROPPED, reason: "too-large" }],
      },
    },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("renderMarkdown(): TI02 and TI05 in the Test integrity section", () => {
  it("AC-16: block findings first with the id in bold, path:line in a code span and the detail, the findings after the tenth collapsed, the three hints, and a hostile test name inert on one line", async () => {
    const report = await buildReport();
    const signals = report.testIntegrity.signals.filter((s) => ["TI02", "TI05"].includes(String(s.id)));
    const severityOf = new Map(signals.map((s) => [`${s.id} ${s.path}:${s.line}`, s.severity]));
    // The report this test renders: TI02 and TI05, each with block and warn, more than ten in all.
    for (const id of ["TI02", "TI05"]) {
      for (const severity of ["block", "warn"]) {
        expect(
          signals.some((s) => String(s.id) === id && s.severity === severity),
          `${id} ${severity}`,
        ).toBe(true);
      }
    }
    expect(signals.length).toBeGreaterThan(10);
    expect(report.messages.some((m) => String(m.code) === "TEST_INTEGRITY_INDEX_UNAVAILABLE")).toBe(true);

    const { renderMarkdown } = await import("../src/render/markdown.js");
    const markdown = renderMarkdown(report as never);
    const lines = section(markdown);

    // Every finding is listed, block before warn, the id in bold and `path:line` in a code span.
    const listed = lines.flatMap((line, at) => {
      const m = FINDING.exec(line);
      return m === null ? [] : [{ key: `${m[1]} ${m[2]}`, at }];
    });
    expect(listed.map((f) => f.key).sort()).toEqual([...severityOf.keys()].sort());
    const severities = listed.map((f) => severityOf.get(f.key));
    const lastBlock = severities.lastIndexOf("block");
    const firstWarn = severities.indexOf("warn");
    expect(lastBlock, "block findings come before warn findings").toBeLessThan(firstWarn);
    for (const signal of signals) {
      if (signal.detail.includes("hostile")) continue;
      const line = lines.find(
        (l) => FINDING.exec(l)?.slice(1, 3).join(" ") === `${signal.id} ${signal.path}:${signal.line}`,
      );
      expect(line?.replace(/\\(.)/g, "$1"), "the finding line holds the detail").toContain(signal.detail);
    }

    // The findings after the tenth sit in a <details> block.
    const details = lines.findIndex((line) => line.startsWith("<details>"));
    expect(details, "a <details> block").toBeGreaterThan(-1);
    expect(lines[details]).toContain(`${signals.length - 10} more`);
    expect(listed.filter((f) => f.at < details)).toHaveLength(10);
    const close = lines.findIndex((line, i) => i > details && line.includes("</details>"));
    expect(listed.filter((f) => f.at > details && f.at < close)).toHaveLength(signals.length - 10);

    // The TI02 and TI05 hints name the accept label; TEST_INTEGRITY_INDEX_UNAVAILABLE has a hint.
    for (const id of ["TI02", "TI05"]) {
      const first = listed.find((f) => f.key.startsWith(`${id} `));
      const hint = lines[(first?.at ?? -2) + 1] ?? "";
      expect(hint.startsWith("  - Hint: "), `${id} hint`).toBe(true);
      expect(hint, `${id} hint names the accept label`).toContain("`pharn/accepted`");
    }
    const all = markdown.split("\n");
    const unavailable = all.findIndex((line) => line.includes("`TEST_INTEGRITY_INDEX_UNAVAILABLE`"));
    expect(unavailable, "the INDEX_UNAVAILABLE message is listed").toBeGreaterThan(-1);
    expect(all[unavailable + 1]?.startsWith("  - Hint: "), "with a hint").toBe(true);

    // The hostile name: one line, no raw <img, no @octocat mention, no link.
    const hostile = signals.find((s) => s.detail.includes("hostile"));
    expect(hostile, "the hostile test is a finding").toBeDefined();
    const at = lines.findIndex((l) => l.includes(`\`${hostile?.path}:${hostile?.line}\``));
    expect(at).toBeGreaterThan(-1);
    const line = lines[at] as string;
    expect(line, "the whole name is on the finding line").toMatch(/hostile.*example/);
    const inert = outsideCode(line);
    expect(inert).not.toContain("<img");
    expect(inert).not.toContain("@octocat");
    expect(inert).not.toMatch(/\[[^\]]*\]\(/);
    for (const l of lines) {
      expect(outsideCode(l), `no raw <img in the section: ${l}`).not.toContain("<img");
      expect(l.startsWith("[x]("), "the newline did not split the name").toBe(false);
    }
  });
});
