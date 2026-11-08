# Phargus diagnostics (local, opt-in)

[Phargus](https://github.com/pharn-dev/phargus) samples the event loop, memory, heap spaces and GC of a Node.js
process. Here it watches the `pharn-ci check` CLI. It is a contributor tool only: no package.json in this repo
depends on it (the "no package.json gains a dependency" pin tests stay as they are), nothing in the Action or the CLI
bundle loads it, and the agent sends nothing over the network (it writes a local NDJSON file; the collector's
dashboard binds to 127.0.0.1).

- `tools/`: the collector helpers, copied unchanged from the `phargus-setup` skill (`.agents/skills/phargus-setup/scripts`).
  Excluded from Biome like `.agents`.
- `node_modules/` (from `pnpm phargus:install`), `raw.ndjson` and captures are git-ignored.

## Run it

```bash
pnpm phargus:install                 # once: npm install @pharn-dev/phargus@0.1.0 into .phargus, saving no manifest
pnpm build                           # the recipe runs packages/cli/dist
: > .phargus/raw.ndjson              # the collector follows this file; it must exist
pnpm phargus:collect --port 7070     # terminal 1: collector + dashboard on http://127.0.0.1:7070 (SSE at /events)
pnpm phargus:check --format json     # terminal 2: pharn-ci check with the agent preloaded; writes .phargus/raw.ndjson
```

Start the collector first: it streams the windows it sees live. Each `phargus:check` run rewrites `raw.ndjson`, so
restart `phargus:collect` for every run. The agent is only an `--import` preload; the check's report and exit code
are the same as without it. For analysis use the `phargus-diagnose`, `phargus-memory`, `phargus-rules` and
`phargus-verify` skills with `--project .phargus` (`doctor` needs a package.json there and is not part of this recipe).
