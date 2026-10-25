import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the parsers, the format chooser and the renderer are loaded inside each test body: the AC tests are
// written before check() accepts parsed coverage files and parsed diffs, so nothing that depends on them may run
// while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

type Selection = "lcov" | "cobertura" | "auto";
type Options = { repoRoot?: string; coverageRoot?: string };
type Message = { level: string; code: string; text: string };

const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;
const lines = (path: string) => fixture(path).trim().split("\n");

async function load() {
  const { check } = await import("../src/check.js");
  const { parseCoverage } = await import("../src/coverage/index.js");
  const { chooseCoverageFormat } = await import("../src/coverage/detect.js");
  const { parseUnifiedDiff } = await import("../src/diff/unified.js");
  const { keepSignalFileText } = await import("../src/signals/signalFiles.js");
  const { parseConfig } = await import("../src/config.js");
  const { renderMarkdown } = await import("../src/render/markdown.js");

  type Input = Parameters<typeof check>[0];
  const run = (input: Record<string, unknown>) =>
    check({ version: "0.1.0", repoRoot: REPO_ROOT, ...input } as unknown as Input);

  /** A coverage file as an adapter hands it to check(): parsed, with the format chosen on its start. */
  const parsedFile = (text: string, selection: Selection, options: Options, file?: string) => {
    const choice = chooseCoverageFormat(text, selection);
    const parsed =
      choice.format === "lcov" || choice.format === "cobertura"
        ? parseCoverage(text, choice.format, options)
        : new Map<string, Map<number, number>>();
    return { parsed, format: choice.format, ...(file === undefined ? {} : { file }) };
  };

  // Parsed the way the CLI and the Action read a diff, so the lines the test-integrity signals read are kept.
  const parsedDiff = (text: string) => ({ parsed: parseUnifiedDiff(text, { keepText: keepSignalFileText() }) });

  return { run, parsedFile, parsedDiff, parseConfig, renderMarkdown };
}

const codes = (report: { messages: Message[] }) => report.messages.map((message) => message.code);

describe("check(): parsed coverage files and parsed diffs", () => {
  it("AC-4: the golden sets give the same reports from parsed inputs as from text, equal to the committed goldens", async () => {
    const { run, parsedFile, parsedDiff, parseConfig, renderMarkdown } = await load();
    const repoOptions = { repoRoot: REPO_ROOT };

    const config = parseConfig(fixture("golden-exclusions/ci.yml")) as {
      coverage?: { exclude?: string[]; threshold?: number };
    };

    const sets: {
      dir: string;
      files: { name: string; file?: string }[];
      format: Selection;
      extra?: Record<string, unknown>;
    }[] = [
      { dir: "golden", files: [{ name: "coverage.info" }], format: "lcov" },
      { dir: "golden-cobertura", files: [{ name: "coverage.xml" }], format: "auto" },
      {
        dir: "golden-exclusions",
        files: [{ name: "coverage.info" }],
        format: "lcov",
        extra: { threshold: config.coverage?.threshold ?? null, exclude: config.coverage?.exclude ?? [] },
      },
      {
        dir: "golden-multi",
        files: [
          { name: "coverage-a.info", file: "coverage/a/lcov.info" },
          { name: "coverage-b.info", file: "coverage/b/lcov.info" },
        ],
        format: "auto",
      },
    ];

    for (const { dir, files, format, extra } of sets) {
      const diffText = fixture(`${dir}/pr.diff`);
      const common = { threshold: 80, repoFiles: lines(`${dir}/files.txt`), ...extra };

      const textCoverage =
        files.length === 1 && files[0]?.file === undefined
          ? { text: fixture(`${dir}/${files[0]?.name}`), format }
          : {
              files: files.map(({ name, file }) => ({ text: fixture(`${dir}/${name}`), ...(file ? { file } : {}) })),
              format,
            };
      const textReport = run({ ...common, coverage: textCoverage, diff: { text: diffText } });

      const parsedReport = run({
        ...common,
        coverage: {
          files: files.map(({ name, file }) => parsedFile(fixture(`${dir}/${name}`), format, repoOptions, file)),
          format,
        },
        diff: parsedDiff(diffText),
      });

      expectValidReport(textReport);
      expectValidReport(parsedReport);
      expect(parsedReport, dir).toEqual(textReport);

      // The committed golden files, compared byte for byte (never through a file snapshot, which -u could rewrite).
      expect(asFile(parsedReport), `${dir}/report.json`).toBe(fixture(`${dir}/report.json`));
      expect(asFile(textReport), `${dir}/report.json from text`).toBe(fixture(`${dir}/report.json`));
      expect(renderMarkdown(parsedReport), `${dir}/report.md`).toBe(fixture(`${dir}/report.md`));
      expect(renderMarkdown(textReport), `${dir}/report.md from text`).toBe(fixture(`${dir}/report.md`));
    }
  });

  it("AC-5: roots, a text and parsed mix, a tracked coverage file and a config-editing diff give equal reports parsed and as text", async () => {
    const { run, parsedFile, parsedDiff } = await load();
    const goldenDiff = fixture("golden/pr.diff");
    const goldenFiles = lines("golden/files.txt");

    const cases: { label: string; text: Record<string, unknown>; parsed: Record<string, unknown>; code?: string }[] =
      [];

    // The absolute-path lcov fixture with a repo root.
    {
      const text = fixture("lcov/absolute.info");
      const common = { threshold: 80, repoFiles: goldenFiles };
      cases.push({
        label: "absolute lcov with a repo root",
        text: {
          ...common,
          coverage: { files: [{ text, file: "lcov.info" }], format: "lcov" },
          diff: { text: goldenDiff },
        },
        parsed: {
          ...common,
          coverage: { files: [parsedFile(text, "lcov", { repoRoot: REPO_ROOT }, "lcov.info")], format: "lcov" },
          diff: parsedDiff(goldenDiff),
        },
      });
    }

    // A package-relative lcov fixture with a coverage root.
    {
      const dir = "coverage-paths/package-relative";
      const text = fixture(`${dir}/coverage.info`);
      const diff = fixture(`${dir}/pr.diff`);
      const common = { threshold: 80, repoFiles: lines(`${dir}/files.txt`), coverageRoot: "packages/core" };
      cases.push({
        label: "package-relative lcov with a coverage root",
        text: {
          ...common,
          coverage: { files: [{ text, file: "coverage.info" }], format: "lcov" },
          diff: { text: diff },
        },
        parsed: {
          ...common,
          coverage: {
            files: [parsedFile(text, "lcov", { repoRoot: REPO_ROOT, coverageRoot: "packages/core" }, "coverage.info")],
            format: "lcov",
          },
          diff: parsedDiff(diff),
        },
      });
    }

    // A multi-file input mixing one text file and one parsed file.
    {
      const a = fixture("golden-multi/coverage-a.info");
      const b = fixture("golden-multi/coverage-b.info");
      const diff = fixture("golden-multi/pr.diff");
      const common = { threshold: 80, repoFiles: lines("golden-multi/files.txt"), diff: { text: diff } };
      cases.push({
        label: "one text file and one parsed file",
        text: {
          ...common,
          coverage: {
            files: [
              { text: a, file: "coverage/a/lcov.info" },
              { text: b, file: "coverage/b/lcov.info" },
            ],
            format: "auto",
          },
        },
        parsed: {
          ...common,
          coverage: {
            files: [
              { text: a, file: "coverage/a/lcov.info" },
              parsedFile(b, "auto", { repoRoot: REPO_ROOT }, "coverage/b/lcov.info"),
            ],
            format: "auto",
          },
        },
      });
    }

    // A parsed lcov file whose path is a tracked file.
    {
      const text = fixture("golden/coverage.info");
      const common = { threshold: 80, repoFiles: [...goldenFiles, "coverage/lcov.info"] };
      cases.push({
        label: "a tracked coverage file",
        code: "COVERAGE_FILE_TRACKED",
        text: {
          ...common,
          coverage: { files: [{ text, file: "coverage/lcov.info" }], format: "lcov" },
          diff: { text: goldenDiff },
        },
        parsed: {
          ...common,
          coverage: {
            files: [parsedFile(text, "lcov", { repoRoot: REPO_ROOT }, "coverage/lcov.info")],
            format: "lcov",
          },
          diff: parsedDiff(goldenDiff),
        },
      });
    }

    // A parsed diff that edits .pharn/ci.yml.
    {
      const text = fixture("gate-tamper/coverage.info");
      const diff = fixture("gate-tamper/config-modified.diff");
      const common = { threshold: 80, repoFiles: lines("gate-tamper/files.txt") };
      cases.push({
        label: "a diff that edits .pharn/ci.yml",
        code: "CONFIG_CHANGED_IN_DIFF",
        text: {
          ...common,
          coverage: { files: [{ text, file: "coverage/lcov.info" }], format: "lcov" },
          diff: { text: diff },
        },
        parsed: {
          ...common,
          coverage: {
            files: [parsedFile(text, "lcov", { repoRoot: REPO_ROOT }, "coverage/lcov.info")],
            format: "lcov",
          },
          diff: parsedDiff(diff),
        },
      });
    }

    for (const { label, text, parsed, code } of cases) {
      const textReport = run(text);
      const parsedReport = run(parsed);
      expectValidReport(textReport);
      expectValidReport(parsedReport);
      expect(parsedReport, label).toEqual(textReport);
      if (code !== undefined) {
        expect(codes(textReport), `${label} (text)`).toContain(code);
        expect(codes(parsedReport), `${label} (parsed)`).toContain(code);
      }
    }
  });

  it("AC-6: an empty parsed map, a parsed empty file and a parsed unknown file report like their text forms", async () => {
    const { run } = await load();
    const common = {
      threshold: 80,
      diff: { text: fixture("golden/pr.diff") },
      repoFiles: lines("golden/files.txt"),
    };

    for (const { label, format, selection, file, textFixture, code } of [
      {
        label: "an empty parsed map",
        format: "lcov",
        selection: "lcov",
        file: "coverage/lcov.info",
        textFixture: "lcov/no-lines.info",
        code: "COVERAGE_FILE_EMPTY",
      },
      {
        label: "a file chosen as empty",
        format: "empty",
        selection: "auto",
        file: "coverage/lcov.info",
        textFixture: "lcov/empty.info",
        code: "COVERAGE_FILE_EMPTY",
      },
      {
        label: "a file chosen as unknown",
        format: "unknown",
        selection: "auto",
        file: "coverage.xml",
        textFixture: "cobertura/clover.xml",
        code: "COVERAGE_FORMAT_UNSUPPORTED",
      },
    ] as const) {
      const parsedReport = run({
        ...common,
        coverage: { files: [{ parsed: new Map(), format, file }], format: selection },
      });
      const textReport = run({
        ...common,
        coverage: { files: [{ text: fixture(textFixture), file }], format: selection },
      });

      expectValidReport(parsedReport);
      expectValidReport(textReport);
      expect(parsedReport.diffCoverage, label).toBeNull();
      expect(parsedReport.verdict, label).toBe("fail");

      const expected = (textReport.messages as Message[]).filter((message) => message.code === code);
      expect(expected, `${label} (text run)`).toHaveLength(1);
      const actual = (parsedReport.messages as Message[]).filter((message) => message.code === code);
      expect(actual, label).toEqual(expected);
    }
  });
});
