# CLI

```bash
pnpm install && pnpm build
node packages/cli/dist/index.js check --coverage coverage/lcov.info --threshold 80
```

```text
pharn-ci check [--coverage <file|glob>]... [--coverage-format lcov|cobertura|auto] [--coverage-root <dir>]
               [--base <ref>] [--threshold <n>] [--format md|json] [--config <path>]
               [--exclude <glob>]... [--require-agent-setup] [--expect-agent-setup <tool>]...
               [--test-integrity block|warn|off] [--dependencies auto|lookup|never]
               [--dependency-allowed-host <host>]... [--policy-file <path>]
               [--no-policy] [--junit <file|glob>]... [--quarantine-file <path>] [-h|--help] [-v|--version]
pharn-ci test [--junit <file|glob>]... [--quarantine-file <path>] [--dry-run] -- <command> [args...]
```

- `--coverage <file|glob>` is repeatable. A glob (`*`, `**`, `?`) is relative to the current
  directory; entries in `coverage.file` are relative to the repo root. The files are merged with
  hits summed ([Coverage files and globs](config.md#coverage-files-and-globs) for the rules and limits).
  Without the flag and without `coverage.file`, the CLI auto-discovers the report from the repo
  root (the five paths in the [Quick start](quick-start.md)) and prints `coverage: <path>
  (auto-discovered)` on stderr; more than one kind found exits `2`. Workflows that rely on it are in
  [`examples/workflows/`](../examples/workflows/).
- `--coverage-root <dir>` is the directory that relative coverage paths start from, for a
  package-relative report in a monorepo (`SF:src/a.ts` with `--coverage-root packages/core` is
  `packages/core/src/a.ts`). The flag wins over `coverage.root`, which wins over none (the repo
  root). The value is repo-relative: no `..`, not absolute, not starting with `-`. Absolute
  coverage paths are never remapped ([`docs/LIMITS.md`](LIMITS.md), section 7).
- `--coverage-format` defaults to `coverage.format` from the config, then `auto`, which reads lcov
  or Cobertura XML from the start of the file. The chosen format is printed on stderr, for example
  `coverage: cobertura (auto-detected)`.
- `--base` defaults to `origin/main`; the diff is `git diff --unified=0 <base>...HEAD`.
- `--threshold <n>` defaults to `coverage.threshold` from the config. When both are set the larger applies: the config
  may raise the flag, never lower it.
- `--exclude <glob>` leaves matching changed files out of diff coverage. Repeat it for several
  patterns; they are added to `coverage.exclude`, never replacing it
  ([Excluding files](config.md#excluding-files)).
- `--require-agent-setup` fails the check (exit `1`) when the repo has no agent setup files. Absent,
  `setup.require` from the config decides, then off. The flag cannot turn off a requirement the
  config turns on.
- `--expect-agent-setup <tool>` is repeatable and adds to `setup.expect`: a tool no setup file
  configures is listed in `agentSetup.missing` and reported as `AGENT_SETUP_EXPECTED_MISSING`, a
  warning, or an error with `--require-agent-setup`. Names come from the fixed tool list
  (`claude-code`, `cursor`, `copilot`, `codex`, `gemini`, ...); an unknown one exits `2`.
- `--test-integrity <mode>` sets the test-integrity mode (`block`, `warn` or `off`; default `warn`). The
  `test_integrity.mode` config key can only make it stricter than the flag; an invalid value exits `2`.
- `--dependencies <mode>` sets [dependency safety](checks/dependencies.md) (`auto`, `lookup` or `never`; default `auto`).
  The CLI makes no network call, so it runs D04 and D05 only and `lookup` runs as `auto`; an invalid value exits `2`.
- `--dependency-allowed-host <host>` is repeatable and names a registry host your team runs, so
  [D05](checks/dependencies.md) accepts its URLs besides the four public hosts. Each value is an exact host name matched
  case-insensitively: no scheme, path, port, user name or wildcard, at most 50 in all, and a URL on it still has to be
  `https` with no user name, password or port. A value that is not a host name exits `2` before any git call. An app
  policy's list replaces it, and the CLI never fetches a policy.
- `--policy-file <path>` applies an [org policy](policy.md) document, relative to the repo root, over the flags and
  the config. It can only tighten them; a path that is empty, absolute, outside the repo, through a symbolic link,
  missing, over 1 MiB or not a valid policy exits `2`. `--no-policy` applies none and is the same as no flag; giving
  both exits `2`. The CLI never fetches a policy.
- `--junit <file|glob>` is repeatable and reads JUnit XML relative to the current directory into the report's `flaky`
  object and the Flaky section; `--quarantine-file <path>` names a JSON array of test ids treated as quarantined. A
  pattern outside the current directory, or a quarantine file that is missing, over 1 MiB or not such an array, exits
  `2`. `pharn-ci test` wraps a test command with the same two flags; see
  [Flaky tests and JUnit results](checks/flaky-tests.md).
- `--format json` prints only the report to stdout, for agents and scripts.
- Exit codes: `0` pass or warn, `1` fail, `2` usage or runtime error.

The CLI is not published to npm yet; build it from source.
