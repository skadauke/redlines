# Plugins

Everything beyond the editing core is a plugin. First-party plugins are written against
[`@redlines/plugin-api`](../packages/plugin-api), the API that other plugins will use later, and
ship with the app; each one can be turned off. None is written yet. These are planned:

| Plugin       | What it adds                                              |
| ------------ | --------------------------------------------------------- |
| `review`     | The review bar, change cards and the comment rail         |
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
| `themes`     | Built-in themes and themes from the host                  |
