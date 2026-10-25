import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixture are loaded inside the test body: the AC test is written before TI12 and
// fixtures/test-integrity/TI12/ exist, so nothing that depends on them may run while the file loads. The fixture is
// written by the build, so the test first checks, through the existing JS/TS test index, that the head adds the
// hostile specifier inside a test whose name holds SECRET-TEST-NAME, then reads the detail code unit by code unit.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";
const SOURCE = "src/cart.ts";
const GRIN = "\u{1F600}";
/** `./`, U+0001, `a`, 60 copies of U+1F600 and `/../cart`. */
const SPECIFIER = `./\u0001a${GRIN.repeat(60)}/../cart`;
const SECRET = "SECRET-TEST-NAME";

interface SourceFile {
  path: string;
  text: string;
}
interface Case {
  diff: string;
  base: SourceFile[];
  head: SourceFile[];
}
interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Mock {
  callee: string;
  specifier: string | null;
  line: number;
}
interface Block {
  kind: string;
  name: string;
  path: string[];
  line: number;
  endLine: number;
}
interface Report {
  testIntegrity: { signals: Signal[] };
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

const diffPaths = (diff: string) => [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1] as string);

async function indexOf(file: SourceFile | undefined): Promise<{ tests: Block[]; mocks: Mock[] }> {
  if (file === undefined) throw new Error("the fixture file is missing");
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; tests?: Block[]; mocks?: Mock[] };
  };
  const result = core.indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${file.path} does not parse: ${JSON.stringify(result)}`);
  return { tests: result.tests ?? [], mocks: result.mocks ?? [] };
}

/** True when every surrogate code unit of `text` is half of a well-formed pair. */
function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

describe("TI12: a hostile mock specifier is sanitized and cut before it reaches the detail", () => {
  it("AC-12: the one TI12 detail holds src/cart.ts, no control character, ./ a then exactly 57 U+1F600 then …, no lone surrogate, no test name, and at most 300 code units", async () => {
    const root = `${FIXTURES}test-integrity/TI12/warn-hostile-specifier/`;
    const c: Case = {
      diff: readFileSync(`${root}change.diff`, "utf8"),
      base: sideFiles(`${root}base`),
      head: sideFiles(`${root}head`),
    };
    for (const path of [PATH, SOURCE]) {
      expect(c.diff).toContain(`--- a/${path}`);
      expect(c.diff).toContain(`+++ b/${path}`);
    }
    const base = await indexOf(c.base.find((f) => f.path === PATH));
    const head = await indexOf(c.head.find((f) => f.path === PATH));
    expect(
      base.mocks.filter((m) => m.specifier === SPECIFIER),
      "not at base",
    ).toEqual([]);
    const hostile = head.mocks.filter((m) => m.callee === "vi.mock" && m.specifier === SPECIFIER);
    expect(hostile, "the hostile vi.mock at head").toHaveLength(1);
    const line = (hostile[0] as Mock).line;
    const holder = head.tests.filter((t) => t.kind === "test" && t.line <= line && line <= t.endLine);
    expect(holder.length, "the mock sits inside a test").toBeGreaterThan(0);
    expect(
      holder.some((t) => t.name.includes(SECRET)),
      `inside a test whose name holds ${SECRET}`,
    ).toBe(true);

    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: c.diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [...new Set([...c.head.map((f) => f.path), ...diffPaths(c.diff)])].sort(),
      testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]);
    expectValidReport(report);

    const ti12 = (report as unknown as Report).testIntegrity.signals.filter((s) => String(s.id) === "TI12");
    expect(ti12).toHaveLength(1);
    const detail = (ti12[0] as Signal).detail;
    expect(detail).toContain(SOURCE);
    for (let i = 0; i < detail.length; i++) {
      expect(detail.charCodeAt(i), `code unit ${i} is not below U+0020`).toBeGreaterThanOrEqual(0x20);
    }
    const at = detail.indexOf("./ a");
    expect(at, "the sanitized specifier starts ./ a").toBeGreaterThan(-1);
    let i = at + "./ a".length;
    let grins = 0;
    while (detail.startsWith(GRIN, i)) {
      grins++;
      i += GRIN.length;
    }
    expect(grins, "exactly 57 copies of U+1F600").toBe(57);
    expect(detail[i], "then the ellipsis").toBe("…");
    expect(wellFormed(detail), "no lone surrogate").toBe(true);
    expect(detail).not.toContain(SECRET);
    expect(detail.length, "at most 300 UTF-16 code units").toBeLessThanOrEqual(300);
  });
});
