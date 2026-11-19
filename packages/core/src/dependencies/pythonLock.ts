import { normalizePypiName } from "./names.js";
import { sourceOfResolved } from "./specs.js";
import { parseTomlDocument, type TomlValue, valueAt } from "./toml.js";
import type { LockEntry, LockSource, ParsedLockfile } from "./types.js";
import { isAllowedRegistryUrl } from "./urls.js";

function stringIn(entries: Map<string, TomlValue> | undefined, key: string): string | null {
  const value = entries?.get(key);
  return value !== undefined && value.type === "string" ? value.value : null;
}

/** uv's `source`: `registry`, `git`, `url`, `path`, `directory`, `editable` or `virtual`. */
function uvSource(entries: Map<string, TomlValue>): LockSource {
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

/** poetry's `source`: `type` (git, url, file, directory, legacy) and `url`. */
function poetrySource(entries: Map<string, TomlValue>): LockSource {
  const type = stringIn(entries, "type");
  const url = stringIn(entries, "url") ?? "";
  if (type === "git") return { kind: "git", text: url };
  if (type === "file" || type === "directory") return { kind: "file", text: url };
  if (url === "") return { kind: "registry" };
  return sourceOfResolved(url);
}

/**
 * A poetry.lock or uv.lock: one entry per package of the document's `package` array, keyed by its normalized name and
 * version, with its source (none is PyPI). Both formats read the package's `source` table from the document tree, so
 * it is the same whether the file writes it as a `[package.source]` sub-table, an inline table or dotted keys
 * (`source.url = …`), and the packages are the same whether they are `[[package]]` headers or a static array of inline
 * tables (CORE-114). `names` holds every normalized name. Null when the TOML cannot be read, or when `package` or a
 * package's `source` is not the table poetry and uv require: a shape the reader does not know is unread, never passed.
 * Hashes are not compared (docs/LIMITS.md).
 */
export function parsePythonLock(text: string, format: "poetry" | "uv"): ParsedLockfile | null {
  const document = parseTomlDocument(text);
  if (document === null) return null;
  const packages = valueAt(document.root, ["package"]);
  if (packages !== undefined && packages.type !== "array") return null;
  const entries: LockEntry[] = [];
  const names = new Set<string>();
  for (const item of packages?.items ?? []) {
    if (item.type !== "table") return null;
    const source = item.entries.get("source");
    if (source !== undefined && source.type !== "table") return null;
    const rawName = stringIn(item.entries, "name");
    if (rawName === null) continue;
    const version = stringIn(item.entries, "version");
    const name = normalizePypiName(rawName);
    names.add(name);
    entries.push({
      key: `${name}@${version ?? ""}`,
      name: rawName,
      version,
      integrity: null,
      source:
        source === undefined
          ? { kind: "registry" }
          : format === "uv"
            ? uvSource(source.entries)
            : poetrySource(source.entries),
      line: item.line,
    });
  }
  return { ecosystem: "pypi", format, entries, importers: null, specs: null, names };
}
