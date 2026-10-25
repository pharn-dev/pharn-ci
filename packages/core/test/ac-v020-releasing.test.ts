import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-readiness-v020: docs/RELEASING.md gains the fork-PR check before **Release.**, the post-release Release
// smoke job and the smoke run in the dry run, keeping every earlier heading and step lead. Files are read inside the
// test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Current main before this increment: the base for the "still present" checks. */
const BEFORE = "b2c3a56373046ee6b64f913581a645f98240310c";

const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const ITEM = /^\s*(?:[-*]|\d+\.)\s+/;

type Block = { kind: "item" | "paragraph"; text: string };

/**
 * Split lines into list items (a `-`, `*` or `N.` marker at any indent starts one; continuation lines joined) and
 * paragraphs (runs of other non-blank, non-heading lines). Text is whitespace-normalized; an item's text drops its
 * marker.
 */
function blocks(section: string[]): Block[] {
  const out: Block[] = [];
  let current: { kind: Block["kind"]; parts: string[] } | null = null;
  const flush = () => {
    if (current) out.push({ kind: current.kind, text: normalize(current.parts.join(" ")) });
    current = null;
  };
  for (const line of section) {
    if (ITEM.test(line)) {
      flush();
      current = { kind: "item", parts: [line.replace(ITEM, "")] };
    } else if (line.trim() === "" || line.startsWith("#")) {
      flush();
    } else if (current) {
      current.parts.push(line);
    } else {
      current = { kind: "paragraph", parts: [line] };
    }
  }
  flush();
  return out;
}

/** A `## ` section's lines, heading excluded, up to the next `## ` heading. */
function h2Body(text: string, heading: string): string[] {
  const all = lines(text);
  const start = all.indexOf(heading);
  if (start === -1) throw new Error(`docs/RELEASING.md has no "${heading}" heading`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

const leadingBold = (text: string) => /^\*\*(.+?)\*\*/.exec(text)?.[0];

describe("release-readiness-v020: docs/RELEASING.md", () => {
  it("AC-9: a fork / job summary / comment item comes before **Release.**, the Release smoke and dry-run smoke steps are written, and every earlier ## heading and item lead is kept", () => {
    const now = readFileSync(`${ROOT}docs/RELEASING.md`, "utf8");
    const before = execFileSync("git", ["show", `${BEFORE}:docs/RELEASING.md`], { cwd: ROOT, encoding: "utf8" });

    const items = blocks(h2Body(now, "## Cutting a release")).filter((b) => b.kind === "item");
    const release = items.findIndex((item) => item.text.startsWith("**Release.**"));
    expect(release, "an item starting **Release.**").toBeGreaterThan(-1);
    const fork = items.findIndex((item) => {
      const t = item.text.toLowerCase();
      return t.includes("fork") && t.includes("job summary") && t.includes("comment");
    });
    expect(fork, "an item with fork, job summary and comment").toBeGreaterThan(-1);
    expect(fork).toBeLessThan(release);

    const all = blocks(lines(now));
    expect(
      all.some(
        (b) =>
          b.text.includes("Release smoke") &&
          b.text.includes("node scripts/smoke-release.mjs") &&
          b.text.includes("Marketplace"),
      ),
      "a paragraph or item with Release smoke, node scripts/smoke-release.mjs and Marketplace",
    ).toBe(true);
    expect(
      all.some((b) => {
        const t = b.text.toLowerCase();
        return t.includes("smoke") && t.includes("dry run");
      }),
      "a paragraph or item with smoke and dry run",
    ).toBe(true);

    const nowLines = new Set(lines(now));
    const oldHeadings = lines(before).filter((line) => line.startsWith("## "));
    expect(oldHeadings.length).toBeGreaterThan(0);
    for (const heading of oldHeadings) expect(nowLines.has(heading), heading).toBe(true);

    const nowLeads = new Set(all.filter((b) => b.kind === "item").map((b) => leadingBold(b.text)));
    const oldLeads = blocks(lines(before))
      .filter((b) => b.kind === "item")
      .map((b) => leadingBold(b.text))
      .filter((lead): lead is string => lead !== undefined);
    expect(oldLeads.length).toBeGreaterThan(0);
    for (const lead of oldLeads) expect(nowLeads.has(lead), lead).toBe(true);
  });
});
