import { describe, expect, it } from "vitest";
import type { DiffFile } from "../src/diff/unified.js";
import {
  detectStaleInstructions,
  MAX_STALE_FINDINGS,
  MAX_STALE_PER_FILE,
  STALE_AGE_SECONDS,
  type StaleInstructionSources,
  scanAgentSetup,
  staleInstructionMessages,
  staleTimestampPaths,
} from "../src/index.js";
import { fixture } from "./helpers.js";

// Stale instructions (Horizon 2 item H3): SI01 to SI04 against a fixed tree, diff-aware. The instruction texts and
// manifests come from fixtures/stale-instructions/ (stored as .txt, so this repository's inventory never lists them).

const REPO_FILES = [
  ".github/workflows/ci.yml",
  "AGENTS.md",
  "CLAUDE.md",
  "Makefile",
  "README.md",
  "docs/guide.md",
  "docs/setup.md",
  "package.json",
  "packages/web/CLAUDE.md",
  "packages/web/package.json",
  "packages/web/src/app.ts",
  "src/index.ts",
  "src/util/strings.ts",
];

const ROOT_TEXT = fixture("stale-instructions/root-claude.md.txt");
const GUARDS_TEXT = fixture("stale-instructions/guards.md.txt");
const LINKS_TEXT = fixture("stale-instructions/links.md.txt");
const PACKAGE = fixture("stale-instructions/package.json.txt");
const PACKAGE_BASE = fixture("stale-instructions/package-base.json.txt");
const MAKEFILE = fixture("stale-instructions/Makefile.txt");

const modified = (path: string): DiffFile => ({ path, oldPath: path, status: "modified", addedLines: [1] });
const deleted = (path: string): DiffFile => ({ path, oldPath: path, status: "deleted", addedLines: [] });
const renamed = (oldPath: string, path: string): DiffFile => ({ path, oldPath, status: "renamed", addedLines: [] });

function sources(
  files: Record<string, string>,
  extra: Partial<Omit<StaleInstructionSources, "instructions">> = {},
): StaleInstructionSources {
  return {
    instructions: { files: Object.entries(files).map(([path, text]) => ({ path, text })), dropped: [] },
    packageJson: { head: PACKAGE },
    makefile: { head: MAKEFILE },
    ...extra,
  };
}

function run(
  src: StaleInstructionSources,
  diff: readonly DiffFile[],
  repoFiles: readonly string[] = REPO_FILES,
): string[] {
  const { findings } = detectStaleInstructions({
    sources: src,
    diff,
    repoFiles,
    agentSetup: scanAgentSetup(repoFiles),
  });
  return findings.map((f) => `${f.id} ${f.path}:${f.line} ${f.kind} ${f.token ?? "-"}`);
}

describe("SI01 to SI03 when the change touches the instruction file", () => {
  it("must trigger: every missing script, make target, path and file the root CLAUDE.md names", () => {
    expect(run(sources({ "CLAUDE.md": ROOT_TEXT }), [modified("CLAUDE.md")])).toEqual([
      "SI01 CLAUDE.md:4 command pnpm run format",
      "SI01 CLAUDE.md:5 command npm run typecheck",
      "SI01 CLAUDE.md:6 command yarn run e2e",
      "SI01 CLAUDE.md:7 command bun run docs",
      "SI01 CLAUDE.md:8 command make deploy",
      "SI02 CLAUDE.md:11 path scripts/changelog.sh",
      "SI02 CLAUDE.md:12 path config/app.yml",
      "SI02 CLAUDE.md:13 path missing-helper.ts",
      "SI03 CLAUDE.md:15 file docs/install.md",
      "SI03 CLAUDE.md:16 file docs/conventions.md",
    ]);
  });

  it("must not trigger: the guards fixture gives nothing even when it is touched", () => {
    expect(run(sources({ "CLAUDE.md": GUARDS_TEXT }), [modified("CLAUDE.md")])).toEqual([]);
  });

  it("a nested instruction file: its links and ./ imports resolve from its directory, its paths from the root or its directory, and its commands are not compared with the root package.json", () => {
    expect(run(sources({ "packages/web/CLAUDE.md": LINKS_TEXT }), [modified("packages/web/CLAUDE.md")])).toEqual([
      "SI03 packages/web/CLAUDE.md:3 file packages/web/src/gone.ts",
      "SI03 packages/web/CLAUDE.md:4 file packages/web/assets/logo.png",
      "SI03 packages/web/CLAUDE.md:5 file docs/missing-ref.md",
      "SI02 packages/web/CLAUDE.md:7 path src/missing.ts",
      "SI03 packages/web/CLAUDE.md:8 file packages/web/README.md",
    ]);
  });

  it("shell blocks: missing scripts and targets are found, paths in them are not read", () => {
    expect(
      run(sources({ "CLAUDE.md": fixture("stale-instructions/shell-blocks.md.txt") }), [modified("CLAUDE.md")]),
    ).toEqual([
      "SI01 CLAUDE.md:6 command pnpm run missing-shell",
      "SI01 CLAUDE.md:8 command make missing-target",
      "SI01 CLAUDE.md:13 command npm run another-missing",
      "SI01 CLAUDE.md:18 command pnpm run env-missing",
      "SI01 CLAUDE.md:26 command yarn run untagged-missing",
    ]);
  });

  it("a renamed instruction file counts as touched, under its new path", () => {
    const repo = REPO_FILES.filter((p) => p !== "CLAUDE.md").concat("docs/CLAUDE.md");
    const out = run(
      sources({ "docs/CLAUDE.md": "See `scripts/gone.sh`.\n" }),
      [renamed("CLAUDE.md", "docs/CLAUDE.md")],
      repo,
    );
    expect(out).toEqual(["SI02 docs/CLAUDE.md:1 path scripts/gone.sh"]);
  });

  it("without a readable root package.json or Makefile no command is compared", () => {
    const src = sources({ "CLAUDE.md": ROOT_TEXT }, { packageJson: { head: null }, makefile: { head: null } });
    expect(run(src, [modified("CLAUDE.md")]).filter((f) => f.startsWith("SI01"))).toEqual([]);
    const unparsable = sources(
      { "CLAUDE.md": ROOT_TEXT },
      { packageJson: { head: "{" }, makefile: { head: "include x\n" } },
    );
    expect(run(unparsable, [modified("CLAUDE.md")]).filter((f) => f.startsWith("SI01"))).toEqual([]);
    const absent: StaleInstructionSources = { instructions: sources({ "CLAUDE.md": ROOT_TEXT }).instructions };
    expect(run(absent, [modified("CLAUDE.md")]).filter((f) => f.startsWith("SI01"))).toEqual([]);
  });
});

describe("diff-awareness: no finding unless the change touches the file or removes what it names", () => {
  it("an untouched instruction file with stale tokens gives nothing when the change removes nothing it names", () => {
    expect(run(sources({ "CLAUDE.md": ROOT_TEXT }), [modified("src/index.ts")])).toEqual([]);
    expect(run(sources({ "CLAUDE.md": ROOT_TEXT }), [])).toEqual([]);
  });

  it("must trigger: the change deletes or renames away a path or file an untouched instruction names", () => {
    const text = "Helpers: `src/util/strings.ts`.\nSee [the guide](docs/guide.md) and the `src/util` folder.\n";
    const repo = REPO_FILES.filter((p) => p !== "src/util/strings.ts" && p !== "docs/guide.md").concat(
      "docs/guide2.md",
    );
    expect(
      run(
        sources({ "AGENTS.md": text }),
        [deleted("src/util/strings.ts"), renamed("docs/guide.md", "docs/guide2.md")],
        repo,
      ),
    ).toEqual([
      "SI02 AGENTS.md:1 path src/util/strings.ts",
      "SI02 AGENTS.md:2 path src/util",
      "SI03 AGENTS.md:2 file docs/guide.md",
    ]);
  });

  it("must not trigger: a deleted path that is still tracked elsewhere under the same name, or a deletion the instruction does not name", () => {
    const text = "Helpers: `src/util/strings.ts`.\n";
    expect(run(sources({ "AGENTS.md": text }), [deleted("docs/old.md")])).toEqual([]);
  });

  it("must trigger: the change removes a package.json script or Makefile target an untouched instruction names", () => {
    const text = "Run `pnpm format`, `pnpm run typecheck` and `make deploy`.\n";
    const src = sources(
      { "AGENTS.md": text },
      {
        packageJson: { head: PACKAGE, base: PACKAGE_BASE },
        makefile: { head: MAKEFILE, base: `${MAKEFILE}deploy:\n` },
      },
    );
    expect(run(src, [modified("package.json"), modified("Makefile")])).toEqual([
      "SI01 AGENTS.md:1 command make deploy",
      "SI01 AGENTS.md:1 command pnpm run format",
    ]);
  });
});

describe("SI04: an old instruction file that names a file the change edits", () => {
  const HEAD = 2_000_000_000;
  const text = "The entry point is `src/index.ts`.\n";
  it("must trigger: last changed more than 90 days before HEAD, untouched, naming an edited file", () => {
    const src = sources(
      { "AGENTS.md": text },
      { commitTimes: { head: HEAD, files: [{ path: "AGENTS.md", time: HEAD - STALE_AGE_SECONDS - 1 }] } },
    );
    expect(run(src, [modified("src/index.ts")])).toEqual(["SI04 AGENTS.md:1 path src/index.ts"]);
  });

  it("must not trigger: 90 days exactly, no times, a touched instruction file, or an edit to a file it does not name", () => {
    const at = (time: number) =>
      sources({ "AGENTS.md": text }, { commitTimes: { head: HEAD, files: [{ path: "AGENTS.md", time }] } });
    expect(run(at(HEAD - STALE_AGE_SECONDS), [modified("src/index.ts")])).toEqual([]);
    expect(run(sources({ "AGENTS.md": text }), [modified("src/index.ts")])).toEqual([]);
    expect(run(at(0), [modified("src/index.ts"), modified("AGENTS.md")])).toEqual([]);
    expect(run(at(0), [modified("docs/guide.md")])).toEqual([]);
  });

  it("staleTimestampPaths names only the untouched instruction files that name an edited file", () => {
    const instructions = sources({ "AGENTS.md": text, "CLAUDE.md": "Nothing here.\n" }).instructions;
    const ask = (diff: DiffFile[]) =>
      staleTimestampPaths({ instructions, diff, repoFiles: REPO_FILES, agentSetup: scanAgentSetup(REPO_FILES) });
    expect(ask([modified("src/index.ts")])).toEqual(["AGENTS.md"]);
    expect(ask([modified("src/index.ts"), modified("AGENTS.md")])).toEqual([]);
    expect(ask([modified("docs/guide.md")])).toEqual([]);
    expect(
      staleTimestampPaths({ instructions: { unavailable: "x" }, diff: [], repoFiles: [], agentSetup: { files: [] } }),
    ).toEqual([]);
  });
});

describe("caps and messages", () => {
  it("keeps at most 20 findings per file and id and 100 in all, and the messages count the rest", () => {
    const text = Array.from({ length: 30 }, (_, i) => `\`src/missing-${String(i).padStart(2, "0")}.ts\``).join("\n");
    const files: Record<string, string> = {};
    const repo = [...REPO_FILES];
    const diff: DiffFile[] = [];
    for (let i = 0; i < 6; i++) {
      const path = `pkg${i}/AGENTS.md`;
      files[path] = text;
      repo.push(path);
      diff.push(modified(path));
    }
    const { findings, omitted } = detectStaleInstructions({
      sources: sources(files),
      diff,
      repoFiles: repo,
      agentSetup: scanAgentSetup(repo),
    });
    expect(findings).toHaveLength(MAX_STALE_FINDINGS);
    expect(findings.filter((f) => f.path === "pkg0/AGENTS.md")).toHaveLength(MAX_STALE_PER_FILE);
    expect(omitted).toEqual({ SI02: 6 * 30 - MAX_STALE_FINDINGS });
    const [message] = staleInstructionMessages(findings, omitted);
    expect(message?.code).toBe("SETUP_STALE_SI02");
    expect(message?.level).toBe("warn");
    expect(message?.text).toContain(`and ${6 * 30 - 5} more`);
  });

  it("one message per id in id order, SI04 info, naming locations only and never a token", () => {
    const messages = staleInstructionMessages(
      [
        { id: "SI01", path: "CLAUDE.md", line: 4, kind: "command", token: "pnpm run format" },
        { id: "SI03", path: "CLAUDE.md", line: 15, kind: "file", token: "docs/install.md" },
        { id: "SI04", path: "AGENTS.md", line: 1, kind: "path", token: "src/index.ts" },
      ],
      {},
    );
    expect(messages.map((m) => `${m.level} ${m.code}`)).toEqual([
      "warn SETUP_STALE_SI01",
      "warn SETUP_STALE_SI03",
      "info SETUP_STALE_SI04",
    ]);
    expect(messages[0]?.text).toBe(
      "Agent instruction files name commands that the root package.json or Makefile does not define: `CLAUDE.md:4`. An agent that runs them fails or improvises; fix the command or the instruction.",
    );
    for (const message of messages) {
      expect(message.text).not.toContain("format");
      expect(message.text).not.toContain("install.md");
      expect(message.text).not.toContain("src/index.ts");
    }
  });
});
