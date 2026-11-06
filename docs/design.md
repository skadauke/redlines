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
- **A calm screen.** One document and little else. The comment rail appears only when a document
  has comments, and the review bar only when you ask for it (§5.6).
- **Color means a person.** Text and controls are grays; color shows who changed or commented on
  what (§6.6).

The window, on the desktop:

- **The title bar is the page:** the same color, with no line under it, and the file name centered
  in small gray type. There is no toolbar and no status bar.
- **One document per window.** New always opens a new window. Open uses the window it was chosen in
  while that holds only an untouched Untitled document, and otherwise opens a new one, as a file
  from Finder does. The file sidebar lists the document's project, its repository or else its own
  folder, opened down to the document, leaving out hidden files and what `.gitignore` ignores.
  Choosing a Markdown file opens it in the same window, and ⌘-click opens it in a new one, as does
  a click while an agent is working in the window. Other text files open the same way in a
  read-only viewer, with line numbers and syntax colors (§6.4); images and PDFs open in their
  default app. macOS window tabs work as usual, and the menu bar is the front window's.
- **Quitting never loses work.** However the app is asked to quit (the menu, the Dock, logging out)
  or to restart for an update, each window with unsaved edits comes forward in turn and asks whether
  to save them. Cancel stops there and keeps every window open. Closing the last window quits.
- **File menu.** New, Open, Open Recent (the last ten files), Save, Save As, Rename (the file name
  in the title bar becomes a field), Reveal in Finder, Close and Print. Printing holds the whole
  document in light ink, whatever the window shows.
- **Find.** ⌘F opens a bar at the top of the page that searches the text a reader sees, never the
  markers or the ledger. Edit also holds Find Next (⌘G), Find Previous (⇧⌘G), Find and Replace
  (⌥⌘F) and Use Selection for Find (⌘E). Replacing is an edit like typing, so with Track Changes
  on it is recorded as a substitution.
- **Text size.** View › Larger Text (⌘=), Smaller Text (⌘-) and Actual Size (⇧⌘0), and a pinch,
  walk one ladder of sizes, from 80% to 200% of the theme's own. It sets the document's size and
  its margin notes', not the title bar's.
- **Preferences** (⌘,) is its own window with four panes: General (your name and handle, what
  opens at launch, automatic updates, the Dock icon, and installing the `redlines` command line),
  Appearance (the light and dark themes, and text size), Editor (spell check, smart quotes and
  dashes, closing brackets, and whether Track Changes starts on) and Agents (§8.6). Changes apply
  at once.
- **Three icons.** Next to the window buttons, Files shows and hides the file sidebar, which is
  hidden by default (⌃⌘S, the Mac's Show Sidebar shortcut). At the right, View (an eye) sets the
  view (§5.3), and Review (a pen) holds Track Changes and Review Changes (§5.4, §5.6).
- **Icons without labels, explained on hover.** Hovering over an icon shows its name and shortcut,
  or opens its menu straight away, with each item's shortcut. Clicking opens the menu too, for the
  keyboard and touch.
- **No number badges.** Counts appear where you look for them, such as "Change 3 of 17" on the
  review bar.
- **Details on hover.** The times and other details of changes and comments appear when you hover
  over or select them, not at rest.
- **The Mac comes first.** On Windows and Linux the alpha keeps the platform's own title bar and
  menu bar, with the three icons at the top of the page.
- **An icon that changes.** Redlines is installed with a red caret on warm paper as its icon, the
  mark that says where text goes. While it runs, its Dock icon shows another mark of the same
  family (a change bar, a margin bracket, a delete mark, a red line, or the caret with an
  insertion above it), a different one at each launch. Turning off Redlines › Preferences › General
  › Rotate the Dock Icon keeps the caret.
- **Updates never interrupt.** The app checks for a new release soon after it starts and every few
  hours, and downloads it in the background, once however many windows are open; offline, it says
  nothing and tries again later. When the update is ready, a small card in the lower-right corner
  of each window offers Restart to update, which reopens the documents in the new version, or
  Later, which puts the card away in every window. There is no dialog. Redlines ›
  Check for Updates… checks at once, and Redlines › Preferences › General › Check for updates
  automatically turns the checks off. The version and build are in About Redlines, and nowhere else in the
  window.

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

The View menu, under the eye at the top right (§5.1), sets how the document is shown:

- **Clean:** the document as it reads with every pending change accepted, without markup (Word's
  No Markup).
- **Redlines:** the document with its tracked changes and comments (Word's All Markup). It is always
  there, with its shortcut, whatever the document holds and whether Track Changes is on or off, so
  the View menu always offers the same three views. A document without redlines looks nearly the
  same as in Clean.
- **Raw:** the Markdown source, markers and ledger included, with syntax highlighting. It is the
  same editor with its decorations turned off.

A document with redlines (pending changes, highlights or comment threads) opens in Redlines; one
without opens in Clean. Making a tracked change in Clean switches the view to Redlines, so
suggestions are never invisible to their author. Otherwise the view stays as you chose it: deciding
the last change doesn't switch it. The view is each person's own and is never saved in the file. The
View menu also previews the original (every change rejected) and one person's changes alone
(everyone else's rejected). The previews are read-only. Raw can be edited while Track Changes is
off; while it is on, or locked on, Raw is read-only, because typing there could forge or break
markers.

### 5.4 Track Changes

Whether your edits are tracked is the one setting that matters while you write, and Redlines
follows Word: Track Changes is on or off. Google Docs calls the same state Suggesting; its Viewing
mode has no counterpart in the desktop app.

- **The pen shows it.** The Review icon at the top right is a red pen with an underline while your
  changes are tracked, and a gray pen while they aren't. Red is the app's own color, and your own
  too: the first author color (§5.5, §6.6). Hovering over the pen opens the Review menu, whose first
  item switches Track Changes (⌘⇧E, as in Word).
- **Every switch shows a short notice.** Word's mode switcher turns tracking off without one, which
  its users complain about.
- **Your setting is yours,** like Word's "Just Mine" tracking. It isn't saved in the file, so using
  Redlines without tracking imposes nothing on anyone. A file opens with tracking off unless it
  asks for tracking.
- **Track changes for everyone,** like Word's "For Everyone", is a setting of the file
  (`tracking: everyone`, [format §5.6](format.md#56-settings)). Everyone who opens such a file
  starts with Track Changes on, under a notice that says so. Without an app that enforces roles,
  anyone can still turn it off; the notice makes that a deliberate choice.
- **Roles,** where the embedding app enforces them (Syrus, for example): the owner can turn
  tracking off, other editors have it locked on, and commenters can only comment. Hovering over a
  locked pen says why.
- **Agents** follow the setting of the person they act for, unless set otherwise (§8.2).

### 5.5 Showing tracked changes

- **Word's vocabulary, in a color per author:** insertions underlined, deletions struck through,
  highlights tinted, and comments in a rail. As in Word, the changed text itself takes the
  author's color.
- **Author colors.** Yours is the first of the palette's eight: red, the app's own color and the
  Track Changes pen's (§6.6), so your insertions look like redlines, not like links. You can pick
  another at the first run (§5.11). Other people get colors on your machine, in order of appearance,
  and keep them across documents. In a live session, each person keeps the color they picked unless
  someone already shown has it. Within one document no two people share a color while there are
  seven or fewer others: if the record gives two of them one color (possible past seven people on
  the machine), the later-met takes the next free color in that document only. Agents get colors of
  their own, with an agent badge. An unknown author is gray, and past the palette's eight colors,
  colors repeat.
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

- **The review bar** opens when you ask for it, with Review Changes in the Review menu or the
  next-change shortcut (⌘⌥]). It floats at the bottom of the window and closes with Esc or its
  close button; without it, a change's card still accepts or rejects that change. It holds:
  - "Change 3 of 17", with previous and next, through changes and comments in document order,
    with a switch for either alone. A suggestion is one change: the marks of one agent edit (they
    share a `group`, an author and a `note`, [format §6](format.md#6-history) `group`) are counted
    once, and Accept and Reject decide them all in one step, or none if one is refused;
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
- **The rail** is the page's right margin, not a sidebar. Each thread is a note level with its
  anchor, with a thin border and no shadow or fill. At rest a note shows who wrote it and what
  they wrote; times and actions (Reply, Resolve, Accept, Reject) appear on hover or when the note
  is selected. Selecting a note or its anchor draws the note's border in its author's color and
  darkens the anchor's tint, as in Word, without connector lines.
  - The rail holds comment threads, plus changes that have their author's note. Other changes
    stay inline behind their cards. An agent's edit that is several marks (an edit compared word
    by word, `str_replace`) is one suggestion and has one note, level with its first mark: the
    byline once, the note once, and the changes in order, separated by " · " and clipped to a few
    lines. Selecting the note or any of its marks selects the whole suggestion, and its Accept and
    Reject, like the hover card's of any of its marks, decide every mark in one Undo step, or none
    if one can't be decided. The `redlines str-replace` command gives the marks of one call a
    group, so that the skill route shows the same.
  - The rail shows only in the Redlines view. Adding a comment in Clean switches to Redlines, as
    a tracked change does.
  - When the rail shows, the text column moves left, so that column and rail together stay
    centered. In a narrow window, below about 1,000 px, the rail shrinks to icons.
  - A **Changes** tab lists every change by section, with counts, like Word's Reviewing pane.
  - Density: expanded, icons only, hidden, or a full panel, which stays put while the text
    scrolls. The Changes tab and the density are in the Review menu; filters and search sit at the
    top of the full panel.
  - Resolved threads are hidden until asked for: Show Resolved Comments is a check-marked item in
    the Review menu (and in the title bar's Review menu), kept in the person's settings. Their notes
    sit at their anchors, drawn in the theme's grays only, never an author's color, with "Resolved
    by" and the time and a Reopen action in place of Resolve; where a resolved and an open note
    compete for a place, the open one keeps it. A resolved note with a reply being written stays
    shown until that text is posted or cleared.
  - Filters: open, resolved, for you, assigned to me, people and agents, and search. Unread threads
    get a dot.
- **Drafts.** A comment is private until it is posted with ⌘↩, as in Word. Several drafts can be
  open at once, and they survive a reload.
- **Typing `@`** in a comment opens a picker of collaborators and agents. Mentioning a person
  offers "Assign to".
- **Mentioning an agent** asks it to act on the thread. It replies in the thread, suggests tracked
  changes, or both, in its own name (`claude-ada`, with "Claude" as its name, for the person it
  works for). What it can do, and how it is run, is in §8.
  - **The picker** lists the agents found on this Mac first, then the people in the document's
    ledger, leaving out you and `unknown`. Picking one writes a plain `@Claude` or `@bo` in the
    comment, which changes nothing in the file's format.
  - **Only posting starts a run.** A run starts when a comment that names an agent is posted in
    this app's comment box, and never from text read out of a file, so a mention that arrives by
    reload, paste or git starts nothing. Naming a person sends nothing either: Redlines has no
    backend, and they see it when they open the file.
  - **The live line.** While it works, one quiet gray line sits at the foot of the thread: the
    agent's dot, its name and what it is doing now ("Reading importer.ts"), with Stop on hover. The
    first time an agent runs in a folder, the line asks "Let Claude read this folder?", with
    buttons Allow, Just this document and Not now. A failure is that line too, in one
    sentence. The line is about right now: it is never written to the file and goes when the
    document closes.
  - **The reply is short.** A reply is at most 200 characters, with no blank line, and a longer
    message (at most 2,000) follows it in the same comment, folded behind a quiet More. A file
    named in a reply, such as `importer.ts:42`, is a link that opens that file, at that line,
    when it is inside the document's project.
  - **Its edits are tracked changes** in its color, each with a short note, and the person
    accepts or rejects them like anyone's. An agent never accepts, rejects or resolves.

### 5.8 Tables

Tables take their interaction from Google Docs and their tracked changes from Word
([research](research/tables.md)).

- **Hover controls:** a grip for each row and column, and a + on each boundary. Clicking a grip
  selects the row or column; dragging moves it to any position, including the last.
- **Selection:** rectangles of cells, whole rows and whole columns. Delete clears every selected
  cell, and menus count the selection ("Delete 2 rows").
- **Pasting** a spreadsheet range into cells grows the table.
- **Tracked changes look as in Word:** inserted rows and columns tinted, deleted ones shown as
  struck-through ghosts, and moves with Word's double underline and double strikethrough. Word
  draws moves in green; Redlines draws them in the author's color, because color means a person
  (§6.6). Unlike in Google Docs, a move can be suggested, and new empty cells are tinted.
- **Edits to the source are minimal.** A table is never re-padded unless you ask.

### 5.9 Command palette and shortcuts

**The command palette** opens with ⌘⇧P (Ctrl+Shift+P on Windows and Linux): fuzzy search over
every command, with its shortcut, and recent commands first. One command registry serves the
menus, shortcuts, the palette, plugins and agents.

| Action                         | macOS                                                                                         | Windows and Linux         |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------- |
| Command palette                | ⌘⇧P                                                                                           | Ctrl+Shift+P              |
| Track Changes on or off        | ⌘⇧E                                                                                           | Ctrl+Shift+E              |
| New comment                    | ⌘⌥M                                                                                           | Ctrl+Alt+M                |
| Post a comment                 | ⌘↩                                                                                            | Ctrl+Enter                |
| Next and previous change       | ⌘⌥] and ⌘⌥[                                                                                   | Ctrl+Alt+] and Ctrl+Alt+[ |
| Find, next, previous           | ⌘F, ⌘G and ⇧⌘G                                                                                | Ctrl+F, Ctrl+G and Ctrl+Shift+G |
| Find and Replace               | ⌥⌘F                                                                                           | Ctrl+Alt+F                |
| Bold, italic                   | ⌘B and ⌘I                                                                                     | Ctrl+B and Ctrl+I         |
| Code, strikethrough            | ⌃` and ⌃⇧`                                                                                    | Ctrl+` and Ctrl+Shift+`   |
| Link, clear formatting         | ⌘K and ⌘\                                                                                     | Ctrl+K and Ctrl+\         |
| Body, Heading 1 to 6           | ⌘0 and ⌘1 to ⌘6                                                                               | Ctrl+0 and Ctrl+1 to Ctrl+6 |
| Quote, bulleted, numbered, task list | ⌘⌥Q, ⌘⌥U, ⌘⌥O and ⌘⌥X                                                                    | Ctrl+Alt+Q, U, O and X    |
| Code block, table              | ⌘⌥C and ⌘⌥T                                                                                   | Ctrl+Alt+C and Ctrl+Alt+T |
| Indent, outdent                | ⌘] and ⌘[                                                                                     | Ctrl+] and Ctrl+[         |
| Paste as plain text            | ⇧⌘V                                                                                           | Ctrl+Shift+V              |
| Larger, smaller, actual text size | ⌘=, ⌘- and ⇧⌘0                                                                             | Ctrl+=, Ctrl+- and Ctrl+Shift+0 |
| Show or hide the file sidebar  | ⌃⌘S                                                                                           | —                         |
| Preferences                    | ⌘,                                                                                            | —                         |
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
- **A paste never creates marks from the clipboard's content.** Pasted text that holds Redlines
  markup is pasted as its newest text, without the markers or the ledger, so a paste can't forge
  someone else's change. Copy works the same way: Clean and Redlines copy the newest text, and Raw
  copies the source. With Track Changes on, the pasted text is the paster's own insertion.
- **Fonts:** each of a theme's fonts has a twin with the same character widths that Word and
  Google Docs both have (§6.6). The PDF embeds Redlines' own fonts, and Copy for Word and exports
  name the twins, so a page breaks its lines in the same places in the PDF, Word and Google Docs.

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
- a folder sidebar (written), Quick Open and folder search, which folder chat also needs;
- links from pasting a URL onto a selection (§5.10);
- R Markdown and Quarto chunk options kept byte for byte.

**Should (v1 if time allows):**

- a selection toolbar: Comment, Suggest, Ask agent, and formatting;
- a slash menu that opens only at the start of a line or after a space, and can be turned off;
- heading and list folding, per viewer, with a count of hidden changes on a folded heading;
- dragging sections in the outline, and moving blocks with the keyboard, tracked as moves;
- `[[` autocomplete that writes standard links (`[text](file.md#heading)`), which work on GitHub;
- image resizing, alt text and captions; callouts (§5.2); Mermaid editing with a live preview;
- a copy button and a wrap toggle on code blocks (the colors are written, §6.4);
- citations from the document's bibliography in `.qmd` and `.Rmd`;
- find and replace under tracking: each replacement is a substitution. Written: Replace All is one
  step to undo. Not yet: deciding all of its changes at once;
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
| `@redlines/agent-tools` | The six tools every agent acts through (§8.3): `view`, `read_thread`, `str_replace`, `comment`, `reply` and `status`, with their limits, and the MCP server that offers them. TypeScript with no DOM or Node APIs, so it runs in the webview and in QuickJS | Anywhere |
| `@redlines/agent-process` | What the Claude and Codex providers share: finding an agent's program, asking it whether it is signed in, and following a run to its end | Anywhere (no DOM, no Node APIs) |
| `@redlines/react`      | `<RedlinesEditor>` for React, and a `<redlines-editor>` web component for other frameworks                                                 | Browsers                |
| `@redlines/render`     | Static HTML rendering and pagination, for print, PDF, HTML export and previews                                                              | Browsers, Node          |
| `@redlines/clipboard`  | HTML-to-Markdown conversion for paste, and the copy formats: Redlines' own, Word's HTML, generic HTML, Markdown, plain text                 | Browsers                |
| `@redlines/docx`       | Word import and export                                                                                                                     | Browsers, Node          |
| `@redlines/collab`     | The collaboration server and its client protocol                                                                                           | Node; client in browsers |
| `@redlines/mcp`        | The MCP server, for agents outside Redlines                                                                                                | Node                    |
| `redlines`             | The command line: views, edits as suggestions, comments and replies, accept and reject (`packages/cli`). Later: lint, export, merge driver, compaction, repair | Node, or the app's own program (below) |
| `apps/desktop`         | The desktop app: a Tauri v2 shell, in Rust, around the editor                                                                               | macOS, Windows, Linux   |
| `plugins/*`            | The first-party plugins (§6.4)                                                                                                             | Wherever the editor runs |
| `integrations/*`       | VS Code and Positron, Claude Code, Codex, Syrus, the GitHub Action and the pandoc filter; later Obsidian and Jupyter (§9)                  | Their hosts             |

The desktop app carries the command line as `Redlines.app/Contents/MacOS/redlines`, a small Rust
program (`apps/desktop/redlines`) that runs the same bundled TypeScript (`packages/cli` and
`@redlines/format`) in the QuickJS engine, so nobody needs Node and there is one implementation of
the format. It does two things:

- `redlines view|str-replace|comment|reply|accept|reject <file> …` act on the file on disk. This
  is how an agent outside the app, such as a Claude Code session in a terminal, works. The app
  reloads a file that changed on disk, and keeps unsaved edits.
- `redlines mcp --relay <socket>` is the pipe from an agent that Redlines started to the running
  app, over a Unix socket made for that run. It runs no JavaScript. The agent's toolbox calls
  reach the live editor through it, so the app is the only writer to an open document and an
  agent's edit can't race the person's typing.

Preferences › General › Command line › Install links `~/.local/bin/redlines` to the app's copy. It
needs no password, and an update replaces the app and the link follows. It says so when that folder
isn't on the `PATH`. In a checkout, `pnpm -s redlines` runs the TypeScript directly.

### 6.4 Plugins

**The core** (`@redlines/editor`) holds:

- display and editing of all the Markdown in §5.2; code, math and diagrams appear as formatted
  source until their plugins render them;
- the tracked-change layer: showing marks, editing with Track Changes on, accepting and
  rejecting, the views and Track Changes;
- comment anchors and the ledger;
- undo, find and replace, and the platform's spellcheck;
- the command registry and palette, shortcuts, settings, theme tokens (§6.6) and the plugin host.

**First-party plugins** ship with the app, use the public API, and can each be turned off. The
table is the plan. Written so far: `review`, `themes`, `code`, `find`, `formatting`, `agents` and the three
providers (`plugins/`). The `ai` row is what `agents` is growing toward: its chat panel isn't
written.

| Plugin       | Adds                                                                         | Needs from the host        |
| ------------ | ---------------------------------------------------------------------------- | -------------------------- |
| `review`     | The review bar, change cards, the comment rail and the Changes tab           | —                          |
| `tables`     | Table editing: grips, selection, moves, pasting ranges                       | —                          |
| `math`       | Rendered math                                                                | —                          |
| `diagrams`   | Rendered Mermaid diagrams                                                    | —                          |
| `code`       | Syntax colors in code blocks, and a read-only viewer for other text files    | —                          |
| `paste`      | The paste pipeline and paste options                                         | Clipboard                  |
| `word`       | Copy for Word, and `.docx` import and export                                 | Clipboard, files           |
| `print`      | Print and PDF export through the paginator                                   | Printing                   |
| `export`     | HTML, clean Markdown and review-view export                                  | Files                      |
| `outline`    | The outline panel and dragging sections                                      | —                          |
| `workspace`  | The folder sidebar, Quick Open and folder search                             | Files                      |
| `git`        | Optional git features (§7.4)                                                 | Files, git                 |
| `collab`     | Live sessions: presence, cursors and invitations (§7.1, §7.2)                | Network                    |
| `ai`         | The chat panel, Ask agent, agents in comment threads, agent levels (§8)      | Agents                     |
| `agents`     | The @ picker and the runs a posted mention starts (§8.6)                     | Agents                     |
| `agent-claude`, `agent-codex`, `agent-acp` | The Claude, Codex and Agent Client Protocol providers (§8.6) | Agents                     |
| `formatting` | The Format and Paragraph menus: inline marks, headings, lists, code, tables and links | —                  |
| `find`       | Find and replace, as the Edit menu's Find group                              | —                          |
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
defines the tokens and styles everything through them. A theme is a CSS file: token values, plus
optional rules for document elements. People can add their own themes.

- **Built-in themes:** Default, Book and Editorial, each in a light and a dark version. Default is
  the default. The light and dark themes are chosen separately, and Redlines follows the system's
  appearance. The theme is each person's own, like the view: files store no theme, and Copy for
  Word, PDF and the exports use the current theme.

  | Theme     | Body                     | Headings      | Suits                                    |
  | --------- | ------------------------ | ------------- | ---------------------------------------- |
  | Default   | Carlito                  | Carlito, bold | Everyday documents                       |
  | Book      | Gelasio, a little larger | Gelasio       | Reading: manuscripts, contracts and SOPs |
  | Editorial | Carlito                  | Gelasio       | Serif headings over a sans body          |

- **Fonts that look the same everywhere.** A theme uses only fonts that render the same on every
  platform and in a web page, so Redlines bundles its fonts and never uses the system's. Each
  document font has a twin with the same character widths that Word and Google Docs both have, in
  every version and offline. The PDF embeds Redlines' own font; Copy for Word and exports name the
  twin. A page therefore breaks its lines in the same places in the PDF, Word and Google Docs, and
  only the letter shapes differ slightly in Word. On screen, Redlines looks the same on every
  platform and in a web page; the screen isn't paginated, and its column reflows with the window.

  | Bundled in Redlines   | Twin in Word and Google Docs    | Used for                             |
  | --------------------- | ------------------------------- | ------------------------------------ |
  | Carlito               | Calibri                         | Default; Editorial's body; interface |
  | Gelasio               | Georgia                         | Book; Editorial's headings           |
  | Cousine               | Courier New                     | Code, in every theme                 |
  | Caladea, Arimo, Tinos | Cambria, Arial, Times New Roman | Available to other themes            |

  All are open-licensed (SIL Open Font License or Apache 2.0). Carlito is based on Lato, and
  Caladea on Cambo.

- **The interface is drawn by Redlines** in the theme's interface font: the hover menus, notes,
  cards, notifications and review bar. Only the menu bar and context menus are the platform's own.
- **The default look:** a centered column about 680 px wide; body text at about 17.5 px with a line
  height of about 1.55, in dark gray rather than black; headings in the body's family, with no rule
  under them; tables with horizontal rules only; generous, even space between blocks.
- **Color means a person.** Text and controls are grays. Color marks people: each author's changes,
  comments and cursor (§5.5). Changed text is drawn in its author's color, so every author color
  keeps a contrast of at least 4.5:1 against the page in every theme, light and dark, and the colors
  also differ in lightness. Red is the app's own: the Track Changes pen's (§5.4) and the first
  author color, yours. It is the red of the icon and the website, #d42a1e on a light page and
  #ff6a5c on a dark one, and the same in every theme; no other author color is close to it. The
  interface itself draws red for the pen alone.
- **Embedded editors fit their host.** The embedding app passes token values, or a theme maps the
  app's own variables, such as a VS Code color theme or a Tailwind configuration, onto Redlines'
  tokens, so the interface looks like part of Syrus, VS Code or any other app. The document keeps
  the theme's fonts, so it looks the same as in the desktop app.
- **Print, PDF and Copy for Word use the same tokens,** with a print scale (body text at 11 pt), so
  they look like the screen.

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
  - a small red pen on the avatar of each person whose changes are tracked;
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

- **By default, an agent follows its person's Track Changes setting:** Auto while it's off, Suggest
  while it's on. Each agent can be set to one level instead, per document or everywhere.
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

**Agent runs.** Each request, a chat turn or a mention, is one run. Each edit in it (one `str_replace`) that makes several marks gives them a `group` of their own, so the marks of one edit are one suggestion and two edits of a run never are.

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

The desktop app runs the agents people already have, through their own programs, so people use the
subscriptions they already pay for ([research](research/ai-providers.md)). Redlines doesn't build
an agent loop: Claude Code and Codex already are one, with the tools, the sign-in and the model
choice. A provider starts the program in the document's folder, hands it the toolbox (§8.3) over
MCP, and turns what the program prints into status lines. Both are on the Mac app today.

| Engine | How it runs | Whose sign-in | State |
| ------ | ----------- | ------------- | ----- |
| **Claude** | The person's own `claude -p`, tested with Claude Code 2.1.318 | Claude Code's own: a plan or an API key. Asked with `claude auth status` | Written |
| **ChatGPT** | The person's own `codex exec`, tested with Codex 0.166.0 | Codex's own: a ChatGPT plan or an API key. Asked with `codex login status` | Written |
| **Other agents,** such as GitHub Copilot, Gemini and OpenClaw | One provider for the Agent Client Protocol, given a command to run | Each agent's own | Written |
| **Sign in with ChatGPT** inside Redlines, for people with a plan and no command line | Redlines' own agent loop | Redlines would hold tokens | Not written |
| **API keys and local models** | Through an ACP agent that supports them, or `codex --oss` | None, or a key | Not written |

Redlines never reads, stores or passes Claude or ChatGPT credentials. Whether someone is signed in
is what the agent's own status command says, and when they aren't, the thread says so in one line
(for example, "Claude isn't signed in. Run `claude auth login`."). The UI says "Claude" and
"Codex"; "Claude Code" appears only in plain text saying the app runs it.

**Written with the limits that hold.** What an agent may read is what it really can read, not what
it was asked to:

- Claude runs with `--restricted`, which confines its file tools to the document's folder,
  symlinks included, whatever its owner's own settings allow, and offers no read tool at all for
  "Just this document". Its hooks, and the person's settings and `.mcp.json`, don't run.
- Codex runs with a permission profile that makes macOS refuse a read outside the folder, for its
  shell, its image viewer and its helper agents alike, with its user configuration, its rules, its
  hooks and the person's ChatGPT connectors turned off. `--sandbox read-only` isn't used: it
  blocks writes but reads anywhere.
- Both change the document only through the toolbox's tools, which record tracked changes in the
  agent's name. They can't accept, reject or resolve.
- A run whose toolbox never connected counts as failed, because both agents otherwise carry on
  without it and exit 0.

**Scope** is the setting What agents may read, in Preferences › Agents: This folder (the default;
the repository's root, or else the document's folder) or This document. The first run of an agent
in a folder asks, on its live line (§5.7), and the answer is remembered for that agent and folder
in the app's settings, never in the document. Preferences › Agents lists the agents found on this
Mac with their state (not found, not signed in, signed in, and their version), the remembered
answers with a Forget button for each, and Show Agent Logs.

**The log.** Every run writes a log, one JSON Lines file, in `~/Library/Logs/md.redlines.editor/
agents/`: what was started (the agent, its version, the flags, the folder), each event the agent
sent, each tool call with its result, and how the run ended. Help › Show Agent Logs opens the
folder. Logs quote the document and the folder, so they stay on this Mac and are deleted after 30
days; they hold flags and events, never the environment, so no credential lands in one.

**Where the work happens.** The tools run in the app, against the live editor, so the app is the
only writer to an open document. Posting the comment that starts a run saves the document, and
while it has no unsaved edits, each agent edit is saved as it lands. A run belongs to its document:
while one is live, anything that would replace the document opens a new window instead. A second
mention in a thread waits for the first run to end.

Syrus runs agents on its server with API keys or enterprise agreements.

**Privacy:**

- An agent runs only when someone posts a comment that names it. The first run in a folder asks
  first, because the folder's contents go to that agent's provider.
- A folder's own code doesn't run. Claude's hooks and `.mcp.json` and Codex's `.codex` folder are
  turned off for the run, so the question is about consent, not about code in the folder.
- An image's address inside a pending change isn't fetched until the change is accepted, so an
  agent misled by text it read can't leak what it read through an image URL.

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
- **Website:** a static site in `website/`, at [www.redlines.md](https://www.redlines.md/). A
  workflow builds it and deploys it to GitHub Pages: by hand, and after every release, once the
  release workflow has attached the app ([releasing](releasing.md)).

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

1. **Track Changes and agent levels** (§5.4, §8.2): Word's on or off for people, and Ask, Suggest
   or Auto for agents, following their person by default.
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
6. **Shortcuts for the views** (§5.3): not chosen yet. ⌥⌘1 to ⌥⌘3 are taken, as Word for Mac's
   heading shortcuts.
