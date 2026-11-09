import { ConfigError } from "../config.js";
import { POLICY_PATTERNS } from "../policy/grammar.js";
import { POLICY_MAX_ALLOWED_HOSTS, POLICY_MAX_HOST } from "../policy/limits.js";

const HOST = new RegExp(POLICY_PATTERNS.HOST, "u");

/**
 * Whether `text` is a registry host name as `dependency-allowed-hosts` and the org policy's
 * `dependencies.allowed_hosts` take one: 1 to 253 ASCII letters, digits, `.` and `-`. No scheme, path, port, user name
 * or wildcard fits; the same grammar as `schema/policy.v1.json`'s `$defs.host`.
 */
export function isRegistryHostName(text: string): boolean {
  return text.length >= 1 && text.length <= POLICY_MAX_HOST && HOST.test(text);
}

/**
 * The allowed registry hosts of the `dependency-allowed-hosts` input or the `--dependency-allowed-host` flag: each entry
 * trimmed, empty entries skipped, then lower-cased and de-duplicated (first occurrence kept). An entry that is not a
 * host name, or more than 50 entries, throws a `ConfigError` that names `label` and what a host name is, and names a bad
 * entry by its position, never by its value (the value may be a URL with a token in it).
 */
export function parseAllowedHosts(entries: readonly string[], label: string): string[] {
  const hosts: string[] = [];
  entries.forEach((entry, index) => {
    const host = entry.trim();
    if (host === "") return;
    if (!isRegistryHostName(host)) {
      throw new ConfigError(
        `${label}: entry ${String(index + 1)} is not a host name; give each registry host by name only ` +
          `(${String(POLICY_MAX_HOST)} characters at most: the letters A-Z and a-z, digits, . and -), ` +
          "with no scheme, path, port, user name or wildcard",
      );
    }
    hosts.push(host.toLowerCase());
  });
  const unique = [...new Set(hosts)];
  if (hosts.length > POLICY_MAX_ALLOWED_HOSTS) {
    throw new ConfigError(`${label}: at most ${String(POLICY_MAX_ALLOWED_HOSTS)} host names may be given`);
  }
  return unique;
}
