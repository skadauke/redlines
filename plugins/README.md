# Plugins

Everything beyond the editing core is a plugin. First-party plugins are written against
[`@redlines/plugin-api`](../packages/plugin-api), the API that other plugins will use later, and
ship with the app; each one can be turned off. These are written:

| Plugin                                  | What it adds                                                      |
| --------------------------------------- | ----------------------------------------------------------------- |
| `review` ([`@redlines/review`](review)) | Margin notes, change cards and the review bar                     |
| `themes` ([`@redlines/themes`](themes)) | The built-in themes and their fonts                               |
| `code` ([`@redlines/code`](code))       | Syntax colors in code blocks                                      |
| `find` ([`@redlines/find`](find))       | Find and replace, in the Edit menu                                |
| `formatting` ([`@redlines/formatting`](formatting)) | The Format and Paragraph menus and their shortcuts |
| `tables` ([`@redlines/tables`](tables)) | The Table menu and its commands |
| `agents` ([`@redlines/agents`](agents)) | The @ picker in the comment box, and the runs a posted mention starts |
| `agent-claude` ([`@redlines/agent-claude`](agent-claude)) | The Claude provider: starts the person's own Claude Code |
| `agent-codex` ([`@redlines/agent-codex`](agent-codex)) | The Codex provider: starts the person's own Codex |
| `agent-acp` ([`@redlines/agent-acp`](agent-acp)) | The Agent Client Protocol provider: starts an agent the person added; Preferences doesn't offer adding one yet |

The others are planned:

| Plugin       | What it adds                                              |
| ------------ | --------------------------------------------------------- |
| `math`       | Math formulas                                             |
| `diagrams`   | Mermaid diagrams                                          |
| `paste`      | Paste handlers                                            |
| `word`       | Copy for Word, and `.docx` import and export              |
| `print`      | Printing and PDF export                                   |
| `export`     | Export to HTML, clean Markdown and the review view        |
| `outline`    | The document outline                                      |
| `workspace`  | The folder sidebar, Quick Open and folder search; desktop |
| `git`        | Optional git features                                     |
| `collab`     | Live sessions: presence and invitations                   |
| `ai`         | The chat panel, Ask agent, and agents in comments         |
| `onboarding` | The first run; desktop                                    |
