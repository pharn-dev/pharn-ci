---
spec_id: d05-private-registry-allowlist
spec_content_hash: "66035f0c79f039f2d402134fe29d24cd2d4a63be2271585b1a963ec329830920"
applied_lessons: none
---

## Approach

ADVISORY — model work, planned from the Approved SPEC and a live read of the code this run.

D05 today decides "allowed" inside the parsers: `isAllowedRegistryUrl(url)` (`packages/core/src/dependencies/urls.ts`)
against the four public hosts sets `allowedUrl` on a manifest dependency, `allowed` on a requirements index option and
on a lockfile `url` source. The parsers stay as they are (their outputs are pinned by `dependencies-parse.test.ts`),
and the extra hosts are applied once, in `analyze()` of `packages/core/src/dependencies/check.ts`, where the URL text
is still at hand: a lockfile `url` source carries `text`, an index option carries `url`, and a manifest dependency of
kind `url` gains an optional `url` field (set by `npmManifest.ts` and `pythonManifest.ts`, not by `classifyNpmSpec`,
whose return shape is pinned). A URL counts as allowed when the public check says so, or when
`isAllowedRegistryUrl(url, allowedHosts)` does — the same https / no user name / no password / no port / exact host rule,
so allowing a host never relaxes the URL rules (AC-3).

The hosts reach `analyze()` as plain data on the resolved settings: `ResolvedDependencySettings.allowedHosts?: string[]`
(lower-cased, de-duplicated, absent when empty, so every existing `toEqual` on the resolved settings keeps passing).
`resolveDependencySettings` takes them from the layers: `DependencySettingsLayers.allowedHosts` (the workflow input or
CLI flag) is the base; an **app** policy's `policy.allowedHosts`, when present, replaces it; a `file` policy layer's
list is never read. `.pharn/ci.yml` has no such key: `parseConfig` refuses `dependencies.allowed_hosts` with a dedicated
`ConfigError` (before the null skip, like `test_integrity.accept_label`), so a pull request cannot widen the list.

A lockfile entry resolved from an allowed private host is not a D05 signal, but its name still goes into
`analysis.offRegistry`, so `planLookups` never sends it to a public registry (AC-11, AGENTS.md rule 5, THREAT-MODEL D8).

Input parsing is one pure function in a new `packages/core/src/dependencies/hosts.ts`: trim each entry, skip empty
entries, refuse an entry that is not a host name (ASCII letters, digits, `.` and `-`, 1 to 253 characters) or a list of
more than 50, lower-case and de-duplicate. Its error names the input or flag (the `InputErrorText` label) and says what
a host name is, and names a bad entry by its position, never by its value. The host regex and the two limits are
defined once, in the policy grammar (`POLICY_PATTERNS.HOST`, `POLICY_MAX_HOST`, `POLICY_MAX_ALLOWED_HOSTS`), because
`schema/policy.v1.json` must carry the same pattern (pinned by `policy-schema.test.ts`), and `hosts.ts` imports them.

The org policy gains `dependencies.allowed_hosts` (validator, type, schema). `applyPolicy` passes an app policy's list
into the policy layer and records every input host the app list does not name as one ignored setting
`dependencies.allowed_hosts (input)`, reason `looser` (AC-8; none when the input is a subset, AC-9). A `file:` policy's
non-empty list is recorded `dependencies.allowed_hosts (policy-file)`, reason `not-allowed`, and never applied (AC-10).
The existing `POLICY_OVERRIDE_IGNORED` message names setting and layer only, never a value, so no host name reaches the
report (AC-1, AC-8). No report, upload, summary or comment field carries the hosts.

Adapters: the Action reads a new `dependency-allowed-hosts` input (commas or newlines, via `splitPatternList`); the CLI a
repeatable `--dependency-allowed-host` flag, validated with the other flags before any git call (exit 2, AC-5). The
comment's `DEPENDENCY_D05` advice names the input for a registry the team runs (AC-12). Docs, CHANGELOG, THREAT-MODEL
and the rebuilt `packages/action/dist/index.js` ship in the same change.

## Applied lessons

- none — `check-lessons-index.mjs --verdict` printed `NO_CANON`: this project has no `pharn/memory-bank/lessons-learned.md`
  yet, so there is no lesson to apply.

## Steps

1. `packages/core/src/policy/limits.ts`: add `POLICY_MAX_HOST = 253` and `POLICY_MAX_ALLOWED_HOSTS = 50`.
2. `packages/core/src/policy/grammar.ts`: add `HOST: "^[A-Za-z0-9.-]+$"` to `POLICY_PATTERNS` and
   `GRAMMARS.host = { max: POLICY_MAX_HOST, regex, message: MESSAGES.host }`.
3. `packages/core/src/policy/errors.ts`: add `MESSAGES.host` (a fixed text saying what a host name is, no value) and
   `maxItemsMessage(max)` (`must have at most <max> items`; `MESSAGES.tooManyItems` keeps its 1000 text).
4. `packages/core/src/policy/validate.ts`: `listOf(item, max = POLICY_MAX_LIST_ITEMS)` with the max-items message from
   step 3; add `["allowed_hosts", listOf(stringOf(GRAMMARS.host), POLICY_MAX_ALLOWED_HOSTS)]` to `dependencies`.
5. `packages/core/src/policy/types.ts`: `PolicyDependencies.allowed_hosts?: string[]`.
6. `schema/policy.v1.json`: `$defs.host` (string, 1-253, the HOST pattern) and `dependencies.allowed_hosts` (array,
   `maxItems: 50`, items `$ref: #/$defs/host`) whose description states the tighten rule: an app policy's list replaces
   the workflow input's, a policy file may not set it, `.pharn/ci.yml` may not set it; exact host names, matched
   case-insensitively, the four public hosts always allowed, https with no user name, password or port. Reword the
   `registries` description's "a policy never names a host".
7. New `packages/core/src/dependencies/hosts.ts`: `isRegistryHostName(text)`, `parseAllowedHosts(entries, label)`
   (skip empty, validate, max 50, lower-case, de-duplicate; throws `ConfigError`).
8. `packages/core/src/dependencies/settings.ts`: `DependencySettingsLayers.allowedHosts?: string[]`,
   `policy.allowedHosts?: string[]`; `ResolvedDependencySettings.allowedHosts?: string[]`; `resolveDependencySettings`
   applies app-replaces-input, ignores a file layer's list, lower-cases, de-duplicates, omits an empty list. Update the
   doc comments.
9. `packages/core/src/dependencies/types.ts`: `ManifestDependency.url?: string` (for kind `url`: the URL as written).
   `npmManifest.ts` and `pythonManifest.ts` set it for kind `url` (pyproject table `url = …`, `name @ url`, a bare URL
   line).
10. `packages/core/src/dependencies/check.ts`: `analyze(diff, sources, repoFiles, allowedHosts)`; a helper that is
    true when `allowedHosts` is non-empty and `isAllowedRegistryUrl(url, allowedHosts)`; manifest D05, index-option D05
    and lockfile D05 consult it; a lockfile entry on an allowed private host goes into `offRegistry` without a signal.
    `planDependencyLookups` and `checkDependencies` pass `settings.allowedHosts ?? []`.
11. `packages/core/src/inputs.ts`: `RawInputs.dependencyAllowedHosts?: readonly string[]`,
    `InputErrorText.dependencyAllowedHosts?: string` (default label `dependency-allowed-hosts`), an `attempt` that runs
    `parseAllowedHosts`, and the input layer's `allowedHosts` in `dependencies` only when non-empty.
12. `packages/core/src/config.ts`: refuse `dependencies.allowed_hosts` (any value, `null` included) with a `ConfigError`
    saying it is not a setting of this file because the change under review can edit it, naming the
    `dependency-allowed-hosts` workflow input (and the CLI flag).
13. `packages/core/src/policy/apply.ts`: in `applyDependencies`, the app list into `policy.allowedHosts` and the
    `looser` record for input hosts it does not name; a file policy's non-empty list recorded `not-allowed`. Update the
    function's and `applyPolicy`'s doc comments.
14. `packages/core/src/render/markdown.ts`: extend the `DEPENDENCY_D05` hint: a URL on a registry your team runs
    (Artifactory, Nexus, a private PyPI index) is allowed by naming its host in the `dependency-allowed-hosts` input or
    the org policy's `dependencies.allowed_hosts`. `fix/table.ts` (the pinned fix hint) is not changed.
15. `packages/cli/src/main.ts`: `"dependency-allowed-host": { type: "string", multiple: true }`, the raw input, the
    `FLAG_ERRORS` label `--dependency-allowed-host`, an early `flagError("dependencyAllowedHosts")` throw, and a HELP line.
16. `packages/action/src/run.ts`: `dependencyAllowedHosts: splitPatternList(input("dependency-allowed-hosts"))` and the
    `INPUT_ERRORS` label; `action.yml`: the `dependency-allowed-hosts` input (optional, no default) with the rules.
17. Build-owned tests (fixture-based, `expectValidReport`): `fixtures/dependencies/d05-private-host/` (an npm lockfile
    entry, a package.json URL dependency and a requirements index option on `npm.corp.example`, plus a git source that
    stays D05) and `packages/core/test/dependencies-allowed-hosts.test.ts` through `check()`; precedence and refusal
    cases added to `dependencies-settings.test.ts`; Ajv/validator boundary cases (host 253/254, 50/51 items) added to
    `policy-schema.test.ts`.
18. Re-pin two existing tests whose pinned output intentionally changes (explained in the PR, nothing weakened):
    `dependencies-render.test.ts` (the D05 hint line gains the allow-list sentence) and `ac-ti081516-docs.test.ts`
    (action.yml's input list set-aside gains `dependency-allowed-hosts`, the same way earlier inputs were added).
19. Docs: README (Dependency safety: a "Private registries" paragraph and the D05 row; the inputs table row; the CLI
    synopsis and flag list; the policy key), `docs/LIMITS.md` ("Declared sources only", "Allowed hosts are exact"),
    `docs/THREAT-MODEL.md` (rows C9 and D8, residual 43: the allow-list, who may set it, that an allowed host is never
    called and a name resolved from it is never looked up, and that a workflow edit by the pull request is the same
    residual as every other input), `CHANGELOG.md` Unreleased (Added).
20. `pnpm build` to refresh `packages/action/dist/index.js`; `pnpm lint` and `pnpm test`.

## Files

- `packages/core/src/dependencies/hosts.ts` — new: `isRegistryHostName`, `parseAllowedHosts` (trim, skip empty, host grammar, max 50, lower-case, de-duplicate)
- `packages/core/src/dependencies/settings.ts` — `allowedHosts` on the input and app-policy layers and on the resolved settings; app replaces input, file ignored
- `packages/core/src/dependencies/types.ts` — `ManifestDependency.url?` for kind `url`
- `packages/core/src/dependencies/npmManifest.ts` — set `url` on a URL dependency
- `packages/core/src/dependencies/pythonManifest.ts` — set `url` on a URL requirement and a pyproject `url =` source
- `packages/core/src/dependencies/check.ts` — apply the allowed hosts to manifest, index-option and lockfile D05; an allowed private entry stays in `offRegistry`
- `packages/core/src/inputs.ts` — `RawInputs.dependencyAllowedHosts`, its error label, validation, and the input layer
- `packages/core/src/config.ts` — refuse `dependencies.allowed_hosts` in `.pharn/ci.yml` with a message naming the workflow input
- `packages/core/src/policy/limits.ts` — `POLICY_MAX_HOST`, `POLICY_MAX_ALLOWED_HOSTS`
- `packages/core/src/policy/grammar.ts` — `POLICY_PATTERNS.HOST`, `GRAMMARS.host`
- `packages/core/src/policy/errors.ts` — `MESSAGES.host`, `maxItemsMessage`
- `packages/core/src/policy/validate.ts` — `listOf` max parameter; `dependencies.allowed_hosts`
- `packages/core/src/policy/types.ts` — `PolicyDependencies.allowed_hosts`
- `packages/core/src/policy/apply.ts` — app list into the layer, `looser` for input hosts it does not name, `not-allowed` from a file
- `packages/core/src/render/markdown.ts` — the `DEPENDENCY_D05` advice names `dependency-allowed-hosts`
- `packages/cli/src/main.ts` — repeatable `--dependency-allowed-host`, early validation, HELP line
- `packages/action/src/run.ts` — the `dependency-allowed-hosts` input and its error label
- `action.yml` — declare the `dependency-allowed-hosts` input
- `schema/policy.v1.json` — `$defs.host` and `dependencies.allowed_hosts` with its tighten rule; `registries` description reworded
- `packages/action/dist/index.js` — rebuilt bundle (`pnpm build`)
- `README.md` — Dependency safety (private registries, D05 row), inputs table, CLI synopsis and flags, policy key
- `docs/LIMITS.md` — "Declared sources only" and "Allowed hosts are exact" name the allow-list and its bounds
- `docs/THREAT-MODEL.md` — rows C9 and D8 and residual 43
- `CHANGELOG.md` — Unreleased: Added line
- `fixtures/dependencies/d05-private-host/change.diff` — new fixture: the diff of the private-host case
- `fixtures/dependencies/d05-private-host/files.txt` — new fixture: tracked files at HEAD
- `fixtures/dependencies/d05-private-host/base/package.json.txt` — new fixture: base manifest
- `fixtures/dependencies/d05-private-host/base/package-lock.json.txt` — new fixture: base lockfile
- `fixtures/dependencies/d05-private-host/base/requirements.txt.fixture` — new fixture: base requirements
- `fixtures/dependencies/d05-private-host/head/package.json.txt` — new fixture: head manifest with a URL dependency on the private host
- `fixtures/dependencies/d05-private-host/head/package-lock.json.txt` — new fixture: head lockfile with entries on the private host and one git source
- `fixtures/dependencies/d05-private-host/head/requirements.txt.fixture` — new fixture: head requirements with an index option on the private host
- `packages/core/test/dependencies-allowed-hosts.test.ts` — new build-owned fixture test through `check()`, with `expectValidReport`
- `packages/core/test/dependencies-settings.test.ts` — add precedence and `.pharn/ci.yml` refusal cases; existing cases unchanged
- `packages/core/test/policy-schema.test.ts` — add Ajv/validator boundary cases for the host grammar and the 50-item cap
- `packages/core/test/dependencies-render.test.ts` — re-pin (literal): the D05 hint line gains the allow-list sentence
- `packages/core/test/ac-ti081516-docs.test.ts` — re-pin: `dependency-allowed-hosts` joins the set-aside of new action.yml inputs

### Explicitly not touched

- `schema/report.v2.json` — no report field, message code or setup kind is added
- `packages/core/src/report.ts` — report types unchanged
- `packages/core/src/fix/table.ts` — the pinned D05 fix hint stays as it is
- `packages/core/src/dependencies/urls.ts` — reused as is: `isAllowedRegistryUrl(url, hosts)` already takes a host list
- `packages/core/src/dependencies/specs.ts` — `classifyNpmSpec`'s return shape is pinned by `dependencies-parse.test.ts`
- `packages/core/src/dependencies/lookup.ts` — reused as is: `planLookups` already leaves out `offRegistry` names
- `packages/action/src/registry-lookup.ts` — no new host is called
- `packages/action/dist/typescript.js` — the vendored TypeScript is unchanged
- `packages/core/test/dependencies-parse.test.ts` — parser outputs are unchanged

## Acceptance mapping

- AC-1 → steps 7, 8, 10, 11, 15, 16: the input or flag puts `npm.corp.example` on the resolved settings, the lockfile
  entry is allowed in `analyze()`, no D05 signal or message, verdict `pass`; no field carries the host, so the report
  JSON never contains it.
- AC-2 → unchanged default path: with no hosts, `allowedHosts` is absent and `analyze()` behaves as in 0.9.1.
- AC-3 → step 10 reuses `isAllowedRegistryUrl(url, allowedHosts)`: http, user info, a port or another host
  (`evil.npm.corp.example` is not an exact match) stay D05 `block`.
- AC-4 → steps 9 and 10: a `name @ url` requirement, a requirements `--index-url` and a package.json URL dependency on an
  allowed host are allowed; on a host not allowed each stays D05.
- AC-5 → steps 7, 11, 15, 16: `parseAllowedHosts` refuses a scheme, a path, a port, a wildcard, user info and more than
  50 entries, skips empty entries; the error names the input or flag and says what a host name is; the CLI throws
  before any git call (exit 2, no report).
- AC-6 → step 12: `parseConfig` throws a `ConfigError` for `dependencies.allowed_hosts` with any value.
- AC-7 → steps 8 and 13: an app list becomes the resolved list; with no input nothing is ignored; `policy.source` is `app`.
- AC-8 → steps 8 and 13: the app list replaces the input's; the input host is recorded `dependencies.allowed_hosts
  (input)` `looser`, so one `POLICY_OVERRIDE_IGNORED` warning with no host name; the entry is D05 and the verdict fails.
- AC-9 → step 13: an input host the app list also names is not recorded.
- AC-10 → steps 8 and 13: a file policy's list is not applied and is recorded `dependencies.allowed_hosts (policy-file)`.
- AC-11 → step 10: an entry on an allowed private host is put in `offRegistry`, so `planDependencyLookups` leaves it out.
- AC-12 → step 14: the `DEPENDENCY_D05` hint names `dependency-allowed-hosts` for a registry the team runs.
- AC-13 → steps 1 to 6: valid with host names; invalid for `"https://x"`, a non-string or 51 entries, at a path under
  `/dependencies/allowed_hosts`, with fixed messages only.
- AC-14 → steps 6 and 19: README documents the input, the flag and the policy key with the host-name rules; the schema
  describes `allowed_hosts` with its tighten rule.

## Risks & open questions

- An app policy whose `dependencies` key holds only `allowed_hosts` still "has a dependencies key", so it requires the
  check (`never` becomes `auto`, recorded `dependencies (input)`). That is the existing rule for the key and matches the
  org's intent, but the README should say it.
- A `file:` policy carrying `allowed_hosts: []` adds nothing and is not recorded (the `coverage.exclude` precedent:
  only a non-empty list is `not-allowed`). If the grill wants any presence recorded, it is a one-line change.
- The workflow input is carried by the pull request when the pull request edits the workflow file, like every other
  input; the app policy is the control, P13 and TI11 watch workflow edits. The THREAT-MODEL residual says so.
- Two existing tests are re-pinned (step 18). Neither assertion is removed or loosened: the render test pins the new
  hint text, and the docs test adds one name to the list of inputs added after its base, keeping the rest equal to it.
- The host grammar is exactly what the SPEC states (letters, digits, `.`, `-`, at most 253): entries such as `.` or
  `a..b` pass the grammar but can never equal a URL host, so they allow nothing.
- AC tests are written before the build and cannot use the new fixture directory; they build their inputs in memory
  (existing `fixtures/dependencies/*` cases rewritten in memory, or inline text), as the fix-hints feature did.
- The pharn.dev app's policy schema copy and the pharn-ci skills follow in their own repositories (SPEC non-goal).
