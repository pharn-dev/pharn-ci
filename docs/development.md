# Development

```bash
pnpm install          # install
pnpm build            # typecheck + build core, bundle cli and action
pnpm test             # vitest (all packages)
pnpm test:coverage    # vitest with lcov output in coverage/
pnpm lint             # biome check + typecheck
pnpm format           # biome autofix
pnpm pharn-ci check   # run the built CLI on this repo
```

| Package            | Role                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| `packages/core`    | Pure functions: lcov, Cobertura, JUnit and diff parsing, diff coverage, setup scan, test-integrity signals, secret, prompt-injection and dependency checks, org policy rules, Report v2. The test-integrity signals are listed once, in `src/signals/registry.ts`: a new signal adds one entry there. |
| `packages/cli`     | `pharn-ci check` and `pharn-ci test`: reads files, runs git and `python3`, calls core, prints output. |
| `packages/action`  | Thin Action wrapper: inputs, PR diff, sticky comment, job summary, exit code.          |
| `packages/node-io` | Private Node I/O shared by cli and action: git, file reads, directory listing, coverage-file reading, the `python3` subprocess that indexes Python test files, and the command `pharn-ci test` wraps. `gatherSources()` decides once what the checks read from git: the test, config, manifest and agent files at the merge base and `HEAD`. Bundled into their dists. |

The rules every change follows are in [`AGENTS.md`](../AGENTS.md).
