import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// release-030: README.md pins v0.3.0 in its four `uses: pharn-dev/pharn-ci@` lines (the top snippet, the Quick start
// workflow and the two "Fork PRs: comment from workflow_run" workflows), its Status note names v0.3.0 as the latest
// release, and the example comment's footer reads pharn-ci 0.3.0. README.md is read inside the test body.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));

/** The `> **Status:**` note: its first line and the `>` lines that follow it. */
function statusNote(all: string[]): string {
  const start = all.findIndex((line) => line.startsWith("> **Status:**"));
  expect(start, "a > **Status:** note").toBeGreaterThan(-1);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => !line.startsWith(">"));
  return [all[start] as string, ...(end === -1 ? rest : rest.slice(0, end))].join(" ").replace(/\s+/g, " ");
}

describe("release-030: README.md pins and Status note", () => {
  it("AC-4: the four uses: pharn-dev/pharn-ci@ lines pin v0.3.0, the Status note names v0.3.0 as the latest release and no earlier one, no v0.2.0 pin is left, and the example footer reads pharn-ci 0.3.0", () => {
    const all = lines(read("README.md"));

    const pins = all
      .map((line) => /^\s*(?:- )?uses:\s*pharn-dev\/pharn-ci@(\S+)/.exec(line)?.[1])
      .filter((ref): ref is string => ref !== undefined);
    expect(pins).toEqual(["v0.3.0", "v0.3.0", "v0.3.0", "v0.3.0"]);
    expect(all.filter((line) => line.includes("pharn-ci@v0.2.0"))).toEqual([]);

    const status = statusNote(all);
    expect(status, "the Status note names v0.3.0 as the latest release").toContain("the latest release is `v0.3.0`");
    const tags = [...new Set(status.match(/\bv0\.\d+\.\d+\b/g) ?? [])];
    expect(tags, "the Status note names no other v0.x.y tag").toEqual(["v0.3.0"]);
    expect(status, "and does not say the release is still to come").not.toMatch(
      /not (?:yet |been )?(?:cut|released|tagged)|unreleased/i,
    );

    const footers = all.filter((line) => /<sub>pharn-ci \d+\.\d+\.\d+ · /.test(line));
    expect(footers, "the example comment footer").toEqual([
      "> <sub>pharn-ci 0.3.0 · report schema v2 · coverage format lcov</sub>",
    ]);
  });
});
