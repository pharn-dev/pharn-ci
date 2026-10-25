import { flowItems, indentOf, keyValue, listItem, scalarText, stripComment } from "../signals/yamlLines.js";
import { type ConfigEntry, type ConfigValue, MAX_CONFIG_CHARS, type ReadResult } from "./value.js";

/** A plain (unquoted) scalar with its YAML type: a boolean, null, a number or a string. */
function plain(text: string): ConfigValue {
  if (/^(?:true|True|TRUE)$/.test(text)) return { type: "boolean", value: true };
  if (/^(?:false|False|FALSE)$/.test(text)) return { type: "boolean", value: false };
  if (/^(?:null|Null|NULL|~)$/.test(text)) return { type: "null" };
  if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return { type: "number", value: Number(text) };
  return { type: "string", value: text };
}

/** The value of the text after `key:` on the same line. A construct this reader does not model is opaque. */
function inlineValue(text: string): ConfigValue {
  const trimmed = text.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return { type: "string", value: scalarText(trimmed) };
  if (trimmed.startsWith("[")) {
    const items = flowItems(trimmed);
    return items === null ? { type: "opaque", text: trimmed } : { type: "array", items: items.map(plain) };
  }
  if (/^[{|>&*!%@`]/.test(trimmed)) return { type: "opaque", text: trimmed };
  return plain(trimmed);
}

const isIndented = (line: string) => indentOf(line) > 0 || line.startsWith("\t");

/**
 * Reads the flat YAML of `.mocharc.yml` and `.mocharc.yaml`: top-level `key: value` lines whose value is a scalar, a
 * one-line flow list or a block list. A key with any other nested content is opaque. Any other top-level line refuses
 * the text as `invalid-yaml`.
 */
export function readYaml(text: string): ReadResult {
  if (text.length > MAX_CONFIG_CHARS) return { ok: false, reason: "too-large" };
  const lines = text.split(/\r\n|\r|\n/);
  const entries = new Map<string, ConfigEntry>();
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] as string;
    const stripped = stripComment(raw);
    if (stripped === "" || stripped === "---" || stripped === "...") {
      i++;
      continue;
    }
    if (isIndented(raw) || stripped.startsWith("-")) return { ok: false, reason: "invalid-yaml" };
    const pair = keyValue(raw);
    if (pair === null) return { ok: false, reason: "invalid-yaml" };

    const children: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j] as string;
      const nextStripped = stripComment(next);
      if (nextStripped === "") {
        j++;
      } else if (isIndented(next) || (pair.value === "" && nextStripped.startsWith("-"))) {
        children.push(next);
        j++;
      } else {
        break;
      }
    }

    let value: ConfigValue;
    if (pair.value !== "") {
      value =
        children.length === 0
          ? inlineValue(pair.value)
          : { type: "opaque", text: [pair.value, ...children.map((child) => stripComment(child))].join(" ") };
    } else if (children.length === 0) {
      value = { type: "null" };
    } else {
      const items = children.map((child) => listItem(child));
      value = items.every((item) => item !== null)
        ? { type: "array", items: (items as string[]).map(plain) }
        : { type: "opaque", text: children.map((child) => stripComment(child)).join(" ") };
    }
    entries.set(pair.key, { value, line: i + 1 });
    i = j;
  }
  return { ok: true, root: { type: "object", entries, open: false, extras: [] } };
}
