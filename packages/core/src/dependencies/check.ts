import type { DiffFile } from "../diff/unified.js";
import type { Message } from "../report.js";
import type { TestSourceDropReason, TestSourceSide, TestSources } from "../testSources.js";
import { byCodeUnit } from "../text.js";
import { governs, lockChanges, manifestChanges, recordsDependency, relativeDir } from "./compare.js";
import { type DependencyLookups, lookupName, type PlannedLookup, planLookups } from "./lookup.js";
import { checkIncompleteMessage, dependencySignalMessages, lookupUnavailableMessage } from "./messages.js";
import { isReportableName, isReportableVersion, normalizePypiName } from "./names.js";
import { parseNpmLock } from "./npmLock.js";
import { parseNpmManifest } from "./npmManifest.js";
import { candidateLockfiles, classifyDependencyFile, type DependencyFileKind, touchedPaths } from "./paths.js";
import { parsePnpmLock } from "./pnpmLock.js";
import { parsePythonLock } from "./pythonLock.js";
import { parsePyproject, parseRequirements } from "./pythonManifest.js";
import type { ResolvedDependencySettings } from "./settings.js";
import { isOffRegistry } from "./specs.js";
import type {
  DependencyEcosystem,
  DependencySignal,
  DependencySignalId,
  LockEntry,
  ManifestDependency,
  ParsedLockfile,
  ParsedManifest,
  SourceKind,
} from "./types.js";
import { isAllowedRegistryUrl } from "./urls.js";
import { parseYarnLock } from "./yarnLock.js";

/** The most signals `dependencies.signals` holds; `truncated` counts the rest. */
export const MAX_DEPENDENCY_SIGNALS = 200;
/** The most files `dependencies.unread` names. */
export const MAX_DEPENDENCY_UNREAD = 100;

/** Why a manifest or lockfile was not checked: a read-plan drop, a side that could not be read, or a parse failure. */
export type DependencyUnreadReason = TestSourceDropReason | "unavailable" | "unparsable";

/** The report's `dependencies` object (schema/report.v2.json, since 0.8.0). */
export interface ReportDependencies {
  /** How many manifest dependencies and lockfile entries the pull request added or changed. */
  checked: number;
  /** `off`: no lookups were asked or could be made; `done`: every planned lookup answered; `unavailable`: some did not. */
  lookups: "off" | "done" | "unavailable";
  signals: DependencySignal[];
  truncated?: number;
  unread?: { path: string; reason: DependencyUnreadReason }[];
}

const DAY_MS = 86_400_000;

const SEVERITY: Readonly<Record<DependencySignalId, "block" | "warn">> = {
  D01: "block",
  D02: "warn",
  D03: "warn",
  D04: "block",
  D05: "block",
};

type Parsed = ParsedManifest | ParsedLockfile;

function parseFile(kind: DependencyFileKind, text: string): Parsed | null {
  switch (kind.format) {
    case "package-json":
      return parseNpmManifest(text);
    case "requirements":
      return parseRequirements(text);
    case "pyproject":
      return parsePyproject(text);
    case "package-lock":
      return parseNpmLock(text);
    case "pnpm":
      return parsePnpmLock(text);
    case "yarn":
      return parseYarnLock(text);
    case "poetry":
    case "uv":
      return parsePythonLock(text, kind.format);
  }
}

/** One side's files by path, or why the side could not be read. */
type SideIndex = { unavailable: true } | { files: Map<string, string>; dropped: Map<string, TestSourceDropReason> };

function indexSide(side: TestSourceSide): SideIndex {
  if ("unavailable" in side) return { unavailable: true };
  return {
    files: new Map(side.files.map((file) => [file.path, file.text])),
    dropped: new Map(side.dropped.map((drop) => [drop.path, drop.reason])),
  };
}

const KIND_WORDS: Readonly<Record<Exclude<SourceKind, "registry">, string>> = {
  git: "a git repository",
  url: "a URL outside the allowed registries",
  file: "a local file",
};

/** What `analyze` found: the offline findings (D04, D05), the added dependencies (for lookups) and what was not read. */
interface Analysis {
  checked: number;
  signals: DependencySignal[];
  unread: Map<string, DependencyUnreadReason>;
  added: Array<{ ecosystem: DependencyEcosystem; dep: ManifestDependency; path: string }>;
  offRegistry: Set<string>;
}

/** The report fields of a package name and version: each present only when it passes the allow-list. */
function nameFields(
  ecosystem: DependencyEcosystem,
  name: string | null,
  version: string | null,
): { name?: string; version?: string } {
  return {
    ...(name !== null && isReportableName(ecosystem, name) ? { name } : {}),
    ...(version !== null && isReportableVersion(version.trim()) ? { version: version.trim() } : {}),
  };
}

function signal(
  id: DependencySignalId,
  ecosystem: DependencyEcosystem,
  path: string,
  line: number | null,
  detail: string,
  names: { name?: string; version?: string } = {},
): DependencySignal {
  return { id, severity: SEVERITY[id], ecosystem, ...names, path, line, detail };
}

function manifestNames(ecosystem: DependencyEcosystem, dep: ManifestDependency) {
  return nameFields(ecosystem, dep.named ? dep.name : null, dep.spec);
}

/**
 * The offline part of dependency safety over the manifests and lockfiles the diff touches, or null when it touches
 * none. Each touched file is read on the side(s) it exists on and parsed; a file that could not be read or parsed is
 * named in `unread` and judged no further. `allowedHosts` are the private registry hosts the run allows besides the four
 * public ones: a URL on one (https, no user name, password or port) is no D05 signal, and a lockfile entry resolved from
 * one stays in `offRegistry`, so its name is never looked up in a public registry.
 */
function analyze(
  diff: readonly DiffFile[],
  sources: TestSources,
  repoFiles: readonly string[],
  allowedHosts: readonly string[],
): Analysis | null {
  const files = diff.filter(
    (file) => classifyDependencyFile(file.path) !== null || classifyDependencyFile(file.oldPath) !== null,
  );
  if (files.length === 0) return null;
  const tracked = new Set(repoFiles);
  const touched = touchedPaths(diff);
  const sides = { base: indexSide(sources.base), head: indexSide(sources.head) };
  const cache = {
    base: new Map<string, Parsed | DependencyUnreadReason>(),
    head: new Map<string, Parsed | DependencyUnreadReason>(),
  };
  const analysis: Analysis = { checked: 0, signals: [], unread: new Map(), added: [], offRegistry: new Set() };
  const onAllowedHost = (url: string | undefined): boolean =>
    url !== undefined && allowedHosts.length > 0 && isAllowedRegistryUrl(url, allowedHosts);
  const read = (side: "base" | "head", path: string, kind: DependencyFileKind): Parsed | null => {
    let got = cache[side].get(path);
    if (got === undefined) {
      const index = sides[side];
      if ("unavailable" in index) got = "unavailable";
      else {
        const text = index.files.get(path);
        got = text === undefined ? (index.dropped.get(path) ?? "missing") : (parseFile(kind, text) ?? "unparsable");
      }
      cache[side].set(path, got);
    }
    if (typeof got === "string") {
      if (!analysis.unread.has(path)) analysis.unread.set(path, got);
      return null;
    }
    return got;
  };

  for (const file of files) {
    if (file.status === "deleted") continue;
    const kind = classifyDependencyFile(file.path);
    if (kind === null) continue;
    const head = read("head", file.path, kind);
    if (head === null) continue;
    let base: Parsed | null = null;
    if (file.status === "modified" || file.status === "renamed") {
      const baseKind = classifyDependencyFile(file.oldPath);
      if (baseKind !== null && baseKind.format === kind.format) {
        base = read("base", file.oldPath, baseKind);
        if (base === null) continue;
      }
    }
    if (kind.role === "manifest") {
      manifest(file.path, kind, base as ParsedManifest | null, head as ParsedManifest);
    } else {
      lockfile(file.path, kind.ecosystem, base as ParsedLockfile | null, head as ParsedLockfile);
    }
  }
  return analysis;

  function manifest(path: string, kind: DependencyFileKind, base: ParsedManifest | null, head: ParsedManifest): void {
    const eco = kind.ecosystem;
    const changes = manifestChanges(base, head);
    analysis.checked += changes.added.length + changes.changed.length;
    for (const dep of [...changes.added, ...changes.changed]) {
      if (dep.kind !== "registry" && isOffRegistry(dep.kind, dep.allowedUrl === true || onAllowedHost(dep.url))) {
        analysis.signals.push(
          signal("D05", eco, path, dep.line, `declared from ${KIND_WORDS[dep.kind]}`, manifestNames(eco, dep)),
        );
      }
    }
    const baseIndexes = new Set((base?.indexes ?? []).map((option) => option.url));
    for (const option of head.indexes) {
      if (!option.allowed && !onAllowedHost(option.url) && !baseIndexes.has(option.url)) {
        analysis.signals.push(
          signal("D05", eco, path, option.line, "adds a package index outside the allowed registries"),
        );
      }
    }
    for (const dep of changes.added) analysis.added.push({ ecosystem: eco, dep, path });

    if (kind.format !== "package-json" && kind.format !== "pyproject") return;
    const installed = (deps: ManifestDependency[]) => deps.filter((dep) => dep.section !== "peerDependencies");
    const declared = installed([...changes.added, ...changes.changed]);
    if (declared.length === 0 && installed(changes.removed).length === 0) return;
    const governing: Array<{ path: string; lock: ParsedLockfile | null }> = [];
    for (const lockPath of candidateLockfiles(path, eco, kind.format, tracked)) {
      const lockKind = classifyDependencyFile(lockPath);
      if (lockKind === null) continue;
      const needed = touched.has(lockPath) || relativeDir(lockPath, path) !== "";
      const lock = needed ? (read("head", lockPath, lockKind) as ParsedLockfile | null) : null;
      if (governs(lockPath, lock, path) === true) governing.push({ path: lockPath, lock });
    }
    if (governing.length === 0) return;
    const updated = governing.filter((entry) => touched.has(entry.path));
    if (updated.length === 0) {
      const first = governing[0] as { path: string };
      const line = declared.length === 0 ? null : Math.min(...declared.map((dep) => dep.line));
      analysis.signals.push(
        signal("D04", eco, path, line, `dependencies changed but the lockfile ${first.path} did not`),
      );
      return;
    }
    for (const dep of declared) {
      const verdicts = updated.map((entry) =>
        entry.lock === null ? null : recordsDependency(entry.lock, relativeDir(entry.path, path) ?? "", dep),
      );
      if (verdicts.length > 0 && verdicts.every((verdict) => verdict === false)) {
        const lockName = (updated[0] as { path: string }).path;
        analysis.signals.push(
          signal(
            "D04",
            eco,
            path,
            dep.line,
            `the lockfile ${lockName} does not record this dependency as declared`,
            manifestNames(eco, dep),
          ),
        );
      }
    }
  }

  function lockfile(path: string, eco: DependencyEcosystem, base: ParsedLockfile | null, head: ParsedLockfile): void {
    const changes = lockChanges(base, head);
    analysis.checked += changes.added.length + changes.changed.length;
    for (const entry of changes.sourceNew) {
      const source = entry.source;
      if (source.kind === "url" && !source.allowed && onAllowedHost(source.text)) {
        if (entry.name !== null)
          analysis.offRegistry.add(`${eco}:${eco === "pypi" ? normalizePypiName(entry.name) : entry.name}`);
        continue;
      }
      const off =
        (source.kind === "url" && !source.allowed) || source.kind === "git" || source.kind === "file"
          ? (source.kind as "url" | "git" | "file")
          : null;
      if (off === null) continue;
      analysis.signals.push(
        signal("D05", eco, path, entry.line, `resolved from ${KIND_WORDS[off]}`, entryNames(eco, entry)),
      );
      if (entry.name !== null)
        analysis.offRegistry.add(`${eco}:${eco === "pypi" ? normalizePypiName(entry.name) : entry.name}`);
    }
    for (const entry of changes.integrityChanged) {
      analysis.signals.push(
        signal(
          "D04",
          eco,
          path,
          entry.line,
          "the same version has a different integrity hash than at the merge base",
          entryNames(eco, entry),
        ),
      );
    }
  }
}

function entryNames(ecosystem: DependencyEcosystem, entry: LockEntry) {
  return nameFields(ecosystem, entry.name, entry.version);
}

/**
 * The packages the Action looks up for a change (see `planLookups`), or null when the diff touches no manifest or
 * lockfile. Pure: the Action makes the requests and passes the results to `check()` as `dependencyLookups`.
 */
export function planDependencyLookups(
  diff: readonly DiffFile[],
  sources: TestSources,
  repoFiles: readonly string[],
  settings: ResolvedDependencySettings,
): { planned: PlannedLookup[]; overCap: number } | null {
  if (settings.mode !== "lookup") return { planned: [], overCap: 0 };
  const analysis = analyze(diff, sources, repoFiles, settings.allowedHosts ?? []);
  if (analysis === null) return null;
  return planLookups(analysis.added, analysis.offRegistry, settings.registries);
}

function sortSignals(signals: DependencySignal[]): DependencySignal[] {
  return signals.sort(
    (a, b) =>
      byCodeUnit(a.id, b.id) ||
      byCodeUnit(a.path, b.path) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      byCodeUnit(a.name ?? "", b.name ?? "") ||
      byCodeUnit(a.detail, b.detail),
  );
}

/**
 * Dependency safety (A13) for one change: D04 and D05 from the touched manifests and lockfiles at the merge base and at
 * HEAD, and, with lookups in the settings and their results, D01 to D03 for the added packages. Undefined when the diff
 * touches no manifest or lockfile. Signals sort by id, path, line and name; at most 200 are kept.
 */
export function checkDependencies(input: {
  diff: readonly DiffFile[];
  sources: TestSources;
  repoFiles: readonly string[];
  settings: ResolvedDependencySettings;
  lookups?: DependencyLookups;
}): { report: ReportDependencies; messages: Message[] } | undefined {
  const { settings } = input;
  const analysis = analyze(input.diff, input.sources, input.repoFiles, settings.allowedHosts ?? []);
  if (analysis === null) return undefined;
  const signals = [...analysis.signals];
  let lookups: ReportDependencies["lookups"] = "off";
  let unavailable: Message | null = null;
  if (settings.mode === "lookup" && input.lookups !== undefined) {
    const { planned, overCap } = planLookups(analysis.added, analysis.offRegistry, settings.registries);
    const results = new Map(input.lookups.results.map((result) => [`${result.ecosystem}:${result.name}`, result]));
    const headTime = input.lookups.headTime;
    let unanswered = 0;
    for (const planned1 of planned) {
      const result = results.get(`${planned1.ecosystem}:${planned1.name}`);
      if (result === undefined || result.outcome === "unavailable") {
        unanswered++;
        continue;
      }
      const at = analysis.added.filter(
        (added) => added.ecosystem === planned1.ecosystem && lookupName(added.ecosystem, added.dep) === planned1.name,
      );
      const emit = (id: DependencySignalId, detail: string) => {
        for (const added of at) {
          signals.push(
            signal(id, added.ecosystem, added.path, added.dep.line, detail, manifestNames(added.ecosystem, added.dep)),
          );
        }
      };
      if (result.outcome === "not-found") {
        emit("D01", "not found in the registry");
        continue;
      }
      const published = result.firstPublished;
      if (typeof published === "number" && headTime !== null) {
        const days = Math.max(0, Math.floor((headTime - published) / DAY_MS));
        if (days < settings.minAgeDays) {
          emit("D02", `first published ${days} days before the head commit (minimum ${settings.minAgeDays})`);
        }
      }
      if (planned1.ecosystem === "npm") {
        const downloads = result.weeklyDownloads;
        if (downloads === "unavailable") unanswered++;
        else if (typeof downloads === "number" && downloads < settings.minWeeklyDownloads) {
          emit("D03", `${downloads} downloads last week (minimum ${settings.minWeeklyDownloads})`);
        }
      }
    }
    lookups = unanswered + overCap > 0 ? "unavailable" : "done";
    if (unanswered + overCap > 0) {
      unavailable = lookupUnavailableMessage({ unanswered, overCap, planned: planned.length });
    }
  }
  sortSignals(signals);
  const kept = signals.slice(0, MAX_DEPENDENCY_SIGNALS);
  const unread = [...analysis.unread.entries()]
    .map(([path, reason]) => ({ path, reason }))
    .sort((a, b) => byCodeUnit(a.path, b.path));
  const messages: Message[] = [
    ...dependencySignalMessages(signals, settings),
    ...(unavailable === null ? [] : [unavailable]),
    ...(unread.length === 0 ? [] : [checkIncompleteMessage(unread)]),
  ];
  return {
    report: {
      checked: analysis.checked,
      lookups,
      signals: kept,
      ...(signals.length > kept.length ? { truncated: signals.length - kept.length } : {}),
      ...(unread.length === 0 ? {} : { unread: unread.slice(0, MAX_DEPENDENCY_UNREAD) }),
    },
    messages,
  };
}
