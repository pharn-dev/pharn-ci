import { describe, expect, it, vi } from "vitest";
import { fixture } from "./helpers.js";

// check() is loaded inside the test body: the AC test is written before the build narrows the test index's catch,
// so nothing the build changes may run while the file loads. The fault is injected into our own test-file walk
// (testIndex/walk.ts): the mock keeps the real module and makes walkTestFile throw one TypeError while it is armed.

const fault = vi.hoisted(() => ({
  armed: false,
  calls: 0,
  error: new TypeError("AC-1 injected fault in walkTestFile"),
}));

vi.mock("../src/testIndex/walk.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/testIndex/walk.ts")>();
  return {
    ...real,
    walkTestFile: (...args: Parameters<typeof real.walkTestFile>) => {
      if (fault.armed) {
        fault.calls++;
        throw fault.error;
      }
      return real.walkTestFile(...args);
    },
  };
});

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/a.test.ts";

const BASE = 'import { expect, it } from "vitest";\n\nit("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n';
const HEAD = `${BASE}\nit("subtracts", () => {\n  expect(2 - 1).toBe(1);\n});\n`;

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

describe("check(): an exception from our own test-file walk", () => {
  it("AC-1: a TypeError thrown by walkTestFile for a modified test file escapes check() in mode block, and no report is returned", async () => {
    const { check } = await import("@pharn-ci/core");
    const input = {
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diffOf(PATH, BASE, HEAD) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: ["src/cart.ts", PATH],
      testIntegrityMode: { input: "block" },
      testSources: {
        base: { files: [{ path: PATH, text: BASE }], dropped: [] },
        head: { files: [{ path: PATH, text: HEAD }], dropped: [] },
      },
    } as unknown as Parameters<typeof check>[0];

    let report: unknown;
    let thrown: unknown = null;
    fault.armed = true;
    fault.calls = 0;
    try {
      report = check(input);
    } catch (error) {
      thrown = error;
    } finally {
      fault.armed = false;
    }

    expect(fault.calls, "the injected fault was reached through check()").toBeGreaterThan(0);
    expect(report, "check() returned no report").toBeUndefined();
    expect(thrown, "check() threw the walk's own TypeError").toBe(fault.error);
    expect(thrown).toBeInstanceOf(TypeError);
  }, 60_000);
});
