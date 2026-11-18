import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withoutCore50SchemaEdits } from "./core50-schema.js";
import { withoutCore69SchemaEdits } from "./core69-schema.js";
import { withoutSchemaLevelEdits } from "./level-edits.js";
import { withoutR3SchemaTextEdits } from "./r3-schema-text.js";
import { withoutTi17SchemaEdits } from "./ti17-schema.js";
import { withoutV060CodeText } from "./v060-codes.js";
import { withoutV070SchemaEdits } from "./v070-codes.js";
import { withoutV080SchemaEdits } from "./v080-codes.js";
import { withoutV090SchemaEdits } from "./v090-codes.js";

// docs-schema-levels: report.v2.json states the block-mode levels #126 shipped. The base is main at 88ecc5e (#126
// merged), read with git. (CORE-133: the THREAT-MODEL §3 residual-numbering check moved out.)
const BASE = "88ecc5e";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const atBase = (path: string) =>
  execFileSync("git", ["show", `${BASE}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

describe("docs-schema-levels", () => {
  it("report.v2.json states both block-mode levels and differs from 88ecc5e only by them; report.v1.json is unchanged", () => {
    const now = read("schema/report.v2.json");
    expect(now).toContain(
      "except DIFF_UNAVAILABLE, which is an error when a coverage threshold is set (0 included) or the test-integrity mode is block, and a warn otherwise.",
    );
    expect(now).toContain(
      "TEST_INTEGRITY_INDEX_UNAVAILABLE (warn, or error in mode block when TI02 and TI05, or TI09, did not run at all: touched",
    );
    // Re-pinned for policy-p13 (Horizon 2 item H1) and policy rule P14 (agent PR size cap): the code description also
    // gains exactly the v0.6.0 code text (POLICY_P13, POLICY_P14) at its end; withoutV060CodeText requires it once and
    // takes it out too, so every other byte stays pinned.
    // Re-pinned for A8 step 1 (TESTS_NOT_EXERCISING_CHANGES): the v0.7.0 code text and the optional
    // testIntegrity.exercise property are taken out first (v070-codes.ts pins both exactly), so every other byte stays
    // pinned.
    // Re-pinned for H4 (prompt-injection scan): withoutV070SchemaEdits also takes out its `injection` object, and its
    // codes are in the same v0.7.0 code text.
    // Re-pinned for dependency safety (A13, v0.8.0): its part of the v0.8.0 code text and its top-level `dependencies`
    // object are taken out first (v080-codes.ts pins both exactly).
    expect(
      // Re-pinned for flaky tests (A6, v0.8.0): its code text and the flaky description are taken out the same way
      // (v080-codes.ts).
      // Re-pinned for fix-hints (H6): the `$defs.fix` object and the six `fix` properties are taken out first
      // (v090-codes.ts pins them exactly).
      // Re-pinned for ti17-always-true-matcher-2: the TI17 id pattern and code text are taken out first (ti17-schema.ts).
      withoutV060CodeText(
        withoutSchemaLevelEdits(
          // Re-pinned for CORE-69: its three description insertions are taken out first (core69-schema.ts).
          // Re-pinned for the R3 schema text follow-up: its six description edits are put back first (r3-schema-text.ts).
          withoutV070SchemaEdits(
            withoutV080SchemaEdits(
              withoutV090SchemaEdits(
                withoutTi17SchemaEdits(
                  withoutCore69SchemaEdits(withoutCore50SchemaEdits(withoutR3SchemaTextEdits(now))),
                ),
              ),
            ),
          ),
        ),
      ),
      "report.v2.json without the two insertions",
    ).toBe(atBase("schema/report.v2.json"));
    expect(read("schema/report.v1.json"), "report.v1.json").toBe(atBase("schema/report.v1.json"));
  });
});
