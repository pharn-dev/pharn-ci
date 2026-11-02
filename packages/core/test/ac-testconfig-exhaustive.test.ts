import { describe, expect, it } from "vitest";
import { readTestConfig } from "../src/testConfig/read.js";
import { evaluateRules } from "../src/testConfig/rules.js";
import type { ConfigValue } from "../src/testConfig/value.js";

// The switches over TestConfigKind are exhaustive: a kind the code does not know fails loudly instead of being read
// as a plain object (read.ts) or judged by the pytest rules (rules.ts). TypeScript stops a new kind at compile time;
// these pin what happens if one arrives anyway (an unchecked cast).
const UNKNOWN = "not-a-kind" as never;
const EMPTY: ConfigValue = { type: "object", entries: new Map(), open: false, extras: [] };

describe("test config kinds: the switches are exhaustive", () => {
  it("readTestConfig throws for an unknown kind, naming it, instead of reading the root as the container", () => {
    expect(() => readTestConfig(UNKNOWN, "unknown.config.json", "{}")).toThrow("unknown test config kind: not-a-kind");
  });

  it("evaluateRules throws for an unknown kind, naming it, instead of judging it by the pytest rules", () => {
    expect(() => evaluateRules(UNKNOWN, null, EMPTY, "block")).toThrow("unknown test config kind: not-a-kind");
  });

  it("a known kind still reads and judges as before", () => {
    expect(readTestConfig("vitest", "vitest.config.json", '{"test":{}}')).toHaveProperty("container");
    expect(evaluateRules("pytest-ini", null, EMPTY, "block")).toEqual([]);
  });
});
