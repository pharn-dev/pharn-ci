/**
 * The JavaScript and TypeScript module extensions pharn-ci reads, in one list. Every site that decides "is this a
 * JS/TS file" derives its answer from here, so a ninth extension is one edit and the sites cannot drift apart.
 */
export const JS_TS_EXTENSIONS = Object.freeze(["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"] as const);

/** One extension of {@link JS_TS_EXTENSIONS}, without the dot. */
export type JsTsExtension = (typeof JS_TS_EXTENSIONS)[number];

/** Whether a string is exactly one of the eight extensions (case-sensitive, no dot). */
export function isJsTsExtension(ext: string): ext is JsTsExtension {
  return (JS_TS_EXTENSIONS as readonly string[]).includes(ext);
}

const FLAVOR: Readonly<Record<JsTsExtension, "ts" | "js">> = Object.freeze({
  js: "js",
  jsx: "js",
  ts: "ts",
  tsx: "ts",
  mjs: "js",
  cjs: "js",
  mts: "ts",
  cts: "ts",
});

/** Whether an extension is a TypeScript (`ts`) or a JavaScript (`js`) spelling. */
export function jsTsFlavor(ext: JsTsExtension): "ts" | "js" {
  return FLAVOR[ext];
}
