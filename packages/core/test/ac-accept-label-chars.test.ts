import { describe, expect, it } from "vitest";
import { carriesAcceptLabel, DEFAULT_ACCEPT_LABEL, validateAcceptLabel } from "../src/acceptLabel.js";
import { renderMarkdown } from "../src/render/markdown.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";

// Accept-label input hardening from the Epic 1 review: invisible format characters are refused, a spelling of the
// default in other letter case is the default, and names are compared case-insensitively over ASCII letters only.

/** One character by its code point; the invisible ones are never written literally in this file. */
const ch = (codePoint: number) => String.fromCodePoint(codePoint);

describe("the accept-label input", () => {
  it.each([
    ["a right-to-left override", `${ch(0x202e)}detpecca`],
    ["a zero-width space", `pharn/${ch(0x200b)}accepted`],
    ["a left-to-right isolate", `team/${ch(0x2066)}ok${ch(0x2069)}`],
    ["a byte order mark inside the name", `team/${ch(0xfeff)}ok`],
    ["a zero-width joiner", `team${ch(0x200d)}/ok`],
  ])("refuses a label with %s, naming no value", (_label, raw) => {
    const result = validateAcceptLabel(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/invisible formatting characters/);
      expect(result.error).not.toContain(raw.trim());
    }
  });

  it("keeps letters of other scripts, which are visible", () => {
    expect(validateAcceptLabel("команда/принято")).toEqual({ ok: true, label: "команда/принято" });
  });

  it.each(["PHARN/Accepted", "Pharn/ACCEPTED", " pharn/accepted "])("reads %j as the default label", (raw) => {
    expect(validateAcceptLabel(raw)).toEqual({ ok: true, label: DEFAULT_ACCEPT_LABEL });
  });
});

describe("label names compared as GitHub compares them", () => {
  it("ASCII letters match in any case", () => {
    expect(carriesAcceptLabel([{ name: "OK" }], "ok")).toBe(true);
  });
  it("the Kelvin sign is not the letter k", () => {
    expect(carriesAcceptLabel([{ name: `o${ch(0x212a)}` }], "ok")).toBe(false);
  });
});

describe("the renderer", () => {
  it("replaces bidirectional overrides and zero-width characters in a path with U+FFFD", async () => {
    const { check } = await import("../src/check.js");
    const base = check({
      version: "0.2.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    } as Parameters<typeof check>[0]);
    const report = {
      ...base,
      testIntegrity: {
        ...base.testIntegrity,
        signals: [
          { id: "TI01", severity: "warn", path: `src/${ch(0x202e)}sts.test.ts${ch(0x200b)}`, line: null, detail: "d" },
        ],
      },
    } as Report;
    const markdown = renderMarkdown(report);
    expect(markdown).toContain(`\`src/${ch(0xfffd)}sts.test.ts${ch(0xfffd)}\``);
    expect(markdown.includes(ch(0x202e)) || markdown.includes(ch(0x200b))).toBe(false);
  });
});
