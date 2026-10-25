import ts from "typescript5";
import { parseTestFile } from "../testIndex/parse.js";
import { scriptKindOf } from "../testIndex/scriptKind.js";
import { MAX_TEST_INDEX_DEPTH } from "../testIndex/types.js";
import {
  type ConfigEntry,
  type ConfigValue,
  MAX_CONFIG_CHARS,
  MAX_CONFIG_IDENT_HOPS,
  MAX_CONFIG_VALUE_DEPTH,
  normalizeOpaque,
  type ReadResult,
} from "./value.js";

type ObjectValue = Extract<ConfigValue, { type: "object" }>;

const WRAPPERS_STEP_LIMIT = 64;
const DEFINE_CALLS: ReadonlySet<string> = new Set(["defineConfig", "defineProject", "defineWorkspace"]);

/** Whether the syntax tree is deeper than the bound, found with an explicit stack so no recursion can overflow. */
function tooDeep(sourceFile: ts.SourceFile): boolean {
  const stack: Array<{ node: ts.Node; depth: number }> = [{ node: sourceFile, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: ts.Node; depth: number };
    if (depth > MAX_TEST_INDEX_DEPTH) return true;
    ts.forEachChild(node, (child) => {
      stack.push({ node: child, depth: depth + 1 });
    });
  }
  return false;
}

/** The expression without parentheses, `as`, `satisfies`, `!` and type assertions. */
function strip(node: ts.Node): ts.Node {
  let current = node;
  for (let step = 0; step < WRAPPERS_STEP_LIMIT; step++) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
    } else {
      break;
    }
  }
  return current;
}

/** The key a property name gives, or null for a computed or private name. */
function propertyKey(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  return null;
}

/** An object that is `a` with the keys of `b` laid over it, nested objects merged the same way; always open. */
function mergeObjects(a: ObjectValue, b: ObjectValue): ObjectValue {
  const entries = new Map(a.entries);
  for (const [key, entry] of b.entries) {
    const existing = entries.get(key);
    if (existing !== undefined && existing.value.type === "object" && entry.value.type === "object") {
      entries.set(key, { value: mergeObjects(existing.value, entry.value), line: entry.line });
    } else {
      entries.set(key, entry);
    }
  }
  return { type: "object", entries, open: true, extras: [...a.extras, ...b.extras] };
}

class JsConfigReader {
  private readonly consts = new Map<string, ts.Node>();

  constructor(private readonly sourceFile: ts.SourceFile) {
    for (const statement of sourceFile.statements) {
      if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
            this.consts.set(declaration.name.text, declaration.initializer);
          }
        }
      }
    }
  }

  private line(node: ts.Node): number {
    return this.sourceFile.getLineAndCharacterOfPosition(node.getStart(this.sourceFile)).line + 1;
  }

  private opaque(node: ts.Node): ConfigValue {
    return { type: "opaque", text: normalizeOpaque(node.getText(this.sourceFile)) };
  }

  private identifier(node: ts.Identifier, depth: number, hops: number): ConfigValue {
    const init = this.consts.get(node.text);
    if (init === undefined || hops >= MAX_CONFIG_IDENT_HOPS) return this.opaque(node);
    return this.value(init, depth, hops + 1);
  }

  /** A value: a literal as itself, a top-level `const` name as what it holds, anything else opaque. */
  private value(expression: ts.Node, depth: number, hops: number): ConfigValue {
    const node = strip(expression);
    if (depth > MAX_CONFIG_VALUE_DEPTH) return this.opaque(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return { type: "string", value: node.text };
    if (ts.isNumericLiteral(node)) return { type: "number", value: Number(node.text) };
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(strip(node.operand))
    ) {
      return { type: "number", value: -Number((strip(node.operand) as ts.NumericLiteral).text) };
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return { type: "boolean", value: true };
    if (node.kind === ts.SyntaxKind.FalseKeyword) return { type: "boolean", value: false };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { type: "null" };
    if (ts.isArrayLiteralExpression(node)) {
      const items: ConfigValue[] = node.elements.map((element) =>
        ts.isSpreadElement(element) || ts.isOmittedExpression(element)
          ? this.opaque(element)
          : this.value(element, depth + 1, hops),
      );
      return { type: "array", items };
    }
    if (ts.isObjectLiteralExpression(node)) return this.object(node, depth, hops);
    if (ts.isIdentifier(node)) return this.identifier(node, depth, hops);
    return this.opaque(node);
  }

  private object(node: ts.ObjectLiteralExpression, depth: number, hops: number): ConfigValue {
    const entries = new Map<string, ConfigEntry>();
    const extras: string[] = [];
    let open = false;
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const key = propertyKey(property.name);
        if (key === null) {
          open = true;
          extras.push(normalizeOpaque(property.getText(this.sourceFile)));
        } else {
          entries.set(key, {
            value: this.value(property.initializer, depth + 1, hops),
            line: this.line(property.name),
          });
        }
      } else if (ts.isShorthandPropertyAssignment(property)) {
        open = true;
        entries.set(property.name.text, {
          value: this.identifier(property.name, depth + 1, hops),
          line: this.line(property.name),
        });
      } else {
        open = true;
        extras.push(normalizeOpaque(property.getText(this.sourceFile)));
      }
    }
    return { type: "object", entries, open, extras };
  }

  /** The single top-level `return` expression of a block body, or null. */
  private returned(body: ts.Block): ts.Node | null {
    const returns = body.statements.filter(ts.isReturnStatement);
    const only = returns.length === 1 ? returns[0] : undefined;
    return only?.expression ?? null;
  }

  /** The value the config expression unwraps to. */
  private resolve(expression: ts.Node, depth: number): ConfigValue {
    let node = expression;
    let hops = 0;
    if (depth > MAX_CONFIG_VALUE_DEPTH) return this.opaque(node);
    for (let step = 0; step < WRAPPERS_STEP_LIMIT; step++) {
      node = strip(node);
      if (ts.isIdentifier(node)) {
        const init = this.consts.get(node.text);
        if (init === undefined || hops >= MAX_CONFIG_IDENT_HOPS) return this.opaque(node);
        node = init;
        hops++;
        continue;
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : null;
        if (name !== null && DEFINE_CALLS.has(name)) {
          const first = node.arguments[0];
          if (first === undefined) return this.opaque(node);
          node = first;
          continue;
        }
        if (name === "mergeConfig") return this.merge(node, depth + 1);
        return this.opaque(node);
      }
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
        const body = node.body;
        if (body === undefined) return this.opaque(node);
        if (ts.isBlock(body)) {
          const returned = this.returned(body);
          if (returned === null) return this.opaque(node);
          node = returned;
        } else {
          node = body;
        }
        continue;
      }
      return this.value(node, 0, hops);
    }
    return this.opaque(node);
  }

  /** `mergeConfig(a, b, …)`: the arguments that unwrap to objects, later keys winning, as one open object. */
  private merge(call: ts.CallExpression, depth: number): ConfigValue {
    let merged: ObjectValue | null = null;
    for (const argument of call.arguments) {
      const value = this.resolve(argument, depth);
      if (value.type !== "object") continue;
      merged = merged === null ? { ...value, open: true } : mergeObjects(merged, value);
    }
    return merged ?? this.opaque(call);
  }

  /** The config value of the file: the first default export, else the last CommonJS export assignment. */
  root(): ConfigValue {
    for (const statement of this.sourceFile.statements) {
      if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) {
        return this.resolve(statement.expression, 0);
      }
      if (ts.isFunctionDeclaration(statement)) {
        const kinds = statement.modifiers?.map((modifier) => modifier.kind) ?? [];
        if (kinds.includes(ts.SyntaxKind.ExportKeyword) && kinds.includes(ts.SyntaxKind.DefaultKeyword)) {
          return this.resolve(statement, 0);
        }
      }
    }
    let assigned: ts.Node | null = null;
    for (const statement of this.sourceFile.statements) {
      if (!ts.isExpressionStatement(statement)) continue;
      const expression = statement.expression;
      if (
        ts.isBinaryExpression(expression) &&
        expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(expression.left) &&
        ts.isIdentifier(expression.left.expression) &&
        expression.left.expression.text === "module" &&
        expression.left.name.text === "exports"
      ) {
        assigned = expression.right;
      }
    }
    return assigned === null ? { type: "opaque", text: "" } : this.resolve(assigned, 0);
  }
}

/**
 * Reads a JS or TS test-runner config: the config object behind the first default export or the last CommonJS export
 * assignment. Syntax only; nothing is evaluated, imported or resolved outside the file. Refuses a text that is too
 * large, has a syntax error or is nested too deep.
 */
export function readJs(path: string, text: string): ReadResult {
  if (text.length > MAX_CONFIG_CHARS) return { ok: false, reason: "too-large" };
  try {
    const { sourceFile, syntaxErrors } = parseTestFile(scriptKindOf(path), text);
    if (syntaxErrors > 0) return { ok: false, reason: "syntax-error" };
    if (tooDeep(sourceFile)) return { ok: false, reason: "too-deep" };
    return { ok: true, root: new JsConfigReader(sourceFile).root() };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, reason: "too-deep" };
    return { ok: false, reason: "syntax-error" };
  }
}
