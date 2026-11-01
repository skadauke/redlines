# Integrations

Redlines in other tools. Each integration gets its own folder here. So far only the Claude Code
skill is written.

| Integration     | What it is                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `vscode`        | The VS Code and Positron extension                                                                     |
| `claude-code`   | The Claude Code plugin: a skill (written), hooks and the MCP configuration                             |
| `codex`         | The Codex setup: the MCP server, the skill and an `AGENTS.md` snippet                                  |
| `syrus`         | The Syrus plugin                                                                                       |
| `github-action` | A GitHub Action that shows the review view on pull requests                                            |
| `pandoc`        | A Lua filter and a Quarto extension; the prototype is in [`docs/pandoc-filter`](../docs/pandoc-filter) |
| `obsidian`      | An Obsidian plugin, later                                                                              |
| `jupyter`       | A JupyterLab extension, later                                                                          |
| `google-docs`   | A bridge to Google Docs suggestions, later                                                             |

## Claude Code

[`claude-code/SKILL.md`](claude-code/SKILL.md) is a Claude Code skill. It tells Claude to read a
Redlines file with `redlines view --review` and to change it only through the `redlines` command
line ([`packages/cli`](../packages/cli)), so that Claude's edits are tracked suggestions in its name
for a person to accept or reject (design §8).

To use it in every project, copy it into your skills folder:

```sh
mkdir -p ~/.claude/skills/redlines
cp integrations/claude-code/SKILL.md ~/.claude/skills/redlines/SKILL.md
```

The command line is not published yet. In a checkout of this repository, run it from the root as
`pnpm -s redlines <command> …`. To have `redlines` in any folder, point an alias at the source:

```sh
alias redlines='node --experimental-strip-types --disable-warning=ExperimentalWarning /path/to/redlines/packages/cli/src/main.ts'
```
