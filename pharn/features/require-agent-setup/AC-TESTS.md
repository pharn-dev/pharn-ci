---
spec_id: require-agent-setup
spec_content_hash: c5ece5f9ec754e6ab4d11f027ec1cd570a062620bc4f680d092b2c7e16926dee
---

## Files

- `packages/core/test/ac-require-setup-check.test.ts` — the tests for AC-1
- `packages/core/test/ac-require-setup-config.test.ts` — the tests for AC-2
- `packages/cli/test/ac-require-agent-setup.test.ts` — the tests for AC-3

## Mapping

- AC-1 | unit | `packages/core/test/ac-require-setup-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — CheckInput.requireAgentSetup?: boolean; repoFiles from fixtures/require-agent-setup/files.txt (no setup files) and fixtures/golden/files.txt (setup files), coverage and diff from fixtures/golden/, threshold null; reports checked with expectValidReport
- AC-2 | unit | `packages/core/test/ac-require-setup-config.test.ts` | packages/core/src/config.ts#parseConfig(text: string): PharnConfig — setup.require true or false (fixtures/require-agent-setup/ci-require-true.yml, ci-require-false.yml) returned as config.setup.require; a string or number value throws ConfigError naming setup.require
- AC-3 | integration | `packages/cli/test/ac-require-agent-setup.test.ts` | packages/cli/src/main.ts#main(argv: string[], deps: CliDeps): Promise<number> — `check --coverage <file> --format json [--require-agent-setup]` with .pharn/ci.yml from fixtures/require-agent-setup/, report on deps.stdout, exit 0 or 1; and packages/action/src/run.ts#run(deps: ActionDeps): Promise<Report | undefined> — input require-agent-setup "", "true", "false" or a non-boolean, report.json at the report-path output, deps.setFailed naming require-agent-setup
