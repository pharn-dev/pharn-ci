import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// corpus-run-script: scripts/corpus-run.mjs turns a failed fetch, a CLI that crashes and a CLI that never exits into
// one `error` row per PR and carries on; `--limit` keeps each corpus file's first PRs; with no `--cache` the clone lives
// under PHARN_CORPUS_CACHE and no worktree is left behind. The local upstream, the bundled CLI and the corpus JSON are
// built in a temporary directory inside the test bodies' helpers, with a test-owned git config. No network call.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HEADER = "repo,pr,signal,severity,path,line,code,detail,verdict,note";
const COLUMNS = HEADER.split(",");
const TIMEOUT = 600_000;
const REPO = "local/upstream";
const MISSING_SHA = "deadbeef".repeat(5);

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
  const dir = mkdtempSync(join(tmpdir(), "pharn-corpus-run-errors-"));
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

const runCorpus = (
  fx: Fixture,
  opts: { corpus: string; cache?: string; out: string; cli?: string; extra?: string[]; envCache?: string },
) =>
  spawnSync(
    process.execPath,
    [
      "scripts/corpus-run.mjs",
      "--corpus",
      opts.corpus,
      ...(opts.cache === undefined ? [] : ["--cache", opts.cache]),
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
      env: { ...fx.env, PHARN_CORPUS_CACHE: opts.envCache ?? join(fx.dir, "unused") },
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
const projection = (rows: Row[]) =>
  rows.map((row) => [row.signal, row.severity, row.path, row.line, row.code].join("|")).sort();

/** One run into a fresh cache and output file; returns the parsed rows. */
const runFresh = (fx: Fixture, prs: Pr[], cli?: string, extra?: string[]) => {
  const dir = freshDir();
  const out = join(dir, "out.csv");
  const result = runCorpus(fx, {
    corpus: writeCorpus(join(dir, "corpus"), prs),
    cache: join(dir, "cache"),
    out,
    cli,
    extra,
  });
  expect(result.status, result.stderr).toBe(0);
  return rowsOf(readFileSync(out, "utf8"));
};

describe("corpus-run-script: errors, --limit and the cache", () => {
  it(
    "AC-4: a missing sha, a crashing CLI and a CLI that never exits each give one error row per PR and the run goes on",
    () => {
      const fx = fixture();
      const baseline = runFresh(fx, fx.prs);

      const withMissing = runFresh(fx, [...fx.prs, pr(105, fx.base, MISSING_SHA, "2026-10-24T00:00:00Z")]);
      const missing = rowsFor(withMissing, 105);
      expect(missing).toHaveLength(1);
      expect(missing[0]?.signal).toBe("error");
      expect(missing[0]?.detail ?? "", "#105's error detail").not.toBe("");
      for (const number of [101, 102, 103]) {
        expect(projection(rowsFor(withMissing, number)), `#${number} rows`).toEqual(
          projection(rowsFor(baseline, number)),
        );
        expect(rowsFor(baseline, number).length, `#${number} has rows`).toBeGreaterThan(0);
      }

      const stubs = freshDir();
      const boom = join(stubs, "stub-boom.mjs");
      writeFileSync(boom, 'process.stderr.write("boom\\nsecond line\\n");\nprocess.exitCode = 2;\n');
      const crashed = runFresh(fx, fx.prs, boom);
      for (const number of [101, 102, 103]) {
        const rows = rowsFor(crashed, number);
        expect(rows, `#${number} with the crashing CLI`).toHaveLength(1);
        expect(rows[0]).toMatchObject({ signal: "error", detail: "boom" });
      }

      const hang = join(stubs, "stub-hang.mjs");
      writeFileSync(hang, "setInterval(() => {}, 1000);\n");
      const hung = runFresh(fx, fx.prs, hang, ["--timeout", "1"]);
      for (const number of [101, 102, 103]) {
        const rows = rowsFor(hung, number);
        expect(rows, `#${number} with the CLI that never exits`).toHaveLength(1);
        expect(rows[0]?.signal).toBe("error");
        expect(rows[0]?.detail).toMatch(/timed out/i);
      }
    },
    TIMEOUT,
  );

  it(
    "AC-5: --limit 2 keeps the first two PRs in file order, and with no --cache the clone lives under PHARN_CORPUS_CACHE with no worktree left",
    () => {
      const fx = fixture();
      const limited = runFresh(fx, fx.prs, undefined, ["--limit", "2"]);
      const firstTwo = fx.prs.slice(0, 2).map((p) => String(p.number));
      expect(new Set(limited.map((row) => row.pr))).toEqual(new Set(firstTwo));

      const dir = freshDir();
      const envCache = join(dir, "envcache");
      const out = join(dir, "out.csv");
      const result = runCorpus(fx, { corpus: writeCorpus(join(dir, "corpus"), fx.prs), out, envCache });
      expect(result.status, result.stderr).toBe(0);

      const clone = join(envCache, "local__upstream");
      expect(existsSync(clone), "the clone is under PHARN_CORPUS_CACHE").toBe(true);
      expect(() => gitIn(fx.env, clone, ["rev-parse", "--git-dir"]), "the clone is a git repository").not.toThrow();
      const worktrees = execFileSync("git", ["-C", clone, "worktree", "list", "--porcelain"], {
        env: fx.env,
        encoding: "utf8",
      })
        .split("\n")
        .filter((line) => line.startsWith("worktree "));
      expect(worktrees, "git worktree list names only the clone").toHaveLength(1);
    },
    TIMEOUT,
  );
});
