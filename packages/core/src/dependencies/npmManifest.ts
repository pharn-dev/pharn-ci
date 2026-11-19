import { type JsonMember, type JsonValue, parseSettingsJson } from "../policy/settings/json.js";
import { classifyNpmSpec } from "./specs.js";
import type { ManifestDependency, ParsedManifest } from "./types.js";

/** The dependency sections of package.json that dependency safety reads, in this order. */
export const NPM_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

/**
 * The package.json fields that replace a package anywhere in the tree, read after the dependency sections (CORE-115):
 * npm's `overrides` (nested objects), yarn's `resolutions` and pnpm's `pnpm.overrides`.
 */
export const NPM_OVERRIDE_SECTIONS = ["overrides", "resolutions", "pnpm.overrides"] as const;

/** Whether a manifest dependency was declared in one of the override fields. */
export function isOverrideSection(section: string): boolean {
  return (NPM_OVERRIDE_SECTIONS as readonly string[]).includes(section);
}

/** The members of a JSON object value, or null when the value is not an object. */
export function membersOf(value: JsonValue | undefined): Map<string, JsonMember> | null {
  return value !== undefined && value.type === "object" ? value.members : null;
}

/** A package selector without its version: `x@^1` is `x`, `@s/x@1` is `@s/x`. */
function withoutVersion(selector: string): string {
  const at = selector.indexOf("@", 1);
  return at === -1 ? selector : selector.slice(0, at);
}

/**
 * A 53-bit digest of an override's parent path, as `#` and base-36 digits (cyrb53, public domain): the same path gives
 * the same digest at the merge base and at HEAD. Not a security boundary: two paths that collide compare as one
 * override, and a leaf is then left out of D05 only when the merge base already had the same spec under the other path.
 */
function pathDigest(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `#${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** The package a pnpm override key replaces: the last `>` part (`a@1>b@<2` is `b`); a `>` after `@` is a range. */
function pnpmTarget(key: string): string {
  for (let i = key.length - 1; i > 0; i--) {
    if (key[i] === ">" && key[i - 1] !== "@" && key[i - 1] !== ">") return withoutVersion(key.slice(i + 1));
  }
  return withoutVersion(key);
}

/** The package a yarn resolution pattern replaces: its last `/` part, with a scope (`**\/@s/b` is `@s/b`). */
function yarnTarget(key: string): string {
  const parts = key.split("/");
  const last = parts[parts.length - 1] as string;
  const scope = parts.length > 1 ? (parts[parts.length - 2] as string) : "";
  return withoutVersion(scope.startsWith("@") ? `${scope}/${last}` : last);
}

/**
 * The dependencies of a package.json: each string member of `dependencies`, `devDependencies`, `optionalDependencies`
 * and `peerDependencies`, then each string leaf of `overrides` (walked through nested objects, `.` naming the parent),
 * `resolutions` and `pnpm.overrides`, with the line of its key and where its spec points. An override's name is the
 * package it replaces and its `key` the selector as written. Null when the text is not a JSON object.
 */
export function parseNpmManifest(text: string): ParsedManifest | null {
  const parsed = parseSettingsJson(text, { jsonc: false });
  if (!parsed.ok) return null;
  const root = membersOf(parsed.value);
  if (root === null) return null;
  const deps: ManifestDependency[] = [];
  const add = (name: string, member: JsonMember, section: string, key?: string) => {
    if (member.value.type !== "string") return;
    const spec = member.value.value;
    const kind = classifyNpmSpec(spec);
    deps.push({
      name,
      named: name !== "",
      spec,
      section,
      line: member.keyLine,
      ...(key === undefined ? {} : { key }),
      kind: kind.kind,
      ...(kind.allowedUrl === undefined ? {} : { allowedUrl: kind.allowedUrl }),
      ...(kind.kind === "url" ? { url: kind.url ?? spec.trim() } : {}),
      ...(kind.registry === undefined ? {} : { registry: kind.registry }),
    });
  };
  for (const section of NPM_SECTIONS) {
    const members = membersOf(root.get(section)?.value);
    if (members === null) continue;
    for (const [name, member] of members) add(name, member, section);
  }
  // npm overrides nest: {"a": {".": "1", "b": "2"}} sets a to 1 and b under a to 2. The JSON reader caps the depth. A
  // nested leaf is keyed by a fixed-size digest of its parent path, never the path itself, so a long parent key is not
  // copied into every leaf below it (linear in the file).
  const walk = (members: Map<string, JsonMember>, parentId: string, parentName: string) => {
    for (const [key, member] of members) {
      const name = key === "." ? parentName : withoutVersion(key);
      const nested = membersOf(member.value);
      if (nested === null) add(name, member, "overrides", parentId === "" ? key : `${parentId}>${key}`);
      else walk(nested, pathDigest(`${parentId}\u0000${key}`), name);
    }
  };
  const overrides = membersOf(root.get("overrides")?.value);
  if (overrides !== null) walk(overrides, "", "");
  for (const [key, member] of membersOf(root.get("resolutions")?.value) ?? []) {
    add(yarnTarget(key), member, "resolutions", key);
  }
  const pnpm = membersOf(root.get("pnpm")?.value);
  for (const [key, member] of membersOf(pnpm?.get("overrides")?.value) ?? []) {
    add(pnpmTarget(key), member, "pnpm.overrides", key);
  }
  return { ecosystem: "npm", deps, indexes: [] };
}
