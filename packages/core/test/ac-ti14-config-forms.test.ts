import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { messagesOf, runFixture, signalsOf } from "./ac-e1-fix-shared.js";
import { fixture } from "./helpers.js";

// TI14 reads the config lines as the config reader does: a quoted key, a quoted or escaped value and any number of
// decimals. Each must-trigger fixture is first parsed as a config, so the test proves the looser setting is one the
// check would apply.

/** The head side of a one-file config diff as a config text: the added lines under `coverage:`. */
function headConfig(diff: string): string {
  const added = fixture(`test-integrity/TI14/${diff}`)
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
  return `coverage:\n${added.join("\n")}\n`;
}

describe("TI14: config forms the config reader accepts", () => {
  it.each([
    ["block-threshold-quoted-key.diff", "70"],
    ["block-threshold-single-quoted.diff", "70"],
    ["block-threshold-long-decimals.diff", "70.00000"],
    ["block-threshold-escaped.diff", "70"],
  ] as const)(
    "%s: the config applies a threshold of 70, and TI14 blocks it as lowered from 80",
    async (diff, shown) => {
      expect(parseConfig(headConfig(diff)).coverage?.threshold).toBe(70);

      const report = await runFixture(`TI14/${diff}`);
      const signals = signalsOf(report, "TI14");
      expect(signals).toHaveLength(1);
      expect(signals[0]).toMatchObject({ severity: "block", path: ".pharn/ci.yml", line: 4 });
      expect(signals[0]?.detail).toBe(`Coverage threshold lowered from 80 to ${shown}.`);
      expect(messagesOf(report, "TEST_INTEGRITY_TI14")[0]?.level).toBe("error");
      expect(report.verdict).toBe("fail");
    },
  );

  it.each([
    ["block-exclude-quoted-key.diff", 5],
    ["block-exclude-quoted-key-block.diff", 6],
  ] as const)("%s: the config applies the exclusion src/**, and TI14 blocks it as added", async (diff, line) => {
    expect(parseConfig(headConfig(diff)).coverage?.exclude).toEqual(["src/**"]);

    const report = await runFixture(`TI14/${diff}`);
    const signals = signalsOf(report, "TI14");
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ severity: "block", path: ".pharn/ci.yml", line });
    expect(signals[0]?.detail).toContain("coverage exclusion was added");
    expect(report.verdict).toBe("fail");
  });

  it.each([
    ["pass-key-requoted.diff", "the key quoted and the same threshold written as 80.0"],
    ["pass-threshold-quoted-raised.diff", "a quoted threshold raised from 80 to 90.00000"],
  ])("%s: %s is not a finding", async (diff) => {
    const report = await runFixture(`TI14/${diff}`);
    expect(signalsOf(report, "TI14")).toEqual([]);
    expect(messagesOf(report, "TEST_INTEGRITY_TI14")).toEqual([]);
  });
});
