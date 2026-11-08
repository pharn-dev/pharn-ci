import type { Message, Report } from "../report.js";
import { type FixEntry, type FixHint, MESSAGE_FIXES, SIGNAL_FIXES } from "./table.js";

/** `Object.hasOwn` over a table, so a code like `constructor` is never read from the prototype. */
function entryOf<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * The `target` of a finding's fix: its path, or `path:line` when it has a line; nothing when it has no path (a policy
 * violation about no file). Only what the finding already names, never file text.
 */
export function fixTarget(path: string | null, line: number | null): string | undefined {
  if (path === null) return undefined;
  return line === null ? path : `${path}:${line}`;
}

/** A fresh `{ kind, hint }` for a message code; undefined for a code not in the table, which only a cast can produce. */
export function messageFix(code: string): FixHint | undefined {
  const entry = entryOf<FixEntry>(MESSAGE_FIXES, code);
  return entry === undefined ? undefined : { kind: entry.kind, hint: entry.hint };
}

/**
 * The message with its `fix` set from its code (added last, replacing an old one). A message with a code the table does
 * not hold is returned as it is.
 */
export function withMessageFix<M extends Message>(message: M): M {
  const fix = messageFix(message.code);
  if (fix === undefined) return message;
  const { fix: _old, ...rest } = message;
  return { ...rest, fix } as M;
}

/** A finding as `withFixHints` reads it. */
interface Finding {
  id: string;
  path: string | null;
  line: number | null;
  fix?: FixHint;
}

/** The finding with `fix: { kind, target?, hint }` from its signal id's entry; an id with no entry gets no `fix`. */
function withFindingFix<F extends Finding>(finding: F): F {
  const entry = entryOf<FixEntry>(SIGNAL_FIXES, finding.id);
  if (entry === undefined) return finding;
  const target = fixTarget(finding.path, finding.line);
  const { fix: _old, ...rest } = finding;
  return { ...rest, fix: { kind: entry.kind, ...(target === undefined ? {} : { target }), hint: entry.hint } } as F;
}

/**
 * The report with a `fix` on every message and every finding (`testIntegrity.signals`, `policy.violations`,
 * `setupHealth.stale`, `injection.signals`, `dependencies.signals`), each from the fixed tables. A new report; the input
 * is not changed and key order is kept, with `fix` appended.
 */
export function withFixHints(report: Report): Report {
  const next: Report = {
    ...report,
    messages: report.messages.map(withMessageFix),
    testIntegrity: { ...report.testIntegrity, signals: report.testIntegrity.signals.map(withFindingFix) },
  };
  if (report.policy !== undefined) {
    next.policy = { ...report.policy, violations: report.policy.violations.map(withFindingFix) };
  }
  if (report.setupHealth !== undefined) {
    next.setupHealth = { ...report.setupHealth, stale: report.setupHealth.stale.map(withFindingFix) };
  }
  if (report.injection !== undefined) {
    next.injection = { ...report.injection, signals: report.injection.signals.map(withFindingFix) };
  }
  if (report.dependencies !== undefined) {
    next.dependencies = { ...report.dependencies, signals: report.dependencies.signals.map(withFindingFix) };
  }
  return next;
}
