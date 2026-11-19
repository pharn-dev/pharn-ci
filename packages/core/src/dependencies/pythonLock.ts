import { normalizePypiName } from "./names.js";
import { isTable, parseToml, type TomlValue } from "./toml.js";
import type { LockEntry, ParsedLockfile } from "./types.js";

function stringIn(entries: Map<string, TomlValue> | undefined, key: string): string | null {
  const value = entries?.get(key);
  return value !== undefined && value.type === "string" ? value.value : null;
}

/**
 * A poetry.lock or uv.lock: one entry per `[[package]]`, keyed by its normalized name and version, with its source
 * (uv's `source` inline table, poetry's `[package.source]` table; none is PyPI). `names` holds every normalized name.
 * Null when the TOML cannot be read. Hashes are not compared (docs/LIMITS.md).
 */
export function parsePythonLock(text: string, format: "poetry" | "uv"): ParsedLockfile | null {
  const tables = parseToml(text);
  if (tables === null) return null;
  const entries: LockEntry[] = [];
  const names = new Set<string>();
  let current: { line: number; name: string | null; version: string | null } | null = null;
  const finish = () => {
    if (current === null || current.name === null) return;
    const name = normalizePypiName(current.name);
    names.add(name);
    entries.push({
      key: `${name}@${current.version ?? ""}`,
      name: current.name,
      version: current.version,
      integrity: null,
      // CORE-106 spike: D05 reads the lockfile's lines (lockLines.ts), not this structure.
      source: { kind: "registry" },
      line: current.line,
    });
  };
  for (const table of tables) {
    if (table.array && isTable(table, ["package"])) {
      finish();
      current = {
        line: table.line,
        name: stringIn(table.entries, "name"),
        version: stringIn(table.entries, "version"),
      };
    }
  }
  finish();
  return { ecosystem: "pypi", format, entries, importers: null, specs: null, names };
}
