import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isDedicatedTestConfig, type TestConfigKind, testConfigKind } from "../testConfig/kinds.js";
import { type ReadOutcome, readTestConfig } from "../testConfig/read.js";
import { evaluateRules, type RuleFinding } from "../testConfig/rules.js";
import type { TestSourceSide, TestSources } from "../testSources.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A touched test-config file that was not read, and why: a drop reason, `missing`, or a reader refusal code. */
export interface UnreadConfigFile {
  path: string;
  reason: string;
}

/** What TI09 found: the signals, the touched config files it could not read, and why it did not run at all. */
export interface TI09Result {
  signals: TestIntegritySignal[];
  unavailable: UnreadConfigFile[];
  notRun: string | null;
}

interface SideLookup {
  texts: Map<string, string>;
  dropped: Map<string, string>;
}

function lookupOf(side: TestSourceSide): SideLookup {
  const texts = new Map<string, string>();
  const dropped = new Map<string, string>();
  if (!("unavailable" in side)) {
    for (const file of side.files) texts.set(file.path, file.text);
    for (const drop of side.dropped) dropped.set(drop.path, drop.reason);
  }
  return { texts, dropped };
}

/** A diff entry whose config TI09 compares. */
interface Candidate {
  kind: TestConfigKind;
  path: string;
  oldPath: string;
  added: boolean;
}

/** The modified, added and renamed entries whose path is a config kind TI09 reads. A deleted entry is never read. */
function candidatesOf(diff: readonly DiffFile[]): Candidate[] {
  const found: Candidate[] = [];
  for (const file of diff) {
    if (file.binary === true) continue;
    const kind = testConfigKind(file.path);
    if (kind === null) continue;
    if (file.status === "modified" || file.status === "added") {
      found.push({ kind, path: file.path, oldPath: file.oldPath, added: file.status === "added" });
    } else if (file.status === "renamed" && testConfigKind(file.oldPath) === kind) {
      found.push({ kind, path: file.path, oldPath: file.oldPath, added: false });
    }
  }
  return found;
}

const sideText = (side: SideLookup, path: string): { text: string } | { reason: string } => {
  const text = side.texts.get(path);
  return text === undefined ? { reason: side.dropped.get(path) ?? "missing" } : { text };
};

/**
 * TI09, a test-runner config loosened. Reads the base and head text of the touched config files (vitest, vite, jest,
 * playwright, mocha, `package.json`, pytest settings) and compares the keys of a fixed table; see `evaluateRules`. The
 * path is the head path, the line the head line of the key (null for JSON and for a key gone at head), and severity the
 * mode, or `warn` for a raised retry count or timeout and for a value that cannot be compared. A config that cannot be
 * read gives no signal and is listed in `unavailable`; when a side of the sources is unavailable and a dedicated
 * config is touched, nothing is read and `notRun` says why. A `package.json`, `pyproject.toml`, `setup.cfg` or `tox.ini`
 * in neither list of a side is skipped without a word.
 */
export function detectTI09(diff: readonly DiffFile[], sources: TestSources, mode: "block" | "warn"): TI09Result {
  const candidates = candidatesOf(diff);
  if (candidates.length === 0) return { signals: [], unavailable: [], notRun: null };

  const why = [
    ...new Set([sources.base, sources.head].flatMap((side) => ("unavailable" in side ? [side.unavailable] : []))),
  ];
  if (why.length > 0) {
    return candidates.some((candidate) => isDedicatedTestConfig(candidate.kind))
      ? { signals: [], unavailable: [], notRun: why.join("; ") }
      : { signals: [], unavailable: [], notRun: null };
  }

  const baseSide = lookupOf(sources.base);
  const headSide = lookupOf(sources.head);
  const signals: TestIntegritySignal[] = [];
  const unavailable = new Map<string, string>();

  const readSide = (side: SideLookup, candidate: Candidate, path: string): ReadOutcome | "skip" => {
    const text = sideText(side, path);
    if ("reason" in text) {
      if (!isDedicatedTestConfig(candidate.kind) && text.reason === "missing") return "skip";
      return { refused: text.reason };
    }
    return readTestConfig(candidate.kind, path, text.text);
  };

  const sorted = [...candidates].sort((a, b) => byCodeUnit(a.path, b.path) || byCodeUnit(a.oldPath, b.oldPath));
  for (const candidate of sorted) {
    const base = candidate.added ? null : readSide(baseSide, candidate, candidate.oldPath);
    const head = readSide(headSide, candidate, candidate.path);
    if (base === "skip" || head === "skip") continue;
    const refusal = base !== null && "refused" in base ? base : "refused" in head ? head : null;
    if (refusal !== null) {
      if (!unavailable.has(candidate.path)) unavailable.set(candidate.path, (refusal as { refused: string }).refused);
      continue;
    }

    let findings: RuleFinding[] = [];
    if ("container" in head) {
      const baseContainer = base !== null && "container" in base ? base.container : null;
      findings = evaluateRules(candidate.kind, baseContainer, head.container, mode);
    } else if ("notFound" in head && base !== null && "container" in base) {
      findings = [
        {
          severity: "warn",
          line: null,
          detail: "(config) cannot be compared: the config was read at base but not found at head.",
        },
      ];
    }
    for (const found of findings) {
      signals.push({
        id: "TI09",
        severity: found.severity,
        path: candidate.path,
        line: found.line,
        detail: found.detail,
        ...(found.base === undefined ? {} : { base: found.base }),
        ...(found.head === undefined ? {} : { head: found.head }),
      });
    }
  }

  return {
    signals,
    unavailable: [...unavailable]
      .map(([path, reason]) => ({ path, reason }))
      .sort((a, b) => byCodeUnit(a.path, b.path)),
    notRun: null,
  };
}
