/**
 * The registry lookups of dependency safety (A13, D01 to D03): the Action's only calls to hosts other than GitHub and
 * pharn.dev, made only when the effective `dependencies` mode is `lookup` (docs/THREAT-MODEL.md, AGENTS.md rule 5).
 *
 * Each request is a GET to one of `REGISTRY_LOOKUP_HOSTS` (registry.npmjs.org, api.npmjs.org, pypi.org) with the package
 * name in the path and nothing else: no query, no body, no credentials, no repository name, only the headers `Accept`
 * and `User-Agent: pharn-ci`. A 5 s timeout per request, no redirect, no retry, a 2 MiB cap on the body read, at most 4
 * requests at once and 60 s for the whole run. Every failure is fail-open: the package's result is `unavailable`, and
 * check() says so in one DEPENDENCY_LOOKUP_UNAVAILABLE warning. Nothing the registry answers is logged.
 */
import {
  type DependencyLookupResult,
  type PlannedLookup,
  packageFacts,
  REGISTRY_LOOKUP_HOSTS,
  REGISTRY_MAX_BODY_BYTES,
  type RegistryAnswer,
  registryLookupUrls,
  weeklyDownloads,
} from "@pharn-ci/core";

/** One request is cut off after this long, body included. */
export const REGISTRY_TIMEOUT_MS = 5000;
/** All lookups of a run together; a package not started by then is `unavailable`. */
export const REGISTRY_DEADLINE_MS = 60_000;
/** Requests in flight at once. */
export const REGISTRY_CONCURRENCY = 4;
/** The fixed User-Agent: the product name, nothing about the repository or the runner. */
export const REGISTRY_USER_AGENT = "pharn-ci";

export interface RegistryDeps {
  fetch?: ((input: string, init: RequestInit) => Promise<Response>) | undefined;
  now?: (() => Date) | undefined;
  /** The timeout of one request, in milliseconds; `REGISTRY_TIMEOUT_MS` when absent. */
  registryTimeoutMs?: number | undefined;
}

/** Whether a URL is https on one of the registry lookup hosts, with nothing but a path. */
function allowedLookupUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    REGISTRY_LOOKUP_HOSTS.includes(parsed.hostname)
  );
}

/** The body as UTF-8 text, or null when it is longer than the cap (the stream is cancelled at once). */
async function readCapped(response: Response): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > REGISTRY_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** One GET of a registry URL. A URL off the lookup hosts is never fetched (a network error). */
export async function registryGet(deps: RegistryDeps, url: string): Promise<RegistryAnswer> {
  const doFetch = deps.fetch;
  if (doFetch === undefined || !allowedLookupUrl(url)) return { kind: "network" };
  const signal = AbortSignal.timeout(deps.registryTimeoutMs ?? REGISTRY_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": REGISTRY_USER_AGENT },
      redirect: "error",
      signal,
    });
  } catch {
    return signal.aborted ? { kind: "timeout" } : { kind: "network" };
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    return { kind: "response", status: response.status };
  }
  try {
    const body = await readCapped(response);
    return body === null ? { kind: "response", status: 200, tooLarge: true } : { kind: "response", status: 200, body };
  } catch {
    return signal.aborted ? { kind: "timeout" } : { kind: "network" };
  }
}

/** One planned package: its package answer, and for a found npm package its weekly downloads when D03 is judged. */
async function lookupOne(
  deps: RegistryDeps,
  planned: PlannedLookup,
  minWeeklyDownloads: number,
): Promise<DependencyLookupResult> {
  const urls = registryLookupUrls(planned.ecosystem, planned.name);
  const facts = packageFacts(planned.ecosystem, await registryGet(deps, urls.package));
  if (facts.outcome !== "found") return { ...planned, ...facts };
  if (planned.ecosystem !== "npm" || urls.downloads === undefined || minWeeklyDownloads <= 0) {
    return { ...planned, ...facts };
  }
  return { ...planned, ...facts, weeklyDownloads: weeklyDownloads(await registryGet(deps, urls.downloads)) };
}

/**
 * The results of the planned lookups, in plan order: at most `REGISTRY_CONCURRENCY` at once, and a package not started
 * within `REGISTRY_DEADLINE_MS` of the first is `unavailable`. Never throws.
 */
export async function lookupDependencies(
  deps: RegistryDeps,
  planned: readonly PlannedLookup[],
  minWeeklyDownloads: number,
): Promise<DependencyLookupResult[]> {
  const now = () => (deps.now ?? (() => new Date()))().getTime();
  const deadline = now() + REGISTRY_DEADLINE_MS;
  const results: DependencyLookupResult[] = new Array(planned.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      const item = planned[index];
      if (item === undefined) return;
      if (now() >= deadline) {
        results[index] = { ...item, outcome: "unavailable" };
        continue;
      }
      try {
        results[index] = await lookupOne(deps, item, minWeeklyDownloads);
      } catch {
        results[index] = { ...item, outcome: "unavailable" };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(REGISTRY_CONCURRENCY, planned.length) }, worker));
  return results;
}
