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
- **Markdown flavors:** GitHub Flavored Markdown in `.md` files, and in plain text (`.txt`) files,
  and pandoc's Markdown in R Markdown (`.Rmd`) and Quarto (`.qmd`). Redlines reads the common
  variants, Obsidian's included.
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

Redlines as built on `main`, and what it plans: ✅ is built, and Planned is designed but not built
yet; a row is built when all of it works on `main`. The other products as of October 2026, from
their documentation. VS Code includes the Live Share, GitHub Copilot and Quarto extensions. The
website shows eleven of these rows, and `npm run compare:check` in `website/` fails when they differ
from this table.

| Feature                                     | Redlines | Word | Google Docs | Notion | VS Code |
| ------------------------------------------- | :------: | :--: | :---------: | :----: | :-----: |
| Edits Markdown files                        |    ✅    |  ❌  |     ✅      |   ❌   |   ✅    |
| R Markdown and Quarto                       | Planned  |  ❌  |     ❌      |   ❌   |   ✅    |
| Tracked changes (suggestions)               |    ✅    |  ✅  |     ✅      |   ✅   |   ❌    |
| Comment threads                             |    ✅    |  ✅  |     ✅      |   ✅   |   ❌    |
| Accept or reject by person                  | Planned  |  ✅  |     ❌      |   ❌   |   ❌    |
| Tracked changes stored in the Markdown file |    ✅    |  ❌  |     ❌      |   ❌   |   ❌    |
| Changes and comments merge in git           |    ✅    |  ❌  |     ❌      |   ❌   |   ❌    |
| Full edit history, stored in the file       | Planned  |  ❌  |     ❌      |   ❌   |   ❌    |
| Live collaboration with people              | Planned  |  ✅  |     ✅      |   ✅   |   ✅    |
| Live collaboration with AI                  |    ✅    |  ❌  |     ❌      |   ✅   |   ✅    |
| AI agents suggest changes in their own name |    ✅    |  ❌  |     ❌      |   ❌   |   ❌    |
| Word files with tracked changes, in and out | Planned  |  ✅  |     ✅      |   ❌   |   ❌    |
| Desktop app for Mac, Windows and Linux      | Planned  |  ❌  |     ❌      |   ❌   |   ✅    |
| Embeddable editor component                 | Planned  |  ❌  |     ❌      |   ❌   |   ✅    |
| Free and open source                        |    ✅    |  ❌  |     ❌      |   ❌   |   ✅    |

The Mac app is built; Windows and Linux are planned (§10).

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
  the Mac, spell checking and autocorrection while typing, text replacements, smart quotes,
  dictation and input methods. A right-click opens the formatting palette (below) in place of the
  system's context menu, with the spelling suggestions of a misspelled word at its top and Learn
  Spelling; ⇧ with the right-click shows the system's own menu, which has Look Up, Services and
  Writing Tools. A correction is part of your typing, as in
  Word: with Track Changes on, the word you just typed is your own pending insertion, so correcting
  it changes the insertion's text, and no other change appears. Only the part of a correction that
  reaches into other text becomes a tracked change of that text; with Track Changes off it is a
  plain edit. A correction never crosses a hidden marker: the text on either side is corrected
  apart, or the word is left as typed. ⌘Z right after a correction undoes it first, as in other Mac
  apps. Code, URLs and front matter are never corrected, nor spell checked outside Raw, and Raw
  isn't corrected. A word ended with Return or Shift-Return is corrected too, though the editor
  handles those keys itself: it asks the system for the word's correction, makes the break at once,
  and makes the correction as a step of its own (⌘Z takes it back before the Return) only if the
  word is still there when the answer comes; Tab, the arrows, clicks and ⌘ keys correct nothing.
- **A calm screen.** One document and little else. The comment rail appears only when a document
  has comments, and the review bar only when you ask for it (§5.6).
- **Color means a person.** Text and controls are grays; color shows who changed or commented on
  what (§6.6).

The window, on the desktop:

- **The title bar is the page:** it has no color of its own and no line under it. The page reaches
  the top of the window and the text scrolls under the bar, fading out as it passes, so that the
  window reads as one page, with no hard edge below the bar. The file name is centered in small
  gray type, and the document starts below the bar, so that nothing is hidden at rest. The bar
  drags the window and a double-click on it zooms it, except on its controls. There is no toolbar,
  and no status bar: the one line along the bottom is the word count, below.
- **A small word count** sits in the lower right corner, "1,204 words", and stays visible while you
  write; with a selection it says how many of the words are selected, "120 of 1,204 words". It is
  one gray line of small text, not a status bar. It counts what a reader sees, the newest text and
  never the markers or the ledger, a moment after you stop typing, so that a long document stays
  fast. It rests on a fade of the page's color, as the title bar does, so that nothing scrolls under
  it unfaded, and what scrolls into view, the line being typed on included, stops above the fade. It
  follows the theme and the zoom. Preferences › Editor › Show word count hides it.
- **The file name is a handle.** A small document icon beside the name drags the file, as the proxy
  icon of a native title bar does: dropped on Finder, Mail, Terminal or another app's window, it
  hands over a copy of the file as it is saved. It never moves the file the window has open, and
  while the document is Untitled, with no file yet, the icon is hidden, as it is on Windows and
  Linux, where the page has no drag to hand over. A double-click on the name
  renames the document, as File › Rename does, or opens Save As for an Untitled one; a
  double-click anywhere else on the bar zooms the window, and a drag anywhere on the bar, the
  name included, moves it. Hovering over the name shows the words and when the document was last
  saved.
- **One document per window.** New always opens a new window. Open uses the window it was chosen in
  while that holds only an untouched Untitled document, and otherwise opens a new one, as a file
  from Finder does. The file sidebar lists the document's project, its repository or else its own
  folder, opened down to the document: its folders, and the documents Redlines opens, Markdown,
  R Markdown, Quarto and plain text (`.txt`) files, leaving out hidden files and what `.gitignore`
  ignores. No other file is listed. Choosing a document opens it in the same window, and ⌘-click
  opens it in a new one, as does a click while an agent is working in the window. A plain text
  file is read as Markdown and saved under its own name, with Track Changes and comments like any
  document (format §9.1). A document dropped on a window opens as one from Finder does, but for
  the file that the window's own document icon dragged, which opens nothing when it is dropped
  back on that window. Any other
  file opens nothing, however it comes (the Dock, Finder, a drop, a path given to the app), nor
  does a folder dropped on a window, and the window says so in one line: "Redlines opens Markdown
  and text files." macOS window tabs work as usual, and the menu bar is the front window's.
- **Finder knows Redlines' documents.** The Mac app declares them, as their editor: Markdown by
  its types (`net.daringfireball.markdown`, which macOS gives `.md` files, and `public.markdown`,
  which other apps declare), R Markdown and Quarto by their extensions, and `.txt` files by
  theirs, so Finder's Open With offers Redlines for each, and for no other kind of text, such as
  source code. Where the
  person hasn't chosen an app for Markdown files and no app owns them, macOS may open them in
  Redlines. R Markdown, Quarto and `.txt` files it never takes, even where nothing else owns them:
  for those Redlines is only an alternative, since people who write R Markdown or Quarto have an
  editor of their choice.
  Preferences › General › Default app for Markdown says which app opens Markdown files, and Make
  Redlines the Default asks macOS to open them in Redlines, whichever copy of it. It refuses a copy
  that won't stay where it runs, as the command line's Install does (§6.3), and says what macOS
  did. Finder's Get Info changes the choice again.
- **Quitting never loses work.** However the app is asked to quit (the menu, the Dock, logging out)
  or to restart for an update, each window with unsaved edits comes forward in turn and asks whether
  to save them. Cancel stops there and keeps every window open. Closing the last window quits.
- **File menu.** New, Open, Open Recent (the last ten files), Save, Save As, Rename (the file name
  in the title bar becomes a field; so does a double-click on it), Reveal in Finder, Close and
  Print. Printing holds the whole document in light ink and prints the view as it shows, without
  the rail: Redlines in its simple look prints the newest text with its change bars. Saving a
  document that has no file yet opens the Save dialog in the default folder for new documents
  (Preferences › General), when one is set and still there; otherwise where macOS last saved. Save
  As of a saved document starts in that document's own folder.
- **Find.** ⌘F opens a bar at the top of the page that searches the text a reader sees, never the
  markers or the ledger. Edit also holds Find Next (⌘G), Find Previous (⇧⌘G), Find and Replace
  (⌥⌘F) and Use Selection for Find (⌘E). Replacing is an edit like typing, so with Track Changes
  on it is recorded as a substitution. A chevron at the start of the bar shows or hides the replace
  row ("Show Replace" and "Hide Replace" for VoiceOver), keeping the find text and the current
  match; ⌥⌘F with the bar open shows the row and focuses its box.
- **Zoom and text size.** View › Zoom In (⌘=, or ⌘+), Zoom Out (⌘-) and Actual Size (⌘0) zoom
  everything Redlines draws in its windows, from 80% to 200%: the page and its notes, cards, bars,
  menus, notices, notifications, the sidebar and Preferences. The title bar keeps its place beside
  the window buttons, and its icons and name grow up to 150%; the menu bar, context menus and the
  system's dialogs keep the system's size. Text Zoom changes only the document's text and the
  notes and cards on it, and goes twice as far, from 80% to 400%, so that the text can be made
  really big: a pinch follows the fingers and keeps the line under the pointer in place, and
  Larger Text (⌃⌘=), Smaller Text (⌃⌘-) and Actual Text Size (⌃⌘0) step the sizes, which go on past
  the window zoom's 200% to 250%, 300% and 400%, and Preferences offers them all. The window zoom
  keeps its own range. The notes and cards grow with the text above 100% and never go below their
  size at 100%. The text column grows with the text until it meets the margins, and only then do
  lines rewrap; at the largest sizes it is the window's width less the margins, long words, links
  and code wrap, a table scrolls in its own box when its cells can't fit, and the margin notes
  are dots that open on hover wherever the window is too narrow for them beside the column. Both are each person's, for every window, kept across launches;
  neither reaches the file, a print, the clipboard or an export.
- **Preferences** (⌘,) is its own window with four panes: General (your name and handle, what
  opens at launch, the default folder for new documents, automatic updates, the Dock icon, the
  default app for Markdown, and installing the `redlines` command line), Appearance (Match
  System, Light or Dark, the theme, zoom and text size), Editor (spell check, smart quotes and
  dashes, closing brackets, whether Track Changes starts on, whether line breaks show their
  marks, §5.5, and whether the word count shows) and Agents (§8.6). Changes apply at once.
- **Three icons.** Next to the window buttons, Files shows and hides the file sidebar, which is
  hidden by default (⌃⌘S, the Mac's Show Sidebar shortcut). At the right, View (an eye) sets the
  view (§5.3), and Review (a pen) holds Track Changes and Review Changes (§5.4, §5.6).
- **Icons without labels, explained on hover.** Hovering over an icon shows its name and shortcut,
  or opens its menu straight away, with each item's shortcut. Clicking opens the menu too, for the
  keyboard and touch.
- **A formatting palette, hidden while you write.** There is no toolbar, and the palette is not one:
  it opens only when asked, from a handle (a short gray bar at the bottom center of the window,
  which hovering over brings up, and which goes out of sight while you type) and on right-click, at
  the pointer, where it takes the place of the system's context menu. It is a small card of icons
  in rows, with no labels, explained on hover like the title bar's icons, after the same delay,
  with each item's name and shortcut. The rows are Comment (Add Comment, Highlight and Ask, which
  act on the selection, or the word under the caret), Insert (Table, Code Block, Alert, Image,
  Quote, Link), Format (Bold, Italic, Subscript, Superscript, Clear Formatting) and Edit (Cut,
  Copy, Paste). Its items are commands of the one registry (§5.9), so that it, the Format and
  Paragraph menus and the shortcuts never disagree about names, keys or whether an item is
  available; an item whose command isn't registered is left out. Show Formatting Palette (⌥⌘P,
  in the View menu) opens it from the keyboard, with the arrow keys moving among its items; Esc
  closes it. Paste reads the clipboard through the app and goes in the way ⇧⌘V does, so with Track
  Changes on it is the paster's insertion. The palette replaces the selection toolbar of §5.12.
- **No number badges.** Counts appear where you look for them, such as "Change 3 of 17" on the
  review bar.
- **Outline.** In a document with two or more headings, a column of short lines stands in the left
  margin, one for each heading, longer for the higher levels, with the line of the section you are
  reading in ink as you scroll. Where the page can go no further, so that the last headings can't
  reach the top, it is the last one in view, and a heading you clicked stays the one you are
  reading until the page moves from its end. Hovering over it opens it, with a short animation,
  into a list of the headings' text with the section you are reading in view, and moving the pointer
  away closes it; a click on a heading goes to it, the caret on its line and the line at the top of
  the page. It stands in the pane the text scrolls in, so it moves with the file sidebar, takes no
  click but its own (the margin beside it holds the change bars), and shows its lines only where the
  margin has room for them beside the bars; where it has none, View › Show Outline (⌃⌘O) opens the
  list, and says so when there are fewer than two headings. The list is a navigation landmark of
  buttons for VoiceOver: ⌃⌘O puts the focus on the heading you are reading, the arrows move between
  headings, Return goes to one and Escape gives the focus back to the text. Headings read as the
  text does with every pending change accepted, in every view: a heading deleted whole isn't listed,
  Redlines included, where its card is. It doesn't print.
- **Details on hover.** The times and other details of changes and comments appear when you hover
  over or select them, not at rest.
- **The Mac comes first.** On Windows and Linux the alpha keeps the platform's own title bar and
  menu bar, with the three icons at the top of the page.
- **An icon that changes.** Redlines is installed with a red caret on warm paper as its icon, the
  mark that says where text goes. While it runs, its Dock icon shows another mark of the same
  family (a change bar, a margin bracket, a delete mark, a red line, or the caret with an
  insertion above it), a different one at each launch. Turning off Redlines › Preferences › General
  › Rotate the Dock Icon keeps the caret. About Redlines is a small window of the app's own, as
  Preferences is, on every system: the icon, the name, the version and build, and the copyright,
  as the system's panel has them. It opens once, and Esc and ⌘W close it. A click on its icon
  changes it to the next mark of the family, drawn as a tracked change, the old mark struck through
  with a red line and the new one underlined, in about half a second (a plain crossfade under
  Reduce Motion); nothing says so, and the Dock icon follows the mark until the next launch.
- **Updates never interrupt.** The app checks for a new release soon after it starts and every few
  hours, and downloads it in the background, once however many windows are open; offline, it says
  nothing and tries again later. The app holds the download, not a window, so closing a window loses
  nothing, and a window opened later shows that the update is ready. When it is, a small card in the
  lower-right corner of each window offers Restart to update, which reopens the documents in the new
  version, or Later, which puts the card away in every window. There is no dialog. Redlines ›
  Check for Updates… checks at once, and Redlines › Preferences › General › Check for updates
  automatically turns the checks off. The version and build are in About Redlines, and nowhere else
  in the window.

How it works:

- **One Markdown string is the model,** and positions are offsets into it. Syntax characters stay
  in the text and are hidden by decorations unless the caret is inside their element.
- **Blocks are structure:** the person writes paragraphs, headings, items and quotes, and the
  editor writes the blank lines Markdown needs between them and never shows them (§5.14).
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
- **Table cells** with line breaks (Return writes `<br>`, §5.8) and lists.
- **Subscript and superscript:** the tags `<sub>` and `<sup>`, in every file type, drawn smaller and
  lowered or raised with the tags hidden unless the caret is in them, like any inline format. They
  are in the Format menu and the command palette (and in the formatting palette, §5.12, when it
  lists inline formats), and are tracked as format changes (`+sub`, `+sup`). They are the first of a short list of inline HTML tags that the editor
  renders as formats; any other tag shows as written. pandoc's `~x~` and `^x^` in a `.qmd` or
  `.Rmd` file are kept byte for byte and shown as written.

Math, Mermaid diagrams, footnotes, task lists and `<details>` are covered too.

**Links** are drawn underlined and stay text to edit: a click places the caret. ⌘-click opens the
address in the default browser (Ctrl-click off a Mac), and a pointer at rest on a link shows its
address in a hint after the pause that the title bar's hints make; with ⌘ held, the pointer over a
link is a pointer. Only `http`, `https` and `mailto` addresses open, and `www.` ones, which GitHub's
autolinks read as the web's: the limit of a copy, which turns `javascript:` and its kin into plain
text, so that a link in a document, or in an agent's suggestion, never runs anything. The app checks
the address again before it runs the system's opener, and the website's demos open a new tab. A
link that doesn't open is left to the editor like any text, with no hint. A relative link to
another document doesn't open yet.

### 5.3 Views: Clean, Redlines, Raw

The View menu, under the eye at the top right (§5.1), sets how the document is shown:

- **Clean** (⌥⌘1): the document as it reads with every pending change accepted, without markup
  (Word's No Markup). The Mac's Quick Look preview of a Markdown file is this view (§10).
- **Redlines** (⌥⌘2): the document with its tracked changes and comments (Word's All Markup). It is
  always there, with its shortcut, whatever the document holds and whether Track Changes is on or
  off, so the View menu always offers the same three views. A document without redlines looks
  nearly the same as in Clean. Redlines has two looks, and a click on a change bar in the margin is
  the only way to choose between them: the **full markup**, and the **simple look** ("Simple" for
  short), the same text as Clean with a change bar beside each screen line that has a pending
  change (§5.5), in its author's color, and the comments with their notes: deletions are hidden,
  and inserted and reformatted text is plain (Word's Simple Markup). The click switches from the
  one to the other, with the line where it was. The simple look is no view of its own: the View
  menu has no entry for it and no key shows it, so the menu says "Redlines" in both looks.
- **Raw** (⌥⌘3): the Markdown source, markers and ledger included, with syntax highlighting. It is
  the same editor with its decorations turned off.

Clean and Redlines draw the blank lines between blocks as the space between them, never as lines;
Raw shows them.

Redlines remembers its look, the one a click on a change bar chose last, the full markup at first.
A document opens in the view it was saved in, which its ledger records
([format §5.6](format.md#56-settings)): `view: clean` opens it in Clean and `view: redlines` in the
full markup. A document that records none opens in Redlines, in the look remembered, when it has
redlines (pending changes, highlights or comment threads), and in Clean when it has none. Making a
tracked change in Clean, or adding a comment there, switches to Redlines in that look, so
suggestions are never invisible to their author, and so does a document shown Clean that gains
redlines; a tracked change made in the simple look stays in it, where its bar shows it. Choosing
Redlines in the View menu, from Clean or Raw, brings back the look that was shown last, so that a
trip through Clean or Raw comes back to where it began; in Redlines already, in either look, the
menu leaves the look as it is. Reviewing (§5.6) shows the full markup, where each change shows, and
what it showed is what comes back. With no change pending there is no bar to click, and the two
looks differ only in the ordinary HTML comments that the full markup draws as dimmed notes.
Otherwise the view stays as you chose it: deciding the last change doesn't switch it. **Switching
views never changes the file,** and so never makes the document edited or causes a write: a Save,
made for another reason, records the view (Clean, or Redlines for either look, never Raw) in a file
that has a ledger, so that reading a document leaves its git history quiet, and a view alone never
adds a ledger to a plain file. The look remembered is each person's own and is never saved in the
file; it is kept in the app's settings (a look saved as Simple opens in Redlines' simple look) and
reaches every window for the documents each opens next, without changing the view any of them
shows. The View menu also previews the original (every change rejected) and one person's changes
alone (everyone else's rejected). The previews are read-only. Raw can be edited while Track Changes
is off; while it is on, or locked on, Raw is read-only, because typing there could forge or break
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
- **The document remembers it,** as Word does (`w:trackRevisions`, which Word export writes).
  Turning Track Changes on writes `tracking: everyone` into the file's ledger, and turning it off
  takes it out ([format §5.6](format.md#56-settings)). The switch makes the document edited, like
  any change to it, so the next Save keeps it, and a step of its own, which Undo takes back.
  Someone who turns it on, saves, and opens the file again, or sends it to someone else, finds it
  still on. A file with no ledger gets one for it, and turning it off again leaves the file as it
  was. A file that can't take a ledger (an unreadable one, or an end inside a code block that is
  never closed) can't have it turned on, and says why. Preferences' Track Changes for new
  documents is the person's own start: it writes nothing to the file until they switch it.
- **Track changes for everyone,** like Word's "For Everyone", is what the setting means: everyone
  who opens such a file starts with Track Changes on, under a notice that says so. Without an app
  that enforces roles, anyone can still turn it off, which changes the file for everyone, so the
  notice makes that a deliberate choice. There is no "Just Mine" for now: a person's own tracking,
  apart from the file's, is left for later.
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
- **Change bars** in the left margin mark the screen lines that hold a pending change, in its
  author's color, or gray when several people changed the same screen line: a paragraph that wraps
  over many lines gets a bar only beside those that hold part of a change, one word on one line
  marks that line alone, and the bars are drawn again when the text wraps differently (a resize, a
  zoom, a change of font). A deletion that the view hides, as the simple look does, has its bar on
  the screen line where the text was; a row of a table, and a block deleted whole, have a bar of
  their own. In Redlines a click on a bar switches between its two looks, the full markup and the
  simple look, and is the only way to choose one: the bar is a target 24 px wide, only beside the
  lines it marks, and it widens under the pointer. Printing draws the bars as a left border, which
  prints, down the whole paragraph of a changed line: the bars were measured for the screen, and
  the printed page wraps the text differently.
- **Each kind of change** looks as in Word, with Word's wording on its card:
  - a substitution is the struck old text followed by the underlined new text, with one card
    ("Replaced 'March' with 'April'");
  - a format change has a dotted underline ("Formatted: Bold");
  - a block-type change has a bar along the block's left edge ("Formatted: Heading 2");
  - a split or join shows no mark by default: the change bar marks its line, its card at the
    seam says what it is ("Inserted paragraph break", "Joined paragraphs"), and deleted text keeps
    a space where its line breaks were. Preferences › Editor › Show line break marks (¶) shows a
    small ¶ at the break in its author's color (two breaks in a row read "¶¶"), and a struck ¶ for
    each line break deleted.
- **Deleted blocks show as blocks.** In Redlines, a paragraph, heading, list item, quote or other
  block that was deleted whole is drawn where it was, as a block of its own, its text struck in its
  author's color, with the look of what it was (a heading at its level, an item with its bullet, a
  quote with its bar) and its own change bar. A block rewritten whole, by an agent or by typing over
  it, is not deleted: the old text is struck above the new, in the same block (a rewritten heading
  at the heading's size, an item beside its one bullet), and a rewritten table cell shows its old
  text struck above the new inside the cell. Words deleted inside a block, a substitution of part of
  one, and a deletion that runs from one block into another stay inline. The caret steps over a
  struck block, as over deleted text, and its card opens on hover and pins on a click; a click on
  its bar switches to the simple look, which doesn't draw it, and the block below keeps the place.
  The simple look and Clean show the newest text only.
- **Paragraph breaks.** A Return at a block's edge is no change until something is typed there: a
  new paragraph is an insertion of the whole block. A Return inside a block is a split ("Inserted
  paragraph break"), and Backspace at a block's start a join ("Joined paragraphs").
- **Markup is atomic while you edit.** It never expands under the caret. The caret steps over mark
  boundaries, Backspace acts on visible text and never on markers, and typing inside someone
  else's insertion splits it, as in Word.
- **Cards.** Hovering over a change shows its card after a short delay, above or below the line,
  never covering the changed text. A card shows the author, the time, Accept, Reject and Reply,
  and hovering over Accept or Reject previews the result. Clicking a change pins its card. Cards
  can be turned off.
- **Ordinary HTML comments,** such as an author's `<!-- TODO -->`, show as small dimmed notes in
  the full markup, are hidden in Clean and in the simple look, and are saved as written. The ledger never
  shows as text; its contents appear in cards and the rail.
- **The inspector** shows and edits one mark's raw markup.
- **Broken markup,** for example after a bad merge, shows a warning badge and is otherwise treated
  as text, so the document still opens.
- **Agent edits are animated** as they happen (§8.4).

### 5.6 Reviewing

- **The review bar** opens when you ask for it, with Review Changes in the Review menu or the
  next-change shortcut (⌘⌥]). Opening it, or moving it to a change, shows the full markup, from
  Clean, from the simple look and from Raw, so that each change shows while you decide it. Showing
  the simple look closes it, because a person who chooses to read has stopped stepping through
  changes, and while it is open a click on a change bar opens that change's card in place of
  switching the look. It floats at the bottom of the window and closes with Esc or its close
  button; without it, a change's card, or its note in the rail (§5.7, in the simple look too),
  still accepts or rejects that change. It holds:
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
  - The rail shows in Redlines, in both looks, the notes of changes among the comments.
    Adding a comment in Clean switches to Redlines, as a tracked change does. In the simple look
    a change's card doesn't open on hover or on a click in the text, because the text reads as
    accepted; the bar, the note and the review bar are the ways in. Accept and Reject on a note
    decide it in place, in the simple look as in Redlines, in one step to undo, and the view and
    the scroll stay as they were; so that the decision isn't blind, the note says what it decides
    in the card's words ("Replaced 'March' with 'April'") where the page shows no old text.
  - **The notes follow the view.** One note is level with its anchor and the others stack around
    it: the ones after it go down past it, and the ones before it go up, past the top of the
    screen if need be, never past the top of the page, where they stack from the top. So where
    many comments crowd a section, the note level with the top of the screen is the one the text
    there is about, and not one stacked down from far above. The one level with its anchor is the
    selected note (clicked, or with the caret in its anchor) while its anchor is in view, else the
    first note whose anchor is; with no anchor in view, the first note below the view, else the
    last. A comment being written is always the one, and stays where it is while the person types
    and scrolls. As the page scrolls, the note that is level with its anchor changes with the first
    anchor in view, and the notes slide into place in a moment, as in Google Docs; they slide only
    then, and not while a keystroke or a resize moves the text, and not at all under Reduce Motion.
    Selecting a note brings it level with its anchor and moves the others out of its way. The dots
    of a narrow window follow the same rule. A scroll places the notes again from what was last
    measured, only when another note is the one, and writes the notes within a screen of the page,
    and the rest as the page comes near them, so that it stays cheap in a long document. A
    resolved note gives way as before: it is never the one that keeps its anchor's height. The
    page is as long as the notes need when the first is level with its anchor, where they reach
    their lowest, as it was before the notes followed the view, so that a crowded end of a document
    leaves room under its text; it doesn't shrink as the page scrolls, which would move the page
    under the person at its end, and grows only where a resolved note, shown, goes lower.
  - When the rail shows, the text column moves left, so that column and rail together stay
    centered. In a narrower window the column gives up width, down to two-thirds of its measure,
    to keep the notes beside it; below that (about 800 px at a text size of 100%) the rail shrinks
    to dots. The rail grows with the text size above 100%, and so does the width at which it
    shrinks. During a pinch the rail keeps its state until the fingers lift.
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
- **A new comment's box can open with text in it** (`startComment(initialText)` on the review
  plugin; the website's scripted agent uses it to open the box with a question). The text goes only
  into an empty box: a draft that Escape set aside on that anchor comes back as it does today, and a
  box already being written in keeps its words, because the plugin never throws away what a person
  typed. The app's menu opens the box with no text. Raw takes no comment, with text too.
- **Drafts.** A comment is private until it is posted with ⌘↩, as in Word. Several drafts can be
  open at once, and they survive a reload, of the document from disk and of the app.
  - **What is kept:** each new comment being written, with what it is on; the comment set aside
    with Escape; and each reply being written, in its box or put away. (A comment can't be edited
    yet, so there is no edit to keep.) A draft is kept once typing pauses for half a second, and
    at the longest two seconds into typing that goes on, never at the keystroke; at once when its
    window closes; and before the app quits, which asks a window with drafts waiting to be kept, as
    it asks one with unsaved edits, but with no question when nothing in its document is unsaved.
  - **Where:** on this Mac only, in the app's own storage, kept for the document's file, by its real
    path, with any link followed: the review plugin's own document data (§6.4), which no other
    plugin can read. Never in the file, and never sent anywhere. A new comment keeps a copy of the
    text it was written in, to find its place again, one copy for it and a comment set aside; in a
    document longer than 200,000 characters it keeps its text and up to 32 characters on either
    side instead, and is found where they still are, nearest to where it was, or by its text alone
    where that is the only place it is. A document with no file keeps nothing until it is saved.
  - **Coming back:** when the document opens again, in any window, its drafts come back as they
    were left: the boxes open, the caret at the end of the one last typed in, and a document shown
    Clean switches to Redlines to show them. A window opened at a line, as from a citation, stays
    at that line, with the keyboard in the text. A new comment is on the same text: where it was, if
    the document is unchanged; else found by its text as a reload finds it; else on what replaced
    it, with its text kept and a line saying that the text it pointed to changed. A comment set
    aside stays aside on its anchor. A reply goes back to its thread; if the thread is gone, its
    note sits at the end of the document and says so, keeps the text, and can't be posted (Cancel
    lets it go). A reply whose thread goes while it is written does the same.
  - **Forgotten:** at once when a draft is posted, cancelled or cleared, so that a posted comment
    never comes back as a draft, even if the app quits right after; and when it is discarded as
    another document opens in its window. A draft follows its document through Rename and Save As; saved over another file,
    the document's drafts take the place of that file's.
  - **Bounded:** drafts are kept for at most 100 documents and 1,000,000 characters, the newest,
    and a document not opened in 90 days loses its drafts. The bounds hold at every write that
    keeps more. Drafts the bounds drop for a document open in another window are kept again when
    their text next changes there.
  - **Two windows:** a document open in two windows keeps the draft typed last. A window takes the
    kept drafts when it opens the document, and doesn't follow the other's typing; posting a draft
    in one window forgets it unless the other has typed in it since.
- **Typing `@`** in a comment opens a picker of collaborators and agents. Mentioning a person
  offers "Assign to".
- **Mentioning an agent** asks it to act on the thread. It replies in the thread, suggests tracked
  changes, or both, in its own name (`claude-ada`, with "Claude" as its name, for the person it
  works for). What it can do, and how it is run, is in §8.
  - **The picker** lists the agents found on this Mac first, then the people in the document's
    ledger, leaving out you and `unknown`. Picking one writes a plain `@Claude` or `@bo` in the
    comment, which changes nothing in the file's format.
  - **Only posting starts a run.** A run starts when a comment that names an agent is posted in this
    app's comment box, and never from text read out of a file, so a mention that arrives by reload,
    paste or git starts nothing, and nor do Undo and Redo of a comment or of a run. A run stops when
    the comment or reply that started it goes, however it went, Undo among them. Naming a person
    sends nothing either: Redlines has no backend, and they see it when they open the file.
  - **The live line.** While it works, one quiet gray line sits at the foot of the thread: the
    agent's dot, its name and what it is doing now ("Reading importer.ts"), with Stop on hover. The
    first time an agent runs in a folder, Redlines asks in the thread, in a panel of its own:
    "Allow Claude to read this folder?", with the folder, a line on what that means, and three
    buttons, Allow, Just This Document and Not Now. It never takes the keyboard, and a
    notification says when it waits out of view. A failure is the line too, in one sentence. The
    line is about right now: it is never written to the file and goes when the document closes.
  - **The reply is short.** A reply says what the agent did in a few words ("Cut it from 40 to 18
    words."), never the new text, a quote of the old text or what the app already shows; when it
    changed nothing, it says why. It is at most 200 characters, with no blank line, and a longer
    message (at most 2,000) follows it in the same comment, folded behind a quiet More. A file
    named in a reply is a link when it is inside the document's project: a document, such as
    `plan.md:42`, opens in a new window at that line, an image or a PDF opens in its default app,
    and any other file, such as `importer.ts:42`, opens nothing and says in one line that Redlines
    opens Markdown and text files.
  - **Its edits are tracked changes** in its color, each with a short note, and the person
    accepts or rejects them like anyone's. An agent never accepts, rejects or resolves.

### 5.8 Tables

Tables take their interaction from Google Docs and their tracked changes from Word
([research](research/tables.md)).

- **Hover controls:** a grip for each row and column, and a + on each boundary. Clicking a grip
  selects the row or column; dragging moves it to any position, including the last.
- **Selection:** rectangles of cells, whole rows and whole columns. Delete clears every selected
  cell, and menus count the selection ("Delete 2 rows").
- **Pasting** a spreadsheet range into cells grows the table by rows (§5.8 below, "Cells").
- **Tracked changes look as in Word:** inserted rows and columns tinted, deleted ones shown as
  struck-through ghosts, and moves with Word's double underline and double strikethrough. Word
  draws moves in green; Redlines draws them in the author's color, because color means a person
  (§6.6). Unlike in Google Docs, a move can be suggested, and new empty cells are tinted.
- **Edits to the source are minimal.** A table is never re-padded unless you ask.
- **A table stays its source, and is drawn as a table.** A block wrapper is the table, each line a
  row, each cell a mark; pipes, padding and the delimiter row are hidden, and the caret steps over
  them, stopping only in cells. Raw shows the source. A table inside a quote or a list item stays
  source. Column widths are computed from every row and held while the caret is in the table; a
  table never reaches past the text column, and scrolls sideways in its own box.
- **Typing in a cell.** Return and ⇧Return write a line break in the cell (`<br>`, drawn as a line
  break and deleted by one ⌫); ⌫ at a cell's start and ⌦ at its end do nothing, so cells never
  merge and the table keeps its shape; a typed `|` is written `\|`, and text pasted or dropped on a
  cell goes in as its text. A cell is one line of the file, and the format refuses an edit that
  adds, takes away or splits a cell (format §3.7).
- **Moving.** The arrows cross cells and rows; ↑ and ↓ go by visual line in a cell, then to the cell
  above or below at the same x (an empty cell too), and out of the table at its first and last
  row (↓ from a table that ends the document opens the empty paragraph after it, as Word and
  Docs keep one). Tab and ⇧Tab select the next and previous cell's text, and Tab in the last cell
  adds a row; ⌘↩ and ⌥⌘↓ are Insert Row Below, in the Table menu. To leave the table by keyboard, press
  Escape and then Tab (the editor's own way out of a text area, for two seconds) or use the system's
  (⌃M, ⇧⌥M); Tab with a selection that reaches out of its cell acts on the cell of its head. A press
  in a cell lands in that cell, also in an empty one.
- **A selection that reaches into a table** from outside it clears the cells of the rows it reaches
  and deletes the text outside the table as a selection is deleted, never joining across the
  table; one that covers a whole table deletes it as a block. Delete, Backspace, Return and typing
  all work, the last two writing after the deleting. The reached cells are drawn in the system's
  selection color.
- **Cells.** A selection whose two ends are in two different cells of one table is a rectangle of
  cells: every cell in the rows and columns between, both included. It is the ordinary selection and
  keeps no state of its own, so a drag that enters a second cell, a ⇧-press, ⇧ with an arrow (text
  in the cell first, then cells, then a cell at a time, growing or shrinking), and Undo making one
  all work. The cells are drawn in the system's selection color with the text highlight hidden;
  Both looks of Redlines draw them the same. Esc puts the caret in the cell where the selection
  ended; Tab goes on from there; ↩ does nothing. ⌘A is the cell's text, then the whole table,
  then the document. Select Cell, Row (⌃L), Column and Table are in the Table menu. A selected
  rectangle is not dragged anywhere (cells move by copy and paste). ⌫ and ⌦ clear every selected
  cell as one change (tracked, a deletion in each, in one group and one step to undo, the cells
  staying selected); typing clears them and types into the top-left one; ⌘B, ⌘I and the Format
  menu format each cell's text as one change; ⌘K is unavailable; a new comment is on the selected
  cells' text in one row and on the whole rows across rows.
- **Copy, cut and paste of cells.** Copying or cutting a rectangle puts tab-separated text (a cell
  that holds a tab, a line break or a quote in quotes) and an HTML table of the cells' newest text
  on the clipboard, the header row as `th` when it is the table's, and never markers; cut also
  clears the cells. A selection that reaches into a table copies the text outside it and the cells
  of the rows it reaches. A range (an HTML table from Sheets, Excel, Numbers, Word or Docs, or text
  with tabs) pastes over the cells from the caret's rightward and down, or from the selection's
  top-left cell, adding the rows and columns it needs (columns at the table's right); one value onto
  selected cells fills each. Tracked, each overwritten cell is a substitution (an insertion in an
  empty one) and each added row or column an inserted one, all one group and one step to undo; a
  paste that needs rows while a column is deleted or moved, or columns while a row is, is refused
  whole with its reason. Text without tabs goes into the cell (line breaks as `<br>`, pipes escaped); Paste as
  Plain Text puts anything into the cell with its tabs as spaces. A range pasted outside a table
  is a new table, as an HTML table was.
- **Rows, tracked as Word tracks them.** The Table menu's row commands count the selection ("Insert 2
  Rows Above", "Delete 3 Rows", "Move Row Up", every one a step to undo with its selection back);
  insertion adds as many rows as the selection touches, with the caret in the first new cell;
  deletion takes the rows the selection touches and puts the caret in the row that is then there;
  moving takes them one place, and they stay selected. A grip (⋮⋮) shows in the left margin beside
  the row under the pointer, left of the change bars and inside the window, in a layer over the
  editor that assistive technology does not see (the menu bar has every command); a press selects
  the row (⇧ extends) and opens its menu (Insert Above and Below, Delete, Move Up and Down, Clear
  Contents), Esc closes it and keeps the selection; a drag moves the rows, and the others selected
  with it, to any boundary, the last included: they dim, a copy follows the pointer, a 2 px line
  marks the drop, the page scrolls near its edges, Esc cancels. A + shows within 8 px of a row
  boundary in the strip beside the table, with a thin line across it, and a press inserts a row
  there.
- **Columns, the same.** Insert Column Left and Right (⌥⌘← and ⌥⌘→), Delete Column (⌃⌘⌫) and Move
  Column Left and Right (no default key) count the columns the selection touches ("Insert 2 Columns
  Left", "Delete 3 Columns"), each a step to undo with its selection back; the caret goes to the
  new column, in its row. A column's grip (⋯) stands above the column in the strip above the table,
  and never leaves it; a press selects the column (⇧ extends) and opens its menu (Insert Left and
  Right, Delete, Move Left and Right, the four alignments with the caret's column checked, Clear
  Contents); a drag moves the columns, and the others
  selected with them, to any boundary, the last included, with a vertical drop line and the page's
  table scrolling sideways near its edge; a + shows within 8 px of a column boundary in the strip
  above the table and a press inserts a column there. **An inserted column** has its cells in the
  author's tint and underlined with a bar on every row; a **deleted column** is a ghost cell in
  every row at its place, struck, counted among the columns when the widths are found, and skipped by
  the caret; a **moved column** has the double underline at its new place and a ghost with a double
  strikethrough at the old. The cards say "Inserted column", "Inserted 2 columns", "Deleted column"
  and "Moved column". Simple draws the bars and no ghost, tint or underline, as it does for rows.
- **Aligning columns.** Align Left, Align Center, Align Right and Default Alignment (no default key:
  Word's keys align the paragraph) are in the Table menu and the column grip's menu, the caret's
  column checked, and align the columns the selection touches, one step to undo with the selection
  where it was. **They work with Track Changes off** and write the delimiter row as it says, in the old
  row of a pending alignment change and in a pending move's copy too; with Track Changes on they are
  refused, in words ("Aligning a column with Track Changes on isn't ready yet. Turn off Track Changes to
  align it."), never silently (where the closer of a tracked alignment change should stand is open, #281).
  A tracked alignment change that another tool wrote (a format change around the table, format §3.7,
  rule 5) is read, drawn, carded and decided: the new alignment shows in every row of the column in
  every view, and in Redlines the header text of each column changed has a dotted underline and the
  header row a bar; Simple draws the bar alone, Clean nothing. Its card says "Formatted: column Count
  centered (was left)" and is found on the header row; accepting keeps the alignment and rejecting
  writes the old one back. A tracked edit right under its table is refused while it is pending ("Bo
  Chen's alignment change to the table above is pending. Decide it first, or turn off Track Changes."),
  and every column command is refused until it is decided; rows are never in the way.
- **An inserted row** is written, decided and viewed as format §3.7 and §8 say: in Redlines its cells
  take the author's tint and its text is underlined in the author's color, with a change bar on the
  row; Clean shows the plain row. A **deleted row** is kept below the table in the file and drawn in
  Redlines as a ghost row at its place, a row of cells in the table's columns: its text struck in the
  author's color on the author's tint, with a bar, not editable; the caret and ↑ ↓ skip it, a press
  on it opens its card and puts no caret there. A **moved row** has a double underline and the tint at
  its new place, and a ghost with a double strikethrough at the old; its card is the moved row's, and
  accepting or rejecting either half decides both (rejecting moves the row itself back, with what
  was typed in it since). The cards say "Inserted row", "Deleted row" and "Moved row" (and
  "Deleted 3 rows" for rows deleted together). Simple draws the bars of the same rows and no ghost,
  tint, underline or struck text (a deleted row has no row there to carry its bar), and shows what
  Clean shows. Rows that another person's changes are in can be moved (their changes travel with them)
  but not deleted until those are decided; an agent that replaces a table with the table it wants
  changes rows and columns as these commands do (format §3.7, "Agents"). The rest of the list above
  arrives in the later stages.

### 5.9 Command palette and shortcuts

**The command palette** opens with ⌘⇧P (Ctrl+Shift+P on Windows and Linux): fuzzy search over
every command, with its shortcut, and recent commands first. One command registry serves the
menus, shortcuts, the palette, plugins and agents.

| Action                         | macOS                                                                                         | Windows and Linux         |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------- |
| New paragraph, line break      | Return and ⇧Return                                                                            | Enter and Shift+Enter     |
| Command palette                | ⌘⇧P                                                                                           | Ctrl+Shift+P              |
| Track Changes on or off        | ⌘⇧E                                                                                           | Ctrl+Shift+E              |
| New comment                    | ⌘⌥M                                                                                           | Ctrl+Alt+M                |
| Post a comment                 | ⌘↩                                                                                            | Ctrl+Enter                |
| Next and previous change       | ⌘⌥] and ⌘⌥[                                                                                   | Ctrl+Alt+] and Ctrl+Alt+[ |
| Find, next, previous           | ⌘F, ⌘G and ⇧⌘G                                                                                | Ctrl+F, Ctrl+G and Ctrl+Shift+G |
| Find and Replace               | ⌥⌘F                                                                                           | Ctrl+Alt+F                |
| Clean, Redlines, Raw           | ⌥⌘1, ⌥⌘2, ⌥⌘3                                                                                 | not chosen yet            |
| Bold, italic                   | ⌘B and ⌘I                                                                                     | Ctrl+B and Ctrl+I         |
| Code, strikethrough            | ⌃` and ⌃⇧`                                                                                    | Ctrl+` and Ctrl+Shift+`   |
| Subscript, superscript         | ⌥⌘, and ⌥⌘. (Word's ⌘= and ⇧⌘= are Zoom In here)                                              | Ctrl+Alt+, and Ctrl+Alt+. |
| Link, clear formatting         | ⌘K and ⌘\                                                                                     | Ctrl+K and Ctrl+\         |
| Body, Heading 1 to 6           | ⇧⌘N and ⌘1 to ⌘6                                                                              | Ctrl+Shift+N and Ctrl+1 to Ctrl+6 |
| Quote, bulleted, numbered, task list | ⌘⌥Q, ⌘⌥U, ⌘⌥O and ⌘⌥X                                                                    | Ctrl+Alt+Q, U, O and X    |
| Check item (task list)         | ⇧⌘U (checks or unchecks the task items in the selection; it replaces CodeMirror's "redo selection" on the Mac, which Redlines no longer binds there) | Ctrl+Shift+U              |
| Code block, table              | ⌘⌥C and ⌘⌥T                                                                                   | Ctrl+Alt+C and Ctrl+Alt+T |
| Show the formatting palette    | ⌥⌘P                                                                                           | Ctrl+Alt+P                |
| Ask about the selection        | ⌥⌘A (the box opens at the selection; Return asks, Esc closes)                                 | Ctrl+Alt+A                |
| In a table: next, previous cell | Tab and ⇧Tab (Tab in the last cell adds a row)                                              | Tab and Shift+Tab         |
| In a table: line break in a cell | Return or ⇧Return                                                                           | Enter or Shift+Enter      |
| In a table: insert row above, below | ⌥⌘↑ and ⌥⌘↓ (⌘↩ also below)                                                              | Ctrl+Alt+Up and Down (Ctrl+Enter below) |
| In a table: delete row, move row up, down | ⌥⌘⌫ (also ⇧⌘K), ⌥↑ and ⌥↓                                                            | Ctrl+Alt+Backspace, Alt+Up and Down |
| In a table: insert column left, right; delete column | ⌥⌘← and ⌥⌘→; ⌃⌘⌫                                                                 | Ctrl+Alt+Left and Right; Ctrl+Win+Backspace |
| In a table: select cells       | ⇧ with an arrow, ⌘A (cell, table, document), ⌃L (the row), Esc (a caret)                      | Shift with an arrow, Ctrl+A, Ctrl+L, Esc |
| Indent, outdent                | ⌘] and ⌘[                                                                                     | Ctrl+] and Ctrl+[         |
| Paste as plain text            | ⇧⌘V                                                                                           | Ctrl+Shift+V              |
| Zoom in, zoom out, actual size | ⌘=, ⌘- and ⌘0                                                                                 | Ctrl+=, Ctrl+- and Ctrl+0 |
| Larger, smaller, actual text size | ⌃⌘=, ⌃⌘- and ⌃⌘0, or a pinch                                                               | a pinch                   |
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
| **Markdown**    | Any `.md`, `.qmd`, `.Rmd` or `.txt` file                                                                                                 | Clean export (every change accepted), the review view, and Word through the pandoc filter for R Markdown and Quarto                                                                                                                                                              |

- **Paste rules:** a pasted table without a header row gets its first row as the header, because
  GFM tables need one. Images pasted from the web keep their URLs. Lists and paragraphs inside
  pasted table cells are kept. Pasting a URL onto a selection makes it a link, replacing an
  existing link rather than nesting one. ⇧⌘V pastes plain text. Copying cells puts tab-separated
  text and an HTML table; pasting a range into cells is §5.8.
- **A paste never creates marks from the clipboard's content.** Pasted text that holds Redlines
  markup is pasted as its newest text, without the markers or the ledger, so a paste can't forge
  someone else's change. Copy works the same way: Clean and Redlines, in either look, copy the newest text, and Raw
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
- links from pasting a URL onto a selection (§5.10), and ⌘-click to open one (§5.2);
- R Markdown and Quarto chunk options kept byte for byte.

**Should (v1 if time allows):**

- a selection toolbar: Comment, Suggest, Ask, and formatting. Written as the formatting palette
  (§5.1), which opens from a handle and on right-click rather than floating over a selection by
  itself, with Ask (§8.5); Suggest and the agent's fix, shorten and rephrase are not in it yet;
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
for front matter; merge conflicts shown as tracked changes; reading settings per viewer (a
reading width, a dark page).

**Not in v1:** anything other tools couldn't show (columns, @mentions and dates in body text,
wiki-link storage, stored embeds, text color); a notification service of our own (apps such as
Syrus and GitHub notify); paragraph locking.

### 5.13 Undo

Undo goes back in time through what this window did: your edits, decisions, comments and replies,
turning Track Changes on or off, and the runs of your agents (§8). ⌘Z takes back the newest step and ⇧⌘Z puts it back; the history
lasts while the document is open. A run is one step, its suggestions or direct edits, its comments
and its reply, so one ⌘Z after a run gives the document back as it was; where your own edits came
between its edits, each stretch is a step, in time order. Your agent's changes from outside, made
through the `redlines` command line in its name, are a step each when they are nothing but its
suggestions, comments and replies. Someone is your agent when the file, before the change or after
it, lists them with `agent: true` and `for:` you. What other apps, people and their agents did
stays: ⌘Z never takes it back, and a tracked change of theirs is rejected like any. Undo makes no
mark, with Track Changes on or off, and waits for ⌘S like any edit. Saving records the view in the
step before it rather than as a step of its own, so one ⌘Z after ⌘S takes back the last edit,
as it did before.

### 5.14 Writing in blocks

A document is a sequence of blocks: paragraphs, headings, list items, quotes, code, tables. The
person writes blocks; the editor writes the breaks between them, the line breaks, blank lines and
syntax Markdown needs, and never shows them.

- **Blank lines are the space between blocks.** Clean and Redlines draw no blank line, only the
  space, by the kinds of the blocks either side (§6.6), whatever blank lines the file has.
- **Return makes a block, Shift-Return a line break.** Return in a paragraph's text parts it in two;
  at its end it opens an empty paragraph below; at its start, one above, the caret staying with
  the text. In a list it makes an item, and in an empty item it goes up a level or out of the list.
  Shift-Return writes a hard line break, a backslash and a line break (drawn as a break, the
  backslash hidden and stepped over); at the end of a paragraph's text it opens an empty line in the
  block, which is taken back when the caret leaves it, as the empty paragraph is. A heading and a table cell
  are one line in Markdown: Shift-Return is refused inside them, with a word of why, and over a
  selection there it refuses before it deletes anything. At a heading's start or end it does what
  Return does (an empty paragraph beside it).
- **The empty paragraph exists while you're in it.** Markdown keeps no empty paragraph, so the one
  Return opens is taken back when the caret leaves it, and the file never gets it: saving, the
  edited state and agents read the document without it.
- **Typed syntax makes a block on the space.** In an empty paragraph `#` and a space is a heading,
  `-` or `1.` and a space an item, `>` a quote at once, three backticks a code block closed at
  once, `---` and Return a thematic break, and `| a | b |` and Return a table. A lone `#` or `-`
  is drawn as body text until the space completes it. The Paragraph menu writes the same syntax on
  an empty paragraph (Body does nothing); an empty heading, item, quote or code block stays when
  the caret leaves it, an empty paragraph goes.
- **Backspace right after Return takes it back,** exactly, byte for byte, from a record of the
  Returns pressed one after the other.
- **Backspace and Delete join at block edges.** Backspace at the start of a block's text joins it to
  the block above, which keeps its kind; Delete at the end joins the next. An empty block goes.
  Nothing joins into code, a table or front matter: the caret goes there instead. At the start of
  a list item, the first Backspace takes the bullet off and keeps the text where it is, the second
  joins it to the item above, as in Word.
- **The caret crosses a break in one press,** ← and → over hidden syntax and blank lines alike.

Where Redlines departs from Word, and why: Return in an empty paragraph does nothing, because
Markdown has no form for a second empty paragraph; a hard break is a backslash, not two trailing
spaces, because it survives editors that trim spaces; Backspace never joins text into code or a
table; and Return in a table cell writes a line break in the cell (`<br>`), as the other word
processors start a new paragraph there (§5.8).

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
| `@redlines/editor`     | The editor core on CodeMirror 6: Markdown display, the tracked-change layer, the Clean, Redlines (in two looks) and Raw views, modes, undo, find, the command registry, settings, theme tokens and the plugin host | Browsers and webviews |
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
| `apps/website-embed`   | The editor with the review interface and a scripted agent, built as a bundle for the website; no desktop code, which the lint rule that keeps Tauri out of shared code checks (it covers `apps/embed-smoke`, the smallest embed, which holds the core's size, too) | Browsers                |
| `apps/desktop`         | The desktop app: a Tauri v2 shell, in Rust, around the editor                                                                               | macOS, Windows, Linux   |
| `apps/desktop/quicklook` | The Mac app's Quick Look preview of Markdown, R Markdown and Quarto files: the Clean view as HTML, made by a bundle of `@redlines/format`, micromark and the Default theme's CSS, and the Swift extension that runs it in JavaScriptCore (§10) | macOS (the system's JavaScriptCore) |
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

Preferences › General › Command line › Install links `/usr/local/bin/redlines` to the app's copy,
and makes that folder if it is missing. macOS puts `/usr/local/bin` on every shell's `PATH`
(`/etc/paths`), so `redlines` then works in any new Terminal window, and the pane says so and where
the link is. The link is the Mac's, not one account's: `redlines` runs the copy of the app whose
Install made the link, for every account, and another account's Install points it at its own copy.
An update replaces the app, and the link follows. Where the folder may be written to, nobody is
asked. Where it needs an administrator, macOS asks for the password in its own dialog (`osascript`,
`do shell script … with administrator privileges`), and the app never sees it. What runs as an
administrator is one fixed script, which looks at what is there and links in the same step; the
program and the link reach it as arguments, which AppleScript's `quoted form of` gives the shell,
and never as part of its text. The app looks again afterwards, and says linked only when its own
link is there. Only Redlines' own link is ever replaced: nothing there, or a link to the program of
some copy of the app (`….app/Contents/MacOS/redlines`). Anything else there is left, and the pane
says what it is, without asking for a password first. If the person cancels or isn't an
administrator, or the folder can't be used, the pane says the command line wasn't installed and
offers Install in Your Home Folder: the link in `~/.local/bin`, which needs no password, with a line
when that folder isn't on the `PATH`. Neither button links a copy that won't stay where it runs:
one on its disk image or on another disk in `/Volumes` (an external drive, a second volume, a
network share), or one translocated by macOS. As for updates, it is refused before anything is
asked, and the pane says to move Redlines to the Applications folder and open it from there. In a
checkout, `pnpm -s redlines` runs the TypeScript directly.

The app carries one more program, the Quick Look extension (§10), as
`Redlines.app/Contents/PlugIns/RedlinesPreview.appex`. Tauri builds no app extensions, so
`scripts/build-quicklook` makes it as part of `pnpm build`: it bundles the renderer
(`apps/desktop/quicklook`), compiles a small Swift extension for both architectures with `swiftc`,
and signs it, and `bundle.macOS.files` copies the folder into the app. Tauri signs the app and the
programs it copies and never a plug-in, so the extension is signed before Tauri seals the app, with
the same identity and the sandbox entitlement that an app extension must have
([releasing](releasing.md#the-quick-look-extension)).

### 6.4 Plugins

**The core** (`@redlines/editor`) holds:

- display and editing of all the Markdown in §5.2; code, math and diagrams appear as formatted
  source until their plugins render them;
- the tracked-change layer: showing marks, editing with Track Changes on, accepting and
  rejecting, the views and Track Changes;
- comment anchors and the ledger;
- undo, find and replace, and the platform's spellcheck, on by default in the app;
- the command registry and palette, shortcuts, settings, theme tokens (§6.6) and the plugin host.

**First-party plugins** ship with the app, use the public API, and can each be turned off. The
table is the plan. Written so far: `review`, `themes`, `code`, `find`, `formatting`, `outline`, `tables` (the Table menu),
`agents` and the three providers (`plugins/`). The `ai` row is what `agents` is growing toward: its chat panel isn't
written.

| Plugin       | Adds                                                                         | Needs from the host        |
| ------------ | ---------------------------------------------------------------------------- | -------------------------- |
| `review`     | The review bar, change cards, the comment rail and the Changes tab           | Document data, for drafts  |
| `tables`     | Table editing: the Table menu now; grips, selection, moves, pasting ranges to come | —                    |
| `math`       | Rendered math                                                                | —                          |
| `diagrams`   | Rendered Mermaid diagrams                                                    | —                          |
| `code`       | Syntax colors in code blocks                                                 | —                          |
| `paste`      | The paste pipeline and paste options                                         | Clipboard                  |
| `word`       | Copy for Word, and `.docx` import and export                                 | Clipboard, files           |
| `print`      | Print and PDF export through the paginator                                   | Printing                   |
| `export`     | HTML, clean Markdown and review-view export                                  | Files                      |
| `outline`    | The outline of the headings in the left margin; dragging sections to come    | —                          |
| `workspace`  | The folder sidebar, Quick Open and folder search                             | Files                      |
| `git`        | Optional git features (§7.4)                                                 | Files, git                 |
| `collab`     | Live sessions: presence, cursors and invitations (§7.1, §7.2)                | Network                    |
| `ai`         | The chat panel, Ask, agents in comment threads, agent levels (§8)            | Agents                     |
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
files, or keeping a little private data for the document (`document:data`: each plugin's own,
which the host keeps by the document's real path and moves with it on Rename and Save As). Plugins that change how the editor draws (syntax, renderers) run inside the editor and need
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
| Document data | The page's local storage, bounded (§5.7)         | Whatever the app provides, or none   | The webview's state       |

A host may supply none of these. The website's demos supply no files, no clipboard beyond the
browser's, no printing, no network, no document data and a scripted agent, and the editor degrades
without each: a half-written comment is gone with the page, and nothing is saved.

**What a desktop window may read.** The files the person opened or saved (§11), and, through
`asset:` URLs, the images in the project folders the sidebars show, hidden files left out: a file
whose name and first bytes both say it is an image the preview shows, sent with a policy that lets
nothing in it run. No window goes to an `asset:` URL itself. A drop on a window adds nothing of
itself: a document dropped opens as one from Finder does, and is the window's, with its project's
images, as any document the person opens is (but for the file that the window's own document icon
dragged, dropped back on that window, which opens nothing); a folder or any other file dropped opens nothing, and
lets the window read nothing it couldn't before. Tauri adds everything dropped on a window to the
scope of its own asset protocol, a folder with all it holds, so the app serves `asset:` URLs itself
and builds Tauri without that protocol.

### 6.6 Styling

Everything Redlines draws, the document and the interface, takes its look from design tokens: CSS
custom properties for fonts, sizes, spacing, colors, radii and the colors of authors. The core
defines the tokens and styles everything through them. A theme is a CSS file: token values, plus
optional rules for document elements. People can add their own themes.

- **Built-in themes:** Default, Book and Editorial, each in a light and a dark version. Default is
  the default. One theme is chosen, for light and dark alike, and the appearance is Match System
  (the default), Light or Dark: Match System follows the system's appearance as it changes, and
  Light or Dark holds whatever the system's is. A change reaches every window at once, About
  Redlines among them, and the windows opened later: the page, and the window itself, its title
  bar, scroll bars and the system's menus and dialogs. Redlines starts in the appearance chosen,
  so no window opens in another first. The theme is each person's own, like the markup view they
  remembered: files store no theme, and Copy for Word, PDF and the exports use the current theme.

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
- **Interface text is never too small to read.** A quiet interface still reads easily: its text is
  at least 13 px, and a caption, a timestamp or a hint at least 12 px, in every window and at
  every text size. The built-in themes use 14 and 13 px, which in Carlito read as large as the
  system's own 13 pt. View › Zoom Out below 100% makes all of it smaller, as the person asks.
- **The default look:** a centered column of about 94 characters a line (680 px at the theme's own
  size), which grows with the text size until it meets the margins; body text at about 17.5 px with a line
  height of about 1.55, in dark gray rather than black; headings in the body's family, with no rule
  under them; tables with horizontal rules only; generous, even space between blocks, drawn by
  their kinds, whatever blank lines the file has: the theme's tokens `--rl-space-block` (16 px),
  `--rl-space-h1` (18 px, under a heading 1), `--rl-space-heading` (10 px, under headings 2 to 6),
  `--rl-space-item` (6 px, between a tight list's items) and `--rl-space-loose` (16 px), at the
  theme's size.
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
  the theme's fonts, so it looks the same as in the desktop app. The website's demos are the first
  host that does this: the editor sits on the page's sheet with the page's surface and ink colors.
- **Print, PDF and Copy for Word use the same tokens,** with a print scale (body text at 11 pt), so
  they look like the screen. They never take the window's zoom or the text size.

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
  - Undo takes back your own steps (§5.13). A remote change stays, and a step it touched is
    refused, or, for a suggestion of yours someone edited inside, rejected by its id.
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

A change from outside isn't undone by ⌘Z (§5.13).

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

### 8.2 Agent levels: Propose, Suggest, Auto

| Level       | What the agent's edits become                                                                                                                        | Suits                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Propose** | Nothing is written. The agent proposes edits in the chat as a diff, and **Apply** or **Suggest** writes them                                         | Exploring; sensitive documents |
| **Suggest** | Tracked suggestions in the agent's name, for anyone to accept or reject                                                                              | Shared documents and review    |
| **Auto**    | Direct edits, as when you type with tracking off. They appear as they are written, and the run ends with "Claude changed 3 paragraphs · Review · Undo" | Your own drafts                |

- **By default, an agent follows its person's Track Changes setting:** Auto while it's off, Suggest
  while it's on. Each agent can be set to one level instead, per document or everywhere.
- **Review after Auto.** Review overlays a temporary redline of the run, worked out from the text
  before it started, with Keep and Undo for each change. It is never saved in the file, and closing
  it keeps the changes. Review › Undo is ⌘Z while the run is the newest step (§5.13); afterwards it
  reverts the run's changes that nobody edited since, as a step of yours.
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
| `str_replace` | `path`, `old_str`, `new_str`         | `old_str` must match the newest view once. A rewrite is one change, a small fix stays small ([§3.11](format.md#311-changes-from-a-new-text)) |
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
chat panel; and Ask, a question about a selection (§8.5).

**Agent runs.** Each request, a chat turn or a mention, is one run. Each edit in it (one `str_replace`) that makes several marks gives them a `group` of their own, so the marks of one edit are one suggestion and two edits of a run never are.

- The thread or chat shows "6 suggestions · Accept all · Reject all · Show", and an Agents chip
  filters all agent work.
- A rewrite reads as one change: a paragraph that keeps fewer than half of its words is the old
  paragraph replaced by the new, decided with one Accept, and a light edit keeps a mark for each
  word or phrase it changed.
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
  finished ones, which one ⌘Z takes back.
- **Collaborators see the same animation** through the presence channel. The authority receives
  each edit only when it is complete, as one change.
- **Where a provider doesn't stream an edit's text,** the finished edit plays back at reading
  speed. Long runs speed up, and Reduce Motion or a setting shows results without animation.

### 8.5 Chat

- **A chat panel** next to the comment rail. Its scope is the selection, the document, or the
  folder (a project or repository).
- **Answers cite the text,** with links to ranges in the document. Chat never shows raw markers.
- **Edits follow the agent's level** (§8.2). In Propose, the panel shows each proposal as a diff
  with Apply and Suggest. A chat answer can also be posted to the document as a comment thread.
- **Ask** is a question about a selection, answered beside it without opening the panel:
  - **Starting it.** Select text and choose Ask: ⌥⌘A, Format › Ask…, or the Ask item of the
    formatting palette (§5.1) beside Add Comment. A small box opens at the selection for the
    question, and an empty first question means "Explain this in the context of the document." (A
    Return in an empty follow-up field asks nothing.) The default agent answers, and @ picks
    another, as in a comment. Not in Raw, where a selection
    holds markers that no answer could be about. (Fix, shorten and rephrase are not part of it.)
  - **The same access and guardrails as a comment's run:** the agent reads what the Agents pane
    allows (the document, or its folder), the first time it is asked in a folder the same question
    is put in the bubble, and what the document holds is untrusted, as for every run.
  - **Read-only.** The agent is given the tools that read (`view` and `status`) and nothing that
    writes, the document it reads refuses a write, and its answer is its last message: nothing is
    written to the file or its ledger. Each run still writes its log. That guarantee is the
    Redlines tools'. For the agents Redlines can hold to their reading (Claude Code and Codex) the
    agent itself is read-only too, while an agent the person added may act on its own, as its own
    settings allow, which Redlines can't stop: its first-run question says so, and does not say
    that it changes nothing.
  - **The bubble** hangs beside the selection in the comment rail's style, and shows the agent's
    live line while it works (what it is doing, with Stop), then the answer. The selection stays
    tinted while it is open. Esc or a press elsewhere closes it, and stops a run still going. A
    failure stays on the line with its log, and with a button that opens Preferences where they
    can put it right (the agent is signed out or too old), as a comment's run does.
  - **Citations.** The answer marks the passages it used as [1], [2] and lists each under
    "Sources:" by its exact words. The bubble finds the words in the text as a reader sees it, as
    an agent's `comment` finds its quote, and makes the marker a link that selects the passage. A
    quote links only where its words stand as words ("lien" is not in "alien", and a quote of one
    character is no link), and where they are in several places the link goes to the one nearest
    the selection. A quote that is not in the document is plain text with no link, which tells a
    made-up citation from a real one, and says "not found in the document" to a screen reader.
  - **A follow-up** has a field of its own, and is answered with the exchange so far as context. It
    may name another agent: each answer is the reply of the agent that gave it, in the bubble and
    in Make Comment. The earlier answers go to the agent as quoted data, never as instructions.
  - **Keeping an answer.** Make Comment makes a thread on the selection, as one step to undo: the
    first question is the person's comment, its answer the agent's reply in the agent's name, and
    each follow-up and answer a reply, in turn, each agent reply cut to the limits of any agent's
    reply (§5.7). Open in New Window opens the exchange as an Untitled document, and the bubble
    goes once the window is open: if it can't be, a notice says so and the bubble stays. Copy puts
    the answer's text on the clipboard. Nothing is kept unless asked.
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
| **Other agents,** such as GitHub Copilot, Gemini and OpenClaw | One provider for the Agent Client Protocol, given a command to run | Each agent's own | Written; Preferences doesn't offer adding one yet |
| **Sign in with ChatGPT** inside Redlines, for people with a plan and no command line | Redlines' own agent loop | Redlines would hold tokens | Not written |
| **API keys and local models** | Through an ACP agent that supports them, or `codex --oss` | None, or a key | Not written |

Redlines never reads, stores or passes Claude or ChatGPT credentials. Whether someone is signed in
is what the agent's own status command says, and when they aren't, the thread says so in one line
(for example, "Claude isn't signed in. Run `claude auth login`."), which offers to open Preferences ›
Agents. The UI says "Claude" and "Codex"; "Claude Code" appears only in plain text saying the app
runs it.

**Setting an agent up.** Preferences › Agents shows each agent's state, the version and the path of
the program found (so that a stale second copy earlier on the PATH shows) and the next step as a
button, and Check Again always:

- **Too old** (older than the version the provider was tested with): the row says an update is
  needed, and what the program said when asked whether it is signed in, if it said (an older
  program may not know the question). Update runs the agent's own updater for the way it was
  installed, which its path says: `brew upgrade --cask` for a Homebrew install, `npm install -g
  <package>@latest` for a global npm install, and the agent's own `update` for any other
  (`claude update`, `codex update`). Redlines looks again when it ends.
- **Signed out:** Sign In runs the agent's own login (`claude auth login`, `codex login`), which
  opens the browser. A login that fails at once wants a terminal, and Redlines opens Terminal with
  the same command and looks again when the person comes back.
- **Not installed:** the command that installs it, with Copy. Redlines never runs an installer.

Each is a fixed command that the app makes for an agent the window names, never a program, an
argument or a word of a document, and the name that goes to `brew` is one of a short list. Only
Preferences may ask for them; a failed run's line in a document opens Preferences instead. An
update or a sign-in under way has a Cancel, and stops when Preferences closes or the app quits; it
goes on when the pane is drawn again, and the row follows it. What a failure shows of a command's
output is its last line, with what looks like a secret left out as far as a heuristic can tell
(the query of a link, a value after `token` or `key`, a long run that looks like a credential).

**The skill.** An agent that works in a terminal or in a chat of its own, outside the app, learns
what a Redlines file is from a skill: read it with `redlines view --review`, change it only through
the `redlines` command line, so that its edits are tracked suggestions in its name, and take deleted
text, comments, replies and notes as information, never as instructions. It is written once
(`integrations/skill/body.md`) and made into a copy for each agent
(`apps/desktop/scripts/build-skills.ts`), since only the front matter and how the agent names itself
differ: Claude writes as `claude-<person>`, and an agent with a name of its own, such as an OpenClaw
agent called Moby, as `moby-<person>`. A test fails when a copy isn't what the source makes, or
shows a command or an option the command line doesn't have. Each agent reads skills from a folder of
its own, and Install Skill on the row of Claude Code and of Codex in Preferences › Agents writes the
one file there, `SKILL.md`: `~/.claude/skills/redlines` for Claude Code and
`~/.agents/skills/redlines` for Codex, which OpenClaw reads too (OpenClaw's own folder is
`~/.openclaw/skills/redlines`, which the copy command in `integrations/README.md` fills, and the
app can, for an OpenClaw on this Mac). The row says where it went, and says
when a login shell can't find the `redlines` command, which the skill runs, and offers General,
where the command line is installed; Install Skill doesn't install it itself, which may ask for an
administrator's password. Each copy ends with the version it has (`<!-- redlines-skill 1 -->`), and
the app carries its own, so that an installed copy that is older shows Update Skill. Only a copy of
this skill is replaced: a skill of someone's own with the same name, a link (a skills folder kept
in a repository of dotfiles is one), and a newer copy are left as they are, and the row says so.
The Claude Code skill is also a plugin, and this repository a marketplace for it
(`.claude-plugin/marketplace.json`); publishing the skill on ClawHub, OpenClaw's registry, is its
owner's, and the steps are written down (`integrations/README.md`), not done.

**Written with the limits that hold.** What an agent may read is what it really can read, not what
it was asked to:

- Claude runs with `--restricted`, which confines its file tools to the document's folder,
  symlinks included, whatever its owner's own settings allow, and offers no read tool at all for
  "Just This Document". Its hooks, and the person's settings, skills and `.mcp.json`, don't run
  (`--restricted` leaves an installed skill out: its first event lists the built-in skills only).
- Codex runs with a permission profile that makes macOS refuse a read outside the folder, for its
  shell, its image viewer and its helper agents alike, with its user configuration, its rules, its
  hooks, its skills (the person's own, Redlines' skill, and Codex's built-in ones such as image
  generation and the skill installer, are for Codex run by hand) and the person's ChatGPT
  connectors turned off. `--sandbox read-only` isn't used: it
  blocks writes but reads anywhere.
- At **This folder and my home folder** the same limits hold with the home folder added, and what
  is private left out *by the limits*, not by the prompt: Claude is granted each visible folder of
  the home folder (`--add-dir`, a link by its name and its target), so that a hidden folder and
  `~/Library` aren't readable at all however it searches, plus the cloud folders in `~/Library`,
  and its settings deny `.env` files and hidden files and folders below the home folder. Codex's
  profile grants the home folder whole, denies hidden names and `.env` files by glob wherever they
  are and `~/Library` but for its cloud folders, and grants a folder a link leads to outside the
  home folder by its real path. Both are checked against the real programs
  (`agent-limits.real.node.test.ts`, on request) and the command lines against the rule that lets
  only them through.
- Both change the document only through the toolbox's tools, which record tracked changes in the
  agent's name. They can't accept, reject or resolve.
- A run whose toolbox never connected counts as failed, because both agents otherwise carry on
  without it and exit 0.

**Scope** is the setting What agents may read, in Preferences › Agents: This document, This folder
(the default; the repository's root, or else the document's folder) or This folder and my home
folder. The setting is the most that any answer can give. The first run of an agent in a folder
asks in its thread (§5.7) what it may read, within the setting (the home folder is an answer only
while the setting allows it), and the answer is remembered for that agent and folder in the app's
settings, never in the document: an answer narrower than the setting stands, and one wider than
it is held to it and kept, and stands again if the setting is widened. A document in the home
folder itself, or in the disk's root, has no folder to read, and is read as This document.
Preferences › Agents lists the agents found on this Mac with their state (not installed, needs an
update, signed out, signed in), the remembered answers with a Forget button for each, and Show
Agent Logs.

**The home folder.** This folder and my home folder lets an agent read related files anywhere
under the home folder, such as a reference document in another project. The default stays This
folder, and the pane says plainly what the choice means:

- **Left out even there:** hidden files and folders (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`,
  `.env` files) and `~/Library` (mail, messages, browser data, keychains), except the cloud
  folders in it (`~/Library/CloudStorage`: Dropbox, Google Drive, OneDrive, Box; `~/Library/Mobile
  Documents`: iCloud Drive), where people's documents live, often behind a link in the home
  folder. The limits name both a link and the folder it leads to, and a link is followed only to
  where it may be: never to `/`, to the home folder or to a folder above it, to a hidden folder, or
  into `~/Library` but for its cloud folders, and, where it leaves the home folder, only to a
  volume or what is in one (`/Volumes/Backup`, not `/Volumes`) or to the shared folder
  (`/Users/Shared`): the system's own folders are the same files as the home folder's under another
  name (`/System/Volumes/Data/Users/...`), or not a person's. A link that leads anywhere else gets
  neither its name nor its target, since the name alone would reach it. The home folder is named as it really
  is, the agents' limits looking at real paths, and a hidden name is left out below each folder a
  link leads to outside it too. A home folder whose name holds a character of a glob (or a quote or
  a backslash), or that holds no folder to read, gives the folder alone, and the line says so.
- **Writes don't change.** The agent still writes only through Redlines' tools, to the document.
- **The risk:** text in a document that someone else wrote (a comment, a reply, deleted text)
  could try to make an agent read a private file and quote it into a comment or a suggestion,
  which then travels with the document. The note says so, and so does the question's answer.
- **macOS asks.** Documents, Desktop, Downloads, iCloud Drive, other cloud folders and removable
  and network volumes are protected, and macOS counts what an agent that Redlines starts reads as
  Redlines' own, so it asks whether *Redlines* may read the folder, in words the bundle gives
  (`document-types.plist`, true whenever Redlines itself touches the folder). The app lists each
  protected folder itself, from its own process, when the person picks the choice, and before each
  run at it, which is what makes macOS ask, at a moment they expect: the first-run question says
  so, and the run's line says it is checking what macOS allows, for as long as the person takes to
  answer, up to twenty seconds (a network volume that has gone never answers), before the folders
  are listed again for the agent's line. A folder macOS refuses is said in a line with a button to
  Privacy & Security › Files and Folders; the run goes on, and the agent is told which folders are
  out of reach, so that its reply doesn't guess.
- **A read that fails inside the scope** is said in a notification as it happens: which file, the
  likely cause, and what to do. macOS isn't letting Redlines read a folder (a button to System
  Settings); the file's own permissions refuse it; the agent's own settings, or an organization's,
  do; or the agent's own words with Show Log, where they read as a refusal or a failed read. A
  refusal outside the scope, or of what the scope leaves out (hidden names and `.env` files by any
  name), is a limit doing its work, and is never told of, nor is a failure that is no refusal: a
  file that isn't there, a folder, a file too large. It is read from Claude's tool results, and
  from what Codex's commands print, which is best effort: the newer Codex models run most commands
  through a tool that makes no event, and a command that prints a refusal's words is taken for
  refused. The limit holds either way; only the message is missed.

Not done: search that skips files not downloaded from a cloud folder (macOS marks them dataless),
which the agents' own search tools decide; the agents are not stopped from downloading a file they
read; and a message of its own for a cloud file that isn't on the Mac, which reads as the agent's
own words where the agent says it timed out. Search skips links in both agents, and the prompt says
so, so that the agent names a folder that is a link.

**The log.** Every run writes a log, one JSON Lines file, in `~/Library/Logs/md.redlines.editor/
agents/`: what was started (the agent, its version, the flags, the folder), each event the agent
sent, each tool call with its result, and how the run ended. Help › Show Agent Logs opens the
folder. Logs quote the document and the folder, so they stay on this Mac and are deleted after 30
days; they hold flags and events, never the environment, so no credential lands in one.

**Where the work happens.** The tools run in the app, against the live editor, so the app is the
only writer to an open document. Posting the comment that starts a run saves the document, and while
it has no unsaved edits, each agent edit is saved as it lands. An Undo is the person's edit, and
isn't saved for them: taking back a saved run leaves the document unsaved. A run belongs to its
document: while one is live, anything that would replace the document opens a new window instead. A
second mention in a thread waits for the first run to end.

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
| **Claude**                          | The command line and MCP server; a skill, which is also a Claude Code plugin (written); later, the plugin's hooks, which block raw marker edits and turn Claude's ordinary edits into tracked changes ([research](research/llm-hosts.md)) | v1 (server, skill, plugin), v1.x (hooks) |
| **Codex and ChatGPT**               | The same MCP server, a skill in `~/.agents/skills` (written) and an `AGENTS.md` snippet                                                                                                            | v1 (skill), v1.x                  |
| **OpenClaw**                        | A skill in `~/.openclaw/skills`, loaded only where the `redlines` program is, for ClawHub too (to be published by its owner); the agent itself through the Agent Client Protocol (§8.6)                                            | v1 (skill)                        |
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
  services: spell checking, autocorrection, text replacements, smart quotes and dictation.
- **Web:** the embeddable component, tested in Chromium, WebKit and Firefox.
- **Mobile:** iOS is undecided. Editing by touch would need its own work.
- **Quick Look (macOS).** Space on a Markdown, R Markdown or Quarto file in Finder, Mail, Spotlight
  or the Open dialog shows the Clean view (§5.3): every pending change accepted, in the Default
  theme, as the Mac app draws a document. A file that has changes or open comments waiting in it
  has one line over the text that says so and points to the app ("4 changes and 2 comments by
  Claude and Bo. Open in Redlines to review them."); the markers and the ledger never show. Front
  matter is shown plainly, dimmed, and so are the options of an R Markdown or Quarto chunk, as a
  line over its code. Raw HTML in the document is text, never live, and an image is its alt text.
  - **One renderer.** The extension is a Quick Look *preview extension* (`QLPreviewProvider`, an
    `.appex` in `Contents/PlugIns`), the supported way since macOS 15 stopped loading generators.
    It carries a bundle of `@redlines/format` (`newestView`, the count of what waits),
    micromark with GitHub's extensions, the Default theme's tokens and its fonts, and runs it in
    the system's JavaScriptCore, for the HTML that Quick Look draws. It never calls the
    `redlines` program or anything on the `PATH`, and the app needn't be running.
  - **Nothing to install.** macOS registers the extension the first time the app runs from
    Applications and removing the app removes it. It needs macOS 13.3, the first whose
    JavaScriptCore has the regular-expression lookbehind that the format library's patterns use
    (its array methods came with 13.0). System Settings › General › Login Items & Extensions ›
    Quick Look turns it off.
  - **Types.** Markdown files are `net.daringfireball.markdown` and `public.markdown`. macOS has
    no type for R Markdown and Quarto: a file of either gets a type made from its extension
    (`dyn.…`), which the extension lists, with no type declared by Redlines, which could take the
    extension from the app that declares it. Where another app declares them, the file has that
    app's type, and Quick Look matches an extension's types exactly, never by what a type conforms
    to, so Redlines' extension isn't asked: those files preview in that app's extension, or as
    plain text. Where two extensions claim one type, macOS chooses one, and the settings pane
    turns either off: that is the one extension per type that Quick Look has.
  - **Large files.** The first 4 MB are read, and the first 300,000 characters of the document are
    drawn, to its last paragraph under that, with a line that says so. The count of what waits is
    read from all of the 4 MB; a file longer than that has no such line, since its ledger, at the
    end, isn't read.
  - **Not yet:** images (a sandboxed extension can't read the files beside the document), and
    thumbnails in Finder, which are a separate extension.

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
- **The Quick Look preview reads the one file it is asked to preview,** in a sandbox with no network
  entitlement, and draws a page with no script that loads nothing (its Content-Security-Policy says
  so): a preview never tells a server that a file was opened. Its one exception to the sandbox is
  JavaScriptCore's compiler, without which the renderer is 5 to 8 times as slow, which a long
  document turns from a moment into a wait
  ([releasing](releasing.md#the-quick-look-extension)).
- **A desktop window reaches only the files the person opened or saved,** and the images its
  preview loads (§6.5). It reads and writes those files and no others, and watches nothing itself:
  the app watches each window's document for it, through the document's folder so that an agent's
  atomic write is seen every time, and tells the window of changes to that file alone.
- **Per-person state stays out of the file:** mode, zoom and text size, the markup view each
  person remembered, filters, comment drafts, folds, the last version each person saw, and
  presence. The view a document opens in, and whether it tracks changes, are the document's own
  (format §5.6).
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

1. **Track Changes and agent levels** (§5.4, §8.2): Word's on or off for people, and Propose,
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
6. **Shortcuts for the views** (§5.3): ⌥⌘1 to ⌥⌘3, in the menu's order. Word for Mac gives ⌥⌘1 to
   ⌥⌘3 to headings, which Redlines puts on ⌘1 to ⌘6; kept unless the clash proves real.
