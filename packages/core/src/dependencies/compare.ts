import { normalizePypiName } from "./names.js";
import { dirOf } from "./paths.js";
import type { LockEntry, LockSource, ManifestDependency, ParsedLockfile, ParsedManifest } from "./types.js";

/** The key a manifest dependency is compared by: its section and name. */
const depKey = (dep: ManifestDependency) => `${dep.section}\u0000${dep.name}`;

/** What a pull request changed in one manifest: dependencies added, changed (another spec) and removed. */
export interface ManifestChanges {
  added: ManifestDependency[];
  changed: ManifestDependency[];
  removed: ManifestDependency[];
}

/** The changes from the base manifest (null for an added file) to the head one. */
export function manifestChanges(base: ParsedManifest | null, head: ParsedManifest): ManifestChanges {
  const before = new Map<string, ManifestDependency>();
  for (const dep of base?.deps ?? []) before.set(depKey(dep), dep);
  const added: ManifestDependency[] = [];
  const changed: ManifestDependency[] = [];
  const seen = new Set<string>();
  for (const dep of head.deps) {
    const key = depKey(dep);
    seen.add(key);
    const old = before.get(key);
    if (old === undefined) added.push(dep);
    else if (old.spec.trim() !== dep.spec.trim()) changed.push(dep);
  }
  const removed = [...before.entries()].filter(([key]) => !seen.has(key)).map(([, dep]) => dep);
  return { added, changed, removed };
}

const sourceText = (source: LockSource) => ("text" in source ? `${source.kind}:${source.text}` : source.kind);

/** What a pull request changed in one lockfile. */
export interface LockChanges {
  /** Entries whose key is new at HEAD. */
  added: LockEntry[];
  /** Entries whose key was there and whose version, integrity or source changed. */
  changed: LockEntry[];
  /** Entries whose source changed (a subset of `changed`) or that are new: the ones D05 judges. */
  sourceNew: LockEntry[];
  /** Entries with the same key and version and an integrity of the same algorithm that differs: D04. */
  integrityChanged: LockEntry[];
}

/** The hash algorithms of an integrity value: SRI prefixes (`sha512-`), a berry cache key (`10c0/`), or none. */
function algorithms(integrity: string): string {
  return integrity
    .trim()
    .split(/\s+/)
    .map((part) => {
      const dash = part.indexOf("-");
      const slash = part.indexOf("/");
      if (dash > 0 && (slash === -1 || dash < slash)) return part.slice(0, dash);
      if (slash > 0) return part.slice(0, slash);
      return "";
    })
    .sort()
    .join(" ");
}

/** The changes from the base lockfile (null for an added file) to the head one. */
export function lockChanges(base: ParsedLockfile | null, head: ParsedLockfile): LockChanges {
  const before = new Map<string, LockEntry>();
  for (const entry of base?.entries ?? []) if (!before.has(entry.key)) before.set(entry.key, entry);
  const out: LockChanges = { added: [], changed: [], sourceNew: [], integrityChanged: [] };
  for (const entry of head.entries) {
    const old = before.get(entry.key);
    if (old === undefined) {
      out.added.push(entry);
      out.sourceNew.push(entry);
      continue;
    }
    const sourceMoved = sourceText(old.source) !== sourceText(entry.source);
    if (old.version !== entry.version || old.integrity !== entry.integrity || sourceMoved) out.changed.push(entry);
    if (sourceMoved) out.sourceNew.push(entry);
    if (
      old.version !== null &&
      old.version === entry.version &&
      old.integrity !== null &&
      entry.integrity !== null &&
      old.integrity !== entry.integrity &&
      algorithms(old.integrity) === algorithms(entry.integrity)
    ) {
      out.integrityChanged.push(entry);
    }
  }
  return out;
}

/** A manifest's directory relative to a lockfile's directory (`""` for the same one); null when it is not below it. */
export function relativeDir(lockPath: string, manifestPath: string): string | null {
  const lockDir = dirOf(lockPath);
  const manifestDir = dirOf(manifestPath);
  if (lockDir === manifestDir) return "";
  if (lockDir === "") return manifestDir;
  return manifestDir.startsWith(`${lockDir}/`) ? manifestDir.slice(lockDir.length + 1) : null;
}

/**
 * Whether a lockfile governs a manifest: always when they share a directory; for a lockfile in an ancestor directory,
 * when it lists the manifest's directory as an importer (package-lock.json v2+, pnpm) or a workspace (yarn berry). A
 * classic yarn.lock and a package-lock.json v1 in an ancestor never record their workspaces, so they do not count; null
 * when the ancestor lockfile could not be read.
 */
export function governs(lockPath: string, lock: ParsedLockfile | null, manifestPath: string): boolean | null {
  const rel = relativeDir(lockPath, manifestPath);
  if (rel === null) return false;
  if (rel === "") return true;
  if (lock === null) return null;
  if (lock.importers !== null) return lock.importers.has(rel);
  if (lock.format === "yarn-berry" && lock.specs !== null) {
    for (const spec of lock.specs) if (spec.endsWith(`@workspace:${rel}`)) return true;
  }
  return false;
}

/**
 * Whether the head lockfile records a manifest dependency as declared: the importer's specifier equals the spec
 * (package-lock.json v2+, pnpm), a header names `name@spec` (yarn; berry also `name@npm:spec`), or the normalized name
 * is resolved (poetry, uv). Null when the format cannot tell (package-lock.json v1, a missing importer).
 */
export function recordsDependency(lock: ParsedLockfile, rel: string, dep: ManifestDependency): boolean | null {
  if (lock.ecosystem === "pypi") return lock.names === null ? null : lock.names.has(normalizePypiName(dep.name));
  if (lock.importers !== null) {
    const importer = lock.importers.get(rel);
    if (importer === undefined) return null;
    return importer.get(dep.name)?.trim() === dep.spec.trim();
  }
  if (lock.specs !== null) {
    const spec = dep.spec.trim();
    if (lock.specs.has(`${dep.name}@${spec}`)) return true;
    return lock.format === "yarn-berry" && lock.specs.has(`${dep.name}@npm:${spec}`);
  }
  return null;
}
