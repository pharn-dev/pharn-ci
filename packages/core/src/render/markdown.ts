import { DEFAULT_ACCEPT_LABEL, GITHUB_LOGIN, isLiftableUnreadableError } from "../acceptLabel.js";
import { isBinaryDetail } from "../binaryDetails.js";
import type { CoverageFormat } from "../coverage/types.js";
import { messageFix } from "../fix/attach.js";
import type { PolicyUnavailableReason } from "../policy/resolved.js";
import {
  formatNumber,
  type Message,
  type Report,
  type ReportFlaky,
  type ReportInjectionSignal,
  type ReportPolicyViolation,
  type ReportStaleInstruction,
} from "../report.js";
import { summarizeAgentSetup } from "../setup/summary.js";
import { testIntegritySignal } from "../signals/registry.js";
import { replaceUnsafeChars } from "../text.js";
import { logoMarkup } from "./logo.js";

export interface RenderMarkdownOptions {
  /** Maximum file rows per table; the rest are summarized. Keeps PR comments under GitHub's size limit. */
  maxRows?: number;
  /** When true, a line before the footer says the Pharn GitHub App adds org policy, history and flaky detection. */
  appHint?: boolean;
}

const VERDICT_ICON = { pass: "✅", warn: "⚠️", fail: "❌" } as const;
const VERDICT_LABEL = { pass: "Pass", warn: "Warn", fail: "Fail" } as const;
/** The GitHub alert marker line that opens the verdict callout; fixed strings, keyed by verdict. */
const VERDICT_ALERT = { pass: "> [!TIP]", warn: "> [!WARNING]", fail: "> [!CAUTION]" } as const;
const BRAND = "🛡️";
/** Fixed words for the footer; a format outside the enum (another producer's) renders nothing. */
const COVERAGE_FORMAT_LABEL: Record<CoverageFormat, string> = { lcov: "lcov", cobertura: "cobertura" };
/** Ranges shown in one file's uncovered-lines cell; keeps a single file from making a huge table cell. */
const MAX_UNCOVERED_RANGES = 20;
const LEVEL_ICON = { info: "ℹ️", warn: "⚠️", error: "❌" } as const;
/** Where the full file list lives when the diff coverage table is cut short. */
const FULL_REPORT_NOTE =
  "_Full list in report.json: the Action's `report-path` output, or `pharn-ci check --format json`._";

/** The accept label a report was made with: the configured name, or the default one. */
function acceptLabelOf(report: Report): string {
  const configured = report.testIntegrity.acceptLabel;
  return typeof configured === "string" && configured !== "" ? configured : DEFAULT_ACCEPT_LABEL;
}

/**
 * The hint with the accept-label clause: the hint's full stop goes, and the clause (with its own full stop) follows, so
 * the words before it stay the code's `fix.hint`. `label` is the accept label, quoted as a code span; it is validated,
 * never free text.
 */
function withAcceptClause(hint: string, label: string): string {
  return `${hint.slice(0, -1)}; a reviewer who is not the PR author can record that sign-off by applying the accept label ${labelSpan(label)}.`;
}

/**
 * The two messages that are an error only for a per-file or truncation cause, judged by `isLiftableUnreadableError`, so
 * the accept-label clause never appears on the did-not-run error or on a warning.
 */
const LIFTABLE_CODES: ReadonlySet<string> = new Set([
  "TEST_INTEGRITY_INDEX_UNAVAILABLE",
  "TEST_INTEGRITY_TEXT_TRUNCATED",
]);

const TI_CODE_PREFIX = "TEST_INTEGRITY_";

/**
 * When a code's hint carries the accept-label clause: for a `TEST_INTEGRITY_<id>` code as the signal registry says
 * (always for the signals that block by default, only on a block finding for the ones that are `warn` unless an org
 * policy raises them), and only when it blocks for the two liftable messages. The label is read only when a finding
 * blocks, so the sentence is offered only where it counts.
 */
function acceptOf(code: string): "always" | "block" | undefined {
  if (LIFTABLE_CODES.has(code)) return "block";
  return code.startsWith(TI_CODE_PREFIX) ? testIntegritySignal(code.slice(TI_CODE_PREFIX.length))?.accept : undefined;
}

/**
 * The hint for a message code: its `fix.hint`, the one advice text of the code (CORE-140), or undefined for a code the
 * fix table does not hold (one from a newer producer). `label` is the report's accept label; `blocks` says whether the
 * finding or message blocks, which adds the accept-label clause to a code whose label counts only then. Fixed strings
 * only: nothing input-derived. No hint tells the reader to loosen the gate it reports on.
 */
function hintFor(code: string, label: string, blocks = false): string | undefined {
  const hint = messageFix(code)?.hint;
  if (hint === undefined) return undefined;
  const accept = acceptOf(code);
  return accept === "always" || (accept === "block" && blocks) ? withAcceptClause(hint, label) : hint;
}

/**
 * Quote the accept label as one code span on one line. Control characters become U+FFFD; the fence is one backtick
 * longer than the longest backtick run in the text, so no run in it can close the span; a space pads each side when
 * the text starts or ends with a backtick or a space (CommonMark strips one from each side).
 */
function labelSpan(text: string): string {
  const safe = replaceUnsafeChars(text, "�");
  const longest = Math.max(0, ...(safe.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = /^[` ]|[` ]$/.test(safe) ? " " : "";
  return `${fence}${pad}${safe}${pad}${fence}`;
}

/**
 * The sentence added to the hint of a TI01, TI10, TI11 or TI14 finding that git shows as binary (CORE-50). The report
 * cannot say why git showed the file as binary, so it names both causes and the fix for each, and never claims the
 * attribute is there.
 */
const BINARY_HINT_SENTENCE =
  "Git shows this file as binary: if a `-diff` or `binary` attribute in `.gitattributes` matches it, remove that attribute; if none does, the file holds non-text content such as a NUL byte, so store it as UTF-8 text.";

/**
 * Hint under the finding of a test-integrity signal id: the hint of its `TEST_INTEGRITY_<id>` code (the finding's own
 * `fix.hint`), followed by one space and the binary sentence when the registry says the id has binary findings and the
 * finding's detail is one of the fixed binary sentences.
 */
function signalHint(id: string, label: string, blocks: boolean, detail?: string): string | undefined {
  const signal = testIntegritySignal(id);
  if (signal === undefined) return undefined;
  const hint = hintFor(`${TI_CODE_PREFIX}${id}`, label, blocks);
  if (hint === undefined || detail === undefined || signal.binary !== true || !isBinaryDetail(detail)) return hint;
  return `${hint} ${BINARY_HINT_SENTENCE}`;
}

/** Most findings listed in the Test integrity section; the rest are counted. */
const MAX_FINDINGS = 20;
/** Findings listed open; the rest of the listed ones go in a collapsed `<details>`. */
const OPEN_FINDINGS = 10;

const SEVERITY_RANK = { block: 0, warn: 1, info: 2 } as const;

/** The signals block first, then warn, then info, each in report order (path, then line). Does not mutate. */
function bySeverity<T extends { severity: string }>(signals: readonly T[]): T[] {
  const rank = (s: T) => SEVERITY_RANK[s.severity as keyof typeof SEVERITY_RANK] ?? 3;
  return signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => rank(a.signal) - rank(b.signal) || a.index - b.index)
    .map(({ signal }) => signal);
}

/**
 * The signals the Test integrity section lists: blocks first, cut at MAX_FINDINGS. The 💬 Messages filter uses the
 * same list, so a signal id whose findings are all cut keeps its message there (review finding 10).
 */
function listedSignals(report: Report): Report["testIntegrity"]["signals"] {
  return bySeverity(report.testIntegrity.signals).slice(0, MAX_FINDINGS);
}

/** A `TEST_INTEGRITY_<id>` message of a signal: its findings and hints are in the Test integrity section. */
const SIGNAL_MESSAGE_CODE = /^TEST_INTEGRITY_TI\d\d$/;

const SEVERITY_ICON = { block: LEVEL_ICON.error, warn: LEVEL_ICON.warn, info: LEVEL_ICON.info } as const;

/** What the Test integrity section and summary cell say when no diff was read: nothing was checked, so nothing was found. */
const DIFF_NOT_CHECKED = "Not checked: the diff is unavailable";

/** Whether the report says the diff was unavailable (its DIFF_UNAVAILABLE message), so no signal could run on it. */
function diffUnavailable(report: Report): boolean {
  return report.messages.some((m) => m.code === "DIFF_UNAVAILABLE");
}

/**
 * The lines of the Test integrity section after its heading: one finding per signal with a hint line, or the one
 * fixed line when there is none. The fixed line has nothing from the pull request in it.
 */
function testIntegrityLines(report: Report): string[] {
  const { mode, signals } = report.testIntegrity;
  const label = acceptLabelOf(report);
  const lines: string[] = [];
  if (signals.length === 0) {
    lines.push(
      mode === "off"
        ? "Test integrity is off for this run."
        : diffUnavailable(report)
          ? `${DIFF_NOT_CHECKED}.`
          : `No test-integrity findings (mode: ${mode}).`,
    );
  } else {
    // Blocks first, so the findings that decide the verdict are never the ones collapsed or cut.
    const listed = listedSignals(report);
    const findingLines = (signal: (typeof signals)[number]) => {
      const location = signal.line === null ? code(signal.path) : code(`${signal.path}:${signal.line}`);
      const out = [
        `- ${SEVERITY_ICON[signal.severity] ?? LEVEL_ICON.info} **${inlineText(signal.id)}** ${location} — ${inlineText(signal.detail)}`,
      ];
      const hint = signalHint(signal.id, label, signal.severity === "block", signal.detail);
      if (hint !== undefined) out.push(`  - Hint: ${hint}`);
      return out;
    };
    for (const signal of listed.slice(0, OPEN_FINDINGS)) lines.push(...findingLines(signal));
    const folded = listed.slice(OPEN_FINDINGS);
    if (folded.length > 0) {
      lines.push(
        "",
        `<details><summary>${countOf(folded.length, "more finding", "more findings")}</summary>`,
        "",
        ...folded.flatMap(findingLines),
        "",
        "</details>",
        "",
      );
    }
    if (signals.length > MAX_FINDINGS) {
      lines.push(`- _…and ${signals.length - MAX_FINDINGS} more findings in report.json._`);
    }
  }
  const accepted = report.testIntegrity.accepted;
  if (acceptedShown(report) && typeof accepted === "object" && accepted !== null) {
    // The login is shown only when it has the shape of one; anything else (an older or another producer's report)
    // leaves the line without a name rather than printing free text.
    const by = typeof accepted.by === "string" && GITHUB_LOGIN.test(accepted.by) ? ` by @${accepted.by}` : "";
    // A blank line first: right after a list item, the text would read as a continuation of its hint.
    lines.push("", `Accepted via label ${labelSpan(accepted.label)}${by}`);
    // The TEST_INTEGRITY_ACCEPTED message says the same, so Messages leaves it out and its hint is shown here.
    const hint = hintFor("TEST_INTEGRITY_ACCEPTED", label);
    if (hint !== undefined) lines.push(`- Hint: ${hint}`);
  }
  return lines;
}

/** Whether the Test integrity section shows the accepted line (a report with an accept label that has a label). */
function acceptedShown(report: Report): boolean {
  const accepted = report.testIntegrity.accepted;
  return typeof accepted === "object" && accepted !== null && typeof accepted.label === "string";
}

/** A count cell: a safe non-negative integer, else 0, so a hostile cell in a hand-built report renders as 0. */
const count = (n: unknown): number => (typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : 0);

/**
 * The collapsed tests-changed table under the Test integrity section: one row per test file with its counts, at most
 * `maxRows` rows, then the number of files left out. Nothing when the report has no summary or the mode is off. Paths
 * go through `code`; every other cell is a number.
 */
function testChangesLines(report: Report, maxRows: number): string[] {
  const changes = report.testIntegrity.changes;
  if (changes === undefined || report.testIntegrity.mode === "off") return [];
  const t = changes.totals;
  const renamed = count(t.renamed) > 0 ? ` · ${count(t.renamed)} renamed` : "";
  const lines = [
    `<details><summary>Tests changed: +${count(t.added)} −${count(t.removed)} ~${count(t.modified)}${renamed}</summary>`,
    "",
    "| Test file | Added | Removed | Modified | Renamed |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const f of changes.files.slice(0, maxRows)) {
    lines.push(
      `| ${code(f.path)} | ${count(f.added)} | ${count(f.removed)} | ${count(f.modified)} | ${count(f.renamed)} |`,
    );
  }
  if (changes.files.length > maxRows) lines.push(`| _…and ${changes.files.length - maxRows} more files_ | | | | |`);
  lines.push("", "</details>", "");
  return lines;
}

/** The not-exercised paths of a report's `testIntegrity.exercise`, or null when it has none to show (or the mode is off). */
function exercisePaths(report: Report): string[] | null {
  if (report.testIntegrity.mode === "off") return null;
  const exercise: unknown = report.testIntegrity.exercise;
  if (typeof exercise !== "object" || exercise === null) return null;
  const paths: unknown = (exercise as { notExercised?: unknown }).notExercised;
  if (!Array.isArray(paths)) return null;
  const strings = paths.filter((path): path is string => typeof path === "string");
  return strings.length === 0 ? null : strings;
}

/**
 * The tests-exercise lines under the Test integrity section: one warn line with the counts and the hint, then a
 * collapsed list of the changed source files no changed test imports, at most `maxRows`, then the number left out.
 * Nothing when the report has no such file or the mode is off. Paths go through `code`; the rest is fixed words and
 * numbers.
 */
function exerciseLines(report: Report, maxRows: number): string[] {
  const paths = exercisePaths(report);
  const exercise = report.testIntegrity.exercise;
  if (paths === null || exercise === undefined) return [];
  const total = paths.length + count(exercise.truncated);
  const checked = Math.max(count(exercise.checked), total);
  const lines = [
    `- ${LEVEL_ICON.warn} **Tests exercise changes** — ${total} of ${checked} changed source ${checked === 1 ? "file" : "files"} ${total === 1 ? "is" : "are"} not imported by a test file this change adds or modifies.`,
  ];
  const hint = hintFor("TESTS_NOT_EXERCISING_CHANGES", acceptLabelOf(report));
  if (hint !== undefined) lines.push(`  - Hint: ${hint}`);
  lines.push("", `<details><summary>Not exercised: ${countOf(total, "file", "files")}</summary>`, "");
  for (const path of paths.slice(0, maxRows)) lines.push(`- ${code(path)}`);
  if (total > Math.min(paths.length, maxRows)) {
    lines.push(`- _…and ${total - Math.min(paths.length, maxRows)} more files in report.json._`);
  }
  lines.push("", "</details>", "");
  return lines;
}

/** The reasons an org policy can be unavailable; only these words reach the Policy header. */
const UNAVAILABLE_REASONS: ReadonlySet<string> = new Set([
  "no-policy",
  "installation_not_found",
  "token_invalid",
  "repo_not_in_installation",
  "rate-limited",
  "unexpected-status",
  "timeout",
  "network",
  "response-too-large",
  "invalid-response",
  "no-oidc-token",
  "no-repository",
] satisfies readonly PolicyUnavailableReason[]);

/** The rule messages of the org policy (`POLICY_P08`, `POLICY_P09`, ...). */
const POLICY_RULE_MESSAGE_CODE = /^POLICY_P\d\d$/;

/** Most violations listed in the Policy section; the rest are counted. */
const MAX_POLICY_VIOLATIONS = 20;

const hasPolicy = (report: Report): boolean => typeof report.policy === "object" && report.policy !== null;

/** The violations of a report's policy object; a hand-built report is untrusted, so anything but an array is none. */
function policyViolationsOf(report: Report): ReportPolicyViolation[] {
  const violations: unknown = report.policy?.violations;
  return Array.isArray(violations) ? (violations as ReportPolicyViolation[]) : [];
}

/** The header line of the Policy section: where the policy came from, in fixed words and a version number. */
function policyHeader(report: Report, violations: readonly ReportPolicyViolation[]): string {
  const policy = report.policy;
  const source: unknown = policy?.source;
  if (source === "app") {
    const version = policy?.version;
    return typeof version === "number" && Number.isSafeInteger(version) && version >= 1
      ? `Org policy v${version}`
      : "Org policy";
  }
  if (source === "input") return "Policy file — the pull request can edit this file, so it can only tighten the check";
  if (source === "config") return "Policy from the check config";
  if (source === "none") {
    const unavailable = violations.find((v) => v.id === "P10");
    if (unavailable !== undefined) {
      const reason =
        typeof unavailable.detail === "string"
          ? /^org policy could not be read \(([a-z_-]+)\)$/.exec(unavailable.detail)?.[1]
          : undefined;
      return reason !== undefined && UNAVAILABLE_REASONS.has(reason)
        ? `Org policy unavailable (${reason})`
        : "Org policy unavailable";
    }
  }
  return "No org policy";
}

/** The hint under a policy violation, or undefined when its rule has none. */
function policyViolationHint(violation: ReportPolicyViolation, label: string): string | undefined {
  const id = String(violation.id);
  if (id === "P01") {
    return hintFor(
      violation.detail === "no agent setup files found" ? "NO_AGENT_SETUP_FILES" : "AGENT_SETUP_EXPECTED_MISSING",
      label,
    );
  }
  if (id === "P10") return hintFor("POLICY_UNAVAILABLE", label);
  return /^P\d\d$/.test(id) ? hintFor(`POLICY_${id}`, label) : undefined;
}

/**
 * The Policy section after the Test integrity section: where the policy came from, the unavailable text when there is
 * one, then each violation (blocks first) with its hint, and the ignored-settings line.
 */
function policyLines(report: Report, maxRows: number): string[] {
  const label = acceptLabelOf(report);
  const violations = policyViolationsOf(report);
  const lines: string[] = ["### 📜 Policy", "", policyHeader(report, violations)];
  const unavailable = report.messages.find((m) => m.code === "POLICY_UNAVAILABLE");
  if (unavailable !== undefined) lines.push("", inlineText(unavailable.text));
  lines.push("");
  if (violations.length === 0) {
    if (report.policy?.source !== "none") lines.push("No policy violations.", "");
  } else {
    const listed = bySeverity(violations).slice(0, Math.min(MAX_POLICY_VIOLATIONS, maxRows));
    const violationLines = (violation: ReportPolicyViolation) => {
      const icon = SEVERITY_ICON[violation.severity as keyof typeof SEVERITY_ICON] ?? LEVEL_ICON.info;
      const id = inlineText(String(violation.id));
      const detail = inlineText(String(violation.detail));
      const out =
        typeof violation.path === "string"
          ? [
              `- ${icon} **${id}** ${violation.line === null || violation.line === undefined ? code(violation.path) : code(`${violation.path}:${violation.line}`)} — ${detail}`,
            ]
          : [`- ${icon} **${id}** — ${detail}`];
      const hint = policyViolationHint(violation, label);
      if (hint !== undefined) out.push(`  - Hint: ${hint}`);
      return out;
    };
    for (const violation of listed.slice(0, OPEN_FINDINGS)) lines.push(...violationLines(violation));
    const folded = listed.slice(OPEN_FINDINGS);
    if (folded.length > 0) {
      lines.push(
        "",
        `<details><summary>${countOf(folded.length, "more violation", "more violations")}</summary>`,
        "",
        ...folded.flatMap(violationLines),
        "",
        "</details>",
        "",
      );
    }
    if (violations.length > listed.length) {
      lines.push(`- _…and ${violations.length - listed.length} more violations in report.json._`);
    }
  }
  // E3 item 23 (policy settings): the agent settings files the rules P02 to P06 could not fully use, or did not read.
  const settingsInvalid = report.messages.find((m) => m.code === "POLICY_SETTINGS_INVALID");
  if (settingsInvalid !== undefined) {
    lines.push(
      `- ${settingsInvalid.level === "error" ? "❌" : "⚠️"} Settings: ${inlineText(settingsInvalid.text)}`,
      `  - Hint: ${hintFor("POLICY_SETTINGS_INVALID", label)}`,
    );
  }
  const ignored = report.messages.find((m) => m.code === "POLICY_OVERRIDE_IGNORED");
  if (ignored !== undefined) {
    lines.push(`- ⚠️ Ignored: ${inlineText(ignored.text)}`, `  - Hint: ${hintFor("POLICY_OVERRIDE_IGNORED", label)}`);
  }
  if (lines[lines.length - 1] !== "") lines.push("");
  return lines;
}

/** The stale-instruction ids core emits; SI04 is not emitted since CORE-144, so a hand-built SI04 entry is not rendered. */
const STALE_IDS: readonly string[] = ["SI01", "SI02", "SI03"];
/** Fixed words per kind; the token, when the report carries one, is a code span. */
const STALE_WORDS: Readonly<Record<string, (token: string) => string>> = {
  command: (token) => `command${token} is not defined in the root package.json or Makefile`,
  path: (token) => `path${token} is not in the repository`,
  file: (token) => `file${token} to read is not in the repository`,
};

/** The stale-instruction findings a report carries; a hand-built report is untrusted, so only well-formed entries count. */
function staleFindingsOf(report: Report): ReportStaleInstruction[] {
  const stale: unknown = report.setupHealth?.stale;
  if (!Array.isArray(stale)) return [];
  return (stale as ReportStaleInstruction[]).filter(
    (finding) =>
      typeof finding === "object" &&
      finding !== null &&
      STALE_IDS.includes(finding.id) &&
      typeof finding.path === "string" &&
      Number.isSafeInteger(finding.line) &&
      typeof finding.kind === "string" &&
      Object.hasOwn(STALE_WORDS, finding.kind),
  );
}

/**
 * The Instructions section: each stale-instruction finding (all warnings) as the id, `path:line` and fixed words with
 * the token as a code span, then one hint per id found. Nothing but the report's paths, numbers and tokens.
 */
function staleLines(report: Report, maxRows: number): string[] {
  const findings = staleFindingsOf(report);
  if (findings.length === 0) return [];
  const label = acceptLabelOf(report);
  const lines: string[] = ["### 📄 Instructions", ""];
  const listed = findings.slice(0, Math.min(MAX_FINDINGS, maxRows));
  const findingLine = (finding: ReportStaleInstruction): string => {
    const token = typeof finding.token === "string" ? ` ${code(finding.token)}` : "";
    const words = (STALE_WORDS[finding.kind] as (token: string) => string)(token);
    return `- ${LEVEL_ICON.warn} **${finding.id}** ${code(`${finding.path}:${finding.line}`)} — ${words}`;
  };
  for (const finding of listed.slice(0, OPEN_FINDINGS)) lines.push(findingLine(finding));
  const folded = listed.slice(OPEN_FINDINGS);
  if (folded.length > 0) {
    lines.push(
      "",
      `<details><summary>${countOf(folded.length, "more finding", "more findings")}</summary>`,
      "",
      ...folded.map(findingLine),
      "",
      "</details>",
      "",
    );
  }
  if (findings.length > listed.length) lines.push(`- _…and ${findings.length - listed.length} more in report.json._`);
  for (const id of STALE_IDS) {
    if (findings.some((finding) => finding.id === id))
      lines.push(`- ${id} hint: ${hintFor(`SETUP_STALE_${id}`, label)}`);
  }
  lines.push("");
  return lines;
}

/** The prompt-injection findings of a report; a hand-built report is untrusted, so anything but an array is none. */
function injectionSignalsOf(report: Report): ReportInjectionSignal[] {
  const signals: unknown = report.injection?.signals;
  return Array.isArray(signals) ? (signals as ReportInjectionSignal[]) : [];
}

/** The findings the Content section lists: blocks first, cut at MAX_FINDINGS (the Messages filter uses the same list). */
function listedInjection(report: Report): ReportInjectionSignal[] {
  return bySeverity(injectionSignalsOf(report)).slice(0, MAX_FINDINGS);
}

/** An `INJECTION_<id>` message of a signal: its findings and hints are in the Content section. */
const INJECTION_MESSAGE_CODE = /^INJECTION_PI\d\d$/;

/**
 * The Content section (prompt-injection scan): one line per finding, blocks first, with its hint, folded after 10 and
 * cut at 20. Only when the report has findings. The id, path and detail pass through the same escaping as every other
 * finding line.
 */
function injectionLines(report: Report): string[] {
  const signals = injectionSignalsOf(report);
  if (signals.length === 0) return [];
  const label = acceptLabelOf(report);
  const lines: string[] = ["### 🧬 Content", ""];
  const listed = listedInjection(report);
  const findingLines = (signal: ReportInjectionSignal) => {
    const icon = SEVERITY_ICON[signal.severity as keyof typeof SEVERITY_ICON] ?? LEVEL_ICON.info;
    const id = inlineText(String(signal.id));
    const location =
      typeof signal.line === "number" ? code(`${signal.path}:${signal.line}`) : code(String(signal.path));
    const out = [`- ${icon} **${id}** ${location} — ${inlineText(String(signal.detail))}`];
    const hint = /^PI\d\d$/.test(String(signal.id)) ? hintFor(`INJECTION_${signal.id}`, label) : undefined;
    if (hint !== undefined) out.push(`  - Hint: ${hint}`);
    return out;
  };
  for (const signal of listed.slice(0, OPEN_FINDINGS)) lines.push(...findingLines(signal));
  const folded = listed.slice(OPEN_FINDINGS);
  if (folded.length > 0) {
    lines.push(
      "",
      `<details><summary>${countOf(folded.length, "more finding", "more findings")}</summary>`,
      "",
      ...folded.flatMap(findingLines),
      "",
      "</details>",
      "",
    );
  }
  if (signals.length > listed.length) {
    lines.push(`- _…and ${signals.length - listed.length} more findings in report.json._`);
  }
  lines.push("");
  return lines;
}

/** The report's `flaky` object when it is well formed; a hand-built report is untrusted. */
function flakyOf(report: Report): ReportFlaky | null {
  const flaky: unknown = report.flaky;
  if (typeof flaky !== "object" || flaky === null) return null;
  const f = flaky as ReportFlaky;
  const counts = [f.testCount, f.failed, f.quarantinedFailures, f.unquarantinedFailures];
  if (!counts.every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  if (!Array.isArray(f.quarantined) || !f.quarantined.every((id) => typeof id === "string")) return null;
  return f;
}

/**
 * The Flaky section: the test and failure counts, how many failures the org's quarantine list covers, and the
 * quarantined ids that failed, collapsed. Test ids are untrusted text, so each is one code span.
 */
function flakyLines(report: Report, maxRows: number): string[] {
  const flaky = flakyOf(report);
  if (flaky === null) return [];
  const tests = countOf(flaky.testCount, "test", "tests");
  const failed =
    flaky.failed === 0
      ? "none failed"
      : `${flaky.failed} failed · ${flaky.quarantinedFailures} of ${countOf(flaky.failed, "failure", "failures")} quarantined`;
  const lines: string[] = ["### 🧫 Flaky", "", `${tests} · ${failed}`, ""];
  const ids = flaky.quarantined;
  if (ids.length > 0) {
    lines.push(`<details><summary>Quarantined failures (${ids.length})</summary>`, "");
    for (const id of ids.slice(0, maxRows)) lines.push(`- ${code(id)}`);
    if (ids.length > maxRows) lines.push(`- _…and ${ids.length - maxRows} more in report.json._`);
    lines.push("", "</details>", "");
  }
  if (flaky.failed > 0) {
    lines.push("_Test results never change the verdict: the test step fails the job for a failed test._", "");
  }
  return lines;
}

/** The signal messages of dependency safety (`DEPENDENCY_D01` to `DEPENDENCY_D05`). */
const DEPENDENCY_MESSAGE_CODE = /^DEPENDENCY_D0[1-5]$/;
/** Most findings listed in the Dependencies section; the rest are counted. */
const MAX_DEPENDENCY_FINDINGS = 20;
/** Fixed words for `dependencies.lookups`; another value renders as off. */
const LOOKUP_WORDS = {
  off: "registry lookups off",
  done: "registry lookups done",
  unavailable: "registry lookups incomplete",
} as const;

type ShownDependencySignal = {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
  name?: string;
  version?: string;
};

/** The signals of a report's dependencies object; a hand-built report is untrusted, so anything but an array is none. */
function dependencySignalsOf(report: Report): ShownDependencySignal[] {
  const signals: unknown = report.dependencies?.signals;
  return Array.isArray(signals) ? (signals as ShownDependencySignal[]) : [];
}

/** Whether the report gets a Dependencies section: a dependencies object with something added, changed or found. */
function hasDependencySection(report: Report): boolean {
  const deps = report.dependencies;
  if (typeof deps !== "object" || deps === null) return false;
  return (
    (typeof deps.checked === "number" && deps.checked > 0) ||
    dependencySignalsOf(report).length > 0 ||
    report.messages.some((m) => m.code === "DEPENDENCY_CHECK_INCOMPLETE" || m.code === "DEPENDENCY_LOOKUP_UNAVAILABLE")
  );
}

/** The dependency signal findings the section lists: blocks first, cut at the cap. */
function listedDependencySignals(report: Report, maxRows: number): ShownDependencySignal[] {
  return bySeverity(dependencySignalsOf(report)).slice(0, Math.min(MAX_DEPENDENCY_FINDINGS, Math.max(maxRows, 1)));
}

/**
 * The Dependencies section (A13): how many added or changed dependencies were checked and whether the registry was
 * looked up, then each finding (blocks first) with its package name and version when the report carries them, the hint
 * of each signal id once, and the lookup and unread lines.
 */
function dependencyLines(report: Report, maxRows: number): string[] {
  const label = acceptLabelOf(report);
  const deps = report.dependencies;
  const checked = typeof deps?.checked === "number" ? deps.checked : 0;
  const lookups = LOOKUP_WORDS[deps?.lookups as keyof typeof LOOKUP_WORDS] ?? LOOKUP_WORDS.off;
  const lines: string[] = [
    "### 📦 Dependencies",
    "",
    `${countOf(checked, "added or changed dependency", "added or changed dependencies")} checked · ${lookups}`,
    "",
  ];
  const signals = dependencySignalsOf(report);
  const listed = listedDependencySignals(report, maxRows);
  if (signals.length === 0) lines.push("No dependency findings.", "");
  const hinted = new Set<string>();
  for (const signal of listed) {
    const icon = SEVERITY_ICON[signal.severity as keyof typeof SEVERITY_ICON] ?? LEVEL_ICON.info;
    const id = inlineText(String(signal.id));
    const where = typeof signal.line === "number" ? code(`${signal.path}:${signal.line}`) : code(String(signal.path));
    const name = typeof signal.name === "string" ? ` ${code(signal.name)}` : "";
    const version = typeof signal.version === "string" ? ` ${code(signal.version)}` : "";
    lines.push(`- ${icon} **${id}** ${where}${name}${version} — ${inlineText(String(signal.detail))}`);
    if (!hinted.has(id) && /^D0[1-5]$/.test(id)) {
      hinted.add(id);
      const hint = hintFor(`DEPENDENCY_${id}`, label);
      if (hint !== undefined) lines.push(`  - Hint: ${hint}`);
    }
  }
  const more = signals.length - listed.length + (typeof deps?.truncated === "number" ? deps.truncated : 0);
  if (more > 0) lines.push(`- _…and ${countOf(more, "more finding", "more findings")} in report.json._`);
  for (const [codeName, word] of [
    ["DEPENDENCY_LOOKUP_UNAVAILABLE", "Lookups"],
    ["DEPENDENCY_CHECK_INCOMPLETE", "Not checked"],
  ] as const) {
    const message = report.messages.find((m) => m.code === codeName);
    if (message !== undefined) {
      // An unread file the pull request can cause is an error (CORE-100): the icon follows the message's level.
      const icon = message.level === "error" ? LEVEL_ICON.error : LEVEL_ICON.warn;
      lines.push(`- ${icon} ${word}: ${inlineText(message.text)}`, `  - Hint: ${hintFor(codeName, label)}`);
    }
  }
  if (lines[lines.length - 1] !== "") lines.push("");
  return lines;
}

/** Render a Report as GitHub-flavored markdown (PR comment, job summary, CLI). */
export function renderMarkdown(report: Report, options: RenderMarkdownOptions = {}): string {
  const maxRows = options.maxRows ?? 50;
  const out: string[] = [];

  const logo = logoMarkup();
  if (logo !== "") out.push(logo, "");
  out.push(`## ${BRAND} pharn-ci · ${VERDICT_ICON[report.verdict]} ${VERDICT_LABEL[report.verdict]}`, "");
  out.push(VERDICT_ALERT[report.verdict], `> **${VERDICT_LABEL[report.verdict]}** · ${overviewLine(report)}`, "");
  out.push(...summaryLines(report));

  out.push("### 🧪 Diff coverage", "");
  const dc = report.diffCoverage;
  if (dc === null) {
    out.push("_Not computed — see messages below._", "");
  } else if (dc.percent === null) {
    out.push("_No coverable lines changed._", "");
  } else {
    const threshold = dc.threshold === null ? "no threshold" : `threshold ${formatNumber(dc.threshold)}%`;
    out.push(`${coverageBar(dc.percent)} ${formatNumber(dc.percent)}%`, "");
    out.push(
      `**${formatNumber(dc.percent)}%** of changed lines covered (${dc.coveredLines}/${dc.coverableLines}, ${threshold})`,
      "",
    );
    // Open exactly when the table is what the below-threshold message points at.
    const open = report.messages.some((m) => m.code === "DIFF_COVERAGE_BELOW_THRESHOLD");
    out.push(open ? "<details open>" : "<details>", `<summary>Changed files (${dc.files.length})</summary>`, "");
    out.push("| File | Coverage | Covered | Uncovered lines |", "| --- | ---: | ---: | --- |");
    // Worst first, so the files that need tests survive truncation; files with nothing to measure go last.
    for (const f of byCoverage(dc.files).slice(0, maxRows)) {
      const pct = f.percent === null ? "—" : `${formatNumber(f.percent)}%`;
      const uncovered = f.uncoveredLines.length === 0 ? "" : uncoveredCell(f.uncoveredLines);
      out.push(`| ${code(f.path)} | ${pct} | ${f.coveredLines}/${f.coverableLines} | ${uncovered} |`);
    }
    if (dc.files.length > maxRows) out.push(`| _…and ${dc.files.length - maxRows} more files_ | | | |`);
    out.push("", "</details>", "");
    if (dc.files.length > maxRows) out.push(FULL_REPORT_NOTE, "");
  }
  const excluded = dc?.excludedFiles ?? [];
  if (excluded.length > 0) {
    out.push(
      `<details><summary>Excluded: ${excluded.length} ${excluded.length === 1 ? "file" : "files"}</summary>`,
      "",
    );
    for (const path of excluded.slice(0, maxRows)) out.push(`- ${code(path)}`);
    // report.json keeps the full list; the cap keeps the verdict inside GitHub's comment size limit.
    if (excluded.length > maxRows) out.push(`- _…and ${excluded.length - maxRows} more files_`);
    out.push("", "</details>", "");
  }

  out.push(
    "### 🔍 Test integrity",
    "",
    ...testIntegrityLines(report),
    "",
    ...exerciseLines(report, maxRows),
    ...testChangesLines(report, maxRows),
  );
  out.push(...injectionLines(report));
  if (hasPolicy(report)) out.push(...policyLines(report, maxRows));
  const stale = staleLines(report, maxRows);
  out.push(...stale);
  const dependencySection = hasDependencySection(report);
  if (dependencySection) out.push(...dependencyLines(report, maxRows));
  const flaky = flakyLines(report, maxRows);
  out.push(...flaky);

  // Before the agent setup inventory: when the Action has to drop rows to fit a size limit, the
  // reason for the verdict is never what goes.
  // A signal's message repeats what the Test integrity section lists with its hint, so it is left out here when the
  // section lists that signal id; report.json and the job's verdict still carry it. Only the listed signals count: an
  // id whose findings were all cut keeps its message.
  const listedIds = new Set(listedSignals(report).map((s) => `TEST_INTEGRITY_${s.id}`));
  // With a policy, the Policy section lists its findings, so the policy messages are left out here the same way (and
  // the agent setup messages P01 raised, when the section lists a P01 finding).
  const policyListsP01 = hasPolicy(report) && policyViolationsOf(report).some((v) => v.id === "P01");
  const inPolicySection = (code: string): boolean =>
    hasPolicy(report) &&
    (POLICY_RULE_MESSAGE_CODE.test(code) ||
      code === "POLICY_UNAVAILABLE" ||
      code === "POLICY_OVERRIDE_IGNORED" ||
      code === "POLICY_SETTINGS_INVALID" ||
      (policyListsP01 && (code === "NO_AGENT_SETUP_FILES" || code === "AGENT_SETUP_EXPECTED_MISSING")));
  // The same for the prompt-injection signals the Content section lists.
  const listedInjectionIds = new Set(listedInjection(report).map((s) => `INJECTION_${s.id}`));
  // The Dependencies section lists its findings and its lookup and unread lines the same way.
  const listedDependencyCodes = new Set(
    dependencySection ? listedDependencySignals(report, maxRows).map((s) => `DEPENDENCY_${String(s.id)}`) : [],
  );
  const inDependencySection = (code: string): boolean =>
    dependencySection &&
    ((DEPENDENCY_MESSAGE_CODE.test(code) && listedDependencyCodes.has(code)) ||
      code === "DEPENDENCY_LOOKUP_UNAVAILABLE" ||
      code === "DEPENDENCY_CHECK_INCOMPLETE");
  const messages = report.messages.filter(
    (m) =>
      !(SIGNAL_MESSAGE_CODE.test(m.code) && listedIds.has(m.code)) &&
      !(INJECTION_MESSAGE_CODE.test(m.code) && listedInjectionIds.has(m.code)) &&
      !inDependencySection(m.code) &&
      !inPolicySection(m.code) &&
      !(stale.length > 0 && m.code.startsWith("SETUP_STALE_")) &&
      !(flaky.length > 0 && m.code === "FLAKY_QUARANTINED_FAILURES") &&
      !(m.code === "TEST_INTEGRITY_ACCEPTED" && acceptedShown(report)) &&
      !(m.code === "TESTS_NOT_EXERCISING_CHANGES" && exercisePaths(report) !== null),
  );
  if (messages.length > 0) {
    out.push(`### 💬 Messages (${messages.length})`, "");
    for (const m of messages) out.push(renderMessage(m, report));
    out.push("");
  }

  const setup = report.agentSetup.files;
  out.push(`### 🤖 Agent setup (${setup.length === 0 ? "no files" : countFiles(setup.length)})`, "");
  const missingTools = report.agentSetup.missing ?? [];
  const missingLine = `Missing: ${missingTools.map(code).join(", ")}`;
  if (setup.length === 0) {
    out.push(
      "_No agent setup files found._",
      "",
      missingTools.length > 0
        ? missingLine
        : "Missing: an agent instructions file, typically `AGENTS.md` or `CLAUDE.md` at the repository root.",
      "",
    );
  } else {
    // Count, fixed words and names from the fixed tool list only: nothing input-derived. buildReport
    // already summarized the files; a report without a summary (an older producer's) is summarized here.
    const { tools } = report.agentSetup.summary ?? summarizeAgentSetup(setup);
    out.push(`Agent setup: ${setup.length} ${setup.length === 1 ? "file" : "files"} · ${tools.join(", ")}`, "");
    if (missingTools.length > 0) out.push(missingLine, "");
    out.push("<details>", `<summary>Agent setup files (${setup.length})</summary>`, "");
    out.push("| Path | Kind |", "| --- | --- |");
    for (const f of setup.slice(0, maxRows)) out.push(`| ${code(f.path)} | ${f.kind} |`);
    if (setup.length > maxRows) out.push(`| _…and ${setup.length - maxRows} more files_ | |`);
    out.push("", "</details>", "");
  }

  // The line before the rule is empty, so "---" is a thematic break and never a setext underline.
  const format = report.diffCoverage?.format;
  const formatNote =
    format !== undefined && Object.hasOwn(COVERAGE_FORMAT_LABEL, format)
      ? ` · coverage format ${COVERAGE_FORMAT_LABEL[format]}`
      : "";
  if (options.appHint === true) {
    out.push("Install the Pharn GitHub App for org policy, history and flaky detection.", "");
  }
  out.push("---", "");
  out.push(`<sub>pharn-ci ${report.tool.version} · report schema v${report.schemaVersion}${formatNote}</sub>`);
  return `${out.join("\n")}\n`;
}

const BAR_CELLS = 20;

/** A fixed-width bar for a percentage: only `▰`/`▱` and a clamped integer count, nothing input-derived. */
function coverageBar(percent: number): string {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((percent / 100) * BAR_CELLS)));
  return `\`${"▰".repeat(filled)}${"▱".repeat(BAR_CELLS - filled)}\``;
}

function countFiles(n: number): string {
  return n === 1 ? "1 file" : `${n} files`;
}

/**
 * The sentence inside the verdict callout under the heading. Fixed words, numbers and counts only: nothing input-derived, so no
 * path or message text can reach it.
 */
function overviewLine(report: Report): string {
  const dc = report.diffCoverage;
  let first: string;
  if (dc === null) first = "Diff coverage was not computed";
  else if (dc.percent === null) first = "This change adds no coverable lines";
  else if (dc.threshold === null)
    first = `Diff coverage of this change is ${formatNumber(dc.percent)}%, with no threshold set`;
  else
    first = `Diff coverage of this change is ${formatNumber(dc.percent)}% against a threshold of ${formatNumber(dc.threshold)}%`;
  const n = report.agentSetup.files.length;
  const setup =
    n === 0 ? "no agent setup files found." : n === 1 ? "1 agent setup file found." : `${n} agent setup files found.`;
  const findings = report.testIntegrity.signals;
  const parts = [first];
  if (findings.length > 0) {
    const blocking = findings.filter((s) => s.severity === "block").length;
    parts.push(
      `${countOf(findings.length, "test-integrity finding", "test-integrity findings")}${blocking > 0 ? `, ${blocking} blocking` : ""}`,
    );
  }
  const content = injectionSignalsOf(report);
  if (content.length > 0) {
    const blocking = content.filter((s) => s.severity === "block").length;
    parts.push(
      `${countOf(content.length, "content finding", "content findings")}${blocking > 0 ? `, ${blocking} blocking` : ""}`,
    );
  }
  parts.push(setup);
  return parts.join("; ");
}

/** `1 finding`, `3 findings`: a count with the word for it. */
function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The Test integrity cell of the summary table: `off`, `none (warn)`, the not-checked words when the diff was unavailable,
 * or a count of findings. Fixed words and numbers.
 */
function integrityCell(report: Report): string {
  const { mode, signals } = report.testIntegrity;
  if (mode === "off") return "off";
  if (signals.length === 0) return diffUnavailable(report) ? DIFF_NOT_CHECKED : `none (${mode})`;
  const blocking = signals.filter((s) => s.severity === "block").length;
  const icon =
    blocking > 0 ? LEVEL_ICON.error : signals.some((s) => s.severity === "warn") ? LEVEL_ICON.warn : LEVEL_ICON.info;
  return `${icon} ${countOf(signals.length, "finding", "findings")}${blocking > 0 ? `, ${blocking} blocking` : ""}`;
}

/**
 * The one-glance summary table under the verdict heading. Every cell is a fixed string, an icon, a
 * number or a count: nothing input-derived, so no path or message text can reach it.
 */
function summaryLines(report: Report): string[] {
  const dc = report.diffCoverage;
  let coverage: string;
  if (dc === null) coverage = "not computed";
  else if (dc.percent === null) coverage = "no coverable lines";
  else {
    const threshold = dc.threshold === null ? "no threshold" : `threshold ${formatNumber(dc.threshold)}%`;
    coverage = `${formatNumber(dc.percent)}% (${threshold})`;
  }
  const n = report.agentSetup.files.length;
  const setup = n === 0 ? "none" : n === 1 ? "1 file" : `${n} files`;
  if (hasPolicy(report)) {
    return [
      "| Verdict | Diff coverage | Test integrity | Agent setup | Policy |",
      "| --- | --- | --- | --- | --- |",
      `| ${VERDICT_ICON[report.verdict]} ${VERDICT_LABEL[report.verdict]} | ${coverage} | ${integrityCell(report)} | ${setup} | ${policyCell(report)} |`,
      "",
    ];
  }
  return [
    "| Verdict | Diff coverage | Test integrity | Agent setup |",
    "| --- | --- | --- | --- |",
    `| ${VERDICT_ICON[report.verdict]} ${VERDICT_LABEL[report.verdict]} | ${coverage} | ${integrityCell(report)} | ${setup} |`,
    "",
  ];
}

/** The Policy cell of the summary table: a fixed word or a count of violations. Fixed words and numbers. */
function policyCell(report: Report): string {
  const violations = policyViolationsOf(report);
  if (violations.length === 0) return report.policy?.source === "none" ? "no org policy" : "✅ none";
  const blocking = violations.filter((v) => v.severity === "block").length;
  const icon =
    blocking > 0 ? LEVEL_ICON.error : violations.some((v) => v.severity === "warn") ? LEVEL_ICON.warn : LEVEL_ICON.info;
  return `${icon} ${countOf(violations.length, "violation", "violations")}${blocking > 0 ? `, ${blocking} blocking` : ""}`;
}

function renderMessage(m: Message, report: Report): string {
  const line = `- ${LEVEL_ICON[m.level]} \`${m.code}\` ${inlineText(m.text)}`;
  const lifted = LIFTABLE_CODES.has(m.code);
  const base = hintFor(m.code, acceptLabelOf(report), lifted ? isLiftableUnreadableError(m) : m.level === "error");
  // A TEST_INTEGRITY_TI01/10/11/14 message shown here (all its findings were cut from the section) gets the binary
  // sentence when the report holds a binary finding of that id.
  const binary =
    base !== undefined &&
    report.testIntegrity.signals.some(
      (s) =>
        testIntegritySignal(s.id)?.binary === true && `${TI_CODE_PREFIX}${s.id}` === m.code && isBinaryDetail(s.detail),
    );
  const hint = binary ? `${base} ${BINARY_HINT_SENTENCE}` : base;
  return hint === undefined ? line : `${line}\n  - Hint: ${hint}`;
}

/** Ascending coverage, then path; files without coverable lines (percent null) last. Does not mutate. */
function byCoverage<T extends { path: string; percent: number | null }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => {
    if (a.percent !== b.percent) {
      if (a.percent === null) return 1;
      if (b.percent === null) return -1;
      return a.percent - b.percent;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/** Collapse ascending line numbers into ranges: [1,2,3,7] -> "1-3, 7". */
export function formatRanges(lines: readonly number[]): string {
  return rangeParts(lines).join(", ");
}

/** The uncovered-lines table cell: at most MAX_UNCOVERED_RANGES ranges, then how many are not shown. */
function uncoveredCell(lines: readonly number[]): string {
  const parts = rangeParts(lines);
  if (parts.length <= MAX_UNCOVERED_RANGES) return parts.join(", ");
  return `${parts.slice(0, MAX_UNCOVERED_RANGES).join(", ")}, …and ${parts.length - MAX_UNCOVERED_RANGES} more`;
}

function rangeParts(lines: readonly number[]): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = lines[i] as number;
    let end = start;
    while (i + 1 < lines.length && lines[i + 1] === end + 1) {
      end = lines[++i] as number;
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
    i++;
  }
  return parts;
}

// Paths come from the PR (git allows newlines in file names) and message text can carry inputs
// such as the coverage path or base ref. A line break would let them end the table row or list
// item and inject their own markdown into the PR comment, so control characters never get through.
// Control characters, line and paragraph separators, and the invisible format characters that reorder or hide text
// (zero-width marks, bidirectional overrides and isolates, the byte order mark): each becomes U+FFFD.

function code(path: string): string {
  // Pipes would break the table; backticks would break the code span. A backslash is no escape inside a code span,
  // so it is kept as written (`src/a\b.js` shows as itself, CORE-101), except a run of backslashes right before a
  // pipe: it is doubled first, so a name with "\|" cannot turn the escaped "\|" into "\\" plus a real cell separator.
  return `\`${escapeCellPipes(replaceUnsafeChars(path, "�")).replace(/`/g, "'")}\``;
}

/** Each `|` as `\|`, with the run of backslashes right before it doubled; every other character as it is. One pass. */
function escapeCellPipes(text: string): string {
  let out = "";
  let run = "";
  for (const char of text) {
    if (char === "\\") {
      run += char;
      continue;
    }
    out += char === "|" ? `${run}${run}\\|` : `${run}${char}`;
    run = "";
  }
  return out + run;
}

// Message text carries inputs a PR controls (the coverage path from .pharn/ci.yml, the base ref), so
// the characters that open links, images, emphasis, strikethrough, code spans, headings and tables
// are backslash-escaped. GitHub resolves @mentions after markdown, where a backslash no longer counts,
// so "@" gets a zero-width space after it instead (as Dependabot does). "://" and "www." are escaped
// so a bare URL is not autolinked. Issue references resolve after markdown too (CORE-124): "#1",
// "org/repo#1", "GH-1" (any case) and "org/repo/issues/1" (also "pull", "discussions") each link, and a
// link to another repository's issue adds a "mentioned this" entry there. A zero-width space goes
// before the number, which GitHub's reference matcher does not skip.
const MARKDOWN_ACTIVE = /[\\`*_[\]#!|~]/g;
const ISSUE_REFERENCE = /(#|gh-|\/(?:issues|pulls?|discussions)\/)(?=\d)/gi;

/** Message text on one line, with HTML, markdown, mentions and autolinks neutralized. */
function inlineText(text: string): string {
  return replaceUnsafeChars(text, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(MARKDOWN_ACTIVE, "\\$&")
    .replace(/@/g, "@\u200B")
    .replace(ISSUE_REFERENCE, "$1\u200B")
    .replace(/:\/\//g, ":\\/\\/")
    .replace(/(www)\./gi, "$1\\.");
}
