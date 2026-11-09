import { normalizePypiName } from "./names.js";
import { isTable, parseToml, type TomlValue } from "./toml.js";
import type { IndexOption, ManifestDependency, ParsedManifest, SourceKind } from "./types.js";
import { isAllowedRegistryUrl } from "./urls.js";

const VCS_PREFIXES = ["git+", "hg+", "svn+", "bzr+"];
const ARCHIVE_SUFFIXES = [".whl", ".tar.gz", ".tgz", ".zip", ".tar.bz2"];

const isNameChar = (c: string) =>
  (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "." || c === "_" || c === "-";

/** Where a Python direct reference points: a VCS location, an http(s) URL (allowed on a registry host) or a local file. */
function urlKind(url: string): { kind: SourceKind; allowedUrl?: boolean } {
  const lower = url.toLowerCase();
  if (VCS_PREFIXES.some((prefix) => lower.startsWith(prefix))) return { kind: "git" };
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return { kind: "url", allowedUrl: isAllowedRegistryUrl(url) };
  }
  return { kind: "file" };
}

const isArchive = (text: string) => ARCHIVE_SUFFIXES.some((suffix) => text.toLowerCase().endsWith(suffix));

/**
 * One PEP 508 requirement (or a requirements-file line): `name[extras] spec ; marker`, `name @ url`, a bare URL or VCS
 * location, or a local archive. A local directory (`.`, `./pkg`) is the project or a vendored package and is not a
 * dependency here (null), and so is text with no name.
 */
export function parseRequirement(text: string, line: number, section: string): ManifestDependency | null {
  const t = text.trim();
  if (t === "") return null;
  const lower = t.toLowerCase();
  const startsWithUrl =
    VCS_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("file:");
  if (startsWithUrl || t.startsWith(".") || t.startsWith("/") || t.startsWith("~")) {
    if (!startsWithUrl && !isArchive(t)) return null;
    const egg = t.indexOf("#egg=");
    const name =
      egg === -1
        ? ""
        : (t
            .slice(egg + 5)
            .split("&")[0]
            ?.trim() ?? "");
    const kind = startsWithUrl ? urlKind(t) : { kind: "file" as const };
    return {
      name: name === "" ? t : name,
      named: name !== "",
      spec: t,
      section,
      line,
      kind: kind.kind,
      ...(kind.kind === "url" ? { allowedUrl: kind.allowedUrl === true, url: t } : {}),
    };
  }
  let at = 0;
  while (at < t.length && isNameChar(t[at] as string)) at++;
  if (at === 0) return null;
  const name = t.slice(0, at);
  let rest = t.slice(at).trimStart();
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    rest = close === -1 ? "" : rest.slice(close + 1).trimStart();
  }
  const semicolon = rest.indexOf(";");
  const body = (semicolon === -1 ? rest : rest.slice(0, semicolon)).trim();
  if (body.startsWith("@")) {
    const url = body.slice(1).trim();
    const kind = urlKind(url);
    return {
      name,
      named: true,
      spec: url,
      section,
      line,
      kind: kind.kind,
      ...(kind.kind === "url" ? { allowedUrl: kind.allowedUrl === true, url } : {}),
    };
  }
  const spec = body.startsWith("(") && body.endsWith(")") ? body.slice(1, -1).trim() : body;
  return { name, named: true, spec, section, line, kind: "registry" };
}

const INDEX_OPTIONS = new Set(["-i", "--index-url", "--extra-index-url", "-f", "--find-links"]);
const EDITABLE_OPTIONS = new Set(["-e", "--editable"]);

/** `-x value`, `--xx=value` or `--xx value` of a requirements-file option line. */
function optionOf(text: string): { option: string; arg: string } {
  const eq = text.indexOf("=");
  const space = text.search(/[ \t]/);
  const cut = eq !== -1 && (space === -1 || eq < space) && text.startsWith("--") ? eq : space;
  if (cut === -1) return { option: text, arg: "" };
  return { option: text.slice(0, cut), arg: text.slice(cut + 1).trim() };
}

/** The text of a requirements-file line before a ` #` comment. */
function withoutComment(line: string): string {
  if (line.trimStart().startsWith("#")) return "";
  for (let i = 1; i < line.length; i++) {
    if (line[i] === "#" && (line[i - 1] === " " || line[i - 1] === "\t")) return line.slice(0, i);
  }
  return line;
}

/**
 * A pip requirements file: one requirement per logical line (a trailing `\` joins the next), `-e` editable
 * requirements, and the index options (`-i`, `--index-url`, `--extra-index-url`, `-f`, `--find-links`). `-r` and `-c`
 * includes are not followed (docs/LIMITS.md); per-requirement options such as `--hash` are cut off.
 */
export function parseRequirements(text: string): ParsedManifest {
  const deps: ManifestDependency[] = [];
  const indexes: IndexOption[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const start = i + 1;
    // The parts of one logical line, joined once: concatenating in the loop would copy the line on every continuation.
    let part = withoutComment((lines[i] as string).replace(/\r$/, ""));
    const parts: string[] = [];
    while (part.endsWith("\\") && i + 1 < lines.length) {
      parts.push(part.slice(0, -1));
      i++;
      part = withoutComment((lines[i] as string).replace(/\r$/, ""));
    }
    parts.push(part);
    const t = parts.join(" ").trim();
    if (t === "") continue;
    if (t.startsWith("-")) {
      const { option, arg } = optionOf(t);
      if (INDEX_OPTIONS.has(option) && arg !== "") {
        indexes.push({ url: arg, line: start, allowed: isAllowedRegistryUrl(arg) });
      } else if (EDITABLE_OPTIONS.has(option) && arg !== "") {
        const dep = parseRequirement(arg, start, "requirements");
        if (dep !== null) deps.push(dep);
      }
      continue;
    }
    const options = t.search(/[ \t]--?[a-z]/);
    const dep = parseRequirement(options === -1 ? t : t.slice(0, options), start, "requirements");
    if (dep !== null) deps.push(dep);
  }
  return { ecosystem: "pypi", deps, indexes };
}

/** The requirement strings of a TOML array, each with its line. */
function requirementStrings(value: TomlValue | undefined): Array<{ text: string; line: number }> {
  if (value === undefined || value.type !== "array") return [];
  return value.items.flatMap((item) => (item.type === "string" ? [{ text: item.value, line: item.line }] : []));
}

/** A poetry dependency (`name = "^1.0"` or `name = { version = …, git = … }`) or a uv source (`name = { git = … }`). */
function tableDependency(name: string, value: TomlValue, section: string): ManifestDependency | null {
  if (value.type === "string")
    return { name, named: true, spec: value.value, section, line: value.line, kind: "registry" };
  if (value.type === "array") return { name, named: true, spec: "", section, line: value.line, kind: "registry" };
  if (value.type !== "table") return null;
  const text = (key: string): string | null => {
    const entry = value.entries.get(key);
    return entry !== undefined && entry.type === "string" ? entry.value : null;
  };
  const git = text("git");
  if (git !== null) return { name, named: true, spec: `git:${git}`, section, line: value.line, kind: "git" };
  const url = text("url");
  if (url !== null) {
    const kind = urlKind(url);
    return {
      name,
      named: true,
      spec: `url:${url}`,
      section,
      line: value.line,
      kind: kind.kind,
      ...(kind.kind === "url" ? { allowedUrl: kind.allowedUrl === true, url } : {}),
    };
  }
  const path = text("path") ?? text("file");
  if (path !== null) {
    return isArchive(path)
      ? { name, named: true, spec: `path:${path}`, section, line: value.line, kind: "file" }
      : null;
  }
  return { name, named: true, spec: text("version") ?? "", section, line: value.line, kind: "registry" };
}

/**
 * The dependencies of a pyproject.toml: `[project] dependencies`, `[project.optional-dependencies]`,
 * `[dependency-groups]`, poetry's `[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]` and
 * `[tool.poetry.group.<name>.dependencies]` (not `python`), and uv's `[tool.uv.sources]`. Null when the TOML cannot be
 * read.
 */
export function parsePyproject(text: string): ParsedManifest | null {
  const tables = parseToml(text);
  if (tables === null) return null;
  const deps: ManifestDependency[] = [];
  const add = (dep: ManifestDependency | null) => {
    if (dep !== null) deps.push(dep);
  };
  for (const table of tables) {
    if (isTable(table, ["project"])) {
      for (const item of requirementStrings(table.entries.get("dependencies"))) {
        add(parseRequirement(item.text, item.line, "project.dependencies"));
      }
    } else if (isTable(table, ["project", "optional-dependencies"]) || isTable(table, ["dependency-groups"])) {
      for (const [group, value] of table.entries) {
        for (const item of requirementStrings(value)) {
          add(parseRequirement(item.text, item.line, `${table.path.join(".")}.${group}`));
        }
      }
    } else if (
      isTable(table, ["tool", "poetry", "dependencies"]) ||
      isTable(table, ["tool", "poetry", "dev-dependencies"]) ||
      (table.path.length === 5 &&
        table.path[0] === "tool" &&
        table.path[1] === "poetry" &&
        table.path[2] === "group" &&
        table.path[4] === "dependencies") ||
      isTable(table, ["tool", "uv", "sources"])
    ) {
      for (const [name, value] of table.entries) {
        if (name === "python" && table.path[1] === "poetry") continue;
        add(tableDependency(name, value, table.path.join(".")));
      }
    }
  }
  return { ecosystem: "pypi", deps, indexes: [] };
}

/** The normalized name of a Python dependency, for comparing a manifest with a lockfile. */
export function pythonKey(name: string): string {
  return normalizePypiName(name);
}
