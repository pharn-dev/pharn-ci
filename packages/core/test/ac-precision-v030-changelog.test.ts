import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: CHANGELOG.md's Unreleased section gains one entry under its first `### Changed` heading for TI15 to
// `info` and the official precision results (docs/PRECISION.md, 600 PRs), and only adds: every earlier Unreleased
// line and every `## [` heading of b31de0c (read with git show) is kept.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "b31de0c";

const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The lines of the `## [Unreleased]` section, after its heading, up to the next `## [` line. */
function unreleased(all: string[]): string[] {
  const start = all.findIndex((line) => line.startsWith("## [Unreleased]"));
  if (start === -1) throw new Error("no ## [Unreleased] section");
  const end = all.findIndex((line, i) => i > start && line.startsWith("## ["));
  return all.slice(start + 1, end === -1 ? undefined : end);
}

/** The entries under the first `### Changed` heading, up to the next `##`/`###` heading, joined with continuations. */
function firstChanged(section: string[]): string[] {
  const at = section.findIndex((line) => line.trim() === "### Changed");
  if (at === -1) throw new Error("no ### Changed heading under Unreleased");
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
  it("AC-12: the first Unreleased › Changed list holds an entry naming TI15, info, docs/PRECISION.md and 600; earlier Unreleased lines and the ## [ headings are kept", () => {
    const now = lines(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
    const base = lines(execFileSync("git", ["show", `${BASE}:CHANGELOG.md`], { cwd: ROOT, encoding: "utf8" }));

    const entries = firstChanged(unreleased(now));
    expect(
      entries.some(
        (entry) =>
          entry.includes("TI15") &&
          /\binfo\b/.test(entry) &&
          entry.includes("docs/PRECISION.md") &&
          /\b600\b/.test(entry),
      ),
      "an entry under the first ### Changed naming TI15, info, docs/PRECISION.md and 600",
    ).toBe(true);

    const kept = new Set(unreleased(now));
    const missing = unreleased(base).filter((line) => line.trim() !== "" && !kept.has(line));
    expect(missing, "every non-blank line of the b31de0c Unreleased section is still there").toEqual([]);

    const headings = (all: string[]) => all.filter((line) => line.startsWith("## ["));
    expect(headings(now)).toEqual(headings(base));
  });
});
