### 📜 Policy

Policy file — the pull request can edit this file, so it can only tighten the check

- ❌ **P02** `.claude/settings.json:3` — allow rule overlaps forbidden permission Bash(curl:\*)
  - Hint: Narrow or remove the allow rule (or the defaultMode or additionalDirectories key) in the settings file, or ask the policy owner to change setup.forbidden_permissions.
- ❌ **P02** `.claude/settings.json:4` — allow rule overlaps forbidden permission Bash(rm -rf:\*) and 2 more
  - Hint: Narrow or remove the allow rule (or the defaultMode or additionalDirectories key) in the settings file, or ask the policy owner to change setup.forbidden_permissions.
- ❌ **P02** `.claude/settings.json:9` — defaultMode bypassPermissions turns permission prompts off
  - Hint: Narrow or remove the allow rule (or the defaultMode or additionalDirectories key) in the settings file, or ask the policy owner to change setup.forbidden_permissions.
- ❌ **P02** `x'y\|<b>z</b>*w*/.claude/settings.json:5` — allow rule overlaps forbidden permission WebFetch
  - Hint: Narrow or remove the allow rule (or the defaultMode or additionalDirectories key) in the settings file, or ask the policy owner to change setup.forbidden_permissions.
- ❌ **P04** `.claude/settings.json:14` — enableAllProjectMcpServers approves every project MCP server
  - Hint: Remove the server, or ask the policy owner to add it to setup.allowed_mcp_servers.
- ❌ **P04** `.mcp.json:2` — MCP server is not on the policy's allowlist
  - Hint: Remove the server, or ask the policy owner to add it to setup.allowed_mcp_servers.
- ❌ **P04** `.mcp.json:7` — MCP server is not on the policy's allowlist
  - Hint: Remove the server, or ask the policy owner to add it to setup.allowed_mcp_servers.
- ❌ **P05** `.cursor/mcp.json:3` — MCP server matches forbidden entry \*/curl
  - Hint: Remove the server from the MCP file.
- ❌ **P05** `.cursor/mcp.json:8` — MCP server matches forbidden entry evil and 2 more
  - Hint: Remove the server from the MCP file.
- ❌ **P05** `pkg/.mcp.json:2` — MCP server matches forbidden entry https:\/\/bad.example/\*
  - Hint: Remove the server from the MCP file.

<details><summary>2 more violations</summary>

- ❌ **P06** `.claude/settings.json:16` — disableAllHooks turns every hook off
  - Hint: Add a command hook for the event whose matcher covers the required one (`*` or the same tool names), without an if condition.
- ⚠️ **P02** `.claude/settings.json:11` — additionalDirectories gives the agent file access outside the repository
  - Hint: Narrow or remove the allow rule (or the defaultMode or additionalDirectories key) in the settings file, or ask the policy owner to change setup.forbidden_permissions.

</details>

- ⚠️ Settings: P02–P06 could not fully use these agent settings files: \`.claude/settings.json\` line 6 (\`unknown-rule-syntax\`). Claude Code skips an unparseable file or entry; pharn-ci never guesses what it meant, and a file it could not read counts against the policy.
  - Hint: Keep agent settings files valid JSON and regular files under 512 KiB, and run on a checkout of the pull request head, so the org policy can check them.
- ⚠️ Ignored: The policy file sets policy.rules.P02 lower than the default, so it was not applied.
  - Hint: The org policy's value applies. Raise the setting in the workflow inputs or `.pharn/ci.yml` to match, or ask the policy owner to change the policy.

