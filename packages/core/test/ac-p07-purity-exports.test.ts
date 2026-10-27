import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { purityViolations } from "./purity-check.js";

// E3 item 24 (P07), AC-22. The two new modules are read as text and core's index is loaded inside the test body: the
// AC test is written before the build adds them, so nothing the build adds may run while this file loads.

const SRC = new URL("../src/", import.meta.url);
const MODULES = ["setup/instructions.ts", "policy/rules/p07.ts"];

describe("the new P07 core modules are pure and exported", { timeout: 60_000 }, () => {
  it("AC-22: setup/instructions.ts and policy/rules/p07.ts pass the purity check, and the core index exports INSTRUCTION_KINDS, instructionScope, agentInstructionPaths, instructionDeclarations and consistencySeverity", async () => {
    for (const module of MODULES) {
      const text = readFileSync(new URL(module, SRC), "utf8");
      expect(text.length, module).toBeGreaterThan(0);
      expect(purityViolations(text), module).toEqual([]);
    }

    const core = (await import("../src/index.js")) as unknown as Record<string, unknown>;
    expect(Array.isArray(core.INSTRUCTION_KINDS), "INSTRUCTION_KINDS").toBe(true);
    for (const name of [
      "instructionScope",
      "agentInstructionPaths",
      "instructionDeclarations",
      "consistencySeverity",
    ]) {
      expect(typeof core[name], name).toBe("function");
    }
  });
});
