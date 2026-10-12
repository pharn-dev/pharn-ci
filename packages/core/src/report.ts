import type { DiffCoverageFile, DiffCoverageResult } from "./diffCoverage.js";
import type { AgentSetupFile, AgentSetupInventory } from "./setup/scan.js";
import { type AgentSetupSummary, summarizeAgentSetup } from "./setup/summary.js";

/** TypeScript mirror of schema/report.v1.json. The schema is the source of truth. */
export interface Report {
  schemaVersion: "1";
  tool: { name: "pharn-ci"; version: string };
  verdict: Verdict;
  diffCoverage: ReportDiffCoverage | null;
  agentSetup: { files: AgentSetupFile[]; summary?: AgentSetupSummary };
  messages: Message[];
}

export type Verdict = "pass" | "warn" | "fail";

export interface ReportDiffCoverage {
  percent: number | null;
  threshold: number | null;
  coveredLines: number;
  coverableLines: number;
  files: DiffCoverageFile[];
  /** Sorted repo-relative paths of changed files left out by an exclusion pattern; present only when at least one was. */
  excludedFiles?: string[];
}

export type MessageLevel = "info" | "warn" | "error";

/** Stable message codes. Add new ones here and in the schema description; never rename. */
export type MessageCode =
  | "DIFF_COVERAGE_BELOW_THRESHOLD"
  | "NO_COVERABLE_CHANGES"
  | "COVERAGE_FILE_MISSING"
  | "COVERAGE_FILE_EMPTY"
  | "DIFF_UNAVAILABLE"
  | "NO_AGENT_SETUP_FILES";

export interface Message {
  level: MessageLevel;
  code: MessageCode;
  text: string;
}

export interface BuildReportInput {
  version: string;
  /** null when no coverage data was available; see `coverageFile`. */
  diffCoverage: DiffCoverageResult | null;
  /** Threshold that applies even when diff coverage could not be computed. */
  threshold: number | null;
  /** Why diff coverage is missing, when it is. */
  missing?:
    | { reason: "coverage-file-missing"; coverageFile: string }
    | { reason: "coverage-file-empty"; coverageFile: string | null }
    | { reason: "diff-unavailable"; detail: string };
  agentSetup: AgentSetupInventory;
}

export function buildReport(input: BuildReportInput): Report {
  const messages: Message[] = [];
  const dc = input.diffCoverage;

  if (dc === null) {
    const missing = input.missing ?? { reason: "diff-unavailable", detail: "no diff coverage data" };
    if (missing.reason === "coverage-file-missing") {
      // Without a threshold the coverage file is optional, so it is only a warning.
      messages.push({
        level: input.threshold === null ? "warn" : "error",
        code: "COVERAGE_FILE_MISSING",
        text: `Coverage file not found: ${missing.coverageFile}`,
      });
    } else if (missing.reason === "coverage-file-empty") {
      // Same severity as a missing file: either way there is nothing to measure against.
      const where = missing.coverageFile === null ? "The coverage report" : `Coverage file ${missing.coverageFile}`;
      messages.push({
        level: input.threshold === null ? "warn" : "error",
        code: "COVERAGE_FILE_EMPTY",
        text: `${where} contains no coverage records; check its format and that the tests wrote it.`,
      });
    } else {
      messages.push({
        level: "warn",
        code: "DIFF_UNAVAILABLE",
        text: `Diff coverage was not computed: ${missing.detail}`,
      });
    }
  } else if (dc.coverableLines === 0) {
    messages.push({
      level: "info",
      code: "NO_COVERABLE_CHANGES",
      text: "No added lines are tracked by the coverage report; nothing to measure.",
    });
  } else if (!dc.meetsThreshold && dc.threshold !== null) {
    messages.push({
      level: "error",
      code: "DIFF_COVERAGE_BELOW_THRESHOLD",
      text: `Diff coverage ${formatNumber(dc.percent ?? 0)}% is below the threshold of ${formatNumber(dc.threshold)}%.`,
    });
  }

  if (input.agentSetup.files.length === 0) {
    messages.push({
      level: "info",
      code: "NO_AGENT_SETUP_FILES",
      text: "No agent setup files (CLAUDE.md, AGENTS.md, .cursor/rules, ...) were found.",
    });
  }

  return {
    schemaVersion: "1",
    tool: { name: "pharn-ci", version: input.version },
    verdict: verdictOf(messages),
    diffCoverage:
      dc === null
        ? null
        : {
            percent: dc.percent,
            threshold: dc.threshold,
            coveredLines: dc.coveredLines,
            coverableLines: dc.coverableLines,
            files: dc.files,
            ...(dc.excludedFiles !== undefined && dc.excludedFiles.length > 0
              ? { excludedFiles: dc.excludedFiles }
              : {}),
          },
    agentSetup: { files: input.agentSetup.files, summary: summarizeAgentSetup(input.agentSetup.files) },
    messages,
  };
}

export function verdictOf(messages: readonly Message[]): Verdict {
  if (messages.some((m) => m.level === "error")) return "fail";
  if (messages.some((m) => m.level === "warn")) return "warn";
  return "pass";
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}
