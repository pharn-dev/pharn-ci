import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The docs, the schemas and the TI09 fixture directory are read inside the test body: the AC test is written before
// they change. schema/report.v1.json is pinned by the sha256 it has at the base commit 98693cf.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TI09 = `${ROOT}fixtures/test-integrity/TI09`;
const V1_SHA256_AT_BASE = "c6cfd5b5afeada776fa89028f5ef29e06427d0e32529420184474e52ca77c731";

const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The text of the section whose heading line (`#`, `##` or `###`) includes `title`, up to the next heading of its level or higher. */
function section(text: string, title: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^#{1,3} /.test(line) && line.includes(title));
  expect(start, `the section ${title}`).toBeGreaterThan(-1);
  const level = (lines[start] as string).indexOf(" ");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const m = /^(#{1,6}) /.exec(line);
    return m !== null && (m[1] as string).length <= level;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The text from `start` to its balanced closing parenthesis (the first `(` after `start` opens it). */
function parenthesized(text: string, start: number): string {
  const open = text.indexOf("(", start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")" && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** The table row of docs/THREAT-MODEL.md whose first cell is `id`. */
function row(text: string, id: string): string {
  const found = text.split("\n").find((line) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(line));
  expect(found, `the threat-model row ${id}`).toBeDefined();
  return found as string;
}

/** Every file under `dir`, relative to it with forward slashes. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

describe("TI09: schema, docs and fixtures", () => {
  it("AC-19: the v2 schema names TEST_INTEGRITY_TI09 and TI09 in the index-unavailable sentence, v1 is unchanged, CHANGELOG, README, LIMITS and THREAT-MODEL describe TI09, and the TI09 fixtures hold at least 8 must-trigger and 6 must-not-trigger cases of the required kinds and layout", () => {
    // Schemas.
    const v2 = JSON.parse(read("schema/report.v2.json")) as {
      $defs: { message: { properties: { code: { description: string } } } };
    };
    const codes = v2.$defs.message.properties.code.description;
    expect(codes, "the message-code description names TEST_INTEGRITY_TI09").toContain("TEST_INTEGRITY_TI09");
    const at = codes.indexOf("TEST_INTEGRITY_INDEX_UNAVAILABLE (");
    expect(at, "the index-unavailable entry").toBeGreaterThan(-1);
    expect(parenthesized(codes, at), "the index-unavailable sentence mentions TI09").toContain("TI09");
    const v1 = createHash("sha256")
      .update(readFileSync(`${ROOT}schema/report.v1.json`))
      .digest("hex");
    expect(v1, "schema/report.v1.json is byte-identical to the base commit").toBe(V1_SHA256_AT_BASE);

    // CHANGELOG: the 0.3.0 section has a TI09 line (before that release it sat under Unreleased).
    const unreleased = section(read("CHANGELOG.md"), "[0.3.0]");
    expect(
      unreleased.split("\n").some((line) => line.includes("TI09")),
      "a 0.3.0 line names TI09",
    ).toBe(true);

    // README: TI09 in the signals sentences and its message code in the table.
    const readme = read("README.md");
    const flat = normalize(readme);
    let sentences = 0;
    for (let i = flat.indexOf("The signals so far are"); i !== -1; i = flat.indexOf("The signals so far are", i + 1)) {
      sentences++;
      const end = flat.indexOf(". ", i);
      expect(flat.slice(i, end === -1 ? undefined : end), "a signals sentence lists TI09").toContain("TI09");
    }
    expect(sentences, "the README has its signals sentences").toBeGreaterThan(0);
    expect(
      readme.split("\n").some((line) => /^\|\s*`TEST_INTEGRITY_TI09`\s*\|/.test(line)),
      "a README message-code row for TEST_INTEGRITY_TI09",
    ).toBe(true);

    // docs/LIMITS.md: What TI09 misses, and vite.config.* among the test-config names of section 8.
    const limits = read("docs/LIMITS.md");
    const misses = normalize(section(limits, "What TI09 misses")).toLowerCase();
    for (const [what, pattern] of [
      ["computed configs", /comput/],
      ["shared config packages", /shared config/],
      ["CLI flags in workflows", /cli flag[\s\S]*workflow|workflow[\s\S]*cli flag/],
      ["deleted configs", /delet/],
      ["playwright per-project settings", /per-project/],
      ["raised retries are warn only", /retr/],
      ["raised timeouts are warn only", /timeout/],
      ["the warn-only decision", /warn/],
    ] as const) {
      expect(misses, `What TI09 misses names ${what}`).toMatch(pattern);
    }
    expect(misses, "What TI09 misses names playwright").toContain("playwright");
    expect(normalize(section(limits, "8. Size limits")), "section 8 lists vite.config.*").toContain("`vite.config.*`");

    // docs/THREAT-MODEL.md: rows A1 and C2 name the config parsing.
    const threat = read("docs/THREAT-MODEL.md");
    const a1 = row(threat, "A1");
    expect(a1, "A1 names the INI reader").toContain("INI");
    expect(a1, "A1 names the TOML reader").toContain("TOML");
    expect(row(threat, "C2"), "C2 says check() reads the config text for TI09").toContain("TI09");

    // fixtures/test-integrity/TI09/: the cases and their layout.
    expect(existsSync(TI09), "fixtures/test-integrity/TI09/ exists").toBe(true);
    const cases = readdirSync(TI09).filter((name) => statSync(join(TI09, name)).isDirectory());
    const trigger = cases.filter((name) => /^(block|warn)-/.test(name));
    const pass = cases.filter((name) => name.startsWith("pass-"));
    expect(trigger.length, "at least 8 must-trigger cases").toBeGreaterThanOrEqual(8);
    expect(pass.length, "at least 6 must-not-trigger cases").toBeGreaterThanOrEqual(6);

    const pathOf = (diff: string) => /^\+\+\+ b\/(.+)$/m.exec(diff)?.[1] ?? "";
    const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
    const addedCases: string[] = [];
    for (const name of cases) {
      const dir = join(TI09, name);
      const files = filesUnder(dir);
      expect(files, `${name} holds change.diff`).toContain("change.diff");
      const diff = readFileSync(join(dir, "change.diff"), "utf8");
      expect(diff.split("\n").length, `${name}: change.diff is under 1000 lines`).toBeLessThan(1000);
      const path = pathOf(diff);
      expect(path, `${name}: the diff names a file`).not.toBe("");
      const isAdded = /^new file mode /m.test(diff);
      if (isAdded) addedCases.push(name);
      for (const file of files.filter((f) => f !== "change.diff")) {
        expect(file, `${name}: ${file} is a .txt under base/ or head/`).toMatch(/^(base|head)\/.+\.txt$/);
      }
      expect(files, `${name}: head/${path}.txt`).toContain(`head/${path}.txt`);
      if (isAdded) {
        expect(
          files.filter((f) => f.startsWith("base/")),
          `${name}: an added file holds only head/`,
        ).toEqual([]);
      } else {
        expect(files, `${name}: base/${path}.txt`).toContain(`base/${path}.txt`);
      }
    }

    const triggerNames = new Set(
      trigger.map((name) => basename(pathOf(readFileSync(join(TI09, name, "change.diff"), "utf8")))),
    );
    for (const config of [
      "vitest.config.ts",
      "package.json",
      "playwright.config.ts",
      ".mocharc.yml",
      "pytest.ini",
      "pyproject.toml",
      "setup.cfg",
    ]) {
      expect(triggerNames.has(config), `a must-trigger case covers ${config}`).toBe(true);
    }
    const packageJsonJest = trigger.some((name) => {
      const head = join(TI09, name, "head", "package.json.txt");
      return existsSync(head) && /"jest"\s*:/.test(readFileSync(head, "utf8"));
    });
    expect(packageJsonJest, "a must-trigger case covers the package.json jest key").toBe(true);
    expect(
      trigger.some((name) => /cannot-compare|opaque|non-static|computed/.test(name)),
      "a must-trigger case covers a non-static value",
    ).toBe(true);

    for (const [what, pattern] of [
      ["a build-directory exclude", /build|dist|node-modules/],
      ["a reformat", /reformat/],
      ["a key moved", /moved/],
      ["a threshold raised", /threshold.*raised/],
      ["an include widened", /include.*widened/],
    ] as const) {
      expect(
        pass.some((name) => pattern.test(name)),
        `a must-not-trigger case for ${what}`,
      ).toBe(true);
    }
    expect(
      pass.some((name) => addedCases.includes(name)),
      "a must-not-trigger case for a new config without loosening keys",
    ).toBe(true);
  });
});
