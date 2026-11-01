import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-030: CHANGELOG.md is ready for `Release verify` (.github/workflows/release.yml) to release 0.3.0. The
// Unreleased entries moved under one `## [0.3.0] - 2026-10-26` heading with no date note, an empty Unreleased skeleton
// (Added, Changed, Security) sits above it, the 0.3.0 notes are grouped as Added, Changed, Fixed and Security, and the
// 0.2.0 and 0.1.0 sections are byte-identical to the base commit. Files are read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Main before this increment: the base for the "unchanged" checks. */
const BASE = "f1dd7e99b90719fbe1602b7b3ff231b0dca38c98";
/** The `chore: release 0.3.0 (#107)` commit, whose Unreleased section is the empty skeleton. */
const RELEASE = "ad3b75f9f2b9863806055897e99430b06db7fd1c";
const HEADING = "## [0.3.0] - 2026-10-26";
const GROUPS = ["### Added", "### Changed", "### Fixed", "### Security"];

const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));

/** The lines under the heading line that starts with `heading`, up to the next `## [` line (the heading excluded). */
function section(all: string[], heading: string): string[] {
  const start = all.findIndex((line) => line.startsWith(heading));
  expect(start, `CHANGELOG.md has a ${heading} heading`).toBeGreaterThan(-1);
  const end = all.findIndex((line, i) => i > start && line.startsWith("## ["));
  return all.slice(start + 1, end === -1 ? undefined : end);
}

describe("release-030: CHANGELOG.md shape", () => {
  it("AC-2: check-release-notes.mjs passes for 0.3.0, the ## [ headings are Unreleased, 0.3.0 dated 2026-10-26, 0.2.0 and 0.1.0, Unreleased is an empty Added, Changed and Security skeleton, the 0.3.0 notes are grouped Added, Changed, Fixed and Security with no placeholder or date note, and the 0.2.0 and 0.1.0 sections are unchanged", () => {
    const all = lines(readFileSync(`${ROOT}CHANGELOG.md`, "utf8"));
    const base = lines(execFileSync("git", ["show", `${BASE}:CHANGELOG.md`], { cwd: ROOT, encoding: "utf8" }));

    const headings = all.filter((line) => line.startsWith("## ["));
    expect(headings).toEqual([
      "## [Unreleased]",
      "## [0.4.0] - 2026-10-27",
      HEADING,
      "## [0.2.0] - 2026-10-25",
      "## [0.1.0] - 2026-10-19",
    ]);

    const run = spawnSync(process.execPath, ["scripts/check-release-notes.mjs", "0.3.0", "CHANGELOG.md"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(run.stdout.trim(), "check-release-notes.mjs output").toBe("ok   CHANGELOG.md is ready to release 0.3.0");
    expect(run.status, "check-release-notes.mjs exit code").toBe(0);

    const atRelease = lines(execFileSync("git", ["show", `${RELEASE}:CHANGELOG.md`], { cwd: ROOT, encoding: "utf8" }));
    const unreleased = section(atRelease, "## [Unreleased]").filter((line) => line.trim() !== "");
    expect(unreleased, "an empty Unreleased skeleton at the 0.3.0 release").toEqual([
      "### Added",
      "### Changed",
      "### Security",
    ]);
    expect(
      section(all, "## [Unreleased]").filter((line) => line.startsWith("### ")),
      "the live Unreleased headings",
    ).toEqual(["### Added", "### Changed", "### Security"]);

    const notes = section(all, HEADING);
    expect(
      notes.filter((line) => line.startsWith("#")),
      "the 0.3.0 groups",
    ).toEqual(GROUPS);
    const joined = notes.join("\n");
    expect(joined).not.toContain("YYYY-MM-DD");
    expect(joined).not.toMatch(/the\s+maintainer\s+replaces/i);
    for (const group of GROUPS) {
      const rest = notes.slice(notes.indexOf(group) + 1);
      const end = rest.findIndex((line) => line.startsWith("#"));
      const entries = (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.startsWith("- "));
      expect(entries.length, `${group} under 0.3.0 has entries`).toBeGreaterThan(0);
    }

    for (const release of ["## [0.2.0] - 2026-10-25", "## [0.1.0] - 2026-10-19"]) {
      expect(section(all, release), `${release} is unchanged`).toEqual(section(base, release));
    }
  });
});
