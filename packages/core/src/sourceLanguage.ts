import { JS_TS_EXTENSIONS, jsTsFlavor } from "./jsTsExtensions.js";

/** The language of a JavaScript, TypeScript or Python file, by its extension. */
export type SourceLanguage = "ts" | "js" | "py";

const EXTENSION_LANGUAGE: ReadonlyMap<string, SourceLanguage> = new Map<string, SourceLanguage>([
  ...JS_TS_EXTENSIONS.map((extension): [string, SourceLanguage] => [extension, jsTsFlavor(extension)]),
  ["py", "py"],
]);

/**
 * The language of a path by the extension of its basename (case-sensitive): `ts` or `js` for the eight JS/TS
 * extensions, `py` for `py`, else null. A basename that is only an extension (`tests/.ts`) counts as that extension. The
 * one extension-to-language mapper: the test pairing (`languageOf`), the one-line test readers (`testLanguage`) and the
 * source-file signals (`coverageSourceLanguage`) all read it.
 */
export function sourceLanguage(path: string): SourceLanguage | null {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  if (dot === -1) return null;
  return EXTENSION_LANGUAGE.get(basename.slice(dot + 1)) ?? null;
}
