# Research notes

Status: research notes, October 2026.

This folder holds the tests and surveys behind the [design spec](../design.md) and the
[format spec](../format.md). They were run in October 2026, before implementation started. The
specs state the rules; these notes record what was tested, how, and what came out, with the
numbers behind each choice. Several notes describe problems in earlier versions of the format and
the fixes for them; the specs include those fixes.

The code and data are in the project's lab, outside this repository.

## The notes

| Note                                   | What was tested                                                                                                                                                                                           | Main result                                                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [word.md](word.md)                     | About 25 multi-author edit scenarios in Word for Mac: what Word stores and shows, what accept and reject do, and whether custom data survives a save                                                      | Word's model is flat, like the format's, and a join takes the first block's type; Word renumbers revision ids on every save, and a custom XML part, bookmarks and likes survive a save                              |
| [renderers.md](renderers.md)           | Where a marker can sit without changing the rendered page: 90,264 fuzz cases and about 800 targeted ones in cmark-gfm, GitHub's live pipeline, markdown-it (VS Code), micromark, commonmark.js and pandoc | Markers between words are safe; four payload forms leaked marker text on GitHub and in VS Code until payloads became one line, with hyphens and backticks escaped                                                   |
| [syntax.md](syntax.md)                 | Every element of the Markdown Guide's basic, extended and hacks syntax: storage in each dialect, rendering, tracked changes, and 172 marker placements                                                    | GitHub's dialect in `.md` and pandoc's in `.qmd` and `.Rmd`; 124 of 135 marker forms render like unmarked text, and 28 hazards became forbidden positions                                                           |
| [edit-model.md](edit-model.md)         | A reference model of Word's run model, property-tested over thousands of random multi-author edit scripts                                                                                                 | The flat model holds and every failure was in the encoding; a deletion across paragraphs is one mark, with `\n` for breaks                                                                                          |
| [ids-and-ledger.md](ids-and-ledger.md) | 80,511 seeded merge trials across 33 ledger designs, YAML in six parser setups, and knitr                                                                                                                 | Ids stay random; with one ledger line per mark in document order, keeping both sides of a ledger conflict is always right, apart from stale entries the format ignores                                                                                 |
| [history.md](history.md)               | A prototype of full history: a 53-event negotiation in four layouts, a 3,804-event contract and 410 real git merges                                                                                       | Every earlier version was rebuilt byte for byte from the final file, on every branch; the history takes one comment block per save, about 71 bytes per event                                                        |
| [collaboration.md](collaboration.md)   | Live sessions simulated with the real `@codemirror/collab`: five strategies, then every kind of change (about 39,000 sessions), then inserted table rows                                                  | Rebasing tracked changes corrupted 57–95% of sessions; clients that re-derive the tracked form brought that to 0% (0–0.4% with every kind of change)                                                                |
| [tools.md](tools.md)                   | Prettier, markdownlint, remark, mdformat, pandoc, knitr and R Markdown, kramdown (Jekyll), goldmark (Hugo), MDX and Docusaurus, and Liquid                                                                | GitHub, VS Code, pandoc (so R Markdown and Quarto, though Quarto itself wasn't run), Hugo and Docusaurus show the newest text, and formatters keep the ledger byte for byte; knitr runs R code it finds in comments |
| [ecosystem.md](ecosystem.md)           | Positron and the Quarto visual editor, Jupyter and Jupytext, GitLab, MkDocs, Marp and about 30 more tools; Google Docs' Markdown mode, by hand                                                            | Pandoc-based visual editors rewrite the file and loosen some lists; Google Docs drops every marker when it converts a file, so its users get `.docx`                                                                |
| [llm-hosts.md](llm-hosts.md)           | How Claude, Codex and ChatGPT show Markdown and Redlines files, and how Redlines can plug into them through MCP, skills, plugins, hooks and MCP Apps                                                      | Some chat apps show every marker as text and others hide deleted text, so files and tools are the safe path: a command line, a local MCP server and a skill first                                                   |
| [ai-providers.md](ai-providers.md)     | Claude, OpenAI, ACP agents, GitHub Copilot, Gemini and local models: sign-in with existing subscriptions, vendor terms and streaming                                                 | An agent host with several drivers, including the user's own Claude Code and Sign in with ChatGPT; agents edit only through Redlines' MCP tools                                                                     |
| [editor.md](editor.md)                 | CodeMirror 6 as the editor's base, from its docs, forum, changelog and field reports, and WebKit, Electron or Tauri for the desktop app                                                                   | CodeMirror 6 is the right base because it keeps the Markdown text as the only source of truth; tables and scroll stability are the largest risks, and the Mac app runs on WebKit through Tauri v2                   |
| [tables.md](tables.md)                 | Table editing in Google Docs (tested live) and Word, Copy for Word with nine samples pasted into Word for Mac, and printing to PDF                                                                        | A table design and its format additions; Copy for Word built from the same renderer as the PDF; a small paginator, because WebKit can't repeat header rows or keep rows whole                                       |
| [paste.md](paste.md)                   | A paste spec: 54 clipboard captures, 12 HTML-to-Markdown converters and a prototype                                                                                                                       | The best existing converters passed 9–17 of 39 checks, and 7 of 12 wrote marker text back out unescaped; the prototype passes all 39                                                                                |
| [ux.md](ux.md)                         | How Word and Google Docs handle review: modes, markup views, cards, bulk decisions, comments, presence and AI edits                                                                                       | Both have gaps, such as Word's mode switcher turning tracking off silently and Google Docs' lack of decisions by person; the review design in design.md follows from them                                           |

## Not yet tested

- Word for Windows and Word for the web. Every Word test in [word.md](word.md) and
  [tables.md](tables.md) ran on Word for Mac.
- Accepting a single revision in Word. Word for Mac's AppleScript `accept` acts like `reject`, and
  the scripted test setup couldn't reach the ribbon's Accept menu ([word.md](word.md)).
- Whether Word accepts and rejects a column deletion written as `w:cellDel`
  ([tables.md](tables.md)).
- Live sessions with column changes, moves, header changes, lists, links and footnotes
  ([collaboration.md](collaboration.md)).
- Full history with front-matter changes, Word import and several live authors
  ([history.md](history.md)).

## Fixtures and images

[`fixtures/`](fixtures/) holds conformance fixtures for the test suite of `packages/format`:

- [`render-safe.json`](fixtures/render-safe.json): 217 marked sources that must render exactly
  like their clean source, with the verdict observed in every renderer;
- [`render-hazards.json`](fixtures/render-hazards.json): 132 patterns a serializer must never
  write, with the verdict observed in every renderer;
- [`edit-model.json`](fixtures/edit-model.json): 29 edit scripts with their input and expected
  output ([edit-model.md](edit-model.md)).

The fixtures use earlier layouts: ledger entries without times, and some markers with authors and
times. They need to be regenerated in the current layout when `packages/format` is built.

[`img/`](img/) holds screenshots from the Word and Google Docs tests.
