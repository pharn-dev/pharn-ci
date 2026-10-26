import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: README.md moves TI15 out of the signals that warn and next to TI16 as an `info` finding, and its
// TEST_INTEGRITY_TI15 message-table row says `info`. The file is read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

describe("README.md: TI15 is an info signal", () => {
  it("AC-10: the signals sentence lists TI06, TI07, TI08 and TI12 as warning and names TI15 and TI16 as giving an info finding, and the TEST_INTEGRITY_TI15 row says info in modes block and warn", () => {
    const text = readFileSync(join(ROOT, "README.md"), "utf8");
    const flat = normalize(text);

    expect(flat).not.toContain("TI12 and TI15 warn");
    expect(flat).toContain("TI06, TI07, TI08 and TI12 warn");
    const sentences = flat.split(/(?<=\.)\s+(?=[A-Z`*[(])/);
    expect(
      sentences.some((s) => s.includes("TI15") && s.includes("TI16") && s.includes("`info` finding")),
      "a sentence naming TI15 and TI16 as giving an `info` finding",
    ).toBe(true);

    const rows = text
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.startsWith("| `TEST_INTEGRITY_TI15`"));
    expect(rows, "one TEST_INTEGRITY_TI15 table row").toHaveLength(1);
    const row = rows[0] as string;
    expect(row).toContain("`info` in modes `block` and `warn`");
    expect(row).toContain("at most 10");
    expect(row).not.toContain("`warn` in modes");
  });
});
