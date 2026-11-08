import { describe, expect, it } from "vitest";
import {
  type CheckInput,
  check,
  type JunitSources,
  parseJunitSources,
  type Report,
  type ResolvedPolicy,
  renderMarkdown,
} from "../src/index.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Flaky tests (A6) through check(): the report's flaky object, the JUnit messages and the Flaky section, validated
// against schema/report.v2.json. Test results never make a check fail.

const file = (name: string, path = `reports/${name}`) => ({ path, text: fixture(`junit/${name}`) });
const QUARANTINE = ["api.users::creates a user", "api.orders::cancels an order", "io.read::reads a file"];

function input(sources?: JunitSources, extra: Partial<CheckInput> = {}): CheckInput {
  return {
    version: "0.8.0",
    coverage: { text: "SF:src/a.ts\nDA:1,1\nend_of_record\n", format: "lcov" },
    diff: { parsed: [{ path: "src/a.ts", oldPath: "src/a.ts", status: "modified", addedLines: [1] }] },
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
    ...(sources === undefined ? {} : { junit: parseJunitSources(sources) }),
    ...extra,
  };
}

/** The JUnit messages of a report, as level and code (the report also says diff coverage is not gated). */
const junitMessages = (report: Report) =>
  report.messages.filter((m) => m.code.startsWith("JUNIT_") || m.code.startsWith("FLAKY_"));
const codes = (report: Report) => junitMessages(report).map((m) => [m.level, m.code]);
const firstText = (report: Report) => junitMessages(report)[0]?.text ?? "";

describe("check() with JUnit results", () => {
  it("adds nothing without JUnit: the report is the one it was", () => {
    const without = check(input());
    expect(without.flaky).toBeUndefined();
    expect(JSON.stringify(without)).toBe(JSON.stringify(check({ ...input(), quarantine: QUARANTINE })));
    expectValidReport(without);
  });

  it("fills flaky from the parsed files and applies the quarantine list", () => {
    const report = check(input({ files: [file("failing.xml"), file("basic.xml")] }, { quarantine: QUARANTINE }));
    expectValidReport(report);
    expect(report.flaky).toEqual({
      uploaded: false,
      testCount: 10,
      failed: 5,
      quarantined: ["api.orders::cancels an order", "api.users::creates a user", "io.read::reads a file"],
      quarantinedFailures: 3,
      unquarantinedFailures: 2,
    });
    expect(codes(report)).toEqual([["info", "FLAKY_QUARANTINED_FAILURES"]]);
    expect(firstText(report)).toBe(
      "3 of 5 failed tests are on the org's quarantine list. pharn-ci never fails a check because a test failed; the test step decides.",
    );
    // Five failed tests and the verdict is still a pass: pharn-ci never fails because a test failed.
    expect(report.verdict).toBe("pass");
    // The key sits after setupHealth and before meta, as the schema orders it.
    expect(Object.keys(report).at(-1)).toBe("flaky");
  });

  it("applies no quarantine when the org policy sets flaky.quarantine to false", () => {
    const policy: ResolvedPolicy = {
      source: "app",
      version: 3,
      fetchedAt: "2026-11-08T00:00:00.000Z",
      document: { version: 1, flaky: { quarantine: false } },
    };
    const report = check(input({ files: [file("failing.xml")] }, { quarantine: QUARANTINE, policy }));
    expectValidReport(report);
    expect(report.flaky?.quarantinedFailures).toBe(0);
    expect(report.flaky?.unquarantinedFailures).toBe(2);
    expect(report.flaky?.quarantined).toEqual([]);
    expect(report.messages.some((m) => m.code === "FLAKY_QUARANTINED_FAILURES")).toBe(false);
    // flaky.quarantine true, or no flaky key, applies the list.
    const on = check(
      input(
        { files: [file("failing.xml")] },
        { quarantine: QUARANTINE, policy: { ...policy, document: { version: 1 } } },
      ),
    );
    expect(on.flaky?.quarantinedFailures).toBe(2);
  });

  it("warns JUNIT_NOT_FOUND when nothing matched, with no flaky object", () => {
    const report = check(input({ files: [] }));
    expectValidReport(report);
    expect(report.flaky).toBeUndefined();
    expect(codes(report)).toEqual([["warn", "JUNIT_NOT_FOUND"]]);
    expect(report.verdict).toBe("warn");
  });

  it("warns JUNIT_INVALID with the paths and reason words, never the file text", () => {
    const report = check(
      input({ files: [file("failing.xml"), file("doctype.xml"), file("malformed.xml"), file("not-junit.xml")] }),
    );
    expectValidReport(report);
    expect(codes(report)).toEqual([["warn", "JUNIT_INVALID"]]);
    const text = firstText(report);
    expect(
      text.startsWith(
        "3 JUnit XML files were not used: `reports/doctype.xml` (doctype), `reports/malformed.xml` (malformed), `reports/not-junit.xml` (not-junit).",
      ),
    ).toBe(true);
    expect(text).not.toContain("lol");
    expect(report.flaky?.testCount).toBe(3);
  });

  it("names up to 10 refused files, then +N more", () => {
    const files = Array.from({ length: 12 }, (_, i) => ({ path: `r/${String(i).padStart(2, "0")}.xml`, text: "x" }));
    const text = firstText(check(input({ files })));
    expect(text).toContain("`r/09.xml` (not-junit), +2 more.");
    expect(text).not.toContain("r/10.xml");
  });

  it("warns JUNIT_TOO_LARGE for files and cases over the caps and for a walk limit", () => {
    const many = `<testsuite>${'<testcase name="t"/>'.repeat(20_001)}</testsuite>`;
    const report = check(
      input({
        files: [
          { path: "a.xml", text: many },
          { path: "b.xml", dropped: "file-cap" },
        ],
      }),
    );
    expectValidReport(report);
    expect(codes(report)).toEqual([["warn", "JUNIT_TOO_LARGE"]]);
    expect(firstText(report)).toBe(
      "The JUnit results are over the limits of one run (50 files, 25 MiB, 20,000 test cases): 1 file and 1 test case left out.",
    );
    const walked = check(input({ files: [], walkLimit: true }));
    expect(codes(walked)).toEqual([["warn", "JUNIT_TOO_LARGE"]]);
    expect(firstText(walked)).toBe(
      "The JUnit results are over the limits of one run (50 files, 25 MiB, 20,000 test cases). The search for JUnit files stopped at its limit, so some may not have been found.",
    );
  });

  it("caps flaky.quarantined at 200 ids while the counts stay whole", () => {
    const xml = `<testsuite name="s">${Array.from({ length: 250 }, (_, i) => `<testcase classname="c" name="t${String(i).padStart(3, "0")}"><failure/></testcase>`).join("")}</testsuite>`;
    const ids = Array.from({ length: 250 }, (_, i) => `c::t${String(i).padStart(3, "0")}`);
    const report = check(input({ files: [{ path: "a.xml", text: xml }] }, { quarantine: ids }));
    expectValidReport(report);
    expect(report.flaky?.quarantined).toHaveLength(200);
    expect(report.flaky?.quarantined.at(-1)).toBe("c::t199");
    expect(report.flaky?.quarantinedFailures).toBe(250);
  });
});

describe("the Flaky section", () => {
  it("shows the counts and the quarantined ids, and leaves FLAKY_QUARANTINED_FAILURES out of the messages", () => {
    const report = check(input({ files: [file("failing.xml"), file("basic.xml")] }, { quarantine: QUARANTINE }));
    const md = renderMarkdown(report);
    expect(md).toContain(
      [
        "### 🧫 Flaky",
        "",
        "10 tests · 5 failed · 3 of 5 failures quarantined",
        "",
        "<details><summary>Quarantined failures (3)</summary>",
        "",
        "- `api.orders::cancels an order`",
        "- `api.users::creates a user`",
        "- `io.read::reads a file`",
        "",
        "</details>",
        "",
        "_Test results never change the verdict: the test step fails the job for a failed test._",
        "",
      ].join("\n"),
    );
    expect(md).not.toContain("FLAKY_QUARANTINED_FAILURES");
    // The section comes before the agent setup inventory.
    expect(md.indexOf("### 🧫 Flaky")).toBeLessThan(md.indexOf("### 🤖 Agent setup"));
  });

  it("says none failed for a green run and lists nothing", () => {
    const md = renderMarkdown(
      check(input({ files: [{ path: "a.xml", text: '<testsuite><testcase name="a"/></testsuite>' }] })),
    );
    expect(md).toContain("### 🧫 Flaky\n\n1 test · none failed\n\n");
    expect(md).not.toContain("Quarantined failures");
    expect(md).not.toContain("never change the verdict");
  });

  it("puts a hostile test id in one code span", () => {
    const xml =
      '<testsuite><testcase classname="a`b|c" name="@user [x](http://e.io) &lt;b&gt;"><failure/></testcase></testsuite>';
    const report = check(
      input({ files: [{ path: "a.xml", text: xml }] }, { quarantine: ["a`b|c::@user [x](http://e.io) <b>"] }),
    );
    const md = renderMarkdown(report);
    expect(md).toContain("- `a'b\\|c::@user [x](http://e.io) <b>`");
  });

  it("renders nothing for a malformed flaky object of a hand-built report", () => {
    const report = check(input({ files: [file("failing.xml")] }));
    const bad = { ...report, flaky: { ...report.flaky, testCount: -1 } } as Report;
    expect(renderMarkdown(bad)).not.toContain("🧫");
    expect(
      renderMarkdown({ ...report, flaky: { ...report.flaky, quarantined: [1] } } as unknown as Report),
    ).not.toContain("🧫");
  });
});
