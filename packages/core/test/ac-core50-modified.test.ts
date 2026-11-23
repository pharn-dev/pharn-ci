import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-50 (binary-diff-not-blind). check() and acceptTestIntegrity() are loaded inside each test body: the AC tests are
// written before a modified test file that git shows as binary is named as made unreadable, so nothing the build changes
// may run while the file loads. A case directory holds change.diff and, optionally, base/ and head/ with `<path>.txt`
// (a test source text) and `<path>.dropped` (a drop reason), read inside the test bodies. Each test first checks the
// diff lines the acceptance criterion names.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const ACCEPT = { label: "pharn/accepted", by: "Reviewer-1" };

interface Message {
  code: string;
  level: string;
  text: string;
}
interface Report {
  verdict: string;
  messages: Message[];
}
interface SourceFile {
  path: string;
  text: string;
}
interface Side {
  files: SourceFile[];
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
  const dir = `${FIXTURES}test-integrity/index-unavailable/${name}`;
  const diff = readFileSync(join(dir, "change.diff"), "utf8");
  const base = readSide(join(dir, "base"));
  const head = readSide(join(dir, "head"));
  const empty: Side = { files: [], dropped: [] };
  return { diff, sources: base === null && head === null ? undefined : { base: base ?? empty, head: head ?? empty } };
}

async function run(diff: string, mode: "block" | "warn" | "off", extra: Record<string, unknown> = {}): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["src/b.test.ts", "src/cart.test.ts", "src/cart.ts", "tests/test_cart.py"],
    testIntegrityMode: { input: mode },
    ...extra,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const unavailable = (report: Report) => report.messages.filter((m) => m.code === CODE);

/** The one TEST_INTEGRITY_INDEX_UNAVAILABLE message of a report. */
function one(report: Report, name: string): Message {
  const messages = unavailable(report);
  expect(messages, `${name}: one ${CODE} message`).toHaveLength(1);
  return messages[0] as Message;
}

/** A plain-data Python index for the `.py` files of each side: one test per `def test_…` line. */
function pythonIndex(sources: Sources) {
  const side = (s: Side) =>
    s.files
      .filter((file) => file.path.endsWith(".py"))
      .map((file) => {
        const lines = file.text.split("\n");
        const tests = lines.flatMap((text, i) => {
          const def = /^def (test_\w+)\(/.exec(text);
          if (!def) return [];
          const name = def[1] as string;
          return [
            {
              kind: "test",
              name,
              nameDynamic: false,
              path: [name],
              line: i + 1,
              endLine: i + 2,
              modifiers: [],
              body: (lines[i + 1] ?? "").trim(),
              bodyHash: "0badc0de",
              assertionCount: 1,
              assertions: [
                { chain: "assert", line: i + 2, awaited: false, inTryCatch: false, afterEarlyReturn: false },
              ],
              guards: [],
            },
          ];
        });
        return { path: file.path, result: { parsed: true, syntaxErrors: 0, tests, mocks: [] } };
      });
  return { available: true, base: side(sources.base), head: side(sources.head) };
}

describe("CORE-50: a modified test file that git shows as binary is a change made unreadable", () => {
  it("AC-5: a binary src/cart.test.ts, with base and head texts that index and with no sources for it, gives a TEST_INTEGRITY_INDEX_UNAVAILABLE error naming it with `binary`, and the verdict fail", async () => {
    const { diff, sources } = loadCase("binary-modified");
    expect(diff.split("\n")).toContain("index 1111111..2222222 100644");
    expect(diff.split("\n")).toContain("Binary files a/src/cart.test.ts and b/src/cart.test.ts differ");
    expect(sources?.base.files.map((f) => f.path)).toContain("src/cart.test.ts");
    expect(sources?.head.files.map((f) => f.path)).toContain("src/cart.test.ts");

    const empty = { files: [], dropped: [] };
    const runs = [
      ["base and head texts that index", { testSources: sources }],
      ["no test sources given", {}],
      ["test sources without the file on either side", { testSources: { base: empty, head: empty } }],
    ] as const;
    for (const [name, extra] of runs) {
      const report = await run(diff, "block", extra);
      const message = one(report, name);
      expect(message.level, `${name}: an error`).toBe("error");
      expect(message.text, `${name}: names the file with the reason binary`).toContain("`src/cart.test.ts` (`binary`)");
      expect(report.verdict, `${name}: fail`).toBe("fail");
    }
  });

  it("AC-6: the AC-5 change is a warning in mode warn, absent in mode off, and lowered to a warning by the accept label", async () => {
    const { acceptTestIntegrity } = await import("../src/acceptLabel.js");
    const { diff, sources } = loadCase("binary-modified");

    const warn = await run(diff, "warn", { testSources: sources });
    const warned = one(warn, "warn");
    expect(warned.level).toBe("warn");
    expect(warned.text).toContain("`src/cart.test.ts` (`binary`)");
    expect(warn.verdict).not.toBe("fail");

    const off = await run(diff, "off", { testSources: sources });
    expect(unavailable(off), `no ${CODE} in mode off`).toEqual([]);

    const block = await run(diff, "block", { testSources: sources });
    expect(one(block, "block before acceptance").level).toBe("error");
    const accepted = acceptTestIntegrity(structuredClone(block) as never, ACCEPT) as unknown as Report;
    expectValidReport(accepted);
    expect(one(accepted, "after acceptance").level).toBe("warn");
    expect(
      accepted.messages.filter((m) => m.code === "TEST_INTEGRITY_ACCEPTED"),
      "TEST_INTEGRITY_ACCEPTED",
    ).toHaveLength(1);
    expect(accepted.verdict).not.toBe("fail");
  });

  it("AC-7: a binary tests/test_cart.py (with the Python index) and a binary rename of src/a.test.ts to src/b.test.ts each give an error naming the head path with `binary`", async () => {
    const python = loadCase("binary-modified-python");
    expect(python.diff.split("\n")).toContain("Binary files a/tests/test_cart.py and b/tests/test_cart.py differ");
    expect(python.sources, "the Python case has base and head texts").toBeDefined();
    const pyReport = await run(python.diff, "block", {
      testSources: python.sources,
      pythonTestIndex: pythonIndex(python.sources as Sources),
    });
    const pyMessage = one(pyReport, "Python");
    expect(pyMessage.level).toBe("error");
    expect(pyMessage.text).toContain("`tests/test_cart.py` (`binary`)");

    const renamed = loadCase("binary-renamed");
    const lines = renamed.diff.split("\n");
    expect(lines).toContain("rename from src/a.test.ts");
    expect(lines).toContain("rename to src/b.test.ts");
    expect(lines).toContain("Binary files a/src/a.test.ts and b/src/b.test.ts differ");
    const renamedReport = await run(renamed.diff, "block", { testSources: renamed.sources });
    const renamedMessage = one(renamedReport, "renamed");
    expect(renamedMessage.level).toBe("error");
    expect(renamedMessage.text).toContain("`src/b.test.ts` (`binary`)");
  });
});
