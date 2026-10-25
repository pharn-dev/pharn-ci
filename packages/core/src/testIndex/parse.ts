import ts from "typescript5";
import type { TestScriptKind } from "./scriptKind.js";

const KIND: Record<TestScriptKind, { scriptKind: ts.ScriptKind; fileName: string }> = {
  ts: { scriptKind: ts.ScriptKind.TS, fileName: "index.ts" },
  tsx: { scriptKind: ts.ScriptKind.TSX, fileName: "index.tsx" },
  js: { scriptKind: ts.ScriptKind.JS, fileName: "index.js" },
  jsx: { scriptKind: ts.ScriptKind.JSX, fileName: "index.jsx" },
};

/** `parseDiagnostics` is internal to TypeScript and absent from its .d.ts; this is the one place that reads it. */
function parseDiagnosticCount(sourceFile: ts.SourceFile): number {
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: unknown }).parseDiagnostics;
  if (!Array.isArray(diagnostics)) throw new Error("TypeScript no longer exposes parseDiagnostics");
  return diagnostics.length;
}

/**
 * The one parse of the test index: syntax only, so nothing is resolved, checked or evaluated. The parser gets a
 * synthetic file name for the kind, never the caller's path: a path ending `.d.ts` would switch it into declaration
 * mode, and a path may hold lone surrogates.
 */
export function parseTestFile(kind: TestScriptKind, text: string): { sourceFile: ts.SourceFile; syntaxErrors: number } {
  const { scriptKind, fileName } = KIND[kind];
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
    scriptKind,
  );
  return { sourceFile, syntaxErrors: parseDiagnosticCount(sourceFile) };
}
