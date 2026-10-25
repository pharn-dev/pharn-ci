import { deselectionPairs, gainedPairs, pairText, splitAddopts } from "./addopts.js";
import type { TestConfigKind } from "./kinds.js";
import { entriesOf, type ListMode, narrowedList, widenedList } from "./listCompare.js";
import {
  type ConfigValue,
  cutDetail,
  cutValue,
  keyText,
  type Lookup,
  lookup,
  MAX_CONFIG_VALUE_DEPTH,
  printValue,
} from "./value.js";

/** One loosened setting found by comparing a config at base and at head. Severity is already resolved for the mode. */
export interface RuleFinding {
  severity: "block" | "warn";
  /** The 1-based head line of the key, or null (JSON, a key gone at head, or the config as a whole). */
  line: number | null;
  detail: string;
  base?: string;
  head?: string;
}

type RuleKind =
  | "thresholds"
  | "jestThresholds"
  | "lowered"
  | "turnedOn"
  | "turnedOff"
  | "increased"
  | "bail"
  | "raised"
  | "addedOrChanged"
  | "narrowed"
  | "widened"
  | "addopts";

/** One settings key and how a change to it is judged. A rule is `mode` severity unless `warn` is set. */
interface KeyRule {
  path: readonly string[];
  rule: RuleKind;
  warn?: true;
  list?: ListMode;
  /** The values of this key are lists written as one string, split on whitespace (pytest). */
  split?: true;
}

const rule = (path: string, kind: RuleKind, extra: Partial<KeyRule> = {}): KeyRule => ({
  path: path.split("."),
  rule: kind,
  ...extra,
});

const VITEST_RULES: readonly KeyRule[] = [
  rule("coverage.thresholds", "thresholds"),
  rule("coverage.lines", "lowered"),
  rule("coverage.functions", "lowered"),
  rule("coverage.branches", "lowered"),
  rule("coverage.statements", "lowered"),
  rule("coverage.exclude", "widened", { list: "glob" }),
  rule("include", "narrowed", { list: "glob" }),
  rule("exclude", "widened", { list: "glob" }),
  rule("projects", "narrowed", { list: "glob" }),
  rule("passWithNoTests", "turnedOn"),
  rule("allowOnly", "turnedOn"),
  rule("retry", "increased", { warn: true }),
  rule("bail", "bail"),
  rule("testTimeout", "raised", { warn: true }),
  rule("hookTimeout", "raised", { warn: true }),
];

const WORKSPACE_RULES: readonly KeyRule[] = [rule("projects", "narrowed", { list: "glob" })];

const JEST_RULES: readonly KeyRule[] = [
  rule("coverageThreshold", "jestThresholds"),
  rule("coveragePathIgnorePatterns", "widened", { list: "regex" }),
  rule("testPathIgnorePatterns", "widened", { list: "regex" }),
  rule("testMatch", "narrowed", { list: "glob" }),
  rule("testRegex", "narrowed", { list: "regex" }),
  rule("projects", "narrowed", { list: "glob" }),
  rule("passWithNoTests", "turnedOn"),
  rule("bail", "bail"),
  rule("testTimeout", "raised", { warn: true }),
];

const PLAYWRIGHT_RULES: readonly KeyRule[] = [
  rule("retries", "increased", { warn: true }),
  rule("testIgnore", "widened", { list: "glob" }),
  rule("testMatch", "narrowed", { list: "glob" }),
  rule("grep", "addedOrChanged"),
  rule("grepInvert", "addedOrChanged"),
  rule("forbidOnly", "turnedOff"),
];

const MOCHA_RULES: readonly KeyRule[] = [
  rule("spec", "narrowed", { list: "glob" }),
  rule("ignore", "widened", { list: "glob" }),
  rule("grep", "addedOrChanged"),
  rule("fgrep", "addedOrChanged"),
  rule("bail", "turnedOn"),
  rule("retries", "increased", { warn: true }),
  rule("timeout", "raised", { warn: true }),
];

const PYTEST_RULES: readonly KeyRule[] = [
  rule("addopts", "addopts"),
  rule("testpaths", "narrowed", { list: "testpaths", split: true }),
  rule("python_files", "narrowed", { list: "glob", split: true }),
  rule("python_classes", "narrowed", { list: "glob", split: true }),
  rule("python_functions", "narrowed", { list: "glob", split: true }),
  rule("norecursedirs", "widened", { list: "glob", split: true }),
];

/** The keys a config that is new at head (no container at base) is judged on. */
const NEW_CONFIG_KEYS: ReadonlySet<string> = new Set(["passWithNoTests", "allowOnly", "retry", "retries"]);

interface Family {
  rules: readonly KeyRule[];
  prefix: readonly string[];
  mocha: boolean;
}

function familyOf(kind: TestConfigKind): Family {
  switch (kind) {
    case "vitest":
    case "vite":
      return { rules: VITEST_RULES, prefix: ["test"], mocha: false };
    case "vitest-workspace":
      return { rules: WORKSPACE_RULES, prefix: [], mocha: false };
    case "jest":
      return { rules: JEST_RULES, prefix: [], mocha: false };
    case "package-json":
      return { rules: JEST_RULES, prefix: ["jest"], mocha: false };
    case "playwright":
      return { rules: PLAYWRIGHT_RULES, prefix: [], mocha: false };
    case "mocha":
      return { rules: MOCHA_RULES, prefix: [], mocha: true };
    default:
      return { rules: PYTEST_RULES, prefix: [], mocha: false };
  }
}

interface Context {
  base: ConfigValue | null;
  head: ConfigValue;
  mode: "block" | "warn";
  family: Family;
}

const UNSET = "(unset)";

/** A value as it is written in a detail: compact, cut, or `(unset)`. */
const shown = (value: ConfigValue | null): string => (value === null ? UNSET : cutValue(printValue(value)));

function foundValue(look: Lookup): ConfigValue | null {
  return typeof look === "object" ? look.found.value : null;
}

function lineOf(look: Lookup): number | null {
  return typeof look === "object" ? look.found.line : null;
}

function finding(
  severity: "block" | "warn",
  line: number | null,
  detail: string,
  base: ConfigValue | null,
  head: ConfigValue | null,
): RuleFinding {
  return {
    severity,
    line,
    detail: cutDetail(detail),
    ...(base === null ? {} : { base: shown(base) }),
    ...(head === null ? {} : { head: shown(head) }),
  };
}

/** The comparison of one key: a finding whose severity is the rule's (mode or warn). */
function compared(ctx: Context, key: KeyRule, text: string, b: Lookup, h: Lookup): RuleFinding {
  return finding(key.warn === true ? "warn" : ctx.mode, lineOf(h), text, foundValue(b), foundValue(h));
}

const cannotOpaque = (keyName: string, head: ConfigValue) =>
  `${keyName} cannot be compared: the head value ${cutValue(printValue(head))} is not a literal.`;
const cannotUnknown = (keyName: string) =>
  `${keyName} cannot be compared: the head value is not known (a spread or mergeConfig may set it).`;

/** Mocha and vitest durations in milliseconds: a number, or a string such as `2s`; null for anything else. */
function toMilliseconds(value: ConfigValue): number | null {
  if (value.type === "number") return value.value;
  if (value.type !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(value.value.trim());
  if (match === null) return null;
  const factor = { ms: 1, s: 1000, m: 60000, h: 3600000 }[(match[2] ?? "ms") as "ms" | "s" | "m" | "h"];
  return Number(match[1]) * factor;
}

/** The subtree walk of a coverage threshold object: the leaves that were loosened, each one a finding. */
function thresholdFindings(ctx: Context, key: KeyRule, jest: boolean): RuleFinding[] {
  const out: RuleFinding[] = [];
  const root = key.path;
  const named = (path: readonly string[]) => keyText([...ctx.family.prefix, ...path]);
  const rootText = named(root);
  const baseSub = ctx.base === null ? "unset" : lookup(ctx.base, root);
  const headSub = lookup(ctx.head, root);
  const headSubValue = foundValue(headSub);

  if (!jest && headSubValue !== null && headSubValue.type === "object") {
    const walk = (value: ConfigValue, path: string[], depth: number) => {
      if (value.type !== "object" || depth > MAX_CONFIG_VALUE_DEPTH) return;
      for (const [name, entry] of value.entries) {
        const next = [...path, name];
        if (name === "autoUpdate" && entry.value.type === "boolean" && entry.value.value) {
          const before = ctx.base === null ? "unset" : lookup(ctx.base, [...root, ...next]);
          const was = foundValue(before);
          if (!(was !== null && was.type === "boolean" && was.value)) {
            out.push(
              finding(
                ctx.mode,
                entry.line,
                `${named([...root, ...next])} turned on: ${shown(was)} → ${shown(entry.value)}.`,
                was,
                entry.value,
              ),
            );
          }
        }
        walk(entry.value, next, depth + 1);
      }
    };
    walk(headSubValue, [], 0);
  }

  const baseValue = foundValue(baseSub);
  if (baseValue === null || baseValue.type !== "object") return out;
  if (headSub === "unknown" || (headSubValue !== null && headSubValue.type === "opaque")) {
    if (headSubValue === null || printValue(headSubValue) !== printValue(baseValue)) {
      out.push(
        finding(
          "warn",
          lineOf(headSub),
          headSubValue === null ? cannotUnknown(rootText) : cannotOpaque(rootText, headSubValue),
          baseValue,
          headSubValue,
        ),
      );
    }
    return out;
  }

  const walkBase = (value: ConfigValue, path: string[], depth: number) => {
    if (value.type !== "object" || depth > MAX_CONFIG_VALUE_DEPTH) return;
    for (const [name, entry] of value.entries) {
      const next = [...path, name];
      const leaf = entry.value;
      if (leaf.type === "object") {
        walkBase(leaf, next, depth + 1);
        continue;
      }
      const isNumber = leaf.type === "number";
      const isStrict = !jest && leaf.type === "boolean" && leaf.value && (name === "100" || name === "perFile");
      if (!isNumber && !isStrict) continue;
      const leafKey = named([...root, ...next]);
      const h = lookup(ctx.head, [...root, ...next]);
      const headValue = foundValue(h);
      if (h === "unset") {
        out.push(finding(ctx.mode, null, `${leafKey} removed: ${shown(leaf)} → ${UNSET}.`, leaf, null));
      } else if (h === "unknown") {
        out.push(finding("warn", null, cannotUnknown(leafKey), leaf, null));
      } else if (headValue !== null && headValue.type === "opaque") {
        out.push(finding("warn", lineOf(h), cannotOpaque(leafKey, headValue), leaf, headValue));
      } else if (headValue !== null && isNumber && headValue.type === "number" && leaf.type === "number") {
        if (headValue.value < leaf.value) {
          out.push(
            finding(ctx.mode, lineOf(h), `${leafKey} lowered: ${shown(leaf)} → ${shown(headValue)}.`, leaf, headValue),
          );
        }
      } else if (headValue !== null && isStrict && headValue.type === "boolean" && !headValue.value) {
        out.push(
          finding(ctx.mode, lineOf(h), `${leafKey} turned off: ${shown(leaf)} → ${shown(headValue)}.`, leaf, headValue),
        );
      }
    }
  };
  walkBase(baseValue, [], 0);
  return out;
}

/** The pytest `addopts` rule: one finding per deselection option gained at head. */
function addoptsFindings(ctx: Context, key: KeyRule, b: Lookup, h: Lookup, keyName: string): RuleFinding[] {
  const headValue = foundValue(h);
  if (headValue === null) return [];
  const baseValue = foundValue(b);
  if (b === "unknown") return [];
  if (headValue.type === "opaque") {
    return baseValue !== null && printValue(baseValue) !== printValue(headValue)
      ? [compared(ctx, { ...key, warn: true }, cannotOpaque(keyName, headValue), b, h)]
      : [];
  }
  if (baseValue !== null && printValue(baseValue) === printValue(headValue)) return [];
  const before = baseValue === null ? [] : deselectionPairs(splitAddopts(baseValue));
  return gainedPairs(before, deselectionPairs(splitAddopts(headValue))).map((pair) =>
    compared(ctx, key, `${keyName} gains ${pairText(pair)}.`, b, h),
  );
}

/** The judgement of one settings key; see the rule kinds. */
function keyFindings(ctx: Context, key: KeyRule): RuleFinding[] {
  const full = key.path;
  const keyName = keyText([...ctx.family.prefix, ...full]);
  if (key.rule === "thresholds") return thresholdFindings(ctx, key, false);
  if (key.rule === "jestThresholds") return thresholdFindings(ctx, key, true);

  const b: Lookup = ctx.base === null ? "unset" : lookup(ctx.base, full);
  const h = lookup(ctx.head, full);
  if (key.rule === "addopts") return addoptsFindings(ctx, key, b, h, keyName);
  if (h === "unset") return [];
  const baseValue = foundValue(b);
  if (h === "unknown") {
    return baseValue !== null && key.rule !== "addedOrChanged"
      ? [finding("warn", null, cannotUnknown(keyName), baseValue, null)]
      : [];
  }
  const headValue = h.found.value;
  if (baseValue !== null && printValue(baseValue) === printValue(headValue)) return [];
  const cannot = () => [finding("warn", lineOf(h), cannotOpaque(keyName, headValue), baseValue, headValue)];
  const hit = (verb: string) => [
    compared(ctx, key, `${keyName} ${verb}: ${shown(baseValue)} → ${shown(headValue)}.`, b, h),
  ];

  if (key.rule === "addedOrChanged") return hit("added or changed");

  if (key.list !== undefined) {
    if (b === "unknown") return [];
    const split = key.split === true;
    if (key.rule === "narrowed") {
      if (baseValue === null) return [];
      const result = narrowedList(entriesOf(baseValue, split), entriesOf(headValue, split), key.list);
      return result === "narrowed" ? hit("narrowed") : result === "cannot" ? cannot() : [];
    }
    const before = baseValue === null ? [] : entriesOf(baseValue, split);
    const result = widenedList(before, entriesOf(headValue, split), key.list);
    return result === "widened" ? hit("widened") : result === "cannot" ? cannot() : [];
  }

  if (headValue.type === "opaque") return baseValue !== null ? cannot() : [];

  switch (key.rule) {
    case "lowered":
      return baseValue?.type === "number" && headValue.type === "number" && headValue.value < baseValue.value
        ? hit("lowered")
        : [];
    case "turnedOn":
      return headValue.type === "boolean" && headValue.value && !(baseValue?.type === "boolean" && baseValue.value)
        ? hit("turned on")
        : [];
    case "turnedOff":
      return headValue.type === "boolean" &&
        !headValue.value &&
        baseValue !== null &&
        !(baseValue.type === "boolean" && !baseValue.value)
        ? hit("turned off")
        : [];
    case "increased": {
      if (headValue.type !== "number" || b === "unknown") return [];
      const before = b === "unset" ? 0 : baseValue?.type === "number" ? baseValue.value : null;
      return before !== null && headValue.value > before ? hit("increased") : [];
    }
    case "bail": {
      const after =
        headValue.type === "number" ? headValue.value : headValue.type === "boolean" && headValue.value ? 1 : 0;
      if (after <= 0 || b === "unknown") return [];
      const before =
        b === "unset"
          ? 0
          : baseValue?.type === "number"
            ? baseValue.value
            : baseValue?.type === "boolean"
              ? Number(baseValue.value)
              : null;
      if (before === null) return [];
      if (before <= 0) return hit("added");
      return before > after ? hit("lowered") : [];
    }
    case "raised": {
      const after = toMilliseconds(headValue);
      if (after === null || b === "unknown") return [];
      const before = b === "unset" ? 0 : baseValue === null ? null : toMilliseconds(baseValue);
      if (before === null) return [];
      if (ctx.family.mocha && after === 0) return before !== 0 ? hit("raised") : [];
      return (before > 0 ? after >= 10 * before : after >= 50000) ? hit("raised") : [];
    }
    default:
      return [];
  }
}

/**
 * Compares the settings of a config at base and at head. `base` is null when the file is new at head or its settings
 * container was absent or not found at base: then only the keys a new config is judged on are read (`passWithNoTests`
 * and `allowOnly` turned on, a nonzero retry count, pytest deselection options). `mode` is the severity of the keys that
 * take the mode; the others are warnings.
 */
export function evaluateRules(
  kind: TestConfigKind,
  base: ConfigValue | null,
  head: ConfigValue,
  mode: "block" | "warn",
): RuleFinding[] {
  const family = familyOf(kind);
  const wrap = (value: ConfigValue): ConfigValue =>
    kind === "vitest-workspace"
      ? { type: "object", entries: new Map([["projects", { value, line: null }]]), open: false, extras: [] }
      : value;
  const ctx: Context = { base: base === null ? null : wrap(base), head: wrap(head), mode, family };
  const rules =
    base === null
      ? family.rules.filter(
          (key) => key.rule === "addopts" || NEW_CONFIG_KEYS.has(key.path[key.path.length - 1] as string),
        )
      : family.rules;
  return rules.flatMap((key) => keyFindings(ctx, key));
}
