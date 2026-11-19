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
| `outline` ([`@redlines/outline`](outline)) | The outline of the headings, in the left margin                |
| `formatting` ([`@redlines/formatting`](formatting)) | The Format and Paragraph menus and their shortcuts |
| `tables` ([`@redlines/tables`](tables)) | The Table menu and its commands, the grips and the + |
| `emoji` ([`@redlines/emoji`](emoji)) | Emoji shortcodes drawn as their emoji, and the list of emoji after a colon |
| `toolbar` ([`@redlines/toolbar`](toolbar)) | The toolbar: the title bar's wrench, right-click and the keyboard |
| `sync` ([`@redlines/sync`](sync)) | A window's side of a live session: binds the editor to a session authority (`packages/collab`) over a transport; between the windows of one document today |
| `agents` ([`@redlines/agents`](agents)) | The @ picker in the comment box, the runs a posted mention starts, and Ask: a question about a selection, answered in a bubble |
| `agent-claude` ([`@redlines/agent-claude`](agent-claude)) | The Claude provider: starts the person's own Claude Code |
| `agent-codex` ([`@redlines/agent-codex`](agent-codex)) | The Codex provider: starts the person's own Codex |
| `agent-acp` ([`@redlines/agent-acp`](agent-acp)) | The Agent Client Protocol provider: starts an agent the person added, and OpenClaw's `openclaw acp` bridge, which has no toolbox (the Gateway connection, whose runs edit through the node's tools, is in the app); Preferences adds OpenClaw agents, and no other yet |

Math is drawn by the editor core, and the first run is the desktop app's own onboarding, so neither is a plugin. The others are planned:

| Plugin       | What it adds                                              |
| ------------ | --------------------------------------------------------- |
| `diagrams`   | Mermaid diagrams                                          |
| `paste`      | Paste handlers                                            |
| `word`       | Copy for Word, and the menu commands for `.docx` (the code is `packages/word`, which the app's File menu calls now; no plugin yet) |
| `print`      | Printing and PDF export (the app's own File › Print and Export as PDF today) |
| `export`     | Export to HTML, clean Markdown and the review view        |
| `workspace`  | The folder sidebar, Quick Open and folder search; desktop |
| `git`        | Optional git features                                     |
| `collab`     | Live sessions: invitations and presence across networks (`sync` is the window's side of a session) |
| `ai`         | Agents in comments and the levels (Ask and the chat panel are in `agents`) |
