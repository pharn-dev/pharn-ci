export { type CheckInput, check } from "./check.js";
export { ConfigError, isCoverageFormat, type PharnConfig, parseConfig, parseThreshold } from "./config.js";
export { parseCobertura } from "./coverage/cobertura.js";
export { parseCoverage } from "./coverage/index.js";
export { parseLcov } from "./coverage/lcov.js";
export {
  COVERAGE_FORMATS,
  type CoverageFormat,
  type CoverageMap,
  type LineHits,
  type ParseCoverageOptions,
} from "./coverage/types.js";
export { type DiffFile, type DiffFileStatus, parseUnifiedDiff } from "./diff/unified.js";
export { computeDiffCoverage, type DiffCoverageFile, type DiffCoverageResult } from "./diffCoverage.js";
export { normalizePath } from "./paths.js";
export { formatRanges, type RenderMarkdownOptions, renderMarkdown } from "./render/markdown.js";
export {
  type BuildReportInput,
  buildReport,
  type Message,
  type MessageCode,
  type MessageLevel,
  type Report,
  type ReportDiffCoverage,
  type Verdict,
  verdictOf,
} from "./report.js";
export {
  type AgentSetupFile,
  type AgentSetupInventory,
  type AgentSetupKind,
  classifySetupPath,
  SETUP_RULES,
  type SetupRule,
  scanAgentSetup,
} from "./setup/scan.js";
export { AGENT_TOOLS, type AgentSetupSummary, type AgentTool, summarizeAgentSetup } from "./setup/summary.js";
export { VERSION } from "./version.js";
