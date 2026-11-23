import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The docs contract: the mechanical facts the documents must agree with, and nothing about their wording.
// 1. Every input in action.yml has a row in the inputs table, with its default.
// 2. Every message code in schema/report.v2.json has a row in the message-code table.
// 3. Every version pin in the docs and examples equals the version in the root package.json (a SHA pin may lag one
//    release, until the PR after the tag), and so does the newest release heading of CHANGELOG.md.
// The tables are found by their heading text (any heading level), then parsed, so a table can move to another
// document by changing its path constant below. Files are read inside the test bodies.

/** The document that holds the inputs table, and the heading the table sits under. */
const INPUTS_DOC = "docs/action.md";
const INPUTS_HEADING = "Action reference";
/** The document that holds the message-code table, and the heading the table sits under. */
const CODES_DOC = "docs/output.md";
const CODES_HEADING = "Report v2";
/** Documents and examples whose release pins must name the current version (CHANGELOG.md is history, not a pin). */
const PIN_FILES = ["README.md", "SECURITY.md", "CONTRIBUTING.md", ".github/ISSUE_TEMPLATE/bug_report.yml"];
const PIN_DIRS = ["docs", "examples"];

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8").replace(/\r\n/g, "\n");

/** Splits a Markdown table row into trimmed cells; a `|` inside backticks or escaped as `\|` stays in its cell. */
function cells(row: string): string[] {
  const out: string[] = [];
  let cell = "";
  let code = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i] as string;
    if (c === "\\" && row[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (c === "`") {
      code = !code;
      cell += c;
    } else if (c === "|" && !code) {
      out.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  out.push(cell.trim());
  return out.slice(1, -1);
}

/** The body rows (cells) of the first table under the heading whose text is `heading`, before the next heading. */
function tableUnder(markdown: string, heading: string, doc: string): string[][] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#{1,6} /.test(line) && line.replace(/^#+ /, "").trim() === heading);
  expect(start, `${doc} has a heading "${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6} /.test(line));
  const section = end === -1 ? rest : rest.slice(0, end);
  const first = section.findIndex((line) => line.startsWith("|"));
  expect(first, `${doc} has a table under "${heading}"`).toBeGreaterThanOrEqual(0);
  const after = section.slice(first);
  const stop = after.findIndex((line) => !line.startsWith("|"));
  const table = stop === -1 ? after : after.slice(0, stop);
  return table.slice(2).map(cells);
}

/** The text of a cell without backticks, quotes or a `${{ }}` wrapper, for comparing defaults. */
const plain = (text: string) =>
  text
    .replace(/^\$\{\{\s*(.*?)\s*\}\}$/, "$1")
    .replace(/[`"']/g, "")
    .trim();

/** action.yml's inputs, each with its `default:` (null when it has none), read line by line. */
function actionInputs(yml: string): Map<string, string | null> {
  const inputs = new Map<string, string | null>();
  let inInputs = false;
  let current: string | null = null;
  for (const line of yml.split("\n")) {
    if (/^\S/.test(line)) inInputs = line === "inputs:";
    if (!inInputs) continue;
    const name = /^ {2}([a-z0-9-]+):\s*$/.exec(line)?.[1];
    if (name !== undefined) {
      current = name;
      inputs.set(name, null);
    }
    const value = /^ {4}default:\s*(.*)$/.exec(line)?.[1];
    if (value !== undefined && current !== null) inputs.set(current, plain(value));
  }
  return inputs;
}

/** The repo-relative paths of every Markdown and YAML file under `dir`. */
const filesUnder = (dir: string) =>
  readdirSync(new URL(`${dir}/`, ROOT), { recursive: true, encoding: "utf8" })
    .map((name) => `${dir}/${name.split("\\").join("/")}`)
    .filter((path) => /\.(md|ya?ml)$/.test(path));

/** Release pins: a `uses:` tag, the version comment after a SHA pin, the latest-release line and the comment footer. */
const PINS = [
  /pharn-dev\/pharn-ci@v(\d+\.\d+\.\d+)/g,
  /pharn-dev\/pharn-ci@[0-9a-f]{40} # v(\d+\.\d+\.\d+)/g,
  /latest release(?: is|:) `v(\d+\.\d+\.\d+)`/g,
  /<sub>pharn-ci (\d+\.\d+\.\d+) ·/g,
];
/** The pattern of PINS that matches a SHA pin's version comment. */
const SHA_PIN = PINS[1];

/** The versions of CHANGELOG.md's release headings (`## [X.Y.Z] - <date>`), newest first. */
const changelogReleases = () =>
  [...read("CHANGELOG.md").matchAll(/^## \[(\d+\.\d+\.\d+)\] - /gm)].map((m) => m[1] as string);

describe("docs contract", () => {
  it("every action.yml input has a row in the inputs table with its default, and every row is an input", () => {
    const inputs = actionInputs(read("action.yml"));
    expect(inputs.size, "action.yml declares inputs").toBeGreaterThan(0);
    const rows = new Map(
      tableUnder(read(INPUTS_DOC), INPUTS_HEADING, INPUTS_DOC).map((row) => [plain(row[0] ?? ""), row[1] ?? ""]),
    );
    for (const [name, value] of inputs) {
      expect(rows.has(name), `${INPUTS_DOC} has a row for the input ${name}`).toBe(true);
      const cell = rows.get(name) ?? "";
      expect(cell, `${INPUTS_DOC} states a default for ${name}`).not.toBe("");
      if (value !== null) expect(plain(cell), `${INPUTS_DOC}'s default for ${name}`).toBe(value);
    }
    const unknown = [...rows.keys()].filter((name) => !inputs.has(name));
    expect(unknown, `rows of ${INPUTS_DOC} for inputs action.yml does not declare`).toEqual([]);
  });

  it("every message code in schema/report.v2.json has a row in the code table, and every row is a code", () => {
    const schema = JSON.parse(read("schema/report.v2.json"));
    const description: string = schema.$defs.message.properties.code.description;
    const codes = new Set(description.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g));
    expect(codes.size, "the schema names message codes").toBeGreaterThan(0);
    const rows = new Set(tableUnder(read(CODES_DOC), CODES_HEADING, CODES_DOC).map((row) => plain(row[0] ?? "")));
    const missing = [...codes].filter((code) => !rows.has(code));
    expect(missing, `codes with no row in ${CODES_DOC}`).toEqual([]);
    const unknown = [...rows].filter((code) => !codes.has(code));
    expect(unknown, `rows of ${CODES_DOC} for codes the schema does not name`).toEqual([]);
  });

  it("every version pin in the docs and examples equals the root package.json version", () => {
    const version: string = JSON.parse(read("package.json")).version;
    const files = [...PIN_FILES, ...PIN_DIRS.flatMap(filesUnder)];
    const pins = files.flatMap((path) =>
      read(path)
        .split("\n")
        .flatMap((line, index) =>
          PINS.flatMap((pattern) =>
            [...line.matchAll(pattern)].map((m) => ({ at: `${path}:${index + 1}`, v: m[1], sha: pattern === SHA_PIN })),
          ),
        ),
    );
    expect(
      pins.some((pin) => pin.at.startsWith("README.md:")),
      "README.md pins a release",
    ).toBe(true);
    // A SHA pin cannot name the release commit before that commit exists: the release PR leaves SHA pins on the
    // previous release, and a PR after the tag moves them (docs/RELEASING.md). So a SHA pin may also name the release
    // right below the newest CHANGELOG heading, and only while that newest heading is the root version.
    const releases = changelogReleases();
    const shaVersions = releases[0] === version && releases[1] !== undefined ? [version, releases[1]] : [version];
    const stale = pins
      .filter((pin) => (pin.sha ? !shaVersions.includes(pin.v as string) : pin.v !== version))
      .map((pin) => `${pin.at} pins ${pin.v}`);
    expect(stale, `pins that are not ${version}`).toEqual([]);
  });

  it("the newest release heading of CHANGELOG.md names the root package.json version", () => {
    const version: string = JSON.parse(read("package.json")).version;
    const headings = read("CHANGELOG.md")
      .split("\n")
      .filter((line) => line.startsWith("## "));
    expect(headings[0], "CHANGELOG.md starts with the Unreleased section").toBe("## [Unreleased]");
    const release = /^## \[([^\]]+)\] - (?:\d{4}-\d{2}-\d{2}|YYYY-MM-DD)$/.exec(headings[1] ?? "");
    expect(release, `the release heading under Unreleased: ${headings[1]}`).not.toBeNull();
    expect(release?.[1], "the version of the newest release heading").toBe(version);
  });
});
