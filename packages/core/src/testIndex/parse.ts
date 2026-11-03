import ts from "typescript5";
import type { TestScriptKind } from "./scriptKind.js";

const FILE_NAME: Record<TestScriptKind, string> = {
  ts: "index.ts",
  tsx: "index.tsx",
  js: "index.js",
  jsx: "index.jsx",
};

/**
 * The parser's script kind for ours. A function, not a module-level table: reading `ts.ScriptKind` at module
 * evaluation would load TypeScript as soon as this module is imported, and the Action's bundle loads it lazily, on the
 * first parse of a test file or test config (packages/action/src/vendored-typescript.ts).
 */
function tsScriptKind(kind: TestScriptKind): ts.ScriptKind {
  switch (kind) {
    case "ts":
      return ts.ScriptKind.TS;
    case "tsx":
      return ts.ScriptKind.TSX;
    case "js":
      return ts.ScriptKind.JS;
    case "jsx":
      return ts.ScriptKind.JSX;
  }
}

/** `parseDiagnostics` is internal to TypeScript and absent from its .d.ts; this is the one place that reads it. */
function parseDiagnosticCount(sourceFile: ts.SourceFile): number {
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: unknown }).parseDiagnostics;
  if (!Array.isArray(diagnostics)) throw new Error("TypeScript no longer exposes parseDiagnostics");
  return diagnostics.length;
}

/** What `parseTestFile` gives back: the parse, or the value TypeScript's parser threw (a stack overflow, say). */
export type ParsedTestFile =
  | { ok: true; sourceFile: ts.SourceFile; syntaxErrors: number }
  | { ok: false; threw: unknown };

/**
 * The one parse of the test index: syntax only, so nothing is resolved, checked or evaluated. The parser gets a
 * synthetic file name for the kind, never the caller's path: a path ending `.d.ts` would switch it into declaration
 * mode, and a path may hold lone surrogates. The only `try` is around TypeScript's `createSourceFile`: a throw from
 * the parser is returned as `{ ok: false, threw }` for the caller to refuse, while a broken invariant of ours (the
 * diagnostics read after the parse) throws out of this function.
 */
export function parseTestFile(kind: TestScriptKind, text: string): ParsedTestFile {
  // The first read of the parser in a run, and deliberately outside the `try` below: the Action loads TypeScript on
  // that read, and a failure to load must throw out of here, never come back as `{ ok: false }` and be refused as a
  // parser throw (packages/core/test/parse-load-order.test.ts pins this placement).
  const scriptKind = tsScriptKind(kind);
  const fileName = FILE_NAME[kind];
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      fileName,
      text,
      { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
      true,
      scriptKind,
    );
  } catch (threw) {
    return { ok: false, threw };
  }
  return { ok: true, sourceFile, syntaxErrors: parseDiagnosticCount(sourceFile) };
}
