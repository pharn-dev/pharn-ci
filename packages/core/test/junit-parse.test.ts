import { describe, expect, it } from "vitest";
import {
  collapseWhitespace,
  JUNIT_MAX_DEPTH,
  JUNIT_MESSAGE_READ_UNITS,
  junitTestId,
  parseJunitXml,
  TEST_ID_MAX_UNITS,
} from "../src/index.js";
import { fixture } from "./helpers.js";

// Flaky tests (A6): the JUnit XML reader and the test id. Inputs are the hand-written files in fixtures/junit/.

const parsed = (name: string) => {
  const result = parseJunitXml(fixture(`junit/${name}`), 20_000);
  if (!result.ok) throw new Error(`${name}: ${result.reason}`);
  return result;
};

describe("parseJunitXml reads testsuites, testsuite and testcase", () => {
  it("reads every status, the time and the failure message of a jest-junit style file", () => {
    const { cases, dropped } = parsed("basic.xml");
    expect(dropped).toBe(0);
    expect(cases.map((c) => [c.id, c.status, c.time])).toEqual([
      ["math.add::adds two numbers", "passed", 0.012],
      ["math.add::adds <negative> numbers & zero", "failed", 0.004],
      ["math.div::divides", "skipped", null],
      ["math.div::divides by zero", "passed", 0.001],
      ["io.read::reads a file", "error", 0.2],
      ["io.read::reads a stream", "failed", 0.3],
      ["io.write::writes", "passed", 0.25],
    ]);
    expect(cases[1]?.message).toBe("expected 3 to be 4");
    expect(cases[4]?.message).toBe("ENOENT: no such file");
    // No message attribute: the failure's text.
    expect(cases[5]?.message).toBe("stream ended early");
    expect(cases.every((c) => c.status === "failed" || c.status === "error" || c.message === undefined)).toBe(true);
    expect(cases.map((c) => c.suite)).toEqual(["math", "math", "math", "math", "io", "io", "io"]);
  });

  it("never keeps system-out or system-err", () => {
    const text = JSON.stringify(parsed("basic.xml"));
    expect(text).not.toContain("must never be kept");
    expect(JSON.stringify(parsed("cdata.xml"))).not.toContain("never kept");
  });

  it("takes a CDATA failure body as the message when there is no message attribute", () => {
    const [only] = parsed("cdata.xml").cases;
    expect(only?.status).toBe("failed");
    expect(only?.message).toBe("expected:<1> but was:<2>\n\tat com.acme.FooTest.bar(FooTest.java:10)");
  });

  it("falls back from classname to file to the innermost suite, collapses whitespace and ranks error over failure over skip", () => {
    const { cases } = parsed("nested.xml");
    expect(cases.map((c) => [c.id, c.status])).toEqual([
      ["inner suite::no classname, falls back to the suite", "passed"],
      ["tests/test_api.py::test_get ok", "passed"],
      ["pkg.Mod::spaced name", "failed"],
      ["outer::back in outer", "passed"],
      ["pkg.Err::error beats failure", "error"],
      // Surefire's flakyFailure: the test passed on a rerun.
      ["pkg.Flaky::passed on rerun", "passed"],
    ]);
    expect(cases[2]?.message).toBe("fails after the skip");
    expect(cases[4]?.message).toBe("second");
    expect(cases[1]?.classname).toBe("tests/test_api.py");
  });

  it("keeps at most maxCases cases and counts the rest", () => {
    const result = parseJunitXml(fixture("junit/basic.xml"), 3);
    expect(result.ok && result.cases.length).toBe(3);
    expect(result.ok && result.dropped).toBe(4);
  });

  it("cuts a long message while reading", () => {
    const long = "m".repeat(JUNIT_MESSAGE_READ_UNITS + 100);
    const xml = `<testsuite><testcase name="a"><failure message="${long}"/></testcase><testcase name="b"><failure>${long}</failure></testcase></testsuite>`;
    const result = parseJunitXml(xml, 10);
    expect(result.ok && result.cases.map((c) => c.message?.length)).toEqual([
      JUNIT_MESSAGE_READ_UNITS,
      JUNIT_MESSAGE_READ_UNITS,
    ]);
  });

  it("reads a file with no test case as zero tests", () => {
    expect(parseJunitXml('<?xml version="1.0"?>\n<testsuites/>\n', 10)).toEqual({ ok: true, cases: [], dropped: 0 });
  });
});

describe("parseJunitXml refuses what it does not read", () => {
  it("refuses a DOCTYPE with entities whole (doctype), never expanding one", () => {
    expect(parseJunitXml(fixture("junit/doctype.xml"), 10)).toEqual({ ok: false, reason: "doctype" });
    expect(parseJunitXml('<!ENTITY x "y"><testsuite/>', 10)).toEqual({ ok: false, reason: "doctype" });
  });

  it("refuses broken nesting and a truncated file (malformed)", () => {
    expect(parseJunitXml(fixture("junit/malformed.xml"), 10)).toEqual({ ok: false, reason: "malformed" });
    expect(parseJunitXml('<testsuites><testsuite name="a"><testcase name="b"/>', 10)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(parseJunitXml("<testsuite/><testsuite/>", 10)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a file whose root is not testsuites or testsuite (not-junit)", () => {
    expect(parseJunitXml(fixture("junit/not-junit.xml"), 10)).toEqual({ ok: false, reason: "not-junit" });
    expect(parseJunitXml("", 10)).toEqual({ ok: false, reason: "not-junit" });
    expect(parseJunitXml("just text", 10)).toEqual({ ok: false, reason: "not-junit" });
  });

  it("refuses nesting deeper than 256 (too-deep)", () => {
    const deep = (n: number) => `<testsuites>${"<x>".repeat(n - 1)}${"</x>".repeat(n - 1)}</testsuites>`;
    expect(parseJunitXml(deep(JUNIT_MAX_DEPTH), 10).ok).toBe(true);
    expect(parseJunitXml(deep(JUNIT_MAX_DEPTH + 1), 10)).toEqual({ ok: false, reason: "too-deep" });
  });
});

describe("junitTestId", () => {
  it("is <classname>::<name>, with the file and the suite as fallbacks and the name alone when all are empty", () => {
    expect(junitTestId({ classname: "a.B", file: "f.py", suite: "s", name: "n" })).toBe("a.B::n");
    expect(junitTestId({ classname: " ", file: "f.py", suite: "s", name: "n" })).toBe("f.py::n");
    expect(junitTestId({ classname: "", file: "", suite: "s", name: "n" })).toBe("s::n");
    expect(junitTestId({ classname: "", file: "", suite: "", name: "n" })).toBe("n");
  });

  it("collapses whitespace and control characters to one space and trims", () => {
    expect(collapseWhitespace("  a \t\r\n b\u0001c d  ")).toBe("a b c d");
    expect(collapseWhitespace("")).toBe("");
    expect(collapseWhitespace(" \n ")).toBe("");
    expect(junitTestId({ classname: "x", file: "", suite: "", name: "a\u0085b" })).toBe("x::a b");
  });

  it("cuts an id over 500 code units to 491 and adds ~ and an 8-digit hash that tells long ids apart", () => {
    const a = junitTestId({ classname: "c", file: "", suite: "", name: `${"n".repeat(600)}a` });
    const b = junitTestId({ classname: "c", file: "", suite: "", name: `${"n".repeat(600)}b` });
    expect(a.length).toBe(TEST_ID_MAX_UNITS);
    expect(a).toMatch(/^c::n{488}~[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(a.slice(0, 491)).toBe(b.slice(0, 491));
    // Exactly 500 is kept as it is.
    const fits = junitTestId({ classname: "c", file: "", suite: "", name: "n".repeat(497) });
    expect(fits).toBe(`c::${"n".repeat(497)}`);
  });

  it("never splits a surrogate pair when it cuts", () => {
    const id = junitTestId({
      classname: "",
      file: "",
      suite: "",
      name: `${"x".repeat(490)}\u{1F600}${"y".repeat(20)}`,
    });
    expect(id).toMatch(/^x{490}~[0-9a-f]{8}$/);
  });
});
