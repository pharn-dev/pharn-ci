import { normalizePypiName } from "./names.js";
import type { DependencyEcosystem } from "./types.js";

/**
 * The only hosts a registry lookup may call (AGENTS.md rule 5, docs/THREAT-MODEL.md): the npm registry, the npm
 * downloads API and PyPI. GET only, the package name in the path and nothing else.
 */
export const REGISTRY_LOOKUP_HOSTS: readonly string[] = ["registry.npmjs.org", "api.npmjs.org", "pypi.org"];

/** The most bytes of a registry answer read; a longer one is refused unread (see `packageFacts`). */
export const REGISTRY_MAX_BODY_BYTES = 2_097_152;

/**
 * The URLs of one lookup. npm: the package document (`https://registry.npmjs.org/<name>`, the cheapest endpoint that
 * gives the first-publish time: the abbreviated document has no `time`) and the last week's downloads
 * (`https://api.npmjs.org/downloads/point/last-week/<name>`). PyPI: the project's JSON
 * (`https://pypi.org/pypi/<name>/json`, the name normalized). The name is percent-encoded; only an unscoped npm name
 * or a PyPI name that passed the report allow-list is ever looked up.
 */
export function registryLookupUrls(
  ecosystem: DependencyEcosystem,
  name: string,
): { package: string; downloads?: string } {
  if (ecosystem === "npm") {
    const encoded = encodeURIComponent(name);
    return {
      package: `https://registry.npmjs.org/${encoded}`,
      downloads: `https://api.npmjs.org/downloads/point/last-week/${encoded}`,
    };
  }
  return { package: `https://pypi.org/pypi/${encodeURIComponent(normalizePypiName(name))}/json` };
}

/** How one registry request ended: an answer (its body read only for a 200, only up to the cap), a timeout or a network error. */
export type RegistryAnswer =
  | { kind: "response"; status: number; body?: string; tooLarge?: boolean }
  | { kind: "timeout" }
  | { kind: "network" };

/** What a package lookup found. `firstPublished` is milliseconds since the epoch, or null when the answer did not say. */
export type PackageFacts =
  | { outcome: "found"; firstPublished: number | null }
  | { outcome: "not-found" }
  | { outcome: "unavailable" };

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Days from 1970-01-01 to a proleptic Gregorian date (Hinnant's days_from_civil). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * An ISO 8601 time as registries write it (`2011-11-01T01:08:13.613Z`, PyPI's `2020-01-01T00:00:00` in UTC, an offset
 * such as `+02:00`), as milliseconds since the epoch, to the second; null for anything else. By hand: core reads no
 * clock and uses no `Date`.
 */
export function parseIsoTime(text: string): number | null {
  if (text.length > 40) return null;
  const match = ISO_TIME.exec(text.trim());
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((i) => Number(match[i] ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;
  let offsetMinutes = 0;
  const zone = match[7];
  if (zone !== undefined && zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    offsetMinutes = (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * (zone.startsWith("-") ? -1 : 1);
  }
  const seconds = daysFromCivil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second - offsetMinutes * 60;
  return seconds * 1000;
}

/** The earliest of the time strings, as milliseconds, or null. */
function earliest(values: Iterable<unknown>): number | null {
  let min: number | null = null;
  for (const value of values) {
    if (typeof value !== "string") continue;
    const ms = parseIsoTime(value);
    if (ms !== null && (min === null || ms < min)) min = ms;
  }
  return min;
}

/**
 * The facts of a package answer. A 404 is a package that does not exist (D01). A 200 is a package that exists; its
 * first-publish time is npm's `time.created` (else the earliest version time) or the earliest file upload of any PyPI
 * release. A 200 whose body is over `REGISTRY_MAX_BODY_BYTES` is a package that exists with an unknown first-publish
 * time: only a package with a long history has a document that large (docs/LIMITS.md). Anything else, and a body that is
 * not JSON, is unavailable.
 */
export function packageFacts(ecosystem: DependencyEcosystem, answer: RegistryAnswer): PackageFacts {
  if (answer.kind !== "response") return { outcome: "unavailable" };
  if (answer.status === 404) return { outcome: "not-found" };
  if (answer.status !== 200) return { outcome: "unavailable" };
  if (answer.tooLarge === true) return { outcome: "found", firstPublished: null };
  const doc = parseJson(answer.body ?? "");
  if (!isRecord(doc)) return { outcome: "unavailable" };
  if (ecosystem === "npm") {
    const time = doc.time;
    if (!isRecord(time)) return { outcome: "found", firstPublished: null };
    const created = earliest([time.created]);
    if (created !== null) return { outcome: "found", firstPublished: created };
    return {
      outcome: "found",
      firstPublished: earliest(
        Object.entries(time)
          .filter(([key]) => key !== "modified" && key !== "unpublished")
          .map(([, value]) => value),
      ),
    };
  }
  const releases = doc.releases;
  const times: unknown[] = [];
  if (isRecord(releases)) {
    for (const files of Object.values(releases)) {
      if (!Array.isArray(files)) continue;
      for (const file of files) {
        if (isRecord(file)) times.push(file.upload_time_iso_8601 ?? file.upload_time);
      }
    }
  }
  return { outcome: "found", firstPublished: earliest(times) };
}

/**
 * The last week's downloads of an npm downloads answer: the count of a 200, null for a 404 (a package with no counts
 * yet; D03 is then not judged), or `unavailable`.
 */
export function weeklyDownloads(answer: RegistryAnswer): number | null | "unavailable" {
  if (answer.kind !== "response") return "unavailable";
  if (answer.status === 404) return null;
  if (answer.status !== 200 || answer.tooLarge === true) return "unavailable";
  const doc = parseJson(answer.body ?? "");
  if (!isRecord(doc)) return "unavailable";
  const count = doc.downloads;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : "unavailable";
}
