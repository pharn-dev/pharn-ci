# REGRESSION — coverage-auto-discovery-2

base: `dd2a03b41299c2cdb4da03bc790da6c96e526804` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `other-run`; entry evidence not used: `start-dirty`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (77):

```text
CHANGELOG.md
README.md
action.yml
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/action/src/run.ts
packages/action/test/run.test.ts
packages/cli/src/main.ts
packages/cli/test/main.test.ts
packages/core/src/check.ts
packages/core/src/index.ts
packages/core/src/inputs.ts
packages/core/src/report.ts
packages/node-io/src/coverage.ts
packages/node-io/src/index.ts
.agents/skills/source-command-pharn-build/SKILL.md
.agents/skills/source-command-pharn-grill/SKILL.md
.agents/skills/source-command-pharn-loop-close/SKILL.md
.agents/skills/source-command-pharn-loop-quick/SKILL.md
.agents/skills/source-command-pharn-loop/SKILL.md
.agents/skills/source-command-pharn-memory-promote/SKILL.md
.agents/skills/source-command-pharn-plan/SKILL.md
.agents/skills/source-command-pharn-regress/SKILL.md
.agents/skills/source-command-pharn-review/SKILL.md
.agents/skills/source-command-pharn-ship-close/SKILL.md
.agents/skills/source-command-pharn-ship-quick/SKILL.md
.agents/skills/source-command-pharn-ship/SKILL.md
.agents/skills/source-command-pharn-spec/SKILL.md
.agents/skills/source-command-pharn-test/SKILL.md
.agents/skills/source-command-pharn-verify/SKILL.md
.codex/hooks.json
.codex/hooks/enforce-writes-scope.cjs
.codex/hooks/protect-trusted-paths.cjs
.codex/hooks/require-loop-record.cjs
.codex/hooks/set-writes-scope.cjs
examples/workflows/cargo.yml
examples/workflows/dotnet.yml
examples/workflows/jest.yml
examples/workflows/pytest.yml
examples/workflows/vitest.yml
fixtures/coverage-discovery/cobertura-coverage/coverage/cobertura-coverage.xml
fixtures/coverage-discovery/cobertura-coverage/src/a.ts
fixtures/coverage-discovery/coverage-lcov/coverage/lcov.info
fixtures/coverage-discovery/coverage-lcov/src/a.ts
fixtures/coverage-discovery/coverage-xml/coverage.xml
fixtures/coverage-discovery/coverage-xml/src/a.ts
fixtures/coverage-discovery/dotnet-many/src/a.ts
fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/a1/coverage.cobertura.xml
fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/b2/coverage.cobertura.xml
fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/c3/coverage.cobertura.xml
fixtures/coverage-discovery/dotnet-one/src/a.ts
fixtures/coverage-discovery/dotnet-one/tests/App.Tests/TestResults/abc/coverage.cobertura.xml
fixtures/coverage-discovery/lcov-root/lcov.info
fixtures/coverage-discovery/lcov-root/src/a.ts
fixtures/coverage-discovery/none/src/a.ts
fixtures/coverage-discovery/two-kinds/coverage/lcov.info
fixtures/coverage-discovery/two-kinds/lcov.info
fixtures/coverage-discovery/two-kinds/src/a.ts
packages/action/test/ac-discovery-action-ambiguous.test.ts
packages/action/test/ac-discovery-action-found.test.ts
packages/action/test/ac-discovery-action-none.test.ts
packages/cli/test/ac-discovery-cli-ambiguous.test.ts
packages/cli/test/ac-discovery-cli-explicit.test.ts
packages/cli/test/ac-discovery-cli-found.test.ts
packages/cli/test/ac-discovery-cli-none.test.ts
packages/core/src/coverageDiscovery.ts
packages/core/test/ac-discovery-check-missing.test.ts
packages/core/test/ac-discovery-choose-ambiguous.test.ts
packages/core/test/ac-discovery-choose-dotnet.test.ts
packages/core/test/ac-discovery-choose-none.test.ts
packages/core/test/ac-discovery-choose-single.test.ts
packages/core/test/ac-discovery-docs.test.ts
packages/core/test/ac-discovery-examples-runs.test.ts
packages/core/test/ac-discovery-examples-shape.test.ts
packages/node-io/src/discovery.ts
packages/node-io/test/ac-discovery-fixtures.test.ts
packages/node-io/test/ac-discovery-walk-rules.test.ts
```

declared (57):

```text
packages/core/src/coverageDiscovery.ts
packages/core/src/index.ts
packages/core/src/inputs.ts
packages/core/src/check.ts
packages/core/src/report.ts
packages/node-io/src/coverage.ts
packages/node-io/src/discovery.ts
packages/node-io/src/index.ts
packages/cli/src/main.ts
packages/action/src/run.ts
packages/action/dist/index.js
packages/cli/test/main.test.ts
packages/action/test/run.test.ts
fixtures/coverage-discovery/coverage-lcov/coverage/lcov.info
fixtures/coverage-discovery/coverage-lcov/src/a.ts
fixtures/coverage-discovery/lcov-root/lcov.info
fixtures/coverage-discovery/lcov-root/src/a.ts
fixtures/coverage-discovery/coverage-xml/coverage.xml
fixtures/coverage-discovery/coverage-xml/src/a.ts
fixtures/coverage-discovery/cobertura-coverage/coverage/cobertura-coverage.xml
fixtures/coverage-discovery/cobertura-coverage/src/a.ts
fixtures/coverage-discovery/dotnet-one/tests/App.Tests/TestResults/abc/coverage.cobertura.xml
fixtures/coverage-discovery/dotnet-one/src/a.ts
fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/a1/coverage.cobertura.xml
fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/b2/coverage.cobertura.xml
fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/c3/coverage.cobertura.xml
fixtures/coverage-discovery/dotnet-many/src/a.ts
fixtures/coverage-discovery/two-kinds/coverage/lcov.info
fixtures/coverage-discovery/two-kinds/lcov.info
fixtures/coverage-discovery/two-kinds/src/a.ts
fixtures/coverage-discovery/none/src/a.ts
examples/workflows/vitest.yml
examples/workflows/jest.yml
examples/workflows/pytest.yml
examples/workflows/dotnet.yml
examples/workflows/cargo.yml
README.md
action.yml
CHANGELOG.md
docs/THREAT-MODEL.md
packages/core/test/ac-discovery-choose-single.test.ts
packages/core/test/ac-discovery-choose-dotnet.test.ts
packages/core/test/ac-discovery-choose-ambiguous.test.ts
packages/core/test/ac-discovery-choose-none.test.ts
packages/core/test/ac-discovery-check-missing.test.ts
packages/node-io/test/ac-discovery-fixtures.test.ts
packages/node-io/test/ac-discovery-walk-rules.test.ts
packages/cli/test/ac-discovery-cli-found.test.ts
packages/cli/test/ac-discovery-cli-ambiguous.test.ts
packages/cli/test/ac-discovery-cli-none.test.ts
packages/cli/test/ac-discovery-cli-explicit.test.ts
packages/action/test/ac-discovery-action-found.test.ts
packages/action/test/ac-discovery-action-ambiguous.test.ts
packages/action/test/ac-discovery-action-none.test.ts
packages/core/test/ac-discovery-examples-shape.test.ts
packages/core/test/ac-discovery-examples-runs.test.ts
packages/core/test/ac-discovery-docs.test.ts
```

already changed when this run began (20) — the run's pre-run snapshot recorded these with exactly the bytes they hold now, so they are reported, NOT counted as this build's escape (a re-run records an earlier run's escape the same way; pre-run-snapshot-core.mjs states the bounds):

```text
.agents/skills/source-command-pharn-build/SKILL.md
.agents/skills/source-command-pharn-grill/SKILL.md
.agents/skills/source-command-pharn-loop-close/SKILL.md
.agents/skills/source-command-pharn-loop-quick/SKILL.md
.agents/skills/source-command-pharn-loop/SKILL.md
.agents/skills/source-command-pharn-memory-promote/SKILL.md
.agents/skills/source-command-pharn-plan/SKILL.md
.agents/skills/source-command-pharn-regress/SKILL.md
.agents/skills/source-command-pharn-review/SKILL.md
.agents/skills/source-command-pharn-ship-close/SKILL.md
.agents/skills/source-command-pharn-ship-quick/SKILL.md
.agents/skills/source-command-pharn-ship/SKILL.md
.agents/skills/source-command-pharn-spec/SKILL.md
.agents/skills/source-command-pharn-test/SKILL.md
.agents/skills/source-command-pharn-verify/SKILL.md
.codex/hooks.json
.codex/hooks/enforce-writes-scope.cjs
.codex/hooks/protect-trusted-paths.cjs
.codex/hooks/require-loop-record.cjs
.codex/hooks/set-writes-scope.cjs
```

## Gates

gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): build
gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): test

style gates were SKIPPED (config-touch rule: no shared style config changed in scope).

## Pre-existing and regressions

pre_existing (0): (none)
regressions (0): (none)

_/pharn-regress catches exactly what the project's own deterministic suite catches, nothing more — but deterministically. This is not a claim that nothing broke._
