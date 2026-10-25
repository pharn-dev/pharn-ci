import { describe, expect, it } from "vitest";

// The core entry point is loaded inside each test body: these tests are written before the test-source selection
// and its caps exist, so nothing that depends on them may run while the file loads.

type Status = "added" | "modified" | "renamed" | "deleted";
interface Entry {
  path: string;
  oldPath: string;
  status: Status;
  addedLines: number[];
}
type Select = (diff: readonly Entry[]) => { base: string[]; head: string[] };

/** A diff entry as the parser builds it: a deleted entry has `path === oldPath`, a rename sets `oldPath`. */
const entry = (status: Status, path: string, oldPath: string = path): Entry => ({
  path,
  oldPath,
  status,
  addedLines: [],
});

async function loadSelect(): Promise<Select> {
  const core = (await import("../src/index.js")) as unknown as { selectTestSourcePaths: Select };
  return core.selectTestSourcePaths;
}

const isDistinct = (list: string[]) => new Set(list).size === list.length;

describe("test sources: the per-side path selection", () => {
  it("AC-1: selects test and test-config paths per side, distinct and in code-unit order, whatever the entry order", async () => {
    const selectTestSourcePaths = await loadSelect();
    const diff: Entry[] = [
      entry("added", "src/a.test.ts"),
      entry("modified", "vitest.config.ts"),
      entry("deleted", "tests/test_x.py"),
      entry("renamed", "src/new.spec.ts", "src/old.spec.ts"),
      entry("renamed", "src/foo.ts", "src/foo.test.ts"),
      entry("modified", "packages/x/package.json"),
      entry("modified", "pkg/conftest.py"),
      entry("modified", ".mocharc.yml"),
      entry("modified", "pyproject.toml"),
      entry("added", "e2e/playwright.config.ts"),
      entry("modified", "src/index.ts"),
      entry("modified", "docs/vitest.md"),
      entry("modified", "Vitest.config.ts"),
      entry("modified", "mypackage.json"),
      entry("modified", ".github/workflows/ci.yml"),
    ];
    const expectedBase = [
      ".mocharc.yml",
      "packages/x/package.json",
      "pkg/conftest.py",
      "pyproject.toml",
      "src/foo.test.ts",
      "src/old.spec.ts",
      "tests/test_x.py",
      "vitest.config.ts",
    ];
    const expectedHead = [
      ".mocharc.yml",
      "e2e/playwright.config.ts",
      "packages/x/package.json",
      "pkg/conftest.py",
      "pyproject.toml",
      "src/a.test.ts",
      "src/new.spec.ts",
      "vitest.config.ts",
    ];

    const forward = selectTestSourcePaths(diff);
    const reversed = selectTestSourcePaths([...diff].reverse());

    for (const [label, result] of [
      ["entries in order", forward],
      ["entries reversed", reversed],
    ] as const) {
      expect(result.base, `${label}: base`).toEqual(expectedBase);
      expect(result.head, `${label}: head`).toEqual(expectedHead);
      expect(isDistinct(result.base), `${label}: base distinct`).toBe(true);
      expect(isDistinct(result.head), `${label}: head distinct`).toBe(true);
    }
    expect(reversed).toEqual(forward);
  });

  it("AC-2: matches every test-config name by basename at any depth and none of the near-miss controls", async () => {
    const selectTestSourcePaths = await loadSelect();
    const selected = [
      "a/jest.config.js",
      "jest.config.mjs",
      "vitest.workspace.ts",
      ".mocharc",
      ".mocharc.json",
      "pytest.ini",
      "setup.cfg",
      "tox.ini",
      "cmd/x_test.go",
      "conftest.py",
    ];
    const controls = ["jest.config", "my-pytest.ini", "setup.cfg.bak", "conftest.pyc"];

    const result = selectTestSourcePaths([...selected, ...controls].map((path) => entry("modified", path)));

    for (const path of selected) {
      expect(result.base, `base side: ${path}`).toContain(path);
      expect(result.head, `head side: ${path}`).toContain(path);
    }
    for (const path of controls) {
      expect(result.base, `base side: control ${path}`).not.toContain(path);
      expect(result.head, `head side: control ${path}`).not.toContain(path);
    }
  });
});

describe("test sources: the caps", () => {
  it("AC-3: the core entry point exports the three caps with their fixed values", async () => {
    const core = (await import("../src/index.js")) as unknown as Record<string, unknown>;
    expect(core.MAX_TEST_SOURCE_FILES).toBe(200);
    expect(core.MAX_TEST_SOURCE_FILE_BYTES).toBe(524288);
    expect(core.MAX_TEST_SOURCE_TOTAL_BYTES).toBe(16777216);
  });
});
