# Org policy

A policy sets one gate for every repository of an organization, so a pull request cannot loosen it. It is a JSON
document ([`schema/policy.v1.json`](../schema/policy.v1.json)) that the pharn.dev app serves, or that a pull request
carries in a file. This release applies the coverage, setup (including the lists that P02 to P06 check, and
`setup.consistency` for P07) and test-integrity keys, and `agents.labels`, `agents.extra_logins`,
`agents.protected_paths`, `agents.protected_paths_mode`, `agents.max_files` and `agents.max_changed_lines`, and
`flaky.quarantine` (whether the app's quarantine list applies to the [JUnit results](checks/flaky-tests.md)),
and the `dependencies` keys ([Dependency safety](checks/dependencies.md)). The one other `agents` key,
`agents.require_human_approval`, and rule P12 that it is meant for are validated and not applied: they change nothing.

**What is sent.** With `policy: auto` (the default) or `required`, and only when the job grants `id-token: write`, the
Action makes one `GET` of `/api/v1/policy?repo=<owner>/<name>` on the pharn.dev app. Only the OIDC token and the repository name
leave the job: no file content, diff, coverage file or log. The token is for the audience `pharn.dev` and is masked in
the log. Without `id-token: write` (a fork pull request never gets it) nothing is sent, one info line says why, and the
check runs with the workflow inputs and `.pharn/ci.yml`. When the job grants `id-token: write` but the token request
fails, times out (30 s) or returns no token, nothing is sent either, and the report says so: one `POLICY_UNAVAILABLE`
warning with the reason `no-oidc-token` (an error with `policy: required`), and one info line that names the error's
class and nothing else of it. The `policy` and `app-url` inputs are in the
[Action reference](action.md). `app-url` takes an `https` origin only: no credentials, path, query or fragment.
The CLI never fetches a policy.

**Precedence.** The app's policy beats the workflow inputs, which beat `.pharn/ci.yml`. `coverage.threshold` (the
larger value applies), `setup.require` (`true` wins) and the test-integrity mode are merged to the stricter value, so
for these three the config may raise an input but never lower it. An input still replaces the config's `file`, `root`
and `format`, and `coverage.exclude` is the config's patterns plus the input's. With no input the config's values apply
as written, a lower threshold or a wider `exclude` included. `.pharn/ci.yml` comes from the pull request, so pin a
threshold you rely on with the `threshold` input or a policy (docs/THREAT-MODEL.md §3, item 37). A served policy:

- raises `coverage.threshold` (the larger value applies) and `setup.require` (`true` wins), and raises the
  test-integrity mode above the input and the config (`block > warn > off`);
- replaces `coverage.exclude` and `coverage.root` (`null` is the repo root) and sets per-signal severities
  (`test_integrity.signals`) and the `test_integrity.accept_label`;
- adds its `setup.expect` tools to the others.

A setting of the workflow inputs or `.pharn/ci.yml` that the policy beat is named in one `POLICY_OVERRIDE_IGNORED`
warning (a threshold with both numbers; never a pattern, root, label or registry host).

**No policy, or no way to read it.** A repository with no policy (`204` or `404`) is silent under `auto` and its report is the
same as with `policy: never`; after a `404` (the Pharn GitHub App is not installed) the PR comment and the job summary
end with the install hint. Any other failure (a network error, a timeout, a `429`, a `5xx`, a response over 1 MiB, one that does
not validate, a failed token request) is one `POLICY_UNAVAILABLE` warning, last in the report, and the check runs with the workflow inputs and
`.pharn/ci.yml`. With `policy: required` every one of these, and a missing token, is a `POLICY_UNAVAILABLE` error and
the check fails. A request is retried once after a network error or a `5xx`; it never follows a redirect, and nothing the
app answers is quoted in the report.

**A policy newer than the pinned Action.** The app serves one policy to every version of the Action, and a repository
pinned to an older commit may meet keys that version does not know: a newer signal id in `test_integrity.signals`, a
newer rule in `policy.rules`, a new key anywhere in the policy or in the response around it, or a new tool in
`setup.expect`. That version skips them and applies the rest of the policy (the threshold, the mode, the protected
paths and every other key it knows), and one `POLICY_KEYS_UNKNOWN` warning names what it skipped: up to 20 dotted
paths such as `policy.test_integrity.signals.TI18` or `policy.setup.expect[new-tool]`, sorted, each cut to 64
characters, and a count of the rest. A skipped key is not enforced until the pin is updated. A key it knows with a value
it cannot use (a threshold that is a string, a mode it has no name for) still makes the response invalid: that is a
`POLICY_UNAVAILABLE` warning, or an error under `policy: required`. The envelope's `version`, `policy`, `quarantine`,
`settings.uploadJunit` and `settings.messageMaxBytes` are required; `etag`, `updatedAt` and `settings.redactMessages`
are not read, so they are optional and whatever they hold is skipped (versions up to 0.11 still require them, so the
app keeps sending them). A `file:` policy is not lenient: an unknown key there fails the step, as before.

**`policy: file:<path>`.** A policy document read from the workspace (in the CLI, `--policy-file <path>`). The pull
request carries the file, so it can only tighten: a higher threshold, `setup.require: true`, a stricter mode, more
`setup.expect` tools and higher signal severities. Exclusions, a root, an accept label, `policy.required`, `dependencies.registries`, a non-empty
`dependencies.allowed_hosts` and `injection.exempt` are not allowed from a file, and a value lower than the workflow inputs give is ignored; both are named in
`POLICY_OVERRIDE_IGNORED`. Nothing is fetched. The path is relative, stays inside the repository, goes through no
symbolic link and names a regular file of at most 1 MiB; anything else fails the step (the CLI exits `2`) with a fixed
message that never names the path. What the policy does not cover is in [`docs/LIMITS.md`](LIMITS.md).

**Changing a `file:` policy.** Every pull request that edits the policy file, or renames it away, gets a P09 violation
at `block` (a `POLICY_P09` error), whatever the edit does, a tightening included. The file can only raise P09's
severity, never lower or switch it off, and the accept label does not lift it, so that pull request always fails the
check. Change the policy in a pull request of its own, have it reviewed, and have an admin merge it past the failing
check as your branch protection allows. The pull requests after it are checked against the merged file. A policy
served by the app is changed in the app, where no pull request can edit it.

The Action and the CLI also read the file at the base commit the diff is taken against (the base branch's copy), and
unite that copy with the pull request's, key by key, before anything is applied, so a pull request that edits the file cannot loosen any setting the file may carry. The
stricter of the two copies applies:

- Lists are unions (the pull request's entries, then the base's the pull request lacks): `setup.expect`,
  `setup.forbidden_permissions`, `setup.required_permissions_deny`, `setup.forbidden_mcp_servers`,
  `setup.required_hooks` (an entry is its event and matcher), `setup.forbidden_files`, `agents.labels`,
  `agents.extra_logins`, `agents.protected_paths` and `injection.phrases`. At most 100 policy phrases are scanned; the
  base copy's are kept first, so phrases the pull request adds cannot push them out.
- `setup.allowed_mcp_servers` is the servers both copies name; when they share none it is the base's list, and when
  only one copy sets it, that copy's.
- Numbers: `coverage.threshold`, `dependencies.min_age_days` and `dependencies.min_weekly_downloads` take the higher
  value; `agents.max_files` and `agents.max_changed_lines` the smaller.
- Switches: `setup.require`, `dependencies.lookup` and `agents.require_human_approval` are on when either copy says
  `true`; `flaky.quarantine` is off when either says `false`.
- Severities take the stricter value: `setup.consistency`, `test_integrity.mode`, `test_integrity.signals.<id>`,
  `policy.rules.<id>`, `agents.protected_paths_mode` and `injection.signals.<id>`.
- Head copy only, because a file may not set them: `coverage.exclude`, `coverage.root`, `test_integrity.accept_label`,
  `policy.required`, `dependencies.registries`, `dependencies.allowed_hosts` and `injection.exempt`. The base's value
  of these is neither applied nor named.

A setting the pull request's copy has looser than the base copy's (a lower value, a deleted key or object, a list that
lost an entry, a wider allowlist) is named in `POLICY_OVERRIDE_IGNORED` and not applied; a lower threshold is named
with both numbers. Looser is judged on what applies, the default included: a base value equal to the setting's default
that the pull request deletes is not named. Two exceptions: a base `agents.protected_paths_mode: block` the pull
request deletes or lowers is named, though `block` is the default; and a `test_integrity.mode` the pull request sets
below the base's mode is named, even when the inputs give `off`. Where the base copy is `absent` (a pull request that adds the file), cannot be read, or
there is no local diff to name the base (the Action in PR-number mode, a compare-API diff), only the pull request's copy
applies, as before.

**Rules.** A policy also runs rules. P01, P08, P09, P10, P11 and P14 read what the check already has (the agent setup
inventory, the tracked files, the diff, the pull request's metadata and the policy itself). P02 to P06 read the agent
settings and MCP files, P07 reads the inline code and shell blocks of the agent instruction files, and P13 reads the
agent settings, MCP, workflow and CODEOWNERS files an agent pull request touches, at the merge base and at HEAD, only in
[policy mode](#policy-mode): the agent setup inventory never reads a setup file. Each finding is in the report's
`policy.violations` and in the comment's Policy section. `policy.rules` sets a rule's severity (`block`, `warn`,
`info` or `off`); a `file:` policy can only raise it.

- **P01**, required agent setup: `setup.require` or `setup.expect` set by the policy and not met; it raises `NO_AGENT_SETUP_FILES` and `AGENT_SETUP_EXPECTED_MISSING` to the rule's severity (`error` by default).
- **P02**, forbidden permission allowed: an `allow` rule of a settings file is equal to, broader than or inside a `setup.forbidden_permissions` entry, `permissions.defaultMode` is `bypassPermissions` or `auto`, or `permissions.additionalDirectories` is not empty (`POLICY_P02`, `error`; `warn` for `additionalDirectories`).
- **P03**, required deny missing: a settings directory has no `deny` rule equal to or broader than a `setup.required_permissions_deny` entry (`POLICY_P03`, `error`).
- **P04**, MCP server not allowlisted: a server of an MCP file, or an `enabledMcpjsonServers` name, is not in `setup.allowed_mcp_servers`, or `enableAllProjectMcpServers` is on (`POLICY_P04`, `error`).
- **P05**, forbidden MCP server: a server's name, command, command line or URL matches a `setup.forbidden_mcp_servers` entry (`POLICY_P05`, `error`).
- **P06**, required hook missing: a settings directory has no command hook for a `setup.required_hooks` event whose matcher covers the required one, or `disableAllHooks` is on (`POLICY_P06`, `error`).
- **P07**, agent instruction files disagree: instruction files in one directory name different package managers or JavaScript test runners (`POLICY_P07`, `warn`; `setup.consistency` sets its severity). See [Policy mode](#policy-mode).
- **P08**, forbidden file tracked: a tracked file matches a `setup.forbidden_files` pattern (`POLICY_P08`, `error`).
- **P09**, the pull request loosens the policy it is graded by: it edits the policy file, the config while it sets a value looser than the policy, a workflow while a workflow input is looser than the policy, or an agent settings or MCP file the policy checks (`POLICY_P09`; `error` when the file fails P02 to P06 or could not be checked, `warn` when it only warns, and `warn` when the files were not read; an edited file that complies or supplies a required deny rule or hook is no finding).
- **P10**, policy unavailable: the policy could not be read (`POLICY_UNAVAILABLE`). It fails the check only under the workflow input `policy: required`: a policy that could not be read cannot ask for that. The policy's own `policy.required` (app policy only) makes agent settings files that could not be read a `POLICY_SETTINGS_INVALID` error instead of a warning.
- **P12**, agent PR needs a human approval: validated and not applied. `agents.require_human_approval` and `policy.rules.P12` are accepted and change nothing; no P12 finding is produced.
- **P11**, agent PR changes a protected path: an agent pull request changes a path that `agents.protected_paths` lists (`POLICY_P11`, `error`).
- **P13**, agent self-modification: an agent pull request widens its own or another agent's powers in an agent settings file, an MCP config, a workflow or CODEOWNERS (`POLICY_P13`, `error`). See [P13](#p13-agent-self-modification).
- **P14**, agent PR too large: an agent pull request changes more files than `agents.max_files` or more lines than `agents.max_changed_lines` (`POLICY_P14`, `error`). Off until the policy sets a cap; lockfiles, snapshots and generated files do not count.

**P11.** `agents.protected_paths` is a list of globs (the syntax of `coverage.exclude`) of the paths an agent pull
request may not change, and `agents.protected_paths_mode` (`block` or `warn`, default `block`) sets the severity; the
stricter of it and `policy.rules.P11` applies, and `off` in `policy.rules.P11` alone switches the rule off.

```json
{
  "version": 1,
  "agents": {
    "protected_paths": [".github/workflows/**", "migrations/**", "**/*.lock"],
    "protected_paths_mode": "block"
  }
}
```

Every path of the diff that matches a glob is one violation (a rename counts by both its old and its new path), and one
`POLICY_P11` message names up to 20 of them and the evidence that made the pull request an agent PR, as fixed words,
never a glob, label or login. A person's pull request is never subject to P11. A missing diff fails closed: an agent
pull request whose diff is unavailable gets one violation that says so. A `file:` policy always blocks: a lower
`protected_paths_mode` or `policy.rules.P11` is named in `POLICY_OVERRIDE_IGNORED` and does not apply, and the policy
file is also read at the base commit so that editing it removes nothing. Dependabot and Renovate count as agent PRs, so
protecting `package.json` or a lockfile blocks them: do not protect files those bots must update. At most 50 violations
are listed (the rest are counted in the message). The accept label never touches P11.

## P13, agent self-modification

P13 needs no setting: under any app or file policy it compares, for an agent pull request, each file of these four
kinds that the diff adds, modifies, renames or deletes, between the merge base and HEAD (an added file against nothing,
a deleted one against nothing, a rename as the old path deleted and the new path added). It reads JSON and YAML
structure, never what a command does. One violation per file names what widened, in fixed words:

- **Agent settings** (`.claude/settings.json`, `.claude/settings.local.json`, at any depth): an `allow` rule added, a
  `deny` rule removed, `defaultMode` set or changed, an `additionalDirectories` entry added, any change to `hooks` other
  than reordering (a rewritten hook can be a neutered hook), `disableAllHooks` or `enableAllProjectMcpServers` turned
  on, a name added to `enabledMcpjsonServers` or removed from `disabledMcpjsonServers`.
- **MCP configs** (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, at any depth): a server added, or a server's
  `command`, `args`, `url` or `type` changed.
- **Workflows** (`.github/workflows/*.yml|yaml`): a secret referenced that was not before (`secrets: inherit` and the
  whole `secrets` context count), a permission scope raised at the workflow or job level (none < read < write; a job
  without a block inherits the workflow's), `read-all` or `write-all` newly appearing, a `permissions:` block removed
  from a workflow or job that is still there, or a `pull_request_target` trigger added.
- **CODEOWNERS** (`CODEOWNERS`, `.github/CODEOWNERS`, `docs/CODEOWNERS`): any change but owners added to an unchanged
  rule line (comments and blank lines aside); an added or deleted CODEOWNERS counts.

Narrowing changes give nothing, and a person's pull request is never subject to P13. It fails closed: a missing diff is
one violation, and a file that could not be read or parsed on a side it exists on (a YAML anchor, alias or flow-mapped
job included) is one violation that says it could not be compared. The default is `block`; a `file:` policy cannot
lower it (`POLICY_OVERRIDE_IGNORED`), an app policy can set `policy.rules.P13`. A violation never carries a permission
rule, server name, secret name, owner or hook command. The Action reads the files from committed objects (`git
cat-file`) only when the diff came from the local checkout, with the caps of the test sources (200 files, 512 KiB each,
16 MiB in all); PR-number mode and a compare-API diff leave every touched file uncompared. The CLI has no agent PR
detection, so it never runs P13. What it misses is in [`docs/LIMITS.md`](LIMITS.md).

## P14, agent PR size cap

Review capacity is what large agent pull requests break, and a cap is the deterministic form of "split large
PRs". P14 is opt-in: set `agents.max_files` / `agents.max_changed_lines` to turn it on. There is no default cap, so a
repository whose policy sets neither sees no change. Each cap is checked only when it is set; a pull request at the cap
passes, and one over it fails.

```json
{
  "version": 1,
  "agents": { "max_files": 25, "max_changed_lines": 800 }
}
```

A file is a diff entry (a rename counts once); its lines are the added plus the removed lines the diff shows (a binary
file counts as a file with no lines). Generated files do not count: lockfiles (`package-lock.json`,
`npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `uv.lock`,
`Pipfile.lock`, `composer.lock`, `Gemfile.lock`, `go.sum`, in any directory), snapshots (anything under
`__snapshots__/`, and `*.snap`) and `*.generated.*` files, nor do paths the run's `coverage.exclude` matches. A pull
request that edits the config in use or a workflow could exclude its own files, so then `coverage.exclude` is not used
and every such file counts, unless the exclusions are the app policy's (which a pull request cannot change).

Each exceeded cap is one path-less violation, for example `agent PR changes 31 files (cap 25); split it by area:
docs, packages`. The areas are the top-level directories of the counted files (`.` for a file at the root), at most 10
and then a count; nothing of a file's text is named. One `POLICY_P14` message carries the counts, the areas and the
evidence that made the pull request an agent PR, as fixed words. A person's pull request is never subject to P14. A
missing diff fails closed with one violation that says so. The severity is `block`; an app policy may set
`policy.rules.P14` to `warn`, `info` or `off`, and a `file:` policy can only raise it (a lower value is named in
`POLICY_OVERRIDE_IGNORED`). A `file:` policy can lower a cap but never raise or remove one: when the pull request edits
the file, each cap is the smaller of its value at the base commit and at head (a cap set on one side only applies), and
an edited file that cannot be read at the base commit fails closed. What P14 misses is in
[`docs/LIMITS.md`](LIMITS.md).

## Policy mode

With a policy in force, pharn-ci reads the tracked `.claude/settings.json` and `.claude/settings.local.json` files
(at the root and in nested directories) and, when the policy lists MCP servers, `.mcp.json`, `.cursor/mcp.json` and
`.vscode/mcp.json` (these too at the root and in nested directories; the last two are a cross-tool scan), all as
committed at HEAD. For an agent pull request, P13 also reads the agent settings, MCP, workflow and CODEOWNERS files
the diff touches, at the merge base and at HEAD ([P13](#p13-agent-self-modification)). For P02 to P06 it reads JSON only;
P07's read of the Markdown instruction files is described in
[Policy mode: agent instruction files](what-it-proves.md#policy-mode-agent-instruction-files).
A tracked symbolic link is never followed.

- **P02** compares each `allow` rule with `setup.forbidden_permissions`; a deny rule never excuses an allow rule. Its fixed
  checks need no list: `defaultMode` set to `bypassPermissions` or `auto`, and a non-empty `additionalDirectories`.
- **P03** and **P06** judge each settings directory on its own (a nested `.claude/` gets no fallback from the root) and
  report a missing deny rule or hook at its `settings.json`. A deny rule counts when it is equal to or broader than the
  required one, a hook counts when it is a command hook without an `if` condition whose matcher covers the required one,
  and `disableAllHooks` is one finding in place of the missing hooks.
- **P04** and **P05** read the MCP servers: P04 also flags `enableAllProjectMcpServers`, and P05 never reads `env` or `headers`.

Rules are compared with rules, never with what a command does. In a rule, `/x` is relative to the settings file's
project directory and `//x` is absolute, so a policy forbids the system `/etc` with `Edit(//etc/**)`. Nothing read from a
file leaves the job: a finding carries only the rule id, the path, the line, fixed words and the policy's own text. An
unparseable file is `POLICY_SETTINGS_INVALID` (never a crash), and a file pharn-ci could not read counts against the
policy. **P02–P06 are text guards, not a security boundary**: a `Bash(curl:*)` deny does not stop
`/usr/bin/curl` or `sh -c`, and sandboxing is the boundary. What they miss is in [`docs/LIMITS.md`](LIMITS.md).
