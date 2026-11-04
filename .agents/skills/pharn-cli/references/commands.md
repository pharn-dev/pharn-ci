# pharn command notes (0.9.0 baseline)

Source: the CLI's own README and `docs/commands/*` at 0.9.0. Where 0.10.0
changes a command (`status --json`, `update --dry-run`, `update --json`), see
[json.md](json.md); the rest below still holds.

## Command surface

| Command | Options it takes | Writes |
| ------- | ---------------- | ------ |
| `pharn list` | `--json` | never |
| `pharn status` | `--strict`, `--no-drift`, `--json` (0.10.0+) | never |
| `pharn update` | `--yes`/`-y`, `--force`, `--ref latest\|main`, `--dry-run`, `--json` (0.10.0+, only with `--dry-run`) | yes, never with `--dry-run` |
| `pharn add [name]` | none | yes |
| `pharn remove [name]` | none | yes |
| `pharn init` | `--ref` | yes, interactive only |

Any other option is refused (on 0.9.0 that includes `status --json`): ``Unsupported option for `status`: "--json"`` on
stderr, usage text, exit 1.

`init`, `add`, `remove` and `update` take an advisory lock at `.pharn.lock`; a
second writer refuses with exit 1. `list` and `status` never take it.

## status

- Reads `pharn.config.json`; missing or pre-archetype config exits 1 with a
  hint to run `pharn init`.
- Sections: version (up to date or update available), drift, `MODELS`, `NODE`,
  `HOOKS`.
- Drift lists: differs from upstream (may be your edit or upstream moving),
  missing, unreadable (symlink or non-regular file).
- `status` compares bytes only; `update` also reads `pharn.records.json` to
  tell your edits from upstream's changes, so a file listed as differing may be
  upgraded cleanly by `update`.
- `--no-drift` skips the clone (version check only).
- `--strict` exits 1 on outdated, differing, missing, unreadable, or an
  unwired hook. `MODELS` and `NODE` notes never affect it.
- It needs network (GitHub) unless `--no-drift`.

## update

- Needs Node >= 24.2.0; older exits 1 with nothing written, even with `--yes`
  or `--force`.
- Off a TTY it exits 1 before any network call unless `--yes` is passed.
  `--force` does not imply `--yes`.
- Per-file decision: missing -> write; identical to upstream -> no-op;
  identical to what pharn recorded -> write (updated); edited
  (`modified`), no record (`unrecorded`) or no records file
  (`unverifiable`) -> SKIP, or back up then overwrite with `--force`.
- Never deletes. Never touches `.claude/settings.json`; it prints a `HOOKS`
  note naming hooks upstream wires that the project does not, each as JSON
  ready to paste under its event.
- Capabilities added with `pharn add` (`manual`) survive an update. Membership
  changes are printed under `CAPABILITIES` (ADDED, REMOVED, KEPT).
- "Already up to date" at the same skills version does not restore files a
  newer CLI started installing; `status` shows them as missing. The fix is
  `update --force` (explain it first), or wait for the next version bump.
- Installs from before pharn 0.4.0 have no records: the first update skips
  every differing file as `unverifiable`.
- `--ref latest` follows verified releases and is recorded in the config;
  `--ref main` switches back. Only use when the person asks for the channel.
- `.pharn-backup/` is never pruned and `.gitignore` is never edited.

## add and remove

- `add` refuses when the upstream `SKILLS_VERSION` or layout differs from the
  recorded one, or when the CLI is older than upstream's `MIN_CLI`. It backs up
  any destination file it would overwrite with different bytes.
- `remove` needs no network, deletes only that capability's directory, prunes
  its records, and never touches `CONSTITUTION.md` or `memory-bank/`.
- A name installed as both griller and lens needs `griller:` or `lens:`.

## list --json

One object, nothing else on stdout:

```json
{
  "mode": "archetype",
  "skillsVersion": "1.0.0",
  "archetypes": ["ssr"],
  "capabilities": [
    { "name": "a11y", "role": "griller", "source": "auto" }
  ]
}
```

`source` is `auto` or `manual`, and is omitted for installs that predate it.

## Exit codes

0 success, skips included. 1 refusal or failure. 130 interrupted.
