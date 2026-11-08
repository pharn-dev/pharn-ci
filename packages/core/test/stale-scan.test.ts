import { describe, expect, it } from "vitest";
import { parseMakeTargets, parsePackageScripts, scanInstructionTokens } from "../src/index.js";
import { classifyPath, MAX_SCAN_CHARS, MAX_TOKENS_PER_FILE } from "../src/setup/staleScan.js";
import { fixture } from "./helpers.js";

// Stale instructions (Horizon 2 item H3): what an instruction file names. Fixtures under fixtures/stale-instructions/
// are stored as .txt so the inventory never lists them as instruction files of this repository.

const commandsOf = (text: string) =>
  scanInstructionTokens(text).commands.map((c) => `${c.line} ${c.manager} ${c.name}`);
const referencesOf = (text: string) =>
  scanInstructionTokens(text).references.map((r) => `${r.line} ${r.kind} ${r.token}${r.relative ? " (relative)" : ""}`);

describe("scanInstructionTokens", () => {
  it("reads commands from inline code spans: package-manager scripts and make targets", () => {
    expect(commandsOf(fixture("stale-instructions/root-claude.md.txt"))).toEqual([
      "3 pnpm build",
      "3 pnpm test:unit",
      "4 pnpm format",
      "5 npm typecheck",
      "6 yarn e2e",
      "7 bun docs",
      "8 make lint",
      "8 make deploy",
    ]);
  });

  it("reads paths from inline code spans, and files from links and @ imports", () => {
    expect(referencesOf(fixture("stale-instructions/root-claude.md.txt"))).toEqual([
      "10 path src/index.ts",
      "10 path src/util/strings.ts",
      "10 path src/util",
      "11 path scripts/changelog.sh",
      "12 path docs/guide.md",
      "12 path config/app.yml",
      "13 path strings.ts",
      "13 path missing-helper.ts",
      "15 file docs/setup.md",
      "15 file docs/install.md",
      "16 file docs/conventions.md",
      "17 file AGENTS.md",
    ]);
  });

  it("must not read: URLs, globs, placeholders, variables, home and absolute paths, installs and build output, flags, versions, scoped packages, product names, .env files, negated lines and sections, example blocks, indented code, comments, frontmatter, builtins and binaries", () => {
    const text = fixture("stale-instructions/guards.md.txt");
    const tokens = scanInstructionTokens(text);
    // The only references left are the two that the detector judges with the tree (a module specifier and an
    // `owner/repo` pair without an extension, a local settings file and a path through a dot directory).
    expect(referencesOf(text)).toEqual([
      "14 path next/link",
      "14 path owner/repo",
      "15 path .claude/settings.local.json",
      "16 path cache/.state/run.json",
    ]);
    // Every command left is one the detector compares with the scripts: none is a builtin or a binary in disguise.
    expect(tokens.commands.map((c) => `${c.manager} ${c.name}`)).toEqual(["pnpm vitest", "pnpm tsc"]);
  });

  it("reads shell-fenced and unmarked blocks for commands only, after a prompt in a session block, and never other languages", () => {
    const text = fixture("stale-instructions/shell-blocks.md.txt");
    expect(commandsOf(text)).toEqual([
      "5 pnpm build",
      "6 pnpm missing-shell",
      "8 make test",
      "8 make missing-target",
      "13 npm another-missing",
      "18 pnpm env-missing",
      "26 yarn untagged-missing",
    ]);
    expect(scanInstructionTokens(text).references).toEqual([]);
  });

  it("reads relative links, images, reference definitions and ./ imports, and not anchors, mail or web links", () => {
    expect(referencesOf(fixture("stale-instructions/links.md.txt"))).toEqual([
      "3 file src/app.ts (relative)",
      "3 file ../../docs/guide.md (relative)",
      "3 file src/gone.ts (relative)",
      "4 file assets/logo.png (relative)",
      "5 file ../../docs/missing-ref.md (relative)",
      "7 path src/app.ts",
      "7 path src/missing.ts",
      "8 file README.md (relative)",
    ]);
    expect(commandsOf(fixture("stale-instructions/links.md.txt"))).toEqual(["6 pnpm web-missing"]);
  });

  it("is pure on odd input: empty text, a BOM, CRLF line ends, an unclosed fence and an unclosed comment", () => {
    expect(scanInstructionTokens("")).toEqual({ commands: [], references: [] });
    expect(referencesOf("﻿See `src/a.ts`.\r\nAnd `src/b.ts`.\r\n")).toEqual(["1 path src/a.ts", "2 path src/b.ts"]);
    expect(referencesOf("```ts\n`src/a.ts`\n")).toEqual([]);
    expect(referencesOf("<!-- open\n`src/a.ts`\n")).toEqual([]);
    expect(referencesOf("<!-- a --> `src/a.ts` <!-- b -->")).toEqual(["1 path src/a.ts"]);
  });

  it("stops at its caps: the scanned characters and the tokens per file", () => {
    const many = Array.from({ length: MAX_TOKENS_PER_FILE + 50 }, (_, i) => `\`src/f${i}.ts\``).join("\n");
    const tokens = scanInstructionTokens(many);
    expect(tokens.references.length + tokens.commands.length).toBe(MAX_TOKENS_PER_FILE);
    const late = `${"x".repeat(MAX_SCAN_CHARS)}\n\`src/late.ts\`\n`;
    expect(scanInstructionTokens(late).references).toEqual([]);
  });
});

describe("classifyPath", () => {
  it("keeps repo paths and leaves out everything else", () => {
    const kept = (token: string) => classifyPath(token, "path", true, 1)?.token ?? null;
    expect(kept("src/a.ts")).toBe("src/a.ts");
    expect(kept("./src/a.ts")).toBe("src/a.ts");
    expect(kept("docs/")).toBe("docs");
    expect(kept("README.md")).toBe("README.md");
    for (const token of [
      "a.b",
      "JSON.parse",
      "example.com/x.js",
      "src//a.ts",
      "src/a b.ts",
      "src/é.ts",
      "x".repeat(201),
      "build/out.js",
      ".env.local",
      "next.js",
    ]) {
      expect(kept(token), token).toBeNull();
    }
  });
});

describe("the root manifests", () => {
  it("parsePackageScripts names the scripts and the dependency binaries; a non-object is null", () => {
    const parsed = parsePackageScripts(fixture("stale-instructions/package.json.txt"));
    expect(parsed === null ? null : [...parsed.scripts]).toEqual(["build", "test", "test:unit", "lint", "dev"]);
    expect(parsed?.binaries.has("biome")).toBe(true);
    expect(parsed?.binaries.has("@biomejs/biome")).toBe(true);
    expect(parsed?.binaries.has("vitest")).toBe(true);
    expect(parsePackageScripts("[1]")).toBeNull();
    expect(parsePackageScripts("{ not json")).toBeNull();
    expect(parsePackageScripts(`${"[".repeat(5000)}${"]".repeat(5000)}`)).toBeNull();
  });

  it("parseMakeTargets reads target lines and skips assignments, recipes, comments and continuations; includes and pattern rules make it unknown", () => {
    const targets = parseMakeTargets(fixture("stale-instructions/Makefile.txt"));
    expect(targets === null ? null : [...targets].sort()).toEqual([".PHONY", "build", "clean", "lint", "test"]);
    expect(parseMakeTargets(fixture("stale-instructions/Makefile-include.txt"))).toBeNull();
    expect(parseMakeTargets("%.o: %.c\n\tcc $<\n")).toBeNull();
    expect(parseMakeTargets("$(NAME): x\n")).toBeNull();
  });
});
