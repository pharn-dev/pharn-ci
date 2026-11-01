import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// renderMarkdown() is loaded from @pharn-ci/core inside the test body: the AC test is written before the appHint
// option and the UPLOAD_TOO_LARGE hint exist, so nothing the build adds may run while this file loads.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const HINT = "Install the Pharn GitHub App for org policy, history and flaky detection.";

type Json = Record<string, unknown>;

interface RenderCore {
  renderMarkdown(report: unknown, options?: { maxRows?: number; appHint?: boolean }): string;
}

const golden = () => JSON.parse(read("fixtures/golden/report.json")) as Json;

// Core's index loads cold, which can take seconds on a loaded host.
describe("the app hint and the UPLOAD_TOO_LARGE hint in the rendering", { timeout: 60_000 }, () => {
  it("AC-8: appHint true puts the install line and an empty line last before the footer's ---, absent or false is byte-identical, and UPLOAD_TOO_LARGE renders its hint", async () => {
    const { renderMarkdown } = (await import("@pharn-ci/core")) as unknown as RenderCore;
    const report = golden();
    const plain = renderMarkdown(report);

    const hinted = renderMarkdown(report, { appHint: true });
    const lines = hinted.split("\n");
    const footer = lines.lastIndexOf("---");
    expect(footer).toBeGreaterThan(1);
    expect(lines[footer - 2]).toBe(HINT);
    expect(lines[footer - 1]).toBe("");
    expect(lines.filter((l) => l === HINT)).toHaveLength(1);
    // Nothing else moves: removing the two lines gives the plain rendering.
    expect([...lines.slice(0, footer - 2), ...lines.slice(footer)].join("\n")).toBe(plain);

    expect(plain).not.toContain(HINT);
    expect(renderMarkdown(report, {})).toBe(plain);
    expect(renderMarkdown(report, { appHint: false })).toBe(plain);
    expect(renderMarkdown(report, { maxRows: 1, appHint: false })).toBe(renderMarkdown(report, { maxRows: 1 }));

    // A report carrying UPLOAD_TOO_LARGE renders a hint of at least 10 characters under the message.
    const tooLarge = {
      ...report,
      verdict: "fail",
      messages: [
        ...(report.messages as Json[]),
        {
          level: "warn",
          code: "UPLOAD_TOO_LARGE",
          text: "The run was not uploaded to pharn.dev: the report is larger than the upload limit. The check ran in full; only the history on pharn.dev misses this run.",
        },
      ],
    };
    const tooLargeLines = renderMarkdown(tooLarge).split("\n");
    const at = tooLargeLines.findIndex((l) => l.includes("`UPLOAD_TOO_LARGE`"));
    expect(at).toBeGreaterThan(-1);
    const hint = /^ {2}- Hint: (.+)$/.exec(tooLargeLines[at + 1] ?? "");
    expect(hint, tooLargeLines[at + 1]).not.toBeNull();
    expect((hint?.[1] ?? "").trim().length).toBeGreaterThanOrEqual(10);
  });
});
