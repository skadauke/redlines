# Positron, Jupyter and other Markdown tools

Status: research notes, October 2026.

This study looks at Redlines files in the wider Markdown ecosystem, through four questions:

- Could Positron's visual editor for Quarto support Redlines?
- Which editor does Jupyter use, and could it be modified?
- Which other popular Markdown tools should the format keep in mind?
- What happens to a Redlines file in Google Docs, which now edits Markdown files natively?

## Method

- **Sources:** documentation, release notes and, for open-source tools, their code. Every claim
  below links to a source or names a local test.
- **Local tests:**
  - a sample Redlines file with every mark kind, a table, a code-block substitution, an ordinary
    comment and the ledger (61 HTML comments);
  - the 217 render-safe fixtures from [renderers.md](renderers.md);
  - each rendered with and without its marks, and compared after HTML parsing.
- **Effort figures:** estimates, and marked as such.
- **Not tried by hand:** Colab, Notion import, Obsidian's Reading view and chat apps. Each needs
  about ten minutes. Google Docs was tried by hand ([below](#google-docs)).

The code and data are in the project's lab, outside this repository. They include the test files
and the full source list.

## Positron

Positron's visual mode for `.qmd` and `.md` is the Quarto extension's visual editor. RStudio uses
the same editor. It is a ProseMirror editor, with CodeMirror 6 for code cells, running in a VS
Code webview. It reads and writes Markdown through pandoc
([quarto-dev/quarto](https://github.com/quarto-dev/quarto/tree/main/packages/editor)).

The visual editor does not turn inline markers into `` `<!--…-->`{=html} ``. It has its own
handling for HTML comments and writes them back unchanged
([source](https://github.com/quarto-dev/quarto/blob/main/packages/editor/src/marks/raw_inline/raw_html_comment.ts)).
The `{=html}` output comes from plain `pandoc -t markdown`, which is a different path
([tools.md](tools.md), row 7).

What does go wrong, from the editor's source and an emulation of its pandoc settings (the editor
itself wasn't run):

| Problem                                                                                                          | Effect                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Markers show as gray monospace text, with no tracked-change meaning                                              | Typing next to a marker is untracked, and typing before a closer becomes part of someone else's insertion                  |
| On opening a file, the editor rewrites it in pandoc's canonical style if it differs                              | The file changes before anyone types: list spacing, table padding, code-fence info strings, a blank line before one closer |
| A tight list that uses the list-item opener ([format spec](../format.md#3-where-markers-go)) loses its tightness | Renders as a loose list on GitHub, in VS Code and in JupyterLab                                                            |
| The `column` and `sentence` wrap settings                                                                        | Push markers to line starts (9 places in the sample), which visibly breaks the text                                        |

**License and extensibility.** The editor has been MIT-licensed since the extension's 1.137.0
release in September 2026
([changelog](https://github.com/quarto-dev/quarto/blob/main/apps/vscode/CHANGELOG.md)). It has no
plugin API; a 2022 request for one is still open
([#759](https://github.com/quarto-dev/quarto/issues/759)). Adding Redlines would mean a fork or an
upstream pull request.

**Recommendation:** don't build Redlines into Quarto's visual editor. Ship a Redlines extension for
VS Code, published on Open VSX.

- **Where it runs:** Positron installs extensions from Open VSX or a mirror of it, and "almost all"
  VS Code extensions work there ([Positron docs](https://positron.posit.co/extensions.html)). The
  same extension also runs in VS Code, Cursor, code-server and GitLab's Web IDE.
- **How:** a custom editor that hosts the CodeMirror 6 Redlines editor. Quarto's visual editor is
  itself a custom editor, which shows that the approach works in Positron.

| Step                                                                                                                                                                                                                   | Effort (estimate)                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Now: tell Positron and RStudio users to edit Redlines files in source mode. `editor: source` in `_quarto.yml` or the front matter makes a project always open that way                                                 | Days                                  |
| A lightweight extension on VS Code's normal text editor: colored insertions, deletions shown after their markers, author hovers, accept and reject commands, threads in VS Code's Comments panel, and a preview plugin | 2–4 weeks                             |
| A custom editor that hosts the CodeMirror 6 Redlines editor, with every Redlines feature                                                                                                                               | 3–6 weeks once the editor core exists |
| Ask Posit for "Redlines-safe" display in their visual editor: hide markers, keep lists tight, warn on open                                                                                                             | 2–6 weeks, needs Posit                |

**Limits of a custom editor** ([VS Code docs](https://code.visualstudio.com/api/extension-guides/custom-editors)):

- It is chosen by file name, never by content. So it offers "Reopen in Redlines" when it sees a
  ledger, or users add a setting.
- Positron's code execution and language features don't work inside it. The same is true of
  Quarto's visual mode.
- Git diffs may open in it.

## Jupyter

| Environment                                | Markdown cells are edited with | Rendered with              | HTML comments when rendered |
| ------------------------------------------ | ------------------------------ | -------------------------- | --------------------------- |
| JupyterLab 4 and Notebook 7                | **CodeMirror 6**               | marked, then sanitize-html | Removed                     |
| VS Code notebooks                          | Monaco                         | markdown-it                | Hidden or removed           |
| Positron Notebooks (default since 2026.07) | Monaco                         | marked, then React         | Removed (from its source)   |
| Google Colab                               | Undocumented                   | Undocumented               | Unknown                     |
| nbconvert to HTML                          | —                              | mistune 3                  | Kept in the page, hidden    |

- None of these is a visual Markdown editor. Cells are edited as source and shown rendered.
- **Rendering:** in the JupyterLab and VS Code pipelines, 216 of the 217 fixtures render exactly
  like their newest view. The one exception, a GitHub alert, fails in every renderer.
- **Modifying JupyterLab:** possible. JupyterLab lets extensions add CodeMirror 6 extensions to
  every editor, Markdown cells included, and replace the Markdown parser. So the Redlines
  CodeMirror extension could run in each Markdown cell. Rough estimate: 1–2 months once the core
  exists.
- **Notebook-level changes:** the hard part. Inserting, deleting, splitting, merging or
  reordering cells can't be tracked in cell text; they need their own design. One existing
  extension, `jupyter-suggestions`, stores whole-cell suggestions in notebook metadata
  ([repo](https://github.com/jupyterlab-contrib/jupyter-suggestions)).

Jupytext is the bridge today. It pairs a notebook with a text file.

- **Round trips:** `.md` → `.ipynb` → `.md` and `.Rmd` → `.ipynb` → `.Rmd` were byte-identical for
  the sample, markers and ledger included.
- **The workflow:**
  - Authors run code in JupyterLab or Positron, and Jupytext writes the inputs back to the text
    file.
  - Reviewers work on the text file in the Redlines editor.
  - Code changes show as whole-chunk substitutions.
- **One hazard:** adding a Markdown cell between a code-block substitution's opener and its code
  cell moved the opener in front of the new paragraph. The parser must detect and repair a
  displaced opener when it loads the file.

## Google Docs

Tested by hand on 2026-10-14 in a Google Workspace account, with a synthetic Redlines file: an
insertion, a deletion, a substitution, a comment, a deleted table row, `<sub>`, `<mark>`, `<br>`, a
GitHub alert, a plain HTML comment and the ledger.

| Path                                                                                            | What a reader sees                                                                                               | What comes back out                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Upload through Docs' file picker,** which converts the file to a Google Doc                   | The newest text, as on GitHub. Markers, deleted text, the deleted row and the ledger are hidden; `<sub>` renders | Download as Markdown, even unedited: **every HTML comment is dropped.** All tracked changes are silently accepted, deletions and the thread are lost, and so is the ledger. `<sub>` and `<mark>` are lost too, and `<br>` becomes a hard break                                                                                                                                                             |
| **Upload to Drive and open in Docs** (Markdown mode, with an `.MD` badge); the file stays `.md` | Every marker, HTML tag and the whole ledger, as raw code-styled text                                             | Opening alone changes nothing (899 bytes before and after). The first edit shows the warning "Web formatting (HTML) turns into plain text" and then **rewrites the stored file**: markers and ledger survive byte for byte, but blank lines before marker lines are removed, `&nbsp;` paragraphs appear around the deletion block, the alert is escaped, the table is re-padded and the final newline goes |

What this means for Redlines:

- Never hand a Redlines file to Google Docs users as `.md`. Export `.docx` instead: Google Docs
  turns Word's tracked changes into suggestions.
- A file that went through Docs' Markdown mode can come back. Its marks survive, and Redlines
  repairs their placement ([format spec](../format.md#9-files-and-other-tools)).
- **Not tested:** comments added in Docs' Markdown mode. Google says they are kept when the file
  is reopened, but not where they are stored.

## Other tools

Ranked by how much the format needs to account for them:

| Priority | Tools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | **Obsidian:** built on CodeMirror 6, with a plugin API for CodeMirror extensions, and review plugins built on HTML comments already exist. **The VS Code family:** see above. **GitLab:** its rich-text editor, the default for new users since 18.2, deletes HTML comments and rewrites syntax on save ([#460710](https://gitlab.com/gitlab-org/gitlab/-/issues/460710)). Its Web IDE is safe and runs Open VSX extensions. **Docusaurus:** plans to turn off HTML-comment support in v4 |
| Medium   | Zettlr and Joplin, both on CodeMirror 6. MkDocs (format fix below). Marp, which puts every marker and the ledger into the slides' speaker notes. iA Writer, which keeps its own authorship block at the end of the file. Bitbucket, which shows HTML comments as text. The Google Docs API, which can now write suggestions and could serve as an exchange bridge (untested)                                                                                                              |
| Low      | Notion, Confluence, Bear, Logseq, Ulysses, Microsoft Loop, Slack, Teams, Discord and chat apps. These drop or mangle comments; they need a clean "accept all" export, not Redlines support                                                                                                                                                                                                                                                                                                |

## Effect on the format

The survey supports the design and adds five rules:

1. Write a payload's final `-` as `\x2d` instead of appending `\`. Python-Markdown (MkDocs,
   Zensical) shows a comment ending in `-\-->` as text; `\x2d` rendered cleanly in all six
   renderers tested.
2. No Redlines comment starts with `#`. Jupytext's cell markers (`<!-- #region -->`) and Quarto's
   editing comments (`<!--#`) do.
3. The ledger:
   - Content after it is tolerated: iA Writer appends its own block, and people type below it.
   - It keeps `redlines` as its first word, which also stops Marp from reading it as slide
     settings.
   - It is never put in front matter, which Obsidian and Quarto rewrite.
4. Pandoc-based visual editors loosen lists that use the list-item opener. Document this next to
   the advice to edit in source mode.
5. Privacy: Marp exports markers to speaker notes. Publish the accepted view.

The format keeps a single storage syntax, because every alternative fails somewhere:

- CriticMarkup and pandoc spans are visible on GitHub;
- `%%` works only in Obsidian;
- link-definition comments can't be inline;
- tools that strip HTML comments strip those too.

Offer conversions instead:

- an accept-all export;
- the CriticMarkup review view;
- Word;
- possibly Google Docs suggestions.

**File extensions:** keep `.md`, `.qmd` and `.Rmd`, recognized by the ledger. Reach `.ipynb`
through Jupytext. A `.redlines.md` double extension is optional at most.
