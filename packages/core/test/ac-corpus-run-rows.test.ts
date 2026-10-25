import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// corpus-run-script: scripts/corpus-run.mjs runs a CLI bundled here over a local upstream git repository with three
// PR-like base/head commit pairs, and writes the review CSV. The upstream, the bundle and the corpus JSON are built in
// a temporary directory inside the test bodies' helpers; git runs with a test-owned global config and no system
// config, so the maintainer's own git setup (signing, URL rewrites) never reaches the fixture. No network call.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HEADER = "repo,pr,signal,severity,path,line,code,detail,verdict,note";
const COLUMNS = HEADER.split(",");
const TIMEOUT = 600_000;
const REPO = "local/upstream";

type Row = Record<string, string>;
type Pr = { number: number; mergedAt: string; baseSha: string; headSha: string; mergeCommitSha: string };
type Fixture = {
  dir: string;
  cli: string;
  upstream: string;
  url: string;
  env: NodeJS.ProcessEnv;
  base: string;
  prs: Pr[];
};

const dirs: string[] = [];
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "pharn-corpus-run-rows-"));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const GITCONFIG = [
  "[user]",
  "\tname = Corpus Test",
  "\temail = corpus-test@example.invalid",
  "[commit]",
  "\tgpgsign = false",
  "[tag]",
  "\tgpgsign = false",
  "[init]",
  "\tdefaultBranch = main",
  '[protocol "file"]',
  "\tallow = always",
  "",
].join("\n");

const gitIn = (env: NodeJS.ProcessEnv, cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

const writeCorpus = (dir: string, prs: Pr[]) => {
  mkdirSync(dir, { recursive: true });
  const doc = {
    repo: REPO,
    defaultBranch: "main",
    monorepo: false,
    frozenAt: "2026-10-25T00:00:00Z",
    excluded: { bots: 0, releases: 0 },
    prs,
  };
  writeFileSync(join(dir, "local__upstream.json"), `${JSON.stringify(doc, null, 2)}\n`);
  return dir;
};

const pr = (number: number, base: string, head: string, mergedAt: string): Pr => ({
  number,
  mergedAt,
  baseSha: base,
  headSha: head,
  mergeCommitSha: head,
});

/** Adds one head commit whose parent is the base commit, also at refs/pull/<n>/head, and returns its sha. */
const addHead = (fx: Pick<Fixture, "env" | "upstream" | "base">, n: number, change: () => void) => {
  change();
  gitIn(fx.env, fx.upstream, ["add", "-A"]);
  gitIn(fx.env, fx.upstream, ["commit", "-q", "-m", `pr ${n}`]);
  const sha = gitIn(fx.env, fx.upstream, ["rev-parse", "HEAD"]);
  gitIn(fx.env, fx.upstream, ["update-ref", `refs/pull/${n}/head`, sha]);
  gitIn(fx.env, fx.upstream, ["reset", "-q", "--hard", fx.base]);
  return sha;
};

let cached: Fixture | undefined;
const fixture = (): Fixture => {
  if (cached !== undefined) return cached;
  const dir = freshDir();
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  writeFileSync(join(dir, "gitconfig"), GITCONFIG);
  const env: NodeJS.ProcessEnv = { ...cleanEnv, GIT_CONFIG_GLOBAL: join(dir, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };

  const cli = join(dir, "cli.js");
  execFileSync(process.execPath, ["scripts/bundle.mjs", "packages/cli/src/index.ts", cli, "--shebang"], { cwd: ROOT });

  const upstream = join(dir, "upstream");
  mkdirSync(join(upstream, "src", "__tests__"), { recursive: true });
  gitIn(env, upstream, ["init", "-q", "-b", "main"]);
  gitIn(env, upstream, ["config", "user.name", "Corpus Test"]);
  gitIn(env, upstream, ["config", "user.email", "corpus-test@example.invalid"]);
  gitIn(env, upstream, ["config", "commit.gpgsign", "false"]);
  gitIn(env, upstream, ["config", "uploadpack.allowFilter", "true"]);
  gitIn(env, upstream, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
  writeFileSync(join(upstream, "src/app.ts"), "export const add = (a: number, b: number): number => a + b;\n");
  writeFileSync(join(upstream, "src/__tests__/b.test.ts"), 'import { it } from "vitest";\n\nit("adds", () => {});\n');
  writeFileSync(
    join(upstream, "src/user.test.ts"),
    "import { expect, it } from \"vitest\";\n\nit('a', () => {\n  expect(1).toBe(1);\n});\n",
  );
  writeFileSync(join(upstream, "README.md"), "# upstream\n");
  gitIn(env, upstream, ["add", "-A"]);
  gitIn(env, upstream, ["commit", "-q", "-m", "base"]);
  const base = gitIn(env, upstream, ["rev-parse", "HEAD"]);

  const at = { env, upstream, base };
  const h101 = addHead(at, 101, () => {
    rmSync(join(upstream, "src/__tests__/b.test.ts"));
    writeFileSync(join(upstream, "src/app.ts"), "export const add = (a: number, b: number): number => b + a;\n");
  });
  const h102 = addHead(at, 102, () => {
    const path = join(upstream, "src/user.test.ts");
    writeFileSync(path, readFileSync(path, "utf8").replace("it('a'", "it.only('a'"));
  });
  const h103 = addHead(at, 103, () => {
    writeFileSync(join(upstream, "README.md"), "# upstream\n\nMore words.\n");
  });

  // File order newest first and not ascending by number.
  const prs = [
    pr(103, base, h103, "2026-10-24T03:00:00Z"),
    pr(101, base, h101, "2026-10-24T02:00:00Z"),
    pr(102, base, h102, "2026-10-24T01:00:00Z"),
  ];
  cached = { dir, cli, upstream, url: pathToFileURL(upstream).href, env, base, prs };
  return cached;
};

const runCorpus = (fx: Fixture, opts: { corpus: string; cache: string; out: string; cli?: string; extra?: string[] }) =>
  spawnSync(
    process.execPath,
    [
      "scripts/corpus-run.mjs",
      "--corpus",
      opts.corpus,
      "--cache",
      opts.cache,
      "--out",
      opts.out,
      "--cli",
      opts.cli ?? fx.cli,
      "--remote-url-template",
      fx.url,
      ...(opts.extra ?? []),
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...fx.env, PHARN_CORPUS_CACHE: join(fx.dir, "unused") },
      timeout: 240_000,
    },
  );

/** A local RFC 4180 reader: CRLF records, double-quoted fields with doubled inner quotes. */
const parseRecords = (text: string): string[][] => {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i += 1;
    } else if (c === ",") {
      record.push(field);
      field = "";
      i += 1;
    } else if (c === "\r" && text[i + 1] === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i += 2;
    } else {
      field += c;
      i += 1;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
};

const rowsOf = (text: string): Row[] => {
  const [header, ...data] = parseRecords(text);
  expect(header).toEqual(COLUMNS);
  return data.map((fields) => {
    expect(fields, `record ${JSON.stringify(fields)} has ten fields`).toHaveLength(10);
    return Object.fromEntries(COLUMNS.map((column, index) => [column, fields[index] ?? ""]));
  });
};

const rowsFor = (rows: Row[], number: number) => rows.filter((row) => row.repo === REPO && row.pr === String(number));

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byLine = (a: string, b: string) => (a === b ? 0 : a === "" ? -1 : b === "" ? 1 : Number(a) - Number(b));
const compareRows = (a: Row, b: Row) =>
  byString(a.repo, b.repo) ||
  Number(a.pr) - Number(b.pr) ||
  byString(a.signal, b.signal) ||
  byString(a.path, b.path) ||
  byLine(a.line, b.line);

describe("corpus-run-script: the review CSV of a corpus run", () => {
  it(
    "AC-1: a run over the local upstream writes the header, a TI01 row, a TI04 row and a none row with empty verdicts",
    () => {
      const fx = fixture();
      const dir = freshDir();
      const out = join(dir, "out.csv");
      const result = runCorpus(fx, {
        corpus: writeCorpus(join(dir, "corpus"), fx.prs),
        cache: join(dir, "cache"),
        out,
      });
      expect(result.status, result.stderr).toBe(0);

      const text = readFileSync(out, "utf8");
      expect(text.split("\r\n")[0]).toBe(HEADER);
      const rows = rowsOf(text);

      expect(rowsFor(rows, 101)).toContainEqual(
        expect.objectContaining({
          signal: "TI01",
          severity: "block",
          path: "src/__tests__/b.test.ts",
          line: "",
          code: "TEST_INTEGRITY_TI01",
        }),
      );

      const ti04 = rowsFor(rows, 102).find((row) => row.signal === "TI04");
      expect(ti04, "#102 has a TI04 row").toBeDefined();
      expect(ti04).toMatchObject({ severity: "block", path: "src/user.test.ts", code: "TEST_INTEGRITY_TI04" });
      expect(ti04?.line).toMatch(/^[1-9]\d*$/);

      const clean = rowsFor(rows, 103);
      expect(clean).toHaveLength(1);
      expect(clean[0]?.signal).toBe("none");

      for (const row of rows) {
        expect(row.verdict, `${row.repo}#${row.pr} ${row.signal} verdict`).toBe("");
        expect(row.note, `${row.repo}#${row.pr} ${row.signal} note`).toBe("");
      }
      expect(existsSync(join(fx.dir, "unused")), "PHARN_CORPUS_CACHE is not used when --cache is given").toBe(false);
    },
    TIMEOUT,
  );

  it(
    "AC-2: --jobs 1 and --jobs 3 give byte-identical CSV files whose data rows are sorted",
    () => {
      const fx = fixture();
      const outs = ["1", "3"].map((jobs) => {
        const dir = freshDir();
        const out = join(dir, "out.csv");
        const result = runCorpus(fx, {
          corpus: writeCorpus(join(dir, "corpus"), fx.prs),
          cache: join(dir, "cache"),
          out,
          extra: ["--jobs", jobs],
        });
        expect(result.status, `--jobs ${jobs}: ${result.stderr}`).toBe(0);
        return readFileSync(out);
      });
      const [one, three] = outs as [Buffer, Buffer];
      expect(one.equals(three), "the two CSV files are byte-identical").toBe(true);

      const rows = rowsOf(one.toString("utf8"));
      expect(new Set(rows.map((row) => row.pr))).toEqual(new Set(["101", "102", "103"]));
      for (let i = 1; i < rows.length; i += 1) {
        const [prev, next] = [rows[i - 1] as Row, rows[i] as Row];
        expect(compareRows(prev, next), `row ${i} is not after row ${i + 1}`).toBeLessThanOrEqual(0);
      }
    },
    TIMEOUT,
  );

  it(
    "AC-3: a resumed run keeps a reviewed CSV byte-identical and a new PR only adds its own rows",
    () => {
      const fx = fixture();
      const dir = freshDir();
      const cache = join(dir, "cache");
      const out = join(dir, "out.csv");
      const corpus = writeCorpus(join(dir, "corpus"), fx.prs);

      const first = runCorpus(fx, { corpus, cache, out });
      expect(first.status, first.stderr).toBe(0);

      const lines = readFileSync(out, "utf8").split("\r\n");
      const index = lines.findIndex((line) => line.startsWith(`${REPO},101,TI01,`));
      expect(index, "the CSV has a TI01 record for #101").toBeGreaterThan(0);
      const target = lines[index] as string;
      expect(target.endsWith(",,"), "its verdict and note are empty").toBe(true);
      lines[index] = `${target.slice(0, -2)},FP,checked by hand`;
      const edited = lines.join("\r\n");
      writeFileSync(out, edited);

      const stub = join(dir, "stub-exit2.mjs");
      writeFileSync(stub, "process.exit(2);\n");
      const resumed = runCorpus(fx, { corpus, cache, out, cli: stub });
      expect(resumed.status, resumed.stderr).toBe(0);
      const afterResume = readFileSync(out);
      expect(rowsOf(afterResume.toString("utf8")).some((row) => row.signal === "error")).toBe(false);
      expect(afterResume.equals(Buffer.from(edited, "utf8")), "the edited CSV is byte-identical").toBe(true);

      const h104 = addHead(fx, 104, () => {
        writeFileSync(join(fx.upstream, "README.md"), "# upstream\n\nA fourth change.\n");
      });
      const corpus4 = writeCorpus(join(dir, "corpus4"), [pr(104, fx.base, h104, "2026-10-24T04:00:00Z"), ...fx.prs]);
      const grown = runCorpus(fx, { corpus: corpus4, cache, out });
      expect(grown.status, grown.stderr).toBe(0);

      const before = parseRecords(edited).map((record) => JSON.stringify(record));
      const grownText = readFileSync(out, "utf8");
      const after = parseRecords(grownText).map((record) => JSON.stringify(record));
      for (const record of before) expect(after, `kept: ${record}`).toContain(record);
      expect(rowsFor(rowsOf(grownText), 101)).toContainEqual(
        expect.objectContaining({ signal: "TI01", verdict: "FP", note: "checked by hand" }),
      );
      const added = after.filter((record) => !before.includes(record));
      expect(added.length, "#104 adds at least one row").toBeGreaterThan(0);
      expect(after.length).toBe(before.length + added.length);
      for (const record of added) {
        const fields = JSON.parse(record) as string[];
        expect(fields.slice(0, 2), `new row ${record}`).toEqual([REPO, "104"]);
      }
    },
    TIMEOUT,
  );
});
