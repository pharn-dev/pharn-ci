import { describe, expect, it, vi } from "vitest";

// indexTestFile is loaded inside the test body: the AC test is written before the build moves the parse-diagnostics
// invariant out of the parser's catch, so nothing the build changes may run while the file loads. typescript5 is
// mocked with the real module, except that while armed createSourceFile returns its real source file with
// parseDiagnostics hidden (not an array), as a TypeScript build that stopped exposing it would.

const fault = vi.hoisted(() => ({ armed: false, calls: 0 }));

vi.mock("typescript5", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown> & { default: Record<string, unknown> }>();
  const realTs = real.default as Record<string, unknown> & { createSourceFile: (...args: unknown[]) => object };
  const createSourceFile = (...args: unknown[]) => {
    const sourceFile = realTs.createSourceFile(...args);
    if (!fault.armed) return sourceFile;
    fault.calls++;
    return new Proxy(sourceFile, {
      get: (target, key, receiver) => (key === "parseDiagnostics" ? undefined : Reflect.get(target, key, receiver)),
      has: (target, key) => (key === "parseDiagnostics" ? false : Reflect.has(target, key)),
    });
  };
  return { ...real, createSourceFile, default: { ...realTs, createSourceFile } };
});

const TEXT = 'import { expect, it } from "vitest";\n\nit("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n';

describe("indexTestFile: a broken parse-diagnostics invariant", () => {
  it("AC-5: when the TypeScript build exposes no parseDiagnostics array, indexing a test file throws and is never reported as parser-threw", async () => {
    const { indexTestFile } = (await import("@pharn-ci/core")) as unknown as {
      indexTestFile: (path: string, text: string) => unknown;
    };

    let result: unknown;
    let thrown: unknown = null;
    fault.armed = true;
    fault.calls = 0;
    try {
      result = indexTestFile("src/a.test.ts", TEXT);
    } catch (error) {
      thrown = error;
    } finally {
      fault.armed = false;
    }

    expect(fault.calls, "the parser was called through indexTestFile").toBeGreaterThan(0);
    expect(result, "not reported as parser-threw").not.toStrictEqual({ parsed: false, reason: "parser-threw" });
    expect(result, "no result was returned").toBeUndefined();
    expect(thrown, "indexing threw").toBeInstanceOf(Error);
  }, 60_000);
});
