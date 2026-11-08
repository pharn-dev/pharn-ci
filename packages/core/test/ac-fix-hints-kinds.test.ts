import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// fix-hints (H6), AC-1. The core's fix table is loaded inside the test body: the AC test is written before the build
// adds it, so nothing the build adds may run while this file loads. The schema is read in the body too.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const KINDS = [
  "add-test",
  "restore-test",
  "restore-assertion",
  "revert-config",
  "remove-dependency",
  "request-review",
  "split-pr",
  "none",
];

describe("fix hints: the closed list of kinds", () => {
  it("AC-1: the core's FIX_KINDS and the schema's fix.kind enum are exactly the eight kinds, in order", async () => {
    const core = (await import("../src/index.js")) as unknown as { FIX_KINDS?: readonly string[] };
    expect(Array.isArray(core.FIX_KINDS), "FIX_KINDS is exported as a list").toBe(true);
    expect([...(core.FIX_KINDS ?? [])]).toEqual(KINDS);

    const schema = JSON.parse(read("schema/report.v2.json")) as {
      $defs: Record<string, { properties?: { kind?: { enum?: unknown } } }>;
    };
    expect(schema.$defs.fix, "schema/report.v2.json has $defs.fix").toBeDefined();
    expect(schema.$defs.fix?.properties?.kind?.enum).toEqual(KINDS);
  });
});
