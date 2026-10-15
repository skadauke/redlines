# Redlines design

Status: draft for review, October 2026. Nothing is built yet.

This document describes what Redlines does and how it is built. The file format is specified in
[format.md](format.md), and this document links to it rather than repeating it. The research
behind both is in [research](research/README.md).

## 1. Summary

**Redlines** is a free, open-source Markdown editor that shows every change.

1. **The most beautiful Markdown editor for Mac, Windows and Linux.** What you see is the
   document: headings look like headings and tables like tables, and Markdown syntax appears only
   where the caret is.
2. **Made for the documents AI writes.** Markdown is the document format of AI. People get `.md`
   files from ChatGPT, Claude and agents every day, and most apps show them as code. Redlines shows
   you a beautifully rendered document to read and edit, and copy and paste with Word, Google Docs
   and the web just work.
3. **You see every change.** When a colleague or an AI edits your document, each change shows who
   made it, and you accept or reject it. Word users know this as Track Changes, Google Docs users
   as Suggesting, developers as a diff. It is all saved in the plain Markdown file.

For teams and developers:

- **The Redlines format:** tracked changes and comments stored in the Markdown file itself, with no
  sidecar and no backend.
  - Every Redlines file is valid Markdown, and renders as its newest version wherever HTML
    comments are hidden: GitHub, VS Code, pandoc, R Markdown, Quarto, Hugo and Docusaurus.
  - Two modes: keep the current version only, or keep the full history, which lets you replay
    every edit made to a document.
- **Markdown flavors:** GitHub Flavored Markdown in `.md` files, and pandoc's Markdown in R
  Markdown (`.Rmd`) and Quarto (`.qmd`). Redlines reads the common variants, Obsidian's included.
- **Word, Google Docs, HTML and PDF:** import, export, copy and paste. Pasted text renders
  beautifully, always.
- **Agents as collaborators,** through MCP tools, @mentions in comment threads, and a chat panel
  for a document or a whole folder. They edit the way you choose: as tracked suggestions in their
  own name, or directly, with a record you can review and undo (§8). They run on the Claude or
  ChatGPT subscription you already have, or on your own API keys or a local model.
- **An embeddable React component,** to add a collaborative Markdown editor to your app.
- **Integrations:** VS Code and Positron, Claude, Codex and ChatGPT, Syrus, GitHub, Obsidian and
  Jupyter.
- **Plain files:** your documents are files on your disk. Share them through git, a shared folder
  or email; tracked changes and comments travel with the file and merge in git.

## 2. Goals and non-goals

**Goals:**

- A beautiful, minimal and functional interface, in which the document looks finished while you
  write it.
- Review the way people know it from Word and Google Docs: tracked changes, comment threads, and
  accepting or rejecting changes one by one, by person, or all at once.
- Plain Markdown files that other tools can read, with every change and comment inside, and no
  service behind them.
- Agents that work in documents as named collaborators, under their person's control.
- The same editor in the desktop app and embedded in other apps.

**Non-goals:**

- Features Markdown can't store portably: columns, text color, merged table cells, custom page
  layouts.
- MDX files.
- A sync service or accounts of our own. Files, git and the apps that embed Redlines are the
  storage.
- Access control in files. Apps that embed Redlines enforce roles.

## 3. Users and use cases

The first use case is **collaborative editing of design documents**: authors and reviewers, human
and AI, propose changes and discuss them in place, and the owner accepts or rejects them. The same
mechanics serve:

- **legal:** drafting and negotiation, where every change must be visible and attributable, and
  the full history of a negotiation can be replayed;
- **pharma and healthcare:** SOPs, policies and other controlled documents, with review and
  approval cycles;
- **academia:** scientific manuscripts and responses to reviewers, co-authored with figures,
  captions, citations and cross-references, and usually sent to the journal as a Word file;
- **data science:** R Markdown and Quarto documents, reviewed the way prose is, without leaving the
  source format.

These share three needs: every change carries an author and a time; changes survive round trips
through other tools; and the final document comes out both as clean Markdown and as a Word file
with its changes intact.

## 4. How Redlines compares

Redlines as designed; the other products as of October 2026, from their documentation. VS Code
includes the Live Share, GitHub Copilot and Quarto extensions. The website shows the same table.

| Feature                                     | Redlines | Word | Google Docs | Notion | VS Code |
| ------------------------------------------- | :------: | :--: | :---------: | :----: | :-----: |
| Edits Markdown files                        |    ✅    |  ❌  |     ✅      |   ❌   |   ✅    |
| R Markdown and Quarto                       |    ✅    |  ❌  |     ❌      |   ❌   |   ✅    |
| Tracked changes (suggestions)               |    ✅    |  ✅  |     ✅      |   ✅   |   ❌    |
| Comment threads                             |    ✅    |  ✅  |     ✅      |   ✅   |   ❌    |
| Accept or reject by person                  |    ✅    |  ✅  |     ❌      |   ❌   |   ❌    |
| Tracked changes stored in the Markdown file |    ✅    |  ❌  |     ❌      |   ❌   |   ❌    |
| Changes and comments merge in git           |    ✅    |  ❌  |     ❌      |   ❌   |   ❌    |
| Full edit history, stored in the file       |    ✅    |  ❌  |     ❌      |   ❌   |   ❌    |
| Live collaboration with people              |    ✅    |  ✅  |     ✅      |   ✅   |   ✅    |
| Live collaboration with AI                  |    ✅    |  ❌  |     ❌      |   ✅   |   ✅    |
| AI agents suggest changes in their own name |    ✅    |  ❌  |     ❌      |   ❌   |   ❌    |
| Word files with tracked changes, in and out |    ✅    |  ✅  |     ✅      |   ❌   |   ❌    |
| Desktop app for Mac, Windows and Linux      |    ✅    |  ❌  |     ❌      |   ❌   |   ✅    |
| Embeddable editor component                 |    ✅    |  ❌  |     ❌      |   ❌   |   ✅    |
| Free and open source                        |    ✅    |  ❌  |     ❌      |   ❌   |   ✅    |

Live collaboration with AI means an agent that works in the document as itself. In Word and Google
Docs, the AI edits only when asked, and its edits count as yours: Copilot edits the document under
your name, and Gemini's suggested edits stay visible only to you until you approve them.

## 5. The editor

### 5.1 Design goals

Creating a beautiful, minimal and functional user interface is the goal. The document looks like a
finished document while you write it. Controls appear when they are needed and stay out of sight
otherwise.

- **Rendering.** Headings, lists, tables, math and diagrams look as they will in the final
  document. Markdown syntax appears only around the caret, while you edit that spot.
- **Speed.** Large documents open quickly, typing never lags, and long documents scroll smoothly.
- **Native text behavior.** Each platform's text conventions work as they do in its other apps: on
  the Mac, autocorrect, text replacements, smart quotes, dictation, input methods and the system
  context menu.
- **A calm screen.** One document and little else. The review bar and the comment rail appear only
  when a document has changes or comments.

How it works:

- **One Markdown string is the model,** and positions are offsets into it. Syntax characters stay
  in the text and are hidden by decorations unless the caret is inside their element.
- **CodeMirror 6 is the base,** with the conditions in the [editor research](research/editor.md).
  Tables, scrolling, input methods, the caret and each platform's keyboard conventions need
  deliberate work on top of it. A prototype tested on long documents and real input settles it.
- **Search, word count and spellcheck** run over the visible text, never over markers or the
  ledger.

### 5.2 Markdown coverage

Redlines covers everything in the Markdown Guide's
[basic syntax](https://www.markdownguide.org/basic-syntax/) and
[extended syntax](https://www.markdownguide.org/extended-syntax/), written in the file's dialect
([format §9.1](format.md#91-file-types-and-dialects)), and these from its
[hacks page](https://www.markdownguide.org/hacks/):

- **Admonitions:** GitHub alerts in `.md` and Quarto callouts in `.qmd` and `.Rmd`, shown as boxes
  with an icon and a menu for the type.
- **Image size:** resize handles, stored as `<img width>` or `{width=}`, and tracked as a format
  change.
- **Image captions:** Quarto and bookdown figures with numbering and cross-references, and an HTML
  figure in `.md`. Word export writes real caption and cross-reference fields.
- **Symbols:** HTML entities, shown as the character, with a symbol palette and `&` autocomplete.
- **Table cells** with line breaks and lists.

Math, Mermaid diagrams, footnotes, task lists and `<details>` are covered too.

### 5.3 Views: Clean, Redlines, Raw

A switch at the top right of the editor sets how the document is shown:

- **Clean:** the document as it reads with every pending change accepted, without markup (Word's
  No Markup).
- **Redlines:** the document with its tracked changes and comments (Word's All Markup). This
  option appears only when the document has redlines: pending changes or comment threads.
- **Raw:** the Markdown source, markers and ledger included, with syntax highlighting. It is the
  same editor with its decorations turned off.

A document with redlines opens in Redlines; one without opens in Clean. Making a tracked change in
Clean switches the view to Redlines, so suggestions are never invisible to their author. The view
is each person's own and is never saved in the file. The review bar's menu also previews the
original (every change rejected) and one person's changes alone.

### 5.4 Modes: Editing, Suggesting, Viewing

Word and Google Docs have arrived at the same model, and Redlines follows it.

- **A mode menu** next to the view switch: Editing, Suggesting or Viewing. These are Google Docs'
  names; Word 365 calls the middle one Reviewing.
- **Track Changes** in the Review menu (⌘⇧E, as in Word) switches between Editing and
  Suggesting. It is the same state, reached two ways.
- **Every change of mode shows a short notice.** Word's mode switcher turns tracking off without
  one, which its users complain about.
- **Your mode is yours,** like Word's "Just Mine" tracking. It isn't saved in the file, so using
  Redlines without tracking imposes nothing on anyone. A file opens in Editing unless it asks for
  tracking.
- **Track changes for everyone,** like Word's "For Everyone", is a setting of the file
  (`tracking: everyone`, [format §5.6](format.md#56-settings)). Everyone who opens such a file
  starts in Suggesting, under a notice that says so. Without an app that enforces roles, anyone
  can still switch to Editing; the notice makes that a deliberate choice.
- **Roles,** where the embedding app enforces them (Syrus, for example): the owner starts in
  Editing, other editors are locked in Suggesting, and commenters can only comment.
- **Agents** follow the mode of the person they act for, unless set otherwise (§8.2).

### 5.5 Showing tracked changes

- **Word's vocabulary, in a color per author:** insertions underlined, deletions struck through,
  highlights tinted, and comments in a rail.
- **Change bars** in the left margin mark each line with a pending change, in its author's color,
  or gray when several people changed the line.
- **Each kind of change** looks as in Word, with Word's wording on its card:
  - a substitution is the struck old text followed by the underlined new text, with one card
    ("Replaced 'March' with 'April'");
  - a format change has a dotted underline ("Formatted: Bold");
  - a block-type change has a bar along the block's left edge ("Formatted: Heading 2");
  - a split or join is a small ¶ chip at the seam, which can be clicked like any change.
- **Markup is atomic while you edit.** It never expands under the caret. The caret steps over mark
  boundaries, Backspace acts on visible text and never on markers, and typing inside someone
  else's insertion splits it, as in Word.
- **Cards.** Hovering over a change shows its card after a short delay, above or below the line,
  never covering the changed text. A card shows the author, the time, Accept, Reject and Reply,
  and hovering over Accept or Reject previews the result. Clicking a change pins its card. Cards
  can be turned off.
- **Ordinary HTML comments,** such as an author's `<!-- TODO -->`, show as small dimmed notes in
  the Redlines view and are saved as written. The ledger never shows as text; its contents appear
  in cards and the rail.
- **The inspector** shows and edits one mark's raw markup.
- **Broken markup,** for example after a bad merge, shows a warning badge and is otherwise treated
  as text, so the document still opens.
- **Agent edits are animated** as they happen (§8.4).

### 5.6 Reviewing

- **The review bar** appears when a document has pending changes or open threads:
  - "Change 3 of 17", with previous and next, through changes and comments in document order,
    with a switch for either alone;
  - filter chips for people (in their colors, with counts), agents, and kinds of change;
  - Accept ▾ and Reject ▾. On the bar they decide and move on, like Word's "Accept and Move to
    Next"; a card's buttons decide without moving.
- **Bulk decisions:** this change, all shown, all by one person, all in the selection, all in this
  section, all from one agent run, or all. Each asks first, with counts ("Accept 12 changes: Ada 9,
  Claude for Ada 3?"), and one Undo reverses it. Linked changes, such as the two halves of a move,
  are decided together.
- **Reviewers who can't accept** (in an app with roles) get the same bar for moving through
  changes and replying.
- **Saving is independent of review.** A document can be saved, shared or committed with any
  number of pending changes.
- **Compare** shows the differences between two files, or between a file and an earlier version,
  as tracked changes. It is how a copy that comes back by email, or a conflicted copy from a sync
  service, becomes reviewable. Restoring an earlier version writes the difference as tracked
  changes, so the restore is reviewed too.

### 5.7 Comments and mentions

- **Threads as in Word:** anchored to a range or a point, with replies, likes and a resolved
  state. A thread can be assigned to a person and marked done.
- **The rail.** Cards sit level with their anchors. Clicking a card or its anchor outlines the
  card in its author's color and darkens the anchor's tint, as in Word, without connector lines.
  - The rail holds comment threads, plus changes that have replies. Other changes stay inline
    behind their cards; one card per suggestion in the margin, as in Google Docs, crowds it.
  - A **Changes** tab lists every change by section, with counts, like Word's Reviewing pane.
  - Density: expanded, icons only, hidden, or a full panel.
  - Filters: open, resolved, for you, assigned to me, people and agents, and search. Unread threads
    get a dot.
- **Drafts.** A comment is private until it is posted with ⌘↩, as in Word. Several drafts can be
  open at once, and they survive a reload.
- **Typing `@`** in a comment opens a picker of collaborators and agents. Mentioning a person
  offers "Assign to".
- **Mentioning an agent** asks it to act on the thread. It replies in the thread, suggests tracked
  changes to the anchored text, or both, in its own name. While it works, the thread shows "Claude
  is drafting…" with a Stop button, and its cursor moves through the text.

### 5.8 Tables

Tables take their interaction from Google Docs and their tracked changes from Word
([research](research/tables.md)).

- **Hover controls:** a grip for each row and column, and a + on each boundary. Clicking a grip
  selects the row or column; dragging moves it to any position, including the last.
- **Selection:** rectangles of cells, whole rows and whole columns. Delete clears every selected
  cell, and menus count the selection ("Delete 2 rows").
- **Pasting** a spreadsheet range into cells grows the table.
- **Tracked changes look as in Word:** inserted rows and columns tinted, deleted ones shown as
  struck-through ghosts, moves in green. Unlike in Google Docs, a move can be suggested, and new
  empty cells are tinted.
- **Edits to the source are minimal.** A table is never re-padded unless you ask.

### 5.9 Command palette and shortcuts

**The command palette** opens with ⌘⇧P (Ctrl+Shift+P on Windows and Linux): fuzzy search over
every command, with its shortcut, and recent commands first. One command registry serves the
menus, shortcuts, the palette, plugins and agents.

| Action                         | macOS                                                                                         | Windows and Linux         |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------- |
| Command palette                | ⌘⇧P                                                                                           | Ctrl+Shift+P              |
| Switch Editing and Suggesting  | ⌘⇧E                                                                                           | Ctrl+Shift+E              |
| New comment                    | ⌘⌥A                                                                                           | Ctrl+Alt+M                |
| Post a comment                 | ⌘↩                                                                                            | Ctrl+Enter                |
| Next and previous change       | ⌘⌥] and ⌘⌥[                                                                                   | Ctrl+Alt+] and Ctrl+Alt+[ |
| With the review bar or rail in focus | J and K for next and previous, A to accept and go on, X to reject and go on, R to reply, E to resolve, U to undo | the same |

Shortcuts are checked against each platform's text-editing conventions, against Word's, and on
European keyboards, where Ctrl+Alt acts as AltGr.

### 5.10 Paste, copy, import and export

| With            | In                                                                                                                                       | Out                                                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web pages**   | Paste through Redlines' HTML-to-Markdown converter, which passed all 39 checks on 54 real clipboard captures ([research](research/paste.md)) | Copy as HTML                                                                                                                                                                                                                                                                      |
| **Word**        | Paste, with rules for Word's HTML. Import of `.docx` files with tracked changes and comments ([importer](word-export/import.md))         | **Copy for Word:** Word's own HTML, written to the clipboard natively. Headings keep their look and stay headings, through "Redlines Heading" styles based on Word's Heading styles; tables fit the page; fonts match. **Export** of `.docx` with tracked changes, comments, replies, likes and moves; the data needed for a round trip survives a save in Word ([export](word-export/README.md)) |
| **Google Docs** | Paste. Import through `.docx`, in which Google Docs writes its suggestions as tracked changes                                            | Export of `.docx`, which Google Docs opens with suggestions. Converting a Redlines `.md` file into a Google Doc drops every change and comment ([format §9.5](format.md#95-formatters-and-other-editors)). Later, a bridge to Google Docs suggestions through its API                |
| **HTML**        | Paste                                                                                                                                    | Export from the static renderer, of the newest version by default, because hidden markup isn't removed markup                                                                                                                                                                    |
| **PDF**         | —                                                                                                                                        | Print and export through Redlines' paginator: header rows repeat on every page, rows aren't split, and headings stay with what follows. One paper-size setting serves print, PDF and Copy for Word                                                                                |
| **Markdown**    | Any `.md`, `.qmd` or `.Rmd` file                                                                                                         | Clean export (every change accepted), the review view, and Word through the pandoc filter for R Markdown and Quarto                                                                                                                                                              |

- **Paste rules:** a pasted table without a header row gets its first row as the header, because
  GFM tables need one. Images pasted from the web keep their URLs. Lists and paragraphs inside
  pasted table cells are kept. Pasting a URL onto a selection makes it a link, replacing an
  existing link rather than nesting one. ⇧⌘V pastes plain text.
- **A paste never creates marks from the clipboard's content.** Markers in pasted text are
  ordinary text, so a paste can't forge someone else's change. In Suggesting, the pasted text is
  the paster's own insertion.
- **Fonts:** Open Sans and an open-source monospace font are bundled for PDF. Word downloads the
  same fonts from Microsoft's font service, so a PDF and a copy in Word match.

### 5.11 First run (desktop)

The desktop app asks a few questions the first time it starts, one per screen. Every change and
comment needs an author, and Redlines has no accounts.

1. **Who you are:** your name and email, filled in from git (`user.name`, `user.email`) or the
   system account where possible. The name is required. The email is optional but recommended,
   because it recognizes you across machines and in Word. The screen says plainly that your name
   and email are saved in the documents you change, so collaborators see who made each change, and
   that a work or no-reply address is fine.
2. **Your color** for changes, comments and your cursor.
3. **AI, optional.** Redlines looks for Claude Code, Codex and GitHub Copilot on the machine and
   offers: use Claude through Claude Code, sign in with ChatGPT, an API key, a local model, or not
   now (§8.6).
4. **Defaults:** follow the system's light or dark appearance, offer to open `.md` files with
   Redlines, and open a welcome document that shows an edit, a suggestion, a comment and an agent
   at work.

The first run is a plugin (§6.4). In an app that embeds Redlines, the identity comes from that
app's login and there is no first run. Changing your name or email later never rewrites old files;
a new email under the same name becomes an alias in the ledger
([format §5.3](format.md#53-people)).

### 5.12 Feature list

**Must (v1):**

- the command palette (§5.9);
- a folder sidebar, Quick Open and folder search, which folder chat also needs;
- links from pasting a URL onto a selection (§5.10);
- R Markdown and Quarto chunk options kept byte for byte.

**Should (v1 if time allows):**

- a selection toolbar: Comment, Suggest, Ask agent, and formatting;
- a slash menu that opens only at the start of a line or after a space, and can be turned off;
- heading and list folding, per viewer, with a count of hidden changes on a folded heading;
- dragging sections in the outline, and moving blocks with the keyboard, tracked as moves;
- `[[` autocomplete that writes standard links (`[text](file.md#heading)`), which work on GitHub;
- image resizing, alt text and captions; callouts (§5.2); Mermaid editing with a live preview;
- a copy button and a wrap toggle on code blocks;
- citations from the document's bibliography in `.qmd` and `.Rmd`;
- find and replace under tracking: each replacement is a substitution, and one Replace All is one
  group that can be decided at once;
- paste options after a paste: keep formatting, plain text, code, or download the images;
- templates as plain `.md` files with `{{title}}` and `{{date}}`, never executable code;
- focus and typewriter modes.

**Could (later):** scrollbar marks for changes and comments; block handles; previews of linked
files on hover; backlinks, and links that follow a rename (fixed in other files as tracked
changes); link cards; `<details>` toggles; chips for Quarto shortcodes and cross-references; a form
for front matter; merge conflicts shown as tracked changes; reading settings per viewer (width,
text size, dark page).

**Not in v1:** anything other tools couldn't show (columns, @mentions and dates in body text,
wiki-link storage, stored embeds, text color); a notification service of our own (apps such as
Syrus and GitHub notify); paragraph locking.

## 6. Architecture

### 6.1 Principles

- **One text, many surfaces.** The Markdown string, markers and ledger included, is the only
  source of truth. Everything else is derived from it.
- **A small core, and plugins for the rest.** The core is what every host needs to open, edit,
  review and save a Redlines file correctly. Everything else is a plugin, written against the same
  API that outside developers will use. The test: if turning a feature off could damage a file or
  hide a change, it belongs in the core.
- **Hosts supply capabilities.** The editor runs in several hosts: the desktop app, a web app that
  embeds the React component, a VS Code webview. Each host supplies what only it can, such as file
  access, the native clipboard, printing, agent processes and the user's identity. Plugins declare
  the capabilities they need, and a host that lacks one doesn't offer that plugin.

### 6.2 Layers

| Layer          | What                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Hosts          | The desktop app (Tauri), the React component in a web app, the VS Code extension, Syrus                 |
| Plugins        | Review UI, tables, Word, print, AI, git, live sessions, first run, themes and others (§6.4)             |
| Editor core    | `@redlines/editor`: display, editing, tracked changes, views, modes, commands, settings, theme tokens, the plugin host |
| Format library | `@redlines/format`: parse, serialize, marks, ledger, history, views, decisions and agent operations     |

The command line, the MCP server and the collaboration server use the format library directly,
without the editor.

### 6.3 Packages

| Package                | Contents                                                                                                                                   | Runs in                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `@redlines/format`     | Parsing and serializing in each dialect; marks, ledger and history; views; accept and reject; the agent operations (§8.3); the conformance fixtures | Anywhere (no DOM, no Node APIs) |
| `@redlines/editor`     | The editor core on CodeMirror 6: Markdown display, the tracked-change layer, the Clean, Redlines and Raw views, modes, undo, find, the command registry, settings, theme tokens and the plugin host | Browsers and webviews |
| `@redlines/plugin-api` | The plugin interface: manifest, contributions, capabilities. Versioned on its own and kept stable                                         | —                       |
| `@redlines/react`      | `<RedlinesEditor>` for React, and a `<redlines-editor>` web component for other frameworks                                                 | Browsers                |
| `@redlines/render`     | Static HTML rendering and pagination, for print, PDF, HTML export and previews                                                              | Browsers, Node          |
| `@redlines/clipboard`  | HTML-to-Markdown conversion for paste, and the copy formats: Redlines' own, Word's HTML, generic HTML, Markdown, plain text                 | Browsers                |
| `@redlines/docx`       | Word import and export                                                                                                                     | Browsers, Node          |
| `@redlines/collab`     | The collaboration server and its client protocol                                                                                           | Node; client in browsers |
| `@redlines/mcp`        | The MCP server, for agents outside Redlines                                                                                                | Node                    |
| `redlines`             | The command line: views, accept and reject, lint, export, merge driver, compaction, repair                                                 | Node                    |
| `apps/desktop`         | The desktop app: a Tauri v2 shell, in Rust, around the editor                                                                               | macOS, Windows, Linux   |
| `plugins/*`            | The first-party plugins (§6.4)                                                                                                             | Wherever the editor runs |
| `integrations/*`       | VS Code and Positron, Claude Code, Codex, Syrus, the GitHub Action and the pandoc filter; later Obsidian and Jupyter (§9)                  | Their hosts             |

The desktop app includes the command line and the MCP server as a self-contained executable, so
agents can use them on machines without Node.

### 6.4 Plugins

**The core** (`@redlines/editor`) holds:

- display and editing of all the Markdown in §5.2; code, math and diagrams appear as formatted
  source until their plugins render them;
- the tracked-change layer: showing marks, editing in Suggesting, accepting and rejecting, the
  views and the modes;
- comment anchors and the ledger;
- undo, find and replace, and the platform's spellcheck;
- the command registry and palette, shortcuts, settings, theme tokens (§6.6) and the plugin host.

**First-party plugins** ship with the app, use the public API, and can each be turned off:

| Plugin       | Adds                                                                         | Needs from the host        |
| ------------ | ---------------------------------------------------------------------------- | -------------------------- |
| `review`     | The review bar, change cards, the comment rail and the Changes tab           | —                          |
| `tables`     | Table editing: grips, selection, moves, pasting ranges                       | —                          |
| `math`       | Rendered math                                                                | —                          |
| `diagrams`   | Rendered Mermaid diagrams                                                    | —                          |
| `code`       | Syntax highlighting in code blocks                                           | —                          |
| `paste`      | The paste pipeline and paste options                                         | Clipboard                  |
| `word`       | Copy for Word, and `.docx` import and export                                 | Clipboard, files           |
| `print`      | Print and PDF export through the paginator                                   | Printing                   |
| `export`     | HTML, clean Markdown and review-view export                                  | Files                      |
| `outline`    | The outline panel and dragging sections                                      | —                          |
| `workspace`  | The folder sidebar, Quick Open and folder search                             | Files                      |
| `git`        | Optional git features (§7.4)                                                 | Files, git                 |
| `collab`     | Live sessions: presence, cursors and invitations (§7.1, §7.2)                | Network                    |
| `ai`         | The chat panel, Ask agent, agents in comment threads, agent levels (§8)      | Agents                     |
| `onboarding` | The first run (§5.11)                                                        | Identity                   |
| `themes`     | The built-in themes, and themes that follow a host's styles (§6.6)           | —                          |

Where the desktop app's own features live:

- **Printing and PDF** are the `print` plugin, built on `@redlines/render`. The host supplies the
  printing capability: the desktop app prints and writes PDF files through its webview (WebKit on
  macOS, WebView2 on Windows, WebKitGTK on Linux), and a browser host uses the browser's print.
- **The first run** is the `onboarding` plugin, which only the desktop app turns on.
- **The AI chat panel** is the `ai` plugin. Running agents is a host capability: the desktop app
  runs them as local processes (§8.6), Syrus runs them on its server, and a web app offers them
  only if it supplies its own.
- **Styling** is split: the token system is core, and themes are plugins (§6.6).

**What a plugin can add:**

- commands, with menu and context-menu items, shortcuts and palette entries;
- Markdown syntax: parsing, display, writing, and how tracked changes apply to it;
- renderers for fenced code blocks, such as Mermaid, PlantUML or Vega;
- panels, sidebar views, status-bar items and settings pages;
- importers, exporters and paste handlers;
- themes;
- tools for agents: any MCP server becomes tools the agents can use (§8).

**What a plugin can't do:** change the file format. A plugin can't add hidden data to files, new
kinds of marks, or sidecar files, so a file stays readable without the plugin.

**Isolation, in two tiers.** Plugins that add commands, panels, import and export, or agent tools
run in a separate worker and declare what they need: reading the document, editing it, network,
files. Plugins that change how the editor draws (syntax, renderers) run inside the editor and need
the user's explicit trust. Documents can hold contracts and personal data, so a plugin's reach
should be visible and limited.

**Distribution.** First-party plugins ship with the app. The public API opens in v1.x, once it has
carried the first-party plugins without changes; a registry for community plugins comes after
that. The desktop app, the React component and the VS Code extension load the same plugins.

### 6.5 Hosts and capabilities

| Capability | Desktop app                                         | React component in a web app         | VS Code extension         |
| ---------- | --------------------------------------------------- | ------------------------------------ | ------------------------- |
| Files      | The file system                                     | Callbacks the app provides           | The workspace             |
| Clipboard  | Native, including Word's HTML flavor                | The browser's clipboard              | The webview's clipboard   |
| Printing   | Native print and PDF                                | The browser's print                  | —                         |
| Agents     | Local processes and API keys (§8.6)                 | Whatever the app provides, or none   | —                         |
| Identity   | The first run (§5.11)                               | The app's login                      | Git's `user.name` and `user.email` |
| Network    | Allowed per plugin                                  | The app's policy                     | VS Code's policy          |

### 6.6 Styling

Everything Redlines draws, the document and the interface, takes its look from design tokens: CSS
custom properties for fonts, sizes, spacing, colors, radii and the colors of authors. The core
defines the tokens and styles everything through them. A theme is a set of token values, plus
optional CSS for document elements.

- **Built-in themes:** light and dark, following the system.
- **Embedded editors look native.** The embedding app passes token values, or a theme maps the
  app's own variables, such as a VS Code color theme or a Tailwind configuration, onto Redlines'
  tokens. The same editor then looks like part of Syrus, VS Code or any other app.
- **Print, PDF and Copy for Word use the same tokens,** so they match the screen.

## 7. Collaboration

### 7.1 Live sessions

- **The text is the only source of truth,** the ledger included. Positions are never stored
  outside the text. Presence and view state travel on a separate channel.
- **Live editing** uses `@codemirror/collab` with a central authority that orders edits.
  - Clients keep their own edits and re-derive the tracked form after a rebase. Each push
    declares a footprint, the ranges it changes and the text its result depends on, and the
    authority rejects a stale push whose footprint touches a newer change.
  - In simulations with every kind of change, this cut markup corruption from 15–84% of sessions
    to 0–0.4% ([research](research/collaboration.md)).
  - Undo is semantic: it rejects your own mark rather than inverting text.
  - Accept and reject carry a guard. Without it, 15–17% of simulated review sessions lost text.
    It turns away 1–8% of review commands, when someone changed the mark first, and says so.
  - A write-ahead log protects against crashes.
- **Presence:**
  - avatars in each person's color, which is also the color of their changes and cursor. Clicking
    one offers Go to cursor and Show their changes, and later Follow;
  - named cursors, and "Bo is replying…" on threads;
  - a badge on each avatar for the person's mode (Editing, Suggesting, Viewing);
  - agents with an agent badge, and their cursor while they work.

  Who looked at what is never stored in the file.

### 7.2 Inviting people

A live session needs an authority that every participant can reach. From the desktop app, there
are three ways to work together:

1. **On the same network, or over a private network such as Tailscale,** the inviting app runs
   the authority itself and shares a link. Guests join directly, with no server and no account.
   The session ends when the host closes the document.
2. **Across networks,** a session needs a server: a self-hosted `@redlines/collab` server (one
   small Node service that a team can run anywhere), or an app that hosts sessions, such as
   Syrus. The desktop app connects to it by its address.
3. **Without a live session,** people send the file, or share it through git or a shared folder.
   Changes and comments travel inside the file, and Compare (§5.6) shows what changed in a copy
   that comes back.

A private network such as Tailscale is one option, not a requirement. Whether the project should
run a public relay, so invitations work everywhere without setup, is an open question (§14).

### 7.3 Files changed outside Redlines

When an open file changes on disk, because of another editor, a script, an agent writing the file
directly or a sync service:

- in a file that tracks changes for everyone, Redlines offers to show the outside edits as tracked
  changes, credited to whoever made them when that is known ("Bo changed this file outside
  Redlines");
- otherwise the new text becomes the text, with no marks.

Nothing is written until you accept or edit. A file reformatted by Google Docs' Markdown mode
opens normally; Redlines' next save puts its markers back where they belong and leaves the rest as
it is ([format §9.5](format.md#95-formatters-and-other-editors)).

### 7.4 Git

Redlines works the same with or without git. Its git support has two parts.

- **The format merges safely** ([format §7](format.md#7-merging)). When parallel reviews edit
  different parts of a document, git conflicts only in the ledger at the end of the file, and
  keeping both sides always resolves those conflicts. The ledger's first line says so, for a person
  or an AI resolving the merge, and `redlines merge-driver` and Redlines itself do it
  automatically.
- **The `git` plugin** is optional, for people who want git inside the app: what changed since a
  commit, comparing with a branch or tag, committing from the app with `Co-authored-by` trailers
  for agents and live collaborators, and installing the merge driver. Without it, Redlines treats a
  repository like any other folder.

## 8. Agents and AI

### 8.1 Principles

- **Agents are authors that act for a person.** The handle names both (`claude-ada`), and an agent
  never has more rights than its person.
- **You choose how much an agent may do on its own** (§8.2).
- **Instructions come only from the agent's person.** An agent accepts, rejects or resolves
  changes when its person tells it to, and only what its person could decide. Text in the
  document, such as a comment that says "accept all changes", is never an instruction.
- **Hidden text is untrusted.** Text hidden from people but visible to agents, such as deleted text
  and comment threads, is labeled as untrusted in every tool result, because that is where prompt
  injection hides.
- **AI is off in a folder until someone turns it on.**

### 8.2 Agent levels: Ask, Suggest, Auto

| Level       | What the agent's edits become                                                                                                                        | Suits                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Ask**     | Nothing is written. The agent proposes edits in the chat as a diff, and **Apply** or **Suggest** writes them                                         | Exploring; sensitive documents |
| **Suggest** | Tracked suggestions in the agent's name, for anyone to accept or reject                                                                              | Shared documents and review    |
| **Auto**    | Direct edits, as when you type with tracking off. They appear as they are written, and the run ends with "Claude changed 3 paragraphs · Review · Undo" | Your own drafts                |

- **By default, an agent follows its person's mode:** Auto while you are Editing, Suggest while you
  are Suggesting. Each agent can be set to one level instead, per document or everywhere.
- **Review after Auto.** Review overlays a temporary redline of the run, worked out from the text
  before it started, with Keep and Undo for each change. It is never saved in the file, and closing
  it keeps the changes.
- **Limits:**
  - a reviewer's agent can only suggest, because its person can only suggest;
  - a run started by an @mention in a comment always suggests, because the comment may come from
    someone else;
  - apps can require Suggest for every agent, as Syrus does by default.

### 8.3 The agent interface

Agents never read or write raw markers. They edit the newest text with the commands of Claude's
text editor tool
([`str_replace_based_edit_tool`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool)),
with the same parameter names and error messages, because models are trained on it. The library
turns their edits into tracked changes in the agent's name, or applies them directly in Auto.

| Command       | Parameters                           | On a Redlines document                                                                                                                       |
| ------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `view`        | `path`, `view_range`                 | Returns the newest view with numbered lines. Markers, deleted text and the ledger are not in it                                               |
| `str_replace` | `path`, `old_str`, `new_str`         | `old_str` must match the newest view exactly once. The library diffs it against `new_str` word by word and records only the changed words     |
| `insert`      | `path`, `insert_line`, `insert_text` | Inserts after a line of the newest view. Refused if the document changed since the agent's last `view`, because line numbers may have moved    |
| `create`      | `path`, `file_text`                  | Creates a new document. Refused for an existing one, whose edits must be tracked                                                              |

- **Results and errors** use the tool's own wording ("No match found for replacement", "Found 3
  matches for replacement text…"), so agents recover the way they were trained to. A success also
  lists the new mark ids.
- **`str_replace` is the main command.** It finds text by content, not position, so it stays
  correct while other people type.
- **Batches** apply several edits atomically: if one fails, none is applied.
- **Reading who changed what:** `review/plan.md` is the review view of `plan.md`
  ([format §8](format.md#8-views)), and `original/plan.md` its original. Both are read-only.
- **Comments and review:** `comment(path, quote, text)`, where `quote` must match the newest view
  exactly once; `comment(path, mark, text)` to explain one of the agent's own changes; `reply`,
  `like`, `resolve` and `reopen`; `accept` and `reject` by mark, author or group, when the person
  asks and is allowed to; and `changes_since(path, version)`.
- **Agents that write the file directly,** with their own editing tools or a script, bypass all of
  this. Their changes arrive as a new version of the file, which Redlines turns into tracked
  changes by the agent (§7.3), flagging any damaged markers.

**Surfaces:** the MCP server and the `redlines` command line; @mentions in comment threads; the
chat panel; and Ask agent on a selection.

**Agent runs.** Each request, a chat turn or a mention, is one run, and its marks share a `group`.

- The thread or chat shows "6 suggestions · Accept all · Reject all · Show", and an Agents chip
  filters all agent work.
- Marks are word by word, so a reviewer can accept part of a rewrite.
- If someone edits the text under a pending suggestion, its marks stay valid, and the thread says
  "Text changed since this suggestion".
- Each edit can carry its reason in the mark's `note`.

### 8.4 Watching an agent work

Agent edits are animated, like a streaming chat answer.

- **The agent's cursor,** with its badge, moves to where it is about to edit. If that place is off
  screen, a marker says "Claude is editing below ↓" instead of scrolling you away; Follow takes you
  along.
- **Deleted words are struck through one by one, then the new text streams in** at the speed the
  model writes it. In Suggest, it is underlined in the agent's color; in Auto, it is plain, with a
  highlight that fades after a few seconds.
- **An edit is a preview until it is complete.** Stop removes the unfinished edit and keeps the
  finished ones.
- **Collaborators see the same animation** through the presence channel. The authority receives
  each edit only when it is complete, as one change.
- **Where a provider doesn't stream an edit's text,** the finished edit plays back at reading
  speed. Long runs speed up, and Reduce Motion or a setting shows results without animation.

### 8.5 Chat

- **A chat panel** next to the comment rail. Its scope is the selection, the document, or the
  folder (a project or repository).
- **Answers cite the text,** with links to ranges in the document. Chat never shows raw markers.
- **Edits follow the agent's level** (§8.2). In Ask, the panel shows each proposal as a diff with
  Apply and Suggest. A chat answer can also be posted to the document as a comment thread.
- **Ask agent** on a selection (fix, shorten, rephrase) works without opening the panel.
- **Folder chat** works the way coding agents work: the agent lists, searches and reads the files
  in the folder rather than relying on a search index. It skips what `.gitignore` excludes, and it
  reads the folder's `AGENTS.md` and `README.md` first, when they exist, for instructions and
  context. Requests that span documents ("update every doc that mentions the importer") produce
  edits in each file, each file its own run.
- **Chat history** is kept by the app, not in the document.

### 8.6 AI engines and sign-in

The desktop app runs agents through several drivers, so people can use the subscriptions they
already have ([research](research/ai-providers.md)).

- **Claude:** Redlines runs the user's own Claude Code, signed in through Claude Code itself, as
  Anthropic's terms allow. Redlines never handles Claude's tokens, and the feature is called
  "Claude Agent".
- **ChatGPT:** Sign in with ChatGPT, with Redlines' own agent loop.
- **Other agents,** such as GitHub Copilot, Gemini and OpenCode, through the Agent Client Protocol.
  The GitHub Copilot SDK offers several models on one subscription.
- **API keys and local models:** Anthropic and OpenAI keys, AWS Bedrock, Google Vertex, Azure,
  OpenRouter, Ollama and LM Studio.

Whatever the engine, edits go through Redlines' tools, so they follow §8.2. Syrus runs agents on
its server with API keys or enterprise agreements.

**Privacy:**

- AI is off in a folder until someone turns it on, and the panel shows what will be sent.
- Redlines asks before running an agent in a folder it hasn't trusted, because Claude Code's
  headless mode runs a folder's own hooks.

## 9. Integrations

| Integration                         | What it is                                                                                                                                                                                         | Phase                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **VS Code and Positron**            | One extension on Open VSX, which also covers Cursor. First, tracked-change decorations in the normal editor; then a custom editor that hosts the Redlines editor                                  | v1.x                              |
| **Claude**                          | The command line and MCP server; a skill; a Claude Code plugin whose hooks block raw marker edits and turn Claude's ordinary edits into tracked changes ([research](research/llm-hosts.md))        | v1 (server, skill), v1.x (plugin) |
| **Codex and ChatGPT**               | The same MCP server, skill and plugin folder, plus an `AGENTS.md` snippet                                                                                                                          | v1.x                              |
| **Other agents**                    | GitHub Copilot, Gemini, OpenCode and others through the Agent Client Protocol                                                                                                                       | v1.x                              |
| **Review in chat apps**             | A remote MCP server whose review panel (MCP Apps) draws tracked changes inside claude.ai and ChatGPT, with Accept and Reject                                                                       | Later                             |
| **Syrus**                           | A replacement for Syrus's Design Docs plugin (§9.1)                                                                                                                                                 | v1.x                              |
| **GitHub**                          | An Action that posts the review view of changed Redlines files on pull requests. Later, it could also resolve ledger conflicts on pull requests, which GitHub's merge button can't                  | v1.x                              |
| **Jupyter**                         | Notebooks paired with Markdown through Jupytext can be reviewed as text today. Later, a JupyterLab extension, which also runs on CodeMirror 6                                                       | Later                             |
| **Obsidian**                        | A plugin that brings tracked changes and comments into Obsidian, which is built on CodeMirror 6                                                                                                     | Later                             |
| **Google Docs**                     | A bridge between tracked changes and Google Docs suggestions through its API                                                                                                                       | Later                             |
| **Citations**                       | Zotero and BibTeX for pandoc citations (`[@key]`), for scientific manuscripts                                                                                                                       | To decide                         |

### 9.1 Syrus

[Syrus](https://github.com/tkadauke/syrus) is an open-source, self-hosted software factory that
turns issues and chats into agent-authored pull requests. Its **Design Docs** plugin stores
Markdown in a database, keeps comments and suggestions as database rows anchored by hidden HTML
comments, lets owners edit directly while others and agents suggest, and offers MCP tools such as
`read_design_doc` and `suggest_design_doc_change`.

Redlines provides a replacement plugin, developed in this repository, that keeps the same
contract (the `DOC-<id>` slug, pages, routes, MCP tool names, events, search and permissions) and
adds:

- the Redlines editor with live, multi-cursor collaboration;
- git as the store, with the database keeping permissions, metadata and search indexes;
- the stock tools backed by Redlines' agent operations, plus new ones: batch edits, accept and
  reject, section navigation;
- an `@syrus` mention that joins the live session right away: the thread shows "drafting…", and
  its suggestions appear as tracked changes;
- a viewer for Redlines files anywhere in a repository, and a migration from the stock plugin.

It needs two things from Syrus: a way for one plugin to declare that it replaces another, and a
supported way to bring an external plugin's frontend into the Syrus build. The authority and the
format operations run as a small Node service next to Syrus's Ruby backend.

## 10. Platforms

- **Desktop: Tauri v2** on macOS (the system's WebKit), Windows (WebView2, which is Chromium) and
  Linux (WebKitGTK), with an Electron build in reserve for Linux if the prototype needs it. Tauri
  keeps the download small, and on the Mac the system WebKit gives text editing the platform's own
  services: autocorrect, text replacements, smart quotes and dictation.
- **Web:** the embeddable component, tested in Chromium, WebKit and Firefox.
- **Mobile:** iOS is undecided. Editing by touch would need its own work.

## 11. Security and privacy

- **Hidden is not removed.** Renderers that pass HTML through publish deleted text and comment
  threads in the page source ([format §9.6](format.md#96-hidden-is-not-removed)). HTML and PDF
  export use the newest version by default.
- **Prompt injection:**
  - payloads and the ledger are untrusted input for agents;
  - agents take instructions only from their person (§8.1);
  - runs started from comments always suggest (§8.2);
  - mentions are honored only from known collaborators;
  - `redlines lint` flags invisible characters and instruction-like text.
- **A paste never forges marks,** and the clipboard's own comments are always dropped.
- **Per-person state stays out of the file:** view, mode, filters, comment drafts, folds, the last
  version each person saw, and presence.
- **MCP servers and hooks run outside the host apps' sandboxes,** so Redlines' MCP server confines
  its writes to the workspace.
- **AI is opt-in,** with a choice of provider and a local option, and Redlines never reads or
  reuses anyone's sign-in tokens (§8.6).

## 12. Open source

- **License:** MIT.
- **Prior art:** other products are studied only through their behavior and public
  documentation, never by reverse engineering.
- **Name:** Redlines, at redlines.md. The npm packages are `redlines` and `@redlines/*`, and the R
  package is `redlines` on CRAN.
- **Website:** a static site in `website/`, at [skadauke.github.io/redlines](https://skadauke.github.io/redlines/)
  until the domain is set up. A workflow builds it and deploys it to GitHub Pages: by hand for now,
  and on every release once the app ships.

## 13. Milestones

| Milestone | Deliverable                                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0**    | This spec, the format spec, the license and the website                                                                                                                             |
| **M1**    | `@redlines/format` with the conformance fixtures, the `redlines` command line and the MCP server. Agents in Claude Code and Codex can then work on Redlines files                     |
| **M2**    | The editor core on CodeMirror 6, tested on long documents, tables, keystrokes, input methods, the caret and macOS text services, and the `tables` plugin                               |
| **M3**    | The desktop app, alpha: files, tracked changes with the review bar, comments, the Must features (§5.12), paste, Copy for Word, Word export and import, PDF; the React component       |
| **M4**    | Live sessions with presence; the Syrus plugin, the Claude Code plugin, the VS Code extension and the GitHub Action; the `git` plugin                                                 |
| **M5**    | The chat panel; then review in chat apps, the Google Docs bridge, Obsidian and Jupyter                                                                                              |

## 14. Open questions

1. **Modes and agent levels** (§5.4, §8.2): Word's and Google Docs' model for people, and Ask,
   Suggest or Auto for agents, following their person by default.
2. **AI engines** (§8.6), to confirm with the vendors before release:
   - whether an open-source publisher must accept Anthropic's Commercial Terms, and whether its
     legal page supersedes the Agent SDK's note against third-party claude.ai sign-in;
   - when `--bare` becomes the default for `claude -p`, which would end subscription use through
     it;
   - which ChatGPT plans qualify for Sign in with ChatGPT.
3. **Plugin boundaries** (§6.4): whether the review UI and tables belong in the core instead.
4. **Live sessions across networks** (§7.2): a public relay run by the project, or self-hosted
   servers only.
5. **The format's open questions** are in [format §13](format.md#13-open-questions).
