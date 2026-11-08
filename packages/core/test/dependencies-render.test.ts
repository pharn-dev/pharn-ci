import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/render/markdown.js";
import type { Report } from "../src/report.js";
import { dependencyCase, run } from "./dependencies-helpers.js";

// A13 (dependency safety): the "📦 Dependencies" section of the comment. It appears only when the change added or changed
// a dependency (or something could not be checked), lists each finding with its hint once per id, and the 💬 Messages
// section then leaves out what it lists.

const section = (markdown: string): string => {
  const start = markdown.indexOf("### 📦 Dependencies");
  if (start === -1) return "";
  const next = markdown.indexOf("\n### ", start + 1);
  return markdown.slice(start, next === -1 ? undefined : next);
};

describe("the Dependencies section", () => {
  it("lists the findings blocks first with names, versions and one hint per id, and moves their message out of Messages", () => {
    const markdown = renderMarkdown(run(dependencyCase("d05-manifest")));
    expect(section(markdown)).toBe(
      [
        "### 📦 Dependencies",
        "",
        "5 added or changed dependencies checked · registry lookups off",
        "",
        "- ❌ **D05** `package.json:7` `from-git` — declared from a git repository",
        "  - Hint: Depend on a published registry version instead, or have a person review where the code comes from; a git, URL or local source is not covered by the registry's checks.",
        "- ❌ **D05** `package.json:8` `from-tarball` — declared from a URL outside the allowed registries",
        "- ❌ **D05** `package.json:9` `from-disk` — declared from a local file",
        "",
      ].join("\n"),
    );
    expect(markdown).not.toContain("DEPENDENCY_D05");
    expect(markdown).not.toContain("dependencies come from outside the allowed registries");
  });

  it("says when nothing was found, and shows the unread line with its hint", () => {
    expect(section(renderMarkdown(run(dependencyCase("clean-bump"))))).toBe(
      "### 📦 Dependencies\n\n4 added or changed dependencies checked · registry lookups off\n\nNo dependency findings.\n",
    );
    const unread = run(
      dependencyCase("d05-manifest", { dependencySources: { base: { unavailable: "x" }, head: { unavailable: "x" } } }),
    );
    const text = section(renderMarkdown(unread));
    expect(text).toContain(
      "- ⚠️ Not checked: 1 manifest or lockfile file could not be read, so dependency safety did not check it: \\`package.json\\` (unavailable).",
    );
    expect(text).toContain("  - Hint: Keep manifests and lockfiles valid and under 5 MiB");
  });

  it("has no section without a dependencies object, and treats a hand-built one as untrusted", () => {
    const report = run(dependencyCase("d05-manifest", { dependencySettings: { input: "never" } }));
    expect(renderMarkdown(report)).not.toContain("📦");
    const odd = { ...report, dependencies: { checked: 2, lookups: "weird", signals: "nope" } } as unknown as Report;
    expect(section(renderMarkdown(odd))).toBe(
      "### 📦 Dependencies\n\n2 added or changed dependencies checked · registry lookups off\n\nNo dependency findings.\n",
    );
  });
});
