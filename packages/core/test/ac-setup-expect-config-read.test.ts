import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// The config parser and the fixtures are loaded inside the test body: the AC tests are written before setup.expect
// and fixtures/setup-expect/ exist, so nothing that depends on them may run while the file loads.

type Config = { setup?: { expect?: unknown } };

describe("parseConfig: setup.expect", () => {
  it("AC-1: reads a block or flow list of agent tools trimmed, once each, in first-seen order, and an empty list as no expected tools", async () => {
    const { parseConfig } = await import("../src/config.js");
    const expected = ["claude-code", "cursor", "codex"];

    // The committed fixtures: a block list and a flow list, each with a duplicate and surrounding spaces.
    for (const name of ["setup-expect/ci-block.yml", "setup-expect/ci-flow.yml"]) {
      const config = parseConfig(fixture(name)) as Config;
      expect(config.setup?.expect, name).toEqual(expected);
    }

    // The same shapes written here, so the duplicate and the spaces are certainly in the input.
    const block = 'setup:\n  expect:\n    -   claude-code\n    - " cursor "\n    -  codex\n    - claude-code\n';
    const flow = 'setup:\n  expect: [claude-code, " cursor ",  codex , claude-code]\n';
    for (const [label, text] of [
      ["inline block list", block],
      ["inline flow list", flow],
    ] as const) {
      const config = parseConfig(text) as Config;
      expect(config.setup?.expect, label).toEqual(expected);
    }

    // An empty list means no expected tools.
    const empty = parseConfig(fixture("setup-expect/ci-empty.yml")) as Config;
    expect(empty.setup?.expect).toEqual([]);
    const inlineEmpty = parseConfig("setup:\n  expect: []\n") as Config;
    expect(inlineEmpty.setup?.expect).toEqual([]);
  });
});
