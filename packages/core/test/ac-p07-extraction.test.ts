import { describe, expect, it } from "vitest";

// E3 item 24 (P07), AC-7. instructionDeclarations() is loaded inside the test body: the AC test is written before the
// build adds the extractor, so nothing the build adds may run while this file loads.

type Tools = { tools: string[]; line: number | null };
type Declarations = { patternScoped: boolean; packageManagers: Tools; testRunners: Tools };
interface Core {
  instructionDeclarations(text: string): Declarations;
}

const NONE: Tools = { tools: [], line: null };
const at = (line: number, ...tools: string[]): Tools => ({ tools, line });

describe("org policy rule P07: the extraction rules", { timeout: 60_000 }, () => {
  it("AC-7: instructionDeclarations follows the BOM, CRLF, frontmatter, pattern-scope, shell, command-line, fence, indented-code, backtick-run and line-number rules", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    expect(typeof core.instructionDeclarations).toBe("function");
    const decl = (text: string) => core.instructionDeclarations(text);
    const pm = (text: string) => decl(text).packageManagers;
    const tr = (text: string) => decl(text).testRunners;

    // A leading U+FEFF and CRLF line ends change nothing; frontmatter lines count toward line numbers.
    const plain = "# T\n\nRun `pnpm install`.\n";
    expect(decl(plain)).toEqual({ patternScoped: false, packageManagers: at(3, "pnpm"), testRunners: NONE });
    expect(decl(`\uFEFF${plain.replace(/\n/g, "\r\n")}`)).toEqual(decl(plain));
    expect(decl('---\nglobs: "**"\n---\n# T\n\nRun `pnpm install`.\n')).toEqual({
      patternScoped: false,
      packageManagers: at(6, "pnpm"),
      testRunners: NONE,
    });

    // Frontmatter: a first line `---` closed by a `---` line at line 50 or earlier; it declares nothing.
    expect(pm("---\nRun `npm install`.\n---\nRun `pnpm install`.\n")).toEqual(at(4, "pnpm"));
    expect(pm("\n---\nRun `npm install`.\n---\n"), "a `---` that is not line 1").toEqual(at(3, "npm"));
    const filler = (n: number) => Array.from({ length: n }, () => "x");
    const closedAt50 = ["---", "Run `npm install`.", ...filler(47), "---"];
    expect(closedAt50).toHaveLength(50);
    expect(pm(`${closedAt50.join("\n")}\n`), "closed at line 50").toEqual(NONE);
    const closedAt51 = ["---", "Run `npm install`.", ...filler(48), "---"];
    expect(closedAt51).toHaveLength(51);
    expect(pm(`${closedAt51.join("\n")}\n`), "closed at line 51").toEqual(at(2, "npm"));

    // patternScoped.
    const fm = (line: string) => `---\n${line}\n---\nBody.\n`;
    for (const scoped of [
      fm("globs: src/**"),
      fm("applyTo: 'web/**'"),
      '---\npaths:\n  - "py/**"\n---\nBody.\n',
      fm('fileMatchPattern: "*.py"'),
    ]) {
      expect(decl(scoped).patternScoped, scoped).toBe(true);
    }
    for (const unscoped of [
      fm('globs: "**"'),
      fm("applyTo: '**/*'"),
      fm("globs: *"),
      fm("alwaysApply: true"),
      "---\nglobs: src/**\nBody.\n",
      fm("Globs: src/**"),
    ]) {
      expect(decl(unscoped).patternScoped, unscoped).toBe(false);
    }

    // Shell blocks and command lines.
    expect(pm("```bash\n$ sudo FOO=1 env time pnpm install\n```\n")).toEqual(at(2, "pnpm"));
    expect(pm("```sh\n(cd a && yarn install)\n```\n")).toEqual(at(2, "yarn"));
    expect(pm("Run `npm test || bun run x`.\n")).toEqual(at(1, "npm", "bun"));
    for (const global of ["yarn global add jest", "npm i --global pnpm", "npm i --location=global pnpm"]) {
      expect(pm(`Run \`${global}\`.\n`), global).toEqual(NONE);
    }
    for (const [command, runner, manager] of [
      ["pnpm exec vitest", "vitest", "pnpm"],
      ["npx --yes jest", "jest", null],
      ["bunx vitest", "vitest", null],
      ["pnpm dlx -- jest", "jest", "pnpm"],
    ] as const) {
      const text = `Run \`${command}\`.\n`;
      expect(tr(text), command).toEqual(at(1, runner));
      expect(pm(text), command).toEqual(manager === null ? NONE : at(1, manager));
    }
    for (const command of ["npm test", "jest@29", "pnpm --filter web vitest"]) {
      expect(tr(`Run \`${command}\`.\n`), command).toEqual(NONE);
    }
    expect(decl("```sh\n# npm install\n```\n"), "a shell comment").toEqual({
      patternScoped: false,
      packageManagers: NONE,
      testRunners: NONE,
    });
    expect(pm("```console\nPS C:\\repo> npm ci\n```\n")).toEqual(at(2, "npm"));

    // Fences: four backticks are not closed by three.
    expect(pm("````md\n```\n`npm install`\n````\nRun `pnpm install`.\n")).toEqual(at(5, "pnpm"));
    // A python block and an indented code block declare nothing.
    expect(pm("```python\nnpm install\nx = '`npm install`'\n```\n")).toEqual(NONE);
    expect(pm("Text.\n\n    npm install\n    `npm install`\n")).toEqual(NONE);
    // A backtick run with no equal-length partner on its line is literal.
    expect(pm("Literal `` then `pnpm install`.\n")).toEqual(at(1, "pnpm"));
    expect(pm("Odd ``npm install` here.\n")).toEqual(NONE);
    // pytest declares nothing.
    expect(decl("Run `pytest`.\n")).toEqual({ patternScoped: false, packageManagers: NONE, testRunners: NONE });

    // Each class's line is the 1-based line of its first declaration.
    expect(decl("# T\n\nRun `npx jest`.\n\nThen `yarn install` and `pnpm install`.\n")).toEqual({
      patternScoped: false,
      packageManagers: at(5, "pnpm", "yarn"),
      testRunners: at(3, "jest"),
    });
  });
});
