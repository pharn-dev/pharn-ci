import { readJson } from "../testConfig/readJson.js";

/**
 * Stale instructions (H3, SI01): what the root `package.json` and the root `Makefile` define, read from their committed
 * text. Pure; never throws.
 */

/** The scripts of a `package.json`, and the names a `pnpm <name>` or `yarn <name>` may run as an installed binary. */
export interface PackageScripts {
  scripts: ReadonlySet<string>;
  /** Dependency names and the part of each after its last `/` (`@biomejs/biome` gives `biome`), plus common binaries. */
  binaries: ReadonlySet<string>;
}

/** Binaries whose name differs from their package's; `pnpm <one>` runs the binary, never a missing script. */
const COMMON_BINARIES: readonly string[] = [
  "tsc",
  "tsx",
  "tsgo",
  "ts-node",
  "eslint",
  "prettier",
  "biome",
  "oxlint",
  "jest",
  "vitest",
  "mocha",
  "ava",
  "c8",
  "nyc",
  "playwright",
  "cypress",
  "next",
  "nuxt",
  "vite",
  "astro",
  "svelte-kit",
  "turbo",
  "nx",
  "lerna",
  "changeset",
  "tsup",
  "rollup",
  "webpack",
  "esbuild",
  "nodemon",
  "husky",
  "lint-staged",
  "knip",
  "prisma",
  "drizzle-kit",
  "storybook",
  "rimraf",
  "concurrently",
  "cross-env",
  "wrangler",
  "vercel",
  "expo",
  "ng",
  "node",
  "corepack",
];

const DEPENDENCY_KEYS: readonly string[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

/**
 * The scripts and binaries of a `package.json` text, or null when it is not a JSON object (too large, too deep or not
 * JSON): then no script can be called missing.
 */
export function parsePackageScripts(text: string): PackageScripts | null {
  const read = readJson(text);
  if (!read.ok) return null;
  const root = read.root;
  if (root === null || root.type !== "object") return null;
  const scripts = new Set<string>();
  const binaries = new Set<string>(COMMON_BINARIES);
  const scriptsEntry = root.entries.get("scripts")?.value;
  if (scriptsEntry !== undefined && scriptsEntry.type === "object") {
    for (const name of scriptsEntry.entries.keys()) scripts.add(name);
  }
  for (const key of DEPENDENCY_KEYS) {
    const entry = root.entries.get(key)?.value;
    if (entry === undefined || entry.type !== "object") continue;
    for (const name of entry.entries.keys()) {
      binaries.add(name);
      binaries.add(name.slice(name.lastIndexOf("/") + 1));
    }
  }
  return { scripts, binaries };
}

/** The most code units of a Makefile that are read; a longer one is not judged. */
export const MAX_MAKEFILE_CHARS = 512 * 1024;

const isSpaceCode = (code: number) => code === 32 || code === 9;

/**
 * The targets a root `Makefile` defines, or null when that cannot be told: the text is too large, it includes other
 * makefiles (`include`, `-include`, `sinclude`), or it has a pattern rule (`%`) or a target built from a variable
 * (`$`), any of which may define a target no line names. A target line is a line that does not start with a tab or
 * `#`, whose first `:` is not part of `:=` or `::=`, with no `=` before it; each word before the `:` is a target.
 */
export function parseMakeTargets(text: string): ReadonlySet<string> | null {
  if (text.length > MAX_MAKEFILE_CHARS) return null;
  const targets = new Set<string>();
  let continued = false;
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const wasContinued = continued;
    continued = line.endsWith("\\");
    if (wasContinued || line === "" || line.startsWith("\t") || line.startsWith("#")) continue;
    let lead = 0;
    while (lead < line.length && isSpaceCode(line.charCodeAt(lead))) lead++;
    const body = line.slice(lead);
    if (
      body.startsWith("include ") ||
      body.startsWith("-include ") ||
      body.startsWith("sinclude ") ||
      body.startsWith("include\t")
    ) {
      return null;
    }
    const colon = body.indexOf(":");
    if (colon <= 0) continue;
    const equals = body.indexOf("=");
    if (equals !== -1 && equals < colon) continue;
    if (body[colon + 1] === "=" || (body[colon + 1] === ":" && body[colon + 2] === "=")) continue;
    const head = body.slice(0, colon);
    for (const word of head.split(/[ \t]/)) {
      if (word === "") continue;
      if (word.includes("%") || word.includes("$")) return null;
      targets.add(word);
    }
  }
  return targets;
}
