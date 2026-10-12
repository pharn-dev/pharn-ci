import { COVERAGE_FORMATS, type CoverageFormat } from "./coverage/types.js";

/** Shape of `.pharn/ci.yml`. Every field is optional; CLI/Action inputs override it. */
export interface PharnConfig {
  coverage?: {
    file?: string;
    format?: CoverageFormat;
    threshold?: number;
  };
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

type Scalar = string | number | boolean | null;
interface YamlMap {
  [key: string]: Scalar | YamlMap;
}

/**
 * Parse and validate `.pharn/ci.yml`.
 *
 * Supports the YAML subset the config needs — nested block mappings, comments,
 * quoted/plain strings, numbers, booleans, null — and rejects anything else
 * with a clear error instead of guessing. Avoids a YAML dependency.
 */
export function parseConfig(text: string): PharnConfig {
  return validateConfig(parseYamlSubset(text));
}

export function parseYamlSubset(text: string): YamlMap {
  const root: YamlMap = {};
  // Stack of open mappings with the indent of their keys.
  const stack: Array<{ indent: number; map: YamlMap }> = [{ indent: 0, map: root }];
  let pendingKey: { map: YamlMap; key: string; indent: number; line: number } | null = null;

  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = stripComment(lines[i] as string).replace(/\s+$/, "");
    if (raw.trim() === "") continue;
    if (raw.trim() === "---" && i === 0) continue;
    if (/^\s*\t/.test(raw)) throw new ConfigError(`line ${lineNo}: tabs are not allowed for indentation`);

    const indent = raw.length - raw.trimStart().length;
    const content = raw.trimStart();
    if (content.startsWith("- ") || content === "-") {
      throw new ConfigError(`line ${lineNo}: lists are not supported in .pharn/ci.yml`);
    }

    if (pendingKey) {
      if (indent > pendingKey.indent) {
        const child: YamlMap = {};
        pendingKey.map[pendingKey.key] = child;
        stack.push({ indent, map: child });
      } else {
        pendingKey.map[pendingKey.key] = null;
      }
      pendingKey = null;
    }

    while (stack.length > 1 && indent < (stack[stack.length - 1] as { indent: number }).indent) stack.pop();
    const top = stack[stack.length - 1] as { indent: number; map: YamlMap };
    if (indent !== top.indent) throw new ConfigError(`line ${lineNo}: unexpected indentation`);

    const match = /^([A-Za-z0-9_-]+|"[^"]*"|'[^']*')\s*:(?:\s+(.*))?$/.exec(content);
    if (!match) throw new ConfigError(`line ${lineNo}: expected "key: value"`);
    const key = unquoteScalarKey(match[1] as string);
    if (Object.hasOwn(top.map, key)) throw new ConfigError(`line ${lineNo}: duplicate key "${key}"`);
    const value = match[2];
    if (value === undefined || value === "") {
      pendingKey = { map: top.map, key, indent, line: lineNo };
    } else {
      top.map[key] = parseScalar(value, lineNo);
    }
  }
  if (pendingKey) pendingKey.map[pendingKey.key] = null;
  return root;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1] as string))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquoteScalarKey(key: string): string {
  return /^["']/.test(key) ? key.slice(1, -1) : key;
}

function parseScalar(value: string, lineNo: number): Scalar {
  const v = value.trim();
  if (/^"(?:[^"\\]|\\.)*"$/.test(v)) {
    try {
      return JSON.parse(v) as string;
    } catch {
      throw new ConfigError(`line ${lineNo}: invalid double-quoted string`);
    }
  }
  if (/^'(?:[^']|'')*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^[[{|>&*!%@`]/.test(v)) throw new ConfigError(`line ${lineNo}: unsupported YAML syntax "${v}"`);
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return Number(v);
  return v;
}

function validateConfig(doc: YamlMap): PharnConfig {
  const config: PharnConfig = {};
  for (const key of Object.keys(doc)) {
    if (key !== "coverage") throw new ConfigError(`unknown top-level key "${key}"`);
  }
  const cov = doc.coverage;
  if (cov === undefined || cov === null) return config;
  if (typeof cov !== "object") throw new ConfigError(`"coverage" must be a mapping`);

  const coverage: NonNullable<PharnConfig["coverage"]> = {};
  for (const [key, value] of Object.entries(cov)) {
    if (value === null) continue;
    switch (key) {
      case "file":
        if (typeof value !== "string" || value === "")
          throw new ConfigError(`"coverage.file" must be a non-empty string`);
        coverage.file = value;
        break;
      case "format":
        if (typeof value !== "string" || !isCoverageFormat(value)) {
          throw new ConfigError(`"coverage.format" must be one of: ${COVERAGE_FORMATS.join(", ")}`);
        }
        coverage.format = value;
        break;
      case "threshold":
        coverage.threshold = parseThreshold(value, '"coverage.threshold"');
        break;
      default:
        throw new ConfigError(`unknown key "coverage.${key}"`);
    }
  }
  config.coverage = coverage;
  return config;
}

export function isCoverageFormat(value: string): value is CoverageFormat {
  return (COVERAGE_FORMATS as readonly string[]).includes(value);
}

/** Validate a threshold given as a number or a string (CLI flag / Action input). */
export function parseThreshold(value: unknown, label = "threshold"): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) {
    throw new ConfigError(`${label} must be a number between 0 and 100`);
  }
  return n;
}
