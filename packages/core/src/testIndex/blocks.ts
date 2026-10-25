import ts from "typescript5";
import { collapseWhitespace, cutName } from "./text.js";
import type { TestBlockKind, TestModifier } from "./types.js";

/** Words that open a test. `x…` skips it and `f…` focuses it. */
const TEST_WORDS: ReadonlyMap<string, TestModifier | null> = new Map([
  ["it", null],
  ["test", null],
  ["xit", "skip"],
  ["xtest", "skip"],
  ["fit", "only"],
]);

/** Words that open a group. */
const DESCRIBE_WORDS: ReadonlyMap<string, TestModifier | null> = new Map([
  ["describe", null],
  ["suite", null],
  ["xdescribe", "skip"],
  ["fdescribe", "only"],
]);

/** Words that open a setup or teardown hook. A hook's name is its word. */
export const HOOK_WORDS: ReadonlySet<string> = new Set([
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
  "before",
  "after",
]);

/** The property names that may follow a block word, and what each adds (`null` adds nothing). */
export const MEMBER_MODIFIERS: ReadonlyMap<string, TestModifier | null> = new Map([
  ["skip", "skip"],
  ["only", "only"],
  ["todo", "todo"],
  ["fails", "fails"],
  ["concurrent", "concurrent"],
  ["each", "each"],
  ["skipIf", "skipIf"],
  ["runIf", "runIf"],
  ["for", "each"],
  ["fixme", "skip"],
  ["fail", "fails"],
  ["serial", null],
  ["parallel", null],
  ["sequential", null],
  ["shuffle", null],
]);

/** The members after which the callee may be called or tagged with a template: `it.each(table)(…)`. */
const CALLABLE_MEMBERS: ReadonlySet<string> = new Set(["each", "for", "skipIf", "runIf"]);
/** The members after which the callee may be tagged with a template: ``it.each`table`(…)``. */
const TAGGABLE_MEMBERS: ReadonlySet<string> = new Set(["each", "for"]);

/** The order modifiers are listed in. */
const MODIFIER_ORDER: readonly TestModifier[] = [
  "skip",
  "only",
  "todo",
  "fails",
  "concurrent",
  "each",
  "skipIf",
  "runIf",
];

type Link = { type: "prop"; name: string } | { type: "call" } | { type: "template" };

export interface BlockCall {
  kind: TestBlockKind;
  name: string;
  nameDynamic: boolean;
  modifiers: TestModifier[];
  /** The first argument that is a function literal, or `null`. */
  callback: ts.ArrowFunction | ts.FunctionExpression | null;
}

/** The callee as its root identifier and the links after it, or `null` when it is any other shape. */
function decompose(callee: ts.Expression): { root: string; links: Link[] } | null {
  const links: Link[] = [];
  let current: ts.Expression = callee;
  for (;;) {
    if (ts.isPropertyAccessExpression(current)) {
      links.push({ type: "prop", name: current.name.text });
      current = current.expression;
    } else if (ts.isCallExpression(current)) {
      links.push({ type: "call" });
      current = current.expression;
    } else if (ts.isTaggedTemplateExpression(current)) {
      links.push({ type: "template" });
      current = current.tag;
    } else {
      break;
    }
  }
  if (!ts.isIdentifier(current)) return null;
  return { root: current.text, links: links.reverse() };
}

function isFunctionLiteral(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/** The name of a block from its first argument. */
function nameFromArgument(
  argument: ts.Expression,
  each: boolean,
  sourceFile: ts.SourceFile,
): { name: string; nameDynamic: boolean } {
  const source = argument.getText(sourceFile);
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    if (!each) return { name: cutName(argument.text), nameDynamic: false };
    return { name: cutName(collapseWhitespace(source.slice(1, -1))), nameDynamic: true };
  }
  if (ts.isTemplateExpression(argument)) {
    return { name: cutName(collapseWhitespace(source.slice(1, -1))), nameDynamic: true };
  }
  return { name: cutName(collapseWhitespace(source)), nameDynamic: true };
}

/** Whether the arguments make a call a block: a function literal anywhere, or a string-like first argument. */
function hasBlockArguments(args: readonly ts.Expression[]): boolean {
  if (args.some(isFunctionLiteral)) return true;
  const first = args[0];
  return (
    first !== undefined &&
    (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) || ts.isTemplateExpression(first))
  );
}

function finish(
  kind: TestBlockKind,
  hookWord: string | null,
  modifiers: ReadonlySet<TestModifier>,
  args: readonly ts.Expression[],
  sourceFile: ts.SourceFile,
): BlockCall | null {
  if (!hasBlockArguments(args)) return null;
  const callback = args.find(isFunctionLiteral) ?? null;
  const ordered = MODIFIER_ORDER.filter((m) => modifiers.has(m));
  if (hookWord !== null) return { kind, name: hookWord, nameDynamic: false, modifiers: ordered, callback };
  const first = args[0] as ts.Expression;
  const { name, nameDynamic } = nameFromArgument(first, modifiers.has("each"), sourceFile);
  return { kind, name, nameDynamic, modifiers: ordered, callback };
}

/**
 * Whether a call opens a test block, and which. `subtestParam` is the first parameter of the innermost enclosing
 * test's callback: `<param>.test(…)` is then a subtest. A call that is itself the callee of another call is the
 * caller's business, not a block.
 */
export function blockCall(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  subtestParam: string | null,
): BlockCall | null {
  const callee = call.expression;
  if (
    subtestParam !== null &&
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "test" &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === subtestParam
  ) {
    return finish("test", null, new Set(), call.arguments, sourceFile);
  }

  const parts = decompose(callee);
  if (parts === null) return null;
  const { root, links } = parts;
  const modifiers = new Set<TestModifier>();

  let kind: TestBlockKind;
  let hookWord: string | null = null;
  const testWord = TEST_WORDS.get(root);
  const describeWord = DESCRIBE_WORDS.get(root);
  if (testWord !== undefined) {
    kind = "test";
    if (testWord !== null) modifiers.add(testWord);
  } else if (describeWord !== undefined) {
    kind = "describe";
    if (describeWord !== null) modifiers.add(describeWord);
  } else if (HOOK_WORDS.has(root)) {
    kind = "hook";
    hookWord = root;
  } else {
    return null;
  }

  let from = 0;
  const first = links[0];
  if (root === "test" && first !== undefined && first.type === "prop") {
    if (first.name === "describe") {
      kind = "describe";
      from = 1;
    } else if (HOOK_WORDS.has(first.name)) {
      kind = "hook";
      hookWord = first.name;
      from = 1;
    }
  }

  if (kind === "hook") {
    if (links.length > from) return null;
    return finish(kind, hookWord, modifiers, call.arguments, sourceFile);
  }

  let previous: string | null = null;
  for (let i = from; i < links.length; i++) {
    const link = links[i] as Link;
    if (link.type === "prop") {
      if (!MEMBER_MODIFIERS.has(link.name)) return null;
      const added = MEMBER_MODIFIERS.get(link.name);
      if (added !== undefined && added !== null) modifiers.add(added);
      previous = link.name;
    } else if (link.type === "call") {
      if (previous === null || !CALLABLE_MEMBERS.has(previous)) return null;
      previous = null;
    } else {
      if (previous === null || !TAGGABLE_MEMBERS.has(previous)) return null;
      previous = null;
    }
  }
  return finish(kind, null, modifiers, call.arguments, sourceFile);
}
