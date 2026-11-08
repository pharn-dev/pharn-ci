import { type JsonMember, parseSettingsJson } from "../policy/settings/json.js";
import { membersOf } from "./npmManifest.js";
import { sourceOfResolved } from "./specs.js";
import type { LockEntry, LockSource, ParsedLockfile } from "./types.js";

/** The sections whose specifiers a lockfile importer records; `peerDependencies` is declared, not installed. */
export const INSTALLED_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

const NODE_MODULES = "node_modules/";

function stringOf(members: Map<string, JsonMember>, key: string): string | null {
  const value = members.get(key)?.value;
  return value !== undefined && value.type === "string" ? value.value : null;
}

/** name → spec of the installed sections of a package entry. */
function specsOf(members: Map<string, JsonMember>): Map<string, string> {
  const specs = new Map<string, string>();
  for (const section of INSTALLED_SECTIONS) {
    const deps = membersOf(members.get(section)?.value);
    if (deps === null) continue;
    for (const [name, member] of deps) {
      if (member.value.type === "string") specs.set(name, member.value.value);
    }
  }
  return specs;
}

function sourceOf(resolved: string | null, link: boolean): LockSource {
  if (link) return { kind: "link" };
  return resolved === null ? { kind: "registry" } : sourceOfResolved(resolved);
}

/**
 * A package-lock.json or npm-shrinkwrap.json. Version 2 and 3: every `packages` member under a `node_modules/` path is
 * an entry, keyed by that path; every other member (`""` and the workspace directories) is an importer with the
 * specifiers of its installed sections. Version 1: the nested `dependencies` tree, walked with an explicit stack, keyed
 * by the install path; it records no specifiers, so `importers` is null. Null when the text is not a JSON object.
 */
export function parseNpmLock(text: string): ParsedLockfile | null {
  const parsed = parseSettingsJson(text, { jsonc: false });
  if (!parsed.ok) return null;
  const root = membersOf(parsed.value);
  if (root === null) return null;
  const entries: LockEntry[] = [];
  const packages = membersOf(root.get("packages")?.value);
  if (packages !== null) {
    const importers = new Map<string, Map<string, string>>();
    for (const [key, member] of packages) {
      const fields = membersOf(member.value);
      if (fields === null) continue;
      const at = key.lastIndexOf(NODE_MODULES);
      if (at === -1) {
        importers.set(key, specsOf(fields));
        continue;
      }
      const linkValue = fields.get("link")?.value;
      entries.push({
        key,
        name: stringOf(fields, "name") ?? key.slice(at + NODE_MODULES.length),
        version: stringOf(fields, "version"),
        integrity: stringOf(fields, "integrity"),
        source: sourceOf(stringOf(fields, "resolved"), linkValue?.type === "boolean" && linkValue.value),
        line: member.keyLine,
      });
    }
    return { ecosystem: "npm", format: "package-lock", entries, importers, specs: null, names: null };
  }
  const top = membersOf(root.get("dependencies")?.value);
  const stack: Array<{ prefix: string; members: Map<string, JsonMember> }> =
    top === null ? [] : [{ prefix: "", members: top }];
  while (stack.length > 0) {
    const { prefix, members } = stack.pop() as { prefix: string; members: Map<string, JsonMember> };
    for (const [name, member] of members) {
      const fields = membersOf(member.value);
      if (fields === null) continue;
      const key = `${prefix}${NODE_MODULES}${name}`;
      const version = stringOf(fields, "version");
      // Version 1 writes a git or local dependency's location as its version and may leave `resolved` out.
      const resolved =
        stringOf(fields, "resolved") ??
        (version !== null && /^[a-z+]+:/i.test(version) && !version.startsWith("npm:") ? version : null);
      entries.push({
        key,
        name,
        version,
        integrity: stringOf(fields, "integrity"),
        source: sourceOf(resolved, false),
        line: member.keyLine,
      });
      const nested = membersOf(fields.get("dependencies")?.value);
      if (nested !== null) stack.push({ prefix: `${key}/`, members: nested });
    }
  }
  entries.sort((a, b) => a.line - b.line);
  return { ecosystem: "npm", format: "package-lock", entries, importers: null, specs: null, names: null };
}
