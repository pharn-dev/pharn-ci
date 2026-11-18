import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every relative link and #anchor in every tracked Markdown file resolves (CORE-137). External http(s) and mailto
// links are not fetched: no network. An anchor is checked against the headings of the target Markdown file, slugged
// the way GitHub does, and against explicit `id`/`name` anchors in its HTML.
//
// Left out:
// - `pharn/`, `.claude/`, `.agents/`, `.codex/` and `.phargus/`: PHARN workflow and agent tooling, not part of
//   pharn-ci (CLAUDE.md); vendored copies whose links point into their own upstream repositories.
// - `fixtures/`: test inputs and golden outputs; their links are renderer output or deliberate test data.

const ROOT = new URL("../../../", import.meta.url);
const EXCLUDED = ["pharn/", ".claude/", ".agents/", ".codex/", ".phargus/", "fixtures/"];

const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8").replace(/\r\n/g, "\n");

/** The tracked Markdown files outside the excluded trees, repo-relative. */
function markdownFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", "*.md"], { cwd: new URL(".", ROOT), encoding: "utf8" });
  return out.split("\0").filter((path) => path !== "" && !EXCLUDED.some((dir) => path.startsWith(dir)));
}

/** The lines outside fenced code blocks, with inline code spans blanked so a link inside one is not read. */
function proseLines(markdown: string): string[] {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const marker = /^\s*(?:>\s*)*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker[0] as string;
      else if (marker[0] === fence) fence = null;
      lines.push("");
      continue;
    }
    lines.push(fence === null ? line.replace(/`+[^`]*`+/g, (span) => " ".repeat(span.length)) : "");
  }
  return lines;
}

/** GitHub's heading slug: lower case, punctuation dropped (letters, marks, digits, `_`, `-` and spaces kept). */
function slug(heading: string): string {
  // HTML tags in headings are not handled (no heading here has one); `<` and `>` are punctuation and drop out below.
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim()
    .toLowerCase();
  return text.replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
}

/** Every anchor a Markdown file defines: its heading slugs (with GitHub's -1, -2 suffixes) and HTML ids. */
function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const marker = /^\s*(?:>\s*)*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker[0] as string;
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^(?:>\s*)*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (heading !== undefined) {
      const base = slug(heading);
      const count = seen.get(base) ?? 0;
      anchors.add(count === 0 ? base : `${base}-${count}`);
      seen.set(base, count + 1);
    }
    for (const m of line.matchAll(/\s(?:id|name)="([^"]+)"/g)) anchors.add(m[1] as string);
  }
  return anchors;
}

/** The link targets of a Markdown file with their line numbers: inline links, images, references and HTML src/href. */
function linksOf(markdown: string): { line: number; target: string }[] {
  const links: { line: number; target: string }[] = [];
  proseLines(markdown).forEach((text, index) => {
    const add = (target: string) => links.push({ line: index + 1, target: target.trim() });
    for (const m of text.matchAll(/\]\(\s*<([^>]*)>[^)]*\)|\]\(\s*([^)\s]*)(?:\s+"[^"]*")?\s*\)/g))
      add(m[1] ?? m[2] ?? "");
    const ref = /^\s{0,3}\[[^\]]+\]:\s+<?([^>\s]+)>?/.exec(text)?.[1];
    if (ref !== undefined) add(ref);
    for (const m of text.matchAll(/\s(?:src|href)="([^"]+)"/g)) add(m[1] as string);
  });
  return links;
}

/** Why a link does not resolve, or null when it does. */
function brokenReason(from: string, target: string, anchorCache: Map<string, Set<string>>): string | null {
  if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const [rawPath = "", anchor] = target.split("#", 2) as [string, string | undefined];
  const pathPart = decodeURIComponent(rawPath.split("?")[0] as string);
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
  const resolved =
    pathPart === "" ? from : new URL(pathPart.startsWith("/") ? `.${pathPart}` : `${dir}${pathPart}`, ROOT);
  const url = typeof resolved === "string" ? new URL(resolved, ROOT) : resolved;
  const key = url.href;
  let anchors = anchorCache.get(key);
  if (anchors === undefined) {
    // One read decides both questions (no check-then-read): a directory throws EISDIR, a missing path ENOENT.
    let text = "";
    try {
      text = readFileSync(url, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EISDIR") return "no such file";
    }
    anchors = anchorsOf(text.replace(/\r\n/g, "\n"));
    anchorCache.set(key, anchors);
  }
  if (anchor === undefined || anchor === "" || !url.pathname.endsWith(".md")) return null;
  return anchors.has(decodeURIComponent(anchor).toLowerCase()) ? null : `no heading #${anchor}`;
}

describe("docs links", () => {
  it("slugs headings the way GitHub does", () => {
    expect(slug("Upload to pharn.dev (optional)")).toBe("upload-to-pharndev-optional");
    expect(slug("P13, agent self-modification")).toBe("p13-agent-self-modification");
    expect(slug("Fork PRs: comment from workflow_run")).toBe("fork-prs-comment-from-workflow_run");
    expect(slug("What it proves, and what it does not")).toBe("what-it-proves-and-what-it-does-not");
    expect(slug("3. Skylos nine: what pharn-ci catches")).toBe("3-skylos-nine-what-pharn-ci-catches");
    expect(slug("`report.json` fields")).toBe("reportjson-fields");
    expect([...anchorsOf("## A\n\n```\n## B\n```\n\n## A\n")]).toEqual(["a", "a-1"]);
  });

  it("finds a broken path and a broken anchor, and skips external links and code", () => {
    const links = linksOf("[a](https://x.dev/y) `[b](nope.md)`\n[c](README.md#nope) [d](missing.md)\n");
    expect(links.map((link) => link.target)).toEqual(["https://x.dev/y", "README.md#nope", "missing.md"]);
    const cache = new Map<string, Set<string>>();
    expect(brokenReason("README.md", "https://x.dev/y", cache)).toBeNull();
    expect(brokenReason("README.md", "README.md#nope", cache)).toBe("no heading #nope");
    expect(brokenReason("README.md", "missing.md", cache)).toBe("no such file");
  });

  it("every relative link and anchor in the tracked Markdown files resolves", () => {
    const files = markdownFiles();
    expect(files, "README.md is checked").toContain("README.md");
    expect(files, "the docs/ chapters are checked").toContain("docs/action.md");
    const cache = new Map<string, Set<string>>();
    const all = files.flatMap((file) => linksOf(read(file)).map((link) => ({ file, ...link })));
    const anchored = all.filter(({ target }) => !/^[a-z][a-z0-9+.-]*:/i.test(target) && target.includes("#"));
    expect(anchored.length, "relative links with an anchor are checked").toBeGreaterThan(50);
    const broken = files.flatMap((file) =>
      linksOf(read(file)).flatMap(({ line, target }) => {
        const reason = brokenReason(file, target, cache);
        return reason === null ? [] : [`${file}:${line} ${target} (${reason})`];
      }),
    );
    expect(broken).toEqual([]);
  });
});
