import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CORE-95: the README config section, docs/LIMITS.md sections 5 and 7, the THREAT-MODEL residuals 6, 8, 9, 11, 12 and
// 37 (rewritten in place, numbers kept, no residual 7) with the new row C10, and the CHANGELOG say that a config the
// pull request edits is read at the merge base. The documents are read inside the test body.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** Lines joined with single spaces, so a phrase that wraps still matches. */
const flat = (text: string) => text.replace(/\s+/g, " ");

/** The text from the line starting with `start` to the next line matching `end` (exclusive). */
function section(text: string, start: string, end: RegExp): string {
  const lines = text.split("\n");
  const from = lines.findIndex((line) => line.startsWith(start));
  if (from === -1) throw new Error(`no line starts with ${start}`);
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((line) => end.test(line));
  return [lines[from], ...(to === -1 ? rest : rest.slice(0, to))].join("\n");
}

/** Each numbered item of THREAT-MODEL §3 by its number, with its continuation lines. */
function residuals(threat: string): Map<number, string> {
  const items = new Map<number, string>();
  let current: number | undefined;
  for (const line of section(threat, "## 3.", /^## 4\./).split("\n")) {
    const m = /^(\d+)\. /.exec(line);
    if (m) {
      current = Number(m[1]);
      items.set(current, line);
    } else if (current !== undefined && /^\s+\S/.test(line)) {
      items.set(current, `${items.get(current)} ${line.trim()}`);
    } else {
      current = undefined;
    }
  }
  return items;
}

describe("CORE-95 docs", () => {
  it("AC-14: README, LIMITS, THREAT-MODEL and CHANGELOG say a config the change edits is read at the merge base", () => {
    const config = flat(section(read("README.md"), "## Config", /^## /));
    expect(config).toContain("checked with the config as it is at the merge base; the edit applies after merge");
    expect(config).toContain("The change adds it: the check runs as if there were none");
    expect(config).toContain("`fetch-depth: 0`");
    expect(config).toContain("`--base`");
    expect(config).not.toContain("Exclusions come from the PR itself");

    const limits = read("docs/LIMITS.md");
    const five = flat(section(limits, "## 5.", /^## \d+\./));
    expect(five).toContain("**The config at the merge base, and what it does not cover.**");
    expect(five).not.toContain("The gate is only as honest as the config the PR carries");
    const seven = flat(section(limits, "## 7.", /^## \d+\./));
    expect(seven).toContain("mapped with the config's value at the merge base");

    const threat = read("docs/THREAT-MODEL.md");
    const items = residuals(threat);
    expect(items.has(7), "there is still no residual 7").toBe(false);
    for (const n of [6, 8, 9, 11, 12, 37]) {
      const text = items.get(n) ?? "";
      expect(text, `residual ${n}`).toContain("Closed in 0.12.0 (CORE-95)");
      expect(text, `residual ${n}`).toContain("What remains:");
      expect(text, `residual ${n}`).toContain("row C10");
    }
    const c10 = threat.split("\n").find((line) => line.startsWith("| C10 |")) ?? "";
    expect(c10).toContain("reads untrusted git objects");
    expect(c10).toContain("No new network call and no new write");
    expect(c10).toContain("no link is followed");

    const unreleased = section(read("CHANGELOG.md"), "## [Unreleased]", /^## \[/);
    const changed = flat(section(unreleased, "### Changed", /^### /));
    expect(changed).toContain(
      "**Breaking:** a pull request that edits the pharn-ci config in use is checked with the config as it is at the merge base",
    );
    expect(changed).toContain("(CORE-95)");
    expect(changed).toContain("Migration: merge a config change before the pull requests that rely on it.");
  });
});
