import ts from "typescript5";
import type { TestModuleMock } from "./types.js";

const OBJECTS = new Set(["vi", "jest"]);
const METHODS = new Set(["mock", "doMock"]);

function stringValue(node: ts.Node | undefined): string | null {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;
}

/**
 * `vi.mock`, `vi.doMock`, `jest.mock` or `jest.doMock`, with the module specifier when it is a string literal or
 * a dynamic import of one. Anything else is not a mock.
 */
export function mockCall(call: ts.CallExpression): Pick<TestModuleMock, "callee" | "specifier"> | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return null;
  const object = callee.expression.text;
  const method = callee.name.text;
  if (!OBJECTS.has(object) || !METHODS.has(method)) return null;
  const argument = call.arguments[0];
  let specifier = stringValue(argument);
  if (
    specifier === null &&
    argument !== undefined &&
    ts.isCallExpression(argument) &&
    argument.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    specifier = stringValue(argument.arguments[0]);
  }
  return { callee: `${object}.${method}` as TestModuleMock["callee"], specifier };
}
