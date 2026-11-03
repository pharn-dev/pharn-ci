import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Review findings 28 and 30 (docs drift): LIMITS gains "What P08 misses", RELEASING says the release PR is the last
// merge before the dispatch and that schemaVersion is the one v1 field whose type changed, and CONTRIBUTING names the
// fixture naming rule with its two historical exceptions.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

/** The text from the line `heading` to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const level = /^#+/.exec(heading)?.[0].length ?? 2;
  const lines = text.split("\n");
  const at = lines.indexOf(heading);
  expect(at, heading).toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((l, i) => {
    if (i <= at) return false;
    const m = /^(#+) /.exec(l);
    return m !== null && (m[1] as string).length <= level;
  });
  return lines.slice(at, next === -1 ? undefined : next).join("\n");
}

describe("SPEC drift docs (review findings 28 and 30)", () => {
  it("AC-1: LIMITS has What P08 misses under Org policy, naming tracked files only, paths only and a failed listing", () => {
    const org = section(read("docs/LIMITS.md"), "## Org policy");
    const misses = flat(section(org, "### What P08 misses"));
    for (const words of ["Tracked files only", "Paths only", "`git ls-files`", "submodule", "case-sensitive", "50"]) {
      expect(misses, `What P08 misses names ${words}`).toContain(words);
    }
  });

  it("AC-2: RELEASING step 1 makes the release PR the last merge before the dispatch; schemaVersion is the type exception", () => {
    const releasing = read("docs/RELEASING.md");
    const cutting = flat(section(releasing, "## Cutting a release"));
    expect(cutting).toContain("The release PR is the last change merged before the dispatch");
    expect(flat(releasing)).toContain("Every v1 field except `schemaVersion` keeps its name, type and meaning");
    expect(flat(releasing)).not.toContain("Every v1 field keeps its name, type and meaning");
  });

  it("AC-3: CONTRIBUTING names the fixture prefix rule and the TI15 warn-* and TI02 pass-moved-to-other-file exceptions", () => {
    const tests = flat(section(read("CONTRIBUTING.md"), "## Tests"));
    expect(tests).toContain("`block-`, `warn-`, `info-` or `pass-`");
    expect(tests).toContain("`TI15/warn-*.diff`");
    expect(tests).toContain("`TI02/pass-moved-to-other-file`");
  });
});
