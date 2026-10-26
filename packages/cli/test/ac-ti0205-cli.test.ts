import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// main() and nodeDeps() are loaded inside the test body: the AC test is written before the CLI runs the Python index
// and check() compares test files, so nothing that depends on that may run while the file loads. The repository is a
// real temporary git repository; the real python3 runs when it is on PATH.

const JS_PATH = "src/cart.test.ts";
const PY_PATH = "tests/test_cart.py";

const JS_BASE = [
  'import { describe, expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'describe("cart", () => {',
  '  it("adds the prices", () => {',
  "    expect(total([2, 3])).toBe(5);",
  "  });",
  "",
  '  it("rejects a negative price", () => {',
  '    expect(() => total([-1])).toThrow("negative price");',
  "  });",
  "",
  '  it("totals an empty cart", () => {',
  "    expect(total([])).toBe(0);",
  "    expect(total([0])).toBe(0);",
  "  });",
  "});",
  "",
];
/** One JS test removed, another emptied of its assertions. */
const JS_HEAD = [
  'import { describe, expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'describe("cart", () => {',
  '  it("adds the prices", () => {',
  "    expect(total([2, 3])).toBe(5);",
  "  });",
  "",
  '  it("totals an empty cart", () => {',
  "    total([]);",
  "  });",
  "});",
  "",
];
const PY_BASE = [
  "from cart import total",
  "",
  "",
  "def test_adds_prices():",
  "    assert total([2, 3]) == 5",
  "",
  "",
  "def test_empty_cart():",
  "    assert total([]) == 0",
  "",
];
/** One Python test removed. */
const PY_HEAD = PY_BASE.slice(0, 6);

/** The python3 on PATH and whether it is 3.8 or newer, decided once while the file loads (no build code runs). */
const PYTHON = (() => {
  const run = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 8), sys.version.split()[0])"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const [ok, version] = (run.stdout ?? "").trim().split(" ");
  return { ok: run.status === 0 && ok === "True", version: version ?? "", error: run.error?.message ?? "" };
})();

/** Fails the test, with the reason, when no python3 of 3.8 or newer is on PATH. */
function requirePython(): void {
  if (!PYTHON.ok) {
    throw new Error(
      `this test needs python3 3.8 or newer on PATH and found ${PYTHON.version === "" ? `none (${PYTHON.error || "python3 did not run"})` : `python3 ${PYTHON.version}`}`,
    );
  }
}

let dir: string;
let baseId: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-ti0205-cli-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "src/cart.ts"), "export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n");
  writeFileSync(join(dir, JS_PATH), JS_BASE.join("\n"));
  writeFileSync(join(dir, PY_PATH), PY_BASE.join("\n"));
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  baseId = sh("rev-parse", "HEAD").trim();
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, JS_PATH), JS_HEAD.join("\n"));
  writeFileSync(join(dir, PY_PATH), PY_HEAD.join("\n"));
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  mkdirSync(join(dir, "coverage"));
  writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/src/cart.ts\nDA:1,1\nend_of_record\n`);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}

describe("pharn-ci check: TI02 and TI05 from base and head text, with the Python index", () => {
  it(`AC-14: --test-integrity block reports TI02 and TI05 for ${JS_PATH}, a TI02 for ${PY_PATH} and languages ["py", "ts"], and exits 1`, async () => {
    requirePython();
    const { main } = await import("../src/main.js");
    const { nodeDeps } = await import("../src/nodeDeps.js");
    const deps = nodeDeps(dir) as unknown as { stdout(text: string): void; stderr(text: string): void };
    let out = "";
    deps.stdout = (text) => {
      out += text;
    };
    deps.stderr = () => {};

    const code = await main(
      ["check", "--format", "json", "--test-integrity", "block", "--base", baseId, "--coverage", "coverage/lcov.info"],
      deps as never,
    );
    const report = JSON.parse(out) as {
      testIntegrity: { signals: Signal[]; languages: string[] };
      messages: { code: string; level: string; text: string }[];
    };
    expectValidReport(report);

    const removedLine = JS_BASE.findIndex((l) => l.includes('it("rejects a negative price"')) + 1;
    const emptiedLine = JS_HEAD.findIndex((l) => l.includes('it("totals an empty cart"')) + 1;
    const signals = report.testIntegrity.signals.map((s) => ({ id: String(s.id), path: s.path, line: s.line }));
    expect(signals).toContainEqual({ id: "TI02", path: JS_PATH, line: removedLine });
    expect(signals).toContainEqual({ id: "TI05", path: JS_PATH, line: emptiedLine });
    const ti02 = report.testIntegrity.signals.find((s) => String(s.id) === "TI02" && s.path === JS_PATH);
    expect(ti02?.detail).toContain("cart › rejects a negative price");
    expect(ti02?.severity).toBe("block");

    const pyTi02 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI02" && s.path === PY_PATH);
    expect(pyTi02).toHaveLength(1);
    expect(pyTi02[0]?.detail).toContain("test_empty_cart");
    expect(report.testIntegrity.languages).toEqual(["py", "ts"]);
    expect(code).toBe(1);
  }, 60_000);
});
