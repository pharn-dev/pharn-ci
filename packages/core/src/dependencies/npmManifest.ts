import { type JsonMember, type JsonValue, parseSettingsJson } from "../policy/settings/json.js";
import { classifyNpmSpec } from "./specs.js";
import type { ManifestDependency, ParsedManifest } from "./types.js";

/** The dependency sections of package.json that dependency safety reads, in this order. */
export const NPM_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

/** The members of a JSON object value, or null when the value is not an object. */
export function membersOf(value: JsonValue | undefined): Map<string, JsonMember> | null {
  return value !== undefined && value.type === "object" ? value.members : null;
}

/**
 * The dependencies of a package.json: each string member of `dependencies`, `devDependencies`, `optionalDependencies`
 * and `peerDependencies`, with the line of its key and where its spec points. Null when the text is not a JSON object.
 */
export function parseNpmManifest(text: string): ParsedManifest | null {
  const parsed = parseSettingsJson(text, { jsonc: false });
  if (!parsed.ok) return null;
  const root = membersOf(parsed.value);
  if (root === null) return null;
  const deps: ManifestDependency[] = [];
  for (const section of NPM_SECTIONS) {
    const members = membersOf(root.get(section)?.value);
    if (members === null) continue;
    for (const [name, member] of members) {
      if (member.value.type !== "string") continue;
      const spec = member.value.value;
      const kind = classifyNpmSpec(spec);
      deps.push({
        name,
        named: true,
        spec,
        section,
        line: member.keyLine,
        kind: kind.kind,
        ...(kind.allowedUrl === undefined ? {} : { allowedUrl: kind.allowedUrl }),
        ...(kind.kind === "url" ? { url: spec.trim() } : {}),
      });
    }
  }
  return { ecosystem: "npm", deps, indexes: [] };
}
