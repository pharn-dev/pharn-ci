import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reads CHANGELOG.md and docs/THREAT-MODEL.md as text; nothing the build adds is loaded.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** The `## [Unreleased]` section of the changelog, up to the next `## [` heading. */
function unreleased(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^## \[Unreleased\]/.test(l));
  if (start < 0) throw new Error("CHANGELOG.md has no ## [Unreleased] section");
  const end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** The bullets of a markdown section, each joined with its continuation lines. */
function bullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (/^- /.test(line)) out.push(line.slice(2));
    else if (/^\s+\S/.test(line) && out.length > 0) out[out.length - 1] += ` ${line.trim()}`;
    else if (line.trim() === "" || /^#/.test(line)) continue;
  }
  return out;
}

describe("the changelog and the threat model name the pytest parity change", () => {
  it("AC-19: the Unreleased section holds a line naming pytest marker aliases, TI03's expectedFailure and pytest.xfail forms and TI09's native [tool.pytest] table, and THREAT-MODEL row A1 names the native [tool.pytest] table read by the same linear, size-capped reader", () => {
    const entries = bullets(unreleased(read("CHANGELOG.md")));
    const line = entries.find(
      (b) =>
        /pytest/.test(b) &&
        /\balias/i.test(b) &&
        /marker/i.test(b) &&
        /expectedFailure/.test(b) &&
        /pytest\.xfail/.test(b) &&
        /\[tool\.pytest\]/.test(b),
    );
    expect(
      line,
      "one Unreleased entry names marker aliases, expectedFailure, pytest.xfail and [tool.pytest]",
    ).toBeDefined();
    expect(line, "it names TI03").toMatch(/TI03/);
    expect(line, "it names TI09").toMatch(/TI09/);

    const rows = read("docs/THREAT-MODEL.md")
      .split("\n")
      .filter((l) => /^\|\s*A1\s*\|/.test(l));
    expect(rows, "one row A1").toHaveLength(1);
    const a1 = rows[0] as string;
    expect(a1, "row A1 names the native [tool.pytest] table").toMatch(/\[tool\.pytest\]/);
    expect(a1, "row A1 still names [tool.pytest.ini_options]").toMatch(/\[tool\.pytest\.ini_options\]/);
    expect(a1, "read by a linear reader").toMatch(/linear/i);
    expect(a1, "with a size cap").toMatch(/size-capped|size cap|capped/i);
  });
});
