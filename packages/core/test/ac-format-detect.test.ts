import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";

// The detector is imported inside each test body, and the fixtures are listed and read there too: the AC tests are
// written before detect.ts, clover.xml and jacoco-native.xml exist, so nothing that depends on them may run while
// the file loads.

async function loadDetect() {
  const { detectCoverageFormat } = await import("../src/coverage/detect.js");
  return detectCoverageFormat;
}

const BOM = "﻿";

const COBERTURA = [
  '<coverage line-rate="1" branch-rate="0" version="7.6.1" timestamp="1728750000000">',
  "  <sources>",
  "    <source>/home/runner/work/demo/demo</source>",
  "  </sources>",
  "  <packages>",
  '    <package name="src">',
  "      <classes>",
  '        <class name="a" filename="src/a.ts">',
  "          <lines>",
  '            <line number="1" hits="1"/>',
  "          </lines>",
  "        </class>",
  "      </classes>",
  "    </package>",
  "  </packages>",
  "</coverage>",
  "",
].join("\n");

const LCOV = ["TN:", "SF:src/a.ts", "DA:1,1", "end_of_record", ""].join("\n");

const PROLOG = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!-- written by a tool; this is not Clover: <project name="demo"><metrics/></project> -->',
  '<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">',
  "<!-- <project> -->",
  "",
].join("\n");

const crlf = (text: string) => text.replace(/\n/g, "\r\n");
const NOT_DETECTED = ["cobertura", "lcov"];

describe("detectCoverageFormat: recognized reports", () => {
  it("AC-1: detects every Cobertura fixture as cobertura", async () => {
    const detect = await loadDetect();
    const skip = new Set(["empty.xml", "garbage.xml", "clover.xml", "jacoco-native.xml"]);
    const names = readdirSync(`${FIXTURES}cobertura`).filter((name) => name.endsWith(".xml") && !skip.has(name));
    expect(names.length).toBeGreaterThanOrEqual(15);
    for (const name of names) {
      expect(detect(fixture(`cobertura/${name}`)), name).toBe("cobertura");
    }
  });

  it("AC-2: detects every lcov fixture and the golden coverage.info as lcov", async () => {
    const detect = await loadDetect();
    const skip = new Set(["empty.info", "garbage.info"]);
    const paths = readdirSync(`${FIXTURES}lcov`)
      .filter((name) => name.endsWith(".info") && !skip.has(name))
      .map((name) => `lcov/${name}`);
    expect(paths.length).toBeGreaterThanOrEqual(4);
    paths.push("golden/coverage.info");
    for (const path of paths) {
      expect(detect(fixture(path)), path).toBe("lcov");
    }
  });

  it("AC-3: detects both formats through a byte-order mark, leading whitespace, CRLF and an XML prolog", async () => {
    const detect = await loadDetect();
    const leading = " \t\r\n\n  ";
    const coberturaForms: Record<string, string> = {
      plain: COBERTURA,
      bom: `${BOM}${COBERTURA}`,
      whitespace: `${leading}${COBERTURA}`,
      crlf: crlf(COBERTURA),
      prolog: `${PROLOG}${COBERTURA}`,
      "comment before the first child": COBERTURA.replace(
        "  <sources>",
        '  <!-- <project name="demo"/> -->\n  <sources>',
      ),
      "all at once": `${BOM}${leading}${crlf(`${PROLOG}${COBERTURA}`)}`,
    };
    const lcovForms: Record<string, string> = {
      plain: LCOV,
      bom: `${BOM}${LCOV}`,
      whitespace: `${leading}${LCOV}`,
      crlf: crlf(LCOV),
      "starts with SF:": crlf(LCOV.slice("TN:\n".length)),
      "all at once": `${BOM}${leading}${crlf(LCOV)}`,
    };
    for (const [label, text] of Object.entries(coberturaForms)) {
      expect(detect(text), `cobertura ${label}`).toBe("cobertura");
    }
    for (const [label, text] of Object.entries(lcovForms)) {
      expect(detect(text), `lcov ${label}`).toBe("lcov");
    }
  });
});

describe("detectCoverageFormat: look-alikes and unknown text", () => {
  it("AC-4: does not take Clover look-alikes for Cobertura or lcov", async () => {
    const detect = await loadDetect();
    const cases: Record<string, string> = {
      "clover.xml fixture": fixture("cobertura/clover.xml"),
      "first child <project>, no clover attribute": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<coverage generated="1728750000000">',
        "  <!-- the first child follows -->",
        '  <project timestamp="1728750000000" name="demo">',
        '    <metrics statements="1" coveredstatements="1"/>',
        "  </project>",
        "</coverage>",
        "",
      ].join("\n"),
      "clover attribute, first child not <project>": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<coverage generated="1728750000000" clover="4.5.2">',
        "  <sources><source>/home/runner/work/demo/demo</source></sources>",
        "  <packages/>",
        "</coverage>",
        "",
      ].join("\n"),
    };
    for (const [label, text] of Object.entries(cases)) {
      expect(NOT_DETECTED, label).not.toContain(detect(text));
    }
  });

  it("AC-5: does not take JaCoCo native XML, garbage, <coverageReport> or a root past 1 KiB for a known format", async () => {
    const detect = await loadDetect();
    const cases: Record<string, string> = {
      "jacoco-native.xml fixture": fixture("cobertura/jacoco-native.xml"),
      "cobertura/garbage.xml": fixture("cobertura/garbage.xml"),
      "lcov/garbage.info": fixture("lcov/garbage.info"),
      "<coverageReport> root":
        '<?xml version="1.0"?>\n<coverageReport version="1">\n  <packages/>\n</coverageReport>\n',
      "root after a 1 KiB comment": `<?xml version="1.0"?>\n<!--${"x".repeat(1100)}-->\n${COBERTURA}`,
      "root after 1 KiB of whitespace": `${" ".repeat(1100)}${COBERTURA}`,
    };
    for (const [label, text] of Object.entries(cases)) {
      expect(NOT_DETECTED, label).not.toContain(detect(text));
    }
  });

  it("AC-6: returns quickly, without throwing, on several megabytes of hostile text", async () => {
    const detect = await loadDetect();
    const size = 4_000_000;
    const junk = "a ".repeat(size / 2);
    const cases: Record<string, string> = {
      "only whitespace": " \t\r\n".repeat(size / 4),
      "an unterminated comment": `<!--${junk}${COBERTURA}`,
      "an unterminated DOCTYPE": `<!DOCTYPE coverage [${junk}${COBERTURA}`,
      "an unterminated XML declaration": `<?xml version="1.0" ${junk}${COBERTURA}`,
      "a long run of <": `${"<".repeat(size)}${COBERTURA}`,
    };
    for (const [label, text] of Object.entries(cases)) {
      const started = performance.now();
      const result = detect(text);
      const elapsed = performance.now() - started;
      expect(elapsed, label).toBeLessThan(1000);
      expect(NOT_DETECTED, label).not.toContain(result);
    }
  }, 30_000);
});
