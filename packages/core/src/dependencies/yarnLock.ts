import { splitKey, unquoteScalar } from "./pnpmLock.js";
import { sourceOfResolved } from "./specs.js";
import type { LockEntry, LockSource, ParsedLockfile } from "./types.js";

/**
 * The specs of a yarn.lock header line without its colon: classic quotes each spec (`"a@^1", a@^1.2`), berry quotes the
 * whole list (`"a@npm:^1, a@npm:^1.2"`). A spec never holds a comma, so the header splits at every comma.
 */
function headerSpecs(header: string): string[] {
  return header
    .split(",")
    .map((part) => {
      let spec = part.trim();
      if (spec.startsWith('"')) spec = spec.slice(1);
      if (spec.endsWith('"')) spec = spec.slice(0, -1);
      return spec.trim();
    })
    .filter((spec) => spec !== "");
}

/** The package name of a `name@range` spec (the `@` of a scope is not the separator). */
export function nameOfSpec(spec: string): string | null {
  const at = spec.indexOf("@", 1);
  return at <= 0 ? null : spec.slice(0, at);
}

/** The source of a berry `resolution: "name@protocol:…"`. */
function berrySource(resolution: string): LockSource {
  const name = nameOfSpec(resolution);
  let rest = name === null ? resolution : resolution.slice(name.length + 1);
  // A virtual package wraps the locator after `#`.
  if (rest.startsWith("virtual:")) {
    const hash = rest.indexOf("#");
    rest = hash === -1 ? rest : rest.slice(hash + 1);
  }
  const lower = rest.toLowerCase();
  if (lower.startsWith("npm:") || lower.startsWith("patch:")) return { kind: "registry" };
  if (lower.startsWith("workspace:")) return { kind: "link" };
  return sourceOfResolved(rest);
}

/**
 * A yarn.lock, classic (v1) or berry (`__metadata`). Each header line at column 0 starts an entry keyed by the header;
 * its two-space fields give the version, the integrity (v1) or checksum (berry) and the source (`resolved` in v1,
 * `resolution` in berry; `linkType: soft` is a workspace link). `specs` holds every `name@spec` a header names. Null when
 * no entry was found in a non-empty file.
 */
export function parseYarnLock(text: string): ParsedLockfile | null {
  const lines = text.split("\n");
  const berry = lines.some((line) => line.startsWith("__metadata:"));
  const entries: LockEntry[] = [];
  const specs = new Set<string>();
  let current: { key: string; line: number; fields: Map<string, string> } | null = null;
  const finish = () => {
    if (current === null || current.key === "__metadata") return;
    const fields = current.fields;
    const firstSpec = headerSpecs(current.key)[0] ?? "";
    let source: LockSource;
    if (berry) {
      const resolution = fields.get("resolution");
      source =
        fields.get("linkType") === "soft"
          ? { kind: "link" }
          : resolution === undefined
            ? { kind: "registry" }
            : berrySource(resolution);
    } else {
      const resolved = fields.get("resolved");
      source = resolved === undefined ? { kind: "registry" } : sourceOfResolved(resolved);
    }
    entries.push({
      key: current.key,
      name: nameOfSpec(firstSpec),
      version: fields.get("version") ?? null,
      integrity: fields.get(berry ? "checksum" : "integrity") ?? null,
      source,
      line: current.line,
    });
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "" || line.startsWith("#")) continue;
    if (!line.startsWith(" ")) {
      finish();
      const header = line.trimEnd().endsWith(":") ? line.trimEnd().slice(0, -1) : line.trimEnd();
      current = { key: header, line: i + 1, fields: new Map() };
      for (const spec of headerSpecs(header)) specs.add(spec);
      continue;
    }
    if (current === null || !line.startsWith("  ") || line.startsWith("   ")) continue;
    const content = line.slice(2).trimEnd();
    if (berry) {
      const pair = splitKey(content);
      if (pair !== null && pair.value !== "") current.fields.set(pair.key, unquoteScalar(pair.value));
    } else {
      const space = content.indexOf(" ");
      if (space > 0)
        current.fields.set(unquoteScalar(content.slice(0, space)), unquoteScalar(content.slice(space + 1)));
    }
  }
  finish();
  if (entries.length === 0 && text.trim() !== "" && !berry && !text.includes("yarn lockfile")) return null;
  return { ecosystem: "npm", format: berry ? "yarn-berry" : "yarn", entries, importers: null, specs, names: null };
}
