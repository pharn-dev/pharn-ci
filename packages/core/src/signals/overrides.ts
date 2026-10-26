import type { SignalOverrides } from "../policy/resolved.js";
import type { PolicySeverity, PolicySignalId } from "../policy/types.js";
import type { OmittedSignals, TestIntegrityMode, TestIntegritySignal } from "../report.js";

/** How hard a severity bites, for raising: `off` is the lowest. */
const RANK: Readonly<Record<PolicySeverity, number>> = { off: 0, info: 1, warn: 2, block: 3 };

export interface AppliedOverrides {
  signals: TestIntegritySignal[];
  omitted: OmittedSignals[];
  /** The ids whose policy-file severity was lower than the computed one, so it was not applied; each once, sorted. */
  lowered: PolicySignalId[];
}

/**
 * Per-signal severities from a policy, applied to the findings the detectors computed. `replace` (an app policy) sets
 * the severity of every finding of an id; `off` drops the findings and their omitted-count entries, so their message
 * goes too. `raise` (a policy file) can only raise: a severity lower than the computed one is not applied, and its id
 * is returned once in `lowered` when at least one finding of that id exists. Mode `warn` then caps `block` to `warn`.
 * Mode `off` never reaches this function: it has no findings. Pure; the order of the findings is kept.
 */
export function applySignalOverrides(
  signals: readonly TestIntegritySignal[],
  omitted: readonly OmittedSignals[],
  overrides: SignalOverrides,
  mode: TestIntegrityMode,
): AppliedOverrides {
  const severities = overrides.severities as Readonly<Record<string, PolicySeverity | undefined>>;
  // Under replace, an id set to off loses its findings and its omitted-count entries, whether or not a finding is kept.
  const dropped = new Set<string>(
    overrides.kind === "replace" ? Object.keys(severities).filter((id) => severities[id] === "off") : [],
  );
  const lowered = new Set<PolicySignalId>();
  const kept: TestIntegritySignal[] = [];
  for (const signal of signals) {
    if (dropped.has(signal.id)) continue;
    const wanted = Object.hasOwn(severities, signal.id) ? severities[signal.id] : undefined;
    let severity: PolicySeverity = signal.severity;
    if (wanted !== undefined) {
      if (overrides.kind === "replace") {
        severity = wanted;
      } else if (RANK[wanted] > RANK[severity]) {
        severity = wanted;
      } else if (RANK[wanted] < RANK[severity]) {
        lowered.add(signal.id as PolicySignalId);
      }
    }
    if (mode === "warn" && severity === "block") severity = "warn";
    // `off` never reaches here: replace drops it, and raise never goes below the computed severity.
    kept.push(
      severity === signal.severity ? signal : { ...signal, severity: severity as TestIntegritySignal["severity"] },
    );
  }
  return {
    signals: kept,
    omitted: omitted.filter((entry) => !dropped.has(entry.id)),
    lowered: [...lowered].sort(),
  };
}
