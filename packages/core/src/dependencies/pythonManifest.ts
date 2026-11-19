import { normalizePypiName } from "./names.js";
import { parseTomlDocument, type TomlTableValue, type TomlValue, valueAt } from "./toml.js";
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

/**
 * The pip versions whose requirements-file options differ, as bits: pip 20.3 to 23.0 (`--install-option` and
 * `--global-option`), 23.3 to 25.0 (`--global-option`, `-C`), 25.3 (`-C`) and 26.3 (`-C`, `--no-require-hashes`,
 * `--all-releases`, `--only-final`). Each set was read from that version's `req_file.build_parser()`.
 */
const PIP_20 = 1;
const PIP_23 = 2;
const PIP_25 = 4;
const PIP_26 = 8;
const PIP_VERSIONS = [PIP_20, PIP_23, PIP_25, PIP_26];
const EVERY_PIP = PIP_20 | PIP_23 | PIP_25 | PIP_26;

/** One option pip's requirements-file parser knows: its spellings, whether it takes a value, what D05 reads from it. */
interface PipOption {
  short: string[];
  long: string[];
  value: boolean;
  role: "index" | "editable" | "other";
  pip: number;
}

const pipOption = (
  names: string[],
  value: boolean,
  role: PipOption["role"] = "other",
  pip: number = EVERY_PIP,
): PipOption => ({
  short: names.filter((name) => !name.startsWith("--")),
  long: names.filter((name) => name.startsWith("--")),
  value,
  role,
  pip,
});

/** pip's `SUPPORTED_OPTIONS` and `SUPPORTED_OPTIONS_REQ` (pip/_internal/req/req_file.py), pip 20.3 to 26.3. */
const PIP_OPTIONS: readonly PipOption[] = [
  pipOption(["-i", "--index-url", "--pypi-url"], true, "index"),
  pipOption(["--extra-index-url"], true, "index"),
  pipOption(["--no-index"], false),
  pipOption(["-c", "--constraint"], true),
  pipOption(["-r", "--requirement"], true),
  pipOption(["-e", "--editable"], true, "editable"),
  pipOption(["-f", "--find-links"], true, "index"),
  pipOption(["--no-binary"], true),
  pipOption(["--only-binary"], true),
  pipOption(["--prefer-binary"], false),
  pipOption(["--require-hashes"], false),
  pipOption(["--no-require-hashes"], false, "other", PIP_26),
  pipOption(["--pre"], false),
  pipOption(["--all-releases"], true, "other", PIP_26),
  pipOption(["--only-final"], true, "other", PIP_26),
  pipOption(["--trusted-host"], true),
  pipOption(["--use-feature"], true),
  pipOption(["--install-option"], true, "other", PIP_20),
  pipOption(["--global-option"], true, "other", PIP_20 | PIP_23),
  pipOption(["--hash"], true),
  pipOption(["-C", "--config-settings"], true, "other", PIP_23 | PIP_25 | PIP_26),
];

/**
 * The option a long option name means, the way optparse resolves it (an exact name, else the one name it is a prefix
 * of), in any pip version: a name that one version reads as an index option is read as one. Null when no version
 * resolves it, or versions resolve it to different options.
 */
function longOption(name: string): PipOption | null {
  const found = new Set<PipOption>();
  for (const version of PIP_VERSIONS) {
    const options = PIP_OPTIONS.filter((option) => (option.pip & version) !== 0);
    const exact = options.find((option) => option.long.includes(name));
    if (exact !== undefined) {
      found.add(exact);
      continue;
    }
    const matches = options.flatMap((option) => option.long.filter((long) => long.startsWith(name)).map(() => option));
    if (matches.length === 1) found.add(matches[0] as PipOption);
  }
  return found.size === 1 ? ([...found][0] as PipOption) : null;
}

const shortOption = (letter: string): PipOption | null =>
  PIP_OPTIONS.find((option) => option.short.includes(`-${letter}`)) ?? null;

/**
 * The words of an option line as Python's `shlex.split` makes them (POSIX mode): split at white space, `'…'` literal,
 * `"…"` with `\"` and `\\` escapes, `\x` outside quotes. Null on an unclosed quote or a trailing `\`, which pip refuses.
 */
function shellWords(text: string): string[] | null {
  const words: string[] = [];
  let word: string[] = [];
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      if (inWord) words.push(word.join(""));
      word = [];
      inWord = false;
      continue;
    }
    inWord = true;
    if (c === "\\") {
      if (i + 1 >= text.length) return null;
      word.push(text[++i] as string);
    } else if (c === "'") {
      const close = text.indexOf("'", i + 1);
      if (close === -1) return null;
      word.push(text.slice(i + 1, close));
      i = close;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === "\\" && (text[j + 1] === '"' || text[j + 1] === "\\")) j++;
        word.push(text[j] as string);
      }
      if (j >= text.length) return null;
      i = j;
    } else {
      word.push(c);
    }
  }
  if (inWord) words.push(word.join(""));
  return words;
}

/**
 * The index URLs and editable requirements of an option line, read the way pip's optparse reads them: several options
 * on one line, a long option by its unique prefix, `--name=value` or `--name value`, a value attached to a short option
 * (`-ihttps://…`) or in the next word, `--` ending the options. Null when pip would refuse the line: an option no pip
 * version knows or one prefix of several options, a missing value, a value given to a flag, or a broken quote.
 */
function optionLine(text: string): { indexes: string[]; editables: string[] } | null {
  const words = shellWords(text);
  if (words === null) return null;
  const read = { indexes: [] as string[], editables: [] as string[] };
  const take = (option: PipOption, value: string) => {
    if (value === "") return;
    if (option.role === "index") read.indexes.push(value);
    else if (option.role === "editable") read.editables.push(value);
  };
  for (let k = 0; k < words.length; k++) {
    const word = words[k] as string;
    if (word === "--") break;
    if (word.startsWith("--")) {
      const eq = word.indexOf("=");
      const option = longOption(eq === -1 ? word : word.slice(0, eq));
      if (option === null) return null;
      if (!option.value) {
        if (eq !== -1) return null;
        continue;
      }
      if (eq !== -1) take(option, word.slice(eq + 1));
      else if (k + 1 < words.length) take(option, words[++k] as string);
      else return null;
    } else if (word.startsWith("-") && word.length > 1) {
      for (let c = 1; c < word.length; c++) {
        const option = shortOption(word[c] as string);
        if (option === null) return null;
        if (!option.value) continue;
        if (c + 1 < word.length) take(option, word.slice(c + 1));
        else if (k + 1 < words.length) take(option, words[++k] as string);
        else return null;
        break;
      }
    }
    // Any other word is a positional argument, which pip drops from an option line.
  }
  return read;
}

/** The text with every `\` at its start and end cut off (Python's `str.strip("\\")`). */
function withoutBackslashes(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "\\") start++;
  while (end > start && text[end - 1] === "\\") end--;
  return text.slice(start, end);
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
 * requirements, and the index options (`-i`, `--index-url`, `--pypi-url`, `--extra-index-url`, `-f`, `--find-links`),
 * each in every spelling pip accepts (see `optionLine`). `-r` and `-c` includes are not followed (docs/LIMITS.md);
 * per-requirement options such as `--hash` are cut off. Null when an option line is one pip would refuse, so the file is
 * named unread rather than judged on the lines around it.
 */
export function parseRequirements(text: string): ParsedManifest | null {
  const deps: ManifestDependency[] = [];
  const indexes: IndexOption[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const start = i + 1;
    // The parts of one logical line, joined once: concatenating in the loop would copy the line on every continuation.
    let part = withoutComment((lines[i] as string).replace(/\r$/, ""));
    const parts: string[] = [];
    // A line that ends in `\` is joined to the next (the last line too) with every `\` at either end cut off, and with
    // nothing between, as pip joins them: `-\` then `ihttps://…` is the option `-ihttps://…`.
    while (part.endsWith("\\")) {
      parts.push(withoutBackslashes(part));
      if (i + 1 >= lines.length) {
        part = "";
        break;
      }
      i++;
      part = withoutComment((lines[i] as string).replace(/\r$/, ""));
    }
    parts.push(part);
    const t = parts.join("").trim();
    if (t === "") continue;
    if (t.startsWith("-")) {
      const read = optionLine(t);
      if (read === null) return null;
      for (const url of read.indexes) indexes.push({ url, line: start, allowed: isAllowedRegistryUrl(url) });
      for (const editable of read.editables) {
        const dep = parseRequirement(editable, start, "requirements");
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

/**
 * A poetry dependency (`name = "^1.0"`, or a table: `name = { version = …, git = … }`, the sub-table
 * `[….dependencies.name]` or dotted keys, which are one table in the document) or a uv source (`name = { git = … }`).
 * An array of tables (uv's multiple sources, poetry's multiple constraints) is one dependency per item, each at its own
 * line; the second and later items carry a `key` so the items of one name stay apart. An array with no table in it is
 * one dependency with no spec.
 */
function tableDependencies(name: string, value: TomlValue, section: string): ManifestDependency[] {
  if (value.type !== "array") {
    const dep = tableDependency(name, value, section);
    return dep === null ? [] : [dep];
  }
  if (!value.items.some((item) => item.type === "table")) {
    return [{ name, named: true, spec: "", section, line: value.line, kind: "registry" }];
  }
  return value.items.flatMap((item, i) => {
    const dep = item.type === "table" ? tableDependency(name, item, section) : null;
    if (dep === null) return [];
    return [i === 0 ? dep : { ...dep, key: `${name}\u0000${i}` }];
  });
}

/** One poetry dependency or uv source that is a string or a table (see `tableDependencies`). */
function tableDependency(name: string, value: TomlValue, section: string): ManifestDependency | null {
  if (value.type === "string")
    return { name, named: true, spec: value.value, section, line: value.line, kind: "registry" };
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

/** The value at `path` when it is a table. */
function tableAt(root: TomlTableValue, path: readonly string[]): TomlTableValue | null {
  const value = valueAt(root, path);
  return value?.type === "table" ? value : null;
}

/** The section of the build requirements: installed and run at build time, recorded by no lockfile (so D04 skips it). */
export const BUILD_REQUIRES_SECTION = "build-system.requires";

/**
 * The dependencies and package indexes of a pyproject.toml, read from the nested TOML document, so a table written as a
 * `[header]`, an inline table or dotted keys is the same table (a poetry dependency in its own sub-table
 * `[tool.poetry.dependencies.name]` is the inline table it equals). Dependencies: `[build-system] requires`,
 * `[project] dependencies`, `[project.optional-dependencies]`, `[dependency-groups]`, poetry's
 * `[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]` and `[tool.poetry.group.<name>.dependencies]` (not
 * `python`), and uv's `[tool.uv.sources]`, in file order. Indexes: the `url` of each `[[tool.poetry.source]]` and
 * `[[tool.uv.index]]` (whatever their `priority`, `explicit` or `default`), and uv's `index-url`, `extra-index-url` and
 * `find-links` in `[tool.uv]` and `[tool.uv.pip]`. Null when the TOML cannot be read.
 */
export function parsePyproject(text: string): ParsedManifest | null {
  const doc = parseTomlDocument(text);
  if (doc === null) return null;
  const { root } = doc;
  const deps: ManifestDependency[] = [];
  const requirements = (value: TomlValue | undefined, section: string) => {
    for (const item of requirementStrings(value)) {
      const dep = parseRequirement(item.text, item.line, section);
      if (dep !== null) deps.push(dep);
    }
  };
  const dependencyTable = (path: readonly string[]) => {
    const table = tableAt(root, path);
    if (table === null) return;
    const section = path.join(".");
    for (const [name, value] of table.entries) {
      if (name === "python" && path[1] === "poetry") continue;
      deps.push(...tableDependencies(name, value, section));
    }
  };

  requirements(valueAt(root, ["build-system", "requires"]), BUILD_REQUIRES_SECTION);
  requirements(valueAt(root, ["project", "dependencies"]), "project.dependencies");
  for (const path of [["project", "optional-dependencies"], ["dependency-groups"]]) {
    for (const [group, value] of tableAt(root, path)?.entries ?? []) requirements(value, `${path.join(".")}.${group}`);
  }
  dependencyTable(["tool", "poetry", "dependencies"]);
  dependencyTable(["tool", "poetry", "dev-dependencies"]);
  for (const group of tableAt(root, ["tool", "poetry", "group"])?.entries.keys() ?? []) {
    dependencyTable(["tool", "poetry", "group", group, "dependencies"]);
  }
  dependencyTable(["tool", "uv", "sources"]);

  const indexes: IndexOption[] = [];
  const index = (value: TomlValue | undefined, table: string) => {
    if (value?.type !== "string") return;
    indexes.push({ url: value.value, line: value.line, allowed: isAllowedRegistryUrl(value.value), table });
  };
  for (const path of [
    ["tool", "poetry", "source"],
    ["tool", "uv", "index"],
  ]) {
    const value = valueAt(root, path);
    const entries = value?.type === "array" ? value.items : value === undefined ? [] : [value];
    for (const entry of entries) if (entry.type === "table") index(entry.entries.get("url"), path.join("."));
  }
  for (const path of [
    ["tool", "uv"],
    ["tool", "uv", "pip"],
  ]) {
    const table = tableAt(root, path);
    if (table === null) continue;
    const prefix = path.join(".");
    index(table.entries.get("index-url"), `${prefix}.index-url`);
    for (const key of ["extra-index-url", "find-links"]) {
      const value = table.entries.get(key);
      for (const item of value?.type === "array" ? value.items : [value]) index(item, `${prefix}.${key}`);
    }
  }

  // Stable sorts: entries of one line keep the order they were read in.
  deps.sort((a, b) => a.line - b.line);
  indexes.sort((a, b) => a.line - b.line);
  return { ecosystem: "pypi", deps, indexes };
}

/** The normalized name of a Python dependency, for comparing a manifest with a lockfile. */
export function pythonKey(name: string): string {
  return normalizePypiName(name);
}
