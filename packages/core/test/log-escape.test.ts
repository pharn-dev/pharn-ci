import { describe, expect, it } from "vitest";
import { escapeLogLine, escapeLogText } from "../src/text.js";
import { fixture } from "./helpers.js";

// CORE-39: the job-log escape every Action `info` line and every CLI stderr write goes through. The runner reads the
// log line by line (a line ends at \n, \r or \r\n) and honours `::command::data` at the start of a line after its
// leading whitespace, and `##[command]data` anywhere in a line.

interface Case {
  name: string;
  input: string;
  line: string;
  text: string;
}

const CASES: Case[] = JSON.parse(fixture("log-escape/cases.json"));

/** The lines the runner would read from the text. */
const runnerLines = (text: string) => text.split(/\r\n|\r|\n/);

/** True when no line the runner reads from the text could be a workflow command. */
function carriesNoCommand(text: string): boolean {
  return runnerLines(text).every((line) => !line.trimStart().startsWith("::") && !line.includes("##["));
}

describe("escapeLogLine", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(escapeLogLine(c.input)).toBe(c.line);
    expect(runnerLines(c.line)).toHaveLength(1);
    expect(carriesNoCommand(c.line)).toBe(true);
  });

  it("is idempotent", () => {
    for (const c of CASES) expect(escapeLogLine(c.line), c.name).toBe(c.line);
  });
});

describe("escapeLogText", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(escapeLogText(c.input)).toBe(c.text);
    expect(carriesNoCommand(c.text)).toBe(true);
  });

  it("is idempotent, and leaves an escaped line alone", () => {
    for (const c of CASES) {
      expect(escapeLogText(c.text), c.name).toBe(c.text);
      expect(escapeLogText(c.line), c.name).toBe(c.line);
    }
  });

  it("keeps a trailing newline and the lines of a multi-line message", () => {
    expect(escapeLogText("pharn-ci: one\n\nUsage:\n  pharn-ci check\n")).toBe(
      "pharn-ci: one\n\nUsage:\n  pharn-ci check\n",
    );
  });
});
