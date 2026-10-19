import {
  foldForRoot,
  isAbsolutePath,
  joinCoverageRoot,
  normalizePath,
  normalizeRoot,
  startsWithPath,
} from "../paths.js";
import type { CoverageMap, LineHits, ParseCoverageOptions, ParsedCoverage } from "./types.js";
import { scanXml } from "./xml.js";

/**
 * Parse a Cobertura XML report (coverage.py, pytest-cov, JaCoCo converted to
 * Cobertura, coverlet, ...) into a CoverageMap.
 *
 * Read: `<source>` elements inside `<sources>`, and for every `<class>` its
 * `filename` and its class-level `<line number hits>` records. A `<line>` inside
 * `<methods>` is ignored, so a method's own hit count never overrides the class
 * one. Ignored: `branch`, `condition-coverage`, the rate attributes and every
 * other element or attribute.
 *
 * A `<line>` is valid on the same rule as lcov's `DA`: `number` is an integer
 * >= 1 and `hits` is absent (0) or a finite number >= 0. Invalid lines are
 * skipped and counted (`parseCoberturaCounted`); a `<line>` outside a class with a filename, or inside
 * `<methods>`, is ignored by design and not counted. A file appears in the map only when it has a valid line.
 *
 * A file seen in several classes (JaCoCo inner classes, a source shared by two
 * packages) is merged by the maximum hits per line. This differs from lcov's
 * sum on purpose: Cobertura repeats a file's lines across classes and summing
 * would double-count them.
 *
 * Paths: an absolute `filename` is never joined to a source; it is normalized
 * against `repoRoot` as lcov paths are. A relative one is joined to the sources
 * in document order and the first join that lies under the repo root (an
 * absolute source needs `repoRoot`; a relative source must not climb above the
 * root) wins. With no qualifying source the filename is used as written,
 * normalized. Core cannot check which joined file exists, so with several
 * qualifying sources the first one wins even when a later one was the real one.
 * A relative filename that starts with `..` is joined only to the first
 * `MAX_CLIMBING_JOIN_SOURCES` distinct sources; every other filename is joined
 * to all of them, through a list built once that skips sources whose join can
 * never qualify, so resolution stays linear on a report with thousands of
 * sources and filenames.
 *
 * Coverage root: when `coverageRoot` is set, it is joined in front of a path that
 * is relative as written, that is a join with a relative source or the filename
 * itself. An absolute filename, and a filename joined to an absolute source, are
 * never prefixed. The source qualification above is judged on the key without
 * the root.
 *
 * The XML is read with a linear, non-recursive scanner (`xml.ts`); malformed or
 * hostile input yields whatever was readable before the damage, never a throw.
 */
export function parseCobertura(text: string, options: ParseCoverageOptions = {}): CoverageMap {
  return parseCoberturaCounted(text, options).map;
}

/** Like `parseCobertura`, with the number of class-level `<line>` elements that were dropped as malformed. */
export function parseCoberturaCounted(text: string, options: ParseCoverageOptions = {}): ParsedCoverage {
  const sources: string[] = [];
  let skipped = 0;
  const perFile = new Map<string, LineHits>();
  let inSources = false;
  let sourceText: string | undefined;
  let currentFile: string | undefined;
  let methodDepth = 0;

  scanXml(text, (event) => {
    if (event.type === "text") {
      if (sourceText !== undefined) sourceText += event.text;
      return;
    }
    if (event.type === "end") {
      switch (event.name) {
        case "sources":
          inSources = false;
          sourceText = undefined;
          break;
        case "source": {
          const source = sourceText?.trim();
          if (source) sources.push(source);
          sourceText = undefined;
          break;
        }
        case "class":
          currentFile = undefined;
          methodDepth = 0;
          break;
        case "methods":
        case "method":
          if (methodDepth > 0) methodDepth--;
          break;
      }
      return;
    }
    switch (event.name) {
      case "sources":
        inSources = !event.selfClosing;
        break;
      case "source":
        if (inSources && !event.selfClosing) sourceText = "";
        break;
      case "class": {
        const filename = event.selfClosing ? "" : (event.attrs.get("filename") ?? "").trim();
        currentFile = filename === "" ? undefined : filename;
        methodDepth = 0;
        break;
      }
      case "methods":
      case "method":
        if (currentFile !== undefined && !event.selfClosing) methodDepth++;
        break;
      case "line":
        if (currentFile !== undefined && methodDepth === 0) {
          if (!addLine(perFile, currentFile, event.attrs.get("number"), event.attrs.get("hits"))) skipped++;
        }
        break;
    }
  });

  const resolve = makeResolver([...new Set(sources)], options.repoRoot, options.coverageRoot);
  const map: CoverageMap = new Map();
  for (const [filename, lines] of perFile) {
    const key = resolve(filename);
    let target = map.get(key);
    if (!target) {
      target = new Map();
      map.set(key, target);
    }
    for (const [lineNo, hits] of lines) {
      target.set(lineNo, Math.max(target.get(lineNo) ?? 0, hits));
    }
  }
  return { map, skipped };
}

/** Add one class-level line to `perFile`; false when the line is malformed and was dropped. */
function addLine(
  perFile: Map<string, LineHits>,
  filename: string,
  number: string | undefined,
  hits: string | undefined,
): boolean {
  if (number === undefined) return false;
  const lineNo = Number(number);
  if (!Number.isInteger(lineNo) || lineNo < 1) return false;
  let count = 0;
  if (hits !== undefined) {
    if (hits.trim() === "") return false;
    count = Number(hits);
    if (!Number.isFinite(count) || count < 0) return false;
  }
  let lines = perFile.get(filename);
  if (!lines) {
    lines = new Map();
    perFile.set(filename, lines);
  }
  lines.set(lineNo, Math.max(lines.get(lineNo) ?? 0, count));
  return true;
}

/**
 * How many distinct sources a relative filename that starts with `..` (after
 * normalization) is joined to. Such a filename can step out of any source, so
 * no source can be ruled out up front; the cap keeps a crafted report with
 * thousands of sources and filenames linear (F-24).
 */
const MAX_CLIMBING_JOIN_SOURCES = 16;

function makeResolver(
  sources: readonly string[],
  repoRoot: string | undefined,
  coverageRoot: string | undefined,
): (filename: string) => string {
  // The coverage root is joined only after a source is chosen, so it does not change which sources qualify.
  const direct = directSources(sources, repoRoot);
  const climbing = sources.slice(0, MAX_CLIMBING_JOIN_SOURCES);
  return (filename) => {
    if (isAbsolutePath(filename)) return normalizePath(filename, repoRoot);
    return resolvePath(filename, climbs(normalizePath(filename)) ? climbing : direct, repoRoot, coverageRoot);
  };
}

/**
 * The sources, in document order, that `resolvePath` must try for a relative
 * filename whose normalized form does not start with `..` to get the result it
 * would get from all of them. Such a filename only appends segments to the
 * normalized source, so the result is decided by the source alone, and this
 * list leaves out:
 * - a source whose join can never qualify: a relative source that climbs; an
 *   absolute one with no usable root, one that is not under the root and at
 *   least as long as it, one under the root whose remainder starts like a drive
 *   path (`X:/`, so every key would be absolute), and a shorter one whose next
 *   segment boundary is not one of the root's;
 * - a source whose join gives the same result as an earlier kept one for every
 *   such filename (same remainder under the root, the root itself, or the same
 *   folded ancestor of the same length);
 * - every source after the first one that qualifies for every such filename (a
 *   non-empty relative source that does not climb, or one under the root with a
 *   plain remainder).
 * What is left is bounded by the depth of the root, not by the report.
 */
function directSources(sources: readonly string[], repoRoot: string | undefined): string[] {
  const root = normalizeRoot(repoRoot);
  const foldedRoot = foldForRoot(root, root);
  const kept: string[] = [];
  const seen = new Set<string>();
  const keep = (source: string, key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    kept.push(source);
  };
  for (const source of sources) {
    const path = normalizePath(source);
    if (!isAbsolutePath(source)) {
      if (climbs(path)) continue;
      if (path !== "") {
        kept.push(source);
        break;
      }
      keep(source, "relative:");
      continue;
    }
    if (root === "") continue;
    if (startsWithPath(path, root)) {
      const rest = path.slice(root.length + 1);
      if (rest !== "" && !isAbsolutePath(`${rest}/`)) {
        kept.push(source);
        break;
      }
      if (rest.length < 3) keep(source, `under:${rest}`);
    } else if (path.length === root.length) {
      if (startsWithPath(`${path}/`, root)) keep(source, "root:");
    } else if (path.length < root.length) {
      const folded = foldForRoot(path, root);
      if (foldedRoot.startsWith(path.endsWith("/") ? folded : `${folded}/`)) {
        keep(source, `ancestor:${path.length}:${folded}`);
      }
    }
  }
  return kept;
}

/** Resolve a relative filename (absolute ones are handled by `makeResolver`). */
function resolvePath(
  filename: string,
  sources: readonly string[],
  repoRoot: string | undefined,
  coverageRoot: string | undefined,
): string {
  for (const source of sources) {
    const joined = `${source}/${filename}`;
    if (isAbsolutePath(source)) {
      if (repoRoot === undefined) continue;
      const key = normalizePath(joined, repoRoot);
      if (!isAbsolutePath(key) && !climbs(key)) return key;
    } else {
      const key = normalizePath(joined);
      if (key !== "" && !climbs(key)) return joinCoverageRoot(key, coverageRoot);
    }
  }
  const key = normalizePath(filename, repoRoot);
  return isAbsolutePath(key) ? key : joinCoverageRoot(key, coverageRoot);
}

function climbs(path: string): boolean {
  return path === ".." || path.startsWith("../");
}
