export {
  type AcceptDecision,
  type AcceptIgnoredReason,
  type AcceptLabelValidation,
  acceptTestIntegrity,
  carriesAcceptLabel,
  DEFAULT_ACCEPT_LABEL,
  decideAcceptLabel,
  GITHUB_LOGIN,
  ignoreAcceptLabel,
  isDefaultAcceptLabel,
  MAX_ACCEPT_LABEL_LENGTH,
  validateAcceptLabel,
  withAcceptLabel,
} from "./acceptLabel.js";
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
  type OmittedSignals,
  type Report,
  type ReportDiffCoverage,
  type ReportMeta,
  type ReportMetaEvent,
  type ReportTestChange,
  type ReportTestChanges,
  type ReportTestChangesFile,
  type ReportTestIntegrity,
  type TestIndexUnavailable,
  type TestIntegrityMode,
  type TestIntegritySignal,
  testIntegritySignalMessages,
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
export {
  coverageSourceLanguage,
  isPackageJsonFile,
  isPytestConfigFile,
  isSnapshotFile,
  isWorkflowFile,
  keepSignalFileText,
} from "./signals/signalFiles.js";
export { MAX_TEST_CHANGE_ENTRIES, summarizeTestChanges } from "./signals/testChanges.js";
export { type MatchCandidate, type MatchedPair, matchTests, type TestMatch } from "./signals/testMatch.js";
export { detectTI01 } from "./signals/ti01.js";
export { detectTI02 } from "./signals/ti02.js";
export { detectTI03 } from "./signals/ti03.js";
export { detectTI04 } from "./signals/ti04.js";
export { detectTI05 } from "./signals/ti05.js";
export { detectTI07 } from "./signals/ti07.js";
export { detectTI08 } from "./signals/ti08.js";
export { detectTI10, type TI10Options } from "./signals/ti10.js";
export { detectTI11 } from "./signals/ti11.js";
export { detectTI13 } from "./signals/ti13.js";
export { detectTI14, type TI14Options } from "./signals/ti14.js";
export { detectTI15 } from "./signals/ti15.js";
export { detectTI16 } from "./signals/ti16.js";
export {
  definesTests,
  deletedTestFiles,
  isTestFile,
  keepTestFileText,
  testPackageDir,
  testStem,
} from "./testFiles.js";
export { indexTestFile } from "./testIndex/indexTestFile.js";
export { oneLineDetail, pythonRunOutcome } from "./testIndex/pythonOutcome.js";
export { type PythonIndexPlan, planPythonIndex, pythonIndexStdin, utf8ByteLength } from "./testIndex/pythonPlan.js";
export { pythonIndexFromRaw } from "./testIndex/pythonRaw.js";
export { type PythonTestIndex, pythonTestIndexFromRun, pythonTestSourceFiles } from "./testIndex/pythonSides.js";
export {
  MAX_PYTHON_DETAIL_CHARS,
  MAX_PYTHON_RAW_ARRAY,
  PYTHON_INDEX_MAX_STDOUT_BYTES,
  PYTHON_INDEX_TIMEOUT_MS,
  PYTHON_INDEX_UNAVAILABLE_REASONS,
  type PythonIndexFile,
  type PythonIndexRun,
  type PythonIndexUnavailable,
  type PythonIndexUnavailableReason,
  type PythonSourceFile,
  type PythonSpawnResult,
} from "./testIndex/pythonTypes.js";
export type {
  TestAssertion,
  TestAssertionGuard,
  TestBlock,
  TestBlockKind,
  TestIndex,
  TestIndexRefusal,
  TestIndexRefusalReason,
  TestIndexResult,
  TestModifier,
  TestModuleMock,
} from "./testIndex/types.js";
export {
  MAX_TEST_INDEX_DEPTH,
  PYTHON_MOCK_CALLEES,
  TEST_MODIFIER_ORDER,
} from "./testIndex/types.js";
export {
  isTestIntegrityMode,
  type ResolvedTestIntegrityMode,
  resolveTestIntegrityMode,
  TEST_INTEGRITY_MODES,
  type TestIntegrityModeSettings,
  testIntegrityModeError,
} from "./testIntegrityMode.js";
export {
  isTestConfigFile,
  isUnsafeTestSourcePath,
  MAX_TEST_SOURCE_FILE_BYTES,
  MAX_TEST_SOURCE_FILES,
  MAX_TEST_SOURCE_TOTAL_BYTES,
  planTestSourceReads,
  selectTestSourcePaths,
  TEST_SOURCE_DROP_REASONS,
  type TestSourceDrop,
  type TestSourceDropReason,
  type TestSourceFile,
  type TestSourceObject,
  type TestSourceSide,
  type TestSources,
  unavailableTestSources,
} from "./testSources.js";
export { decodeTestSourceText } from "./testSourceText.js";
export { VERSION } from "./version.js";
