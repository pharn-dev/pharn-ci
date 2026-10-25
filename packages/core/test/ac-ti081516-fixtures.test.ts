import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { FIXTURES, fixture } from "./helpers.js";

// The fixture directories are listed and check() is loaded inside the test body: the AC tests are written before the
// fixtures and the signals exist, so nothing missing may fail the file's load.

const j = (...parts: string[]) => parts.join("");

/** Each id's directory and the file-name prefix and severity of its must-trigger diffs. */
const DIRS: Array<[id: string, prefix: string, severity: string]> = [
  [j("TI", "08"), "warn-", "warn"],
  [j("TI", "15"), "warn-", "warn"],
  [j("TI", "16"), "info-", "info"],
];

describe("TI08, TI15 and TI16 fixtures", () => {
  it("AC-14: each directory holds at least three must-trigger and three pass- diffs under 1000 lines, and each behaves in mode block", async () => {
    for (const [id, prefix, severity] of DIRS) {
      const folder = `${FIXTURES}test-integrity/${id}/`;
      expect(existsSync(folder), folder).toBe(true);
      if (!existsSync(folder)) continue;
      const diffs = readdirSync(folder)
        .filter((name) => name.endsWith(".diff"))
        .sort();
      const triggers = diffs.filter((name) => name.startsWith(prefix));
      const passes = diffs.filter((name) => name.startsWith("pass-"));
      expect(triggers.length, `${id} must-trigger`).toBeGreaterThanOrEqual(3);
      expect(passes.length, `${id} must-not-trigger`).toBeGreaterThanOrEqual(3);

      for (const name of [...triggers, ...passes]) {
        const text = fixture(`test-integrity/${id}/${name}`);
        expect(text.split("\n").length, `${id}/${name} lines`).toBeLessThan(1000);
        const signals = signalsOf(await runDiff(text, "block"), id);
        if (name.startsWith("pass-")) expect(signals, `${id}/${name}`).toEqual([]);
        else {
          expect(signals.length, `${id}/${name}`).toBeGreaterThan(0);
          expect(
            signals.some((s) => String(s.severity) === severity),
            `${id}/${name}`,
          ).toBe(true);
        }
      }
    }
  });
});
