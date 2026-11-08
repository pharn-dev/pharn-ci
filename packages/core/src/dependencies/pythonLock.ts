import { normalizePypiName } from "./names.js";
import { sourceOfResolved } from "./specs.js";
import { isTable, parseToml, type TomlValue } from "./toml.js";
import type { LockEntry, LockSource, ParsedLockfile } from "./types.js";
import { isAllowedRegistryUrl } from "./urls.js";

function stringIn(entries: Map<string, TomlValue> | undefined, key: string): string | null {
  const value = entries?.get(key);
  return value !== undefined && value.type === "string" ? value.value : null;
}

/** uv's `source = { registry | git | url | path | directory | editable | virtual = … }`. */
function uvSource(value: TomlValue | undefined): LockSource {
  if (value === undefined || value.type !== "table") return { kind: "registry" };
  const entries = value.entries;
  const registry = stringIn(entries, "registry");
  if (registry !== null) return { kind: "url", allowed: isAllowedRegistryUrl(registry), text: registry };
  const git = stringIn(entries, "git");
  if (git !== null) return { kind: "git", text: git };
  const url = stringIn(entries, "url");
  if (url !== null) return sourceOfResolved(url);
  const path = stringIn(entries, "path") ?? stringIn(entries, "directory");
  if (path !== null) return { kind: "file", text: path };
  // `editable` and `virtual`: the project itself or a workspace member.
  return { kind: "link" };
}

/** poetry's `[package.source]`: `type` (git, url, file, directory, legacy) and `url`. */
function poetrySource(entries: Map<string, TomlValue>): LockSource {
  const type = stringIn(entries, "type");
  const url = stringIn(entries, "url") ?? "";
  if (type === "git") return { kind: "git", text: url };
  if (type === "file" || type === "directory") return { kind: "file", text: url };
  if (url === "") return { kind: "registry" };
  return sourceOfResolved(url);
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
  let current: { line: number; name: string | null; version: string | null; source: LockSource } | null = null;
  const finish = () => {
    if (current === null || current.name === null) return;
    const name = normalizePypiName(current.name);
    names.add(name);
    entries.push({
      key: `${name}@${current.version ?? ""}`,
      name: current.name,
      version: current.version,
      integrity: null,
      source: current.source,
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
        source: format === "uv" ? uvSource(table.entries.get("source")) : { kind: "registry" },
      };
    } else if (!table.array && isTable(table, ["package", "source"]) && current !== null && format === "poetry") {
      current.source = poetrySource(table.entries);
    }
  }
  finish();
  return { ecosystem: "pypi", format, entries, importers: null, specs: null, names };
}
