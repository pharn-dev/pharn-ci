### 📜 Policy

Policy file — the pull request can edit this file, so it can only tighten the check

- ❌ **P02** `.claude/settings.json:3` — allow rule overlaps forbidden permission Bash(curl:\*)
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.
- ❌ **P02** `.claude/settings.json:4` — allow rule overlaps forbidden permission Bash(rm -rf:\*) and 2 more
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.
- ❌ **P02** `.claude/settings.json:9` — defaultMode bypassPermissions turns permission prompts off
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.
- ❌ **P02** `x'y\|<b>z</b>*w*/.claude/settings.json:5` — allow rule overlaps forbidden permission WebFetch
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.
- ❌ **P04** `.claude/settings.json:14` — enableAllProjectMcpServers approves every project MCP server
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.
- ❌ **P04** `.mcp.json:2` — MCP server is not on the policy's allowlist
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.
- ❌ **P04** `.mcp.json:7` — MCP server is not on the policy's allowlist
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.
- ❌ **P05** `.cursor/mcp.json:3` — MCP server matches forbidden entry \*/curl
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.
- ❌ **P05** `.cursor/mcp.json:8` — MCP server matches forbidden entry evil and 2 more
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.
- ❌ **P05** `pkg/.mcp.json:2` — MCP server matches forbidden entry https:\/\/bad.example/\*
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.

<details><summary>2 more violations</summary>

- ❌ **P06** `.claude/settings.json:16` — disableAllHooks turns every hook off
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.
- ⚠️ **P02** `.claude/settings.json:11` — additionalDirectories gives the agent file access outside the repository
  - Hint: Ask a maintainer or the policy owner to review the committed agent settings this rule names.

</details>

- ⚠️ Settings: P02–P06 could not fully use these agent settings files: \`.claude/settings.json\` line 6 (\`unknown-rule-syntax\`). Claude Code skips an unparseable file or entry; pharn-ci never guesses what it meant, and a file it could not read counts against the policy.
  - Hint: Check the policy settings and correct the ones the report names.
- ⚠️ Ignored: The policy file sets policy.rules.P02 lower than the default, so it was not applied.
  - Hint: Check that the workflow inputs and the config only make the org policy stricter.

