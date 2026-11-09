---
spec_id: d05-private-registry-allowlist
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:0ac964d307ef33dc333d1eae764877b6ea5ae4006fe3fcad4dc54ed58a0478a4
---

## Intent

Dependency safety signal D05 blocks, by default, every dependency or lockfile entry whose source is a URL off the
four public registry hosts (`registry.npmjs.org`, `registry.yarnpkg.com`, `pypi.org`, `files.pythonhosted.org`).
A private registry or mirror that a lockfile records (Artifactory, Nexus, Verdaccio, GitHub Packages, a private
PyPI index) is therefore reported as off the registry and fails the check (docs/THREAT-MODEL.md residual 43,
docs/LIMITS.md "Declared sources only"). The buyer pharn-ci is sold to (the platform or AppSec lead at an
organization of 50+ developers, product/DECISIONS.md) very often runs exactly such a registry, so the first run of
pharn-ci in such an organization goes red on the day it is installed, on every pull request that touches a
lockfile, for a reason the team cannot act on without switching dependency safety off.

The team wants to name the registry hosts it trusts, so that a dependency resolved from one of them is treated like
one resolved from the public registries, while D05 keeps blocking git, local-file and unknown-URL sources. The
organization wants to keep that list under its own control: the hosted org policy must be able to set it, and a
pull request must not be able to widen it (product/DECISIONS.md, decision 6: "Fix first in the Action").

## Scope

**In scope:**

- A registry host allow-list for D05: a workflow input `dependency-allowed-hosts` (Action) and a repeatable
  `--dependency-allowed-host` flag (CLI) that name extra registry hosts, added to the four public hosts, never
  replacing them.
- The same list in the org policy document: an optional `dependencies.allowed_hosts` key, additive within
  `schema/policy.v1.json`. An app policy that carries the key is authoritative over the input's list; a `file:`
  policy may not carry it (it is carried by the pull request).
- `.pharn/ci.yml` refuses the key with an error that says where the setting belongs, so a pull request cannot widen
  the list.
- An allowed host covers every place D05 judges a URL today: a manifest dependency declared by URL, a requirements
  file index option (`--index-url`, `--extra-index-url`, `-i`, `-f`) and a lockfile entry resolved from a URL
  (npm, pnpm, yarn, poetry, uv). The URL must still be https with no user name, password or port.
- A package resolved from an allowed private host is still never looked up in a public registry (D01 to D03), so an
  allow-list never makes a private package name leave the job.
- The D05 advice in the comment names the new setting, so a team seeing a red check on install day knows what to do.
- Documentation of the setting and of its bounds: README (Dependency safety, inputs table, CLI flags, policy keys),
  docs/LIMITS.md, docs/THREAT-MODEL.md (row C9 or D8 and residual 43), CHANGELOG Unreleased.

**Out of scope (non-goals):**

- Changing D05's default severity to `warn`, or per-signal severities for D01 to D05 (docs/LIMITS.md "No per-signal
  severities" stays).
- Wildcard hosts (`*.jfrog.io`), hosts with a port, `http://` registries, or a registry token: an entry is one exact
  host name and the URL rules of today stay.
- Reading a registry configured outside the lockfile (`.npmrc`, `.yarnrc.yml`, pip configuration, `PIP_INDEX_URL`)
  or recording pnpm's registry for registry packages.
- Looking up packages in a private registry, or sending anything to a host other than the ones AGENTS.md rule 5
  names.
- Carrying the allowed hosts in the report, the upload or the comment: an organization's internal host names never
  leave the job.
- Updating the pharn.dev app's copy of the policy schema, the policy editor, and the pharn-ci skills
  (pharn-ci-install, pharn-ci-policy, pharn-ci-explain): they live in other repositories and follow this change.
- Go modules, and any new dependency ecosystem.

## Scenarios

- A platform lead installs pharn-ci in a repository whose `package-lock.json` resolves every package from
  `https://artifactory.corp.example/artifactory/api/npm/npm/...`. The first pull request that bumps a dependency fails
  with `DEPENDENCY_D05`; the comment's advice names the `dependency-allowed-hosts` input. They add
  `dependency-allowed-hosts: artifactory.corp.example` to the workflow step and re-run: the check passes, and a later
  pull request that pins a package to a GitHub tarball still fails with D05.
- The organization's AppSec lead writes `dependencies.allowed_hosts: ["artifactory.corp.example"]` into the org
  policy in the pharn.dev app. A repository whose workflow names a second host, `mirror.other.example`, gets the
  policy's list: a package resolved from `mirror.other.example` is D05, and the comment carries
  `POLICY_OVERRIDE_IGNORED` naming `dependencies.allowed_hosts (input)`, so the check is at least a warning and the
  workflow owner sees why.
- An agent's pull request adds `dependencies.allowed_hosts` to `.pharn/ci.yml` to make its off-registry source pass.
  The check fails as a usage error whose text says the key is not a setting of that file and names the workflow
  input; nothing is reported as allowed.

## Acceptance Criteria

- **AC-1** Given a change whose lockfile at HEAD adds an entry resolved from
  `https://npm.corp.example/api/npm/npm/left-pad/-/left-pad-1.3.0.tgz` and nothing else wrong When the check runs with
  the `dependency-allowed-hosts` input (or one `--dependency-allowed-host` flag) naming `npm.corp.example` Then the
  report has no `D05` signal for that entry, no `DEPENDENCY_D05` message, a `pass` verdict, and the report's JSON
  text does not contain `npm.corp.example`
  - verify: integration
- **AC-2** Given the same change When the check runs with no allowed-hosts setting Then the report has a `D05`
  signal with severity `block` at that lockfile line and a `DEPENDENCY_D05` message at level `error`, exactly as
  pharn-ci 0.9.1 reports it
  - verify: integration
- **AC-3** Given `npm.corp.example` is allowed When a lockfile entry resolves from `http://npm.corp.example/...`, from
  `https://user:token@npm.corp.example/...`, from `https://npm.corp.example:8443/...` or from
  `https://evil.npm.corp.example/...` Then each is a `D05` signal with severity `block`
  - verify: unit
- **AC-4** Given `pypi.corp.example` is allowed When a manifest declares a dependency as
  `pkg @ https://pypi.corp.example/packages/pkg-1.0.tar.gz`, a requirements file adds
  `--index-url https://pypi.corp.example/simple`, or `package.json` declares
  `"x": "https://pypi.corp.example/x-1.0.0.tgz"` Then none of the three is a `D05` signal, while the same lines on a
  host that is not allowed each are one
  - verify: integration
- **AC-5** Given an allowed-hosts value with an entry that is not a host name (`https://npm.corp.example`,
  `npm.corp.example/path`, `npm.corp.example:8443`, `*.corp.example`, `user@npm.corp.example`, an empty entry
  between two separators is skipped and is not an error) or with more than 50 entries When the inputs are resolved
  Then the result is an input error naming `dependency-allowed-hosts` (or the CLI flag) whose text says what a host
  name is, the CLI exits `2` and no report is produced
  - verify: unit
- **AC-6** Given `.pharn/ci.yml` carrying `dependencies:\n  allowed_hosts: [npm.corp.example]` (or the key with any
  value) When the config is parsed Then a `ConfigError` is thrown whose message says `dependencies.allowed_hosts` is
  not a setting of this file, because the change under review can edit it, and names the `dependency-allowed-hosts`
  workflow input
  - verify: unit
- **AC-7** Given an app policy whose `dependencies.allowed_hosts` is `["npm.corp.example"]` and a run with no
  allowed-hosts input When the check runs on the change of AC-1 Then the report has no `D05` signal for the entry, no
  `POLICY_OVERRIDE_IGNORED` message, and the `policy` object says the source is `app`
  - verify: integration
- **AC-8** Given an app policy whose `dependencies.allowed_hosts` is `[]` (or a list without `mirror.other.example`)
  and the input naming `mirror.other.example` When the check runs on a change whose lockfile resolves an entry from
  `https://mirror.other.example/...` Then that entry is a `D05` signal with severity `block`, the report carries one
  `POLICY_OVERRIDE_IGNORED` message at level `warn` whose text names `dependencies.allowed_hosts (input)` and no host
  name, and the verdict is not `pass`
  - verify: integration
- **AC-9** Given an app policy whose `dependencies.allowed_hosts` names `npm.corp.example` and an input naming only
  `npm.corp.example` When the policy is applied Then nothing is recorded as ignored and no `POLICY_OVERRIDE_IGNORED`
  message is in the report
  - verify: unit
- **AC-10** Given a `file:` policy whose `dependencies.allowed_hosts` is `["npm.corp.example"]` When the policy is
  applied Then the host is not allowed (a lockfile entry resolved from it is a `D05` signal) and the report's
  `POLICY_OVERRIDE_IGNORED` message names `dependencies.allowed_hosts (policy-file)`
  - verify: integration
- **AC-11** Given the dependencies mode `lookup`, `npm.corp.example` allowed, and a change that adds the unscoped
  package `corp-utils` to `package.json` with a lockfile entry resolved from `https://npm.corp.example/...` When the
  registry lookups are planned Then `corp-utils` is not among the planned lookups, exactly as when the host is not
  allowed
  - verify: unit
- **AC-12** Given a report with a `DEPENDENCY_D05` message When the comment markdown is rendered Then the advice
  line for `DEPENDENCY_D05` names `dependency-allowed-hosts` and says it is for a registry the team runs
  - verify: unit
- **AC-13** Given a policy document `{ "version": 1, "dependencies": { "allowed_hosts": ["npm.corp.example"] } }`
  When it is validated Then it is valid, and given `allowed_hosts` holding `"https://x"`, a non-string, or 51 entries
  When validated Then it is invalid with an error whose `path` starts with `/dependencies/allowed_hosts` and whose
  message repeats no value from the document
  - verify: unit
- **AC-14** Given the action's inputs and the CLI's flags listed in the README When the README is read Then it
  documents `dependency-allowed-hosts`, `--dependency-allowed-host` and the policy key `dependencies.allowed_hosts`,
  each with the host-name rules of AC-3 and AC-5, and `schema/policy.v1.json` describes `allowed_hosts` with its
  tighten rule
  - verify: unit

## Constraints

- AGENTS.md rules hold: core stays pure (the allow-list is plain data passed into `check()`); every change ships with
  fixture-based tests in `fixtures/` validated by `expectValidReport`; no existing test is weakened or deleted
  (tests that compare the whole resolved dependency settings object, such as
  `packages/core/test/dependencies-settings.test.ts`, are updated to the new shape with the reason in the PR);
  `pnpm build` refreshes the committed `packages/action/dist`.
- `schema/report.v2.json` is unchanged: no report field, message code or setup kind is added, and no host name is
  written into the report, the job summary, the comment or the upload (product/ACTION-APP-CONTRACT.md).
- `schema/policy.v1.json` gains only the optional `dependencies.allowed_hosts` key (an array of at most 50 host
  names), documented in the schema with its tighten rule: app replaces, file not allowed. Nothing is removed,
  renamed or retyped.
- Precedence follows the product rule "settings the pull request carries can never loosen a gate": the workflow
  input is the base; `.pharn/ci.yml` and a `file:` policy cannot add a host; an app policy that carries the key
  replaces the input's list, and an input host the app policy does not name is recorded as an ignored setting
  (`looser`) in `POLICY_OVERRIDE_IGNORED`, with the existing message shape (setting and layer named, no value).
- A host name entry: ASCII letters, digits, `.` and `-`, matched case-insensitively and exactly against the URL's
  host, at most 253 characters, no scheme, path, port, user name or wildcard; the four public hosts stay allowed
  whatever the list says. Allowing a host never relaxes the URL rules: https only, no user name, password or port.
- Network: no new call. AGENTS.md rule 5 and docs/THREAT-MODEL.md row D8 keep holding: an allow-listed host is never
  called, and a name resolved from an allow-listed host is never sent to a public registry.
- Message codes, inputs and outputs of 0.9.x are unchanged; the change is additive and ships as a minor version
  (docs/RELEASING.md). CHANGELOG Unreleased gets an Added line; docs/THREAT-MODEL.md is updated in the same PR
  because the Action parses a new input and residual 43 changes.
- An invalid allow-list entry is a usage error, never a silent skip: CLI exit `2`, Action step failure, no report.

## Assumptions

- The allow-list lives in the workflow input and the app policy, not in `.pharn/ci.yml`: the increment description
  asks for an allow-list "in .pharn/ci.yml, not only in the policy from the app", but the product rule
  (CLAUDE.local.md, docs/THREAT-MODEL.md residual risks) says settings the pull request carries may only tighten,
  and a host list a pull request can widen would let an agent allow its own off-registry source. The workflow input
  is the repository's own setting without an account (the description's "not only the app"), and the setting name
  the description uses, `dependency-allowed-hosts`, is a workflow input name.
- Of the two options decision 6 names, the allow-list is taken and D05 keeps blocking by default: a `warn` default
  would also stop blocking git, local-file and unknown-URL sources, which is the gate the signal exists for.
- An app policy that carries `dependencies.allowed_hosts` replaces the input's list (the same rule as the app policy's
  `registries` and minimums); an app policy without the key leaves the input's list in force; an input host that the
  app policy's list also names is not recorded as ignored.
- `.pharn/ci.yml` refuses the key with a dedicated message, following the precedent of `test_integrity.accept_label`,
  instead of the generic `unknown key` error it gives today, so the person who tried it is told where the setting
  belongs.
- The Action input accepts entries separated by commas or newlines, like `exclude` and `expect-agent-setup`; the CLI
  flag is repeatable, like `--expect-agent-setup`. The CLI's `--policy-file` applies the `file:` rule, as it does
  for every other policy key.
- At most 50 hosts per layer is enough for an organization's registries and mirrors; a host name of at most 253
  characters follows the DNS limit.
- The project's `test` script (`vitest run`) is the runner the acceptance criteria are verified with, at the `unit`
  and `integration` levels; no criterion needs an end-to-end run, and dogfood on this repository's own pull requests
  stays the end-to-end check.
- The pharn.dev app's copy of the policy schema, the policy editor and the pharn-ci skills are updated in their own
  repositories after this change ships; until then the app's validator may reject a policy carrying the new key, which
  is the app's existing behaviour for an unknown key and is not a regression of the Action.
