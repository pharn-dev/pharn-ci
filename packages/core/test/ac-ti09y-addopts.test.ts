import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The controls run in the same test as the cases that trigger.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "pytest.ini";

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

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

/** check() in mode block over a modified pytest.ini with this base and head text; its TI09 signals. */
async function run(base: string, head: string): Promise<Signal[]> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(PATH, base, head) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", PATH],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path: PATH, text: base }], dropped: [] },
      head: { files: [{ path: PATH, text: head }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report as unknown as Report).testIntegrity.signals.filter((s) => String(s.id) === "TI09");
}

/** A pytest.ini whose [pytest] section has this addopts value. */
const ini = (addopts: string) => `[pytest]\naddopts = ${addopts}\ntestpaths = tests\n`;

describe("TI09: pytest addopts deselection", () => {
  it("AC-12: -k and --deselect, -xvs, a longer -m expression and --maxfail with --lf each give their block TI09, and -p no:cacheprovider, -v and a reorder give none", async () => {
    const first = await run(ini("-ra"), ini('-ra -k "not slow" --deselect tests/test_x.py::test_y'));
    expect(first, "-k and --deselect: two TI09 signals").toHaveLength(2);
    expect(first.every((s) => s.severity === "block" && s.path === PATH)).toBe(true);
    const details = first.map((s) => s.detail);
    expect(details, "the -k detail").toContain('addopts gains -k "not slow".');
    expect(
      details.some((d) => d.includes("--deselect")),
      "a detail names --deselect",
    ).toBe(true);

    const exitfirst = await run(ini("-v"), ini("-xvs"));
    expect(exitfirst, "-v → -xvs: one TI09 signal").toHaveLength(1);
    expect(exitfirst[0]?.severity).toBe("block");
    expect(exitfirst[0]?.detail, "the exitfirst detail").toMatch(/-x\b|--exitfirst/);

    const marker = await run(ini('-m "not slow"'), ini('-m "not slow and not db"'));
    expect(marker, "a longer -m expression: one TI09 signal").toHaveLength(1);
    expect(marker[0]?.severity).toBe("block");
    expect(marker[0]?.detail).toContain("-m");

    const maxfail = await run(ini("-q"), ini("-q --maxfail=1 --lf"));
    expect(maxfail, "--maxfail=1 --lf: two TI09 signals").toHaveLength(2);
    expect(maxfail.every((s) => s.severity === "block")).toBe(true);
    expect(maxfail.some((s) => s.detail.includes("--maxfail"))).toBe(true);
    expect(maxfail.some((s) => s.detail.includes("--lf"))).toBe(true);

    for (const [base, head] of [
      ["-q", "-q -p no:cacheprovider"],
      ["-q", "-q -v"],
      ["-q --tb=short", "--tb=short -q"],
    ] as const) {
      expect(await run(ini(base), ini(head)), `${base} → ${head}: no TI09 signal`).toEqual([]);
    }
  });
});
