import {
  type AgentConfigSources,
  agentConfigSecretPaths,
  agentInstructionPaths,
  type CheckInput,
  consistencySeverity,
  DEPENDENCY_SOURCE_LIMITS,
  type DependencySettingsLayers,
  type DiffFile,
  type PolicySettingsSources,
  type PythonIndexRun,
  type PythonSourceFile,
  type PythonTestIndex,
  parseLsTreeSizes,
  parseLsTreeSymlinks,
  policySettingsPaths,
  pythonNotFoundStopsComparison,
  type ResolvedPolicy,
  resolveDependencySettings,
  resolveTestIntegrityMode,
  type StaleInstructionSources,
  scanAgentSetup,
  selectDependencyPaths,
  selectSelfModificationPaths,
  type TestIntegrityModeSettings,
  type TestSources,
  unavailableTestSources,
} from "@pharn-ci/core";
import { readAgentConfigSources, readPolicySettingsSources } from "./agentConfigSources.js";
import { firstLine } from "./gitBlobs.js";
import { indexPythonTests } from "./pythonIndex.js";
import { indexPythonTestSources } from "./pythonSources.js";
import type { RunRevisions } from "./revisions.js";
import { readStaleInstructionSources } from "./staleInstructions.js";
import { readTestSources } from "./testSources.js";

/** The git calls `gatherSources` makes, and the Python test index it runs. */
export interface GatherSourcesDeps {
  /** Runs git with args; resolves stdout, rejects with stderr on failure. */
  git(args: string[]): Promise<string>;
  /** Runs git with `input` on its stdin and resolves its stdout as bytes. Absent: no committed file is read. */
  gitBatch?: ((args: string[], input: string) => Promise<Uint8Array>) | undefined;
  /** Indexes `.py` test files. Absent: `indexPythonTests`, which runs the interpreter found on PATH. */
  indexPython?: ((files: readonly PythonSourceFile[]) => Promise<PythonIndexRun>) | undefined;
}

/**
 * Whether the checkout's HEAD is the head under review: `head` when it is (the CLI always; the Action whenever the base
 * resolved in the checkout or there is no base); `unknown` when it may not be (the Action with a compare-API diff, a
 * failed compare, or a `pull_request_target` checkout of the base); `pr-number` when it is not (the Action's PR-number
 * mode). Only `head` lets the committed files at HEAD be read.
 */
export type HeadCheckout = "head" | "unknown" | "pr-number";

export interface GatherSourcesOptions {
  diff: CheckInput["diff"];
  /**
   * The run's base (the revision a parsed diff was taken against in local git) and HEAD, resolved once for every reader;
   * undefined when the diff did not come from local git.
   */
  revisions: RunRevisions | undefined;
  checkout: HeadCheckout;
  repoFiles: readonly string[];
  testIntegrityMode: TestIntegrityModeSettings | undefined;
  dependencySettings: DependencySettingsLayers | undefined;
  policy: ResolvedPolicy | undefined;
  /** The caller's normal log channel (CLI stderr, Action `info`): one line each, never the text of a file. */
  log(line: string): void;
  /** The caller's warning channel (CLI stderr, Action `warning`). */
  warn(line: string): void;
}

/** The optional `CheckInput` fields read from the repository: absent means not gathered. */
export interface GatheredSources {
  repoFileBytes?: Map<string, number>;
  testSources?: TestSources;
  pythonTestIndex?: PythonTestIndex;
  agentConfigSources?: AgentConfigSources;
  agentInstructionSources?: AgentConfigSources;
  policySettingsSources?: PolicySettingsSources;
  selfModificationSources?: TestSources;
  staleInstructionSources?: StaleInstructionSources;
  dependencySources?: TestSources;
}

/**
 * The optional `CheckInput` fields that come from the repository, the diff and the settings, decided once for the CLI
 * and the Action (CORE-136). Every read is of committed git objects (or `git ls-tree` of HEAD), never the working tree,
 * and nothing read is logged: a log line names a reason, never file text. Each field is gathered only when the check
 * that reads it can run:
 *
 * - `repoFileBytes` (empty agent setup files): `git ls-tree` of HEAD, unless HEAD is not the head (PR-number mode).
 * - `testSources` and `pythonTestIndex` (test integrity): unless the mode is off; read at the base and at HEAD from a
 *   local diff only, otherwise an unavailable marker that says why.
 * - `agentConfigSources` (secret scan A7), `agentInstructionSources` (P07, under a policy with P07 in effect) and
 *   `policySettingsSources` (P02 to P06, under an app or file policy): read at HEAD when the checkout is the head,
 *   whether or not there is a diff; otherwise an unavailable marker.
 * - `selfModificationSources` (P13, under an app or file policy) and `dependencySources` (A13, unless the mode is
 *   `never`): read at the base and at HEAD from a local diff only; empty when the diff touches none of their files.
 * - `staleInstructionSources` (SI01 to SI03): only with a local diff.
 *
 * Without a batch git runner nothing but `testSources` (an unavailable marker) and `repoFileBytes` is gathered.
 */
export async function gatherSources(deps: GatherSourcesDeps, options: GatherSourcesOptions): Promise<GatheredSources> {
  const out: GatheredSources = {};
  const lsTree = options.checkout === "pr-number" ? null : await readHeadTree(deps, options.warn);
  if (lsTree !== null) out.repoFileBytes = parseLsTreeSizes(lsTree);

  const testSources = await gatherTestSources(deps, options);
  if (testSources !== undefined) {
    out.testSources = testSources;
    // The Python test files of the sources, indexed by one interpreter run; nothing runs for JS/TS-only changes.
    const pythonTestIndex = await indexPythonTestSources(testSources, deps.indexPython ?? indexPythonTests);
    if (pythonTestIndex !== undefined) {
      out.pythonTestIndex = pythonTestIndex;
      if (!pythonTestIndex.available) {
        // With a modified .py test file and no interpreter, TI02 and TI05 did not run at all (an error in mode block).
        options.log(
          "parsed" in options.diff && pythonNotFoundStopsComparison(options.diff.parsed, pythonTestIndex)
            ? "pharn-ci: no Python interpreter was found (python-not-found), so TI02 and TI05 did not run"
            : `pharn-ci: the Python test index is unavailable (${pythonTestIndex.reason}), so .py test files are not compared`,
        );
      }
    }
  }
  const agentConfigSources = await gatherAgentConfigSources(deps, options);
  if (agentConfigSources !== undefined) out.agentConfigSources = agentConfigSources;
  const agentInstructionSources = await gatherAgentInstructionSources(deps, options);
  if (agentInstructionSources !== undefined) out.agentInstructionSources = agentInstructionSources;
  const policySettingsSources = await gatherPolicySettingsSources(deps, options, lsTree);
  if (policySettingsSources !== undefined) out.policySettingsSources = policySettingsSources;
  const selfModificationSources = await gatherSelfModificationSources(deps, options);
  if (selfModificationSources !== undefined) out.selfModificationSources = selfModificationSources;
  const staleInstructionSources = await gatherStaleInstructionSources(deps, options);
  if (staleInstructionSources !== undefined) out.staleInstructionSources = staleInstructionSources;
  const dependencySources = await gatherDependencySources(deps, options);
  if (dependencySources !== undefined) out.dependencySources = dependencySources;
  return out;
}

/**
 * True only when git says HEAD has no commit the base lacks: the merge base of the base and HEAD is HEAD itself, so
 * the base is HEAD or a descendant of it. Asked with `rev-parse` and `merge-base` (the run's revisions), which the
 * shared git runner allows (it refuses `rev-list`). Only two printed commit ids that are equal count; any other
 * answer, or a failed call, is unknown and false: the diff is then used as it is.
 */
export async function headIsInBase(revisions: RunRevisions): Promise<boolean> {
  const resolved = await revisions.resolve();
  return !("unresolved" in resolved) && resolved.mergeBase === resolved.head;
}

/**
 * The raw `git ls-tree` of HEAD, for the file sizes (an empty agent setup file) and the tracked symbolic links (policy
 * settings); null, with one warning, when git fails. Optional: without it the check still runs.
 */
async function readHeadTree(
  deps: Pick<GatherSourcesDeps, "git">,
  warn: (line: string) => void,
): Promise<string | null> {
  try {
    return await deps.git(["ls-tree", "-r", "-l", "-z", "--full-tree", "HEAD"]);
  } catch (err) {
    warn(`pharn-ci: git ls-tree failed, so empty agent setup files are not reported: ${firstLine(err)}`);
    return null;
  }
}

/** Why the files of the change cannot be read at the base and at HEAD, or null when they can. */
function baseAndHeadUnread(options: GatherSourcesOptions, gitBatch: GatherSourcesDeps["gitBatch"]): string | null {
  if (options.checkout === "pr-number") return "pr-number mode: the diff came from the GitHub API";
  if ("text" in options.diff) return "the diff came from the GitHub compare API";
  if ("unavailable" in options.diff) return "the diff is unavailable";
  if (gitBatch === undefined || options.revisions === undefined) return "reading git objects is not available";
  return null;
}

/** Why the committed files at HEAD are not read (`what` names them), or null when the checkout is the head. */
function headUnread(options: GatherSourcesOptions, what: string): string | null {
  if (options.checkout === "head") return null;
  if (options.checkout === "pr-number") {
    return `pr-number mode: the checkout is not the pull request head, so its committed ${what} were not read`;
  }
  return "text" in options.diff
    ? "the diff came from the GitHub compare API, so the checkout may not be the pull request head"
    : "the diff is unavailable, so the checkout may not be the pull request head";
}

/** An app or file policy with a document: the policy whose settings rules (P02 to P06) and P13 can run. */
function policyDocumentInForce(policy: ResolvedPolicy | undefined): boolean {
  return policy !== undefined && (policy.source === "app" || policy.source === "file") && policy.document !== null;
}

const emptySources = (): TestSources => ({ base: { files: [], dropped: [] }, head: { files: [], dropped: [] } });

/**
 * The text of the test and test-config files the change touches, for the base-and-head signals; undefined when the
 * effective test-integrity mode is off (nothing is gathered).
 */
async function gatherTestSources(
  deps: GatherSourcesDeps,
  options: GatherSourcesOptions,
): Promise<TestSources | undefined> {
  if (resolveTestIntegrityMode(options.testIntegrityMode).mode === "off") return undefined;
  const { diff, revisions } = options;
  const { gitBatch } = deps;
  const unread = baseAndHeadUnread(options, gitBatch);
  if (unread !== null || gitBatch === undefined || revisions === undefined || !("parsed" in diff)) {
    return unavailableTestSources(unread ?? "reading git objects is not available");
  }
  const sources = await readTestSources({ gitBatch }, { revisions, diff: diff.parsed });
  if ("unavailable" in sources.base) {
    options.log(
      `pharn-ci: could not read the test and test-config files from git, so they are not compared: ${sources.base.unavailable}`,
    );
  }
  return sources;
}

/**
 * The committed text of the agent config files, for the secret scan (check A7); undefined when there is no batch git
 * runner or no tracked path is a scannable agent config file (nothing is read, nothing is said).
 */
async function gatherAgentConfigSources(
  deps: GatherSourcesDeps,
  options: GatherSourcesOptions,
): Promise<AgentConfigSources | undefined> {
  const { gitBatch } = deps;
  if (gitBatch === undefined) return undefined;
  const paths = agentConfigSecretPaths(scanAgentSetup(options.repoFiles));
  if (paths.length === 0) return undefined;
  const unread = headUnread(options, "agent config files");
  if (unread !== null) return { unavailable: unread };
  const sources = await readAgentConfigSources({ gitBatch }, paths);
  if ("unavailable" in sources) {
    options.log(
      `pharn-ci: could not read the agent config files from git, so they are not scanned for secrets: ${sources.unavailable}`,
    );
  }
  return sources;
}

/**
 * The committed text of the agent instruction files, for org-policy rule P07, in batch calls of their own so check A7
 * never sees Markdown; undefined without a batch git runner, a policy with P07 in effect, or a directory with two
 * instruction files.
 */
async function gatherAgentInstructionSources(
  deps: GatherSourcesDeps,
  options: GatherSourcesOptions,
): Promise<AgentConfigSources | undefined> {
  const { gitBatch } = deps;
  if (gitBatch === undefined) return undefined;
  if (options.policy === undefined || consistencySeverity(options.policy).severity === null) return undefined;
  const paths = agentInstructionPaths(scanAgentSetup(options.repoFiles));
  if (paths.length === 0) return undefined;
  const unread = headUnread(options, "agent instruction files");
  if (unread !== null) return { unavailable: unread };
  const sources = await readAgentConfigSources({ gitBatch }, paths);
  if ("unavailable" in sources) {
    options.log(
      `pharn-ci: could not read the agent instruction files from git, so P07 did not compare them: ${sources.unavailable}`,
    );
  }
  return sources;
}

/**
 * The committed agent settings and MCP files for the org-policy rules P02 to P06 (E3 item 23); undefined without a batch
 * git runner or an app or file policy with a document.
 */
async function gatherPolicySettingsSources(
  deps: GatherSourcesDeps,
  options: GatherSourcesOptions,
  lsTree: string | null,
): Promise<PolicySettingsSources | undefined> {
  const { gitBatch } = deps;
  const { policy } = options;
  if (gitBatch === undefined || policy === undefined || policy.document === null) return undefined;
  if (!policyDocumentInForce(policy)) return undefined;
  const unread = headUnread(options, "agent settings files");
  if (unread !== null) return { unavailable: unread };
  const paths = policySettingsPaths(options.repoFiles, policy.document);
  if (paths.length === 0) return { files: [], dropped: [] };
  const sources = await readPolicySettingsSources(
    { gitBatch },
    paths,
    lsTree === null ? null : parseLsTreeSymlinks(lsTree),
  );
  if ("unavailable" in sources) {
    options.log(
      `pharn-ci: could not read the agent settings files from git, so they are not checked against the org policy: ${sources.unavailable}`,
    );
  }
  return sources;
}

/**
 * The base and head text of the agent settings, MCP, workflow and CODEOWNERS files the change touches, for org-policy
 * rule P13; undefined without a batch git runner or an app or file policy with a document. Without a local diff the
 * sources are unavailable (P13 then fails closed). P13 also needs a pull request, so in the CLI core reads none of it.
 */
async function gatherSelfModificationSources(
  deps: GatherSourcesDeps,
  options: GatherSourcesOptions,
): Promise<TestSources | undefined> {
  const { gitBatch } = deps;
  if (gitBatch === undefined || !policyDocumentInForce(options.policy)) return undefined;
  return readChangedSources(deps, options, {
    select: selectSelfModificationPaths,
    what: "the agent settings, MCP, workflow and CODEOWNERS files",
    effect: "rule P13 could not compare them",
  });
}

/**
 * The base and head text of the manifests and lockfiles the change touches, for dependency safety (A13), with the
 * dependency caps; undefined when the effective mode is `never` or there is no batch git runner.
 */
async function gatherDependencySources(
  deps: GatherSourcesDeps,
  options: GatherSourcesOptions,
): Promise<TestSources | undefined> {
  if (resolveDependencySettings(options.dependencySettings).mode === "never") return undefined;
  if (deps.gitBatch === undefined) return undefined;
  return readChangedSources(deps, options, {
    select: (files) => selectDependencyPaths(files, options.repoFiles),
    what: "the manifests and lockfiles",
    effect: "dependency safety could not compare them",
    limits: DEPENDENCY_SOURCE_LIMITS,
  });
}

/** The selected files of a local diff at the base and at HEAD; empty sources, and no git call, when none is selected. */
async function readChangedSources(
  deps: GatherSourcesDeps,
  options: GatherSourcesOptions,
  read: {
    select: (files: readonly DiffFile[]) => { base: string[]; head: string[] };
    what: string;
    effect: string;
    limits?: typeof DEPENDENCY_SOURCE_LIMITS;
  },
): Promise<TestSources> {
  const { diff, revisions } = options;
  const { gitBatch } = deps;
  const unread = baseAndHeadUnread(options, gitBatch);
  if (unread !== null || gitBatch === undefined || revisions === undefined || !("parsed" in diff)) {
    return unavailableTestSources(unread ?? "reading git objects is not available");
  }
  const selected = read.select(diff.parsed);
  if (selected.base.length === 0 && selected.head.length === 0) return emptySources();
  const sources = await readTestSources(
    { gitBatch },
    { revisions, diff: diff.parsed, select: read.select, limits: read.limits },
  );
  if ("unavailable" in sources.base) {
    options.log(`pharn-ci: could not read ${read.what} from git, so ${read.effect}: ${sources.base.unavailable}`);
  }
  return sources;
}

/**
 * What the stale-instruction signals (SI01 to SI03) read; undefined without a batch git runner or a local diff. The
 * reads are of committed objects in calls of their own.
 */
async function gatherStaleInstructionSources(
  deps: GatherSourcesDeps,
  options: GatherSourcesOptions,
): Promise<StaleInstructionSources | undefined> {
  const { gitBatch } = deps;
  const { diff, revisions } = options;
  if (gitBatch === undefined || options.checkout === "pr-number" || !("parsed" in diff)) return undefined;
  const sources = await readStaleInstructionSources(
    { gitBatch },
    { repoFiles: options.repoFiles, diff: diff.parsed, revisions },
  );
  if (sources !== undefined && "unavailable" in sources.instructions) {
    options.log(
      `pharn-ci: could not read the agent instruction files from git, so stale instructions are not checked: ${sources.instructions.unavailable}`,
    );
  }
  return sources;
}
