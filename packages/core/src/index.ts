export { type CheckInput, type CoverageFileInput, check } from "./check.js";
export { type ReadDiffOptions, readCoverageChunks, readDiffChunks } from "./chunkInputs.js";
export {
  ConfigError,
  isCoverageFormatSelection,
  type PharnConfig,
  parseConfig,
  parseCoverageRoot,
  parseExcludePattern,
  parseThreshold,
} from "./config.js";
export { parseCobertura } from "./coverage/cobertura.js";
export {
  type CoverageFormatChoice,
  chooseCoverageFormat,
  coverageChoiceLine,
  DETECTION_PREFIX,
  type DetectedCoverageFormat,
  detectCoverageFormat,
} from "./coverage/detect.js";
export { parseCoverage } from "./coverage/index.js";
export { createLcovReader, parseLcov, parseLcovLines, parseLcovLinesAsync } from "./coverage/lcov.js";
export { mergeCoverageMaps } from "./coverage/merge.js";
export {
  COVERAGE_FORMAT_SELECTIONS,
  COVERAGE_FORMATS,
  type CoverageFormat,
  type CoverageFormatSelection,
  type CoverageMap,
  type LineHits,
  type ParseCoverageOptions,
} from "./coverage/types.js";
export {
  COVERAGE_DISCOVERY_CANDIDATES,
  type CoverageDiscovery,
  type CoverageDiscoveryNotFound,
  chooseDiscoveredCoverage,
  coverageDiscoveryAmbiguousText,
  coverageDiscoveryLimitText,
  coverageDiscoveryLine,
  coverageNotDiscoveredText,
} from "./coverageDiscovery.js";
export {
  type CoverageEntry,
  coverageEntryList,
  type ExpandedCoverageEntry,
  expandCoverageEntries,
  MAX_COVERAGE_GLOB_FILES,
  MAX_COVERAGE_WALK_ENTRIES,
  parseCoverageEntries,
} from "./coverageEntries.js";
export {
  createUnifiedDiffReader,
  type DiffFile,
  type DiffFileStatus,
  type DiffHunk,
  type DiffLineText,
  MAX_KEPT_LINE_CHARS,
  MAX_KEPT_LINES,
  parseUnifiedDiff,
  parseUnifiedDiffLines,
  parseUnifiedDiffLinesAsync,
  type UnifiedDiffOptions,
} from "./diff/unified.js";
export { computeDiffCoverage, type DiffCoverageFile, type DiffCoverageResult } from "./diffCoverage.js";
export { compileGlob, hasGlobSyntax, matchGlob } from "./glob.js";
export { type DirEntry, type ListDir, type WalkBudget, WalkLimitError, walkGlob } from "./globWalk.js";
export {
  gitDiffArgs,
  InputError,
  type InputErrorText,
  type RawInputs,
  type ResolvedInputs,
  type ResolveInputsResult,
  resolveInputs,
} from "./inputs.js";
export { createLineSplitter, splitLines, splitLinesAsync } from "./lines.js";
export { normalizePath } from "./paths.js";
export { formatRanges, type RenderMarkdownOptions, renderMarkdown } from "./render/markdown.js";
export {
  type BuildReportInput,
  buildReport,
  emptyTestIntegrity,
  type Message,
  type MessageCode,
  type MessageLevel,
  type Report,
  type ReportDiffCoverage,
  type ReportMeta,
  type ReportMetaEvent,
  type ReportTestIntegrity,
  type TestIntegrityMode,
  type TestIntegritySignal,
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
export { parseLsTreeSizes } from "./setup/sizes.js";
export { AGENT_TOOLS, type AgentSetupSummary, type AgentTool, summarizeAgentSetup } from "./setup/summary.js";
export { isWorkflowFile, keepSignalFileText } from "./signals/signalFiles.js";
export { detectTI01 } from "./signals/ti01.js";
export { detectTI11 } from "./signals/ti11.js";
export { detectTI14, type TI14Options } from "./signals/ti14.js";
export {
  definesTests,
  deletedTestFiles,
  isTestFile,
  keepTestFileText,
  testPackageDir,
  testStem,
} from "./testFiles.js";
export {
  isTestIntegrityMode,
  type ResolvedTestIntegrityMode,
  resolveTestIntegrityMode,
  TEST_INTEGRITY_MODES,
  type TestIntegrityModeSettings,
  testIntegrityModeError,
} from "./testIntegrityMode.js";
export { VERSION } from "./version.js";
