import { describe, expect, it } from "vitest";
import { runDiff } from "./ac-e1-fix-shared.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and readDiffChunks() are loaded inside the test body: the AC tests are written before TI08, TI15 and TI16
// exist, so nothing the build adds may run while the file loads.

/** Ids, codes, the focus call, the snapshot names, the literal and the marker, built from parts. */
const j = (...parts: string[]) => parts.join("");
const TI04 = j("TI", "04");
const TI08 = j("TI", "08");
const TI15 = j("TI", "15");
const TI16 = j("TI", "16");
const NEW_IDS = [TI08, TI15, TI16];
const code = (id: string) => j("TEST_INTEGRITY_", id);
const ONLY = j("it", ".only");
const SUMMER = j("SUMMER", "2024");
const SUPPRESSION = `  ${j("/", "/")} ${j("eslint", "-disable-next-line")} no-console`;

/** One hunk of a `--unified=0` diff: the first old and new line of the change, the removed and the added lines. */
type Hunk = [oldStart: number, newStart: number, removed: string[], added: string[]];

function hunk([oldStart, newStart, removed, added]: Hunk): string[] {
  const oldPart = removed.length === 0 ? `${oldStart - 1},0` : `${oldStart},${removed.length}`;
  const newPart = added.length === 0 ? `${newStart - 1},0` : `${newStart},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, ...hunks: Hunk[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap((h) => hunk(h))].join("\n")}\n`;
}

const add = (path: string, lines: string[]) => edit(path, [12, 12, [], lines]);
const snapshots = Array.from({ length: 11 }, (_, i) =>
  edit(`src/__snapshots__/view-${String(i + 1).padStart(2, "0")}.ts.snap`, [
    3,
    3,
    ['exports[`view renders 1`] = `"old"`;'],
    ['exports[`view renders 1`] = `"new"`;'],
  ]),
).join("");

const TI16_ONLY = add("src/a.test.ts", [SUPPRESSION]);
/** TI04 (.only), TI08 (11 snapshot files), TI15 (a matching test and source literal), TI16 (a test suppression). */
const DIFF =
  add("src/b.test.ts", [`${ONLY}('creates a user', () => {});`]) +
  snapshots +
  add("src/discount.test.ts", [`  expect(price("${SUMMER}")).toBe(0);`]) +
  add("src/discount.ts", [`  if (code === "${SUMMER}") return 0;`]) +
  TI16_ONLY;

type Report = Awaited<ReturnType<typeof runDiff>>;

const severities = (report: Report, id: string) => [
  ...new Set(report.testIntegrity.signals.filter((s) => String(s.id) === id).map((s) => String(s.severity))),
];
const ours = (report: Report) =>
  report.messages
    .filter((m) => [TI04, ...NEW_IDS].map(code).includes(String(m.code)))
    .map((m) => `${m.code} ${m.level}`);

async function* chunksOf(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

describe("TI08, TI15 and TI16 in the three modes and through the streaming reader", () => {
  it("AC-12: the three never block, keep their severities in block and warn, are not computed in off, stream the same as whole text, and a TI16-only diff passes", async () => {
    const block = await runDiff(DIFF, "block");
    expect(severities(block, TI04)).toEqual(["block"]);
    expect(severities(block, TI08)).toEqual(["warn"]);
    expect(severities(block, TI15)).toEqual(["warn"]);
    expect(severities(block, TI16)).toEqual(["info"]);
    expect(block.testIntegrity.verdict).toBe("fail");
    expect(ours(block)).toEqual([
      `${code(TI04)} error`,
      `${code(TI08)} warn`,
      `${code(TI15)} warn`,
      `${code(TI16)} info`,
    ]);

    const warn = await runDiff(DIFF, "warn");
    expect(severities(warn, TI08)).toEqual(["warn"]);
    expect(severities(warn, TI15)).toEqual(["warn"]);
    expect(severities(warn, TI16)).toEqual(["info"]);
    expect(warn.testIntegrity.verdict).toBe("warn");

    const off = await runDiff(DIFF, "off");
    for (const id of NEW_IDS) {
      expect(severities(off, id), id).toEqual([]);
      expect(
        off.messages.filter((m) => String(m.code) === code(id)),
        id,
      ).toEqual([]);
    }

    // The same diff through the streaming reader in chunks of 7 characters gives the same signals and messages.
    const { check, readDiffChunks } = await import("@pharn-ci/core");
    const base = {
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" as const },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
      testIntegrityMode: { input: "block" as const },
    };
    const parsed = await readDiffChunks(chunksOf(DIFF, 7));
    const streamed = check({ ...base, diff: { parsed } } as Parameters<typeof check>[0]);
    const whole = check({ ...base, diff: { text: DIFF } } as Parameters<typeof check>[0]);
    expectValidReport(streamed);
    expectValidReport(whole);
    for (const id of NEW_IDS) expect(severities(whole, id).length, id).toBe(1);
    expect(streamed.testIntegrity.signals).toEqual(whole.testIntegrity.signals);
    expect(streamed.messages).toEqual(whole.messages);

    // A diff carrying only the TI16 finding passes the test-integrity verdict.
    const only = await runDiff(TI16_ONLY, "block");
    expect(severities(only, TI16)).toEqual(["info"]);
    expect(only.testIntegrity.signals.every((s) => String(s.severity) === "info")).toBe(true);
    expect(only.testIntegrity.verdict).toBe("pass");
  });
});
