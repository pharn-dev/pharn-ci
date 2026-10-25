import type { TestIntegrityMode } from "./report.js";

/** The test-integrity modes, strictest first. Also the order they are named in error messages. */
export const TEST_INTEGRITY_MODES = ["block", "warn", "off"] as const satisfies readonly TestIntegrityMode[];

/** How strict a mode is: the config may only move the mode up this scale. */
const STRICTNESS: Readonly<Record<TestIntegrityMode, number>> = { off: 0, warn: 1, block: 2 };

export function isTestIntegrityMode(value: unknown): value is TestIntegrityMode {
  return typeof value === "string" && (TEST_INTEGRITY_MODES as readonly string[]).includes(value);
}

/** The error text for a value that is not a mode; `label` names the setting (an input, a flag or a config key). */
export function testIntegrityModeError(label: string, value: unknown): string {
  const got = typeof value === "string" ? `"${value}"` : String(value);
  return `${label} must be one of: ${TEST_INTEGRITY_MODES.join(", ")} (got ${got})`;
}

/** The raw settings of the mode, each absent when not given. */
export interface TestIntegrityModeSettings {
  /** The `test-integrity` input or `--test-integrity` flag. */
  input?: TestIntegrityMode;
  /** `test_integrity.mode` from `.pharn/ci.yml`, which the pull request carries. */
  config?: TestIntegrityMode;
}

export interface ResolvedTestIntegrityMode {
  mode: TestIntegrityMode;
  source: "input" | "config" | "default";
  /** The config value that was ignored because it is looser than the mode that applies; absent otherwise. */
  ignoredConfig?: TestIntegrityMode;
}

/**
 * The effective test-integrity mode. The base is the input when given, else `warn`. The config can only raise the
 * base (off < warn < block): the pull request carries `.pharn/ci.yml`, so it must never loosen its own check. A
 * looser config value is ignored and returned as `ignoredConfig`; an equal one changes nothing.
 */
export function resolveTestIntegrityMode(settings: TestIntegrityModeSettings = {}): ResolvedTestIntegrityMode {
  const base: ResolvedTestIntegrityMode =
    settings.input === undefined ? { mode: "warn", source: "default" } : { mode: settings.input, source: "input" };
  const config = settings.config;
  if (config === undefined) return base;
  if (STRICTNESS[config] > STRICTNESS[base.mode]) return { mode: config, source: "config" };
  if (STRICTNESS[config] < STRICTNESS[base.mode]) return { ...base, ignoredConfig: config };
  return base;
}
