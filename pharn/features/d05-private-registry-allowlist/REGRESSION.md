# REGRESSION — d05-private-registry-allowlist

base: `1304e8f6c8c68ea12e7ceb9fe12d953264af409a` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: REUSED — the run marker, the reuse record, the stamp and its logs agree with this invocation's BASE requirement (sha256 `ff9670bcb119c63a4c9d379bb035bbbf0d4b8d323dbc5a263b6eb4d4ee830bdd`; that an earlier /pharn-regress of this run produced them is advisory), so this invocation created no base worktree, ran no install and ran no base gate; `gate_run.base.stamp_sha256` in regression-report.json names the stamp.

install: none run by this invocation (the BASE evidence was reused).

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (60):

```text
CHANGELOG.md
README.md
action.yml
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/action/src/run.ts
packages/cli/src/main.ts
packages/core/src/config.ts
packages/core/src/dependencies/check.ts
packages/core/src/dependencies/npmManifest.ts
packages/core/src/dependencies/pythonManifest.ts
packages/core/src/dependencies/settings.ts
packages/core/src/dependencies/types.ts
packages/core/src/inputs.ts
packages/core/src/policy/apply.ts
packages/core/src/policy/errors.ts
packages/core/src/policy/grammar.ts
packages/core/src/policy/limits.ts
packages/core/src/policy/types.ts
packages/core/src/policy/validate.ts
packages/core/src/render/markdown.ts
packages/core/test/ac-ti081516-docs.test.ts
packages/core/test/dependencies-render.test.ts
packages/core/test/dependencies-settings.test.ts
packages/core/test/policy-schema.test.ts
pharn.config.json
schema/policy.v1.json
fixtures/dependencies/d05-private-host/base/package-lock.json.txt
fixtures/dependencies/d05-private-host/base/package.json.txt
fixtures/dependencies/d05-private-host/base/requirements.txt.fixture
fixtures/dependencies/d05-private-host/change.diff
fixtures/dependencies/d05-private-host/files.txt
fixtures/dependencies/d05-private-host/head/package-lock.json.txt
fixtures/dependencies/d05-private-host/head/package.json.txt
fixtures/dependencies/d05-private-host/head/requirements.txt.fixture
packages/action/test/ac-d05-allow-adapters.test.ts
packages/cli/test/ac-d05-allow-input.test.ts
packages/core/src/dependencies/hosts.ts
packages/core/test/ac-d05-allow-advice.test.ts
packages/core/test/ac-d05-allow-app-policy.test.ts
packages/core/test/ac-d05-allow-app-replaces.test.ts
packages/core/test/ac-d05-allow-app-subset.test.ts
packages/core/test/ac-d05-allow-config.test.ts
packages/core/test/ac-d05-allow-default.test.ts
packages/core/test/ac-d05-allow-docs.test.ts
packages/core/test/ac-d05-allow-file-policy.test.ts
packages/core/test/ac-d05-allow-lookups.test.ts
packages/core/test/ac-d05-allow-manifests.test.ts
packages/core/test/ac-d05-allow-policy-schema.test.ts
packages/core/test/ac-d05-allow-url-rules.test.ts
packages/core/test/dependencies-allowed-hosts.test.ts
pharn/features/d05-private-registry-allowlist/AC-TESTS.lock.json
pharn/features/d05-private-registry-allowlist/AC-TESTS.md
pharn/features/d05-private-registry-allowlist/BUILD.md
pharn/features/d05-private-registry-allowlist/GRILL.md
pharn/features/d05-private-registry-allowlist/PLAN.md
pharn/features/d05-private-registry-allowlist/SPEC.md
pharn/features/d05-private-registry-allowlist/VERIFY.md
pharn/features/d05-private-registry-allowlist/verify-report.json
```

declared (51):

```text
packages/core/src/dependencies/hosts.ts
packages/core/src/dependencies/settings.ts
packages/core/src/dependencies/types.ts
packages/core/src/dependencies/npmManifest.ts
packages/core/src/dependencies/pythonManifest.ts
packages/core/src/dependencies/check.ts
packages/core/src/inputs.ts
packages/core/src/config.ts
packages/core/src/policy/limits.ts
packages/core/src/policy/grammar.ts
packages/core/src/policy/errors.ts
packages/core/src/policy/validate.ts
packages/core/src/policy/types.ts
packages/core/src/policy/apply.ts
packages/core/src/render/markdown.ts
packages/cli/src/main.ts
packages/action/src/run.ts
action.yml
schema/policy.v1.json
packages/action/dist/index.js
README.md
docs/LIMITS.md
docs/THREAT-MODEL.md
CHANGELOG.md
fixtures/dependencies/d05-private-host/change.diff
fixtures/dependencies/d05-private-host/files.txt
fixtures/dependencies/d05-private-host/base/package.json.txt
fixtures/dependencies/d05-private-host/base/package-lock.json.txt
fixtures/dependencies/d05-private-host/base/requirements.txt.fixture
fixtures/dependencies/d05-private-host/head/package.json.txt
fixtures/dependencies/d05-private-host/head/package-lock.json.txt
fixtures/dependencies/d05-private-host/head/requirements.txt.fixture
packages/core/test/dependencies-allowed-hosts.test.ts
packages/core/test/dependencies-settings.test.ts
packages/core/test/policy-schema.test.ts
packages/core/test/dependencies-render.test.ts
packages/core/test/ac-ti081516-docs.test.ts
packages/action/test/ac-d05-allow-adapters.test.ts
packages/core/test/ac-d05-allow-default.test.ts
packages/core/test/ac-d05-allow-url-rules.test.ts
packages/core/test/ac-d05-allow-manifests.test.ts
packages/cli/test/ac-d05-allow-input.test.ts
packages/core/test/ac-d05-allow-config.test.ts
packages/core/test/ac-d05-allow-app-policy.test.ts
packages/core/test/ac-d05-allow-app-replaces.test.ts
packages/core/test/ac-d05-allow-app-subset.test.ts
packages/core/test/ac-d05-allow-file-policy.test.ts
packages/core/test/ac-d05-allow-lookups.test.ts
packages/core/test/ac-d05-allow-advice.test.ts
packages/core/test/ac-d05-allow-policy-schema.test.ts
packages/core/test/ac-d05-allow-docs.test.ts
```

escape-exempt (8) — this feature's own pipeline artifacts or a hook-protected trusted doc, never a build escape:

```text
pharn/features/d05-private-registry-allowlist/AC-TESTS.lock.json
pharn/features/d05-private-registry-allowlist/AC-TESTS.md
pharn/features/d05-private-registry-allowlist/BUILD.md
pharn/features/d05-private-registry-allowlist/GRILL.md
pharn/features/d05-private-registry-allowlist/PLAN.md
pharn/features/d05-private-registry-allowlist/SPEC.md
pharn/features/d05-private-registry-allowlist/VERIFY.md
pharn/features/d05-private-registry-allowlist/verify-report.json
```

already changed when this run began (1) — the run's pre-run snapshot recorded these with exactly the bytes they hold now, so they are reported, NOT counted as this build's escape (a re-run records an earlier run's escape the same way; pre-run-snapshot-core.mjs states the bounds):

```text
pharn.config.json
```

## Gates

gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): build
gate: base exit 1 -> head exit 1 — pre-existing (already red at base) — id (quoted, untrusted): test

style gates were SKIPPED (config-touch rule: no shared style config changed in scope).

## Pre-existing and regressions

pre_existing (1): test
regressions (0): (none)

_/pharn-regress catches exactly what the project's own deterministic suite catches, nothing more — but deterministically. This is not a claim that nothing broke._
