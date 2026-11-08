import type { LockSource, SourceKind } from "./types.js";
import { isAllowedRegistryUrl } from "./urls.js";

const GIT_PREFIXES = ["git+", "git:", "git@", "github:", "gitlab:", "bitbucket:", "gist:"];
const FILE_PREFIXES = ["file:", "link:", "portal:", "./", "../", "/", "~/", "exec:"];

/**
 * Where an npm dependency spec points: a registry (a semver range, a dist-tag, `npm:` aliases, `workspace:`, `catalog:`
 * and yarn's `patch:`), a git repository (`git+…`, `git:`, `github:` and the other hosted-git prefixes, and the
 * `owner/repo` shorthand), a URL (an http or https tarball) or a local path (`file:`, `link:`, `portal:`, a relative or
 * absolute path). By prefix only, case-insensitive.
 */
export function classifyNpmSpec(spec: string): { kind: SourceKind; allowedUrl?: boolean } {
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
  // `owner/repo` and `owner/repo#ref`: a range or a tag never holds a `/`.
  if (text.includes("/") && !text.startsWith("@") && !text.includes(":")) return { kind: "git" };
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
