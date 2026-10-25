import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: these tests are written before CheckInput has `testIntegrityMode`, so
// nothing that depends on it may run while the file loads. The input is cast for the same reason.

type Mode = "block" | "warn" | "off";
type Setting = { input?: Mode; config?: Mode };
type Source = "input" | "config" | "default";

async function run(testIntegrityMode?: Setting) {
  const { check } = await import("../src/check.js");
  return check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    ...(testIntegrityMode === undefined ? {} : { testIntegrityMode }),
  } as never);
}

const withCode = (report: Awaited<ReturnType<typeof run>>, code: string) =>
  report.messages.filter((m) => (m.code as string) === code);

describe("test-integrity mode precedence through check()", () => {
  it("AC-1: with no input and no config the mode is warn from the default and no mode message is added", async () => {
    for (const setting of [undefined, {}] as const) {
      const report = await run(setting);
      expectValidReport(report);
      expect(report.testIntegrity.mode).toBe("warn");
      expect(report.testIntegrity.source).toBe("default");
      expect(withCode(report, "TEST_INTEGRITY_OFF")).toEqual([]);
      expect(withCode(report, "TEST_INTEGRITY_MODE_IGNORED")).toEqual([]);
    }

    // The source is "default" only when nothing was given: naming the default mode as the input is source "input".
    const named = await run({ input: "warn" });
    expectValidReport(named);
    expect(named.testIntegrity.mode).toBe("warn");
    expect(named.testIntegrity.source).toBe("input");
  });

  it("AC-2: the input wins over the default and over a looser config, and a loosening config is reported", async () => {
    const plain = await run({ input: "block" });
    expectValidReport(plain);
    expect(plain.testIntegrity.mode).toBe("block");
    expect(plain.testIntegrity.source).toBe("input");
    expect(withCode(plain, "TEST_INTEGRITY_MODE_IGNORED")).toEqual([]);

    const loosened = await run({ input: "block", config: "warn" });
    expectValidReport(loosened);
    expect(loosened.testIntegrity.mode).toBe("block");
    expect(loosened.testIntegrity.source).toBe("input");
    const ignored = withCode(loosened, "TEST_INTEGRITY_MODE_IGNORED");
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.level).toBe("warn");
    expect(ignored[0]?.text).toContain("warn");
    expect(ignored[0]?.text).toContain("block");
  });

  it("AC-3: a stricter config raises the default and a warn input to block, with source config", async () => {
    for (const setting of [{ config: "block" }, { input: "warn", config: "block" }] as const) {
      const report = await run(setting);
      expectValidReport(report);
      expect(report.testIntegrity.mode, JSON.stringify(setting)).toBe("block");
      expect(report.testIntegrity.source, JSON.stringify(setting)).toBe("config");
      expect(withCode(report, "TEST_INTEGRITY_MODE_IGNORED"), JSON.stringify(setting)).toEqual([]);
    }
  });

  it("AC-4: a config looser than the base is ignored with exactly one message; an equal one adds none", async () => {
    const cases: Array<[Setting, Mode, Source, number]> = [
      [{ config: "off" }, "warn", "default", 1],
      [{ config: "warn" }, "warn", "default", 0],
      [{ input: "warn", config: "off" }, "warn", "input", 1],
      [{ input: "block", config: "off" }, "block", "input", 1],
      [{ input: "block", config: "warn" }, "block", "input", 1],
      [{ input: "warn", config: "warn" }, "warn", "input", 0],
      [{ input: "block", config: "block" }, "block", "input", 0],
    ];
    for (const [setting, mode, source, ignoredCount] of cases) {
      const label = JSON.stringify(setting);
      const report = await run(setting);
      expectValidReport(report);
      expect(report.testIntegrity.mode, label).toBe(mode);
      expect(report.testIntegrity.source, label).toBe(source);
      const ignored = withCode(report, "TEST_INTEGRITY_MODE_IGNORED");
      expect(ignored, label).toHaveLength(ignoredCount);
      for (const message of ignored) expect(message.level, label).toBe("warn");
    }
  });

  it("AC-5: an effective mode of off adds one info message and leaves the verdict of the block at pass", async () => {
    for (const setting of [{ input: "off" }, { input: "off", config: "off" }] as const) {
      const report = await run(setting);
      expectValidReport(report);
      expect(report.testIntegrity.mode, JSON.stringify(setting)).toBe("off");
      expect(report.testIntegrity.source, JSON.stringify(setting)).toBe("input");
      expect(report.testIntegrity.verdict, JSON.stringify(setting)).toBe("pass");
      const off = withCode(report, "TEST_INTEGRITY_OFF");
      expect(off, JSON.stringify(setting)).toHaveLength(1);
      expect(off[0]?.level).toBe("info");
    }

    const raised = await run({ input: "off", config: "block" });
    expectValidReport(raised);
    expect(raised.testIntegrity.mode).toBe("block");
    expect(raised.testIntegrity.source).toBe("config");
    expect(withCode(raised, "TEST_INTEGRITY_OFF")).toEqual([]);
  });
});
