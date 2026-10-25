import ts from "typescript5";
import { assertionChain, guardCall } from "./assertions.js";
import { blockCall } from "./blocks.js";
import { mockCall } from "./mocks.js";
import type { LiteralRange } from "./text.js";
import {
  MAX_TEST_INDEX_DEPTH,
  type TestAssertion,
  type TestAssertionGuard,
  type TestBlockKind,
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
}

export interface WalkResult {
  drafts: BlockDraft[];
  mocks: TestModuleMock[];
  ranges: LiteralRange[];
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
 * module mocks, and the literal ranges the body normalizer needs. Returns `"too-deep"` as soon as a node is deeper
 * than the cap.
 */
export function walkTestFile(sourceFile: ts.SourceFile): WalkResult | "too-deep" {
  const drafts: BlockDraft[] = [];
  const mocks: TestModuleMock[] = [];
  const ranges: LiteralRange[] = [];
  const lineOf = (position: number): number => sourceFile.getLineAndCharacterOfPosition(position).line + 1;

  const stack: Entry[] = [{ node: sourceFile, depth: 0, owner: null, fn: null, inTry: false }];
  const children: ts.Node[] = [];

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
        };
        drafts.push(created);
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
      });
    }
  }
  return { drafts, mocks, ranges };
}
