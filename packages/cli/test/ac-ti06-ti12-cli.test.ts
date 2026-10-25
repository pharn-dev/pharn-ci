import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// main() and nodeDeps() are loaded inside the test body: the AC test is written before check() runs TI06 and TI12, so
// nothing that depends on them may run while the file loads. The repository is a real temporary git repository; the
// head commit edits src/cart.ts, loosens one toBe(5) in src/cart.test.ts to toBeTruthy() and adds vi.mock("./cart").

const SOURCE = "src/cart.ts";
const TEST = "src/cart.test.ts";

const SOURCE_BASE = "export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n";
const SOURCE_HEAD = "export const total = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0);\n";
const TEST_BASE = [
  'import { describe, expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'describe("cart", () => {',
  '  it("adds the prices", () => {',
  "    expect(total([2, 3])).toBe(5);",
  "  });",
  "",
  '  it("totals an empty cart", () => {',
  "    expect(total([])).toBe(0);",
  "  });",
  "});",
  "",
];
const TEST_HEAD = [
  'import { describe, expect, it, vi } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'vi.mock("./cart");',
  "",
  'describe("cart", () => {',
  '  it("adds the prices", () => {',
  "    expect(total([2, 3])).toBeTruthy();",
  "  });",
  "",
  '  it("totals an empty cart", () => {',
  "    expect(total([])).toBe(0);",
  "  });",
  "});",
  "",
];

let dir: string;
let baseId: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git and coverage tools report physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-ti0612-cli-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, SOURCE), SOURCE_BASE);
  writeFileSync(join(dir, TEST), TEST_BASE.join("\n"));
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  baseId = sh("rev-parse", "HEAD").trim();
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, SOURCE), SOURCE_HEAD);
  writeFileSync(join(dir, TEST), TEST_HEAD.join("\n"));
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  // The coverage file covers the one changed line of src/cart.ts.
  mkdirSync(join(dir, "coverage"));
  writeFileSync(join(dir, "coverage/lcov.info"), `SF:${dir}/${SOURCE}\nDA:1,1\nend_of_record\n`);
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

describe("pharn-ci check: TI06 and TI12 from base and head text", () => {
  it(`AC-16: --test-integrity block reports one warn TI06 and one warn TI12 for ${TEST}, a valid report, and exits 0`, async () => {
    const changed = execFileSync("git", ["diff", "--name-only", baseId, "HEAD"], { cwd: dir, encoding: "utf8" });
    expect(changed.trim().split("\n").sort(), "the head commit edits the source and the test").toEqual([TEST, SOURCE]);

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
    const report = JSON.parse(out) as { testIntegrity: { signals: Signal[] } };
    expectValidReport(report);

    const of = (id: string) => report.testIntegrity.signals.filter((s) => String(s.id) === id);
    const ti06 = of("TI06");
    const ti12 = of("TI12");
    expect(ti06).toHaveLength(1);
    expect(ti12).toHaveLength(1);
    for (const s of [...ti06, ...ti12]) {
      expect(s.path).toBe(TEST);
      expect(s.severity).toBe("warn");
    }
    expect(ti06[0]?.line).toBe(TEST_HEAD.indexOf('  it("adds the prices", () => {') + 1);
    expect(ti12[0]?.line).toBe(TEST_HEAD.indexOf('vi.mock("./cart");') + 1);
    expect(ti12[0]?.detail).toContain(SOURCE);
    expect(code).toBe(0);
  }, 60_000);
});
