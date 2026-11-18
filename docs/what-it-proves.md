# What it proves, and what it does not

**Measured:** which added lines the coverage report marks as executed, compared exactly against an
inclusive threshold (79.995% fails at 80); which known agent setup files are tracked in git.

**Not measured**, stated plainly (full list in [`docs/LIMITS.md`](LIMITS.md)):

- **Coverage is not test quality.** A covered line was executed; nothing says a test asserted
  anything about it.
- **Only added lines count.** A change that deletes the tests for code it leaves in place does not
  lower diff coverage.
- **Files missing from the coverage report are invisible.** Configure your coverage tool to include
  all source files if untested files should count.
- **The inventory is not a review.** pharn-ci lists agent setup files (the inventory reads none of them); check A7 reads only the
  machine-readable kinds, for committed secrets (never the Markdown kinds), and policy mode reads the agent settings and
  MCP files for the org policy rules; no file is reviewed for
  what it tells an agent. Under an org policy, P07 reads the inline code and shell blocks of the instruction files for
  package manager and test runner commands and nothing else of them. On every run with a diff, the
  [stale-instruction check](checks/stale-instructions.md) reads their inline code, shell blocks, link targets and `@`
  imports for commands and paths, and nothing else of them. Their contents stay in the job: never printed, never
  written, never sent, except the paths, line numbers and the commands or paths the stale-instruction findings name.
  The inventory is
  informational (`NO_AGENT_SETUP_FILES` is `info`) unless `require-agent-setup` or `setup.require`
  is on, which makes it an `error` and the verdict `fail`. An expected tool counts as present when
  any setup kind it reads exists (`AGENTS.md` covers several tools).
- **The setup requirement and expectations come from the repository's config.** A PR that edits `.pharn/ci.yml` is
  checked with its copy at the merge base, so it cannot switch `setup.require` off or drop tools from `setup.expect` for
  itself; the edit applies after merge, so protect the file with CODEOWNERS. The `require-agent-setup: true` and
  `expect-agent-setup` inputs in the workflow are the stronger settings: the config cannot turn the one off or drop
  tools from the other.
- **pharn-ci trusts the coverage file.** The PR's own tests write it in the same job; a PR that
  alters its test setup can produce a favorable one.
- **Exclusions come from the workflow and the merge base's config.** A PR's edit to `coverage.exclude` applies after
  merge, but the `exclude` input lives in the workflow file the PR can edit ([Excluding files](config.md#excluding-files)).
- **P11 guards paths, not authors.** It sees only agent PRs that identify themselves (by author, commits, trailers or
  labels) and matches paths, not content: an agent PR that does not identify itself is judged as a person's.
- **P13 compares structure, not behaviour.** It sees only agent PRs that identify themselves, and only the four kinds
  of file it names: a power widened through a script a hook calls, untracked or user-level settings, or a reusable
  workflow in another repository is outside it ([`docs/LIMITS.md`](LIMITS.md)).
- **P14 caps one pull request, not the work.** It counts diff lines, not how hard a change is to review, and an agent
  can split one change across many pull requests; like P11, it sees only agent PRs that identify themselves.
- **The prompt-injection scan reads text, not meaning.** It finds hidden characters, known phrases, hidden Markdown,
  blobs and vendored instruction files in the lines a change adds; a reworded instruction, one split across lines, one
  in an image or an encoding it does not decode, or one already in the repository passes it
  ([`docs/LIMITS.md`](LIMITS.md#prompt-injection-scan)).

## Policy mode: agent instruction files

Under an org policy with P07 in effect (`policy: auto`, `required` or `file:<path>`, and the CLI's `--policy-file`),
pharn-ci reads the committed text of the agent instruction files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules`,
`.claude/rules`, `.github/copilot-instructions.md` and the other instruction kinds of the inventory) in directories that
hold at least two of them. It reads them at `HEAD` (`git cat-file`), never the working tree and never a file a symlink
points to, with the same caps as A7: 200 files, 512 KiB each, 16 MiB in all. P07 reads nothing without such a policy
(the [stale-instruction check](checks/stale-instructions.md) reads the same files, in a read of its own, for commands and
paths).

P07 takes only the package managers (`npm`, `pnpm`, `yarn`, `bun`) and the test runners (`vitest`, `jest`) that a file names in an
inline code span or a shell block, and reports when two files of one directory name different ones. Nothing it reads is
uploaded or printed: the report holds the rule id, the path, the line number and the tools as fixed words. P07 is a
heuristic at `warn`: prose is never read, and what it misses is in [`docs/LIMITS.md`](LIMITS.md). The Action reads
the files only when the diff came from the local checkout.
