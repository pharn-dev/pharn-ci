import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runFixture, signalsOf } from "./ac-e1-fix-shared.js";
import { FIXTURES } from "./helpers.js";

// ti17-always-true-matcher-2, AC-24. git, the fixture directory and check() (through runFixture) are used inside the
// test body: the build writes fixtures/test-integrity/TI17/ after this test is written. The benchmark under
// fixtures/skylos-nine*/ must be byte-identical to the base commit: changing the benchmark to fit the detector is the
// failure this product exists to catch.

const BASE = "12036e8c485a656eeb9a4a9beb869e51e37b7d80";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BENCHMARK = ["fixtures/skylos-nine", "fixtures/skylos-nine-pytest", "fixtures/skylos-nine-sources"];
const ID = ["TI", "17"].join("");
const DETECTIONS = ["matcher", "helper", "wildcard"] as const;
const NAME = /^(warn|pass)-(matcher|helper|wildcard)-[a-z0-9-]+\.diff$/;

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

describe("the TI17 fixtures, and the benchmark left as it was", () => {
  it("AC-24: every file under the Skylos benchmark is byte-identical to the base commit, there are no always-true-matcher sources, and fixtures/test-integrity/TI17/ holds a warn and a pass case per detection, each giving a TI17 signal for warn cases only", async () => {
    expect(git("diff", "--name-only", BASE, "--", ...BENCHMARK).trim(), "no benchmark file changed").toBe("");
    expect(
      git("ls-files", "--others", "--exclude-standard", "--", ...BENCHMARK).trim(),
      "no benchmark file added",
    ).toBe("");
    expect(existsSync(`${FIXTURES}skylos-nine-sources/always-true-matcher`)).toBe(false);

    const dir = `${FIXTURES}test-integrity/${ID}/`;
    expect(existsSync(dir), "fixtures/test-integrity/TI17/ exists").toBe(true);
    const names = readdirSync(dir)
      .filter((n) => n.endsWith(".diff"))
      .sort();
    for (const name of names) expect(name, "fixture name: <warn|pass>-<detection>-<what>.diff").toMatch(NAME);
    for (const detection of DETECTIONS) {
      for (const result of ["warn", "pass"]) {
        expect(
          names.some((n) => n.startsWith(`${result}-${detection}-`)),
          `a ${result}-${detection}-* case`,
        ).toBe(true);
      }
    }

    for (const name of names) {
      const signals = signalsOf(await runFixture(`${ID}/${name}`), ID);
      if (name.startsWith("warn-")) {
        expect(signals.length, `${name} gives a TI17 signal`).toBeGreaterThan(0);
      } else {
        expect(signals, `${name} gives no TI17 signal`).toEqual([]);
      }
    }
  });
});
