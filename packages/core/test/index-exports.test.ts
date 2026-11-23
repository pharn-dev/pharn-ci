import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript5";
import { describe, expect, it } from "vitest";

// CORE-141: core's entry point is the product's interface to core, nothing more. Every name packages/core/src/index.ts
// exports is imported from "@pharn-ci/core" by the CLI, the Action, node-io or scripts/; a test imports anything else
// from the module that defines it. Parsed with the same TypeScript 5 parser core uses, so formatting cannot fool it.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ENTRY = "@pharn-ci/core";
const PRODUCT = ["packages/cli/src", "packages/action/src", "packages/node-io/src", "scripts"];
const TESTS = ["packages/core/test", "packages/cli/test", "packages/action/test", "packages/node-io/test"];

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(?:ts|mts|js|mjs)$/.test(e.name) && !e.parentPath.includes("node_modules"))
    .map((e) => join(e.parentPath, e.name));
}

function parse(path: string, text = readFileSync(path, "utf8")): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
}

/** The names a file imports (or re-exports) from the package entry by name, statically. */
function namesFromEntry(path: string): string[] {
  const text = readFileSync(path, "utf8");
  // Only a file that names the entry can import from it; parsing the rest would cost seconds under coverage.
  if (!text.includes(ENTRY)) return [];
  const names: string[] = [];
  for (const statement of parse(path, text).statements) {
    const isImport = ts.isImportDeclaration(statement);
    if (!isImport && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier) || specifier.text !== ENTRY) continue;
    const bindings = isImport ? statement.importClause?.namedBindings : statement.exportClause;
    if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
      for (const element of bindings.elements) names.push((element.propertyName ?? element.name).text);
    } else {
      names.push(`<${relative(ROOT, path)}: a namespace or default import>`);
    }
  }
  return names;
}

const indexExports = parse(join(ROOT, "packages/core/src/index.ts"))
  .statements.filter(ts.isExportDeclaration)
  .flatMap((statement) =>
    statement.exportClause && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.map((element) => element.name.text)
      : ["<a star export>"],
  );

// Reading every source and test file under four trees can take seconds on a loaded host or under coverage.
describe("packages/core/src/index.ts exports what the product imports", { timeout: 60_000 }, () => {
  it("every export of the index is imported from @pharn-ci/core by the CLI, the Action, node-io or scripts/", () => {
    const imported = new Set(PRODUCT.flatMap((dir) => sourceFiles(dir).flatMap(namesFromEntry)));
    expect(indexExports.length).toBeGreaterThan(0);
    expect(indexExports.filter((name) => !imported.has(name))).toEqual([]);
  });

  it("no test imports from @pharn-ci/core by name a name the index does not export", () => {
    const exported = new Set(indexExports);
    const strays = TESTS.flatMap((dir) =>
      sourceFiles(dir).flatMap((path) =>
        namesFromEntry(path)
          .filter((name) => !exported.has(name))
          .map((name) => `${relative(ROOT, path)}: ${name}`),
      ),
    );
    expect(strays).toEqual([]);
  });
});
