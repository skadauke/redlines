# Redlines design

Status: November 2026. The Mac app, the format library and the command line are built and on `main`;
the sections below say, where it matters, what is not built yet (§4, §5.12, §6.4).

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
- **Text and code files:** `.txt`, data and config files and source code (format §9.1) open in
  Plain alone, in colors for the language, with no review at all (§5.3).
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
| Word files with tracked changes, in and out |    ✅    |  ✅  |     ✅      |   ❌   |   ❌    |
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
  dictation and input methods. A right-click opens the toolbar (below) in place of the
  system's context menu, with the spelling suggestions of a misspelled word at its top and Learn
  Spelling; ⇧ with the right-click shows the system's own menu, which has Look Up, Services and
  Writing Tools. A correction is part of your typing, as in
  Word: with Track Changes on, the word you just typed is your own pending insertion, so correcting
  it changes the insertion's text, and no other change appears. Only the part of a correction that
  reaches into other text becomes a tracked change of that text; with Track Changes off it is a
  plain edit. A correction never crosses a hidden marker: the text on either side is corrected
  apart, or the word is left as typed. ⌘Z right after a correction undoes it first, as in other Mac
  apps. Code, URLs and front matter are never corrected, nor spell checked outside Plain, and Plain
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
  drags the window and a double-click on it zooms it, except on its controls. There is no toolbar
  at rest (it is summoned, below) and no status bar: the one line along the bottom is the word
  count, below.
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
  R Markdown and Quarto files, and text and code files (format §9.1), leaving out hidden files and
  what `.gitignore` ignores; text and code files are in the secondary ink, and Preferences › General
  can leave them out (all but the open one). The project's images are listed after the documents
  and before the folders (#681): a row is dragged into the document, never opened (§5.10). No
  other file is listed. The sidebar's edge resizes it, down to closed (#721). Choosing a document opens it in the same window, and ⌘-click
  opens it in a new one, as does a click while an agent is working in the window. A text or code
  file is saved under its own name as it is, with no Track Changes, comments or ledger (§5.3). A document dropped on a window opens as one from Finder does, but for
  the file that the window's own document icon dragged, which opens nothing when it is dropped
  back on that window. Any other
  file opens nothing, however it comes (the Dock, Finder, a drop, a path given to the app), nor
  does a folder dropped on a window, and the window says so in one line: "Redlines opens Markdown
  and text files." macOS window tabs work as usual, and the menu bar is the front window's.
- **Finder knows Redlines' documents.** The Mac app declares them, as their editor: Markdown by
  its types (`net.daringfireball.markdown`, which macOS gives `.md` files, and `public.markdown`,
  which other apps declare), R Markdown, Quarto and the text and code files by their extensions, so Finder's Open With offers
  Redlines for each, and for no other kind of text. Where the
  person hasn't chosen an app for Markdown files and no app owns them, macOS may open them in
  Redlines. R Markdown, Quarto, text and code files it never takes, even where nothing else owns them:
  for those Redlines is only an alternative, since people who write R Markdown, Quarto or code
  have an editor of their choice.
  Preferences › General › Default app for Markdown says which app opens Markdown files, and Make
  Redlines the Default asks macOS to open them in Redlines, whichever copy of it. It refuses a copy
  that won't stay where it runs, as the command line's Install does (§6.3), and says what macOS
  did. Finder's Get Info changes the choice again.
  Preferences › General › Quick Look previews of Markdown files opens System Settings at the list
  of Quick Look extensions, where the app's preview (§10) is listed and can be turned off; a macOS
  that doesn't take the link there opens the page nearest to it. The line is drawn only where
  there is a preview to turn off: in the installed app (not run from the sources, nor from a disk
  image), on macOS 13.3 or later.
- **Crashes and recovery.** While a document has unsaved edits, its window keeps a copy of the text
  in the app's support folder (never next to the file), every few seconds and at each pause in
  typing; saving, or closing without saving, deletes it, and a window that opens the document after
  a crash puts the edits back and says so in a notification. An error in the page, the page's
  process ending, a panic, the last run's macOS crash report and a page that stops answering are
  written to a crash log in the app's log folder, and a gray notification offers Report…, a
  filled-in GitHub issue for the person to read and send (the build, the system, the trace and the
  document's shape, never its text), and Reveal Log; Help has both (Report a Problem…, Reveal Log).
- **Quitting never loses work.** However the app is asked to quit (the menu, the Dock, logging out)
  or to restart for an update, each window with unsaved edits comes forward in turn and asks whether
  to save them. Cancel stops there and keeps every window open. Closing the last window quits. A
  window opened for text (Ask's Open in New Window) can't be asked in its first moment, before its
  page has said what it holds: a quit or a restart is refused then, as a Cancel would be, with a
  notice to try again (§8.5).
- **File menu.** New, Open, Open Recent (the last ten files), Save, Save As, Rename (the file name
  in the title bar becomes a field; so does a double-click on it), Reveal in Finder, Close,
  Open .docx… (a Word or Google Docs file as a new, unsaved document, with its import report in a
  notification), Export to Word… (a save panel, then a notification, never a dialog, that says what Word can't hold; in the
  development page the file downloads), Print and Export as PDF. The Node command line (`pnpm redlines`) has `export-docx <file> [-o out.docx]` and `import-docx`; the program in the app does not carry them. A printed page is the document as it reads now, set as a document: every
  pending insertion as plain text and every pending deletion left out (the Original, when the
  window shows that), with no change bar, comment, note or highlight, none of the window around
  it, and nothing of the YAML front matter. It is black on white in every theme, in the theme's own
  faces at 11 pt; links print as their words, underlined, with no address (the PDF keeps them live);
  images fit the page, tables and code wrap, headings stay with what follows, and rows and images
  are not split. It is drawn again as clean HTML (`documentHtml` of `@redlines/editor`, which Copy
  for Word and the Word export share) into a container that only paper shows, not printed from the
  editor, which draws only the lines in view. Export as PDF writes the same pages to a file chosen
  in a save panel, with no print dialog. Saving a
  document that has no file yet opens the Save dialog in the default folder for new documents
  (Preferences › General), when one is set and still there; otherwise where macOS last saved. Save
  As of a saved document starts in that document's own folder.
- **Find.** ⌘F opens a panel at the top right of the page that searches the text a reader sees,
  never the markers or the ledger. The Find box holds the count ("2 of 5", "No results", or
  "Invalid" for a regular expression that does not compile) and four toggles: Match Case, Whole
  Word, Regular Expression and Find in Selection; beside it are Previous, Next and Close. Every
  match is marked and the current one is stronger; typing goes to the first match from the caret,
  Return and ⇧Return step, and Esc closes the panel with the current match selected. While the
  Find box has the focus, ⌥⌘C, ⌥⌘W, ⌥⌘R and ⌥⌘L turn the four toggles on and off, and Tab goes to
  the Replace box (opening its row first) and ⇧Tab back. Every control has a hint with its name
  and key. Edit also holds Find Next (⌘G), Find Previous (⇧⌘G), Find and Replace (⌥⌘F) and Use
  Selection for Find (⌘E). A chevron at the start of the panel shows or hides the Replace row
  ("Show Replace" and "Hide Replace" for VoiceOver), keeping the find text and the current match;
  ⌥⌘F with the panel open shows the row and focuses its box. The Replace row has Replace (Return
  in its box) and Replace All; with Track Changes on a red pen in the box says so, and with a
  regular expression `$1` and `$&` in the replacement stand for the groups of the match.
  - *Seeding.* ⌘F with a selection: a short phrase (under 80 characters, inside one line, not a
    whole block) becomes the search term; a selection of more than one block, with a line break,
    of 80 characters or more, or a whole block limits Find to it instead (Find in Selection is on,
    the box says "Find in selection", the scope stays shaded, and Replace All stays inside it).
  - *Replacing.* Replacing is an edit like typing. Replace All is one step to undo (a toast at
    the corner offers Undo), and each match is a change of its own: with Track Changes on, N
    matches are N tracked changes, each with its own margin note, as if every one had been replaced
    by hand. With Track Changes on, text that is already in a tracked change is not matched. A
    replacement the editor refuses is left, and the panel says how many.
  - *Hook.* A later feature that hides text, such as a closed fold, opens it while its match is
    current through `currentMatchHandlers` (or `createFind`'s `onCurrentMatch`), which is called
    whenever a match becomes the current one.
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
  are dots that open on hover wherever the window is too narrow for them beside the column. Both are each window's own: a zoom changes only the window it is made in, and a window opened later starts at the last window zoom set anywhere, kept across launches, and its text at the Default text size of Preferences › Appearance, which no window's own text size changes and which changes no window that is open; neither reaches the file, a print, the clipboard or an export.
- **Preferences** (⌘,) is its own window with labeled tabs: General, Editor, Appearance, Agents
  and Shortcuts (§5.9). The rows of each pane are in groups under small headings:
  General has You (name and handle), Opening (what opens at launch, the default folder for new
  documents) and The app (automatic updates, the default app for Markdown, the Quick Look preview of
  Markdown files, installing the `redlines` command line, the Dock icon's rotation); Editor has
  Writing (spell check, smart quotes and dashes, closing brackets, the emoji list), Display
  (whether line breaks show their marks, §5.5, whether the word count shows, whether the toolbar is
  docked at the bottom), Images (where images are saved, §5.10) and Alerts (Ask Again in All
  Documents takes back every "Don't ask again" of §5.4); Appearance has Match System, Light or Dark, the theme and the Default
  text size new windows open at; Agents is §8.6. There is no search field until a key is typed: then a Filter
  appears over the rows, which shows the matching rows of every pane, each under the pane and
  section it is in ("Editor › Writing"), and Escape clears it. Preferences has no row for the
  window's own zoom (⌘+ and ⌘−, Larger Text and Smaller Text change one window), for Track Changes
  on new documents (a new document starts with it off, #702), or for the views. Changes apply at once.
- **Three icons.** Next to the window buttons, Files shows and hides the file sidebar, which is
  hidden by default (⌃⌘S, the Mac's Show Sidebar shortcut). At the right, View (a page that shows the view,
  §5.3) sets the view, and Review (a pen) holds Track Changes and Review Changes (§5.4, §5.6).
- **Icons without labels, explained on hover.** Hovering over Files shows its name and shortcut.
  Hovering over View or Review opens its menu after a short pause, with each item's shortcut, and
  the arrow keys open it from the keyboard. A click on either does what is done most often: View
  switches between Clean and Redlines (from Plain, back to whichever of the two was shown last), and
  Review turns Track Changes on and off, as ⇧⌘E does. A click while the menu is open closes it and
  acts. Each icon's hint says what a click will do, with its key ("Show Redlines ⌥⌘2", "Turn off
  Track Changes ⇧⌘E"): the menu has the pointer's rest, so the hint shows when the keyboard brings
  the focus to the icon, and after a click on View, when the pointer stays (a click on the pen
  has its notice, §5.4). Escape takes a hint away wherever the focus is, and one hint shows at a
  time. The pen is named Track Changes and pressed (`aria-pressed`) while Track Changes is on; its
  menu is Review.
- **A toolbar, shown only when summoned** (#504). It is summoned three ways. The wrench in the
  title bar, left of the eye (#685), shows it docked at the bottom center of the window, and
  puts it away; the wrench is pressed while the toolbar shows, however it came to. ⇧⌘P (Show Toolbar,
  in the View menu) shows it at the caret and puts it away, with the keyboard in it. A right-click shows it
  at the pointer, where it takes the place of the system's context menu. A docked toolbar stays
  while you write, scroll, resize the window or click in the text (Esc, with the keyboard in
  it, gives the keyboard back to the text); one at the caret or the pointer goes away on a press
  elsewhere, a scroll, a resize or Esc, and one at the pointer also when you type. Preferences ›
  Editor › Show the toolbar at the bottom keeps it docked from the start, for those who want it
  always shown; the wrench still puts it away for that window. Nothing else is drawn at the bottom
  of the window to summon it (the handle that was there is gone, decided on 2026-11-15). It is a
  small card in one row: **Ask | Insert · Review · [List] · [Table] · [Image] · Format · Edit**, a vertical line after
  Ask. Each name opens a menu on a click (hovering from one open menu to another switches menus),
  with a header, then one line for each item: icon, name and shortcut, with no descriptions.
  Related actions share a line (Accept | Reject). Insert holds Link, Image, Table, Code Block,
  Quote and Callout (and a place for Collapsible Section, which appears when its command is
  registered); Review holds Comment, Highlight, Accept | Reject (the change at the selection),
  and Review Changes; Format holds Bold, Italic, Strikethrough, Code, Subscript, Superscript and
  Clear Formatting; Edit holds Cut, Copy and Paste. **List** (#506) is in the bar, between Review
  and Format, only where the selection holds a paragraph or a list item (anywhere in it, not only
  at its start; a heading, a code block or a table has none): Bullets, Numbers, Checkboxes and No
  List, which make the selected paragraphs one list of that kind, turn the selected items into
  another kind, or take them out of the list, with Track Changes on and off, as the Paragraph
  menu's commands do. No List is grayed, with its reason, where the selection holds no list item,
  and a conversion the block commands can't make (in a table cell, in Plain while tracking) is
  grayed with their own hint.
  Table (#552) is in the bar only with the caret in a
  table. Its header says where the caret is or what is selected ("Table · Row 2, column 2", "Row 3
  selected", "2 columns selected", "Whole table selected"). Its menu is two sides, Row and Column,
  with the same six actions in each, in lines of two (Insert Above | Insert Left, Insert Below |
  Insert Right, Move Up | Move Left, Move Down | Move Right, Select | Select, Delete | Delete), then
  Align column (Left | Center | Right, the caret's column checked) and Delete Table. With rows
  selected the Column side is dimmed, and with columns selected the Row side, each with its reason;
  with a caret both sides work on the caret's row and column (the header is row 1). Align column
  dims with the Column side, since it changes the columns the selection touches. The header row and the last column
  keep the Table menu's own refusals as dimmed items with their reasons; Merge is not offered.
  Image (#553) is in the bar only where an image is under the caret or in the selection. Its menu is
  Align (Left | Center | Right, the image's own checked, centered by default; disabled on an image
  among words, with the reason), Size (Small | Medium | Large, a fraction of the text column) and
  Original Size, Edit in Preview, which opens the file in Preview and follows its saves (§5.10),
  and Crop… (#624, §5.10). Alt Text… (`image.altText`, Edit Image Alt Text… in the
  palette; the agents' plugin) opens a small bubble by the image: a field with the alt text it has, Cancel and
  Save, and, where an agent can see pictures, "Describe with <agent>" (the default agent, or the one in Ask's
  picker, by its display name). While the agent writes, the field and Save wait; its text then goes into the
  field with "Written by <agent>. Read it and change it before saving." Nothing is written to the file until
  Save, which writes it as any edit: tracked with Track Changes on (the image is atomic content, so a
  substitution of the image, §3.5.1 of the format), untracked off, and never refused. The item says "Added"
  once the image has alt text.
  How the agent sees the image, with the least permission: it is given the one picture through
  `view_image` (no argument, so no path to name), which the host read first (the app's
  `image_for_agent` reads only inside a folder its sidebars show, only PNG, JPEG, GIF or WebP, at
  most 3.5 MB, so that it stays under a model's 5 MB in base64); and the request is at "This document" with only `view_image` and `status`, so the
  agent has no tool that reads the document and no file tool of its own, and no folder question
  is asked. Only an agent that can look at pictures is asked (Claude, which passes an MCP tool's
  image to the model): the default agent when it can, else another ready one that can, named in
  the button; with none, the button is grayed with the reason. Others (Codex, ACP agents) are not
  yet asked. The items are the editor's own commands
  (`image.align.*`, `image.size.*`, `image.edit`), so the toolbar's search and the shortcuts see the same; they
  exist where the host can open image files, and the menu is only there.
  An item that can't be used here is dimmed, and
  its hover hint (after the title bar's delay) says why, from the command's own reason. A menu
  opens on the side of the bar with room and scrolls when taller, never over the bar. A docked
  toolbar fades while you type and comes back when the pointer moves, and it leaves room under the
  text, so that the last lines can be scrolled clear of it. Its items are commands of the one
  registry (§5.9), so that it, the Format and Paragraph menus and the shortcuts never disagree
  about names, keys or whether an item is available; an item whose command isn't registered is
  left out, and so is a menu with no items. The arrow keys move along the bar; ↓ or Return opens a
  menu, ↑ and ↓ move by line, ← and → move inside a shared line and, past its end, switch menus.
  Where an inserted block goes (#555), the same
  for Insert's Table, Code Block, Quote and Callout and for Horizontal Rule: in an empty paragraph
  it takes the paragraph's place; with the caret at the very start of a block (in front of a
  heading's text or an item's, too) it goes above that block; anywhere else it goes below the block,
  so that no sentence is split. With text selected, Quote, Callout and Code Block wrap the selected
  blocks (a code block takes their text) instead, as one step to undo; with Track Changes on the
  wrapped blocks are replaced by the wrapped text, so a reader sees the blocks as they were and as
  they are. A selection that holds a table, an image or the markers of changes is not wrapped: the
  block goes below, and nothing is refused. With Track Changes on, above a block that is no paragraph
  goes at the end of the block before it (the format can't write an insertion that ends in line
  breaks in front of a heading, a list or a quote), and below the first block of the document
  where there is none before. Quote here is `insert.quote`, named Insert Quote or Make Selection a
  Quote; the Paragraph menu's Quote (⌥⌘Q) is another command, which changes the block it is in.
  Esc closes the open menu, then a toolbar at the caret or the pointer. **Typing with the toolbar
  open is a search** (#550): the card turns into a search box and a list, in place of the bar's
  row, over every command that works at the caret and every app command and setting the host
  offers (Track Changes, Show Resolved Comments, Appearance, the views, Preferences…); a command that
  doesn't work here is left out. A line has an icon, what the command does (a verb phrase that may
  differ from the menu's word: Link… is Insert Link, Bullets is Make Bulleted List; the menu's word
  and synonyms are searched too), its control or state, and its shortcut in a column of its own, with
  no menu name. Matching is by whole word ("ordered list" finds Numbered List, never "unordered
  list"), every word of the query must match, and a word of the name ranks above a synonym ("todo"
  finds Make Checklist, "dark mode" Appearance, "h2o" Subscript, "picture" Insert Image). A setting is
  a live control in its line and the palette stays open: a switch, a choice (← and → change it) or a
  slider; Return flips a switch. ↑ and ↓ move among the lines, Return runs one (a command puts the
  toolbar away and gives the text the keyboard; a docked toolbar stays, with the bar back), and Esc
  gives the bar back. The last line is always "Ask about “…”". Changing a shortcut is in Preferences ›
  Shortcuts (§5.9); the other settings of Preferences come later. Paste is the Mac's own, as the Edit menu's (the app sends `paste:` to the window), so
  what a web page or Word put on the clipboard is converted to Markdown as ⌘V converts it (§5.10),
  and with Track Changes on it is the paster's insertion; where the app can't (a browser tab, or
  nothing on the clipboard to paste) it pastes the clipboard's plain text, as ⇧⌘V does, and says
  when there is none. In the menu bar, Add Comment and Ask… are in Review, Image…, Table, Code Block, Alert
  and Horizontal Rule in Insert (Table is also the first row of the Table menu, as Insert Table), and View
  has Show/Hide Word Count (#536). The toolbar replaces the selection toolbar of §5.12.
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
  changes it to the next mark of the family, the old mark fading out and the new one coming in from
  below, with no line drawn across either, in about half a second (a plain crossfade under
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

- **Admonitions:** GitHub alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and
  `[!CAUTION]`), shown as boxes with an icon and the type's name as a title, whose menu changes the
  type. The box is drawn for a quote at the left edge whose first line is the type; a title and a
  fold mark after the type (`> [!info]- A title`) are read, kept as written, and shown with it, and
  a type that GitHub doesn't have is offered in the menu only where the file has it already. The
  title's menu and Paragraph › Alert, which writes a new alert with its body selected, are the ways
  to make one. Changing the type is a block format change ([format §2.6](format.md#26-format-changes),
  "Alerts"): in Redlines the title is in the author's color until it is decided. The source shows
  while the caret is in the title line. Two alerts one blank line apart are two boxes with the space
  between blocks between them, outside the tint. Quarto callouts in `.qmd` and `.Rmd` are not drawn in the editor yet; the Quick Look preview draws a
  `.callout-*` div as a quiet labelled box and any other div as its text.
- **Image size:** while the pointer is over an image or it is selected, a handle on its left edge and
  one on its right edge, standing just outside it (inside it, where the image is as wide as the
  column), resize it, with its aspect kept; an aligned image has no handle on the edge it is
  anchored to (#798); the image follows the pointer as it is dragged, and
  one Undo takes the size back. A large image fits the text column and a small one keeps its own
  size (it is never scaled up unless it is dragged larger). The size is stored as `<img width>`
  (`{width=300px}` after the image in a pandoc file, `.qmd` and `.Rmd`): the first size turns `![alt](src)` into the tag,
  and the image's own size, which a drag to it also gives, turns it back. Alignment (left, centered,
  right) is the tag's `align`. A new size is tracked as a substitution of the whole image
  ([format §3.5.1](format.md#351-image-size-and-alignment)). The menu's Small, Medium, Large,
  Original size and the alignments are commands of the editor (`image.size.*`, `image.align.*`),
  which the toolbar's Image menu draws.
- **Image captions:** Quarto and bookdown figures with numbering and cross-references, and an HTML
  figure in `.md`. Word export writes real caption and cross-reference fields.
- **Symbols:** HTML entities, shown as the character, with a symbol palette and `&` autocomplete.
- **Emoji:** the character itself in every file type, because shortcodes don't render in pandoc,
  Quarto or VS Code. Typing `:` and two letters lists the emoji whose names (gemoji's, GitHub's
  list) start with them under the caret; Return or Tab writes the character, ↑ and ↓ move and Esc
  puts the list away. It stays out of the way of `10:30` and `Note:` (it opens only for a colon that
  has no letter, digit or colon before it, and two characters of a name after it, one of them a
  letter), of code, front matter and Plain, and Redlines ›
  Preferences › Editor › Suggest emoji after a colon turns it off; macOS's own picker (fn-E) is
  not touched. A shortcode that a file already has (`:tent:`) is kept as written and drawn as its
  emoji in every view but Plain, as an entity is drawn as its character, and shows as written while
  the caret is on it; one that a letter or a digit is before (`a:tent:`) is text, as GitHub shows
  it. An emoji and a shortcode are one character for a change: no marker parts either
  ([format §3.1](format.md#31-inside-a-line)).
- **Table cells** with line breaks (Return writes `<br>`, §5.8) and lists.
- **Subscript and superscript:** the tags `<sub>` and `<sup>`, in every file type, drawn smaller and
  lowered or raised with the tags hidden unless the caret is in them, like any inline format. They
  are in the Format menu and the toolbar's Format menu (§5.1), and are tracked as format changes (`+sub`, `+sup`). They are the first of a short list of inline HTML tags that the editor
  renders as formats; any other tag shows as written. pandoc's `~x~` and `^x^` in a `.qmd` or
  `.Rmd` file are kept byte for byte and shown as written.

Math, Mermaid diagrams, footnotes, task lists and `<details>` are covered too.

**HTML as GitHub draws it** (#686). What Redlines shows in Clean is as close as possible to what
GitHub renders: GFM, GFM's escaped tags, and GitHub's list of allowed HTML. The aim is a standard,
not perfection. The list (elements, attributes and protocols, from html-pipeline's
`SanitizationFilter`) is one module, `github-html.ts` in `@redlines/format`, which Quick Look can
share, and a check in development (micromark and GFM, then a sanitizer with the same list, over
README-style snippets) holds the editor to it.

- **Two deliberate exceptions.** Nothing in the file is invisible: an element GitHub drops that has
  no text (video, audio, svg, input, button, embed) shows as a small muted chip. Editing aids, such
  as folding and opening a block's source, are view state and never written.
- **Quick Look** (#691) draws the same list from tokens, since its JavaScriptCore has no DOM: the
  source is never passed through, an attribute is kept only if GitHub keeps it and a static page
  can use it (never `id`, `name`, `style`, `class`, `srcset` or a handler), and a remote image is
  its alt text. `<details>` is WebKit's own, closed unless the file says `open` (ruling: a static
  preview shows what GitHub shows at rest, and WebKit opens it on a click without script).
- **Inline tags** (`b`, `strong`, `i`, `em`, `code`, `tt`, `kbd`, `samp`, `var`, `s`, `strike`,
  `del`, `ins`, `sub`, `sup`, `mark`, `small`, `abbr`, `dfn`, `cite`, `q`, `time`, `span`, `bdo`,
  `ruby`, `a`): the text is wrapped in the real element, with its tags hidden as `<sub>` and
  `<sup>` are, and edited in place. `ins`, `del` and `s` use the text's ink, never an author's
  color; `mark` uses GitHub's yellow; `title` shows as an app hint. Removing a pair is a format
  change (`-html=TAG`, format §2.6). `<br>` is a line break everywhere and `<wbr>` is invisible,
  each one caret step. Shift-Return stays Markdown's hard break; `<br>` is written only in table
  cells.
- **The nine tags GFM escapes** (script, style, iframe, title, textarea, xmp, noembed, noframes,
  plaintext) show as text. `<u>`, `font`, `center` and other unknown tags drop their tags and keep
  their text. Underline has no command.
- **Containers** (`details`, `summary`, `div`, `blockquote`) hold Markdown, with the tag lines
  hidden. **HTML blocks** with no Markdown twin are drawn as GitHub draws them, with their source
  on demand. **HTML with an exact Markdown twin** is edited as Markdown, and converted only when
  the conversion is exact. These come after the inline tags, in the order of #686.
- **Markdown twins** (#690). An HTML heading (`<h1>` to `<h6>`, no attributes, one line) is drawn as
  a heading with its tags hidden, edited in place, and listed in the outline. A blockquote, a simple
  list, a simple table, an `<hr>` and a `pre` with code are edited as the HTML they are. A command
  that changes structure (a heading level, Body, Quote, a list type, Indent and Tab, the Table
  menu) first converts the block to its twin, as one change, only when the conversion is exact
  (`docs/format.md` §3.15): with Track Changes on it is a substitution of the whole block whose
  margin card says "Converted the `<h2>` heading to Markdown", with it off the block is replaced.
  Where the HTML has no exact twin (a heading with an attribute, a table with a span or a caption,
  Markdown in the text) the command is disabled and its hint says why; nothing is refused after
  the fact.
- **`<details>` and `<div align>` as containers** (#688). A container is an opening tag line (with
  the `<summary>` line under it, for a `details`) and a closing tag line, each a block of its own
  with blank lines around it, at the top of the document, as GitHub needs to read the Markdown
  between them; a tag with other text in its block is an HTML block with no Markdown inside (a later
  phase). The tag lines are hidden, the Markdown inside is ordinary blocks (tracked edits and all),
  and while the caret is in an open container a faint bracket stands in the margin. The summary is
  one line, drawn bold with a triangle; a `details` with none shows "Details". A `<div>` hides its
  tags and aligns what is inside (`align`); a `details` with no closing tag folds to the end of the
  text, as on GitHub. Folding is view state and never written: closed unless the file says `open`,
  nothing remembered, the triangle or ⌥⌘↓ and ⌥⌘↑ on the summary line toggle it, and Down on a
  closed summary steps over the content. A section is open for as long as the caret, or a Find or
  Review match, is in it, and closes again when that moves out. A closed section with pending
  changes shows a bar and their count on its summary line, so changes never hide. Backspace and
  Delete never join a paragraph into a tag line, nor the summary's line break away. Insert ›
  Collapsible Section writes the structure (open, with the summary's text selected), and wraps a
  selection of blocks with two insertions.
- **HTML blocks drawn rendered** (#689). A top-level HTML block that opens with a tag GitHub keeps
  and has no Markdown twin (a `<p align>`, a table with spans or a caption or no header row, a
  figure, a `<dl>`, an `<h1 align>`) is drawn as GitHub draws it, with no frame at rest; on hover
  it has an outline and an "HTML" label. A click selects it, the arrows step onto it and over it,
  and Return, a double-click or the label open its source in place, in a code box headed "HTML
  source" with a Done button; the caret leaving it, Escape or Done draws it again. A source over
  60 lines opens in Plain at that spot. The source also shows, with no one asking, while the caret
  or an end of a selection is inside the block, while the current match of Find is in it, and while
  a pending change touches it (a change is seen and decided in its text, never drawn away). Edits
  in the source are ordinary edits, tracked or not, written by the same rules as any text; none is
  refused. An image in a rendered block is a small box with its alt text: nothing is loaded.
- **Security.** The source is never inserted as HTML. Allowed nodes and attributes are rebuilt from
  WebKit's DOMParser, nothing runs, and links and sources use GitHub's protocols only (`http`,
  `https`, `mailto` and relative addresses). Not done: `style`, `class`, microdata and in-page `id`
  anchors.

**Links** are drawn underlined and stay text to edit: a click places the caret. ⌘-click opens the
address in the default browser (Ctrl-click off a Mac), and a pointer at rest on a link shows its
address in a hint after the pause that the title bar's hints make; with ⌘ held, the pointer over a
link is a pointer. Only `http`, `https` and `mailto` addresses open, and `www.` ones (opened over `https`, as a copy writes
them) and emails written as autolinks (opened as `mailto:`; in `[x](logo@2x.png)` it is a relative link), which GitHub's autolinks read as the web's and the mail's; a
space in the path of a `<...>` destination opens as `%20`, and an image that is a link's text opens it too: the limit of a copy, which turns `javascript:` and its kin into plain
text, so that a link in a document, or in an agent's suggestion, never runs anything. The app checks
the address again before it runs the system's opener, and the website's demos open a new tab. A
link that doesn't open is left to the editor like any text, with no hint. A relative link to
another document doesn't open yet.

### 5.3 Views: Clean, Redlines, Plain

The View menu, under the View button at the top right (§5.1), sets how the document is shown. The
button is a small page that shows the view it is in: a page with lines of text for Clean, the same
page with a red bar in its left margin, like the change bars, for Redlines (in either look), and the
page with a monospace # for Plain. Red shows there only as that state (besides the pen). A click on
it switches between Clean and Redlines, and from Plain goes back to whichever of the two was shown
last; Plain is for the menu, below a separator. The icon changing is the sign that the click did
something, though Clean and Redlines look alike in a document without redlines.

**A text or code file** (format §9.1) has Plain alone. Clean and Redlines are disabled in the menu
and on ⌥⌘1 and ⌥⌘2, with "Only Markdown files have Clean and Redlines views." as their hint;
Track Changes and Review Changes are disabled too ("Only Markdown files have Track Changes and
review."), and so is every command that makes or reads Markdown, marks or comments (Format,
Paragraph, Table, Image, Add Comment, Highlight, Ask), each with its reason, while Edit, find and
replace and the outline stay. The text shows in the monospace Plain view, colored for its language
by the same style as a code block (`codeFileHighlight`), or not colored for `.txt`, `.log` and
`.csv` or past 2 MB. Typing is plain editing that Undo covers, and saving writes the text as it is:
no ledger, and no view or tracking recorded. An agent reads and writes the file as text, and the
`redlines` command line refuses to mark it.

- **Clean** (⌥⌘1): the document as it reads with every pending change accepted, without markup
  (Word's No Markup). The Mac's Quick Look preview of a Markdown file is this view (§10).
- **Redlines** (⌥⌘2): the document with its tracked changes and comments (Word's All Markup). It is
  always there in the menu bar's View menu, with its shortcut, whatever the document holds and
  whether Track Changes is on or off, since a disabled item would take its key away. The View menu
  is for what there is to see: Redlines is disabled in it for a document with no changes and no
  ledger (no pending change, highlight or comment), where it would look nearly the same as Clean
  (it stays enabled, and checked, while it is the view shown); ⌥⌘2 and a click on the View button still
  show it. Redlines has two
  looks, and a click on a change bar in the margin or the menu bar's View ›
  **Simple Look** switch (⌥⌘4) chooses between them: the **full markup**, and the
  **simple look** ("Simple" for short), the same text as Clean with a change bar beside each screen
  line that has a pending change (§5.5), in its author's color, and the comments with their notes:
  deletions are hidden (deleted table rows and columns too), inserted text is in its author's color
  with no underline, and reformatted text is plain (Word's Simple Markup). The caret never lands in the hidden
  text. In the simple look, a click on a change, on its colored text or on its bar, opens that
  change's card with Accept and Reject (the card says what a hidden deletion was: #664); a click on
  a bar in the full markup, and the switch, switch from the one look to the other, with the line where it was (a
  click's line is the one under the pointer; the switch's, the one with the caret when it is on the
  screen, else the first on it), and the look becomes the one remembered. The simple look is no view
  of its own, so the menu says "Redlines" in both looks; it is a switch below the three views,
  checked while the simple look shows, there to choose only while Redlines shows (Clean and Plain
  have no look). A change bar is a pointer's way, and the
  menu bar's switch (⌥⌘4) is the way for the keyboard and VoiceOver (#330): nobody needs a pointer
  to choose a look.
- **Plain** (⌥⌘3): the Markdown source, markers and ledger included, with syntax highlighting. It is
  the same editor with its decorations turned off.

Clean and Redlines draw the blank lines between blocks as the space between them, never as lines;
Plain shows them.

**Very long lines (every view, Plain included).** A line over 10,000 characters shows its first
2,000 and a chip that holds the rest ("… 1.5 MB more"); the base64 of an embedded `data:` URI is a
chip of its own ("PNG image, 1.1 MB, embedded"), wherever it stands in the line, since a base64
picture in a code span is the usual cause. The page never lays out the text under a chip: a line of
a million characters that wraps stalls it. The file is unchanged. The chip is one object: the caret
steps over it, a click selects it, a deletion over it takes all of it (written whole, as any
deletion), and a copy holds all of it, since a copy reads the document. There is no way yet to see
it in parts. A `data:` URI of an image in `![](…)` or `<img src>` is drawn as the image.

Redlines remembers its look, the one a click on a change bar or the Simple Look switch chose last,
the full markup at first.
A document that has redlines (pending changes, highlights or comment threads) opens in the view it
was saved in, which its ledger records ([format §5.6](format.md#56-settings)): `view: clean` opens it
in Clean, `view: redlines` in the full markup and `view: simple` in the simple look. One that
records none opens in Redlines, in the look remembered. A document that has none, a new document or
a plain Markdown file, always opens in Clean, whatever view was used last and whatever its ledger
says: there are no redlines to show. Making a tracked change in Clean, or adding a comment or a highlight there, switches to
Redlines in that look, so suggestions are never invisible to their author, and so does a document
shown Clean that gains redlines; a tracked change made in the simple look stays in it, where its
bar shows it. Choosing Redlines in the View menu, from Clean or Plain, brings back the look that was
shown last, so that a trip through Clean or Plain comes back to where it began; in Redlines already,
in either look, the menu leaves the look as it is. Reviewing (§5.6) shows the full markup, where
each change shows, and what it showed is what comes back. With no change pending there is no bar to
click, and the two looks differ only in the ordinary HTML comments that the full markup draws as
dimmed notes. Otherwise the view stays as you chose it: deciding the last change doesn't switch it.
**Switching views never changes the file,** and so never makes the document edited or causes a
write: a Save, made for another reason, records the view (Clean, the full markup or the simple look,
never Plain) in a file that has a ledger, so that reading a document leaves its git history quiet,
and a view alone never adds a ledger to a plain file. A save made in Plain leaves the view the file
had. The look remembered is each person's own: it is kept in the app's settings, opens the files
with redlines that record no view, and reaches every window for the documents each opens next, without changing
the view any of them shows (a look saved there as Simple opens in Redlines' simple look). The View
menu also previews the original (every change rejected) and one person's changes alone (everyone
else's rejected). The previews are read-only. Plain can be edited while Track Changes is off; while it
is on, or locked on, typing in Plain asks first, because Redlines can't mark a change there: a sheet
offers to make the edit without tracking, as Word does (§5.4).

### 5.4 Track Changes

Whether your edits are tracked is the one setting that matters while you write, and Redlines
follows Word: Track Changes is on or off. Google Docs calls the same state Suggesting; its Viewing
mode has no counterpart in the desktop app.

- **The pen shows it.** The Review icon at the top right is a red pen with an underline while your
  changes are tracked, and a gray pen while they aren't. Red is the app's own color, and your own
  too: the first author color (§5.5, §6.6). A click on the pen turns Track Changes on and off, as
  ⌘⇧E does in Word; hovering over it opens the Review menu, whose first item is the same switch.
- **Every switch shows a short notice.** Word's mode switcher turns tracking off without one, which
  its users complain about.
- **The document remembers it,** as Word does (`w:trackRevisions`, which Word export writes). The
  switch itself changes nothing in the file: turning Track Changes on or off never makes the
  document edited, so a document that was only switched asks nothing when it is closed, and it has
  no step for Undo. The ledger records the setting when the file is saved for another reason
  (`tracking: everyone`, [format §5.6](format.md#56-settings)), as it records the view, so someone
  who turns it on, makes a change, saves, and opens the file again, or sends it to someone else,
  finds it still on. Turning it off in a tracked file and saving takes the line out. A plain
  Markdown file gets no ledger for it: the ledger comes with the first tracked change. A file that
  can't take a ledger (an unreadable one, or an end inside a code block that is never closed) can
  have it turned on, and refuses each tracked edit with the reason, as it always did. A new
  document starts with Track Changes off (#702): no setting turns it on for new ones, and the
  value an older version stored is ignored.
- **An edit that can't be tracked asks first** (#714, #730; [format §3.13](format.md#313-untracked-edits)).
  Redlines widens an edit to the smallest unit that holds it, written as a replacement, rather than
  refuse it ([format §3.12](format.md#312-widened-replacements)). Where no unit can hold the edit,
  or it is in the YAML front matter or in Plain while Track Changes is on, a sheet asks "This edit
  can't be tracked. Make it without tracking?", with a line that says why, Cancel, Make Edit and
  "Don't ask again in this document" (Return and Esc are Cancel; the answer is the app's, kept by
  the file's path and never in the file, and Preferences › Editor › Alerts takes every one back).
  One answer holds for the edits of the same kind that follow within five seconds. With Track
  Changes off, an edit that can't be made beside the pending changes around it asks "This edit
  can't be made without accepting Bo Chen's 2 pending changes in this paragraph. Make the edit?":
  Make Edit accepts them (never rejects) and makes the edit, as one step to undo, and it is asked
  every time. A host with no sheet refuses as before, and an agent's edit is never made untracked.
  A refusal is kept only where every write would leave the file wrong, and, for now, where the
  unit a widened edit would replace holds another person's pending change ([hardening](hardening.md)).
- **Track changes for everyone,** like Word's "For Everyone", is what the setting means: everyone
  who opens such a file starts with Track Changes on, under a notice that says so. Without an app
  that enforces roles, anyone can still turn it off, which changes the file for everyone, so the
  notice makes that a deliberate choice. A file that comes to ask while it is open, when the window
  reloads it from disk (the change came by git or a shared folder), is read as one that is opened:
  Track Changes turns on, under the same notice, and nothing is written, since the file asks
  already. A file that stops asking leaves the window's Track Changes as it is, so that nobody's
  tracking is switched off under them; the next switch they make is recorded at the next save.
  A window with unsaved edits doesn't reload, and so reads nothing until it does. There is no "Just
  Mine" for now: a person's own tracking, apart from the file's, is left for later.
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
  simple look, as the View menu's Simple Look switch does: the bar is a target 24 px wide, only
  beside the lines it marks, and it widens under the pointer. Printing shows no bars: a printed page
  has no markup.
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
  quote with its bar) and its own change bar. A table deleted whole is one of these, drawn as a
  ghost table (§5.8). A block rewritten whole, by an agent or by typing over it, is not deleted: the
  old text is struck above the new, in the same block (a rewritten heading at the heading's size, an
  item beside its one bullet), and a rewritten table cell shows its old text struck above the new
  inside the cell. Words deleted inside a block, a substitution of part of one, and a deletion that
  runs from one block into another stay inline. The caret steps over a struck block, as over deleted
  text, and its card opens on hover and pins on a click; a click on its bar switches to the simple
  look, which doesn't draw it, and the block below keeps the place. The simple look and Clean show
  the newest text only.
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

- **Review Changes starts at once.** Choosing it goes straight to the document's first change,
  wherever the caret is. With a selection it goes to the first change the selection touches and the
  selection goes; if the selection touches none, to the first change after it, round to the top.
  The next- and previous-change shortcuts (⌘⌥], ⌘⌥[) still go from the caret. The current change is
  marked, not selected: its text gets a thin gray ring, its change bar is drawn wider
  (4 px), and its note in the rail is the selected one, all in the theme's inks, so it never looks
  like a selection. The mark moves with Previous and Next and goes when the bar closes or the
  caret moves elsewhere, and when the change is decided or edited away from anywhere (its card, its
  note, the bar, an agent). It has no wash, so no text changes ground and every author's color keeps
  the contrast its theme gives it. **Next and Previous no longer select the change:** they put the caret at its start
  and mark it, so copying or typing after them acts at the caret, not on the change; the panel
  planned for it (§5.6 below) holds the keyboard. With no changes the command is disabled.
- **The review panel** (the review bar's place, Review Changes in the Review menu or the next-change
  shortcut ⌘⌥]) opens at once, on the document's first change or on the first change the selection
  touches (the selection goes), and marks that change. Opening it, or moving it to a change, shows
  the full markup, from Clean, from the simple look and from Plain, so that each change shows while you
  decide it. Showing the simple look closes it, because a person who chooses to read has stopped
  stepping through changes, and while it is open a click on a change bar opens that change's card in
  place of switching the look. It is a card **beside the change**: in the margin to the right of the
  text, level with the change's top and as wide as the margin lets it be (at least 240 px); where
  the margin has no room, below the change, or above it when it doesn't fit below. It never covers
  the change, and stays inside the window (or the sheet, for an editor that is one). Its title is its
  handle: drag it, and it stays where it was put until it closes. It says who made the change and
  when, and what it did, and has **Accept (A)**, **Reject (R)**, **Comment (C)**, **Previous (←)** and
  **Next (→)**, with the key shown on each button. Accept and Reject decide the change and move on to
  the next; after the last, it says there are no more changes to review, with a Done button. Comment
  opens a field, "Ask about this change"; Return posts it as a comment on the change's text, and Esc
  closes the field. **The panel takes the keyboard** when it opens and after each change, so that
  the letters and the arrows reach it; a click into the document gives the keyboard back to the
  document, and typing is typing again. Esc or its close button closes it. The review's mark is the
  thin ring and the wider bar described above. Without it, a change's card, or its note in the rail
  (§5.7, in the simple look too), still accepts or rejects that change. The panel's measures are the
  interface's own sizes (13 px and 12 px), whatever the text size. Its title shows the count, and the
  rest is planned for it:
  - "Change 3 of 17" (shown), with previous and next, through changes and comments in document order,
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
- **Accept All Changes and Stop Tracking** is a row of the app's Review menu (the menu bar, not
  the toolbar's Review menu), after Track Changes. With a caret it accepts every pending change of
  the document; with a selection, only the changes the selection touches. Either way it then turns
  Track Changes off, and comments and highlights stay. It is disabled when there is nothing to
  accept, in the document or in the selection, and never refuses. It is one step: one Undo brings
  the changes back and turns Track Changes on again, and Redo does both once more. It writes the
  file as Accept does for each change, and the switch itself writes nothing (§5.4).
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
    last. An Ask bubble the rail lays out (§8.5) is always the one, and stays where it is while the
    person scrolls; with none, a comment being written is, and stays where it is while the person
    types and scrolls. With both open, the bubble stays level and the comment's box is placed
    around it, as a note is, which may leave it lower than its text. As the page scrolls, the note
    that is level with its anchor changes with the first anchor in view, and the notes slide into
    place in a moment, as in Google Docs; they slide only then, and not while a keystroke or a
    resize moves the text, and not at all under Reduce Motion.
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
  typed. The app's menu opens the box with no text. Plain takes no comment, with text too.
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
  cell, and again deletes the whole rows, columns or table once their cells are empty; menus count
  the selection ("Delete 2 rows").
- **Pasting** a spreadsheet range into cells grows the table by rows (§5.8 below, "Cells").
- **Tracked changes look as in Word:** inserted rows and columns tinted, deleted ones shown as
  struck-through ghosts, and moves with Word's double underline and double strikethrough. Word
  draws moves in green; Redlines draws them in the author's color, because color means a person
  (§6.6). Unlike in Google Docs, a move can be suggested, and new empty cells are tinted.
- **Edits to the source are minimal.** A table is never re-padded unless you ask.
- **A table stays its source, and is drawn as a table.** A block wrapper is the table, each line a
  row, each cell a mark; pipes, padding and the delimiter row are hidden, and the caret steps over
  them, stopping only in cells. Plain shows the source. A table inside a quote or a list item stays
  source. Column widths are computed from every row and found again about 300 ms after typing
  pauses in the table (never on each key), and at once when the caret leaves it; a
  table never reaches past the text column, and scrolls sideways in its own box.
- **Typing in a cell.** Return and ⇧Return write a line break in the cell (`<br>`, drawn as a line
  break and deleted by one ⌫); ⌫ at a cell's start and ⌦ at its end do nothing, so cells never
  merge and the table keeps its shape; a typed `|` is written `\|`, and text pasted or dropped on a
  cell goes in as its text. A cell is one line of the file, and the format refuses an edit that
  adds, takes away or splits a cell (format §3.7).
- **A row of another width than the header.** A row with fewer cells than the header is drawn with
  empty cells after its last, each in the column of its header cell, as GFM reads it. The caret can
  be in one (Tab, ⇧Tab, the arrows and a press go there), and nothing is written until text is
  typed. Typing in one writes its pipes first, plain, and then the text, as any typing is written:
  `| 1 |` under a header of three columns becomes `| 1 | | x |` for an `x` in the third. Tracked,
  only the `x` is the insertion, and rejecting it gives back a table that reads as it did, for the
  pipes are no change (format §3.7, "A cell a row lacks"). An input method that composes
  there writes the pipes with its first composed text (not when it starts, so a composition
  cancelled before any text writes nothing). A row with more cells than the
  header has its extra cells hidden and kept: no key puts the caret in one, selecting a row, a
  column or the table leaves them out, and no text is lost while the row stays (a deleted row takes
  its hidden extra cells with it).
- **Moving.** The arrows cross cells and rows; ↑ and ↓ go by visual line in a cell, then to the cell
  above or below at the same x (an empty cell too), and out of the table at its first and last
  row (↓ from a table that ends the document opens the empty paragraph after it, as Word and
  Docs keep one; ↓ from the last line of a quote, an alert, code, a rule or a picture that ends the
  document does the same, outside the quote, where a line after it would be read as more of it; ↓ from
  the last line of code that has no closing fence, at the end of the document, first writes the
  closing fence, since a line after it would be code, then opens the empty paragraph: one edit,
  tracked with Track Changes on, which one Undo takes back; in a list item, ↓ is the list's own).
  Tab and ⇧Tab select the next and previous cell's text, and Tab in the last cell
  adds a row; ⌘↩ and ⌥⌘↓ are Insert Row Below, in the Table menu. To leave the table by keyboard, press
  Escape and then Tab (the editor's own way out of a text area, for two seconds) or use the system's
  (⌃M, ⇧⌥M); Tab with a selection that reaches out of its cell acts on the cell of its head. A press
  in a cell lands in that cell, also in an empty one, whatever its padding: `| |` and `||` have a
  place for the caret as `|  |` has, and so does the end of text with no padding after it (`| y|`,
  which is what typing a letter into `| |` writes).
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
  staying selected). Pressed again, with whole rows, whole columns or the whole table selected and
  every cell of them empty, they delete the rows, columns or table, as Delete Row, Delete Column and
  Delete Table do, and the notice says what refuses it. A cell is empty when it holds no text the
  caret can stand in (`cellIsEmpty`, `cells.ts`): deleted text counts as gone, a line break as text,
  and an author's own HTML comment as empty in Clean and Simple, where it is hidden, and not in
  Redlines, which draws it as a note. A row with text is never deleted by one keystroke: the first
  press clears it. Typing clears the top-left cell alone and types there, and leaves the other cells as they are
  (tracked, a deletion of its text and an insertion of the typed text; the caret ends after the
  typed text, the selection gone, one Undo); an input method composing does the same. ⌫, ⌦, Cut
  and a paste over the cells clear or replace every cell. ⌘B, ⌘I and the Format
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
  paste that needs rows while a column is deleted or moved, or columns while a row is, is written
  as a replacement of the table (#863). Text without tabs goes into the cell (line breaks as `<br>`, pipes escaped); Paste as
  Plain Text puts anything into the cell with its tabs as spaces. A range pasted outside a table
  is a new table, as an HTML table was.
- **Rows, tracked as Word tracks them.** The Table menu's row commands count the selection ("Insert 2
  Rows Above", "Delete 3 Rows", "Move Row Up", every one a step to undo with its selection back);
  insertion adds as many rows as the selection touches, with the caret in the first new cell;
  deletion takes the rows the selection touches and puts the caret in the row that is then there;
  moving takes them one place, and they stay selected. A handle shows in the left margin beside
  the row under the pointer, while the pointer is over the table: a small pill (5 × 16 px) at the
  table's left edge (its reach, 14 px wide, ends 2 px from it), over the change bars' strip and inside the window, which grows
  a little (8 × 22 px) when the pointer is over it, to say it can be dragged, in a
  layer over the editor that assistive technology does not see (the menu bar has every command); a
  click selects the row (⇧ extends) when it is released, and a right-click selects it and opens its
  menu (Insert Above and Below, Delete, Delete Table, Move Up and Down, Clear Contents), Esc closes
  it and keeps the selection; a drag moves the rows, and the others selected with it, to any
  boundary, the last included: nothing is highlighted while it lasts, the rows dim, a copy follows
  the pointer, a 3 px gray line (the theme's `--rl-ink-2`) marks the drop and shows only where the
  rows would go, never at their own place, the page scrolls near its edges, Esc cancels. A + shows
  within 8 px of a row boundary in the strip beside the table, with a thin line across it, and a
  press inserts a row there.
- **Columns, the same.** Insert Column Left and Right (⌥⌘← and ⌥⌘→), Delete Column (⌃⌘⌫) and Move
  Column Left and Right (no default key) count the columns the selection touches ("Insert 2 Columns
  Left", "Delete 3 Columns"), each a step to undo with its selection back; the caret goes to the
  new column, in its row. Delete Table (no default key) follows Delete Column in the menu and
  deletes the whole table the caret or the selection is in. A column's handle is the same pill, turned
  (16 × 5 px, growing to 22 × 8), just above the column at the table's top edge; a click selects the column (⇧ extends)
  when it is released, and a right-click selects it and opens its menu (Insert Left and Right, Delete, Delete Table, Move Left and Right, the four
  alignments with the caret's column checked, Clear Contents); a drag moves the columns, and the
  others selected with them, to any boundary, the last included, with a vertical drop line and the
  page's table scrolling sideways near its edge; a + shows within 8 px of a column boundary in the
  strip above the table and a press inserts a column there. **An inserted column** has its cells in
  the author's tint and underlined with a bar on every row; a **deleted column** is a ghost cell in
  every row at its place, struck, counted among the columns when the widths are found, and skipped by
  the caret; a **moved column** has the double underline at its new place and a ghost with a double
  strikethrough at the old. The cards say "Inserted column", "Inserted 2 columns", "Deleted column"
  and "Moved column". Simple draws the bars and no ghost, tint or underline, and the text of an inserted column in its author's color, as it does for rows.
- **Widgets at the table's edges.** With the pointer over the table, three small widgets grow it and
  select it without a menu, in the same layer as the handles. **Add column** is a strip as tall as
  the table, 4 px right of it, 20 px wide, with a +, while the pointer is over the rightmost column
  or the strip; **Add row** is a strip as wide as the table, 4 px below it, while the pointer is
  over the bottom row or the strip. A click adds a column (or a row) at the end: the same insertion
  as the + between columns and rows and the Table menu, so with Track Changes on it is the tracked
  insertion, with its bars, tint and card. A small square at the table's top-left corner, 2 px off it,
  selects the whole table, as Select Table does; it stands aside while a + is where it would be. Each
  has a hint after the title bar's delay.
- **Aligning columns.** Align Left, Align Center, Align Right and Default Alignment (no default key:
  Word's keys align the paragraph) are in the Table menu and the column grip's menu, the caret's
  column checked, and align the columns the selection touches, one step to undo with the selection
  where it was. **They work with Track Changes off and on.** Off, they write the delimiter row as it
  says, in the old row of a pending alignment change and in a pending move's copy too. On, they write
  the delimiter row and one mark, at the end of the text of the header's last cell, that keeps the old
  row (format §3.7, rule 5): one change for the table, whichever columns it changes, with no line or
  blank line of its own. The mark ends its cell's text, so the caret, and a key typed at the end of
  that cell, stay in front of it. Your own pending change is changed in place, and goes, with the old
  row written back as it was, when the old alignments are back; columns that have the alignment
  already are no change, and no notice. The new alignment shows in every row of the column in every
  view, and in Redlines the header text of each column changed has a dotted underline and the header
  row a bar; Simple draws the bar alone, Clean nothing. Its card, on the header row, says "Formatted:
  column Count centered (was default)", with Accept and Reject: accepting keeps the alignment and
  rejecting writes the old one back, and neither changes a byte outside the table's first two lines.
- **An alignment change and what else is pending.** These are the refusals of the fine write, the
  one mark at the end of the header's last cell. With Track Changes on, an operation or a cell
  format that they refuse is written as a replacement of the table, made as it is made with Track
  Changes off, with other people's pending changes left in its old text, so that it reads alike in
  every order of decisions and rejecting it gives the table back (#657, #863; format §3.12). The
  words below are told, in the notice and in the format's words, with nothing written, only where
  no unit can hold the edit (a unit of more than eight blocks, or an unreadable ledger). With Track
  Changes on, a change of alignment is refused while
  another person's is pending ("Bo Chen's alignment change is pending. Decide it first."), while a
  column change is pending, and while the header is itself a pending row change, a row inserted
  above it or moved to the top, or the header deleted or moved ("Accept or reject the column changes
  in this table first.", or the row changes). It is refused too where Markdown would read the mark
  otherwise at the end of the header's last cell, a backslash or an underscore ending its text, say
  ("A marker can't go at the end of this table's header, where Markdown would read it otherwise.
  Change the end of its last cell first, then align."), and where more than two other changes are
  pending in that cell ("Decide the changes in the last cell of this table's header first, then
  align."). With Track Changes off no mark is written, and none of this applies. While an alignment
  change is pending, a column command with Track Changes on is refused, and so is a row command that
  touches the header, with it on or off (Insert Row Above on the header, Delete Row on it, Move Row
  Up on the first row below it): "Accept or reject the alignment change in this table first." The
  other row commands work, and with Track Changes off so do the column commands, which keep the
  change in step with the columns. A key typed at the end of the last header cell is refused, naming
  the change, where it would make Markdown read the mark otherwise or leave more than two other
  changes pending beside it ("Ada Lovelace's alignment change is at the end of this cell, and this
  edit would leave more changes pending in it than can be looked at together. Decide some of them
  first.").
- **An alignment change from another tool,** a format change around the table (format §3.7, rule 5),
  is read, drawn, carded and decided like the one in the header, and is never written. While it is
  pending, a tracked edit right under its table is refused ("Bo Chen's alignment change to the table
  above is pending. Decide it first, or turn off Track Changes."), and so is every column command,
  tracked or not, and every row command that touches the header. The one in the header has no
  closer and no such gap: nothing under the table is refused for it. As above, what is refused here
  is written as a replacement of the table where a unit holds it.
- **An inserted row** is written, decided and viewed as format §3.7 and §8 say: in Redlines its cells
  take the author's tint and its text is underlined in the author's color, with a change bar on the
  row; Clean shows the plain row. A **deleted row** is kept below the table in the file and drawn in
  Redlines as a ghost row at its place, a row of cells in the table's columns: its text struck in the
  author's color on the author's tint, with a bar, not editable; the caret and ↑ ↓ skip it, a press
  on it opens its card and puts no caret there. A **moved row** has a double underline and the tint at
  its new place, and a ghost with a double strikethrough at the old; its card is the moved row's, and
  accepting or rejecting either half decides both (rejecting moves the row itself back, with what
  was typed in it since and its comments). The cards say "Inserted row", "Deleted row" and "Moved row" (and
  "Deleted 3 rows" for rows deleted together). Simple draws the bars of the same rows and no ghost,
  tint, underline or struck text (a deleted row has no row there to carry its bar), and shows what
  Clean shows, the text of an inserted row in its author's color. Rows that another person's changes are in can be moved (their changes travel with them)
  but not deleted until those are decided; an agent that replaces a table with the table it wants
  changes rows and columns as these commands do (format §3.7, "Agents").
- **A table deleted whole** (Delete Table, or ⌫ again on a selected table whose cells are empty) is,
  with Track Changes on, one deletion of the block (format §3.4, §3.7 rule 6); with it off the table
  goes as text. In Redlines the deletion is drawn where the table was, as a **ghost table**: its
  first eight rows, the header's among them, as a table with its alignments, the text struck in the
  author's color on the author's tint, with a bar. Past eight rows the rest are one line, "and 12
  more rows". It is not editable: the caret and ↑ ↓ skip it, and a press on it opens its card and
  puts no caret there. The ghost table of a table that is all the text of the file is drawn only on
  the file's first line and only while nothing follows it (typing near its marker draws it as one
  struck source line; issue #470). The card says "Deleted table (3 columns, 20 rows)"; accepting
  makes the deletion final and rejecting writes the table back. Simple draws the bar and no table,
  and Clean shows the text without it. Your own pending changes in the table fold into the
  deletion, as rejecting them would. Where the fine deletion would be refused (another person's
  pending change in the table, a comment that runs out of the table or that no text next to the
  table can keep, a marker with no place: a code block follows the table with no text between, it
  ends the text right after a code block or a rule, it starts right under a line of text, or it is
  next to a heading with closing `#`s or attributes), it is written as the replacement of the table,
  or of the block that holds it with the line above, with other people's pending changes left in
  its old text (#657, #863); the other comments become point comments where the table was. A
  selection that covers exactly one whole table (blank space beside it allowed), then ⌫, ⌦ or Cut,
  runs Delete Table with the same rules, named refusals included (#858); a table that is all the
  text of the file stays with block editing (issue #470). An agent's replacement is the ordinary
  deletion of a block (format §3.4): it doesn't fold your changes in. Where no unit holds the
  deletion, the words say what to do (#454, #876): put a paragraph or a blank line between, or turn
  off Track Changes, which deletes the table's text.

### 5.9 Command palette and shortcuts

**The command palette** is the toolbar's search (§5.1, #550): ⇧⌘P (Ctrl+Shift+P on Windows and
Linux) shows the toolbar at the caret with the keyboard in it, and typing turns it into a search
over every command that works at the caret and every app command and setting the host offers, each
with its shortcut. One command registry serves the menus, shortcuts, the palette, plugins and
agents.

**Your own shortcuts** (#535, #551). Every command's key is in one book: the command's own, and
over it what the person changed (`settings.shortcuts`, a command's id to a key, or "" for none),
which every window shares. The editor's keys, the menu bar and the title bar's hints and menus all
read it, so a change works at once and survives a restart. Preferences › Shortcuts lists every
command under its menu with its key. A click on the key records a new one: it needs ⌘, ⌃ or ⌥, Esc
cancels and ⌫ clears. A key that is another command's asks "⌘I is Italic's" with Replace (which
leaves the other with no key) or Cancel; a key macOS keeps (⌘Q, ⌘H, ⌘M, ⌘W, ⌘Space, ⌥⌘H, ⌃⌘F, ⌘Tab,
⌃↑, ⌃↓) and Cut, Copy, Paste and Select All are refused, with the reason in the row. Quit, Undo and
Redo keep their keys. The pane has its own Filter (typing in it goes there, not to the window's
filter) and Reset All. The commands' keymap comes before every other keymap of the editor, so a
key the person chose beats a binding of the editor's or a plugin's own.

| Action                         | macOS                                                                                         | Windows and Linux         |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------- |
| New paragraph, line break      | Return and ⇧Return                                                                            | Enter and Shift+Enter     |
| Track Changes on or off        | ⌘⇧E                                                                                           | Ctrl+Shift+E              |
| New comment                    | ⌘⌥M                                                                                           | Ctrl+Alt+M                |
| Highlight                      | ⇧⌘H                                                                                           | Ctrl+Shift+H              |
| Post a comment                 | ⌘↩                                                                                            | Ctrl+Enter                |
| Next and previous change       | ⌘⌥] and ⌘⌥[                                                                                   | Ctrl+Alt+] and Ctrl+Alt+[ |
| Find, next, previous           | ⌘F, ⌘G and ⇧⌘G                                                                                | Ctrl+F, Ctrl+G and Ctrl+Shift+G |
| Find and Replace               | ⌥⌘F                                                                                           | Ctrl+Alt+F                |
| Clean, Redlines, Plain           | ⌥⌘1, ⌥⌘2, ⌥⌘3                                                                                 | not chosen yet            |
| Simple Look (switch)           | ⌥⌘4                                                                                           | not chosen yet            |
| Bold, italic                   | ⌘B and ⌘I                                                                                     | Ctrl+B and Ctrl+I         |
| Code, strikethrough            | ⌃` and ⌃⇧`                                                                                    | Ctrl+` and Ctrl+Shift+`   |
| Subscript, superscript         | ⌥⌘, and ⌥⌘. (Word's ⌘= and ⇧⌘= are Zoom In here)                                              | Ctrl+Alt+, and Ctrl+Alt+. |
| Link, clear formatting         | ⌘K and ⌘\                                                                                     | Ctrl+K and Ctrl+\         |
| Body, Heading 1 to 6           | ⇧⌘N and ⌘1 to ⌘6                                                                              | Ctrl+Shift+N and Ctrl+1 to Ctrl+6 |
| Quote, bulleted, numbered, task list | ⌘⌥Q, ⌘⌥U, ⌘⌥O and ⌘⌥X                                                                    | Ctrl+Alt+Q, U, O and X    |
| Check item (task list)         | ⇧⌘U (checks or unchecks the task items in the selection; it replaces CodeMirror's "redo selection" on the Mac, which Redlines no longer binds there) | Ctrl+Shift+U              |
| Code block, table              | ⌘⌥C and ⌘⌥T                                                                                   | Ctrl+Alt+C and Ctrl+Alt+T |
| Show the toolbar               | ⇧⌘P (at the caret; the title bar's wrench docks it)                                           | Ctrl+Shift+P              |
| Show the outline               | ⌃⌘O (View › Show Outline: opens the list and puts the focus on the heading you are reading)  | —                         |
| Ask about the selection        | ⌥⌘A (the box opens at the selection; Return asks, Esc closes)                                 | Ctrl+Alt+A                |
| In a table: next, previous cell | Tab and ⇧Tab (Tab in the last cell adds a row)                                              | Tab and Shift+Tab         |
| In a table: line break in a cell | Return or ⇧Return                                                                           | Enter or Shift+Enter      |
| In a table: insert row above, below | ⌥⌘↑ and ⌥⌘↓ (⌘↩ also below)                                                              | Ctrl+Alt+Up and Down (Ctrl+Enter below) |
| In a table: delete row, move row up, down | ⌥⌘⌫ (also ⇧⌘K), ⌥↑ and ⌥↓                                                            | Ctrl+Alt+Backspace, Alt+Up and Down |
| Move a paragraph, list item or block up, down | ⌥↑ and ⌥↓ (the blocks a selection covers move together; tracked, it is one change that is accepted or rejected whole, format §3.14) | Alt+Up and Down |
| In a table: insert column left, right; delete column | ⌥⌘← and ⌥⌘→; ⌃⌘⌫                                                                 | Ctrl+Alt+Left and Right; Ctrl+Win+Backspace |
| In a table: select cells       | ⇧ with an arrow, ⌘A (cell, table, document), ⌃L (the row), Esc (a caret)                      | Shift with an arrow, Ctrl+A, Ctrl+L, Esc |
| In a table: clear cells; delete emptied rows, columns, the table | ⌫ or ⌦; again once whole rows, columns or the table are selected and empty                  | Backspace or Delete; again       |
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
| **Markdown**    | Any `.md`, `.qmd`, `.Rmd` file                                                                                                | Clean export (every change accepted), the review view, and Word through the pandoc filter for R Markdown and Quarto                                                                                                                                                              |

**What is built.** Pasting from the web, Word and Google Docs is built: Redlines' converter reads
their clipboard HTML (Docs' indented paragraphs as quotes, monospace runs as one fenced block, table
alignment, nested lists, Word's list and quote styles, #842; Word's forms come from hand-written
fixtures until real captures replace them), and copying out is built: the clipboard's HTML is `documentHtml` with its `office` option, for
Word and Google Docs (inline styles, `<s>` for a strike, code colored, bordered cells with widths,
a quote that reads without its rule, #874), and the selection's local pictures are embedded as
`data:` addresses, sized to the column, where a remote one keeps its address unless the page can read it (#882). It has been checked by
pasting into Google Docs; Word itself has not been checked yet. `@redlines/word` (§6.3)
writes a `.docx` from a Redlines file (tracked changes, comments, replies, tables, format changes,
splits, joins, moves, images and task lists, with the data a round trip needs, #834, #847, #845),
reads a `.docx` with its revisions and comments (#840) and maps the result to Markdown with its
marks and ledger (#866), and has Google Docs' differences (#838). File › Export to Word… calls
the writer (#841) and File › Open .docx… the reader (#881; pictures are carried into the images folder after a save panel, #885); the full Word
round trip is still to be wired in, and Copy for Word as a command of its own is not built (an
ordinary copy writes the HTML that Word and Docs draw well); File › Print and Export as PDF are built.

- **Paste rules:** a pasted table without a header row gets its first row as the header, because
  GFM tables need one. Images pasted from the web keep their URLs. Lists and paragraphs inside
  pasted table cells are kept. Pasting a URL onto a selection makes it a link, replacing an
  existing link rather than nesting one. ⇧⌘V pastes plain text. Copying cells puts tab-separated
  text and an HTML table; pasting a range into cells is §5.8.
- **Copying only deleted text.** A selection that holds only pending deleted text, in Simple or
  Redlines, copies what is seen: the struck text, as plain text, with no marks. Clean shows no
  deletion and copies nothing. Any other selection copies its newest text.
- **List items pasted into a list item.** A paste that is only list items (bullets, numbers or
  tasks, nested or not, from Markdown or from a page's list) made at a caret, or over a selection,
  inside a list item adds items to that list, as Return does, and never text inside the item. At
  the end of an item they follow it at its level (after its nested items, when it has some); at the
  start of a non-empty item they go before it; in an empty item they replace it; in the middle of
  an item, or over a selection inside it (the selection is deleted first, and may reach into the
  next item), the item splits at the caret and they go between the halves. Pasted nesting keeps
  its relative depth. The pasted items take the target list's kind, so that the result is one
  list: a `1.` item pasted into a bullet list is a bullet, a bullet pasted into a numbered list
  is the next number (the same number in a list numbered alike), a task keeps its checkbox, and
  nested items keep their own markers. A loose list stays as loose as it was. With Track Changes
  on the new items are one insertion, written as Return and typing write them, and every order of
  decisions reads alike. One Undo takes back the whole paste, the selection's deletion with it.
  Pasting list items into a paragraph outside any list, a paste with a blank line between its
  items, one with items that hold more than text and nested items, a selection over a marker, and
  places where Return itself works another way (inside a code span's marks, at a line break inside
  an item's text) go in as text, as they did.
- **Images.** Image files dropped on the editor, image data pasted (a screenshot, an image copied
  in Preview, an image file copied in Finder) and Insert › Image… (the Insert Image command, which
  asks for files in the system's panel) all do the same. The file is copied into the folder for
  images, never moved, and a link to the copy goes in, relative to
  the document (`![](images/screenshot.png)`), so it works on GitHub and in other editors. A paste
  goes in at the caret. A dropped file lands between blocks (#674): a block of its own at the gap
  between top-level blocks nearest the pointer, never in the middle of a paragraph, with a gray drop
  line while files are dragged over the text (in the Mac app the system hands the window only the
  drop, so there the line isn't drawn live and the image lands where it would have shown). A drop
  over the sidebar, the title bar or the ground below the text goes where the caret is. The image
  shows at once. The caret ends at the end of the links, as after any paste. The preview draws an
  image whenever the selection has no end inside its syntax: a click on it selects it (an outline
  and its handles, its Markdown or HTML hidden; the source shows in Plain), and the caret steps over
  it as one unit with the arrows. Several images go in as links a space apart, and nothing else
  is written. A dropped file, or an image file copied in Finder, keeps its name, and pasted image
  data, which has none worth keeping, gets one made of the time (`image-2026-11-12-153012.png`). A
  name that is taken gets `-2`, `-3` and on, and no file is ever replaced; an image that is in the
  folder already is linked, not copied. With Track Changes on, the link is the person's own tracked
  insertion, and Undo, named Insert Image, takes it back in one step. Rejecting the insertion or
  undoing it takes back the link only: the file stays in the project’s folder for images, where it can be seen and
  deleted by hand, because Redlines never deletes a file it might not be the only one to want. A
  document with no file yet asks to be saved first, since there is no project folder to save in. The
  person may go on writing while the images are saved: the links go in where the paste or drop was,
  ahead of what was typed there meanwhile. A selection that a paste replaces is replaced only while
  all of it is still there; what was typed in it stays, and the links go after it. A document that
  was replaced meanwhile gets none of the links, and the person is told, the files being where they
  were saved.
- **Where images go** (#523) is one folder for the project, Preferences › Editor › Images: `images`
  (the name can be changed) in the project folder the sidebar shows, which is the repository's root,
  or the document's own folder where it is in no repository. Every document of the project saves
  its images there and links them by a path from where it is (`../images/shot.png`), so the
  preview, which loads from the project folder, finds them from a document in any folder below it,
  a hidden one included. An image dragged in from elsewhere is copied in, never moved, and nothing
  is ever replaced: a taken name gets `-2`, `-3` and on, and an image that is there already, byte
  for byte, is linked and not copied again. A document that is in no project keeps an `images`
  folder beside it. A document in the home folder or at the disk's root, whose project is too broad
  to load images from but for its own folder, takes images in that folder alone. The setting can't
  name another place on the disk. Only image files go in, by their
  names and by their first bytes, and no larger than the preview shows (50 MB). None goes in code,
  or in Plain while Track Changes is on, and the editor says why before anything is saved. Images
  pasted from the web keep their URLs: a clipboard with HTML on it, such as an image copied in a
  browser, is left to the HTML.
- **An image dragged from the sidebar** (#681) is inserted as `![](path)` in a block of its own at
  the gap nearest the pointer, with the same drop line. It is the project's own file, so it is
  never copied: the link is its path from the document. It is one step to undo, and a tracked
  insertion with Track Changes on, and is refused where an image may not go (in code, say).
- **Cropping an image** (#624). Image › Crop… puts a crop box with a handle at each corner and edge over a
  local image; Return or Done applies it, Escape cancels. The app writes the part inside the box as
  a copy beside the others in the project's folder for images (`photo-crop.png`, numbered when the
  name is taken), and the Markdown points at the copy, keeping the text, the title, the width and
  the alignment. The original stays, so rejecting the change gets it back. With Track Changes on
  the change of the address is an ordinary tracked change, never refused, and one Undo takes it back.
  It needs the picture as it reads (not Plain) and a host that can write the copy.
- **Editing an image in Preview.** A double-click on an image opens its file in Preview (and the
  command Edit Image in Preview, `image.edit`, does the same for the image under the caret or in
  the selection, which the toolbar's Image menu offers). The editor only hands the host the
  image's path as the document writes it (`EditorOptions.openImage`); the app resolves it from the
  document, and opens it only if it is an image inside the project folder the sidebar shows, below
  no hidden name, not a program, an alias or a link that leads out (the rule of a link to an image
  in the sidebar, `open_default`), and says why when it isn't. A remote image has no file, and a
  double-click on it does nothing (it selects no word either). A page or an embed gives no hook:
  a double-click there does what it does anywhere in the text. The second click of the pair
  selects no word. When the person saves in Preview and comes back to the window, the app asks the
  stamps (modification time and size) of the images the document drew, and loads again, from a
  URL with a version, the ones that changed and no other; the document's text is never touched. It
  looks when the window regains the focus rather than watching the files, since the app watches a
  document's own file alone, and the picture of a file that is gone stays as it was.
- **A paste never creates marks from the clipboard's content.** Pasted text that holds Redlines
  markup is pasted as its newest text, without the markers or the ledger, so a paste can't forge
  someone else's change. Copy works the same way: Clean and Redlines, in either look, copy the newest text, and Plain
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

- the command palette (§5.9, the toolbar's search);
- a folder sidebar (written), Quick Open and folder search, which folder chat also needs;
- links from pasting a URL onto a selection (§5.10), and ⌘-click to open one (§5.2);
- R Markdown and Quarto chunk options kept byte for byte.

**Should (v1 if time allows):**

- a selection toolbar: Comment, Suggest, Ask, and formatting. Written as the toolbar (§5.1), which
  opens from the title bar's wrench, on ⇧⌘P and on right-click rather than floating over a
  selection by itself, with Ask (§8.5); Suggest and the agent's fix, shorten and rephrase are not in
  it yet;
- a slash menu that opens only at the start of a line or after a space, and can be turned off;
- heading and list folding, per viewer, with a count of hidden changes on a folded heading;
- dragging sections in the outline, and moving blocks with the keyboard, tracked as moves;
- `[[` autocomplete that writes standard links (`[text](file.md#heading)`), which work on GitHub;
- captions of images (resizing and alt text are built, §5.2); callouts (§5.2: GitHub's and Obsidian's are built, Quarto's
  are not drawn yet); Mermaid editing with a live preview;
- a copy button and a wrap toggle on code blocks (the colors are written, §6.4);
- citations from the document's bibliography in `.qmd` and `.Rmd`;
- find and replace under tracking: each replacement is a substitution. Written: Replace All is one
  step to undo, with one change per match. Not yet: deciding all of its changes at once;
- paste options after a paste: keep formatting, plain text, code, or download the images;
- templates as plain `.md` files with `{{title}}` and `{{date}}`, never executable code;
- focus and typewriter modes.

**Could (later):** scrollbar marks for changes and comments; block handles; previews of linked
files on hover; backlinks, and links that follow a rename (fixed in other files as tracked
changes); link cards; chips for Quarto shortcodes and cross-references; a form
for front matter; merge conflicts shown as tracked changes; reading settings per viewer (a
reading width, a dark page).

**Not in v1:** anything other tools couldn't show (columns, @mentions and dates in body text,
wiki-link storage, stored embeds, text color); a notification service of our own (apps such as
Syrus and GitHub notify); paragraph locking.

### 5.13 Undo

Undo goes back in time through what this window did: your edits, decisions, comments and replies,
and the runs of your agents (§8). Turning Track Changes on or off is no step: it changes nothing in the file (§5.4). ⌘Z takes back the newest step and ⇧⌘Z puts it back; the history
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
- **Return again in the empty paragraph gives the text room.** At the top level it writes a line
  that holds only `&nbsp;` and opens the next empty paragraph below it; every view draws that line
  as an empty line, and GitHub and other readers show an empty paragraph (format §3.4).
- **The empty paragraph exists while you're in it.** Markdown keeps no empty paragraph, so the one
  Return opens is taken back when the caret leaves it, and the file never gets it: saving, the
  edited state and agents read the document without it.
- **Typed syntax makes a block on the space.** In an empty paragraph `#` and a space is a heading,
  `-` or `1.` and a space an item, `>` a quote at once, three backticks a code block closed at
  once, `---` and Return a thematic break, and `| a | b |` and Return a table. A lone `#` or `-`
  is drawn as body text until the space completes it. The Paragraph menu writes the same syntax on
  an empty paragraph (Body does nothing); an empty heading, item, quote or code block stays when
  the caret leaves it, an empty paragraph goes.
- **A paragraph you just typed takes a block change as typed text.** With Track Changes on, ⌘1 to
  ⌘6, Quote and the lists on a paragraph that is all your own new text write their syntax into your
  insertion, as typing it would, so there is no change of its own to decide, and accepting or
  rejecting the insertion takes the syntax with it (format §2.6, #173). It holds for any paragraph of
  a document you typed in one go, the title first, and wherever the caret stands in it, past its end
  too (where a selection may end), and with your own Return after it, as when you type in front of a paragraph.
  Where only part of it is yours it is a change of the block, with a mark of its own; where your new
  text starts it, or another person's change starts it or holds a line break in it, the change waits
  for that to be decided, and the notice says so.
- **Backspace right after Return takes it back,** exactly, byte for byte, from a record of the
  Returns pressed one after the other.
- **Backspace and Delete join at block edges.** Backspace at the start of a block's text joins it to
  the block above, which keeps its kind; Delete at the end joins the next. An empty block goes.
  Nothing joins into code, a table or front matter: the caret goes there instead. At the start of
  a list item, the first Backspace takes the bullet off and keeps the text where it is, the second
  joins it to the item above, as in Word.
- **What is nested under an item stays a list when the item's marker goes.** Backspace at the start
  of the first item of a list takes its marker away and leaves its text a paragraph, and Delete
  at the end of the paragraph above a list takes the first item's marker into it. A list, a quote
  or a paragraph under the item moves out with the text, a level up, by as many columns as the
  item's marker and the spaces after it take, so that the depth among them is kept (Word and Google
  Docs promote the items under it the same way): `* note⏎    - a` becomes `note⏎  - a`, where it
  would have been one paragraph of two lines, which Markdown reads as text. Where nothing under the
  item would stand four columns in, nothing moves. With Track Changes on the move is one
  substitution that holds the old lines, written beside the deletion of the marker (`* note⏎    - a`
  gives `<!--del * -->⏎⏎note<!--sub \n    - a-->⏎  - a<!--/-->`), which reads the same in every
  order of decisions; where fenced or indented code stands among the lines that move, or the
  tracked layer can't hold the lines, the key is written as a replacement of the whole item
  (format §3.12), and only where another person's change ends at the item's edge does it say so in
  words and write nothing (#808, #107). Shift-Tab and the first Backspace in a nested
  list move what is nested in the item along, as before. Shift-Tab in indented code outdents it
  to a paragraph, and where a line stands right under the code (an item, or text) it keeps the four
  columns that make it code and says so, since the line would else join the paragraph.
- **The keys read a list as CommonMark does.** A numbered line other than `1.` right under an
  item's text (`1. a⏎   2. b`) is more of that text, not a sublist, so Return at its end makes the
  next item of the list that holds `a`, and the file reads, in every order of decisions, as the
  view shows it (format §3.2).
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
| `@redlines/editor`     | The editor core on CodeMirror 6: Markdown display, the tracked-change layer, the Clean, Redlines (in two looks) and Plain views, modes, undo, find, the command registry, settings, theme tokens and the plugin host | Browsers and webviews |
| `@redlines/plugin-api` | The plugin interface: manifest, contributions, capabilities. Versioned on its own and kept stable                                         | —                       |
| `@redlines/agent-tools` | The six tools every agent acts through (§8.3): `view`, `read_thread`, `str_replace`, `comment`, `reply` and `status`, with their limits, and the MCP server that offers them. A seventh, `view_image`, is offered only to a request to describe an image (Alt Text, §5.2): it takes no argument and returns the one picture the host chose, as an MCP image content block. TypeScript with no DOM or Node APIs, so it runs in the webview and in QuickJS | Anywhere |
| `@redlines/agent-process` | What the Claude and Codex providers share: finding an agent's program, asking it whether it is signed in, and following a run to its end | Anywhere (no DOM, no Node APIs) |
| `@redlines/react`      | `<RedlinesEditor>` for React, and a `<redlines-editor>` web component for other frameworks                                                 | Browsers                |
| `@redlines/render`     | Static HTML rendering and pagination, for print, PDF, HTML export and previews                                                              | Browsers, Node          |
| `@redlines/clipboard`  | HTML-to-Markdown conversion for paste, and the copy formats: Redlines' own, Word's HTML, generic HTML, Markdown, plain text                 | Browsers                |
| `@redlines/word`       | Word (`.docx`) export (`exportDocx`), import (a reader that turns a `.docx` into blocks and runs with its revisions and comments, and a mapper from that model to Markdown with its marks and ledger) and the Google Docs differences (§5.10; [export](word-export/README.md)). File › Export to Word… and Open .docx… call it; it is kept out of the editor's bundle | Browsers, Node          |
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
table is the plan. Written so far: `review`, `themes`, `code`, `find`, `formatting`, `outline`, `tables` (the Table menu and the grips), `emoji`,
`toolbar`, `agents` and the three providers (`plugins/`). The `ai` row is what `agents` is growing toward: its chat panel isn't
written. The `word` row is a library so far, `@redlines/word` (§6.3), and no plugin: nothing in the
app calls it yet, and neither `print` nor `export` is written as a plugin (the app's File › Print
is its own).

| Plugin       | Adds                                                                         | Needs from the host        |
| ------------ | ---------------------------------------------------------------------------- | -------------------------- |
| `review`     | The review bar, change cards, the comment rail and the Changes tab           | Document data, for drafts  |
| `tables`     | Table editing: the Table menu, the grips, the + and dragging rows and columns (the core draws tables, selects cells and pastes ranges) | — |
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
| `emoji`      | Emoji shortcodes drawn as their emoji, and the list of emoji after a colon (§5.2) | —                    |
| `toolbar`    | The toolbar: the title bar's wrench, right-click and ⇧⌘P (§5.1) | —               |
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
nothing in it run. The app tells a window of paths by the same two limits: the names in a folder,
only for a project folder a sidebar shows and for the folders below it that the sidebar lists (none
hidden, none that git ignores); the real path of a file, links followed, only for a file the person
opened or saved and for what is inside a project folder a sidebar shows, with no hidden name below
the folder; and the project of a document, the repository that holds it or else its own folder,
only for a document the person opened or saved, by a path with no `..` in it, as a dialog gives it:
asking for it is what shows the project. The scope knows a document by the file it really is, so a
path that reaches it through a link, which a window can spell too, is not told apart from the one
the person went through, and shows the project the path goes through (#458). The same limits decide
what the app opens for a window in another app: an image or a PDF, in Preview, only when it is
inside a project folder a sidebar shows and below no hidden name, so a window can't open one by
naming the folder that holds it as its own project. Where a document sits directly in the home
folder, that is the folder shown, and these limits reach as far down as it goes, though the images
the preview loads stop at the document's own folder (#451). A link in a project that leads out of
it is no more known than the file it leads to, and anything else asked of gets one refusal, which
says nothing of whether the path is there. No window goes to an `asset:` URL itself. A drop on a
window adds nothing of itself: a document dropped opens as one from Finder does, and is the
window's, with its project's
images, as any document the person opens is (but for the file that the window's own document icon
dragged, dropped back on that window, which opens nothing). Image files dropped alone, every file of
the drop an image, are the window's to add to its document (§5.10), and are the one exception: the
app, which has them from the system's drop, keeps them for that window and tells it how many there
are, where they landed, and an id to ask for them by. The panel that Insert › Image… shows is the
app's too, so the window can raise a panel for image files and is given no path by it, only an id.
The app copies the files into the folder for the document's images when the window asks, so the
window never names a file to copy and reads none of them, and a pasted image's bytes, which the
window has, are written the same way. What is copied is an image by its name and its first bytes, no
larger than the preview shows, and goes inside the folder of a document the window may use and says
it holds (the same trust as Rename and Reveal in Finder): in that folder itself, or in one folder
named in the settings, never one that is a link out of it, and never replacing a file. A folder or
any other file dropped opens nothing, and lets the window read nothing it couldn't before. Tauri
adds everything dropped on a window to the scope of its own asset protocol, a folder with all it
holds, so the app serves `asset:` URLs itself and builds Tauri without that protocol.

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

Status: nothing in this section is on `main` as a feature. The simulations behind it are in
[research](research/collaboration.md), and [the multiuser study](research/multiuser.md) (November
2026) says what it would take: one authority per session that orders edits and decisions, with
roles (viewer, commenter, editor) and a guard on accept and reject; its first Epic is the
foundations and one document in several windows of one Mac, and its first decisions are taken
(iroh's public relays, no accounts of our own). The authority, its protocol and its roles are being
written on an integration branch (`packages/collab`) and are not merged. The text below is the
design they follow.

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
| `str_replace` | `path`, `old_str`, `new_str`         | `old_str` must match the newest view once. A rewrite is one change, a small fix stays small ([§3.11](format.md#311-changes-from-a-new-text)). Deleting all the text of a wrapped line takes its line break too, so that the paragraph does not part ([§3.2](format.md#32-line-starts)) |
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
  - **Starting it.** Select text and choose Ask: ⌥⌘A, Review › Ask…, or the Ask item of the
    toolbar (§5.1), first in the bar. A small box opens at the selection for the
    question, and an empty first question means "Explain this in the context of the document." (A
    Return in an empty follow-up field asks nothing.) The default agent answers, and @ picks
    another, as in a comment. The bubble shows which agent answers and, where the agent lists
    models (§8.6), a model list at its lower left (#836): it starts at Preferences' choice for
    that agent, a pick holds for the follow-ups in that bubble, and Default names none, so
    Preferences' choice applies. An agent that lists no models shows its name alone. Not in Plain, where a selection
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
    tinted while it is open. Esc or a press elsewhere closes it, and stops a run still going; a
    press on one of the rail's notes, which the bubble made room around, closes it once that click
    is over, and not at the press, so that the notes don't move from under the pointer and the
    click lands. A failure stays on the line with its log, and with a button that opens
    Preferences where they can put it right (the agent is signed out or too old), as a comment's
    run does. Where the rail shows its notes, the rail lays the bubble out among them, level with
    the start of the selection, as it does a new comment's box (§5.7): the notes around it go up
    or down to clear it, so that none is hidden, and they go back when it closes. A comment's box
    open at the same time is placed around the bubble, as a note is. Where the rail shows none (a
    narrow window, where the notes are dots; Clean; a document with no comment) the bubble hangs
    over the page, in the margin beside the column or, with no room there, under the selection.
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
    goes once the window is open: if it can't be, a notice says so and the bubble stays. The text
    is unsaved there as in any new document, and in the window's first moment, before its page has
    said what it holds and can be asked about it, a quit, a restart or a logout, and the window's
    own close, are refused, as a Cancel would be: the app says the window is still opening, and the
    person tries again. The hold lasts ten seconds at most, so that a page that never loads can't
    keep the app from quitting. Copy puts the answer's text on the clipboard. Nothing is kept
    unless asked.
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
| **Other agents,** such as GitHub Copilot and Gemini | One provider for the Agent Client Protocol, given a command to run | Each agent's own | Written; Preferences doesn't offer adding one yet |
| **OpenClaw** agents, such as Moby | The same provider, for `openclaw acp`, which forwards each prompt to an OpenClaw Gateway, on this Mac or elsewhere; no toolbox, it answers in text (below) | The Gateway's: a token in a file Redlines never reads | Written; Preferences › Agents › OpenClaw |
| **Sign in with ChatGPT** inside Redlines, for people with a plan and no command line | Redlines' own agent loop | Redlines would hold tokens | Not written |
| **API keys and local models** | Through an ACP agent that supports them, or `codex --oss` | None, or a key | Not written |

Redlines never reads, stores or passes Claude or ChatGPT credentials. Whether someone is signed in
is what the agent's own status command says, and when they aren't, the thread says so in one line
(for example, "Claude isn't signed in. Run `claude auth login`."), which offers to open Preferences ›
Agents. An agent is shown by its **handle, capitalized**: with the handle `ada`, the picker, Ask and
the answers say "Ada", and `@` and the handle names it in a mention. The cards in Preferences keep the
programs' names (Claude Code, Codex, OpenClaw).

**Handles** (#558). Each card has a Handle field, which says "Shown as Ada". A handle is lowercase
letters, digits and hyphens, no hyphen at either end, and at most 24 characters; a handle another agent
has (Redlines' own, or the name of an OpenClaw agent) is refused with a note, and the old handle comes
back when the field is left. The defaults are `claude` and `codex`; an OpenClaw agent is named by the
person when it is added (Moby, by default in the form), and that name is its handle. There is one
thing, not a display name beside the handle. What the host knows the agent by (its id) never changes,
so a file's authors (`claude-<person>`) stay what they were; a mention of the old handle starts
nothing once it has changed. Handles are kept in the app's settings (`agentHandles`) and read at
every look at the agents, so a change reaches the open documents' pickers at once.

**Default agent** (#528). Once more than one agent is set up (a program found on this Mac, or an
OpenClaw agent), the first row of the pane is a choice of them, by the names they are shown as. An Ask
that names no agent goes to the one chosen (else to the first that is ready), and the @ picker lists it
first. It is kept in the app's settings (`defaultAgent`, an id); it is never a file's author.

**Models** (#530). A provider lists the models its program can be told to run (`AgentProvider.models`:
Claude Code's aliases Opus, Sonnet and Haiku, and a short list for Codex, which has no command that
lists them); an OpenClaw agent lists none, because its Gateway chooses, so its card has no Model field.
A card's Model field is Default, which says nothing and leaves the program's own default, or one of the
list; the choice is kept in the app's settings (`agentModels`, by agent id) and reaches every run of the
agent, a comment's and an Ask's. A request can carry its own model (`AgentRequest.model`), which Ask's
picker uses; the program is told only a model its provider lists.

**Setting an agent up.** Preferences › Agents shows each agent's state, the version and the path of
the program found (so that a stale second copy earlier on the PATH shows) and the next step as a
button, and Check Again always:

- **Too old** (older than the version the provider was tested with): the row says an update is
  needed, and what the program said when asked whether it is signed in, if it said (an older
  program may not know the question). Update runs the agent's own updater for the way it was
  installed, which its path says: `brew upgrade --cask` for a Homebrew install, `npm install -g
  <package>@latest` for a global npm install, and the agent's own `update` for any other
  (`claude update`, `codex update`). Redlines looks again when it ends.
- **A newer version** (#527): a program that is fine but older than the newest shows Update too, and
  says "Version 2.2.0 is available." Update shows only then, or when the program is too old. The newest
  is the version npm's registry lists for the agent's package (the one its own updater installs), which
  the app asks for with the system's `curl` at a fixed address, sending nothing of the person's, and
  keeps for six hours; Check Again asks afresh. A look that fails (offline) shows no Update and says
  nothing.
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
the app carries its own, so that an installed copy that is older shows Update Skill, which keeps the
old file as `SKILL.md.bak` (a copy edited by hand reads as older, and is replaced). Only a copy of
this skill is replaced: a skill of someone's own with the same name, a link (a skills folder kept
in a repository of dotfiles is one), and a newer copy are left as they are, and the row says so.
The Claude Code skill is also a plugin, and this repository a marketplace for it
(`.claude-plugin/marketplace.json`); publishing the skill on ClawHub, OpenClaw's registry, is its
owner's, and the steps are written down (`integrations/README.md`), not done.

**OpenClaw.** An OpenClaw agent, such as one a person calls Moby, is reached through the Gateway
that runs it, which may be on another machine, by `openclaw acp`. Preferences › Agents › OpenClaw
takes its name (what is written after an @), the Gateway's address and the path of the file that
holds its token, and the app asks the person to allow `openclaw acp --url <address> --token-file
<file>`, with `--session agent:<id>:main` after them when they name the agent in OpenClaw (an agent
that isn't the Gateway's default needs it). It is an Agent Client Protocol agent, with these
differences:

- **It has no toolbox.** OpenClaw's bridge rejects an MCP server in `session/new` and never calls
  the client's files or terminal, and a Gateway elsewhere couldn't reach the toolbox, a program on
  this Mac, anyway. So the prompt carries what the tools would have shown: the thread as
  `read_thread` shows it and the document as `view` does, each marked as text that others wrote
  and never instructions (a document over 120,000 characters is cut, and says so), and the
  agent's last message is the reply, as for an agent that never calls `reply`: the first paragraph
  shows, and the rest folds behind More. It can't change the document; when asked for a change, it
  gives the wording in its reply. The first run in a folder asks "Send this document and this
  thread to Moby?", with the folder it keeps the answer for, and says that where it runs and what
  else it reads is up to its own settings; the answer is kept for the folder, as for any agent, and
  Remove in Preferences takes it with the agent.
- **Slash directives in what others wrote don't reach the Gateway.** The Gateway reads `/exec`,
  `/elevated`, `/model`, `/think`, `/queue` and the rest from the body of a message, wherever a `/`
  follows whitespace, and acts on them for whoever sent it. The prompt puts the thread, the
  document and the quoted text between that agent and this app in the same message as the
  request, so a `/` that starts a word in them is written `\/` (`withoutDirectives`, in
  `packages/agent-tools`), which the Gateway doesn't read as one. The person's own words are sent
  as they wrote them.
- **One session for each thread.** The key is `redlines-` and sixteen hex digits of a hash of the
  document's path and the thread's id, after `agent:<id>:` when the person named the agent, so that
  the agent keeps the thread and nothing else's, and a Gateway elsewhere is never given the path.
  A prompt to a session ends the run in it, so two threads must not share one. It is the key only:
  the bridge reads `_meta.sessionLabel` as the name of a session that is there already, and looks it
  up before the key, so a label fails the first run of every thread. The prompt asks the bridge not
  to put this Mac's folder at its head (`_meta.prefixCwd`). The host holds the session's `_meta` to
  exactly a key of that shape (`acp_gate.rs`), and a toolbox is refused to it as an empty list is
  to any other agent. Without an agent named in the form, the key is bare, and a Gateway with more
  than one agent says so (`Use an agent-prefixed session key or select an agent explicitly`), in the
  line the run fails with: name the agent then.
- **A turn the Gateway cut short is a failure.** The bridge says it as a message of the agent's own
  that begins `[OpenClaw interruption]` and then ends the turn as it ends one that was answered; the
  provider reads it as the run's error (`Moby stopped: …`), not as a reply to post.
- **Redlines never holds the token.** It passes the file's path to `openclaw`, which reads it. The
  command is held to exactly that shape: no `--token`, `--password` or other flag; an address with
  a user name, a password, a query, a fragment or a port that isn't a number, where a token could
  ride, is refused (a path is allowed, since a Gateway may be mounted at one, and the address is
  shown in lists of programs: put nothing secret in it); and the file has to be there, be a file
  and not a link (OpenClaw refuses one) and hold from one byte to 16 KiB, which is looked at
  without reading it. The question says where the document and the thread go, warns of a `ws://`
  address, which isn't encrypted, unless it is on this Mac (`localhost`, `127.0.0.1`, `[::1]`: what
  goes there stays on it, or goes through a tunnel its owner made), and of a token file that other
  people on the Mac can read.
- **Commands the Gateway asks to run** (its exec approvals, relayed as `session/request_permission`)
  are refused, as for any agent of this kind; the Gateway's default mode asks nothing.
- **Skill.** The section offers Install Skill for OpenClaw when an agent's Gateway is on this Mac
  (`ws://127.0.0.1`, `localhost`, `[::1]`): one elsewhere reads that machine's folders, where the
  skill goes. An address on this Mac may also be the end of a tunnel to a Gateway elsewhere, which
  can't be told, so the section says what the skill is for, beside the button.

Not done: tracked changes by an OpenClaw agent through this connection. They need a way for the
bridge to call tools that live in the client (an upstream change to OpenClaw), or the agent working
on the file with the `redlines` command on the same Mac, which the skill (above) teaches it.

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
folder. The setting is the most that any answer can give. When the person widens it, a line under
it says how many folders they allowed before are readable again ("2 folders you allowed before are
readable again."), counted from the narrowest setting since the pane opened, with Forget them,
which drops those answers so that nobody is asked again folder by folder (#382); narrowing says
nothing, and an agent that isn't held to the setting is left out of the count. The first run of an agent in a folder
asks in its thread (§5.7) what it may read, within the setting (the home folder is an answer only
while the setting allows it), and the answer is remembered for that agent and folder in the app's
settings, never in the document: an answer narrower than the setting stands, and one wider than
it is held to it and kept, and stands again if the setting is widened. A document in the home
folder itself, or in the disk's root, has no folder to read, and is read as This document.
**Web access** is one switch for every agent, Web access in Preferences › Agents, off by default.
Off, Claude Code's web tools and Codex's search are not allowed to the run, and an agent that reaches
for the web (a call to a web tool; for Codex, a `curl` or `wget` command, which its profile holds back)
stops the run, and a card in the corner asks: Don't Allow, Allow Once (this run, which starts again
with the web), or Allow Always, which turns the switch on. On, they are allowed to every run. An
answer that used the web says so under it in Ask's bubble. An agent the person added, which is held
to read-only by the host's rule, is not given the web.
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
  line over its code. HTML is drawn from the same allowed list as Clean (§5.2), never live: no script,
  no style, and nothing the document can make load. Quarto divs are drawn too (a `.callout-*` div is a
  quiet labelled box, any other div its text). An image that is a file in the
  document's project is drawn, an `<img>` tag at its `width` and `height` when these are digits; any other is its alt text, and one from a server is never loaded.
  - **One renderer.** The extension is a Quick Look *preview extension* (`QLPreviewProvider`, an
    `.appex` in `Contents/PlugIns`), the supported way since macOS 15 stopped loading generators.
    It carries a bundle of `@redlines/format` (`newestView`, the count of what waits),
    micromark with GitHub's extensions, the Default theme's tokens and its fonts, and runs it in
    the system's JavaScriptCore, for the HTML that Quick Look draws. It never calls the
    `redlines` program or anything on the `PATH`, and the app needn't be running.
  - **Nothing to install.** macOS registers the extension the first time the app runs from
    Applications and removing the app removes it. It needs macOS 13.3, the first whose
    JavaScriptCore has the regular-expression lookbehind that the format library's patterns use
    (its array methods came with 13.0). System Settings lists it with the other Quick Look
    extensions, on, and turns it off; Preferences › General › Quick Look previews of Markdown
    files has a button that opens that list (§5.1).
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
  - **Images.** An image is drawn when it is a file inside the document's project, its repository
    or else its own folder (the rule that the app's own preview loads images by, §6.5; a project
    that is too broad, the home folder, a folder above it or the disk's root, is its document's own
    folder alone, with no subfolder): no hidden file's or folder's, with no link leading out of the
    project to it, and whose name and first bytes both say it is an image the preview shows (PNG,
    JPEG, GIF, WebP, AVIF, HEIC, JPEG XL, BMP, ICO, TIFF or SVG). It loads at most 40 images, 16 MB
    each and 48 MB in all; any other image, and any
    that isn't there, is its alt text. An image from a server, or in a `data:` address, is never
    loaded, so that a preview never tells a server that a file was opened. A sandboxed extension
    can't read the files beside its document, so the extension has the sandbox's read-only
    exception for files (§11), loads the images itself (`PreviewImages.swift`), and hands them to
    Quick Look as the attachments of its answer, which the page names by `cid:` and which its
    Content-Security-Policy allows and nothing else (`img-src cid:`).
  - **Not yet:** thumbnails in Finder, which are a separate extension.

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
- **The Quick Look preview reads the file it is asked to preview, and the images that file links
  to,** in a sandbox with no network entitlement, and draws a page with no script that loads
  nothing but the images it was given (its Content-Security-Policy says so): a preview never tells
  a server that a file was opened. Its two exceptions to the sandbox are JavaScriptCore's
  compiler, without which the renderer is 5 to 8 times as slow, which a long document turns from a
  moment into a wait, and a read-only exception for files, which the images need and nothing else
  uses: it loads a file only inside the document's project, that is no hidden file's or folder's
  and that no link leads out of it to, whose name and first bytes both say it is an image. What it
  reads goes nowhere but into the page that Quick Look draws, since it has no network
  ([releasing](releasing.md#the-quick-look-extension)).
- **A desktop window reaches only the files the person opened or saved,** and the images its
  preview loads (§6.5). It reads and writes those files and no others (but for the images it adds
  beside its document, §5.10, which it cannot read back), and watches nothing itself:
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
6. **Shortcuts for the views** (§5.3): ⌥⌘1 to ⌥⌘3, in the menu's order, and ⌥⌘4 for the Simple Look
   switch below them. Word for Mac gives ⌥⌘1 to ⌥⌘3 to headings, which Redlines puts on ⌘1 to
   ⌘6; kept unless the clash proves real.
