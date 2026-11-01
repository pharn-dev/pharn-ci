import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: CHANGELOG.md's Unreleased section gains one entry under its first `### Changed` heading for TI15 to
// `info` and the official precision results (docs/PRECISION.md, 600 PRs), and only adds: every earlier Unreleased
// line and every `## [` heading of b31de0c (read with git show) is kept.
// Shipped in 0.3.0. The release PR moved the Unreleased entries under `## [0.3.0] - 2026-10-26` and regrouped them for
// a reader (Added, Changed, Fixed, Security): TI15 is a new signal of 0.3.0, so its `info` level and the precision
// results now sit in the Added entries, an earlier line is no longer kept byte for byte, and every code span of the
// b31de0c Unreleased section is still in the 0.3.0 section. The 0.3.0 heading is the only `## [` heading added.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "b31de0c";
const RELEASE_HEADING = "## [0.3.0] - 2026-10-26";

const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The lines of the section under `heading` (`## [Unreleased]` by default), up to the next `## [` line. */
function unreleased(all: string[], heading = "## [Unreleased]"): string[] {
  const start = all.findIndex((line) => line.startsWith(heading));
  if (start === -1) throw new Error(`no ${heading} section`);
  const end = all.findIndex((line, i) => i > start && line.startsWith("## ["));
  return all.slice(start + 1, end === -1 ? undefined : end);
}

/** The entries under the first `### <title>` heading, up to the next `##`/`###` heading, joined with continuations. */
function firstChanged(section: string[], title = "Changed"): string[] {
  const at = section.findIndex((line) => line.trim() === `### ${title}`);
  if (at === -1) throw new Error(`no ### ${title} heading`);
  const rest = section.slice(at + 1);
  const stop = rest.findIndex((line) => line.startsWith("## ") || line.startsWith("### "));
  const out: string[] = [];
  for (const line of stop === -1 ? rest : rest.slice(0, stop)) {
    if (/^[-*] /.test(line)) out.push(line.slice(2));
    else if (line.trim() !== "" && out.length > 0) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out.map(normalize);
}

describe("CHANGELOG.md records TI15 to info and the official precision results", () => {
  it("AC-12: the 0.3.0 › Added list holds an entry naming TI15, info, docs/PRECISION.md and 600; the facts of earlier Unreleased lines and the ## [ headings are kept", () => {
    const now = lines(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
    const base = lines(execFileSync("git", ["show", `${BASE}:CHANGELOG.md`], { cwd: ROOT, encoding: "utf8" }));

    const entries = firstChanged(unreleased(now, RELEASE_HEADING), "Added");
    expect(
      entries.some(
        (entry) =>
          entry.includes("TI15") &&
          /\binfo\b/.test(entry) &&
          entry.includes("docs/PRECISION.md") &&
          /\b600\b/.test(entry),
      ),
      "an entry under the 0.3.0 ### Added naming TI15, info, docs/PRECISION.md and 600",
    ).toBe(true);

    const kept = normalize(unreleased(now, RELEASE_HEADING).join("\n"));
    const spans = new Set(normalize(unreleased(base).join("\n")).match(/`[^`]+`/g) ?? []);
    expect(spans.size, "the b31de0c Unreleased section has code spans").toBeGreaterThan(50);
    const missing = [...spans].filter((span) => !kept.includes(span));
    expect(missing, "every code span of the b31de0c Unreleased section is still there").toEqual([]);

    const headings = (all: string[]) => all.filter((line) => line.startsWith("## ["));
    const [unreleasedHeading, ...released] = headings(base);
    expect(headings(now)).toEqual([unreleasedHeading, "## [0.4.0] - 2026-10-27", RELEASE_HEADING, ...released]);
  });
});
