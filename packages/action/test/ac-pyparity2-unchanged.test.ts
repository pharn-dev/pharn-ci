import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Reads the repository and the base commit with git; nothing the build adds is loaded. The base is the commit this
// increment starts from. The committed action dist must be a fresh bundle that carries the alias reader, so this test
// fails until the build rebuilds it; the two ADDED_AFTER_BASE sets must name exactly the TI02 and TI05 case
// directories added after the base, so it fails until the build adds them.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// Rebased onto main after #100 (TI11/TI09/TI15/TI06 precision), which changed schema/report.v2.json and re-pinned the
// regression tests on its own; the comparison is with that main commit, where this increment now starts.
const BASE = "e13765681e266dd33c27b5d46bbbf34d359cba4e";
const MARKER = "pythonImportAliases";

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const atBase = (path: string) => git("show", `${BASE}:${path}`);
const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** The regression test files that pin earlier state by digest and must not change a byte. */
const PINNED = [
  "packages/action/test/ac-accept-signoff-regression.test.ts",
  "packages/core/test/ac-ti0205-regression.test.ts",
  "packages/core/test/ac-ti081516-regression.test.ts",
  "packages/core/test/ac-skylos-nine-table.test.ts",
];
/**
 * The files the name-only-moves change re-pins on purpose (TI01's same-stem rule and TI02's phase-2 leaf pick now need
 * body evidence): for exactly these, the new sha256 of the file is accepted instead of the base bytes.
 */
const NAME_ONLY_REPINNED: Record<string, string> = {
  "packages/action/test/ac-accept-signoff-regression.test.ts":
    "d3b2fef3e8d8dc20e52dafbf368375f370cba211969987cfd1cb6e6e7fb24077",
  "packages/core/test/ac-ti0205-regression.test.ts": "0e7ec98bf36dc000fb3419b35c0889b9ad23952826984145ee29be1561b5497d",
};
/** The digests of ac-ti06-ti12-unchanged.test.ts the name-only-moves change re-pins; every other one is as at the base. */
const NAME_ONLY_DIGESTS: Record<string, string> = {
  EARLIER_DIGEST: "0197e0cfe0e50e9dfc8c453e5bfa978147632c47ab09dfc073d770cd965bb04f",
  PAIR_DIGEST: "129d9dbe605feab5c7cd65df323ee57ca43e4cb19a1142f99402c8048073d867",
};
/** The two tests whose case listings gain an ADDED_AFTER_BASE set for the new TI02 and TI05 directories. */
const LISTINGS = ["packages/core/test/ac-ti06-ti12-unchanged.test.ts", "packages/node-io/test/ac-ti07-moved.test.ts"];

/** The string literals of the `ADDED_AFTER_BASE` set in a test file's text. */
function addedAfterBase(text: string, label: string): string[] {
  const found = /const ADDED_AFTER_BASE\b[^=]*=\s*new Set(?:<[^>]*>)?\(\s*\[/.exec(text);
  expect(found, `${label}: const ADDED_AFTER_BASE = new Set([ … ])`).not.toBeNull();
  const open = (found as RegExpExecArray).index + (found as RegExpExecArray)[0].length;
  const close = text.indexOf("]", open);
  return [...text.slice(open, close).matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => (m[1] ?? m[2]) as string);
}

/** The case directories of fixtures/test-integrity/<id>/ now and at the base commit. */
function caseDirs(id: string): { now: string[]; base: string[] } {
  const now = readdirSync(join(ROOT, `fixtures/test-integrity/${id}`), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const base = git("ls-tree", "-d", "--name-only", `${BASE}:fixtures/test-integrity/${id}`)
    .split("\n")
    .filter((n) => n !== "")
    .sort();
  return { now, base };
}

/** The upper-case string literals (message codes, signal ids) of a text. */
const codes = (text: string) =>
  [...new Set([...text.matchAll(/"((?:TI\d\d)|(?:[A-Z][A-Z0-9]*_[A-Z0-9_]+))"/g)].map((m) => m[1] as string))].sort();

describe("pytest parity changes no schema, code, id, pinned output or dist freshness", () => {
  it("AC-20: schema/ is byte-identical to the base, the message codes and signal ids are unchanged, the pinned regression tests and digests are as at the base, only the new TI02 and TI05 cases join the ADDED_AFTER_BASE sets, no existing fixture changes, the Skylos table still reads 7 of 9, and the committed dist is a fresh bundle", () => {
    // schema/ is byte-identical: the same files with the same bytes.
    const schemaNow = readdirSync(join(ROOT, "schema")).sort();
    const schemaBase = git("ls-tree", "--name-only", `${BASE}:schema`)
      .split("\n")
      .filter((n) => n !== "")
      .sort();
    expect(schemaNow, "the files of schema/").toEqual(schemaBase);
    for (const name of schemaNow)
      expect(sha256(read(`schema/${name}`)), `schema/${name}`).toBe(sha256(atBase(`schema/${name}`)));

    // The message codes and signal ids: the schema's (byte-identical above) and the TypeScript types'.
    expect(codes(read("packages/core/src/report.ts")), "report.ts codes and ids").toEqual(
      codes(atBase("packages/core/src/report.ts")),
    );
    const words = (text: string) =>
      [...new Set([...text.matchAll(/\b(?:TI\d\d|[A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g)].map((m) => m[0]))].sort();
    const schemaWords = words(read("schema/report.v2.json"));
    expect(schemaWords, "report.v2.json names TI16 and its code").toEqual(
      expect.arrayContaining(["TI16", "TEST_INTEGRITY_TI16", "TEST_INTEGRITY_INDEX_UNAVAILABLE"]),
    );
    expect(schemaWords, "report.v2.json codes and ids as at the base").toEqual(words(atBase("schema/report.v2.json")));

    // The pinned regression tests: byte-identical, and the digests of ac-ti06-ti12-unchanged unchanged.
    for (const path of PINNED) {
      const repinned = NAME_ONLY_REPINNED[path];
      if (repinned !== undefined) expect(sha256(read(path)), `${path} as re-pinned by name-only-moves`).toBe(repinned);
      else expect(sha256(read(path)), `${path} as at the base`).toBe(sha256(atBase(path)));
    }
    const digest = (text: string, name: string) => {
      const m = new RegExp(`const ${name} = "([0-9a-f]{64})"`).exec(text);
      expect(m, name).not.toBeNull();
      return (m as RegExpExecArray)[1];
    };
    const unchanged = "packages/core/test/ac-ti06-ti12-unchanged.test.ts";
    for (const name of ["EARLIER_DIGEST", "PAIR_DIGEST"]) {
      expect(digest(read(unchanged), name), `${name} as at the base, or as re-pinned by name-only-moves`).toBe(
        NAME_ONLY_DIGESTS[name] ?? digest(atBase(unchanged), name),
      );
    }

    // Only the TI02 and TI05 case directories added after the base join the two ADDED_AFTER_BASE sets.
    const added: string[] = [];
    for (const id of ["TI02", "TI05"]) {
      const { now, base } = caseDirs(id);
      for (const name of base) expect(now, `${id}/${name} is still there`).toContain(name);
      added.push(...now.filter((n) => !base.includes(n)).map((n) => `${id}/${n}`));
    }
    expect(added.length, "new TI02 and TI05 case directories").toBeGreaterThanOrEqual(8);
    for (const path of LISTINGS) {
      const set = addedAfterBase(read(path), path);
      const named = set.map((entry) =>
        added.includes(entry) ? entry : (added.find((a) => a.endsWith(`/${entry}`)) ?? entry),
      );
      expect([...new Set(named)].sort(), `${path}: ADDED_AFTER_BASE names exactly the new directories`).toEqual(
        [...added].sort(),
      );
    }

    // No fixture that existed at the base changes or goes: the fixtures/ diff against the base only adds files.
    const statuses = git("diff", "--name-status", "--no-renames", BASE, "--", "fixtures/")
      .split("\n")
      .filter((l) => l !== "");
    expect(
      statuses.filter((l) => !l.startsWith("A\t")),
      "no fixture of the base is modified or deleted",
    ).toEqual([]);

    // The Skylos count: still 7 of 9.
    const limits = read("docs/LIMITS.md");
    expect(limits, "docs/LIMITS.md still says 7 of 9").toContain("catch **7 of 9**");
    expect(read("packages/core/test/ac-skylos-nine-table.test.ts"), "the Skylos table test reads 7/9").toContain(
      '"7/9"',
    );

    // The committed dist is a fresh bundle of packages/action/src and carries the alias reader.
    const committed = read("packages/action/dist/index.js");
    expect(committed, `the dist carries ${MARKER}`).toContain(MARKER);
    const out = mkdtempSync(join(tmpdir(), "pharn-ci-pyparity2-bundle-"));
    try {
      const outfile = join(out, "index.js");
      execFileSync(process.execPath, ["../../scripts/bundle.mjs", "src/index.ts", outfile], {
        cwd: join(ROOT, "packages/action"),
      });
      expect(sha256(committed), "the committed dist is a fresh bundle").toBe(sha256(readFileSync(outfile, "utf8")));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
