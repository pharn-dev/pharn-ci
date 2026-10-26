import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Skylos nine, part 2: every pytest case starts from one shared project. The base texts are written by the build, so
// they are read inside the test body; the expected shape is written here, never read from a fixture.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const CASES_DIR = `${FIXTURES}skylos-nine-pytest/`;

/** A text's lines, without the empty string after a trailing newline. */
function linesOf(text: string): string[] {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

describe("Skylos nine for pytest: the shared base project", () => {
  it('AC-2: every base tests/test_cart.py is the same 18-line file (import pytest first, the three tests, line 9 assert total([2, 3]) == 5) and every base pyproject.toml holds [tool.pytest.ini_options] and testpaths = ["tests"]', () => {
    const cases = readdirSync(CASES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(cases.length, "the case directories exist").toBeGreaterThan(0);

    const testTexts = new Map<string, string>();
    const configTexts = new Map<string, string>();
    for (const name of cases) {
      const test = `${CASES_DIR}${name}/base/tests/test_cart.py.txt`;
      const config = `${CASES_DIR}${name}/base/pyproject.toml.txt`;
      if (existsSync(test)) testTexts.set(name, readFileSync(test, "utf8"));
      if (existsSync(config)) configTexts.set(name, readFileSync(config, "utf8"));
    }
    expect(testTexts.size, "at least one case holds a base tests/test_cart.py").toBeGreaterThan(0);
    expect(configTexts.size, "at least one case holds a base pyproject.toml").toBeGreaterThan(0);

    const first = [...testTexts.values()][0] as string;
    for (const [name, text] of testTexts) {
      expect(text, `${name}: the same base tests/test_cart.py as every other case`).toBe(first);
      const lines = linesOf(text);
      expect(lines, `${name}: 18 lines`).toHaveLength(18);
      expect(lines[0], `${name}: line 1`).toBe("import pytest");
      for (const needle of [
        "from cart import total",
        "def test_adds_the_prices",
        "def test_totals_an_empty_cart",
        "assert total([]) == 0",
        "def test_rejects_a_negative_price",
        'pytest.raises(ValueError, match="negative price")',
      ]) {
        expect(text, `${name}: holds ${needle}`).toContain(needle);
      }
      expect(lines[8], `${name}: line 9`).toContain("assert total([2, 3]) == 5");
    }

    for (const [name, text] of configTexts) {
      const lines = linesOf(text).map((line) => line.trim());
      expect(lines, `${name}: [tool.pytest.ini_options]`).toContain("[tool.pytest.ini_options]");
      expect(lines, `${name}: testpaths = ["tests"]`).toContain('testpaths = ["tests"]');
    }
  });
});
