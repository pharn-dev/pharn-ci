import { isAbsolutePath, normalizePath } from "../paths.js";
import type { CoverageMap, LineHits, ParseCoverageOptions } from "./types.js";
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
 * skipped silently. A file appears in the map only when it has a valid line.
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
 *
 * The XML is read with a linear, non-recursive scanner (`xml.ts`); malformed or
 * hostile input yields whatever was readable before the damage, never a throw.
 */
export function parseCobertura(text: string, options: ParseCoverageOptions = {}): CoverageMap {
  const sources: string[] = [];
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
          addLine(perFile, currentFile, event.attrs.get("number"), event.attrs.get("hits"));
        }
        break;
    }
  });

  const uniqueSources = [...new Set(sources)];
  const map: CoverageMap = new Map();
  for (const [filename, lines] of perFile) {
    const key = resolvePath(filename, uniqueSources, options.repoRoot);
    let target = map.get(key);
    if (!target) {
      target = new Map();
      map.set(key, target);
    }
    for (const [lineNo, hits] of lines) {
      target.set(lineNo, Math.max(target.get(lineNo) ?? 0, hits));
    }
  }
  return map;
}

function addLine(
  perFile: Map<string, LineHits>,
  filename: string,
  number: string | undefined,
  hits: string | undefined,
) {
  if (number === undefined) return;
  const lineNo = Number(number);
  if (!Number.isInteger(lineNo) || lineNo < 1) return;
  let count = 0;
  if (hits !== undefined) {
    if (hits.trim() === "") return;
    count = Number(hits);
    if (!Number.isFinite(count) || count < 0) return;
  }
  let lines = perFile.get(filename);
  if (!lines) {
    lines = new Map();
    perFile.set(filename, lines);
  }
  lines.set(lineNo, Math.max(lines.get(lineNo) ?? 0, count));
}

function resolvePath(filename: string, sources: readonly string[], repoRoot: string | undefined): string {
  if (isAbsolutePath(filename)) return normalizePath(filename, repoRoot);
  for (const source of sources) {
    const joined = `${source}/${filename}`;
    if (isAbsolutePath(source)) {
      if (repoRoot === undefined) continue;
      const key = normalizePath(joined, repoRoot);
      if (!isAbsolutePath(key) && !climbs(key)) return key;
    } else {
      const key = normalizePath(joined);
      if (key !== "" && !climbs(key)) return key;
    }
  }
  return normalizePath(filename, repoRoot);
}

function climbs(path: string): boolean {
  return path === ".." || path.startsWith("../");
}
