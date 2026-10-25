import type { DiffFile } from "../diff/unified.js";
import { isTestFile } from "../testFiles.js";
import type { TestModuleMock } from "../testIndex/types.js";

const JS_CALLEES: ReadonlySet<string> = new Set(["vi.mock", "vi.doMock", "jest.mock", "jest.doMock"]);
const PYTHON_CALLEES: ReadonlySet<string> = new Set([
  "patch",
  "mock.patch",
  "unittest.mock.patch",
  "mocker.patch",
  "monkeypatch.setattr",
]);

/** The eight extensions of a JavaScript or TypeScript module, in the order candidates are tried. */
const EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"] as const;
const TS_TWIN: Readonly<Record<string, string>> = { js: "ts", jsx: "tsx", mjs: "mts", cjs: "cts" };

/**
 * The source files the change adds, modifies or renames: each new path maps to itself, and a renamed file's old path to
 * its new one. A test file is never a source; a deleted file is left out.
 */
export function changedSources(diff: readonly DiffFile[]): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of diff) {
    if (file.status === "deleted" || isTestFile(file.path)) continue;
    sources.set(file.path, file.path);
    if (file.status === "renamed") sources.set(file.oldPath, file.path);
  }
  return sources;
}

/** `dir` joined with a relative specifier, `.`, `..` and empty segments resolved; null when it climbs out of the root. */
function joinRelative(dir: string, specifier: string): string | null {
  const parts = dir === "" ? [] : dir.split("/").filter((s) => s !== "" && s !== ".");
  const resolved: string[] = [];
  for (const part of [...parts, ...specifier.split("/")]) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.length === 0 ? null : resolved.join("/");
}

function extensionOf(path: string): string | null {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = basename.slice(dot + 1);
  return (EXTENSIONS as readonly string[]).includes(extension) ? extension : null;
}

/** The files a relative specifier may name, in order: the path, its TypeScript twin, or the path with each extension or `/index`. */
function jsCandidates(path: string): string[] {
  const extension = extensionOf(path);
  const candidates = [path];
  if (extension !== null) {
    const twin = TS_TWIN[extension];
    if (twin !== undefined) candidates.push(`${path.slice(0, -extension.length)}${twin}`);
    return candidates;
  }
  for (const ext of EXTENSIONS) candidates.push(`${path}.${ext}`);
  for (const ext of EXTENSIONS) candidates.push(`${path}/index.${ext}`);
  return candidates;
}

function isIdentifier(part: string): boolean {
  if (part === "") return false;
  for (let i = 0; i < part.length; i++) {
    const code = part.charCodeAt(i);
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
    if (!(letter || (i > 0 && code >= 48 && code <= 57))) return false;
  }
  return true;
}

/** The dotted parts of a Python patch target made of identifiers (at least two), else null. */
function dottedParts(specifier: string): string[] | null {
  const parts = specifier.split(".");
  return parts.length >= 2 && parts.every(isIdentifier) ? parts : null;
}

/**
 * The changed source file a mock replaces, or null. JavaScript and TypeScript: `vi.mock`, `vi.doMock`, `jest.mock` and
 * `jest.doMock` with a specifier starting `./` or `../`, joined to the directory of `testPath`, resolved to the first
 * candidate in the changed set. Python: `patch`, `mock.patch`, `unittest.mock.patch`, `mocker.patch` and
 * `monkeypatch.setattr` with a dotted name, tried from the longest module prefix down, as `P.py`, `P/__init__.py`,
 * `src/P.py` and `src/P/__init__.py`. Bare and alias specifiers and the `.object` forms resolve to nothing. The result is
 * the new path of the changed entry.
 */
export function resolveMock(
  testPath: string,
  mock: Pick<TestModuleMock, "callee" | "specifier">,
  changed: ReadonlyMap<string, string>,
): string | null {
  const specifier = mock.specifier;
  if (specifier === null) return null;
  if (JS_CALLEES.has(mock.callee)) {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
    const dir = testPath.slice(0, Math.max(0, testPath.lastIndexOf("/")));
    const path = joinRelative(dir, specifier);
    if (path === null) return null;
    for (const candidate of jsCandidates(path)) {
      const target = changed.get(candidate);
      if (target !== undefined) return target;
    }
    return null;
  }
  if (PYTHON_CALLEES.has(mock.callee)) {
    const parts = dottedParts(specifier);
    if (parts === null) return null;
    for (let k = parts.length - 1; k >= 1; k--) {
      const prefix = parts.slice(0, k).join("/");
      for (const candidate of [
        `${prefix}.py`,
        `${prefix}/__init__.py`,
        `src/${prefix}.py`,
        `src/${prefix}/__init__.py`,
      ]) {
        const target = changed.get(candidate);
        if (target !== undefined) return target;
      }
    }
  }
  return null;
}
