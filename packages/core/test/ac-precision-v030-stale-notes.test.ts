import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// precision-v030: with the official v0.3.0 results published, docs/PRECISION.md no longer says the numbers are still
// to come, and keeps the words and headings earlier tests and readers rely on. The file is read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The lines of the `## ` section whose heading starts with `prefix`, after the heading, up to the next `## `. */
function h2Section(all: string[], prefix: string): string[] {
  const start = all.findIndex((line) => line.startsWith(prefix));
  if (start === -1) throw new Error(`no heading starting "${prefix}"`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

describe("docs/PRECISION.md drops the to-come notes", () => {
  it("AC-7: section 1 and section 2 no longer say the official numbers are to come, and section 2 keeps dry run, TI01, TI02, item 18, v0.3.0 and its two headings", () => {
    const all = lines(readFileSync(join(ROOT, "docs/PRECISION.md"), "utf8"));
    const s1 = h2Section(all, "## 1.");
    const s2 = h2Section(all, "## 2. Precision corpus");
    const one = normalize(s1.join(" "));
    const two = normalize(s2.join(" "));

    expect(one).not.toContain("The results land there with v0.3.0");
    for (const stale of [
      "may recommend demoting TI15",
      "The runs are not here yet",
      "come with BACKLOG item 18",
      "The reviewed CSV and the rates land with",
    ]) {
      expect(two, stale).not.toContain(stale);
    }
    for (const kept of ["dry run", "TI01", "TI02", "item 18", "v0.3.0"]) expect(two, kept).toContain(kept);
    expect(s2).toContain("### How the run works");
    expect(s2).toContain("### What the early dry run changed");

    const how = s2.slice(s2.indexOf("### How the run works") + 1);
    const end = how.findIndex((line) => line.startsWith("### ") || line.startsWith("## "));
    expect(normalize((end === -1 ? how : how.slice(0, end)).join(" ")), "How the run works keeps v0.3.0").toContain(
      "v0.3.0",
    );
  });
});
