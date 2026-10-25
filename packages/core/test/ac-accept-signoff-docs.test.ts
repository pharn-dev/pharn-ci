import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The documents and fixtures are read inside the test body: they are written by the build, after these tests.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const LABEL = "pharn/accepted";
const MENTIONS_LABEL = /accept[- ]label|pharn\/accepted|TEST_INTEGRITY_ACCEPT/i;

/** The markdown split at every heading line (`#` to `####`), each part holding its heading and body. */
function sections(markdown: string): string[] {
  const parts: string[][] = [[]];
  for (const line of markdown.split("\n")) {
    if (/^#{1,4} /.test(line)) parts.push([]);
    parts.at(-1)?.push(line);
  }
  return parts.map((lines) => lines.join("\n"));
}

/** The sections of a document that mention the accept label, joined. */
const aboutTheLabel = (markdown: string) =>
  sections(markdown)
    .filter((part) => MENTIONS_LABEL.test(part))
    .join("\n");

/** The lines of action.yml's `accept-label` input: its key line and every deeper-indented line after it. */
function actionInput(yaml: string, name: string): string[] {
  const lines = yaml.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.trim() !== "" && !line.startsWith("    "));
  return [lines[start] as string, ...(end === -1 ? rest : rest.slice(0, end))];
}

type Event = { event?: string; actor?: { login?: string; type?: string } | null; label?: { name?: string } };
const labeled = (events: Event[]) => events.filter((e) => e.event === "labeled" && e.label?.name === LABEL);

describe("the accept label in action.yml, the docs and the fixtures", () => {
  it("AC-15: action.yml, README, CHANGELOG, THREAT-MODEL, LIMITS and fixtures/accept-label/ describe the accept label", () => {
    // action.yml: the input, not required, default pharn/accepted, with a description.
    const input = actionInput(read("action.yml"), "accept-label");
    expect(input.length, "action.yml declares accept-label").toBeGreaterThan(1);
    expect(input.some((line) => /^ {4}required: false\s*$/.test(line))).toBe(true);
    expect(input.some((line) => /^ {4}default: ["']?pharn\/accepted["']?\s*$/.test(line))).toBe(true);
    expect(input.some((line) => /^ {4}description: \S/.test(line))).toBe(true);

    // README: the input row, and a section about the accept label saying who applies it and where it is read from.
    const readme = read("README.md");
    expect(readme.split("\n").some((line) => line.startsWith("| `accept-label`"))).toBe(true);
    const readmeSection = sections(readme)
      .filter((part) => /^#{2,4} .*accept label/i.test(part))
      .join("\n");
    expect(readmeSection, "README has an accept label section").not.toBe("");
    expect(readmeSection).toMatch(/not the PR author/i);
    expect(readmeSection).toContain(".pharn/ci.yml");
    expect(readmeSection).toMatch(/\blabeled\b/);
    expect(readmeSection).toMatch(/\bunlabeled\b/);
    expect(readmeSection).toMatch(/(pull-requests|issues): read/);
    expect(readmeSection).toMatch(/\bCLI\b/);
    expect(readmeSection).toContain("merge_group");
    expect(readmeSection).toMatch(/\bpush\b/);

    // CHANGELOG: the 0.2.0 section names the input and both codes (before that release they sat under Unreleased).
    const changelog = read("CHANGELOG.md");
    const shippedStart = changelog.indexOf("## [0.2.0]");
    expect(shippedStart).toBeGreaterThan(-1);
    const afterShipped = changelog.slice(shippedStart + 1);
    const nextRelease = afterShipped.search(/\n## \[/);
    const shipped = nextRelease === -1 ? afterShipped : afterShipped.slice(0, nextRelease);
    for (const name of ["accept-label", "TEST_INTEGRITY_ACCEPTED", "TEST_INTEGRITY_ACCEPT_IGNORED"]) {
      expect(shipped, name).toContain(name);
    }

    // THREAT-MODEL: the events read, fail closed, the bot and author rules, the page cap, the PR-editable workflow.
    const threats = aboutTheLabel(read("docs/THREAT-MODEL.md"));
    expect(threats, "THREAT-MODEL mentions the accept label").not.toBe("");
    expect(threats).toMatch(/\bissue/i);
    expect(threats).toMatch(/\bevents\b/i);
    expect(threats).toMatch(/fail(s|ed|ing)? closed/i);
    expect(threats).toMatch(/\bbots?\b/i);
    expect(threats).toMatch(/\bauthor\b/i);
    expect(threats).toMatch(/\b10 pages\b|\bten pages\b|1,000|1000/i);
    expect(threats).toMatch(/workflow file/i);

    // LIMITS: a sign-off on the PR as a whole, not tied to a commit, kept by a later push; over 1,000 events not read.
    const limits = aboutTheLabel(read("docs/LIMITS.md"));
    expect(limits, "LIMITS mentions the accept label").not.toBe("");
    expect(limits).toMatch(/\bcommit\b/i);
    expect(limits).toMatch(/\bpush\b/i);
    expect(limits).toMatch(/1,000|1000/);

    // fixtures/accept-label/: the event lists of the cases the criteria name.
    const events = (name: string) => {
      const path = `fixtures/accept-label/${name}`;
      expect(existsSync(new URL(path, ROOT)), path).toBe(true);
      return JSON.parse(read(path)) as unknown;
    };
    const human = events("events-human.json") as Event[];
    expect(labeled(human).at(-1)?.actor).toEqual(expect.objectContaining({ login: "Reviewer-1", type: "User" }));
    const author = events("events-author.json") as Event[];
    expect(labeled(author).at(-1)?.actor?.login?.toLowerCase()).toBe("octo-author");
    expect(labeled(author).at(-1)?.actor?.type).toBe("User");
    const bot = events("events-bot.json") as Event[];
    expect(labeled(bot).at(-1)?.actor?.type).toBe("Bot");
    const none = events("events-no-matching-event.json") as Event[];
    expect(Array.isArray(none)).toBe(true);
    expect(labeled(none)).toEqual([]);
    for (const name of ["events-applied-twice-author-last.json", "events-applied-twice-reviewer-last.json"]) {
      expect(labeled(events(name) as Event[]), name).toHaveLength(2);
    }
    expect(Array.isArray(events("events-unreadable.json"))).toBe(false);
  });
});
