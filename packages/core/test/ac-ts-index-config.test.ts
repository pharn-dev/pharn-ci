import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// indexTestFile is loaded inside the test body: the AC tests are written before the test index exists, so nothing the
// build adds may run while the file loads. The config fixtures are written by the build, so the test also checks that
// each holds the shape AC-7 names.

async function indexTestFile(path: string, text: string): Promise<unknown> {
  const core = (await import("@pharn-ci/core")) as unknown as { indexTestFile: (p: unknown, t: unknown) => unknown };
  return core.indexTestFile(path, text);
}

/** Each config fixture and the forms AC-7 says it holds. */
const CONFIGS: [name: string, forms: RegExp[]][] = [
  ["vitest.config.ts", [/\bdefineConfig\(/, /\btest\s*:/]],
  ["vitest.config.mts", [/\bdefineConfig\(/, /\btest\s*:/]],
  ["jest.config.js", [/\bmodule\.exports\s*=/, /\btestMatch\s*:/, /\bcoverageThreshold\s*:/]],
  ["playwright.config.ts", [/\bdefineConfig\(/, /\bprojects\s*:/, /\bretries\s*:/]],
];

describe("indexTestFile on config files", () => {
  it.each(CONFIGS)("AC-7: %s parses with no tests and no mocks", async (name, forms) => {
    const text = fixture(`ts-index/config/${name}`);
    for (const form of forms) expect(form.test(text), `${name} holds ${form}`).toBe(true);
    expect(await indexTestFile(name, text)).toStrictEqual({ parsed: true, syntaxErrors: 0, tests: [], mocks: [] });
  });
});
