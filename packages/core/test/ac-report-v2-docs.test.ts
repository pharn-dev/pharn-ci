import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url);
const readRoot = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

describe("Report v2 is documented as a breaking release for report consumers", () => {
  it("AC-9: RELEASING.md, the CHANGELOG's Unreleased section and action.yml name Report v2", () => {
    const releasing = readRoot("docs/RELEASING.md");
    const paragraphs = releasing.split(/\n\s*\n/);
    const breaking = paragraphs.find(
      (paragraph) => paragraph.includes("0.2.0") && /breaking/i.test(paragraph) && paragraph.includes("schemaVersion"),
    );
    expect(breaking, "a RELEASING.md paragraph names 0.2.0, breaking and schemaVersion").toBeDefined();

    const changelog = readRoot("CHANGELOG.md");
    const start = changelog.indexOf("## [Unreleased]");
    expect(start, "CHANGELOG has an Unreleased section").toBeGreaterThanOrEqual(0);
    const next = changelog.indexOf("\n## [", start + 1);
    const unreleased = changelog.slice(start, next === -1 ? undefined : next);
    expect(unreleased).toContain("Report v2");
    expect(unreleased).toContain("schemaVersion");

    const action = readRoot("action.yml");
    const outputs = action.slice(action.indexOf("\noutputs:"));
    expect(outputs.length, "action.yml has an outputs block").toBeGreaterThan(0);
    const block = outputs.slice(outputs.indexOf("report-path:"));
    const line = block.split("\n").find((l) => l.trim().startsWith("description:")) ?? "";
    expect(line).toContain("Report v2");
    expect(line).toContain("schema/report.v2.json");
  });
});
