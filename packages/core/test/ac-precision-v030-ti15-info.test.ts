import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runFixture } from "./ac-e1-fix-shared.js";
import { FIXTURES } from "./helpers.js";

// precision-v030: TI15 becomes an `info` signal (0 of 30 sampled findings were right on the precision corpus). Over
// its must-trigger diffs, which keep their historical warn-* names, every TI15 finding and the TEST_INTEGRITY_TI15
// message are `info` in modes block and warn, an info-only report passes, and mode off runs no TI15. check() is
// loaded inside the test body by runFixture, which also validates every report against schema/report.v2.json.

const TI15 = "TI15";
const CODE = "TEST_INTEGRITY_TI15";

describe("TI15 is an info signal", () => {
  it("AC-8: each TI15 warn-*.diff gives only info TI15 signals and an info TEST_INTEGRITY_TI15 message in modes block and warn, passes when TI15 is its only signal, and gives no TI15 in mode off", async () => {
    const names = readdirSync(`${FIXTURES}test-integrity/${TI15}/`)
      .filter((name) => name.startsWith("warn-") && name.endsWith(".diff"))
      .sort();
    expect(names.length, "the TI15 must-trigger diffs").toBeGreaterThan(0);

    for (const name of names) {
      for (const mode of ["block", "warn"] as const) {
        const label = `${name} (${mode})`;
        const report = await runFixture(`${TI15}/${name}`, mode);
        const signals = report.testIntegrity.signals;
        const ti15 = signals.filter((signal) => String(signal.id) === TI15);
        expect(ti15.length, `${label}: at least one TI15 signal`).toBeGreaterThan(0);
        expect(
          ti15.map((signal) => signal.severity),
          `${label}: every TI15 signal is info`,
        ).toEqual(ti15.map(() => "info"));
        const messages = report.messages.filter((message) => String(message.code) === CODE);
        expect(
          messages.map((message) => message.level),
          `${label}: the ${CODE} message level`,
        ).toEqual(["info"]);
        if (signals.every((signal) => String(signal.id) === TI15)) {
          expect(report.testIntegrity.verdict, `${label}: an info-only report passes`).toBe("pass");
        }
      }

      const off = await runFixture(`${TI15}/${name}`, "off");
      const offSignals = (off.testIntegrity?.signals ?? []).filter((signal) => String(signal.id) === TI15);
      expect(offSignals, `${name} (off): no TI15 signal`).toEqual([]);
      expect(
        off.messages.filter((message) => String(message.code) === CODE),
        `${name} (off): no ${CODE} message`,
      ).toEqual([]);
    }
  });
});
