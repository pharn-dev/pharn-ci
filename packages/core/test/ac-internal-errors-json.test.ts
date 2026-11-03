import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before the build narrows the JSON config reader's
// catch, so nothing the build changes may run while the file loads. The fault is injected into our conversion of the
// value JSON.parse returned: a spy on Map.prototype.set throws one TypeError, only for a marker key the head config
// holds, which the conversion sets after JSON.parse returned (JSON.parse itself never calls Map.prototype.set).

const MARKER = "pharnCiFaultMarker";
const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "jest.config.json";
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";

const BASE = '{\n  "passWithNoTests": false\n}\n';
const HEAD = `{\n  "passWithNoTests": false,\n  "${MARKER}": true\n}\n`;
const NOT_JSON = '{\n  "passWithNoTests": true,\n';

interface Report {
  messages: { code: string; level: string; text: string }[];
}

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

function inputOf(head: string) {
  return {
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(PATH, BASE, head) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", PATH],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path: PATH, text: BASE }], dropped: [] },
      head: { files: [{ path: PATH, text: head }], dropped: [] },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("check(): an exception from our own JSON value conversion", () => {
  it("AC-6: a TypeError thrown while converting a parsed jest.config.json escapes check() in mode block and is never reported as invalid-json; a jest.config.json that is not JSON is still refused as invalid-json", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as { check: (input: unknown) => unknown };
    expect(() => JSON.parse(HEAD), "the head config is valid JSON").not.toThrow();

    const injected = new TypeError("AC-6 injected fault in the JSON value conversion");
    const originalSet = Map.prototype.set;
    let reached = 0;
    vi.spyOn(Map.prototype, "set").mockImplementation(function (this: Map<unknown, unknown>, key, value) {
      if (key === MARKER) {
        reached++;
        throw injected;
      }
      return originalSet.call(this, key, value);
    });

    let report: unknown;
    let thrown: unknown = null;
    try {
      report = core.check(inputOf(HEAD));
    } catch (error) {
      thrown = error;
    } finally {
      vi.restoreAllMocks();
    }

    expect(reached, "the injected fault was reached through check()").toBeGreaterThan(0);
    const invalid = ((report as Report | undefined)?.messages ?? []).filter(
      (m) => String(m.code) === CODE && m.text.includes(PATH) && m.text.includes("invalid-json"),
    );
    expect(invalid, `${PATH} is not reported as invalid-json`).toEqual([]);
    expect(report, "check() returned no report").toBeUndefined();
    expect(thrown, "check() threw the conversion's own TypeError").toBe(injected);

    // With the spy restored, a config that is not JSON is still a genuine input failure.
    const refused = core.check(inputOf(NOT_JSON));
    expectValidReport(refused);
    const messages = (refused as Report).messages.filter((m) => String(m.code) === CODE);
    expect(messages, `one ${CODE} message`).toHaveLength(1);
    expect(messages[0]?.text, `names ${PATH}`).toContain(PATH);
    expect(messages[0]?.text, "names invalid-json").toContain("invalid-json");
  }, 60_000);
});
