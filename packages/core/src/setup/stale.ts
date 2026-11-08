import type { DiffFile } from "../diff/unified.js";
import type { Message, MessageCode } from "../report.js";
import type { AgentConfigSources } from "../secrets/scan.js";
import { byCodeUnit, replaceUnsafeChars } from "../text.js";
import { instructionScope, isInstructionFile } from "./instructions.js";
import type { AgentSetupFile, AgentSetupInventory } from "./scan.js";
import { type PackageScripts, parseMakeTargets, parsePackageScripts } from "./staleManifests.js";
import {
  type InstructionReference,
  isSafePathToken,
  isSafeScriptName,
  isSafeTargetName,
  scanInstructionTokens,
} from "./staleScan.js";

/**
 * Stale instructions (Horizon 2 item H3): agent instruction files that name a command, a path or a file the repository
 * does not have. SI01 a package-manager script or make target that does not exist, SI02 a path in an inline code span
 * that is not tracked, SI03 a file the instructions tell the agent to read (a Markdown link or an `@path` import) that
 * is not tracked, SI04 (info) an instruction file last changed more than 90 days before HEAD's commit while the change
 * edits a file it names. Diff-aware: a finding is kept only when the change touches the instruction file itself, or
 * removes the path, file, script or target the instruction names; without a diff nothing runs. Pure; never throws.
 */

export type StaleId = "SI01" | "SI02" | "SI03" | "SI04";
export type StaleKind = "command" | "path" | "file";

/** One stale-instruction finding as the report carries it. `token` is present only when it passes the allow-list. */
export interface StaleFinding {
  id: StaleId;
  path: string;
  line: number;
  kind: StaleKind;
  token?: string;
}

/**
 * What the CLI and the Action gather for the stale-instruction signals. `instructions` is the text of the instruction
 * files at HEAD (`readAgentConfigSources`). `packageJson` and `makefile` hold the root file's text at HEAD (null when it
 * is not tracked) and, when the change touches it, at the merge base (null when it did not exist there); absent means
 * not read, so no command is checked. `commitTimes` (SI04) holds HEAD's commit time and the last commit time of the
 * instruction files that `staleTimestampPaths` named, in seconds; absent means SI04 does not run.
 */
export interface StaleInstructionSources {
  instructions: AgentConfigSources;
  packageJson?: { head: string | null; base?: string | null };
  makefile?: { head: string | null; base?: string | null };
  commitTimes?: { head: number; files: readonly { path: string; time: number }[] };
}

/** The most instruction files read, in code-unit order of path. */
export const MAX_INSTRUCTION_FILES = 50;
/** The most findings of one id kept for one instruction file. */
export const MAX_STALE_PER_FILE = 20;
/** The most findings the report carries. */
export const MAX_STALE_FINDINGS = 100;
/** The most instruction files SI04 reads a commit time for. */
export const MAX_TIMESTAMP_FILES = 20;
/** SI04's age: an instruction file whose last commit is older than this, before HEAD's commit, is old. */
export const STALE_AGE_SECONDS = 90 * 24 * 60 * 60;

/** The instruction files the stale-instruction signals read: the inventory's instruction kinds, sorted, at most 50. */
export function staleInstructionFiles(inventory: AgentSetupInventory): AgentSetupFile[] {
  return inventory.files
    .filter(isInstructionFile)
    .sort((a, b) => byCodeUnit(a.path, b.path))
    .slice(0, MAX_INSTRUCTION_FILES);
}

/** The paths of `staleInstructionFiles`. */
export function staleInstructionPaths(inventory: AgentSetupInventory): string[] {
  return staleInstructionFiles(inventory).map((file) => file.path);
}

/** A path with its `.` and `..` segments resolved, or null when it leaves the repository root. */
function normalize(path: string): string | null {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.length === 0 ? null : out.join("/");
}

/** The tracked files, every directory that holds one, and every `/`-boundary suffix of both. */
interface RepoIndex {
  files: ReadonlySet<string>;
  dirs: ReadonlySet<string>;
  suffixes: ReadonlySet<string>;
}

function indexRepo(repoFiles: readonly string[]): RepoIndex {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const suffixes = new Set<string>();
  for (const path of repoFiles) {
    files.add(path);
    for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
      suffixes.add(path.slice(i + 1));
      const dir = path.slice(0, i);
      if (dirs.has(dir)) continue;
      dirs.add(dir);
      for (let j = dir.indexOf("/"); j !== -1; j = dir.indexOf("/", j + 1)) suffixes.add(dir.slice(j + 1));
    }
  }
  return { files, dirs, suffixes };
}

/** What the change touches and removes, from the parsed diff. */
interface DiffFacts {
  /** New paths of added, modified and renamed files. */
  touched: ReadonlySet<string>;
  /** Paths the change deletes or renames away, and the directories it empties. */
  removed: ReadonlySet<string>;
  /** Every `/`-boundary suffix of `removed`, and each path itself. */
  removedSuffixes: ReadonlySet<string>;
}

function diffFacts(diff: readonly DiffFile[], index: RepoIndex): DiffFacts {
  const touched = new Set<string>();
  const removed = new Set<string>();
  for (const file of diff) {
    if (file.status !== "deleted") touched.add(file.path);
    const gone = file.status === "deleted" ? file.path : file.status === "renamed" ? file.oldPath : null;
    if (gone === null || index.files.has(gone)) continue;
    removed.add(gone);
    // A directory the change empties is removed too.
    for (let i = gone.indexOf("/"); i !== -1; i = gone.indexOf("/", i + 1)) {
      const dir = gone.slice(0, i);
      if (!index.dirs.has(dir)) removed.add(dir);
    }
  }
  const removedSuffixes = new Set<string>();
  for (const path of removed) {
    removedSuffixes.add(path);
    for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) removedSuffixes.add(path.slice(i + 1));
  }
  return { touched, removed, removedSuffixes };
}

/** The repository paths a reference may mean: from its file's directory for `./` and `../`, else the root and that directory. */
function candidatesOf(reference: InstructionReference, dir: string): string[] {
  if (reference.relative) {
    const resolved = normalize(dir + reference.token);
    return resolved === null ? [] : [resolved];
  }
  const out: string[] = [];
  const atRoot = normalize(reference.token);
  if (atRoot !== null) out.push(atRoot);
  if (dir !== "") {
    const inDir = normalize(dir + reference.token);
    if (inDir !== null && inDir !== atRoot) out.push(inDir);
  }
  return out;
}

/** Whether a reference names a tracked file or directory: exactly, or (without `./`) as a path suffix of one. */
function exists(reference: InstructionReference, candidates: readonly string[], index: RepoIndex): boolean {
  if (candidates.some((path) => index.files.has(path) || index.dirs.has(path))) return true;
  return !reference.relative && index.suffixes.has(reference.token);
}

/** Whether the change removes what a reference names. */
function removedByChange(reference: InstructionReference, candidates: readonly string[], facts: DiffFacts): boolean {
  if (candidates.some((path) => facts.removed.has(path))) return true;
  return !reference.relative && facts.removedSuffixes.has(reference.token);
}

/**
 * Whether a token that is not removed by the change is read as a path at all. An extensionless inline-code token
 * (`packages/core`, but also `next/link` or `owner/repo`) counts only when its first segment is a tracked entry at the
 * root or in the file's directory and not a dependency name. Any token is left alone when, in every place it may mean,
 * it runs through a directory starting with `.` that is not tracked there (`pharn/.run/state.json`: usually ignored on
 * purpose), or when its name holds `.local` (`.claude/settings.local.json`: local by convention).
 */
function pathShaped(
  reference: InstructionReference,
  candidates: readonly string[],
  dir: string,
  index: RepoIndex,
  dependencies: ReadonlySet<string>,
): boolean {
  const name = reference.token.slice(reference.token.lastIndexOf("/") + 1);
  if (name.includes(".local")) return false;
  const throughIgnored = (path: string): boolean => {
    const segments = path.split("/");
    // The last segment is a directory only for a token without a known extension.
    const dirCount = reference.extensionless ? segments.length : segments.length - 1;
    let prefix = "";
    for (let i = 0; i < dirCount; i++) {
      const segment = segments[i] as string;
      prefix = prefix === "" ? segment : `${prefix}/${segment}`;
      if (segment.startsWith(".") && !index.dirs.has(prefix)) return true;
    }
    return false;
  };
  if (candidates.every(throughIgnored)) return false;
  if (reference.kind !== "path" || !reference.extensionless || reference.relative) return true;
  const first = reference.token.split("/")[0] as string;
  if (dependencies.has(first)) return false;
  return index.dirs.has(first) || index.files.has(first) || (dir !== "" && index.dirs.has(dir + first));
}

/** The text of a source file, by path; files the sources dropped or never held are absent. */
function textsOf(sources: AgentConfigSources): Map<string, string> {
  const texts = new Map<string, string>();
  if ("unavailable" in sources) return texts;
  for (const file of sources.files) texts.set(file.path, file.text);
  return texts;
}

/** A manifest side parsed: the scripts (or targets) it defines, or null when it is absent or cannot be read. */
function scriptsAt(text: string | null | undefined): PackageScripts | null {
  return typeof text === "string" ? parsePackageScripts(text) : null;
}
function targetsAt(text: string | null | undefined): ReadonlySet<string> | null {
  return typeof text === "string" ? parseMakeTargets(text) : null;
}

const directoryOf = (path: string): string => path.slice(0, path.lastIndexOf("/") + 1);

/**
 * The instruction files SI04 needs a commit time for: files the change does not touch that name, by an exact path, a
 * file the change adds, modifies or renames. At most `MAX_TIMESTAMP_FILES`, sorted. The CLI and the Action read the
 * last commit time of these files only.
 */
export function staleTimestampPaths(input: {
  instructions: AgentConfigSources;
  diff: readonly DiffFile[];
  repoFiles: readonly string[];
  agentSetup: AgentSetupInventory;
}): string[] {
  const texts = textsOf(input.instructions);
  if (texts.size === 0) return [];
  const index = indexRepo(input.repoFiles);
  const facts = diffFacts(input.diff, index);
  const out: string[] = [];
  for (const file of staleInstructionFiles(input.agentSetup)) {
    if (out.length >= MAX_TIMESTAMP_FILES) break;
    const text = texts.get(file.path);
    if (text === undefined || facts.touched.has(file.path)) continue;
    if (namedChange(scanInstructionTokens(text).references, directoryOf(file.path), index, facts) !== null) {
      out.push(file.path);
    }
  }
  return out;
}

/** The first reference that names, by an exact tracked path, a file the change touches; null when none does. */
function namedChange(
  references: readonly InstructionReference[],
  dir: string,
  index: RepoIndex,
  facts: DiffFacts,
): InstructionReference | null {
  for (const reference of references) {
    if (reference.bare) continue;
    if (candidatesOf(reference, dir).some((path) => index.files.has(path) && facts.touched.has(path))) return reference;
  }
  return null;
}

/**
 * The token a path finding carries: the repository path a `./` or `../` token resolves to, else the token as written;
 * only when every character is allowed.
 */
function referenceToken(reference: InstructionReference, candidates: readonly string[]): string | undefined {
  const token = reference.relative ? candidates[0] : reference.token;
  return token !== undefined && isSafePathToken(token) ? token : undefined;
}

/** The token a finding carries: the command in canonical form or the path, only when every character is allowed. */
function commandToken(manager: string, name: string): string | undefined {
  if (manager === "make") return isSafeTargetName(name) ? `make ${name}` : undefined;
  return isSafeScriptName(name) ? `${manager} run ${name}` : undefined;
}

/**
 * The stale-instruction findings of a change: sorted by path, line, id and token, de-duplicated, at most 20 per file
 * and id and 100 in all. `omitted` counts the findings the caps left out, per id.
 */
export function detectStaleInstructions(input: {
  sources: StaleInstructionSources;
  diff: readonly DiffFile[];
  repoFiles: readonly string[];
  agentSetup: AgentSetupInventory;
}): { findings: StaleFinding[]; omitted: Partial<Record<StaleId, number>> } {
  const { sources, diff } = input;
  const texts = textsOf(sources.instructions);
  if (texts.size === 0) return { findings: [], omitted: {} };
  const index = indexRepo(input.repoFiles);
  const facts = diffFacts(diff, index);

  const headScripts = scriptsAt(sources.packageJson?.head);
  const baseScripts = scriptsAt(sources.packageJson?.base);
  const headTargets = targetsAt(sources.makefile?.head);
  const baseTargets = targetsAt(sources.makefile?.base);
  const dependencies: ReadonlySet<string> = headScripts?.binaries ?? new Set();
  const times = sources.commitTimes;
  const timeOf = new Map<string, number>();
  if (times !== undefined) for (const entry of times.files) timeOf.set(entry.path, entry.time);

  const found: StaleFinding[] = [];
  for (const file of staleInstructionFiles(input.agentSetup)) {
    const text = texts.get(file.path);
    if (text === undefined) continue;
    const fileTouched = facts.touched.has(file.path);
    const dir = directoryOf(file.path);
    const tokens = scanInstructionTokens(text);

    // SI01: only the instruction files that apply to the whole repository are compared with the root manifests.
    if (instructionScope(file) === "") {
      for (const command of tokens.commands) {
        let stale: boolean;
        let removed: boolean;
        if (command.manager === "make") {
          if (headTargets === null) continue;
          stale = !headTargets.has(command.name);
          removed = baseTargets?.has(command.name) === true;
        } else {
          if (headScripts === null) continue;
          stale = !headScripts.scripts.has(command.name) && !headScripts.binaries.has(command.name);
          removed = baseScripts?.scripts.has(command.name) === true;
        }
        if (!stale || !(fileTouched || removed)) continue;
        const token = commandToken(command.manager, command.name);
        found.push({
          id: "SI01",
          path: file.path,
          line: command.line,
          kind: "command",
          ...(token === undefined ? {} : { token }),
        });
      }
    }

    // SI02 and SI03.
    for (const reference of tokens.references) {
      const candidates = candidatesOf(reference, dir);
      if (candidates.length === 0) continue;
      const removed = removedByChange(reference, candidates, facts);
      if (!removed && !pathShaped(reference, candidates, dir, index, dependencies)) continue;
      if (exists(reference, candidates, index) || !(fileTouched || removed)) continue;
      const token = referenceToken(reference, candidates);
      found.push({
        id: reference.kind === "path" ? "SI02" : "SI03",
        path: file.path,
        line: reference.line,
        kind: reference.kind,
        ...(token === undefined ? {} : { token }),
      });
    }

    // SI04: an old instruction file that names a file the change edits.
    const time = timeOf.get(file.path);
    if (times !== undefined && time !== undefined && !fileTouched && times.head - time > STALE_AGE_SECONDS) {
      const reference = namedChange(tokens.references, dir, index, facts);
      if (reference !== null) {
        const token = referenceToken(reference, candidatesOf(reference, dir));
        found.push({
          id: "SI04",
          path: file.path,
          line: reference.line,
          kind: reference.kind,
          ...(token === undefined ? {} : { token }),
        });
      }
    }
  }
  return capStale(found);
}

/** De-duplicate, sort, and keep at most 20 findings per file and id and 100 in all. */
function capStale(found: StaleFinding[]): { findings: StaleFinding[]; omitted: Partial<Record<StaleId, number>> } {
  const seen = new Set<string>();
  const unique = found.filter((finding) => {
    const key = `${finding.id}\0${finding.path}\0${finding.line}\0${finding.token ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort(
    (a, b) =>
      byCodeUnit(a.path, b.path) ||
      a.line - b.line ||
      byCodeUnit(a.id, b.id) ||
      byCodeUnit(a.token ?? "", b.token ?? ""),
  );
  const perFile = new Map<string, number>();
  const omitted: Partial<Record<StaleId, number>> = {};
  const findings: StaleFinding[] = [];
  for (const finding of unique) {
    const key = `${finding.id}\0${finding.path}`;
    const count = (perFile.get(key) ?? 0) + 1;
    perFile.set(key, count);
    if (count > MAX_STALE_PER_FILE || findings.length >= MAX_STALE_FINDINGS) {
      omitted[finding.id] = (omitted[finding.id] ?? 0) + 1;
      continue;
    }
    findings.push(finding);
  }
  return { findings, omitted };
}

const STALE_IDS: readonly StaleId[] = ["SI01", "SI02", "SI03", "SI04"];
/** Most locations a message names; the rest are counted. */
const MAX_NAMED_LOCATIONS = 5;

/** A repo path as one code span on one line (see report.ts `codeSpan`). */
function span(text: string): string {
  return `\`${replaceUnsafeChars(text, "�").replace(/`/g, "'")}\``;
}

/** The fixed words of each message: the subject before the locations and the advice after. */
const STALE_TEXT: Readonly<
  Record<StaleId, { code: MessageCode; level: "warn" | "info"; text: string; after: string }>
> = {
  SI01: {
    code: "SETUP_STALE_SI01",
    level: "warn",
    text: "Agent instruction files name commands that the root package.json or Makefile does not define",
    after: "An agent that runs them fails or improvises; fix the command or the instruction.",
  },
  SI02: {
    code: "SETUP_STALE_SI02",
    level: "warn",
    text: "Agent instruction files name paths that are not in the repository",
    after: "An agent that follows them looks in the wrong place; fix the path or the instruction.",
  },
  SI03: {
    code: "SETUP_STALE_SI03",
    level: "warn",
    text: "Agent instruction files tell the agent to read files that are not in the repository",
    after: "Fix the link or import, or restore the file.",
  },
  SI04: {
    code: "SETUP_STALE_SI04",
    level: "info",
    text: "Agent instruction files last changed more than 90 days before this commit name files this change edits",
    after: "Check that the instructions still describe the code.",
  },
};

/**
 * One message per stale-instruction id found, in id order: SI01 to SI03 `warn`, SI04 `info`. Each names up to 5
 * locations as `path:line` code spans, then how many more there are (the caps' omitted findings included). Fixed words,
 * paths and numbers only: never a token or any other text of an instruction file.
 */
export function staleInstructionMessages(
  findings: readonly StaleFinding[],
  omitted: Partial<Record<StaleId, number>>,
): Message[] {
  const messages: Message[] = [];
  for (const id of STALE_IDS) {
    const own = findings.filter((finding) => finding.id === id);
    if (own.length === 0) continue;
    const { code, level, text, after } = STALE_TEXT[id];
    const named = own
      .slice(0, MAX_NAMED_LOCATIONS)
      .map((finding) => span(`${finding.path}:${finding.line}`))
      .join(", ");
    const more = own.length - Math.min(own.length, MAX_NAMED_LOCATIONS) + (omitted[id] ?? 0);
    messages.push({ level, code, text: `${text}: ${named}${more > 0 ? ` and ${more} more` : ""}. ${after}` });
  }
  return messages;
}
