import { normalizePypiName } from "./names.js";
import { sourceOfResolved } from "./specs.js";
import { parseTomlDocument, type TomlValue, valueAt } from "./toml.js";
import type { LockArtifact, LockEntry, LockSource, ParsedLockfile } from "./types.js";
import { artifactHosts, isAllowedRegistryUrl } from "./urls.js";

/** PyPI's simple index: the registry of a package that names no source. */
const PYPI_INDEX = "https://pypi.org/simple";

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

/**
 * The `url` of a uv package's `sdist` table and of each table of its `wheels` array, in that order, each judged on
 * `hosts` (see `artifactHosts`). uv downloads a registry package from these URLs, not from its index (`uv sync --frozen`
 * does not re-resolve). A table with no `url` (a `path` or a `filename`: a local file) adds nothing. Null when `sdist`
 * is not a table, `wheels` is not an array of tables, or a `url` is not a string: a shape uv does not write is unread.
 */
function uvArtifacts(entries: Map<string, TomlValue>, hosts: readonly string[]): LockArtifact[] | null {
  const artifacts: LockArtifact[] = [];
  const add = (kind: LockArtifact["kind"], table: TomlValue): boolean => {
    if (table.type !== "table") return false;
    const url = table.entries.get("url");
    if (url === undefined) return true;
    if (url.type !== "string") return false;
    artifacts.push({ kind, url: url.value, allowed: isAllowedRegistryUrl(url.value, hosts), line: url.line });
    return true;
  };
  const sdist = entries.get("sdist");
  if (sdist !== undefined && !add("sdist", sdist)) return null;
  const wheels = entries.get("wheels");
  if (wheels === undefined) return artifacts;
  if (wheels.type !== "array") return null;
  for (const wheel of wheels.items) if (!add("wheel", wheel)) return null;
  return artifacts;
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
 * tables (CORE-114). A uv package from a registry or a URL also carries the `url` of its `sdist` and `wheels`, from the
 * same tree, so `[package.sdist]`, `[[package.wheels]]`, inline tables and dotted keys read the same (CORE-9 R4.8); a
 * poetry.lock's `files` hold only file names and hashes. `names` holds every normalized name. Null when the TOML cannot
 * be read, or when `package`, a package's `source`, or a uv package's `sdist` or `wheels` is not the shape poetry and uv
 * write: a shape the reader does not know is unread, never passed. Hashes are not compared (docs/LIMITS.md).
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
    const lockSource: LockSource =
      source === undefined
        ? { kind: "registry" }
        : format === "uv"
          ? uvSource(source.entries)
          : poetrySource(source.entries);
    let artifacts: LockArtifact[] | undefined;
    if (format === "uv") {
      // A registry or URL source's files must stay on its host or its registry's file hosts; no source is PyPI. A
      // git, path or workspace package is judged by its source alone, but its artifacts must still be the shape uv
      // writes.
      const from = lockSource.kind === "registry" ? PYPI_INDEX : lockSource.kind === "url" ? lockSource.text : null;
      const read = uvArtifacts(item.entries, from === null ? [] : artifactHosts(from));
      if (read === null) return null;
      if (from !== null) artifacts = read;
    }
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
      source: lockSource,
      ...(artifacts === undefined ? {} : { artifacts }),
      line: item.line,
    });
  }
  return { ecosystem: "pypi", format, entries, importers: null, specs: null, names };
}
