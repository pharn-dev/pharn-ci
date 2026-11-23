import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-50 (binary-diff-not-blind). check() is loaded inside each test body: the AC tests are written before TI01 counts
// a deleted or renamed-away test file that git shows as binary, so nothing the build changes may run while the file
// loads. The case fixtures are read inside the test bodies too, and each test first checks that its fixture holds the
// diff lines the acceptance criterion names (git's `Binary files … differ` line), so the input is pinned here.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DELETED = "Test file deleted; git shows it as binary, so its text was not read.";
const RENAMED = "Test file renamed away; git shows it as binary, so its text was not read.";

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
}
interface Report {
  verdict: string;
  messages: Message[];
  testIntegrity: { signals: Signal[] };
}

interface Entry {
  oldPath: string;
  path: string;
  lines: string[];
}

/** The entries of a unified diff, one per `diff --git a/… b/…` header, each with its lines. */
function entries(diff: string): Entry[] {
  const out: Entry[] = [];
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
    if (header) {
      out.push({ oldPath: header[1] as string, path: header[2] as string, lines: [line] });
      continue;
    }
    out.at(-1)?.lines.push(line);
  }
  return out;
}

const caseDiff = (name: string) => readFileSync(`${FIXTURES}test-integrity/TI01/${name}/change.diff`, "utf8");

async function run(diff: string, mode: "block" | "warn" | "off", repoFiles: string[]): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles,
    testIntegrityMode: { input: mode },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const ti01 = (report: Report) => report.testIntegrity.signals.filter((s) => s.id === "TI01");
const ti01Messages = (report: Report) => report.messages.filter((m) => m.code === "TEST_INTEGRITY_TI01");

describe("CORE-50: TI01 counts a deleted or renamed-away test file that git shows as binary", () => {
  it("AC-1: .gitattributes `*.test.ts -diff` plus a deleted binary src/cart.test.ts is one TI01 block (error, fail) in block, a warn in warn, and nothing in off", async () => {
    const diff = caseDiff("block-binary-gitattributes-deleted");
    const files = entries(diff);
    expect(
      files.map((e) => e.path),
      "the change touches .gitattributes and src/cart.test.ts only",
    ).toEqual(expect.arrayContaining([".gitattributes", "src/cart.test.ts"]));
    expect(files).toHaveLength(2);
    const attributes = files.find((e) => e.path === ".gitattributes") as Entry;
    expect(attributes.lines, ".gitattributes adds `*.test.ts -diff`").toContain("+*.test.ts -diff");
    const deleted = files.find((e) => e.path === "src/cart.test.ts") as Entry;
    expect(deleted.lines).toContain("deleted file mode 100644");
    expect(deleted.lines).toContain("Binary files a/src/cart.test.ts and /dev/null differ");
    expect(
      deleted.lines.filter((l) => l.startsWith("@@")),
      "the deleted file shows no hunk",
    ).toEqual([]);

    const repoFiles = [".gitattributes", "src/cart.ts"];

    const block = await run(diff, "block", repoFiles);
    expect(ti01(block)).toEqual([
      expect.objectContaining({ id: "TI01", severity: "block", path: "src/cart.test.ts", line: null, detail: DELETED }),
    ]);
    expect(
      ti01Messages(block).map((m) => m.level),
      "one TEST_INTEGRITY_TI01 error",
    ).toEqual(["error"]);
    expect(block.verdict).toBe("fail");

    const warn = await run(diff, "warn", repoFiles);
    expect(ti01(warn)).toEqual([
      expect.objectContaining({ id: "TI01", severity: "warn", path: "src/cart.test.ts", line: null, detail: DELETED }),
    ]);
    expect(
      ti01Messages(warn).map((m) => m.level),
      "one TEST_INTEGRITY_TI01 warning",
    ).toEqual(["warn"]);
    expect(warn.verdict).not.toBe("fail");

    const off = await run(diff, "off", repoFiles);
    expect(ti01(off), "no TI01 in mode off").toEqual([]);
    expect(ti01Messages(off), "no TEST_INTEGRITY_TI01 in mode off").toEqual([]);
  });

  it("AC-2: a deleted binary src/cart.spec.mjs, src/cart.test.cts, tests/test_cart.py and pkg/cart_test.go each give one TI01 block with the binary deleted detail", async () => {
    const cases = [
      ["block-binary-spec-mjs-deleted", "src/cart.spec.mjs", ["src/cart.mjs"]],
      ["block-binary-test-cts-deleted", "src/cart.test.cts", ["src/cart.cts"]],
      ["block-binary-py-deleted", "tests/test_cart.py", ["src/cart.py"]],
      ["block-binary-go-deleted", "pkg/cart_test.go", ["pkg/cart.go"]],
    ] as const;
    for (const [name, path, repoFiles] of cases) {
      const diff = caseDiff(name);
      const entry = entries(diff).find((e) => e.path === path);
      expect(entry, `${name}: an entry for ${path}`).toBeDefined();
      expect(entry?.lines, `${name}: deleted`).toContain("deleted file mode 100644");
      expect(entry?.lines, `${name}: git's binary line`).toContain(`Binary files a/${path} and /dev/null differ`);

      const report = await run(diff, "block", [...repoFiles]);
      const signals = ti01(report).filter((s) => s.path === path);
      expect(signals, `${name}: one TI01 for ${path}`).toHaveLength(1);
      expect(signals[0]?.severity, `${name}: block`).toBe("block");
      expect(signals[0]?.detail, `${name}: the binary deleted detail`).toBe(DELETED);
    }
  });

  it("AC-3: a binary rename of src/cart.test.ts to src/cart.ts.bak is one TI01 block at src/cart.test.ts with the binary renamed-away detail", async () => {
    const diff = caseDiff("block-binary-renamed-away");
    const entry = entries(diff).find((e) => e.oldPath === "src/cart.test.ts");
    expect(entry, "an entry renaming src/cart.test.ts").toBeDefined();
    const lines = entry?.lines ?? [];
    const similarity = lines.map((l) => /^similarity index (\d+)%$/.exec(l)).find((m) => m !== null);
    expect(similarity, "a similarity index line").toBeDefined();
    expect(Number(similarity?.[1]), "similarity below 100%").toBeLessThan(100);
    expect(lines).toContain("rename from src/cart.test.ts");
    expect(lines).toContain("rename to src/cart.ts.bak");
    expect(lines).toContain("Binary files a/src/cart.test.ts and b/src/cart.ts.bak differ");

    const report = await run(diff, "block", ["src/cart.ts", "src/cart.ts.bak"]);
    expect(ti01(report)).toEqual([
      expect.objectContaining({ id: "TI01", severity: "block", path: "src/cart.test.ts", detail: RENAMED }),
    ]);
  });

  // CORE-132: the comparison of the fixture with its bytes at an old commit was a history pin and is removed.
  it("AC-16: the fixture TI01/pass-binary.diff (a deleted binary tests/img.test.ts) gives one TI01 block with the binary deleted detail", async () => {
    const now = readFileSync(`${FIXTURES}test-integrity/TI01/pass-binary.diff`);

    const report = await run(now.toString("utf8"), "block", ["src/app.ts"]);
    expect(ti01(report)).toEqual([
      expect.objectContaining({ id: "TI01", severity: "block", path: "tests/img.test.ts", detail: DELETED }),
    ]);
  });
});
