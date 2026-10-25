import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// release-readiness-v020: README.md gains a `## Test integrity` section (with a real rendered example) and its Roadmap
// stops calling test-tampering detection unbuilt. Files, check() and the renderer are loaded inside each test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Current main before this increment: the base for the "unchanged" checks. */
const BEFORE = "b2c3a56373046ee6b64f913581a645f98240310c";
const REPO_ROOT = "/home/runner/work/demo/demo";
const RENDERED_HEADING = "### 🔍 Test integrity";

const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const readBefore = (path: string) =>
  execFileSync("git", ["show", `${BEFORE}:${path}`], { cwd: ROOT, encoding: "utf8" });
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** A `## ` section's lines: from the exact heading line to the line before the next `## ` heading. */
function h2Section(text: string, heading: string): string[] {
  const all = lines(text);
  const start = all.indexOf(heading);
  if (start === -1) throw new Error(`README.md has no "${heading}" heading`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return [heading, ...(end === -1 ? rest : rest.slice(0, end))];
}

/** The `> **Status:**` note: its first line and the `>` lines that follow it. */
function statusNote(text: string): string[] {
  const all = lines(text);
  const start = all.findIndex((line) => line.startsWith("> **Status:**"));
  if (start === -1) throw new Error("no > **Status:** note");
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => !line.startsWith(">"));
  return [all[start] as string, ...(end === -1 ? rest : rest.slice(0, end))];
}

const usesLines = (text: string) => lines(text).filter((line) => line.includes("uses: pharn-dev/pharn-ci@"));

describe("release-readiness-v020: README.md", () => {
  it("AC-5: one ## Test integrity heading, its Contents line, the section's words and links, no uses: line, and the Status note and uses: pins unchanged", () => {
    const now = read("README.md");
    const before = readBefore("README.md");
    const all = lines(now);

    expect(all.filter((line) => line === "## Test integrity")).toHaveLength(1);
    expect(all.some((line) => line.trim() === "- [Test integrity](#test-integrity)")).toBe(true);

    const section = h2Section(now, "## Test integrity");
    const body = normalize(section.join("\n"));
    for (const word of ["block", "warn", "off", "default", "test_integrity.mode", "stricter", "Skylos", "2 of 9"]) {
      expect(body, word).toContain(word);
    }
    expect(body).toMatch(/\]\(#accept-label\)/);
    expect(body).toMatch(/\]\((?:\.\/)?docs\/LIMITS\.md(?:#[^)]*)?\)/);
    expect(section.filter((line) => line.includes("uses:"))).toEqual([]);

    expect(statusNote(now)).toEqual(statusNote(before));
    expect(usesLines(before).length).toBeGreaterThan(0);
    expect(usesLines(now)).toEqual(usesLines(before));
  });

  it("AC-6: every non-blank line of the rendered added-skip Test integrity section appears, in order, in the README section with its > quote removed", async () => {
    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: fixture("skylos-nine/added-skip/change.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("skylos-nine/added-skip/files.txt").trim().split("\n"),
      testIntegrityMode: { input: "block" },
    } as Parameters<typeof check>[0]);
    expectValidReport(report);

    const renderedAll = lines(renderMarkdown(report));
    const start = renderedAll.indexOf(RENDERED_HEADING);
    expect(start, "rendered Test integrity heading").toBeGreaterThan(-1);
    const rest = renderedAll.slice(start + 1);
    const end = rest.findIndex((line) => line.startsWith("### "));
    const rendered = [RENDERED_HEADING, ...(end === -1 ? rest : rest.slice(0, end))].filter((l) => l.trim() !== "");
    expect(rendered.some((line) => line.includes("**TI03**"))).toBe(true);

    const readme = h2Section(read("README.md"), "## Test integrity").map((line) =>
      line.startsWith("> ") ? line.slice(2) : line.startsWith(">") ? line.slice(1) : line,
    );
    let cursor = 0;
    for (const line of rendered) {
      const found = readme.indexOf(line, cursor);
      expect(found, `README section is missing, in order: ${JSON.stringify(line)}`).toBeGreaterThan(-1);
      cursor = found + 1;
    }
  });

  it("AC-7: the Roadmap no longer says deleted test files are already named by…, and links to #test-integrity", () => {
    const roadmap = h2Section(read("README.md"), "## Roadmap");
    expect(roadmap.filter((line) => line.includes("deleted test files are already named by"))).toEqual([]);
    expect(roadmap.join("\n")).toContain("](#test-integrity)");
  });
});
