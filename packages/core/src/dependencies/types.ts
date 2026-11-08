import type { FixHint } from "../fix/table.js";

/** The package ecosystems dependency safety reads (A13). Go is not read yet (docs/LIMITS.md). */
export type DependencyEcosystem = "npm" | "pypi";

/** The dependency safety signals: D01 to D05 (AGENT-PR-RULES-SPEC §2). */
export type DependencySignalId = "D01" | "D02" | "D03" | "D04" | "D05";

/** How hard a dependency finding bites: `block` fails the check, `warn` warns. */
export type DependencySeverity = "block" | "warn";

/**
 * One finding of dependency safety, as the report carries it. `name` and `version` are the package name and the version
 * spec from the manifest or lockfile, present only when they pass a strict allow-list (see names.ts); `detail` is fixed
 * words, counts and numbers, never file text.
 */
export interface DependencySignal {
  id: DependencySignalId;
  severity: DependencySeverity;
  ecosystem: DependencyEcosystem;
  name?: string;
  version?: string;
  path: string;
  /** 1-based line at HEAD, or null. */
  line: number | null;
  detail: string;
  /** How to fix it (since 0.9.0); set by `buildReport`. */
  fix?: FixHint;
}

/** Where a dependency comes from: a registry, or a source outside every registry (the D05 kinds). */
export type SourceKind = "registry" | "git" | "url" | "file";

/** One dependency a manifest declares. */
export interface ManifestDependency {
  /** The package name as written; for a requirement line with no name, the line's text (never reported). */
  name: string;
  /** Whether `name` is a real package name. */
  named: boolean;
  /** The version spec as written ("" when none). */
  spec: string;
  /** The section it is declared in, e.g. `dependencies`, `devDependencies`, `project.dependencies`. */
  section: string;
  line: number;
  /** Where the spec points. */
  kind: SourceKind;
  /** For kind `url`: whether the URL is https on an allowed registry host. */
  allowedUrl?: boolean;
}

/** An index or find-links option of a requirements file (`--index-url`, `-i`, `--extra-index-url`, `-f`). */
export interface IndexOption {
  url: string;
  line: number;
  allowed: boolean;
}

/** A parsed manifest. `peer` sections are declared but never installed, so the lockfile checks skip them. */
export interface ParsedManifest {
  ecosystem: DependencyEcosystem;
  deps: ManifestDependency[];
  indexes: IndexOption[];
}

/** The source of one lockfile entry. `link` (a workspace link) and `local` (the project itself) are never flagged. */
export type LockSource =
  | { kind: "registry" }
  | { kind: "url"; allowed: boolean; text: string }
  | { kind: "git"; text: string }
  | { kind: "file"; text: string }
  | { kind: "link" };

/** One resolved package of a lockfile. */
export interface LockEntry {
  /** The entry's key: its path (package-lock.json), package key (pnpm), header (yarn) or name@version (Python). */
  key: string;
  name: string | null;
  version: string | null;
  /** The integrity or checksum as written, or null. */
  integrity: string | null;
  source: LockSource;
  line: number;
}

/**
 * What a lockfile pins for the manifests it governs. `importers` maps a manifest directory (relative to the lockfile's
 * directory, `""` for the same directory) to the specifier of each declared name; null when the format records no
 * specifiers (package-lock.json v1). `specs` holds every `name@spec` a yarn.lock header names; `names` every package
 * name a Python lockfile resolves (normalized).
 */
export interface ParsedLockfile {
  ecosystem: DependencyEcosystem;
  format: "package-lock" | "pnpm" | "yarn" | "yarn-berry" | "poetry" | "uv";
  entries: LockEntry[];
  importers: Map<string, Map<string, string>> | null;
  specs: Set<string> | null;
  names: Set<string> | null;
}
