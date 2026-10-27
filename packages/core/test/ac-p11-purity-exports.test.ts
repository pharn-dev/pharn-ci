import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { purityViolations } from "./purity-check.js";

// E3 item 24a part B (P11), AC-24. The two new modules are read as text and core's index is loaded inside the test
// body: the AC test is written before the build adds them, so nothing the build adds may run while this file loads.

const SRC = new URL("../src/", import.meta.url);
const MODULES = ["policy/agents.ts", "policy/rules/p11.ts"];

describe("the new core modules are pure and exported", { timeout: 60_000 }, () => {
  it("AC-24: policy/agents.ts and policy/rules/p11.ts pass the purity check, and the core index exports agentPolicyOf with the AgentPolicy and PolicyFileBase types", async () => {
    for (const module of MODULES) {
      const text = readFileSync(new URL(module, SRC), "utf8");
      expect(text.length, module).toBeGreaterThan(0);
      expect(purityViolations(text), module).toEqual([]);
    }

    const core = (await import("../src/index.js")) as unknown as Record<string, unknown>;
    expect(typeof core.agentPolicyOf).toBe("function");

    // Types leave no trace at run time; the index's export statement for the agent-policy module names them.
    const index = readFileSync(new URL("index.ts", SRC), "utf8");
    const exported = [...index.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']\.\/policy\/agents\.js["']/g)]
      .map((m) => m[1] as string)
      .join(",");
    const names = exported
      .split(",")
      .map((s) => s.trim().replace(/^type\s+/, ""))
      .filter((s) => s.length > 0);
    for (const name of ["agentPolicyOf", "AgentPolicy", "PolicyFileBase"]) expect(names, name).toContain(name);
  });
});
