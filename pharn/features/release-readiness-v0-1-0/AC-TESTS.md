---
spec_id: release-readiness-v0-1-0
spec_content_hash: 9fbea1c93031b67305156a9e286f8964e9fcfb216feb07a72109c3d47ebd076e
---

## Files

- `packages/core/test/ac-release-version.test.ts` — the test for AC-1
- `packages/core/test/ac-release-changelog.test.ts` — the tests for AC-2 and AC-3
- `packages/core/test/ac-release-docs.test.ts` — the tests for AC-4, AC-5 and AC-6

## Mapping

- AC-1 | unit | `packages/core/test/ac-release-version.test.ts` | packages/core/src/version.ts#VERSION: string, compared with the `version` field of package.json, packages/core/package.json, packages/cli/package.json and packages/action/package.json (read with node:fs + JSON.parse); the root file must have the field
- AC-2 | unit | `packages/core/test/ac-release-changelog.test.ts` | CHANGELOG.md lines, with V = packages/action/package.json#version: exactly one line starting `## [V]`, matching `## [V] - YYYY-MM-DD` or `## [V] - \d{4}-\d{2}-\d{2}`, and the first line starting `## [` is `## [Unreleased]`, before it; also asserts .github/workflows/release.yml still contains its `grep -q "^## \[${VERSION//./\\.}\]" CHANGELOG.md` check
- AC-3 | unit | `packages/core/test/ac-release-changelog.test.ts` | release.yml's `Extract release notes` program run as execFileSync("awk", ["-v", "h=## [V]", "index($0, h) == 1 { f = 1; next } /^## \\[/ { if (f) exit } f", "CHANGELOG.md"]) (asserting release.yml contains that program verbatim); the output has non-whitespace, names Cobertura, `coverage-format`, `--coverage-format`, `coverage.format`, `auto`, `diffCoverage.format`, `agentSetup.summary`, `coverage.exclude`, `--exclude`, "`exclude` input", `diffCoverage.excludedFiles`, every code after "Known codes:" and every kind after "Known kinds:" in schema/report.v1.json, and none of `lcov only`, `lcov-only`, `the lcov report`
- AC-4 | unit | `packages/core/test/ac-release-docs.test.ts` | docs/MARKETPLACE.md sections `## Name`, `## One-line description` (first non-blank line each), `## Description` (exactly three blank-line-separated paragraphs) and `## Categories` (`- Primary: <c>` and `- Secondary: <c>`), compared with action.yml's top-level `name:` and `description:` lines; one-line description at most 125 characters; categories distinct, each in {Code quality, Code review, Continuous integration, Security, Testing, Utilities}
- AC-5 | unit | `packages/core/test/ac-release-docs.test.ts` | docs/MARKETPLACE.md `## Quick start` first ```yaml block: the step line `- uses: pharn-dev/pharn-ci@v${VERSION}` (VERSION from packages/core/src/version.ts), at least one key in its more-indented `with:` block, and every such key among the input names declared under action.yml `inputs:` (two-space-indented `<name>:` lines before `outputs:`)
- AC-6 | unit | `packages/core/test/ac-release-docs.test.ts` | docs/RELEASING.md, whitespace-normalized: the `## Cutting a release` list item beginning `Set \`"version": "X.Y.Z"\`` names "root `package.json`", `packages/core/package.json`, `packages/cli/package.json`, `packages/action/package.json` and `packages/core/src/version.ts`; and one sentence contains "replaces the `YYYY-MM-DD` placeholder", "release date" and "before running the release workflow"
