import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// action.yml and the fixtures are read inside the test body: they are written by the build, after these tests.
// CORE-133: the README, CHANGELOG, THREAT-MODEL and LIMITS wording checks moved out; docs-contract.test.ts checks the
// README input row and its default.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const LABEL = "pharn/accepted";

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

describe("the accept label in action.yml and the fixtures", () => {
  it("AC-15: action.yml and fixtures/accept-label/ describe the accept label", () => {
    // action.yml: the input, not required, default pharn/accepted, with a description.
    const input = actionInput(read("action.yml"), "accept-label");
    expect(input.length, "action.yml declares accept-label").toBeGreaterThan(1);
    expect(input.some((line) => /^ {4}required: false\s*$/.test(line))).toBe(true);
    expect(input.some((line) => /^ {4}default: ["']?pharn\/accepted["']?\s*$/.test(line))).toBe(true);
    expect(input.some((line) => /^ {4}description: \S/.test(line))).toBe(true);

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
