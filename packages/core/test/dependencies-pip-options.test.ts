import { describe, expect, it } from "vitest";
import { parseRequirements } from "../src/dependencies/pythonManifest.js";
import type { ParsedManifest } from "../src/dependencies/types.js";
import type { Report } from "../src/report.js";
import { dependencyCase, run } from "./dependencies-helpers.js";
import { withoutFix } from "./without-fix.js";

// CORE-108 (R4.2): a requirements file's options are read the way pip reads them: a long option by any unique prefix
// (in any pip version from 20.3 to 26.3), a value attached to a short option, several options on one line. An option
// line pip would refuse (an unknown or ambiguous option) makes the file unread, never silently skipped. Real pip 26.3
// accepts each of the five spellings below (`pip install --dry-run -r`, recorded in the PR), and the per-version
// prefix results were read from pip 22.3.1, 23.0.1, 23.3.2, 24.2, 25.0.1, 25.3 and 26.3's own line parser.
//
// fixtures/dependencies/pip-option-spellings adds one requirements file per spelling, each beside a control that uses
// the same spelling on an allowed registry, plus the ticket's must-not-trigger lines (no-trigger.txt) and an index on a
// private host (allowed-host.txt). fixtures/dependencies/pip-option-ambiguous adds two files pip refuses (`--e`, `--no`)
// and a control (`--no-index`).

const dependencyMessages = (report: Report) =>
  withoutFix(report.messages.filter((m) => m.code.startsWith("DEPENDENCY_")));

const d05ByPath = (report: Report) =>
  Object.fromEntries(
    (report.dependencies?.signals ?? [])
      .filter((s) => s.id === "D05")
      .map((s) => [s.path, [s.severity, s.line, s.name ?? null, s.detail]]),
  );

const INDEX = "adds a package index outside the allowed registries";

const read = (text: string): ParsedManifest => {
  const parsed = parseRequirements(text);
  expect(parsed, text).not.toBeNull();
  return parsed as ParsedManifest;
};
const indexes = (text: string) => read(text).indexes.map((option) => [option.url, option.line, option.allowed]);

describe("pip's option spellings reach D05", () => {
  it("flags each of the five spellings and the `=` form, and none of their controls", () => {
    const report = run(dependencyCase("pip-option-spellings"));
    expect(d05ByPath(report)).toEqual({
      "requirements/allowed-host.txt": ["block", 1, null, INDEX],
      "requirements/e-attached.txt": ["block", 1, "y", "declared from a git repository"],
      "requirements/extra-index-eq.txt": ["block", 1, null, INDEX],
      "requirements/extra-index.txt": ["block", 1, null, INDEX],
      "requirements/find.txt": ["block", 1, null, INDEX],
      "requirements/i-attached.txt": ["block", 1, null, INDEX],
      "requirements/index.txt": ["block", 1, null, INDEX],
    });
    expect(report.dependencies?.signals.every((s) => s.id === "D05")).toBe(true);
    expect(report.dependencies?.unread).toBeUndefined();
    expect(report.verdict).toBe("fail");
  });

  it("passes the must-not-trigger lines: the PyPI index, --no-index, --pre, -r and -c, a hashed requirement", () => {
    const report = run(dependencyCase("pip-option-spellings"));
    const paths = Object.keys(d05ByPath(report));
    for (const control of [
      "requirements/no-trigger.txt",
      "requirements/extra-index-control.txt",
      "requirements/extra-index-eq-control.txt",
      "requirements/index-control.txt",
      "requirements/find-control.txt",
      "requirements/i-attached-control.txt",
      "requirements/e-attached-control.txt",
    ]) {
      expect(paths, control).not.toContain(control);
    }
  });

  it("accepts an --extra-index-url on a host the run allows", () => {
    const allowed = run(
      dependencyCase("pip-option-spellings", { dependencySettings: { allowedHosts: ["pypi.corp.example"] } }),
    );
    expect(Object.keys(d05ByPath(allowed))).not.toContain("requirements/allowed-host.txt");
    expect(Object.keys(d05ByPath(allowed))).toContain("requirements/extra-index.txt");
  });
});

describe("an option line pip refuses makes the file unread", () => {
  it("names an ambiguous --e and --no unread with DEPENDENCY_CHECK_INCOMPLETE, judges them no further, and reads --no-index", () => {
    const report = run(dependencyCase("pip-option-ambiguous"));
    expect(report.dependencies?.unread).toEqual([
      { path: "requirements/e.txt", reason: "unparsable" },
      { path: "requirements/no.txt", reason: "unparsable" },
    ]);
    expect(report.dependencies?.signals).toEqual([]);
    expect(dependencyMessages(report).map((m) => [m.level, m.code])).toEqual([
      ["error", "DEPENDENCY_CHECK_INCOMPLETE"],
    ]);
    expect(report.verdict).toBe("fail");
  });

  it("refuses what pip refuses: an unknown or ambiguous option, a missing value, a value on a flag, a broken quote", () => {
    for (const line of [
      "--e https://evil.example/simple/",
      "--no",
      "--no-",
      "--pr",
      "--req other.txt",
      "--frobnicate x",
      "--index-url",
      "-i",
      "--pre=1",
      "--no-index=1",
      "-x value",
      "--index-url 'https://evil.example/simple/",
      '--index-url "https://evil.example/simple/',
      "--pre --e https://evil.example/simple/",
    ]) {
      expect(parseRequirements(`requests==2.31.0\n${line}\n`), line).toBeNull();
    }
  });
});

describe("reading pip's option spellings", () => {
  it("resolves a long option by its unique prefix, in any pip version", () => {
    expect(indexes("--ex https://evil.example/simple/")).toEqual([["https://evil.example/simple/", 1, false]]);
    expect(indexes("--extra-index-u=https://evil.example/simple/")).toEqual([
      ["https://evil.example/simple/", 1, false],
    ]);
    // --in and --i are ambiguous with --install-option in pip 20.3 to 23.0 and mean --index-url from pip 23.3 on.
    expect(indexes("--in https://evil.example/simple/")).toEqual([["https://evil.example/simple/", 1, false]]);
    expect(indexes("--i https://evil.example/simple/")).toEqual([["https://evil.example/simple/", 1, false]]);
    expect(indexes("--pypi-url https://evil.example/simple/")).toEqual([["https://evil.example/simple/", 1, false]]);
    expect(indexes("--pypi https://evil.example/simple/")).toEqual([["https://evil.example/simple/", 1, false]]);
    expect(indexes("--fi=https://evil.example/wheels/")).toEqual([["https://evil.example/wheels/", 1, false]]);
    expect(read("--ed git+https://github.com/x/y.git#egg=y").deps.map((d) => [d.name, d.kind])).toEqual([["y", "git"]]);
  });

  it("reads an exact name before a longer one it is a prefix of, and options that only some pip versions know", () => {
    expect(indexes("--pre\n--only :all:\n--c constraints.txt\n-C key=value\n--install-option x\n")).toEqual([]);
    expect(indexes("--global-option=x\n--no-require-hashes\n--all-releases :all:\n--use-feature truststore\n")).toEqual(
      [],
    );
  });

  it("reads a value attached to -i, -f and -e, or in the next word, quoted or not", () => {
    expect(indexes("-ihttps://evil.example/simple/\n-fhttps://evil.example/wheels/")).toEqual([
      ["https://evil.example/simple/", 1, false],
      ["https://evil.example/wheels/", 2, false],
    ]);
    expect(indexes("-i\thttps://evil.example/simple/")).toEqual([["https://evil.example/simple/", 1, false]]);
    expect(indexes(`--index-url "https://evil.example/simple/"`)).toEqual([["https://evil.example/simple/", 1, false]]);
    expect(indexes(`--index-url='https://evil.example/simple/'`)).toEqual([["https://evil.example/simple/", 1, false]]);
    expect(read("-egit+https://github.com/x/y.git#egg=y").deps.map((d) => [d.name, d.kind, d.line])).toEqual([
      ["y", "git", 1],
    ]);
    expect(read("-e.\n-e ./vendor/pkg").deps).toEqual([]);
  });

  it("reads every option of a line, and a line joined by a trailing backslash as pip joins it", () => {
    expect(indexes("--pre --extra-index-url https://evil.example/simple/ --no-binary :none:")).toEqual([
      ["https://evil.example/simple/", 1, false],
    ]);
    expect(indexes("--prefer-binary -ihttps://evil.example/a/ -f https://evil.example/b/")).toEqual([
      ["https://evil.example/a/", 1, false],
      ["https://evil.example/b/", 1, false],
    ]);
    expect(indexes("requests==2.31.0\n-\\\nihttps://evil.example/simple/\n")).toEqual([
      ["https://evil.example/simple/", 2, false],
    ]);
    expect(indexes("--\\\nindex-url https://evil.example/simple/\n")).toEqual([
      ["https://evil.example/simple/", 1, false],
    ]);
    // pip cuts every `\` off both ends of a line it joins, and joins the last line's trailing `\` to nothing.
    expect(indexes("\\-ihttps://evil.example/simple/\\\\\nrequests==2.31.0\n")).toEqual([
      ["https://evil.example/simple/requests==2.31.0", 1, false],
    ]);
    expect(indexes("requests==2.31.0\n--index-url https://evil.example/simple/\\")).toEqual([
      ["https://evil.example/simple/", 2, false],
    ]);
  });

  it("stops at `--` and drops other words of an option line, as optparse does", () => {
    expect(indexes("--pre -- --index-url https://evil.example/simple/")).toEqual([]);
    expect(indexes("--pre requests")).toEqual([]);
    expect(read("--pre requests").deps).toEqual([]);
  });

  it("still cuts per-requirement options off a requirement line", () => {
    const parsed = read("requests==2.31.0 --hash=sha256:abc --config-settings=x=y\n");
    expect(parsed.deps.map((d) => [d.name, d.spec, d.kind])).toEqual([["requests", "==2.31.0", "registry"]]);
    expect(parsed.indexes).toEqual([]);
  });
});
