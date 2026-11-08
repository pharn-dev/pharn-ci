import { describe, expect, it } from "vitest";
import {
  failuresAllQuarantined,
  JUNIT_MAX_CASES,
  JUNIT_MAX_FILES,
  JUNIT_MAX_TOTAL_BYTES,
  type JunitSources,
  parseJunitSources,
  parseQuarantineList,
  tallyJunit,
} from "../src/index.js";
import { fixture } from "./helpers.js";

// Flaky tests (A6): several JUnit files under the run's caps, the tally under a quarantine list, and the quarantine list
// the CLI reads from --quarantine-file.

const file = (name: string, path = `reports/${name}`) => ({ path, text: fixture(`junit/${name}`) });
const caseXml = (n: number) =>
  `<testsuite name="s">${Array.from({ length: n }, (_, i) => `<testcase classname="c" name="t${i}"/>`).join("")}</testsuite>`;

describe("parseJunitSources", () => {
  it("parses every file in order and lists the refused ones with their reason, sorted by path", () => {
    const results = parseJunitSources({
      files: [
        file("basic.xml"),
        file("not-junit.xml", "z/not-junit.xml"),
        file("doctype.xml", "a/doctype.xml"),
        file("failing.xml"),
        file("malformed.xml", "m/malformed.xml"),
      ],
    });
    expect(results.parsed).toBe(2);
    expect(results.cases).toHaveLength(10);
    expect(results.cases[7]?.id).toBe("api.users::lists users");
    expect(results.invalid).toEqual([
      { path: "a/doctype.xml", reason: "doctype" },
      { path: "m/malformed.xml", reason: "malformed" },
      { path: "z/not-junit.xml", reason: "not-junit" },
    ]);
    expect(results.dropped).toEqual([]);
    expect(results.droppedCases).toBe(0);
    expect(results.notFound).toBe(false);
    expect(results.walkLimit).toBe(false);
  });

  it("says notFound when no file matched, and not when the walk stopped at its limit", () => {
    expect(parseJunitSources({ files: [] }).notFound).toBe(true);
    const walk = parseJunitSources({ files: [], walkLimit: true });
    expect(walk.notFound).toBe(false);
    expect(walk.walkLimit).toBe(true);
  });

  it("reads the first 50 files and drops the rest", () => {
    const files = Array.from({ length: JUNIT_MAX_FILES + 3 }, (_, i) => ({
      path: `r/${String(i).padStart(3, "0")}.xml`,
      text: caseXml(1),
    }));
    const results = parseJunitSources({ files });
    expect(results.parsed).toBe(JUNIT_MAX_FILES);
    expect(results.dropped).toEqual(["r/050.xml", "r/051.xml", "r/052.xml"]);
  });

  it("drops the file that goes past 25 MiB and every later one, and keeps what the reader dropped", () => {
    const big = `<testsuite>${" ".repeat(JUNIT_MAX_TOTAL_BYTES - 100)}</testsuite>`;
    const results = parseJunitSources({
      files: [
        { path: "a.xml", text: big },
        { path: "b.xml", text: caseXml(5) },
        { path: "c.xml", text: caseXml(1) },
        { path: "d.xml", dropped: "file-cap" },
      ],
    });
    expect(results.parsed).toBe(1);
    expect(results.dropped).toEqual(["b.xml", "c.xml", "d.xml"]);
    const fromReader = parseJunitSources({ files: [{ path: "x.xml", dropped: "byte-cap" }, file("basic.xml")] });
    expect(fromReader.parsed).toBe(0);
    expect(fromReader.dropped).toEqual(["reports/basic.xml", "x.xml"]);
  });

  it("keeps the first 20,000 test cases across files and counts the rest", () => {
    const results = parseJunitSources({
      files: [
        { path: "a.xml", text: caseXml(JUNIT_MAX_CASES - 2) },
        { path: "b.xml", text: caseXml(5) },
        { path: "c.xml", text: caseXml(1) },
      ],
    });
    expect(results.cases).toHaveLength(JUNIT_MAX_CASES);
    expect(results.droppedCases).toBe(4);
    expect(results.parsed).toBe(3);
  });
});

describe("tallyJunit and failuresAllQuarantined", () => {
  const sources: JunitSources = { files: [file("failing.xml"), file("basic.xml")] };
  const results = parseJunitSources(sources);

  it("counts failures and errors, and the quarantined ones by exact id", () => {
    const tally = tallyJunit(results, [
      "api.users::creates a user",
      "io.read::reads a file",
      "math.add::adds two numbers",
    ]);
    expect(tally).toEqual({
      testCount: 10,
      failed: 5,
      quarantinedFailures: 2,
      unquarantinedFailures: 3,
      quarantinedIds: ["api.users::creates a user", "io.read::reads a file"],
    });
    expect(tallyJunit(results, undefined).quarantinedFailures).toBe(0);
  });

  it("is true only when every failure is quarantined and every file was read whole", () => {
    const only = parseJunitSources({ files: [file("failing.xml")] });
    const both = ["api.users::creates a user", "api.orders::cancels an order"];
    expect(failuresAllQuarantined(only, tallyJunit(only, both))).toBe(true);
    expect(failuresAllQuarantined(only, tallyJunit(only, both.slice(0, 1)))).toBe(false);
    // No failure at all: the command failed for some other reason.
    const passing = parseJunitSources({ files: [{ path: "p.xml", text: caseXml(2) }] });
    expect(failuresAllQuarantined(passing, tallyJunit(passing, both))).toBe(false);
    // A refused or dropped file could hide an unquarantined failure.
    const withBad = parseJunitSources({ files: [file("failing.xml"), file("malformed.xml")] });
    expect(failuresAllQuarantined(withBad, tallyJunit(withBad, both))).toBe(false);
    const withDropped = parseJunitSources({ files: [file("failing.xml"), { path: "x.xml", dropped: "file-cap" }] });
    expect(failuresAllQuarantined(withDropped, tallyJunit(withDropped, both))).toBe(false);
    const walked = parseJunitSources({ files: [file("failing.xml")], walkLimit: true });
    expect(failuresAllQuarantined(walked, tallyJunit(walked, both))).toBe(false);
  });
});

describe("parseQuarantineList", () => {
  it("takes a JSON array of test ids", () => {
    expect(parseQuarantineList(JSON.parse(fixture("junit/quarantine.json")))).toEqual({
      ok: true,
      ids: ["api.users::creates a user", "api.orders::cancels an order", "api.other::never runs"],
    });
    expect(parseQuarantineList([])).toEqual({ ok: true, ids: [] });
  });

  it("refuses anything else with a fixed text that never repeats a value", () => {
    const secret = "do-not-echo";
    for (const bad of [{ ids: [] }, "x", null, [1], [""], [`a\n${secret}`], ["x".repeat(1025)]]) {
      const result = parseQuarantineList(bad);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(parseQuarantineList(Array.from({ length: 10_001 }, () => "a")).ok).toBe(false);
  });
});
