import { byCodeUnit } from "../../text.js";
import { type JsonMember, type JsonValue, parseSettingsJson } from "../settings/json.js";

/**
 * The structural comparison of rule P13 for the agent settings and MCP files. Each side is parsed with the policy
 * settings parser; a file that is absent on a side compares as an empty object. The result is the fixed words of every
 * widening found, or null when a present side could not be parsed or has a shape the comparison cannot read. Nothing
 * here returns file text: the words are constants.
 */

/** The fixed words of a settings widening, in the order they are reported. */
export const SETTINGS_WIDENINGS = [
  "permissions.allow grew",
  "permissions.deny shrank",
  "permissions.defaultMode changed",
  "permissions.additionalDirectories grew",
  "hooks changed",
  "disableAllHooks turned on",
  "enableAllProjectMcpServers turned on",
  "enabledMcpjsonServers grew",
  "disabledMcpjsonServers shrank",
] as const;
export type SettingsWidening = (typeof SETTINGS_WIDENINGS)[number];

/** The fixed words of an MCP widening, in the order they are reported. */
export const MCP_WIDENINGS = ["server added", "server changed"] as const;
export type McpWidening = (typeof MCP_WIDENINGS)[number];

/**
 * A deterministic text for a JSON value: object members sorted by key; with `unordered`, the items of every array
 * sorted too, so a pure reordering compares equal. Used only to compare, never shown.
 */
function canon(value: JsonValue | undefined, unordered = false): string {
  if (value === undefined) return "";
  switch (value.type) {
    case "string":
      return JSON.stringify(value.value);
    case "number":
      return `n:${value.value}`;
    case "boolean":
      return value.value ? "true" : "false";
    case "null":
      return "null";
    case "array": {
      const items = value.items.map((item) => canon(item, unordered));
      if (unordered) items.sort(byCodeUnit);
      return `[${items.join(",")}]`;
    }
    case "object": {
      const keys = [...value.members.keys()].sort(byCodeUnit);
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canon(value.members.get(key)?.value, unordered)}`).join(",")}}`;
    }
  }
}

/** A list setting as a set of item texts: absent is empty, an array is its items, any other value is one item. */
function itemSet(value: JsonValue | undefined): Set<string> {
  if (value === undefined) return new Set();
  if (value.type === "array") return new Set(value.items.map((item) => canon(item)));
  return new Set([canon(value)]);
}

const grew = (base: Set<string>, head: Set<string>): boolean => [...head].some((item) => !base.has(item));

const isTrue = (value: JsonValue | undefined): boolean => value?.type === "boolean" && value.value;

/** The members of a parsed side; an absent side is an empty object; null for a root that is not an object. */
function rootMembers(side: JsonValue | null): Map<string, JsonMember> | null {
  if (side === null) return new Map();
  return side.type === "object" ? side.members : null;
}

/** Parse one side: null text (absent) is null; text that does not parse is undefined. */
export function parseSide(text: string | null, jsonc: boolean): JsonValue | null | undefined {
  if (text === null) return null;
  const parsed = parseSettingsJson(text, { jsonc });
  return parsed.ok ? parsed.value : undefined;
}

/**
 * The widenings of an agent settings file from base to head: an allow rule added, a deny rule removed, defaultMode set
 * or changed, an additional directory added, any change to `hooks` other than reordering, `disableAllHooks` or
 * `enableAllProjectMcpServers` turned true, a name added to `enabledMcpjsonServers` or removed from
 * `disabledMcpjsonServers`. Null when a root is not an object or `permissions` is not an object.
 */
export function settingsWidenings(base: JsonValue | null, head: JsonValue | null): SettingsWidening[] | null {
  const b = rootMembers(base);
  const h = rootMembers(head);
  if (b === null || h === null) return null;
  const permissionsOf = (members: Map<string, JsonMember>): Map<string, JsonMember> | null => {
    const value = members.get("permissions")?.value;
    if (value === undefined) return new Map();
    return value.type === "object" ? value.members : null;
  };
  const bp = permissionsOf(b);
  const hp = permissionsOf(h);
  if (bp === null || hp === null) return null;
  const found = new Set<SettingsWidening>();
  if (grew(itemSet(bp.get("allow")?.value), itemSet(hp.get("allow")?.value))) found.add("permissions.allow grew");
  if (grew(itemSet(hp.get("deny")?.value), itemSet(bp.get("deny")?.value))) found.add("permissions.deny shrank");
  const headMode = hp.get("defaultMode")?.value;
  if (headMode !== undefined && canon(headMode) !== canon(bp.get("defaultMode")?.value)) {
    found.add("permissions.defaultMode changed");
  }
  if (grew(itemSet(bp.get("additionalDirectories")?.value), itemSet(hp.get("additionalDirectories")?.value))) {
    found.add("permissions.additionalDirectories grew");
  }
  // An absent `hooks` is the same as an empty object; any other difference, a reordering aside, counts.
  const hooks = (members: Map<string, JsonMember>) => {
    const value = members.get("hooks")?.value;
    return value === undefined ? "{}" : canon(value, true);
  };
  if (hooks(b) !== hooks(h)) found.add("hooks changed");
  if (isTrue(h.get("disableAllHooks")?.value) && !isTrue(b.get("disableAllHooks")?.value)) {
    found.add("disableAllHooks turned on");
  }
  if (isTrue(h.get("enableAllProjectMcpServers")?.value) && !isTrue(b.get("enableAllProjectMcpServers")?.value)) {
    found.add("enableAllProjectMcpServers turned on");
  }
  if (grew(itemSet(b.get("enabledMcpjsonServers")?.value), itemSet(h.get("enabledMcpjsonServers")?.value))) {
    found.add("enabledMcpjsonServers grew");
  }
  if (grew(itemSet(h.get("disabledMcpjsonServers")?.value), itemSet(b.get("disabledMcpjsonServers")?.value))) {
    found.add("disabledMcpjsonServers shrank");
  }
  return SETTINGS_WIDENINGS.filter((word) => found.has(word));
}

/** The fields of a server that say what runs or where it connects. */
const SERVER_FIELDS = ["command", "args", "url", "type"] as const;

/** The server containers of an MCP file: `mcpServers`, and for `.vscode/mcp.json` `servers` too. */
function containerKeys(path: string): string[] {
  return /(?:^|\/)\.vscode\/mcp\.json$/.test(path) ? ["servers", "mcpServers"] : ["mcpServers"];
}

/** Each server name with the text of what it runs; null when a container is not an object. */
function serversOf(path: string, members: Map<string, JsonMember>): Map<string, string> | null {
  const servers = new Map<string, string[]>();
  for (const key of containerKeys(path)) {
    const container = members.get(key)?.value;
    if (container === undefined) continue;
    if (container.type !== "object") return null;
    for (const [name, member] of container.members) {
      const value = member.value;
      const text =
        value.type === "object"
          ? SERVER_FIELDS.map((field) => `${field}=${canon(value.members.get(field)?.value)}`).join(";")
          : canon(value);
      const list = servers.get(name) ?? [];
      list.push(text);
      servers.set(name, list);
    }
  }
  const out = new Map<string, string>();
  for (const [name, list] of servers) out.set(name, list.sort(byCodeUnit).join("\u0000"));
  return out;
}

/**
 * The widenings of an MCP file from base to head: a server name the head has and the base does not, or a server whose
 * `command`, `args`, `url` or `type` changed. A removed server is a narrowing. Null when a root or a server container
 * is not an object.
 */
export function mcpWidenings(path: string, base: JsonValue | null, head: JsonValue | null): McpWidening[] | null {
  const b = rootMembers(base);
  const h = rootMembers(head);
  if (b === null || h === null) return null;
  const bs = serversOf(path, b);
  const hs = serversOf(path, h);
  if (bs === null || hs === null) return null;
  const found = new Set<McpWidening>();
  for (const [name, text] of hs) {
    const before = bs.get(name);
    if (before === undefined) found.add("server added");
    else if (before !== text) found.add("server changed");
  }
  return MCP_WIDENINGS.filter((word) => found.has(word));
}
