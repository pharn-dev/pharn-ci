import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";

// The schemas and the TI09 fixture directory are read inside the test body: the AC test is written before they
// change. schema/report.v1.json is pinned by the sha256 it has at the base commit 98693cf. (CORE-133: the CHANGELOG,
// README, LIMITS and THREAT-MODEL wording checks moved out; docs-contract.test.ts checks the README code rows.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TI09 = `${ROOT}fixtures/test-integrity/TI09`;
const V1_SHA256_AT_BASE = "c6cfd5b5afeada776fa89028f5ef29e06427d0e32529420184474e52ca77c731";

/** Every file under `dir`, relative to it with forward slashes. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

describe("TI09: schema and fixtures", () => {
  it("AC-19: the code table documents TEST_INTEGRITY_TI09 and names TI09 in the index-unavailable row, v1 is unchanged, and the TI09 fixtures hold at least 8 must-trigger and 6 must-not-trigger cases of the required kinds and layout", () => {
    // Codes. CORE-140: the schema's code description became one sentence and a link to the code table of
    // docs/output.md, so the rows of that table are read.
    expect(codeRow("TEST_INTEGRITY_TI09"), "the TI09 row").toContain("TI09:");
    expect(codeRow("TEST_INTEGRITY_INDEX_UNAVAILABLE"), "the index-unavailable row mentions TI09").toContain("TI09");
    const v1 = createHash("sha256")
      .update(readFileSync(`${ROOT}schema/report.v1.json`))
      .digest("hex");
    expect(v1, "schema/report.v1.json is byte-identical to the base commit").toBe(V1_SHA256_AT_BASE);

    // fixtures/test-integrity/TI09/: the cases and their layout.
    expect(existsSync(TI09), "fixtures/test-integrity/TI09/ exists").toBe(true);
    const cases = readdirSync(TI09).filter((name) => statSync(join(TI09, name)).isDirectory());
    const trigger = cases.filter((name) => /^(block|warn)-/.test(name));
    const pass = cases.filter((name) => name.startsWith("pass-"));
    expect(trigger.length, "at least 8 must-trigger cases").toBeGreaterThanOrEqual(8);
    expect(pass.length, "at least 6 must-not-trigger cases").toBeGreaterThanOrEqual(6);

    const pathOf = (diff: string) => /^\+\+\+ b\/(.+)$/m.exec(diff)?.[1] ?? "";
    // CORE-50 (binary-diff-not-blind): TI09 judges a config whose diff entry git shows as binary from its base and head
    // text, so these cases hold git's binary entry as change.diff: a `diff --git` line, an `index` line and
    // `Binary files a/<path> and b/<path> differ`, with no `---`/`+++` lines. The path is read from that entry instead.
    // Only the case named with `true` also holds text.diff beside it: the same change as a text diff, which its AC-13
    // test compares against. Every other case keeps the exact layout checked below.
    const BINARY_CASES: Readonly<Record<string, boolean>> = {
      "block-binary-pass-with-no-tests": true,
      "pass-binary-same-settings": false,
    };
    const binaryPathOf = (diff: string) =>
      /^diff --git a\/(.+) b\/\1\nindex [0-9a-f]+\.\.[0-9a-f]+ \d+\nBinary files a\/\1 and b\/\1 differ\n?$/.exec(
        diff,
      )?.[1] ?? "";
    const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
    const addedCases: string[] = [];
    for (const name of cases) {
      const dir = join(TI09, name);
      const files = filesUnder(dir);
      expect(files, `${name} holds change.diff`).toContain("change.diff");
      const diff = readFileSync(join(dir, "change.diff"), "utf8");
      expect(diff.split("\n").length, `${name}: change.diff is under 1000 lines`).toBeLessThan(1000);
      const binary = Object.hasOwn(BINARY_CASES, name);
      const path = binary ? binaryPathOf(diff) : pathOf(diff);
      expect(path, `${name}: the diff names a file`).not.toBe("");
      const isAdded = /^new file mode /m.test(diff);
      if (isAdded) addedCases.push(name);
      const withText = BINARY_CASES[name] === true;
      expect(files.includes("text.diff"), `${name}: text.diff only beside a binary change.diff that names it`).toBe(
        withText,
      );
      if (withText) {
        expect(pathOf(readFileSync(join(dir, "text.diff"), "utf8")), `${name}: text.diff names the same file`).toBe(
          path,
        );
      }
      for (const file of files.filter((f) => f !== "change.diff" && !(withText && f === "text.diff"))) {
        expect(file, `${name}: ${file} is a .txt under base/ or head/`).toMatch(/^(base|head)\/.+\.txt$/);
      }
      expect(files, `${name}: head/${path}.txt`).toContain(`head/${path}.txt`);
      if (isAdded) {
        expect(
          files.filter((f) => f.startsWith("base/")),
          `${name}: an added file holds only head/`,
        ).toEqual([]);
      } else {
        expect(files, `${name}: base/${path}.txt`).toContain(`base/${path}.txt`);
      }
    }

    const triggerNames = new Set(
      trigger.map((name) => {
        const diff = readFileSync(join(TI09, name, "change.diff"), "utf8");
        return basename(Object.hasOwn(BINARY_CASES, name) ? binaryPathOf(diff) : pathOf(diff));
      }),
    );
    for (const config of [
      "vitest.config.ts",
      "package.json",
      "playwright.config.ts",
      ".mocharc.yml",
      "pytest.ini",
      "pyproject.toml",
      "setup.cfg",
    ]) {
      expect(triggerNames.has(config), `a must-trigger case covers ${config}`).toBe(true);
    }
    const packageJsonJest = trigger.some((name) => {
      const head = join(TI09, name, "head", "package.json.txt");
      return existsSync(head) && /"jest"\s*:/.test(readFileSync(head, "utf8"));
    });
    expect(packageJsonJest, "a must-trigger case covers the package.json jest key").toBe(true);
    expect(
      trigger.some((name) => /cannot-compare|opaque|non-static|computed/.test(name)),
      "a must-trigger case covers a non-static value",
    ).toBe(true);

    for (const [what, pattern] of [
      ["a build-directory exclude", /build|dist|node-modules/],
      ["a reformat", /reformat/],
      ["a key moved", /moved/],
      ["a threshold raised", /threshold.*raised/],
      ["an include widened", /include.*widened/],
    ] as const) {
      expect(
        pass.some((name) => pattern.test(name)),
        `a must-not-trigger case for ${what}`,
      ).toBe(true);
    }
    expect(
      pass.some((name) => addedCases.includes(name)),
      "a must-not-trigger case for a new config without loosening keys",
    ).toBe(true);
  });
});
