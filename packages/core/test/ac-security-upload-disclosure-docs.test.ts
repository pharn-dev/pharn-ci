import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SECURITY.md's Data handling section must name the run upload to pharn.dev, not only the org policy request, and
// the README's pointer to it must say it lists what goes to pharn.dev too (review HIGH 5). The files are read inside
// each test body, since the build edits them after this test is written.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

/** The text of SECURITY.md's `## Data handling` section, up to the next `## ` heading. */
function dataHandlingSection(): string {
  const text = read("SECURITY.md");
  const start = text.indexOf("\n## Data handling\n");
  expect(start, "SECURITY.md has a ## Data handling section").toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** The section's `|`-delimited table rows, each split into trimmed cells. */
function dataHandlingRows(): string[][] {
  return dataHandlingSection()
    .split("\n")
    .filter((line) => line.startsWith("| "))
    .map((line) =>
      line
        .slice(1, line.endsWith("|") ? -1 : undefined)
        .split("|")
        .map((cell) => cell.trim()),
    );
}

/** The section's opening paragraph: the lines after the heading and before the first table line. */
function openingParagraph(): string {
  const lines = dataHandlingSection().split("\n").slice(1);
  const table = lines.findIndex((line) => line.startsWith("|"));
  return (table === -1 ? lines : lines.slice(0, table)).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * The bullets of the `## [0.5.0] - 2026-11-03` section of CHANGELOG.md, each joined with its continuation lines. The
 * 0.5.0 release PR moved the Unreleased entries, this one's included, under that heading.
 */
function unreleasedBullets(): string[] {
  const lines = read("CHANGELOG.md").split("\n");
  const from = lines.indexOf("## [0.5.0] - 2026-11-03");
  expect(from, "CHANGELOG.md has a ## [0.5.0] - 2026-11-03 section").toBeGreaterThanOrEqual(0);
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((line) => line.startsWith("## ["));
  const body = to === -1 ? rest : rest.slice(0, to);
  const bullets: string[] = [];
  for (const line of body) {
    if (line.startsWith("- ")) bullets.push(line);
    else if (line.startsWith("  ") && bullets.length > 0) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  return bullets;
}

describe("SECURITY.md names the run upload to pharn.dev", () => {
  it("AC-1: exactly one Data handling row starts `Run upload` and names both POSTs, the PUT, report.json, meta.json, commentUrl, the 404, id-token: write and upload: never", () => {
    const rows = dataHandlingRows().filter((cells) => cells[0]?.startsWith("Run upload"));
    expect(rows, "exactly one Data handling row whose Data cell starts `Run upload`").toHaveLength(1);
    const row = (rows[0] as string[]).join(" | ");
    for (const phrase of [
      "/api/v1/runs/upload-url",
      "PUT",
      "report.json",
      "meta.json",
      "commentUrl",
      "404",
      "id-token: write",
      "upload: never",
    ]) {
      expect(row, `the Run upload row names ${phrase}`).toContain(phrase);
    }
    // `/api/v1/runs` on its own, not only as the prefix of `/api/v1/runs/upload-url`.
    expect(row, "the Run upload row names /api/v1/runs on its own").toMatch(/\/api\/v1\/runs(?![\w/-])/);
  });

  it("AC-2: the section no longer says nothing else goes to Pharn or that the policy request is the one exception, and its opening paragraph names the org policy request and the run upload", () => {
    const anythingElse = dataHandlingRows().filter(
      (cells) => cells[0] === "Anything else sent to Pharn" && (cells[1] ?? "").startsWith("Nothing"),
    );
    expect(anythingElse, "no `Anything else sent to Pharn | Nothing` row").toHaveLength(0);

    const section = dataHandlingSection().replace(/\s+/g, " ");
    const oneException =
      section.includes("The one exception") && section.includes("sends only an OIDC token and the repository name");
    expect(oneException, "the 'one exception … sends only an OIDC token and the repository name' claim is gone").toBe(
      false,
    );

    const opening = openingParagraph();
    expect(opening, "the opening paragraph names the org policy request").toMatch(/org policy request/i);
    expect(opening, "the opening paragraph names the run upload").toMatch(/run upload/i);
  });
});

describe("README and CHANGELOG point at the run upload's disclosure", () => {
  it("AC-3: the README pointer to SECURITY.md#data-handling says what it sends to your GitHub and to pharn.dev, and Unreleased has a bullet naming SECURITY.md and the run upload", () => {
    const lines = read("README.md").split("\n");
    const at = lines.findIndex((line) => line.includes("(SECURITY.md#data-handling)"));
    expect(at, "README.md links SECURITY.md#data-handling").toBeGreaterThan(0);
    const pointer = `${lines[at - 1] ?? ""} ${lines[at]}`.replace(/\s+/g, " ");
    expect(pointer, "the pointer says what it sends to your GitHub and to pharn.dev").toMatch(
      /sends to your GitHub and to pharn\.dev/,
    );

    const bullets = unreleasedBullets().filter((b) => b.includes("SECURITY.md") && /run upload/i.test(b));
    expect(bullets.length, "an Unreleased bullet names SECURITY.md and the run upload").toBeGreaterThanOrEqual(1);
  });
});
