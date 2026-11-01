# Plugins

Everything beyond the editing core is a plugin. First-party plugins are written against
[`@redlines/plugin-api`](../packages/plugin-api), the API that other plugins will use later, and
ship with the app; each one can be turned off. Two are written: `review`
([`@redlines/review`](review)), the margin notes, change cards and review bar, and `themes`
([`@redlines/themes`](themes)), the built-in themes and their fonts. The others are planned:

| Plugin       | What it adds                                              |
| ------------ | --------------------------------------------------------- |
| `tables`     | Table editing                                             |
| `math`       | Math formulas                                             |
| `diagrams`   | Mermaid diagrams                                          |
| `code`       | Syntax highlighting in code blocks                        |
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
