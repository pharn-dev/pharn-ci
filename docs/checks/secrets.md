# Secrets in agent configs

Check A7 reads the machine-readable agent config files the inventory finds (`.mcp.json`, `.cursor/mcp.json`,
`.vscode/mcp.json`, `.claude/settings.json`, `.claude/settings.local.json`, `.codex/config.toml`,
`.gemini/settings.json`, `opencode.json`, `.aider.conf.yml`, the files under `.claude/hooks/`, and the `.json`, `.yaml`
and `.yml` files under `.continue/rules/`) and looks for committed secrets. The Markdown kinds (instructions, rules,
skills, commands) are never read by A7 (P07 reads the instruction kinds under an org policy; see
[Policy mode: agent instruction files](../what-it-proves.md#policy-mode-agent-instruction-files); the
[stale-instruction check](stale-instructions.md) reads their code spans, links and imports). It reads the committed text at `HEAD` (`git cat-file`), never the working tree and never
a file a symlink points to, with the test-source caps: 200 files, 512 KiB each, 16 MiB in all.

Ten shapes are looked for by their prefix or position: S01 a GitHub token, S02 an Anthropic API key, S03 an OpenAI API key,
S04 a Google API key, S05 an AWS access key ID, S06 a Slack token, S07 a Stripe live key, S08 a private key, S09 a
password or token in a URL, and S10 a long, high-entropy value under a key named like a token, secret, password, auth or
API key. S01 to S09 are `error` and fail the check; S10 is `warn`. S11 (`info`) names a literal value under a
secret-named key in a file whose other secrets are loaded from the environment (`${VAR}`, `$VAR`, `%VAR%`, `{env:VAR}`).

A message names the shape id and up to 5 locations (`path` and line), never the value, the key or any other file text.
A file that could not be scanned is named in `AGENT_CONFIG_SECRET_UNSCANNED`: a file over 512 KiB, one over the caps, or a
path git cannot read safely is an `error` (it may hide a secret), a binary or missing file a `warn`. The CLI and the Action
read the files at `HEAD`, also when there is no diff to measure; in PR-number mode, with a compare-API diff and with a
`pull_request_target` checkout of the base the Action's checkout may not be the pull request head, so the message says so
and nothing is read. What the scan misses is in
[docs/LIMITS.md](../LIMITS.md#secrets-in-agent-configs).

The shapes and the redaction helpers (`findSecretSpans`, `redactSecrets`, `truncateUtf8`, `redactMessage`,
`MESSAGE_MAX_BYTES`) are internal to pharn-ci: `@pharn-ci/core` is a private workspace package and is not published.
