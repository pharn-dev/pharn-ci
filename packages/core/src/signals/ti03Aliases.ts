import type { DiffFile } from "../diff/unified.js";
import type { PythonTestIndex } from "../testIndex/pythonSides.js";
import type { PythonIndexFile } from "../testIndex/pythonTypes.js";
import type { TestSourceSide, TestSources } from "../testSources.js";

/** A Python file's alias bindings: a local name and the dotted name it stands for. */
type AliasMap = ReadonlyMap<string, string>;

/**
 * The alias maps TI03 resolves Python skip spellings with (`@pt.mark.skip` is `@pytest.mark.skip` under
 * `import pytest as pt`). They come from the Python test index only: its `aliases` field, the top-level `import` and
 * `from ... import` bindings the interpreter's own parser read. Core reads no import statement itself.
 */
export interface Ti03Aliases {
  /** The base side's map of a path: undefined for a non-Python path, no sources and a side the index did not index. */
  base(path: string): AliasMap | undefined;
  /** The head side's map of a path, under the same rule. */
  head(path: string): AliasMap | undefined;
  /**
   * The maps for a diff entry: removed lines read with `base`, added lines with `head`. A side with no text at all (a
   * drop such as `missing`, or the old path of a rename from a non-test path) takes the other side's map when that
   * side's file was indexed; a side whose text was held but not indexed (no Python index, or a refusal of the file)
   * has none, and borrows nothing.
   */
  forFile(file: DiffFile): { base?: AliasMap; head?: AliasMap };
}

/** What one side knows of one path: no text at all, text the index did not read, or the map of an indexed file. */
type SideState = { text: false } | { text: true; map: AliasMap | undefined };

const NO_TEXT: SideState = { text: false };

/** The text-holding paths of one side of the sources; empty for an unavailable side. */
function heldPaths(side: TestSourceSide | undefined): ReadonlySet<string> {
  if (side === undefined || !("files" in side)) return new Set();
  return new Set(side.files.map((file) => file.path));
}

/** A side's own map when it held text (possibly none), else the other side's map when that side held text. */
function mapOrBorrowed(self: SideState, other: SideState): AliasMap | undefined {
  if (self.text) return self.map;
  return other.text ? other.map : undefined;
}

function pairsOf(file: PythonIndexFile): AliasMap {
  const map = new Map<string, string>();
  for (const [local, target] of file.aliases ?? []) map.set(local, target);
  return map;
}

/**
 * Builds the alias lookup of one `check()` run from the test sources (which side holds which path's text) and the Python
 * test index. One rule for every file: a side whose text the sources held and whose index entry is parsed uses that
 * entry's `aliases` (none given: an empty map); a side whose text was held but not indexed has no map; a side without
 * text borrows the other side's map as `forFile` says. Maps are built when first asked for and kept.
 */
export function ti03Aliases(sources: TestSources | undefined, python: PythonTestIndex | undefined): Ti03Aliases {
  const held = { base: heldPaths(sources?.base), head: heldPaths(sources?.head) };
  const index = { base: new Map<string, PythonIndexFile>(), head: new Map<string, PythonIndexFile>() };
  if (python !== undefined && python.available) {
    for (const file of python.base) index.base.set(file.path, file);
    for (const file of python.head) index.head.set(file.path, file);
  }
  const states = { base: new Map<string, SideState>(), head: new Map<string, SideState>() };

  const stateOf = (side: "base" | "head", path: string): SideState => {
    if (!path.endsWith(".py") || !held[side].has(path)) return NO_TEXT;
    let state = states[side].get(path);
    if (state === undefined) {
      const entry = index[side].get(path);
      state = { text: true, map: entry !== undefined && entry.result.parsed ? pairsOf(entry) : undefined };
      states[side].set(path, state);
    }
    return state;
  };

  const own = (side: "base" | "head", path: string): AliasMap | undefined => {
    const state = stateOf(side, path);
    return state.text ? state.map : undefined;
  };

  return {
    base: (path) => own("base", path),
    head: (path) => own("head", path),
    forFile(file) {
      if (!file.path.endsWith(".py")) return {};
      const base = stateOf("base", file.oldPath);
      const head = stateOf("head", file.path);
      const baseMap = mapOrBorrowed(base, head);
      const headMap = mapOrBorrowed(head, base);
      return {
        ...(baseMap === undefined ? {} : { base: baseMap }),
        ...(headMap === undefined ? {} : { head: headMap }),
      };
    },
  };
}
