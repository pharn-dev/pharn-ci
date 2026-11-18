# Stale agent instructions

Agents follow their instruction files literally, so an instruction that names a script, path or file the repository no
longer has produces a confidently wrong PR. pharn-ci checks the agent instruction files the inventory finds (the
instruction kinds: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules`, `.claude/rules`,
`.github/copilot-instructions.md`, `CONVENTIONS.md` and the others in [the table](../how-it-works.md#what-pharn-ci-is); at most 50 files):

- **SI01** (`warn`): a command in an inline code span or a shell block whose script is not in the root `package.json`
  (`npm run x`, `pnpm x`, `pnpm run x`, `yarn x`, `yarn run x`, `bun run x`) or whose target is not in the root
  `Makefile` (`make x`). pnpm's and yarn's own commands (`install`, `test`, `add`, `exec`, `dlx`, ...) and the binaries
  of the dependencies (`pnpm vitest`) are not scripts. Only the instruction files that apply to the whole repository
  are compared, and only when the root manifest exists and can be read.
- **SI02** (`warn`): a path in an inline code span (a token with a `/` or a known file extension) that is not a tracked
  file or directory, from the root or from the file's directory, or as the end of a tracked path (`src/check.ts`
  matches `packages/core/src/check.ts`).
- **SI03** (`warn`): a file the instructions tell the agent to read that is not tracked: a relative Markdown link
  `[text](path)` and a Claude-style `@path` import.
- **SI04** (`info`): an instruction file whose last commit is more than 90 days older than HEAD's commit, while the
  change edits a file it names. It needs the history (`fetch-depth: 0`); on a shallow checkout every file looks new.

**Diff-aware.** A finding is reported only when the change touches the instruction file itself, or deletes or renames
the path or file an instruction names, or removes the `package.json` script or `Makefile` target it names. Otherwise
the section stays empty, so the same repo-wide notes do not repeat on every pull request. Without a diff nothing is
checked. The findings are in the report's `setupHealth.stale` (the instruction file, the line, the kind, the signal id
and the command or path when it is made of repo-path characters only), one `SETUP_STALE_<ID>` message per signal names
up to 5 locations, and the comment lists them under **📄 Instructions**. A `warn` never fails the check.

**What is read.** This is a read of the Markdown instruction files: their committed text at `HEAD` (`git cat-file`,
never the working tree, never a file a symlink points to; 50 files, 256 KiB each), the root `package.json` and
`Makefile` at `HEAD` (and at the merge base when the change edits them), and, for SI04, `git log -1 --format=%ct` of
at most 20 instruction files. Only inline code spans, shell-fenced blocks, link targets and `@` imports are read;
prose, other fenced blocks (examples), indented code, HTML comments, frontmatter and lines or sections with words
such as `not`, `never`, `deprecated`, `removed` or `example` are not. URLs, globs, `<placeholders>`, `$VARS`, `~/`
and absolute paths, `node_modules` and build output, flags, versions, scoped package names and `.env` or `.local`
files are never read as paths. Nothing read leaves the job except the paths, line numbers and the command or path the
report names. The Action reads the files only when the diff came from the local checkout. What the check misses is in
[docs/LIMITS.md](../LIMITS.md#stale-agent-instructions).
