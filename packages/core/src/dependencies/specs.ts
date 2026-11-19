import type { LockSource, SourceKind } from "./types.js";
import { isAllowedRegistryUrl } from "./urls.js";

const GIT_PREFIXES = ["git+", "git:", "git@", "github:", "gitlab:", "bitbucket:", "gist:"];
const FILE_PREFIXES = ["file:", "link:", "portal:", "./", "../", "/", "~/", "exec:"];

/** The registry `jsr:` specs install from (npm, pnpm and yarn fetch them as `@jsr/…` packages there). */
export const JSR_REGISTRY_URL = "https://npm.jsr.io/";

/** Where an npm spec points; `url` and `registry` are set for `jsr:` only. */
export interface NpmSpecClass {
  kind: SourceKind;
  allowedUrl?: boolean;
  /** For `jsr:`: the registry URL, so an allowed host `npm.jsr.io` can accept it. */
  url?: string;
  /** For `jsr:`: names the registry in the D05 detail. */
  registry?: "jsr";
}

const isAsciiLetter = (c: number) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

/**
 * Where an npm dependency spec points: a registry (a semver range, a dist-tag, `npm:` aliases, `workspace:`, `catalog:`
 * and yarn's `patch:`), a git repository (`git+…`, `git:`, `github:` and the other hosted-git prefixes, `ssh:`, the
 * `user@host:path` form and the `owner/repo` shorthand), a URL (an http or https tarball, `https:host/x`, any other
 * scheme, and `jsr:`, which installs from `npm.jsr.io`) or a local path (`file:`, `link:`, `portal:`, a relative,
 * absolute or Windows path, a bare `.tgz`). By prefix only, case-insensitive. After the registry protocols, any spec that
 * holds a `:` or a `/` is off the registry: a semver range and a dist-tag hold neither (CORE-115).
 */
export function classifyNpmSpec(spec: string): NpmSpecClass {
  const text = spec.trim();
  const lower = text.toLowerCase();
  if (GIT_PREFIXES.some((prefix) => lower.startsWith(prefix))) return { kind: "git" };
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return { kind: "url", allowedUrl: isAllowedRegistryUrl(text) };
  }
  if (FILE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return { kind: "file" };
  if (lower.startsWith("npm:") || lower.startsWith("workspace:") || lower.startsWith("catalog:")) {
    return { kind: "registry" };
  }
  if (lower.startsWith("patch:")) return { kind: "registry" };
  if (lower.startsWith("jsr:")) return { kind: "url", allowedUrl: false, url: JSR_REGISTRY_URL, registry: "jsr" };
  // A `#ref` (`owner/repo#semver:^1`) is a git committish; the `:` and `/` that matter come before it.
  const hash = text.indexOf("#");
  const colon = (hash === -1 ? text : text.slice(0, hash)).indexOf(":");
  if (colon !== -1) {
    // `C:\x` and `C:/x`: a Windows path.
    if (colon === 1 && isAsciiLetter(text.charCodeAt(0)) && (text[2] === "\\" || text[2] === "/")) {
      return { kind: "file" };
    }
    // `ssh://…`, and `user@host:path` (git's scp-like form): an `@` before the first `:`.
    if (lower.startsWith("ssh:") || text.slice(0, colon).includes("@")) return { kind: "git" };
    // `https:host/x`, `http:host/x` and every other scheme: a URL, never on an allowed registry (no `//`).
    return { kind: "url", allowedUrl: isAllowedRegistryUrl(text) };
  }
  if (text.includes("/")) {
    // `@scope/x` as a spec is a local path to npm; `owner/repo` and `owner/repo#ref` are GitHub.
    return { kind: text.startsWith("@") ? "file" : "git" };
  }
  // A `:` only after a `#`: no registry version holds one either.
  if (text.includes(":")) return { kind: "url", allowedUrl: false };
  if (lower.endsWith(".tgz") || lower.endsWith(".tar.gz")) return { kind: "file" };
  return { kind: "registry" };
}

/**
 * The source of a lockfile's resolved location (npm `resolved`, yarn `resolved`, a pnpm `tarball`, a Python source URL):
 * an http or https URL (allowed when it is https on a registry host), a git location, or anything else, which is a
 * local path.
 */
export function sourceOfResolved(text: string): LockSource {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (GIT_PREFIXES.some((prefix) => lower.startsWith(prefix)) || lower.startsWith("ssh://")) {
    return { kind: "git", text: trimmed };
  }
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return { kind: "url", allowed: isAllowedRegistryUrl(trimmed), text: trimmed };
  }
  return { kind: "file", text: trimmed };
}

/** Whether a D05 finding applies to a declared spec: any non-registry kind, except an https URL on a registry host. */
export function isOffRegistry(kind: SourceKind, allowedUrl: boolean | undefined): boolean {
  if (kind === "registry") return false;
  if (kind === "url") return allowedUrl !== true;
  return true;
}
