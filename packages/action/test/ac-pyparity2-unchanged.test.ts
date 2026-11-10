import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foldCoverageBar } from "../../core/test/helpers.js";
import { withoutSchemaLevelEdits } from "../../core/test/level-edits.js";
import { withoutTi17SchemaEdits } from "../../core/test/ti17-schema.js";
import { V070_INJECTION_CODES, withoutV070Properties } from "../../core/test/v070-codes.js";
import { V080_CODES, withoutV080Properties } from "../../core/test/v080-codes.js";
import { withoutFixJson, withoutV090SchemaEdits } from "../../core/test/v090-codes.js";

// Reads the repository and the base commit with git; nothing the build adds is loaded. The base is the commit this
// increment starts from. The committed action dist must be a fresh bundle that carries the alias reader, so this test
// fails until the build rebuilds it; the two ADDED_AFTER_BASE sets must name exactly the TI02 and TI05 case
// directories added after the base, so it fails until the build adds them.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// Rebased onto main after #100 (TI11/TI09/TI15/TI06 precision), which changed schema/report.v2.json and re-pinned the
// regression tests on its own; the comparison is with that main commit, where this increment now starts.
const BASE = "e13765681e266dd33c27b5d46bbbf34d359cba4e";
const MARKER = "pythonImportAliases";
// Re-pinned for the agent-config secrets change (E3 item 26): the message codes may grow by exactly these 12, and the
// schema's message-code description by the one text that names them.
const FINAL_SENTENCE = "No code is removed or renamed before 1.0.";
const APPENDED_START = " Codes added in v0.4.0:";
const SECRET_CODES = [
  ...Array.from({ length: 11 }, (_, i) => `AGENT_CONFIG_SECRET_S${String(i + 1).padStart(2, "0")}`),
  "AGENT_CONFIG_SECRET_UNSCANNED",
  // Re-pinned for E3 item 20 (the org policy): the same appended text and report.ts also gain these two codes.
  "POLICY_OVERRIDE_IGNORED",
  "POLICY_UNAVAILABLE",
  // Re-pinned for E3 item 21 (the run upload): the same appended text and report.ts also gain this code.
  "UPLOAD_TOO_LARGE",
  // Re-pinned for E3 item 22 (policy rules): the appended schema text and report.ts also gain these two rule codes.
  "POLICY_P08",
  "POLICY_P09",
  // E3 item 24a part B (P11): the appended schema text and report.ts also gain these two codes; this only adds to what
  // the pin allows.
  "POLICY_P11",
  "AGENT_PR_DETECTION_INCOMPLETE",
  // Re-pinned for E3 item 23 (policy settings): the appended schema text and report.ts also gain these six codes.
  "POLICY_P02",
  "POLICY_P03",
  "POLICY_P04",
  "POLICY_P05",
  "POLICY_P06",
  "POLICY_SETTINGS_INVALID",
  // E3 item 24 (P07): the appended schema text and report.ts also gain this rule code; this only adds to what the pin
  // allows.
  "POLICY_P07",
  // policy-p13 (Horizon 2 item H1): the appended " Codes added in v0.6.0:" text and report.ts also gain this rule code;
  // this only adds to what the pin allows.
  "POLICY_P13",
  // Re-pinned for policy rule P14 (agent PR size cap): the schema's message-code description (in a " Codes added in
  // v0.6.0:" text) and report.ts also gain this rule code; this only adds to what the pin allows.
  "POLICY_P14",
  // Re-pinned for A8 step 1: the schema's message-code description (in a " Codes added in v0.7.0:" text) and report.ts
  // also gain this code; this only adds to what the pin allows.
  "TESTS_NOT_EXERCISING_CHANGES",
  // Re-pinned for stale instructions (Horizon 2 item H3): the same " Codes added in v0.7.0:" text and report.ts also gain
  // these four codes; this only adds to what the pin allows.
  "SETUP_STALE_SI01",
  "SETUP_STALE_SI02",
  "SETUP_STALE_SI03",
  "SETUP_STALE_SI04",
  // Re-pinned for H4 (prompt-injection scan): the same v0.7.0 text and report.ts also gain the six INJECTION_ codes;
  // this only adds to what the pin allows. Its `injection` object is cut by withoutV070Properties.
  ...V070_INJECTION_CODES,
  // Re-pinned for flaky tests (A6): the " Codes added in v0.8.0:" text and report.ts also gain these four codes
  // (V080_CODES); this only adds to what the pin allows.
  // Re-pinned for dependency safety (A13, v0.8.0): the same v0.8.0 text and report.ts gain its seven DEPENDENCY_ codes
  // (also in V080_CODES); this only adds to what the pin allows. Its `dependencies` object is cut by
  // withoutV080Properties.
  ...V080_CODES,
  // Re-pinned for ti17-always-true-matcher-2: the schema's message-code description (the TI17 passage after the TI16 one)
  // and report.ts also gain this signal id and its message code; this only adds to what the pin allows.
  "TI17",
  "TEST_INTEGRITY_TI17",
];

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
// Re-pinned again by ti03-skip-evasion (review B1): both files put the earlier TI03 sentence for a skip the diff shows
// as new back into their records before hashing, so their output digests are unchanged; these are the edited files.
// Re-pinned again by the 2026-11-01 review fixes: both files leave the review's new TI10 and TI14 fixtures out
// of their loops (their output digests are unchanged); these are the edited files.
// Re-pinned again by block-fails-closed-unavailable (review HIGH 4): ac-ti0205-regression is edited on purpose (a
// whole-run unavailable message is an error in block, was a warn), so this is the digest of the edited file.
// Re-pinned again by comment-coverage-bar: ac-accept-signoff-regression folds the new diff-coverage bar line out of
// fixtures/golden/report.md before hashing it (its golden digest is unchanged); this is the digest of the edited file.
// Re-pinned again by fix-hints (H6): ac-accept-signoff-regression and ac-ti0205-regression take the `fix` objects out of
// the reports and goldens before hashing them (their output digests are unchanged); these are the digests of the edited
// files.
// Re-pinned again by ti17-always-true-matcher-2: the walker's ADDED_AFTER_BASE gains the 35 TI17 fixtures (its count and
// output digest are unchanged); this is the digest of the edited file.
const NAME_ONLY_REPINNED: Record<string, string> = {
  "packages/action/test/ac-accept-signoff-regression.test.ts":
    "92e68fd78f2900f831408a629e229a07693b8c7f322ad59d25b949b6452cadb1",
  // Re-pinned again by A8 step 1 (TESTS_NOT_EXERCISING_CHANGES): ac-ti0205-regression takes the tests-exercise message
  // and testIntegrity.exercise out of the golden reports made with sources before comparing (exercise-repin.ts); this
  // is the digest of the edited file.
  "packages/core/test/ac-ti0205-regression.test.ts": "7583e11f397f59d04123ebdb7afea818d37f5a4b3522e32d3badd26fe104369b",
  // Re-pinned again by ti17-always-true-matcher-2: ac-skylos-nine-table moves always-true-matcher to caught by TI17 (the
  // Skylos count reads 8 of 9 now, 7 of 9 before); this is the digest of the edited file.
  "packages/core/test/ac-skylos-nine-table.test.ts": "68f84a33ecf1e4b4e94fc13c2c6c9065339a46e6d0d69b925905a1e39ac13976",
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
  it("AC-20: schema/ is byte-identical to the base, the message codes and signal ids are unchanged, the pinned regression tests and digests are as at the base, only the new TI02 and TI05 cases join the ADDED_AFTER_BASE sets, no existing fixture changes, the Skylos table reads 8 of 9, and the committed dist is a fresh bundle", () => {
    // schema/ is byte-identical: the same files with the same bytes.
    const schemaNow = readdirSync(join(ROOT, "schema")).sort();
    const schemaBase = git("ls-tree", "--name-only", `${BASE}:schema`)
      .split("\n")
      .filter((n) => n !== "")
      .sort();
    // policy-v1-schema (E3 item 25) adds schema/policy.v1.json, a new file with no base bytes: it is the one file
    // accepted beyond the base list, and every file the base has is still compared below.
    // The run upload (E3 item 21) adds schema/upload-meta.v1.json the same way.
    expect(schemaNow, "the files of schema/").toEqual([...schemaBase, "policy.v1.json", "upload-meta.v1.json"].sort());
    // precision-v030: TI15 became an info signal, so report.v2.json accepts exactly one change: its
    // `TEST_INTEGRITY_TI15 (` part (up to the next `TEST_INTEGRITY_` code) now says `info in modes block and warn`.
    // With that part put back from the base the file must equal the base bytes; every other schema file is unchanged.
    for (const name of schemaBase) {
      if (name !== "report.v2.json") {
        expect(sha256(read(`schema/${name}`)), `schema/${name}`).toBe(sha256(atBase(`schema/${name}`)));
        continue;
      }
      const START = "TEST_INTEGRITY_TI15 (";
      const partOf = (text: string): [number, number] => {
        const start = text.indexOf(START);
        expect(start, `report.v2.json holds "${START}"`).toBeGreaterThan(-1);
        const next = text.indexOf("TEST_INTEGRITY_", start + START.length);
        return [start, next === -1 ? text.length : next];
      };
      // Re-pinned for the agent-config secrets change (E3 item 26): the one text starting ` Codes added in v0.4.0:`
      // right after the final sentence of the message-code description is cut out first (it names the 12 new codes).
      // agent-pr-detection (E3 item 24a) adds the optional meta.isAgentPr property: its four inserted lines appear once
      // and are cut out of the current text as well.
      const isAgentPrLines = [
        '        "isAgentPr": {',
        '          "description": "true when the pull request counts as an agent PR, including when detection could not read all of its evidence; false when the run has no pull request.",',
        '          "type": "boolean"',
        "        },",
        "",
      ].join("\n");
      // Re-pinned by docs-schema-levels: the two insertions that state the block-mode levels of DIFF_UNAVAILABLE and
      // TEST_INTEGRITY_INDEX_UNAVAILABLE are taken out first (level-edits.ts); every other byte stays pinned.
      // Re-pinned for A8 step 1 (TESTS_NOT_EXERCISING_CHANGES): the optional testIntegrity.exercise property is taken
      // out too (v070-codes.ts pins it exactly); its code is in the appended text cut out below.
      // Re-pinned for stale instructions (Horizon 2 item H3): its top-level setupHealth property is taken out the same
      // way.
      // Re-pinned for flaky tests (A6, v0.8.0): the flaky description is taken out the same way (v080-codes.ts).
      // Re-pinned for dependency safety (A13, v0.8.0): withoutV080Properties also takes out its top-level
      // `dependencies` object (v080-codes.ts pins it exactly); its part of the v0.8.0 code text is in the appended text.
      // Re-pinned for fix-hints (H6): the `$defs.fix` object and the six `fix` properties are taken out first
      // (v090-codes.ts pins them exactly).
      // Re-pinned for ti17-always-true-matcher-2: the TI17 id pattern and code text are taken out first (ti17-schema.ts).
      const withIsAgentPr = withoutSchemaLevelEdits(
        withoutV080Properties(
          withoutV070Properties(withoutV090SchemaEdits(withoutTi17SchemaEdits(read(`schema/${name}`)))),
        ),
      );
      expect(withIsAgentPr.split(isAgentPrLines).length - 1, "the four isAgentPr lines appear once").toBe(1);
      const currentText = withIsAgentPr.replace(isAgentPrLines, "");
      const sentenceEnd = currentText.indexOf(FINAL_SENTENCE) + FINAL_SENTENCE.length;
      expect(currentText.slice(sentenceEnd, sentenceEnd + APPENDED_START.length), "the appended v0.4.0 text").toBe(
        APPENDED_START,
      );
      let appendedEnd = sentenceEnd;
      while (appendedEnd < currentText.length && currentText[appendedEnd] !== '"') {
        appendedEnd += currentText[appendedEnd] === "\\" ? 2 : 1;
      }
      const nowText = currentText.slice(0, sentenceEnd) + currentText.slice(appendedEnd);
      const baseText = atBase(`schema/${name}`);
      const [ns, ne] = partOf(nowText);
      const [bs, be] = partOf(baseText);
      expect(nowText.slice(ns, ne), "the TI15 part says info in modes block and warn").toContain(
        "info in modes block and warn",
      );
      expect(
        sha256(nowText.slice(0, ns) + baseText.slice(bs, be) + nowText.slice(ne)),
        "report.v2.json with the TI15 part put back is as at the base",
      ).toBe(sha256(baseText));
    }

    // The message codes and signal ids: the schema's (byte-identical above) and the TypeScript types'.
    const withSecretCodes = (list: string[]) => [...new Set([...list, ...SECRET_CODES])].sort();
    expect(codes(read("packages/core/src/report.ts")), "report.ts codes and ids").toEqual(
      withSecretCodes(codes(atBase("packages/core/src/report.ts"))),
    );
    const words = (text: string) =>
      [...new Set([...text.matchAll(/\b(?:TI\d\d|[A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g)].map((m) => m[0]))].sort();
    const schemaWords = words(read("schema/report.v2.json"));
    expect(schemaWords, "report.v2.json names TI16 and its code").toEqual(
      expect.arrayContaining(["TI16", "TEST_INTEGRITY_TI16", "TEST_INTEGRITY_INDEX_UNAVAILABLE"]),
    );
    expect(schemaWords, "report.v2.json codes and ids as at the base, plus the 12 agent config secret codes").toEqual(
      withSecretCodes(words(atBase("schema/report.v2.json"))),
    );

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
    // Re-pinned for comment-coverage-bar (the diff-coverage bar in the PR comment): the four golden report.md files
    // gained the bar line on purpose. They are the only modified fixtures, and folding the bar line (and the empty line
    // under it) back out must give each one's content at the base byte for byte.
    const barred = /^M\t(fixtures\/golden(?:-cobertura|-exclusions|-multi)?\/report\.md)$/;
    // Re-pinned for fix-hints (H6): the five committed report JSON goldens that carry a message gained a `fix` on each
    // message on purpose. They are modified, never added or deleted, and with their `fix` objects taken out each one is
    // its content at the base byte for byte.
    const fixed =
      /^M\t(fixtures\/(?:golden|golden-cobertura|golden-multi|coverage-paths\/package-relative)\/report(?:-warn)?\.json)$/;
    for (const line of statuses) {
      const path = barred.exec(line)?.[1];
      if (path !== undefined) expect(foldCoverageBar(read(path)), line).toBe(atBase(path));
      const fixedPath = fixed.exec(line)?.[1];
      if (fixedPath !== undefined) expect(withoutFixJson(read(fixedPath)), line).toBe(atBase(fixedPath));
    }
    // Re-pinned for ti17-always-true-matcher-2: the two unknown-signal-key policy fixtures name TI18 instead of TI17 now
    // that TI17 is a signal. Each is modified, never added or deleted, and with TI18 turned back into TI17 it is its
    // content at the base byte for byte.
    const unknownTi = /^M\t(fixtures\/policy\/invalid\/unknown-ti\.(?:json|paths))$/;
    for (const line of statuses) {
      const unknownPath = unknownTi.exec(line)?.[1];
      if (unknownPath !== undefined)
        expect(read(unknownPath).split("TI18").join("TI17"), line).toBe(atBase(unknownPath));
    }
    expect(
      statuses.filter((l) => !l.startsWith("A\t") && !barred.test(l) && !fixed.test(l) && !unknownTi.test(l)),
      "no fixture of the base is modified or deleted",
    ).toEqual([]);

    // The Skylos count: 8 of 9 since ti17-always-true-matcher-2 (it was 7 of 9).
    const limits = read("docs/LIMITS.md");
    expect(limits, "docs/LIMITS.md says 8 of 9").toContain("catch **8 of 9**");
    expect(read("packages/core/test/ac-skylos-nine-table.test.ts"), "the Skylos table test reads 8/9").toContain(
      '"8/9"',
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
