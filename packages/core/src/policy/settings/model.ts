import type { TestSourceFile } from "../../testSources.js";
import type { PolicyDocument } from "../types.js";
import { isCountingHandler } from "./hooks.js";
import { type JsonMember, type JsonValue, parseSettingsJson } from "./json.js";
import { mcpServersOf } from "./mcp.js";
import { isJsoncMcpPath, isPolicyMcpPath, isPolicySettingsPath, settingsUnitAnchor } from "./paths.js";
import { parsePermissionRule } from "./permissionRule.js";
import type { PolicySettingsDrop, SettingsProblem } from "./types.js";

export interface SettingsEntry {
  path: string;
  line: number;
  text: string;
}
export interface SettingsFlag {
  path: string;
  line: number;
}
export interface SettingsHookGroup {
  path: string;
  line: number;
  event: string;
  matcher: string | undefined;
  counting: boolean;
}
export interface SettingsUnit {
  /** `""` for the root unit. */
  anchor: string;
  /** The unit's settings paths present in the sources (files or non-missing drops), sorted. */
  paths: string[];
  /** Where a finding about the whole unit sits. */
  reportPath: string;
  allow: SettingsEntry[];
  deny: SettingsEntry[];
  enabledMcpjsonServers: SettingsEntry[];
  hookGroups: SettingsHookGroup[];
  /** The line of the VALUE. */
  defaultModes: (SettingsFlag & { value: string })[];
  /** Non-empty arrays only; the line of the key. */
  additionalDirectories: SettingsFlag[];
  /** `true` only; the line of the key. */
  disableAllHooks: SettingsFlag[];
  /** `true` only; the line of the key. */
  enableAllProjectMcpServers: SettingsFlag[];
}
export interface McpServer {
  path: string;
  line: number;
  name: string;
  command: string | null;
  args: string[] | null;
  url: string | null;
  isObject: boolean;
}
export type SettingsReader = "P02" | "P03" | "P04" | "P05" | "P06";
export type SettingsProblemClass =
  | "drop"
  | "unparseable-settings"
  | "unparseable-mcp"
  | "allow-syntax"
  | "deny"
  | "hooks"
  | "other";
export interface SettingsModelProblem extends SettingsProblem {
  readers: SettingsReader[];
  problemClass: SettingsProblemClass;
}
export interface SettingsModel {
  units: SettingsUnit[];
  mcpServers: McpServer[];
  problems: SettingsModelProblem[];
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const ALL: SettingsReader[] = ["P02", "P03", "P04", "P05", "P06"];
const MCP_READERS: SettingsReader[] = ["P04", "P05"];

function newUnit(anchor: string): SettingsUnit {
  return {
    anchor,
    paths: [],
    reportPath: `${anchor}.claude/settings.json`,
    allow: [],
    deny: [],
    enabledMcpjsonServers: [],
    hookGroups: [],
    defaultModes: [],
    additionalDirectories: [],
    disableAllHooks: [],
    enableAllProjectMcpServers: [],
  };
}

/** Parse each settings and MCP file once and build the per-unit model the rules P02 to P06 judge. */
export function readSettingsModel(
  sources: { files: TestSourceFile[]; dropped: PolicySettingsDrop[] },
  document: PolicyDocument,
): SettingsModel {
  const setup = document.setup;
  const readMcp = (setup?.allowed_mcp_servers?.length ?? 0) > 0 || (setup?.forbidden_mcp_servers?.length ?? 0) > 0;
  const walked = new Set((setup?.required_hooks ?? []).map((hook) => hook.event));
  const problems: SettingsModelProblem[] = [];
  const mcpServers: McpServer[] = [];
  const units = new Map<string, SettingsUnit>([["", newUnit("")]]);
  const parsed = new Map<string, JsonValue>();

  const problem = (
    path: string | null,
    line: number | null,
    reason: SettingsProblem["reason"],
    readers: SettingsReader[],
    problemClass: SettingsProblemClass,
  ) => problems.push({ path, line, reason, readers, problemClass });
  const unitOf = (path: string): SettingsUnit => {
    const anchor = settingsUnitAnchor(path);
    let unit = units.get(anchor);
    if (unit === undefined) {
      unit = newUnit(anchor);
      units.set(anchor, unit);
    }
    return unit;
  };

  for (const drop of sources.dropped) {
    if (drop.reason === "missing") continue;
    const settings = isPolicySettingsPath(drop.path);
    if (!settings && !isPolicyMcpPath(drop.path)) continue;
    if (settings) unitOf(drop.path).paths.push(drop.path);
    if (drop.reason === "binary") {
      problem(
        drop.path,
        null,
        "binary",
        settings ? ALL : MCP_READERS,
        settings ? "unparseable-settings" : "unparseable-mcp",
      );
    } else problem(drop.path, null, drop.reason, settings ? ALL : MCP_READERS, "drop");
  }

  for (const file of sources.files) {
    const settings = isPolicySettingsPath(file.path);
    const mcp = !settings && readMcp && isPolicyMcpPath(file.path);
    if (!settings && !mcp) continue;
    if (settings) unitOf(file.path).paths.push(file.path);
    const readers = settings ? ALL : MCP_READERS;
    const result = parseSettingsJson(file.text, { jsonc: mcp && isJsoncMcpPath(file.path) });
    const unparseable = settings ? "unparseable-settings" : "unparseable-mcp";
    if (!result.ok) {
      problem(file.path, null, result.reason, readers, unparseable);
      continue;
    }
    if (result.value.type !== "object") {
      problem(file.path, null, "not-object", readers, unparseable);
      continue;
    }
    for (const duplicate of result.duplicates) problem(file.path, duplicate.line, "duplicate-key", readers, "other");
    parsed.set(file.path, result.value);
  }

  const readSettings = (unit: SettingsUnit, path: string, members: Map<string, JsonMember>) => {
    const wrong = (line: number, readers: SettingsReader[], cls: SettingsProblemClass) =>
      problem(path, line, "wrong-type", readers, cls);

    /** The strings of an array member; a non-string element is rejected on its own. */
    const strings = (member: JsonMember, readers: SettingsReader[], cls: SettingsProblemClass): SettingsEntry[] => {
      if (member.value.type !== "array") {
        wrong(member.keyLine, readers, cls);
        return [];
      }
      const out: SettingsEntry[] = [];
      for (const item of member.value.items) {
        if (item.type === "string") out.push({ path, line: item.line, text: item.value });
        else wrong(item.line, readers, cls);
      }
      return out;
    };

    const permissions = members.get("permissions");
    if (permissions !== undefined) {
      if (permissions.value.type !== "object") wrong(permissions.keyLine, ["P02", "P03"], "deny");
      else {
        const perms = permissions.value.members;
        const allow = perms.get("allow");
        if (allow !== undefined) {
          for (const entry of strings(allow, ["P02"], "other")) {
            unit.allow.push(entry);
            if (parsePermissionRule(entry.text, "allow").kind === "unknown") {
              problem(path, entry.line, "unknown-rule-syntax", ["P02"], "allow-syntax");
            }
          }
        }
        const deny = perms.get("deny");
        if (deny !== undefined) {
          for (const entry of strings(deny, ["P03"], "deny")) {
            unit.deny.push(entry);
            if (parsePermissionRule(entry.text, "deny").kind === "unknown") {
              problem(path, entry.line, "unknown-rule-syntax", ["P03"], "deny");
            }
          }
        }
        const mode = perms.get("defaultMode");
        if (mode !== undefined) {
          if (mode.value.type === "string")
            unit.defaultModes.push({ path, line: mode.value.line, value: mode.value.value });
          else wrong(mode.keyLine, ["P02"], "other");
        }
        const dirs = perms.get("additionalDirectories");
        if (dirs !== undefined) {
          if (dirs.value.type !== "array") wrong(dirs.keyLine, ["P02"], "other");
          else if (dirs.value.items.length > 0) unit.additionalDirectories.push({ path, line: dirs.keyLine });
        }
      }
    }

    const disable = members.get("disableAllHooks");
    if (disable !== undefined) {
      if (disable.value.type !== "boolean") wrong(disable.keyLine, ["P06"], "hooks");
      else if (disable.value.value) unit.disableAllHooks.push({ path, line: disable.keyLine });
    }
    const enableAll = members.get("enableAllProjectMcpServers");
    if (enableAll !== undefined) {
      if (enableAll.value.type !== "boolean") wrong(enableAll.keyLine, ["P04"], "other");
      else if (enableAll.value.value) unit.enableAllProjectMcpServers.push({ path, line: enableAll.keyLine });
    }
    const enabled = members.get("enabledMcpjsonServers");
    if (enabled !== undefined) unit.enabledMcpjsonServers.push(...strings(enabled, MCP_READERS, "other"));

    const hooks = members.get("hooks");
    if (hooks !== undefined) {
      if (hooks.value.type !== "object") wrong(hooks.keyLine, ["P06"], "hooks");
      else {
        for (const [event, member] of hooks.value.members) {
          if (!walked.has(event)) continue;
          if (member.value.type !== "array") {
            wrong(member.keyLine, ["P06"], "hooks");
            continue;
          }
          for (const group of member.value.items) {
            if (group.type !== "object") {
              wrong(group.line, ["P06"], "hooks");
              continue;
            }
            const matcher = group.members.get("matcher");
            const handlers = group.members.get("hooks");
            if (matcher !== undefined && matcher.value.type !== "string") {
              wrong(matcher.keyLine, ["P06"], "hooks");
              continue;
            }
            if (handlers === undefined || handlers.value.type !== "array") {
              wrong(handlers === undefined ? group.line : handlers.keyLine, ["P06"], "hooks");
              continue;
            }
            unit.hookGroups.push({
              path,
              line: group.line,
              event,
              matcher: matcher?.value.type === "string" ? matcher.value.value : undefined,
              counting: handlers.value.items.some(isCountingHandler),
            });
          }
        }
      }
    }
  };

  for (const unit of units.values()) {
    unit.paths = [...new Set(unit.paths)].sort(byCodeUnit);
    const main = `${unit.anchor}.claude/settings.json`;
    const local = `${unit.anchor}.claude/settings.local.json`;
    unit.reportPath = unit.paths.includes(main) ? main : unit.paths.includes(local) ? local : main;
    // settings.json first, then settings.local.json.
    for (const path of [main, local]) {
      const root = parsed.get(path);
      if (root !== undefined && root.type === "object") readSettings(unit, path, root.members);
    }
  }

  // MCP servers, in path order.
  for (const file of [...sources.files].sort((a, b) => byCodeUnit(a.path, b.path))) {
    if (!readMcp || !isPolicyMcpPath(file.path) || isPolicySettingsPath(file.path)) continue;
    const root = parsed.get(file.path);
    if (root === undefined) continue;
    const read = mcpServersOf(file.path, root);
    for (const server of read.servers) mcpServers.push({ path: file.path, ...server });
    for (const wrong of read.wrongType) {
      problem(file.path, wrong.line, "wrong-type", wrong.scope === "container" ? MCP_READERS : ["P05"], "other");
    }
  }

  const root = units.get("") as SettingsUnit;
  const rest = [...units.values()].filter((unit) => unit !== root).sort((a, b) => byCodeUnit(a.anchor, b.anchor));
  return { units: [root, ...rest], mcpServers, problems };
}
