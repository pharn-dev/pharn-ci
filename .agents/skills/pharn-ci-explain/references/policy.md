# Org policy (pharn-ci 0.4.x to 0.9.x)

Source: pharn-ci v0.4.0 at commit `a9314e9fda1ae220e42fa0d7e6ff5c0a04e1d756` and
v0.9.1 at `dec4a0ed2d0b111233522753909c74a90b6d09e0`: README ("Org policy", "P13",
"P14", "Policy mode", "Agent PRs", "Prompt-injection scan", "Dependency safety",
"Flaky tests and JUnit results"), CHANGELOG, `schema/report.v2.json`,
`schema/policy.v1.json`, `packages/core/src/policy/` and `docs/LIMITS.md`.
pharn-ci 0.1.x to 0.3.x read no policy. The other message codes are in
[codes.md](codes.md), the report's fields in [report.md](report.md), and writing
a policy document is the `pharn-ci-policy` skill's job.

An org policy sets one gate for every repository of an organization, so a pull
request cannot loosen it. It is a JSON document (`schema/policy.v1.json`) that the
pharn.dev app serves to the Action, or that a pull request carries in a file
(`policy: file:<path>`, or `--policy-file` for the CLI). 0.4.0 applies the
coverage, setup (including the lists P02 to P06 check, and `setup.consistency`
for P07) and test-integrity keys, and `agents.labels`, `agents.extra_logins`,
`agents.protected_paths` and `agents.protected_paths_mode`. 0.6.0 adds rules
P13 and P14 (`agents.max_files`, `agents.max_changed_lines`); 0.7.0 the
`injection` keys of the prompt-injection scan; 0.8.0 the `dependencies` keys
and `flaky.quarantine`. In 0.9.x `agents.require_human_approval` (meant for
P12) is still validated and not applied. The pharn.dev app's policy response
also carries settings that are not part of the policy document (for example
`settings.uploadJunit`, which keeps the JUnit results out of an upload, and
`settings.messageMaxBytes`) and the quarantine list.

A policy finding is about this repository, so **the honest fix is to change the
flagged file** (for example `.claude/settings.json` or a workflow), never the
policy, a rule's level, a protected path or `.pharn/ci.yml`. The policy belongs to
its owner. A pull request that edits the policy it is graded by raises P09.

## Rules P01 to P14

Each finding is in the report's `policy.violations` and in the comment's
📜 Policy section; the message code carries the rule's level. A policy's
`policy.rules` sets a rule's severity (`block`, `warn`, `info` or `off`); a `file:`
policy can only raise it. There is no P12 rule in 0.9.x: `policy.rules.P12` and
`agents.require_human_approval` are accepted by the schema and not enforced.

| Rule | Code | Default level | What it checks |
| ---- | ---- | ------------- | -------------- |
| P01 | `NO_AGENT_SETUP_FILES` and `AGENT_SETUP_EXPECTED_MISSING` | error | Required agent setup: `setup.require` or `setup.expect` is set by the policy and not met. The rule raises these two codes to its severity. |
| P02 | `POLICY_P02` | error (warn for `additionalDirectories`) | An `allow` rule of a settings file equals, is broader than or lies inside a `setup.forbidden_permissions` entry; `permissions.defaultMode` is `bypassPermissions` or `auto`; or `permissions.additionalDirectories` is not empty. |
| P03 | `POLICY_P03` | error | A settings directory has no `deny` rule equal to or broader than a `setup.required_permissions_deny` entry. |
| P04 | `POLICY_P04` | error | An MCP server, or an `enabledMcpjsonServers` name, is not in `setup.allowed_mcp_servers`, or `enableAllProjectMcpServers` is on. |
| P05 | `POLICY_P05` | error | An MCP server's name, command, command line or URL matches a `setup.forbidden_mcp_servers` entry. |
| P06 | `POLICY_P06` | error | A settings directory has no command hook for a `setup.required_hooks` event, or `disableAllHooks` is on. |
| P07 | `POLICY_P07` | warn | Agent instruction files in one directory name different package managers or JavaScript test runners (`setup.consistency` sets its severity). |
| P08 | `POLICY_P08` | error | A tracked file matches a `setup.forbidden_files` pattern. |
| P09 | `POLICY_P09` | error, warn or info | The pull request edits what it is graded by: the policy file, the config or a workflow that sets a value looser than the policy, or an agent settings or MCP file the policy checks. |
| P10 | `POLICY_UNAVAILABLE` | warn (error with `policy: required`) | The policy could not be read. |
| P11 | `POLICY_P11` | error | An agent pull request changes a path that `agents.protected_paths` lists. |
| P13 | `POLICY_P13` | error | 0.6.0: an agent pull request widens its own or another agent's powers in an agent settings file, an MCP config, a workflow or CODEOWNERS. Needs no setting. |
| P14 | `POLICY_P14` | error | 0.6.0: an agent pull request changes more files than `agents.max_files` or more lines than `agents.max_changed_lines`. Off until the policy sets a cap. |

## Codes

### `POLICY_UNAVAILABLE` (warn; error with `policy: required`)

Rule P10. The org policy could not be fetched or used, so the check ran with the
workflow inputs and `.pharn/ci.yml`. It is last in the report. With `policy: auto`
(the default) a repository with no policy (`204` or `404`) is silent and gets no
such message; any other failure (a network error, a timeout, a `429`, a `5xx`, a
response over 1 MiB, one that does not validate) is one `warn`. With
`policy: required` every one of these, and a missing OIDC token, is an `error` and
the check fails. The text names the reason, the HTTP status when there is one and
the request id the app sent; the job log has the same request id.

- Look at: the workflow's `permissions:` (`id-token: write` is needed to fetch a
  policy; a fork pull request never gets it) and the `policy` and `app-url` inputs.
- Fix: grant `id-token: write` where an app policy is wanted, or use
  `policy: file:<path>`. The message is not about the change, and never a reason to
  switch the policy off.

### `POLICY_OVERRIDE_IGNORED` (warn)

Settings looser than the org policy, or not allowed from a policy file, were not
applied, and the policy's value applies. The text names each setting and its layer
(the workflow inputs or `.pharn/ci.yml`; up to 20, then a count), with both numbers
for a coverage threshold, and never a pattern, root or label.

- Look at: the named layer. In a `file:` policy, the keys it may not set (below).
- Fix: bring the looser value up to the policy's, or drop the setting that has no
  effect. Do not argue the policy down: the policy wins by design.

### `POLICY_P02` (error)

An allow rule of a committed agent settings file overlaps a forbidden permission,
`permissions.defaultMode` is `bypassPermissions` or `auto`, or
`additionalDirectories` is set. `error`, except `warn` for `additionalDirectories`
(or the level the policy sets). The text names up to 20 locations as path and line,
and the count. A deny rule never excuses an allow rule.

- Look at: each `path:line` in `.claude/settings.json` or `.claude/settings.local.json`
  (root or nested).
- Fix: narrow or drop the allow rule in that settings file, or set a default mode
  the policy allows. Never the policy.

### `POLICY_P03` (error)

A settings directory lacks a deny rule the policy requires (`error`, or the level
the policy sets). Each directory is judged on its own: a nested `.claude/` gets no
fallback from the root. The text names up to 20 locations and the count.

- Fix: add the required deny rule (or one broader) to that directory's `settings.json`.

### `POLICY_P04` (error)

An MCP server is not on the policy's allowlist, or `enableAllProjectMcpServers`
is on (`error`, or the level the policy sets). Read from `.mcp.json`,
`.cursor/mcp.json` and `.vscode/mcp.json` when the policy lists MCP servers.

- Fix: drop the server from the MCP file, or turn `enableAllProjectMcpServers` off.
  Adding a server to the allowlist is the policy owner's decision, outside the PR.

### `POLICY_P05` (error)

An MCP server matches an entry the policy forbids, by name, command, command line
or URL (`error`, or the level the policy sets). `env` and `headers` are never read.

- Fix: drop the server from the MCP file.

### `POLICY_P06` (error)

A settings directory lacks a command hook the policy requires, or `disableAllHooks`
is on (`error`, or the level the policy sets). A hook counts when it is a command
hook without an `if` condition whose matcher covers the required one.

- Fix: add the hook to that directory's `settings.json`, or turn `disableAllHooks` off.

### `POLICY_P07` (warn)

Agent instruction files in the same directory name different package managers or
JavaScript test runners, or some could not be compared (`warn` by default; `error`
when the policy sets `setup.consistency` or the rule to `block`; `info` when it sets
`info` or the files could not be read). The text names up to 20 files. Each
violation has a path, a line and the tools as fixed words, never the file's text.

- Fix: make the files agree (one package manager, one test runner).

### `POLICY_P08` (error)

Tracked files match a forbidden file pattern of the policy (`error`, or the level
the policy sets). The text names up to 20 paths and the count.

- Fix: untrack and delete the file (`git rm --cached`, `.gitignore` for a local copy).
  If it held a secret, rotate it.

### `POLICY_P09` (error, warn or info)

The change edits a file the policy guards: the policy file, the config or a workflow
while it sets a value looser than the policy, or an agent settings or MCP file.

- **error**: the file fails P02 to P06, or could not be checked.
- **warn**: it only warns, or supplies a required deny rule or hook, or the files were
  not read.
- **info**: the edited file complies.
- The text names up to 20 paths; each reason is in `policy.violations`. A pull
  request that edits the policy it is graded by raises P09.
- Fix: revert the edit that loosens a guarded value, or make the settings file
  comply. A `file:` policy that the pull request carries can only tighten, so editing
  it cannot loosen the gate.

### `POLICY_P11` (error)

An agent pull request changes a path that the policy's `agents.protected_paths`
lists, or could not be checked because the diff, or the policy file at the merge
base, could not be read (`error`; `warn` when the policy sets the mode or the rule
to `warn`). The text names up to 20 paths and the evidence that made the PR an
agent PR, as fixed words, never a glob, label or login. A person's pull request is
never subject to P11. Dependabot and Renovate count as agent PRs, so protecting
`package.json` or a lockfile blocks them.

- Look at: the paths in the text, and `meta.isAgentPr` with `meta.agentHint`.
- Fix: revert the agent's change to the protected path; a person makes that change
  in their own pull request. Do not relabel the PR or change its author to get past
  detection, and never touch `agents.protected_paths`.

P11 is Action-only: the CLI has no pull request and never sets `meta.isAgentPr`.
A `file:` policy always blocks for P11 (a lower `protected_paths_mode` or
`policy.rules.P11` is named in `POLICY_OVERRIDE_IGNORED`), and the policy file is
also read at the merge base, so a pull request that edits the file it is graded by,
including one that drops a path from `agents.protected_paths`, does not loosen
P11: the merge-base copy still counts. The accept label never touches P11.

### `POLICY_P13` (error)

0.6.0 and later. Agent self-modification: under any app or `file:` policy, an
agent pull request that widens what an agent may do. For each agent settings
file (`.claude/settings.json`, `.claude/settings.local.json`), MCP config
(`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`), workflow
(`.github/workflows/*.yml`) and CODEOWNERS file the diff adds, modifies,
renames or deletes, pharn-ci compares the merge base with HEAD and reports one
violation per file, naming the widening in fixed words: an `allow` rule added, a
`deny` rule removed, `defaultMode` set or changed, an `additionalDirectories`
entry added, a hook removed or rewritten, `disableAllHooks` or
`enableAllProjectMcpServers` turned on, an MCP server added or its command,
args, URL or type changed, a secret newly referenced, a workflow permission
raised or its block removed, `read-all` or `write-all` added,
`pull_request_target` added, or a CODEOWNERS change other than owners added.
Narrowing changes give nothing. It fails closed: a missing diff, or a file that
could not be read or parsed on a side it exists on, is one violation. A
violation never carries a rule, server name, secret name, owner or command.

- Level: `error` by default; an app policy can set `policy.rules.P13`, a `file:`
  policy cannot lower it (`POLICY_OVERRIDE_IGNORED`). A person's pull request is
  never subject to P13, and the CLI never runs it (it has no agent PR detection).
  PR-number mode and a compare-API diff leave every touched file uncompared.
- Look at: each named file's diff (`git diff --literal-pathspecs <base>...HEAD -- '<path>'`)
  and `meta.isAgentPr` with `meta.agentHint`.
- Fix (`revert-config`): revert the agent's edit that widens what an agent may do.
  A person who wants the wider setting makes that change in their own pull
  request, where a reviewer sees it. Never relabel the PR or change its author to
  get past detection.

### `POLICY_P14` (error)

0.6.0 and later. Agent PR size cap, opt-in: it runs only when the policy sets
`agents.max_files` or `agents.max_changed_lines`, and there is no default cap.
An agent pull request over a cap gets one path-less violation per exceeded cap
that names the count, the cap and the top-level directories touched (for example
`agent PR changes 31 files (cap 25); split it by area: docs, packages`). A file
is a diff entry (a rename counts once); its lines are the added plus removed
lines. Lockfiles, snapshots, `*.generated.*` files and `coverage.exclude` paths do
not count (`coverage.exclude` does count when the pull request edits the config
in use or a workflow, unless the exclusions are the app policy's). A missing
diff fails closed.

- Level: `error`; an app policy may set `policy.rules.P14` to `warn`, `info` or
  `off`, and a `file:` policy can only raise it. A `file:` policy the pull
  request edits can lower a cap but never raise or remove one: each cap is the
  smaller of its merge-base and head values. A person's pull request is never
  subject to P14.
- Fix (`split-pr`): split the change into smaller pull requests within the caps,
  by the areas the message names. Never raise or remove a cap to get a pull
  request through: the caps are the policy owner's.

### `AGENT_PR_DETECTION_INCOMPLETE` (warn)

See [codes.md](codes.md): the evidence could not be read in full, so the PR counts
as an agent PR for P11.

### `POLICY_SETTINGS_INVALID` (warn; error for a file pharn-ci could not read)

Rules P02 to P06 could not fully use an agent settings or MCP file, or did not run:
the files were not read, a file was dropped, unparseable, or has an entry the grammar
does not know. `warn`, but `error` for a file pharn-ci could not read or a problem a
required list depends on, because a file pharn-ci could not read counts against the
policy. The text names up to 20 problems as path, line and reason, never file text.

- Fix: repair the named file (valid JSON, entries the settings grammar knows).

## The 📜 Policy comment section and the policy object

With an org policy in force (or a policy message to report), the comment has a
📜 Policy section after the 🔍 Test integrity section: where the policy came from, the
unavailable text when there is one, then each violation as
``- <icon> **<rule id>** `path:line` — <detail>``, blocks first, each with a `Hint:`
line, and the ignored-settings line. Up to 10 violations are open, more are folded
away, and at most 50 are listed (the rest are counted). With no violations it reads
`No policy violations.`.

The same findings are in the report's `policy` object (see [report.md](report.md)):
`source` (`app`, `input`, `config` or `none`), `version`, and `violations[]`, each
with the rule `id`, `severity`, `path`, `line` (either can be `null`) and a fixed-text
`detail`. A violation names a rule, a path and a line, and never a value from a file.

## Agent PRs: `meta.isAgentPr`

In the Action, `meta.isAgentPr` says whether the pull request counts as an agent PR,
and `meta.agentHint`, `meta.prAuthor`, `meta.prLabels` and `meta.coAuthors` carry
what it was read from. The detection reads metadata only (the author, the labels and
the commits' authors, committers and `Co-authored-by` trailers), never a file or the
diff, and on its own it changes no verdict, message, comment or exit code: only P11
reads it. A pull request counts as an agent PR when its author is a bot (Dependabot
included), a known agent (Claude Code, Copilot, Codex, Devin, Cursor, Gemini, Jules)
or a login the policy lists (`agents.extra_logins`); when one of its commits is
authored or committed by such a login or carries a known agent's `Co-authored-by`
trailer; or when it carries a label `agent` or `ai-generated` (or the policy's
`agents.labels`). Evidence that cannot be read in full counts as an agent PR: an
unknown author, commits that cannot be listed, more than 250 commits, or an edited
`file:` policy whose merge-base copy cannot be read.

## What a policy can and cannot do

- **P02 to P06 are text guards, not a security boundary.** They compare rules with
  rules, never with what a command does: a `Bash(curl:*)` deny does not stop
  `/usr/bin/curl` or `sh -c`, and sandboxing is the boundary. Say so when a
  finding is read as proof of safety, and read `docs/LIMITS.md` in pharn-ci for what
  they miss.
- **Precedence.** The app policy beats the workflow inputs, which beat
  `.pharn/ci.yml`. Since 0.6.0 `coverage.threshold` (the larger applies),
  `setup.require` (`true` wins) and the test-integrity mode are merged to the
  stricter value, so `.pharn/ci.yml` may raise an input but never lower it; an
  input still replaces the config's coverage file, root and format, and
  `coverage.exclude` is the config's patterns plus the input's. A served policy
  raises `coverage.threshold` and `setup.require`, raises the test-integrity
  mode above the input and the config, replaces `coverage.exclude` and
  `coverage.root`, sets per-signal severities and the accept label, adds
  `setup.expect` tools, requires dependency safety when it has a `dependencies`
  key (a `never` input becomes `auto`, named in `POLICY_OVERRIDE_IGNORED`), and
  sets the prompt-injection exemptions, phrases and severities. A `file:` policy
  can only raise: a higher threshold, `setup.require: true`, a stricter mode,
  more `setup.expect` tools, higher signal severities, more injection phrases,
  and lower agent PR size caps.
- **What a `file:` policy may not set.** Exclusions, a root, an accept label,
  `policy.required`, `injection.exempt` and `dependencies.registries` are not
  allowed from a file, because the pull request carries it; a value lower than
  the workflow inputs give is ignored. Both are named in
  `POLICY_OVERRIDE_IGNORED`. The path is relative, stays inside the repository,
  goes through no symbolic link and names a regular file of at most 1 MiB.
- **The accept label** signs off test-integrity findings only (block findings of
  `test-integrity: block`). No policy rule reads it: it never touches P11 or any
  other policy finding, an app policy may name the label, a `file:` policy may not
  set an accept label, and this skill never applies it. A policy finding is not
  settled by a label; it is fixed in the flagged file.
