# Report v2

The JSON report is the stable, machine-readable API; the comment and CLI text are renderings of
it. See [`schema/report.v2.json`](../schema/report.v2.json): Report v1
([`schema/report.v1.json`](../schema/report.v1.json), pharn-ci 0.1.x) plus a `testIntegrity` block on every
report and a `meta` block (run metadata) from the Action, with `schemaVersion` the number 2. Every v1 field
except `schemaVersion` (the string `"1"` in v1) keeps its name, type and meaning; a tool that validates the report switches on `schemaVersion`. Branch on
message `code`s, not on text:

| Code                            | Meaning                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `DIFF_COVERAGE_BELOW_THRESHOLD` | Diff coverage is below the configured threshold                |
| `DIFF_COVERAGE_UNGATED`         | Diff coverage was measured but not gated (no threshold, or 0); info |
| `NO_COVERABLE_CHANGES`          | None of the added lines are tracked by the coverage report     |
| `COVERAGE_FILE_MISSING`         | The coverage file does not exist                               |
| `COVERAGE_FILE_EMPTY`           | The coverage file has no usable records                        |
| `COVERAGE_FORMAT_UNSUPPORTED`   | The coverage file is not lcov or Cobertura XML (format `auto`) |
| `DIFF_UNAVAILABLE`              | No diff could be produced, so diff coverage was not computed (`error` with a threshold or in `test-integrity: block`, else `warn`) |
| `COVERAGE_PATHS_UNMATCHED`      | None of the coverage report's file paths is a tracked file, so diff coverage was not computed |
| `COVERAGE_PATHS_PARTIALLY_UNMATCHED` | Some coverage paths are not tracked files; their coverage is not used (`info`) |
| `COVERAGE_LINES_SKIPPED`        | Malformed lcov `DA` records or Cobertura `<line>` elements were skipped; the text gives their number (`info`) |
| `CONFIG_CHANGED_IN_DIFF`        | The change edits the pharn-ci config in use or a workflow under `.github/workflows/` (`warn`); it says the config at the merge base was used, and is an `error` when that copy could not be read under a threshold or in `test-integrity: block` |
| `COVERAGE_FILE_TRACKED`         | The coverage file is tracked in the repository, so the change can supply it (`error` with a threshold when the diff adds or edits it, else `warn`) |
| `DIFF_BINARY_COVERED_FILE`      | The diff shows a covered source file as binary, so its changes were not measured (`error` with a threshold, `warn` without) |
| `TEST_FILES_DELETED`            | The change deletes a test file or renames one to a non-test name (`info`) |
| `TEST_INTEGRITY_MODE_IGNORED`   | `.pharn/ci.yml` sets `test_integrity.mode` looser than the workflow input or the default, so the stricter mode applies (`warn`) |
| `TEST_INTEGRITY_OFF`            | The effective test-integrity mode is `off`, so no test-integrity signal is checked (`info`) |
| `TEST_INTEGRITY_TI01`           | TI01: the change deletes test files whose removed lines defined tests, or renames a test file to a path that is not a test file or to a name that matches no test file pattern, with nothing that accounts for them (`error` in mode `block`, `warn` in mode `warn`); `info` when they go with a source file of the same name, with their whole package (deleted JS/TS or Python source of the package, and no JS/TS or Python file of it left), when every test they held is found again by name and body in another test file of the change, or as a migration to a file of the same name that holds every deleted test's body (found again by body in a new test of the change; the name alone softens nothing); a deleted or renamed-away JS/TS, Python or Go test file that git shows as binary (a `-diff` or `binary` attribute in `.gitattributes`, or non-text content) counts at the same level on its path alone, never `info`. Every file is in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI02`           | TI02: the change removes a test from a JS/TS or Python test file that stays, and no test of the same name or of a similar body (token-set Jaccard of at least 0.8) is left in the touched test files (a test of the same name in another touched file counts only when it holds the removed test's body; `error` in mode `block`, `warn` in mode `warn`, and `warn` for a test whose name is computed). The finding sits at the base path and base line. The text names every file and says how many findings the cap of 20 per file left out; the listed findings are in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI03`           | TI03: the change adds a skip to a test file: an unconditional skip of a test the diff shows existed (`error` in mode `block`, `warn` in mode `warn`), or a conditional skip, a skip inside a test body, a skip in a test the change adds, or a Python module-level skip (`pytest.importorskip`, or `pytest.skip` with `allow_module_level=True`) (`warn`). Every finding is in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI04`           | TI04: the change adds `.only`, `fit` or `fdescribe` to a JS/TS test file, so the runner may skip the other tests (`error` in mode `block`, `warn` in mode `warn`). Every finding is in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI05`           | TI05: a test that had assertions at base has none at head and calls no assertion helper (`error` in mode `block`, `warn` in mode `warn`), or it calls a function whose name suggests an assertion helper, or it lost some assertions with the rest of its body unchanged (`warn`). The finding sits at the head path and head line. The text names every file and says how many findings the cap of 20 per file left out; the listed findings are in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI06`           | TI06: a test that stays became weaker: a strong matcher replaced by a weak one (`toBe(5)` by `toBeTruthy()`), an `expect.assertions` or `expect.hasAssertions` guard lowered or removed, an assertion that compares a literal with itself added, or an assertion moved into a `try` block with a `catch` or after an early `return` (`warn` in every mode). The finding sits at the head path and head line. The text names every file and says how many findings the cap of 20 per file left out; the listed findings are in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI07`           | TI07: a test of a modified JS/TS or Python test file changes only literal expected values of its assertions, in a change that also edits a source file, so the test may have been made to agree with the code (`warn` in modes `block` and `warn`; it never blocks). The text names every file and says how many findings the cap of 20 per file left out; the listed findings are in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI12`           | TI12: a test file newly mocks (`vi.mock`, `vi.doMock`, `jest.mock`, `jest.doMock`, Python `patch` and `monkeypatch.setattr`) a source file the same change adds, modifies or renames, so the test may not run the code under review (`warn` in every mode). One finding per test file and target, at the head path and the line of the first such mock. The text names every file and says how many findings the cap of 20 per file left out; the listed findings are in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI09`           | TI09: the change loosens a test-runner setting so that fewer tests run, a weaker run passes or the coverage gate drops: a lowered or removed coverage threshold, a narrowed test list or widened exclusion, `passWithNoTests`, `allowOnly` or `bail` turned on, a `grep` added, `forbidOnly` turned off, a vitest `dir`, `testNamePattern` or `root` added, a jest `roots` narrowed or `modulePathIgnorePatterns` widened, or a pytest `addopts` that gains a deselecting option, a narrowing path or `-o python_functions=` (`error` in mode `block`, `warn` in mode `warn`). A raised retry count or timeout, a narrowing key set in a config that is new at head, and a value that is not a literal, are `warn`; a modified config read at the merge base that cannot be read or found at HEAD is one `(config)` finding at the mode's level. The finding sits at the head path and the head line of the key (no line for JSON). The text names every file and says how many findings the cap of 20 per file left out; the listed findings are in `testIntegrity.signals` |
| `TEST_INTEGRITY_INDEX_UNAVAILABLE` | A touched JS/TS or Python test file could not be compared at the merge base and at HEAD (too large, dropped, a syntax-error-heavy file, no Python 3.8 or newer), so TI02 and TI05 did not check it; or the tests of an added JS/TS or Python test file could not be read (the same reasons), so no signal checked them; or TI02 and TI05 did not run because the test text could not be read; or a touched test-config file could not be read, so TI09 did not check it, or TI09 did not run (`error` in mode `block` when TI02 and TI05, or TI09, did not run at all, or when a modified test file cannot be indexed at HEAD for the reason `too-deep`, `too-large`, `over-file-cap` or `binary` and the accept label lowers that one to `warn`, else `warn`; not in mode `off`). A modified or renamed JS/TS or Python test file that git shows as binary (a `-diff` or `binary` attribute in `.gitattributes`, or non-text content) is named with the reason `binary` and is such an error whatever the merge base held; an added one is named with the reason `binary` as a `warn`. The text names the files with a reason code each, or the reason |
| `TEST_INTEGRITY_TI10`           | TI10: the change weakens a test script in `package.json` (`\|\| true`, `; true`, `echo` or `exit 0` in place of the run, `--passWithNoTests`, a path or name filter, a piped command or a backgrounded test run, an added `--exclude` or `--testPathIgnorePatterns`, or a removed `pretest` or `posttest`), so the test run can pass without the tests passing (`error` in mode `block`, `warn` in mode `warn`); a `package.json` that git shows as binary is judged from its base and head text when both are given and read as JSON, otherwise it is one finding at the same levels. Every finding is in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI11`           | TI11: a workflow edit may stop CI from running tests: a removed test command or `pull_request` trigger (`error` in mode `block`, `warn` in mode `warn`), or a shrunk matrix, an added `continue-on-error: true`, a disabling `if:` or a `timeout-minutes` of 0 or 1 (`warn`); a workflow file that git shows as binary is one finding at the first level, because its changes could not be read. Every finding is in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI13`           | TI13: the change adds a comment that leaves code out of coverage (an Istanbul, V8 or C8 ignore hint in a JS/TS file, or a `# pragma: no cover` in a Python file that is not a test file) (`error` in mode `block`, `warn` in mode `warn`; `warn` in both for a hint that marks one line or branch of a file the change adds). Every finding is in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI14`           | TI14: the change lowers or removes the coverage threshold, or adds a coverage exclusion, in the pharn-ci config (`error` in mode `block`, `warn` in mode `warn`); a config that git shows as binary and that the change modifies, renames or deletes is one finding at the same levels. Every finding is in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI08`           | TI08: the change regenerates or updates snapshots in bulk: more than 10 snapshot files modified, deleted or renamed with edits, 10 or more inline snapshots rewritten in a JS/TS test file, or a snapshot-update flag added to a test script or a pytest config file (`warn` in modes `block` and `warn`; it never blocks). Every finding is in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI15`           | TI15: the change adds a condition in JS/TS or Python source that compares with a string or number a test file in the same change also adds, so the code may special-case the test (`info` in modes `block` and `warn`; it never blocks or warns). Every finding up to at most 10 per change is in `testIntegrity.signals`, and the message says how many more there are |
| `TEST_INTEGRITY_TI16`           | TI16: the change adds a comment that switches off a linter or type checker in a JS/TS or Python test file (`info`; it never blocks and leaves the verdict at `pass`). Every finding is in `testIntegrity.signals` |
| `TEST_INTEGRITY_TI17`           | TI17: the change adds an assertion that always passes to a JS/TS or Python test file: a custom matcher whose pass is always true, a helper that always returns True, or a wildcard in place of an expected value (`warn` in modes `block` and `warn`; it never blocks unless an org policy sets it). One finding per test file, in `testIntegrity.signals` |
| `TEST_INTEGRITY_TEXT_TRUNCATED` | A file a test-integrity signal reads has more than 5000 changed lines, so the signals read only the first 5000 and a finding past them is not seen (`warn`, or `error` in mode `block` for a JS/TS, Python or Go test file the change modifies, which the accept label lowers to `warn`; not in mode `off`). The text names the files |
| `TESTS_NOT_EXERCISING_CHANGES` | Changed JS/TS source files that no JS/TS test file the change adds or modifies imports directly with a relative import, and changed Python source files that no Python test file the change adds or modifies imports, while keeping or raising its assertion count (`warn` in every mode, never an error; not in mode `off`, without a diff, or when the touched test files were not read). The text names the count checked, the count not exercised and up to 10 paths; `testIntegrity.exercise` lists up to 200 |
| `TEST_INTEGRITY_ACCEPTED`       | A reviewer who is not the PR author applied the [accept label](action.md#accept-label), so every block signal, and every per-file `TEST_INTEGRITY_INDEX_UNAVAILABLE` and `TEST_INTEGRITY_TEXT_TRUNCATED` error, was downgraded to `warn` (`info`; Action only). `testIntegrity.accepted` names the label and the reviewer |
| `TEST_INTEGRITY_ACCEPT_IGNORED` | The accept label was looked at and does not count: the PR author applied it, a non-user account applied it, no labeling event was found, or the pull request or its events could not be read (`warn`; Action only). The block signals stand |
| `NO_AGENT_SETUP_FILES`          | The repo has none of the agent setup files pharn-ci looks for  |
| `AGENT_SETUP_FILE_EMPTY`        | A listed agent setup file is empty in `HEAD` (`warn`)          |
| `AGENT_SETUP_EXPECTED_MISSING`  | An expected agent tool has no setup file (`warn`; `error` when agent setup is required) |
| `SETUP_STALE_SI01` | An agent instruction file names a script the root `package.json` or a target the root `Makefile` does not define, and the change touches that file or removes the script or target (`warn`). The text names up to 5 path and line locations and the count; each finding is in `setupHealth.stale` |
| `SETUP_STALE_SI02` | An agent instruction file names a path, in an inline code span, that is not in the repository, and the change touches that file or removes the path (`warn`) |
| `SETUP_STALE_SI03` | An agent instruction file links to or `@`-imports a file that is not in the repository, and the change touches that file or removes the file (`warn`) |
| `SETUP_STALE_SI04` | An agent instruction file last changed more than 90 days before HEAD's commit names a file this change edits (`info`) |
| `AGENT_CONFIG_SECRET_S01`       | A GitHub token is committed in an agent config file (`error`); the text names the id and up to 5 path and line locations, never the value |
| `AGENT_CONFIG_SECRET_S02`       | An Anthropic API key is committed in an agent config file (`error`) |
| `AGENT_CONFIG_SECRET_S03`       | An OpenAI API key is committed in an agent config file (`error`) |
| `AGENT_CONFIG_SECRET_S04`       | A Google API key is committed in an agent config file (`error`) |
| `AGENT_CONFIG_SECRET_S05`       | An AWS access key ID is committed in an agent config file (`error`) |
| `AGENT_CONFIG_SECRET_S06`       | A Slack token is committed in an agent config file (`error`) |
| `AGENT_CONFIG_SECRET_S07`       | A Stripe live key is committed in an agent config file (`error`) |
| `AGENT_CONFIG_SECRET_S08`       | A private key is committed in an agent config file (`error`) |
| `AGENT_CONFIG_SECRET_S09`       | A password or token is committed in a URL in an agent config file (`error`) |
| `AGENT_CONFIG_SECRET_S10`       | A secret-like value sits under a secret-named key in an agent config file (`warn`) |
| `AGENT_CONFIG_SECRET_S11`       | A literal value sits under a secret-named key in a file that loads its other secrets from the environment (`info`) |
| `AGENT_CONFIG_SECRET_UNSCANNED` | Agent config files were not scanned for secrets: the sources were unavailable (`warn`), or a file was dropped as too large, over a cap or at an unsafe path (`error`), or as binary or missing (`warn`). The text names the files with a reason code each |
| `POLICY_UNAVAILABLE`            | The [org policy](policy.md) could not be fetched or used, so the check ran with the workflow inputs and `.pharn/ci.yml` (`warn`; `error` with `policy: required`, which fails the check). The text names the reason, the HTTP status when there is one and the request id the app sent |
| `POLICY_OVERRIDE_IGNORED`       | Settings looser than the org policy, or not allowed from a policy file, were not applied; the policy's value applies (`warn`). The text names each setting and its layer (up to 20, then a count), with both numbers for a coverage threshold and never a pattern, root or label |
| `UPLOAD_TOO_LARGE`              | The run was not [uploaded to pharn.dev](upload.md) because its report is larger than the upload limit (`warn`; the check ran in full). The text names the limit in bytes when the app gave one |
| `POLICY_P08` | Tracked files match a forbidden file pattern of the [org policy](policy.md) (`error`, or the level the policy sets for P08). The text names up to 20 paths and the count |
| `POLICY_P09` | The change edits a file the org policy guards: the policy file, the config or a workflow while it sets a value looser than the policy, or an agent settings or MCP file (`error` when the file fails P02 to P06 or could not be checked, `warn` when it only warns or supplies a required deny rule or hook or when the files were not read, `info` when it complies). The text names up to 20 paths; each reason is in `policy.violations` |
| `POLICY_P11` | An agent pull request changes a path that the org policy's `agents.protected_paths` lists, or could not be checked because the diff, or the policy file at the merge base, could not be read (`error`; `warn` when the policy sets the mode or the rule to `warn`). The text names up to 20 paths and the evidence as fixed words, never a pattern, label or login |
| `POLICY_P07` | Agent instruction files in the same directory name different package managers or JavaScript test runners, or some of them could not be compared (`warn` by default; `error` when the policy sets `setup.consistency` or the rule to `block`; `info` when it sets `info` or the files could not be read). The text names up to 20 files; each violation has a path, a line and the tools as fixed words, never the file's text |
| `POLICY_P13` | An agent pull request widens what an agent may do in an agent settings file, an MCP config, a workflow or CODEOWNERS, changes one that could not be read or parsed at the merge base and at HEAD, or could not be checked because the diff is unavailable (`error`, or the level an app policy sets for P13). The text names up to 20 paths and the evidence as fixed words; each violation names the kinds of widening as fixed words, never a rule, server, secret, owner or command |
| `AGENT_PR_DETECTION_INCOMPLETE` | The pull request counts as an agent PR because its evidence could not be read in full, and the org policy protects paths (`warn`). The text names the reason as one fixed word |
| `POLICY_P02` | The committed agent settings break org policy rule P02: an allow rule overlaps a forbidden permission, `defaultMode` is `bypassPermissions` or `auto`, or `additionalDirectories` is set (`error`; `warn` for `additionalDirectories`, or the level the policy sets). The text names up to 20 locations as path and line, and the count |
| `POLICY_P03` | A settings directory lacks a deny rule the org policy requires (`error`, or the level the policy sets for P03). The text names up to 20 locations and the count |
| `POLICY_P04` | An MCP server is not on the org policy's allowlist, or `enableAllProjectMcpServers` is set (`error`, or the level the policy sets for P04). The text names up to 20 locations and the count |
| `POLICY_P05` | An MCP server matches an entry the org policy forbids, by name, command or URL (`error`, or the level the policy sets for P05). The text names up to 20 locations and the count |
| `POLICY_P06` | A settings directory lacks a command hook the org policy requires, or `disableAllHooks` is set (`error`, or the level the policy sets for P06). The text names up to 20 locations and the count |
| `POLICY_SETTINGS_INVALID` | P02 to P06 could not fully use an agent settings or MCP file, or did not run: the files were not read, a file was dropped, unparseable or has an entry the grammar does not know (`warn`; `error` for a file pharn-ci could not read, a problem a required list depends on, or settings not read at all under a required app policy or a policy that sets `forbidden_permissions`, `required_permissions_deny`, `allowed_mcp_servers`, `forbidden_mcp_servers` or `required_hooks` with its rule at block). The text names up to 20 problems as path, line and reason, never file text |
| `POLICY_P14` | An agent pull request changes more files or lines than the org policy's `agents.max_files` or `agents.max_changed_lines` allow, not counting lockfiles, snapshots, `*.generated.*` files and `coverage.exclude` paths, or could not be checked because the diff, or the policy file at the merge base, could not be read (`error`, or the level the policy sets for P14). The text names the counts, the caps, up to 10 top-level directories and the evidence as fixed words, never file text |
| `INJECTION_PI01` | An added line carries an invisible or bidirectional Unicode character ([Prompt-injection scan](checks/prompt-injection.md)) (`error`, which fails the check; or the level an app policy sets). The text names up to 5 paths and lines; each signal names the character and its code point, never file text |
| `INJECTION_PI02` | An HTML comment, reference definition or link title added to a Markdown or agent instruction file holds a phrase that addresses an agent (`warn`, or the level the policy sets). Each signal names the phrase id and the kind of hidden text |
| `INJECTION_PI03` | An added line holds a known prompt-injection phrase, or one of the org policy's `injection.phrases` (`warn`, or the level the policy sets). Each signal names the phrase id |
| `INJECTION_PI04` | A line added to an agent instruction file holds a base64 or hex run of more than 200 characters (`warn`, or the level the policy sets). Each signal names the run's kind and length |
| `INJECTION_PI05` | An agent instruction file is added inside a vendored directory (`warn`, or the level the policy sets). Each signal names the file's kind and the directory |
| `INJECTION_TEXT_TRUNCATED` | A file had more added text than the scan reads (50,000 lines, or past its budget of 8,000,000 characters across the diff: one budget for agent instruction and Markdown files, one for all other files), so a finding past the cut is not seen (`error` when an instruction or Markdown file was cut, `warn` otherwise). The text names up to 5 files and which budget they count against |
| `DEPENDENCY_D01` | An added npm or PyPI package the Action looked up does not exist in the registry ([Dependency safety](checks/dependencies.md)) (`error`). One message per code; the text names counts, thresholds and up to 10 `path:line` locations, never a package name or file text, and the findings are in `dependencies.signals` |
| `DEPENDENCY_D02` | An added package was first published fewer than `dependencies.min_age_days` days before the head commit (`warn`) |
| `DEPENDENCY_D03` | An added unscoped npm package was downloaded fewer than `dependencies.min_weekly_downloads` times last week (`warn`) |
| `DEPENDENCY_D04` | Lockfile drift: a manifest's dependencies changed and the lockfile that governs it did not change or does not record them, or a lockfile gives the same version a different integrity hash (`error`) |
| `DEPENDENCY_D05` | An added or changed dependency (a `package.json` override included) or lockfile entry comes from a git repository, a URL outside the allowed registries or a local file, or a requirements file or `pyproject.toml` adds a package index outside them (`error`) |
| `DEPENDENCY_LOOKUP_UNAVAILABLE` | Registry lookups did not complete for some added packages (no usable answer, or over the limit of 50 lookups per run), so D01 to D03 were not checked for them (`warn`) |
| `DEPENDENCY_CHECK_INCOMPLETE` | A manifest or lockfile the change touches could not be read or parsed, so dependency safety did not check it; the files are in `dependencies.unread` (`warn`) |
| `FLAKY_QUARANTINED_FAILURES` | Failed tests of the JUnit results are on the org's quarantine list ([Flaky tests and JUnit results](checks/flaky-tests.md)) (`info`). The text gives the counts, never a test name; the ids are in `flaky.quarantined` |
| `JUNIT_INVALID` | A JUnit XML file was refused whole: a DOCTYPE or other `<!` declaration (`doctype`), broken nesting (`malformed`), no `testsuites` or `testsuite` root (`not-junit`) or nesting deeper than 256 (`too-deep`) (`warn`). The text names up to 10 paths with the reason |
| `JUNIT_NOT_FOUND` | JUnit paths were set and no file matched them (`warn`) |
| `JUNIT_TOO_LARGE` | The JUnit results went over the limits of one run (50 files, 25 MiB, 20,000 test cases) or the file search stopped at its limit; what is over is left out (`warn`) |

The optional `flaky` object (since 0.8.0) holds `uploaded`, `testCount`, `failed`, `quarantined` (up to 200 ids),
`quarantinedFailures` and `unquarantinedFailures`; it is present when at least one JUnit file was parsed.

## Fix hints

Since 0.9.0 every message and every finding of the report (`testIntegrity.signals`, `policy.violations`,
`setupHealth.stale`, `injection.signals` and `dependencies.signals`) carries an optional `fix` object: `kind` (one of the
eight below), `hint` (one fixed English sentence, at most 200 characters) and, on a finding only, `target` (the path, or
`path:line`, the finding already names). The kind and the hint come from two fixed tables in the core, one entry per
message code and one per signal id. They are never written by a model and never look at the code, so two findings of one
id differ only in `target`.

| Kind                | What it asks                                                                         |
| ------------------- | ------------------------------------------------------------------------------------ |
| `add-test`          | Add tests that run the changed code                                                  |
| `restore-test`      | Restore a test that was deleted, removed or turned off                               |
| `restore-assertion` | Restore the assertions or expected values a test had                                 |
| `revert-config`     | Revert the change to a config, script, workflow or settings file                     |
| `remove-dependency` | Remove the dependency the change adds                                                |
| `request-review`    | A person should look at the change and confirm it; an agent cannot decide that       |
| `split-pr`          | Split the change into smaller pull requests                                          |
| `none`              | No code change fixes this; the hint says what to check (an operational message)      |

An agent may act on `fix.kind`, and should still read the `hint` and the rest of the report. The PR comment and the job
summary do not change: the human `Hint:` text in the comment stays as it was. No kind or hint lowers a gate: none says to
lower a limit, add an exclusion, turn a test off, add an exemption or edit a policy. A hint says what to change, never
that the change was made or was right; the next run's report is the only check. See
[`docs/LIMITS.md`](LIMITS.md), Fix hints.

## Agent PRs

In the Action, `meta.isAgentPr` says whether the pull request counts as an agent PR, and `meta.agentHint`,
`meta.prAuthor`, `meta.prLabels` and `meta.coAuthors` carry what it was read from. The detection is metadata only: it
reads the pull request's author, labels and commits (their authors, committers and `Co-authored-by` trailers), never a
file or the diff. Detection runs on every pull request run. On its own the flag changes no verdict, message, comment or
exit code; under an org policy, rules P11 (with `agents.protected_paths`), P13 (always) and P14 (with
`agents.max_files` or `agents.max_changed_lines`) use it (see [Org policy](policy.md)). A pull
request counts as an agent PR when any of this holds:

- its author is a bot (type `Bot`, or a login ending in `[bot]`, Dependabot included), a known agent or a login you
  listed (`author-bot`, `author-known-agent`, `author-extra-login`);
- one of its commits is authored or committed by such a login (`commit-bot`, `commit-known-agent`,
  `commit-extra-login`);
- a commit carries a `Co-authored-by` trailer of a known agent (`co-author-known-agent`, `co-author-extra-login`);
- it carries one of the default labels `agent` or `ai-generated` (`label`).

The known agents are Claude Code, Copilot, Codex, Devin, Cursor, Gemini and Jules. Evidence that cannot be read in full
counts as an agent PR (fail closed): an unknown author, commits that cannot be listed, a pull request of more than
250 commits or whose commit count does not match the list, and an edited policy file whose base cannot be read (a
`file:` policy that the pull request edits and that cannot be read at the merge base). Only trailers of known agents are
recorded, as a hint and an address; a human co-author never is. A run with no pull request records `isAgentPr: false`,
and the CLI does not set the field. The org policy's `agents.labels` and `agents.extra_logins` add to the defaults (for
a `file:` policy that the pull request edits, the lists at the merge base and at head both count). A login in
`agents.extra_logins`, like the PR author's, is a GitHub login (a letter or digit, then up to 38 letters, digits or
`-`), optionally followed by `[bot]`, or an Enterprise Managed User login `handle_shortcode` (such as `dev_acme`: one
`_` and a shortcode of 3 to 8 letters or digits, at most 39 characters, never with `[bot]`). Only the org policy
adds to the lists; `.pharn/ci.yml` and the inputs cannot change them. See
[`docs/LIMITS.md`](LIMITS.md) §9 and [`docs/THREAT-MODEL.md`](THREAT-MODEL.md) (A5).

Within v2, as within v1, fields are only added and codes are never renamed or removed.
