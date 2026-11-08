import ts from "typescript5";
import { mockCall } from "./mocks.js";

/** The most distinct module specifiers kept for one test file; the rest are not recorded. */
export const MAX_TEST_IMPORTS = 1000;

function literal(node: ts.Node | undefined): string | null {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;
}

/** An import clause that only brings in types: `import type …`, or named bindings that are all `type`, with no default. */
function typeOnlyClause(clause: ts.ImportClause | undefined): boolean {
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name !== undefined) return false;
  const bindings = clause.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

/**
 * The module specifier a node loads at run time, when it is a string literal: an `import` declaration (a side-effect
 * import included) or an `export … from` declaration that is not type-only, an import-equals declaration of an
 * external module, a call of the identifier `require` with one string literal, or a dynamic import of a string literal
 * that is not the first argument of a `vi.mock`, `vi.doMock`, `jest.mock` or `jest.doMock` call (a mock path does not
 * count). Anything else gives null. Syntax only: nothing is resolved here.
 */
export function importSpecifier(node: ts.Node): string | null {
  switch (node.kind) {
    case ts.SyntaxKind.ImportDeclaration: {
      const declaration = node as ts.ImportDeclaration;
      return typeOnlyClause(declaration.importClause) ? null : literal(declaration.moduleSpecifier);
    }
    case ts.SyntaxKind.ExportDeclaration: {
      const declaration = node as ts.ExportDeclaration;
      return declaration.isTypeOnly ? null : literal(declaration.moduleSpecifier);
    }
    case ts.SyntaxKind.ImportEqualsDeclaration: {
      const declaration = node as ts.ImportEqualsDeclaration;
      const reference = declaration.moduleReference;
      return declaration.isTypeOnly || !ts.isExternalModuleReference(reference) ? null : literal(reference.expression);
    }
    case ts.SyntaxKind.CallExpression: {
      const call = node as ts.CallExpression;
      const callee = call.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const parent = call.parent;
        if (parent !== undefined && ts.isCallExpression(parent) && parent.arguments[0] === call && mockCall(parent)) {
          return null;
        }
        return literal(call.arguments[0]);
      }
      if (ts.isIdentifier(callee) && callee.text === "require" && call.arguments.length === 1) {
        return literal(call.arguments[0]);
      }
      return null;
    }
    default:
      return null;
  }
}
