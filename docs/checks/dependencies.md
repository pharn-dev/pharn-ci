# Dependency safety

An agent that adds a dependency can add one that does not exist yet (an invented name anyone can then publish), one
published last week, or one fetched from a git repository or an arbitrary URL. Dependency safety (A13) checks only the
dependencies a pull request **adds or changes**, never the whole tree, in npm manifests and lockfiles (`package.json`,
`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock` classic and berry) and Python ones
(`requirements*.txt` and `requirements/*.txt`, `pyproject.toml` with `[build-system] requires`, PEP 621, dependency
groups, poetry dependencies and sources, and uv's `[tool.uv.sources]` and indexes, `poetry.lock`, `uv.lock`). It reads the touched files at the merge base and at HEAD from committed
git objects, in the CLI and the Action, with or without an org policy.

| Signal | What it finds | Needs | Default |
| ------ | ------------- | ----- | ------- |
| D01 | An added package the registry does not know (404): a slopsquatting target | lookups | `block` |
| D02 | An added package first published fewer than `min_age_days` (30) days before the head commit | lookups | `warn` |
| D03 | An added unscoped npm package downloaded fewer than `min_weekly_downloads` (100) times last week (npm only: PyPI has no first-party download count) | lookups | `warn` |
| D04 | Lockfile drift: a manifest's dependencies (a `package.json` override field included) changed while the lockfile that governs it (beside it, or a workspace root lockfile that lists it as an importer) did not change or does not record the new spec; or a lockfile gives a version the same hash algorithm but a different hash than the merge base did | nothing | `block` |
| D05 | An added or changed dependency or lockfile entry from a git repository, a URL off `registry.npmjs.org`, `registry.yarnpkg.com`, `pypi.org` and `files.pythonhosted.org` (https only, no credentials or port) or off the private registry hosts you allow (see Private registries below), or a local file; or a requirements file or `pyproject.toml` that adds a package index off them. In `pyproject.toml` this covers `[build-system] requires`, `[project]` dependencies, `[project.optional-dependencies]`, `[dependency-groups]`, poetry's `[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]` and `[tool.poetry.group.<name>.dependencies]` and uv's `[tool.uv.sources]` (a dependency written as its own sub-table, an inline table or dotted keys alike; every item of an array of sources), and as indexes the `url` of each `[[tool.poetry.source]]` and `[[tool.uv.index]]` and uv's `index-url`, `extra-index-url` and `find-links` in `[tool.uv]` and `[tool.uv.pip]`, whose finding names the table. In `package.json` this covers the three override fields, npm's `overrides` (every nested leaf), yarn's `resolutions` and `pnpm.overrides`, whose finding names the field; any spec holding a `:` or a `/` other than `npm:`, `workspace:`, `catalog:` and `patch:` (`ssh://…`, `user@host:x.git`, `https:host/x`); and `jsr:`, which installs from `npm.jsr.io` and passes only when that host is allowed. In `uv.lock` it also covers a package's `sdist` and `wheels` URLs, which uv downloads from: each must be on the package's registry host, a file host of that registry (PyPI: `files.pythonhosted.org`) or an allowed host, so a package that keeps a PyPI source and points a wheel elsewhere is D05 | nothing | `block` |

**Private registries.** A team that runs its own npm or PyPI registry (Artifactory, Nexus, a private index) names its host
once, and D05 stops flagging URLs on it. Give the host in the `dependency-allowed-hosts` input (comma or newline
separated), the CLI's repeatable `--dependency-allowed-host` flag, or an app policy's `dependencies.allowed_hosts`. Each
entry is an exact host name, matched case-insensitively: the letters A-Z and a-z, digits, `.` and `-`, 1 to 253
characters, with no scheme, path, port, user name or wildcard (`npm.corp.example`, not `https://npm.corp.example/` or
`*.corp.example`), and at most 50 entries; an entry that is not a host name fails the step (exit `2` in the CLI). The four
public hosts stay allowed, and allowing a host does not relax the URL rule: a URL on it still has to be `https` with no
user name, password or port, and a sibling such as `evil.npm.corp.example` is not the host. A package resolved from an
allowed host is never looked up in a public registry (the lookups skip it, as they skip every off-registry source), and
the Action never calls the allowed host. `.pharn/ci.yml` cannot set the list (the change under review can edit that
file): a `dependencies.allowed_hosts` key there is refused with an error that names the input. An app policy's list
**replaces** the input's, so an input host the policy does not name is ignored and named, by setting and layer only, in
`POLICY_OVERRIDE_IGNORED`; a `file:` policy may not allow a host (its list is recorded and not applied). An app policy
whose `dependencies` key holds only `allowed_hosts` still requires the check, like any `dependencies` key. A workflow
edit in the pull request changes the input like every other input; the app policy is the control that a pull request
cannot move (docs/THREAT-MODEL.md, row D8 and residual 43).

**Lookups are opt-in.** A lookup sends a package name to a third party, and an unscoped private package name would leak,
so the default `dependencies: auto` makes no network call. With `dependencies: lookup` (or `dependencies.lookup: true`
in `.pharn/ci.yml`, or an org policy's `dependencies.lookup: true`) the Action looks up each package the pull request
added: one `GET https://registry.npmjs.org/<name>` (the full document: the abbreviated one has no publish times) and
one `GET https://api.npmjs.org/downloads/point/last-week/<name>` per npm package, one
`GET https://pypi.org/pypi/<name>/json` per PyPI package. Only the name is sent: no token, no repository name, no
query, `User-Agent: pharn-ci`, no redirect, 5 s per request, at most 50 packages and 60 s per run. Scoped npm names
(`@org/x`), `workspace:` packages, git, URL and path specs and names a touched lockfile resolves off the registries are
never looked up, and a version change of a package already there is not looked up either. An added `package.json`
override names a package already in the tree, so it is looked up only when its value is an `npm:` alias (the alias
target is new). A lookup that fails is
fail-open: `DEPENDENCY_LOOKUP_UNAVAILABLE` (warn) counts what was not checked and `dependencies.lookups` says
`unavailable`. D02 compares with the head commit's time from git, never the clock. The CLI never makes a network call,
so it runs D04 and D05 only and reports `lookups: off`.

**Who decides.** The `dependencies` input is the base. `.pharn/ci.yml` is carried by the pull request, so it may only
tighten: `lookup: true` turns lookups on over `auto` but never over the workflow's `never` (a file the pull request
carries must not make the job send names to a registry the workflow owner refused), and `min_age_days` and
`min_weekly_downloads` only raise the defaults. An app policy with a `dependencies` key requires the check (`never`
becomes `auto`, recorded in `POLICY_OVERRIDE_IGNORED`), its `lookup: true` turns lookups on, its minimums replace the
defaults (lower layers can still raise them) and its `registries` narrow the ecosystems looked up. A `file:` policy is
treated like `.pharn/ci.yml`: its `registries` and its `allowed_hosts` are not allowed.

**How a block fails the check.** Each signal id adds one `DEPENDENCY_D01` to `DEPENDENCY_D05` message whose level follows
its findings' severity, the way the agent config secret check and the prompt-injection scan do: `block` is an `error`
and the verdict is `fail`, `warn` a warning. The test-integrity mode and the accept label do not lower it. The report's
optional `dependencies` object (present only when the change touched a manifest or lockfile) holds `checked` (how many
dependencies and lockfile entries were added or changed), `lookups` (`off`, `done` or `unavailable`) and `signals`
(id, severity, ecosystem, path, line, detail, and the package name and version spec only when they pass a strict
allow-list; at most 200, `truncated` counts the rest). A manifest or lockfile that could not be read is listed in
`dependencies.unread` with one `DEPENDENCY_CHECK_INCOMPLETE` message. It is an `error`, and the verdict is `fail`, when
the pull request can be the cause: a file that is not valid, over 32 MiB (the cap for one file, the same as the cap for
one side), past 100 files or 32 MiB a side, binary, or missing at its revision. The message names each file, its reason
and the cap it went past. It stays a warning only when git could not read that side at all (a diff not from local git,
a shallow clone): the runner's doing, not the pull request's. So a lockfile the check could not read never passes where
the same lockfile read would block. With `dependencies: never` nothing is read and there is no message. The comment shows a **📦 Dependencies** section when something was added or changed. Messages name counts and
`path:line` only. A Dependabot bump that changes the manifest and the lockfile together, and a lockfile-only refresh
of transitive versions, give no finding. What D04 and D05 do not read is in [What dependency safety does not read](../LIMITS.md#what-dependency-safety-does-not-read).
