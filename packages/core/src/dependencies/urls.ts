/**
 * The registry hosts a resolved or declared URL may point to without a D05 finding: the public npm and PyPI registries.
 * A URL counts as on a registry only when it is https, names one of these hosts exactly, and carries no user name,
 * password or port. A private registry is outside this list (docs/LIMITS.md).
 */
export const ALLOWED_RESOLVE_HOSTS: readonly string[] = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
];

/** The scheme and authority of a URL, by hand: `scheme://authority/...`; null when the text has no `://`. */
export function urlParts(url: string): { scheme: string; host: string; userinfo: boolean; port: boolean } | null {
  const sep = url.indexOf("://");
  if (sep <= 0) return null;
  const scheme = url.slice(0, sep).toLowerCase();
  for (let i = 0; i < scheme.length; i++) {
    const c = scheme.charCodeAt(i);
    const ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e;
    if (!ok) return null;
  }
  let end = url.length;
  for (const stop of ["/", "?", "#"]) {
    const at = url.indexOf(stop, sep + 3);
    if (at !== -1 && at < end) end = at;
  }
  let authority = url.slice(sep + 3, end);
  const at = authority.lastIndexOf("@");
  const userinfo = at !== -1;
  if (userinfo) authority = authority.slice(at + 1);
  const colon = authority.indexOf(":");
  const port = colon !== -1;
  const host = (port ? authority.slice(0, colon) : authority).toLowerCase();
  return { scheme, host, userinfo, port };
}

/** Whether a URL is https on one of `hosts` (default `ALLOWED_RESOLVE_HOSTS`) with no user name, password or port. */
export function isAllowedRegistryUrl(url: string, hosts: readonly string[] = ALLOWED_RESOLVE_HOSTS): boolean {
  const parts = urlParts(url.trim());
  if (parts === null) return false;
  return parts.scheme === "https" && !parts.userinfo && !parts.port && hosts.includes(parts.host);
}

/**
 * The hosts an allowed registry serves its package files from, by registry host, besides the registry host itself:
 * PyPI's simple index (`pypi.org`) links every sdist and wheel to `files.pythonhosted.org`. A lockfile that records a
 * file URL for a package (uv.lock's `sdist` and `wheels`) may point it at these hosts and no other public one.
 */
export const REGISTRY_FILE_HOSTS: ReadonlyMap<string, readonly string[]> = new Map([
  ["pypi.org", ["files.pythonhosted.org"]],
]);

/**
 * The hosts a package resolved from `registryUrl` may download its files from: the registry URL's own host and that
 * registry's file hosts (`REGISTRY_FILE_HOSTS`); empty when the URL names no host. A file URL is judged on these with
 * `isAllowedRegistryUrl`, so it must still be https with no user name, password or port.
 */
export function artifactHosts(registryUrl: string): string[] {
  const host = urlParts(registryUrl.trim())?.host ?? "";
  if (host === "") return [];
  return [host, ...(REGISTRY_FILE_HOSTS.get(host) ?? [])];
}
