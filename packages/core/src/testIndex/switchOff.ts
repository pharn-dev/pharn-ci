import ts from "typescript5";
import type { TestModifier } from "./types.js";

/** The option keys that switch a test off, and the modifier a literal `true` gives each. */
const OPTION_MODIFIERS: ReadonlyMap<string, TestModifier> = new Map([
  ["skip", "skip"],
  ["todo", "todo"],
  ["fails", "fails"],
]);

/** The text of a property name that is an identifier or a string literal, else null. */
function staticName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

/**
 * The modifiers the options object of a test call adds: an object literal in the second or third argument whose `skip`,
 * `todo` or `fails` key is a literal `true` adds that modifier; any other value but a literal `false` adds `skipIf` (a
 * conditional skip). Other keys (`timeout`, `retry`, …) and spreads add nothing.
 */
export function optionModifiers(args: readonly ts.Expression[]): TestModifier[] {
  const found: TestModifier[] = [];
  for (const arg of args.slice(1, 3)) {
    if (!ts.isObjectLiteralExpression(arg)) continue;
    for (const property of arg.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
      const key = staticName(property.name);
      const modifier = key === null ? undefined : OPTION_MODIFIERS.get(key);
      if (modifier === undefined) continue;
      const value = ts.isPropertyAssignment(property) ? property.initializer.kind : null;
      if (value === ts.SyntaxKind.TrueKeyword) found.push(modifier);
      else if (value !== ts.SyntaxKind.FalseKeyword) found.push("skipIf");
    }
  }
  return found;
}

/** Whether a table call (`.each(…)`, `.for(…)`) has an empty array literal as its first argument. */
export function isEmptyTable(call: ts.CallExpression): boolean {
  const first = call.arguments[0];
  return first !== undefined && ts.isArrayLiteralExpression(first) && first.elements.length === 0;
}

/**
 * The name a function that is not a test callback goes by in its file, when it can only run if something calls it by
 * that name: a function declaration or method with an identifier name, or a function literal assigned to one (a
 * variable, a property, a class field, an assignment). Null when the function is called where it stands (an argument of
 * a call, an immediately invoked function), has no such name, or is anything else (a constructor, an accessor, a
 * function returned or stored elsewhere): such a function is not read as a guard.
 */
export function guardName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name !== undefined && ts.isIdentifier(node.name) ? node.name.text : null;
  }
  if (!ts.isFunctionExpression(node) && !ts.isArrowFunction(node)) return null;
  let current: ts.Node = node;
  while (current.parent !== undefined && ts.isParenthesizedExpression(current.parent)) current = current.parent;
  const parent = current.parent;
  if (parent === undefined) return null;
  let name: ts.Node | undefined;
  if (ts.isVariableDeclaration(parent) && parent.initializer === current) name = parent.name;
  else if (ts.isPropertyAssignment(parent) && parent.initializer === current) name = parent.name;
  else if (ts.isPropertyDeclaration(parent) && parent.initializer === current) name = parent.name;
  else if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === current
  ) {
    name = ts.isPropertyAccessExpression(parent.left) ? parent.left.name : parent.left;
  }
  return name !== undefined && ts.isIdentifier(name) ? name.text : null;
}
