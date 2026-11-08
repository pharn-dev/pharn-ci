import { describe, expect, it } from "vitest";
import { buildJunitResultsXml, parseJunitSources, parseJunitXml } from "../src/index.js";
import { measureGrowth, threadCpuMs } from "./growth.js";

// Flaky tests (A6): the JUnit reader and the normalised results take time linear in their input on shapes that would
// make a backtracking pattern or a nested loop quadratic. Growth is measured on this thread's CPU time with
// measureGrowth (growth.ts), after a warm-up call: 400,000 characters must take under 8 times as long as 100,000 (near 4
// is linear, near 16 quadratic), and the slowest call must finish within 15 s.

const SMALL = 100_000;
const LARGE = 400_000;

const sized = (unit: string, size: number) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);

async function linear(label: string, make: (size: number) => string, read: (text: string) => unknown) {
  const small = make(SMALL);
  const large = make(LARGE);
  read(small);
  read(large);
  let slowest = 0;
  const timed = (text: string) => () => {
    const start = threadCpuMs();
    read(text);
    slowest = Math.max(slowest, threadCpuMs() - start);
  };
  const growth = await measureGrowth(timed(small), timed(large));
  expect(slowest, `${label}: the slowest call finishes within 15 s of CPU time`).toBeLessThan(15_000);
  expect(growth.ratio, `${label}: ${growth.detail}`).toBeLessThan(8);
}

const parse = (text: string) => parseJunitXml(text, 1_000_000);
const inSuite = (body: string) => `<testsuites><testsuite name="s">${body}</testsuite></testsuites>`;

describe("the JUnit reader runs in linear time", { timeout: 300_000 }, () => {
  const shapes: [string, (size: number) => string][] = [
    ["many passing test cases", (size) => inSuite(sized('<testcase classname="c" name="t" time="0.1"/>', size))],
    [
      "many failing test cases",
      (size) => inSuite(sized('<testcase name="t"><failure message="m">x</failure></testcase>', size)),
    ],
    [
      "one long failure text",
      (size) => inSuite(`<testcase name="t"><failure>${sized("a b ", size)}</failure></testcase>`),
    ],
    ["one long attribute value", (size) => inSuite(`<testcase name="${sized("n ", size)}"/>`)],
    [
      "a run of entity references",
      (size) => inSuite(`<testcase name="t"><failure>${sized("&amp;&#65;&#x42;", size)}</failure></testcase>`),
    ],
    ["a run of ampersands with no semicolon", (size) => inSuite(`<testcase name="${sized("&&&&&&&&&#", size)}"/>`)],
    ["a run of bare < characters", (size) => inSuite(sized("<<<<", size))],
    ["one unclosed tag with many quotes", (size) => `<testsuites>${sized("<a b=\"\" c='' ", size)}`],
    [
      "a long CDATA section",
      (size) => inSuite(`<testcase name="t"><failure><![CDATA[${sized("x]]", size)}]]></failure></testcase>`),
    ],
    ["nested elements open and closed in turn", (size) => inSuite(sized("<x><y></y></x>", size))],
    ["many end tags that close nothing", (size) => `<testsuites></testsuites>${sized("</x>", size)}`],
    ["whitespace-heavy names", (size) => inSuite(sized('<testcase name="  a \t\n b  "/>', size))],
  ];
  for (const [label, make] of shapes) {
    it(`${label}: 400,000 characters take under 8 times as long as 100,000`, async () => {
      await linear(label, make, parse);
    });
  }

  it("buildJunitResultsXml on many failing cases: linear", async () => {
    await linear(
      "normalised results",
      (size) =>
        inSuite(sized('<testcase classname="c&amp;d" name="t"><failure message="a &lt;b&gt; c"/></testcase>', size)),
      (text) => buildJunitResultsXml(parseJunitSources({ files: [{ path: "a.xml", text }] })),
    );
  });
});
