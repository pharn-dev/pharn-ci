import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./helpers.js";

// The committed packages/action/dist/index.js carries TI07. (CORE-132: the checks that read this increment's own change
// with git, that only the listed tests changed, none was deleted or renamed and none gained a skip, and that the dist
// was modified, were history pins and are removed.)

const ROOT = new URL("../", `file://${FIXTURES}`).pathname;
const DIST = "packages/action/dist/index.js";

describe("the existing suite stays whole", () => {
  it("AC-16: the committed action dist carries TI07", () => {
    const dist = readFileSync(`${ROOT}${DIST}`, "utf8");
    // CORE-140: the TEST_INTEGRITY_<id> codes are derived from the signal registry, so the dist carries the registry's
    // TI07 entry (its id) rather than the code as a literal.
    expect(dist, "the rebuilt dist carries TI07").toContain('id: "TI07"');
  });
});
