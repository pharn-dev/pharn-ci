import { fnv1a32Hex } from "./hash.js";
import { parseTestFile } from "./parse.js";
import { scriptKindOf } from "./scriptKind.js";
import { bodySlice, normalizeFile } from "./text.js";
import {
  MAX_TEST_BODY_CHARS,
  MAX_TEST_INDEX_CHARS,
  MAX_TEST_INDEX_SYNTAX_ERRORS,
  type TestBlock,
  type TestIndexRefusalReason,
  type TestIndexResult,
} from "./types.js";
import { type BlockDraft, type WalkResult, walkTestFile } from "./walk.js";

function refuse(reason: TestIndexRefusalReason): TestIndexResult {
  return { parsed: false, reason };
}

/** The parser ran out of stack: a deeply nested file, not a bug. */
function isStackOverflow(error: unknown): boolean {
  return error instanceof RangeError && /call stack/i.test(error.message);
}

/** Turns the walk's drafts into blocks, normalizing the whole file once for the bodies. */
function buildBlocks(text: string, walked: WalkResult): TestBlock[] {
  const needsBodies = walked.drafts.some((d: BlockDraft) => d.bodyStart >= 0);
  const normal = needsBodies ? normalizeFile(text, walked.ranges) : null;
  return walked.drafts.map((d) => {
    const body =
      normal !== null && d.bodyStart >= 0 ? bodySlice(normal.normalized, normal.map, d.bodyStart, d.bodyEnd) : "";
    return {
      kind: d.kind,
      name: d.name,
      nameDynamic: d.nameDynamic,
      path: d.path,
      line: d.line,
      endLine: d.endLine,
      modifiers: d.modifiers,
      body: body.length > MAX_TEST_BODY_CHARS ? body.slice(0, MAX_TEST_BODY_CHARS) : body,
      bodyHash: fnv1a32Hex(body),
      assertionCount: d.assertions.length,
      assertions: d.assertions,
      guards: d.guards,
    };
  });
}

/**
 * Indexes a JS or TS test file: its describe, test and hook blocks with names, modifiers, bodies and assertion
 * chains, and its module mocks. Syntax only: the text is parsed with TypeScript's `createSourceFile` and nothing is
 * evaluated, resolved or type-checked. A file that cannot be indexed because of its content (not a string, too large,
 * too deep, too many syntax errors, or one the parser threw on) comes back as `{ parsed: false, reason }`. It throws
 * only when pharn-ci's own code fails, so a bug of ours is never reported as a refusal of the file.
 */
export function indexTestFile(path: string, text: string): TestIndexResult {
  return indexTestFileWithImports(path, text).result;
}

/**
 * `indexTestFile`, plus the distinct module specifiers the file loads at run time when it was indexed (see
 * `importSpecifier`: static and dynamic imports, `export … from` and `require` of a string literal, never a type-only
 * import or a mock path), in source order and at most 1000; empty when it was refused. One parse gives both.
 */
export function indexTestFileWithImports(path: string, text: string): { result: TestIndexResult; imports: string[] } {
  if (typeof path !== "string" || typeof text !== "string") return { result: refuse("parser-threw"), imports: [] };
  if (text.length > MAX_TEST_INDEX_CHARS) return { result: refuse("too-large"), imports: [] };
  const parsed = parseTestFile(scriptKindOf(path), text);
  if (!parsed.ok) return { result: refuse(isStackOverflow(parsed.threw) ? "too-deep" : "parser-threw"), imports: [] };
  const { sourceFile, syntaxErrors } = parsed;
  if (syntaxErrors > MAX_TEST_INDEX_SYNTAX_ERRORS) return { result: refuse("syntax-error-heavy"), imports: [] };
  const walked = walkTestFile(sourceFile);
  if (walked === "too-deep") return { result: refuse("too-deep"), imports: [] };
  return {
    result: { parsed: true, syntaxErrors, tests: buildBlocks(text, walked), mocks: walked.mocks },
    imports: walked.imports,
  };
}
