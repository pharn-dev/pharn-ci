import ts from "typescript5";
import { assertionChain, guardCall } from "./assertions.js";
import { blockCall } from "./blocks.js";
import { importSpecifier, MAX_TEST_IMPORTS } from "./imports.js";
import { mockCall } from "./mocks.js";
import { guardName } from "./switchOff.js";
import type { LiteralRange } from "./text.js";
import {
  MAX_TEST_INDEX_DEPTH,
  type TestAssertion,
  type TestAssertionGuard,
  type TestBlockKind,
  type TestGuard,
  type TestModifier,
  type TestModuleMock,
} from "./types.js";

/** A block as the walk finds it. The text-dependent fields (body, hash) are filled in after the walk. */
export interface BlockDraft {
  kind: TestBlockKind;
  name: string;
  nameDynamic: boolean;
  path: string[];
  line: number;
  endLine: number;
  modifiers: TestModifier[];
  /** The first parameter of the callback when it is a plain identifier: the name a subtest is called on. */
  param: string | null;
  /** The callback body's source range, or -1 when the block has no function-literal callback. */
  bodyStart: number;
  bodyEnd: number;
  assertions: TestAssertion[];
  guards: TestAssertionGuard[];
  /** What sits between the block and its owner, worked out once the whole file is walked; `null` for nothing. */
  guarded: TestGuard | null;
  emptyTable: boolean;
}

/** A named function passed between a node and its owner, innermost first; the tail is shared with the outer nodes. */
interface FunctionLink {
  name: string;
  up: FunctionLink | null;
  /** Whether this function or one outside it is named nowhere else in the file; filled in after the walk. */
  uncalled?: boolean;
}

/** The `if` statements and named functions passed between a node and its owner (see `TestBlock.guarded`). */
interface GuardTrail {
  inIf: boolean;
  functions: FunctionLink | null;
}

export interface WalkResult {
  drafts: BlockDraft[];
  mocks: TestModuleMock[];
  ranges: LiteralRange[];
  /** The distinct module specifiers the file loads at run time (see `importSpecifier`), in source order, at most 1000. */
  imports: string[];
}

/** The `return` statements seen so far in one function: the smallest end offset. */
interface FunctionFrame {
  firstReturnEnd: number;
}

interface Entry {
  node: ts.Node;
  depth: number;
  /** The innermost block whose callback holds the node. */
  owner: BlockDraft | null;
  fn: FunctionFrame | null;
  inTry: boolean;
  /** The node is the callback of the block its parent call opens. */
  isCallback: boolean;
  trail: GuardTrail | null;
}

/** The trail a function or `if` adds to; a block's callback starts a new one. */
function extend(trail: GuardTrail | null, inIf: boolean, name: string | null): GuardTrail {
  const up = trail?.functions ?? null;
  return { inIf: inIf || trail?.inIf === true, functions: name === null ? up : { name, up } };
}

/** Whether any function of the chain is named only once in the file (by its own declaration). Each link is judged once. */
function anyUncalled(link: FunctionLink, counts: ReadonlyMap<string, number>): boolean {
  const pending: FunctionLink[] = [];
  let at: FunctionLink | null = link;
  while (at !== null && at.uncalled === undefined) {
    pending.push(at);
    at = at.up;
  }
  let outer = at?.uncalled ?? false;
  for (let i = pending.length - 1; i >= 0; i--) {
    const current = pending[i] as FunctionLink;
    outer = outer || (counts.get(current.name) ?? 0) <= 1;
    current.uncalled = outer;
  }
  return link.uncalled as boolean;
}

/** Whether a chain node is the top of its chain: its parent neither reads a property of it nor calls it. */
function isChainTop(node: ts.Node): boolean {
  const parent = node.parent;
  if (parent === undefined) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return false;
  if (ts.isCallExpression(parent) && parent.expression === node) return false;
  return true;
}

/**
 * Walks the tree without recursion, in pre-order and source order, collecting blocks, their assertions and guards,
 * module mocks, the module specifiers the file loads, and the literal ranges the body normalizer needs. Returns `"too-deep"` as soon as a node is deeper
 * than the cap.
 */
export function walkTestFile(sourceFile: ts.SourceFile): WalkResult | "too-deep" {
  const drafts: BlockDraft[] = [];
  const mocks: TestModuleMock[] = [];
  const ranges: LiteralRange[] = [];
  const imports = new Set<string>();
  const lineOf = (position: number): number => sourceFile.getLineAndCharacterOfPosition(position).line + 1;

  const stack: Entry[] = [
    { node: sourceFile, depth: 0, owner: null, fn: null, inTry: false, isCallback: false, trail: null },
  ];
  const children: ts.Node[] = [];
  /** How often each identifier appears in the file: a function named only once (its own name) is called by no one. */
  const identifierCounts = new Map<string, number>();
  const trails = new Map<BlockDraft, GuardTrail>();

  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    const { node, depth, owner } = entry;
    if (depth > MAX_TEST_INDEX_DEPTH) return "too-deep";
    let fn = entry.fn;
    let callback: ts.Node | null = null;
    let created: BlockDraft | null = null;
    let tryBlock: ts.Node | null = null;

    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        ranges.push({ start: node.getStart(sourceFile), end: node.end, kind: "verbatim" });
        break;
      case ts.SyntaxKind.RegularExpressionLiteral:
        ranges.push({ start: node.getStart(sourceFile), end: node.end, kind: "shielded" });
        break;
      case ts.SyntaxKind.JsxText:
        ranges.push({ start: node.pos, end: node.end, kind: "shielded" });
        break;
      case ts.SyntaxKind.ReturnStatement:
        if (fn !== null) fn.firstReturnEnd = Math.min(fn.firstReturnEnd, node.end);
        break;
      case ts.SyntaxKind.TryStatement:
        if ((node as ts.TryStatement).catchClause !== undefined) tryBlock = (node as ts.TryStatement).tryBlock;
        break;
      default:
        break;
    }
    if (ts.isFunctionLike(node)) fn = { firstReturnEnd: Number.POSITIVE_INFINITY };
    if (ts.isIdentifier(node)) identifierCounts.set(node.text, (identifierCounts.get(node.text) ?? 0) + 1);
    let trail = entry.trail;
    if (!entry.isCallback && ts.isFunctionLike(node)) {
      const name = guardName(node);
      if (name !== null) trail = extend(trail, false, name);
    }
    const ifStatement = ts.isIfStatement(node) ? node : null;
    if (imports.size < MAX_TEST_IMPORTS) {
      const specifier = importSpecifier(node);
      if (specifier !== null) imports.add(specifier);
    }

    if (ts.isCallExpression(node)) {
      const parent = node.parent;
      const calleeOfCall = parent !== undefined && ts.isCallExpression(parent) && parent.expression === node;
      const found = calleeOfCall ? null : blockCall(node, sourceFile, owner?.kind === "test" ? owner.param : null);
      if (found !== null) {
        const callbackFunction = found.callback;
        const first = callbackFunction?.parameters[0]?.name;
        let bodyStart = -1;
        let bodyEnd = -1;
        if (callbackFunction !== null) {
          const body = callbackFunction.body;
          if (ts.isBlock(body)) {
            bodyStart = body.getStart(sourceFile) + 1;
            bodyEnd = Math.max(bodyStart, body.end - 1);
          } else {
            bodyStart = body.getStart(sourceFile);
            bodyEnd = body.end;
          }
        }
        created = {
          kind: found.kind,
          name: found.name,
          nameDynamic: found.nameDynamic,
          path: [...(owner?.path ?? []), found.name],
          line: lineOf(node.getStart(sourceFile)),
          endLine: lineOf(node.end),
          modifiers: found.modifiers,
          param: first !== undefined && ts.isIdentifier(first) ? first.text : null,
          bodyStart,
          bodyEnd,
          assertions: [],
          guards: [],
          guarded: null,
          emptyTable: found.emptyTable,
        };
        drafts.push(created);
        if (trail !== null) trails.set(created, trail);
        callback = callbackFunction;
      } else {
        const guard = owner === null ? null : guardCall(node);
        if (owner !== null && guard !== null) {
          owner.guards.push({ kind: guard.kind, count: guard.count, line: lineOf(node.getStart(sourceFile)) });
        }
      }
      const mock = mockCall(node);
      if (mock !== null) mocks.push({ ...mock, line: lineOf(node.getStart(sourceFile)) });
    }

    if (
      owner !== null &&
      (node.kind === ts.SyntaxKind.PropertyAccessExpression || node.kind === ts.SyntaxKind.CallExpression) &&
      isChainTop(node)
    ) {
      const chain = assertionChain(node);
      if (chain !== null) {
        const start = node.getStart(sourceFile);
        owner.assertions.push({
          chain,
          line: lineOf(start),
          awaited: node.parent?.kind === ts.SyntaxKind.AwaitExpression,
          inTryCatch: entry.inTry,
          afterEarlyReturn: fn !== null && fn.firstReturnEnd <= start,
        });
      }
    }

    children.length = 0;
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i] as ts.Node;
      const isCallback = child === callback;
      stack.push({
        node: child,
        depth: depth + 1,
        owner: isCallback ? created : owner,
        fn,
        inTry: isCallback ? false : child === tryBlock ? true : entry.inTry,
        isCallback,
        trail: isCallback
          ? null
          : ifStatement !== null && child !== ifStatement.expression
            ? extend(trail, true, null)
            : trail,
      });
    }
  }
  for (const [draft, trail] of trails) {
    if (trail.inIf) draft.guarded = "if";
    else if (trail.functions !== null && anyUncalled(trail.functions, identifierCounts)) {
      draft.guarded = "uncalled-function";
    }
  }
  return { drafts, mocks, ranges, imports: [...imports] };
}
