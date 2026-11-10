# Tables edited as tables

*Design, Nov 10, 2026, for epic #175 (#176–#180). It builds on [design.md](../../design.md) §5.8,
[format.md](../../format.md) §3.7 and [research/tables.md](../../research/tables.md), agrees with
the block-editing design of the same day (`2026-11-10-block-editing-design.md`, E1), and says where
it departs from them.*

## Why

Stephan, reviewing build 10:

> Editing a table should be similar to how this is done in Word, Google Docs, etc. It also needs to
> support things like highlighting rows, columns, or the whole table; and it needs to be possible to
> copy and paste rectangular portions from a table. This needs to be really sophisticated to be
> good. Probably worth a lot of thought and also looking at how Google Docs does this. Needs to be
> possible also to insert/delete/move columns and rows.

Today a table is drawn as a table only while the caret is elsewhere. Clicking into it shows its
Markdown, pipes, padding and delimiter row included: "a table is edited as Markdown source, which
shows its pipes and hurts more than it helps" (#175). Design §5.8 chose the interaction (Google
Docs') and the tracked changes (Word's) a month ago, and none of it is built. The format parses
table marks (inserted rows and columns, deleted ones) but writes, draws and decides none of them:
probed today, a row inserted with Track Changes on is refused ("A line that is only Markdown syntax
takes no change"), a typed `|` adds a cell, and Return writes a split that breaks the row in two.

## In one paragraph

A table stays its Markdown source, edited by CodeMirror as text, and CodeMirror lays that source out
as a table: a block wrapper around its lines is the table, each line a row, each cell an
unsplittable mark. Pipes, padding and the delimiter row are hidden, and the caret steps over them, so
it moves, clicks, selects and types in cells as in a word processor, and everything that works on
text (Track Changes, spell check, input methods, Find, comments, cards, undo, agents) works in
cells unchanged. A selection whose ends are in two cells is a rectangle of cells: rows, columns and
the whole table are rectangles. Rows and columns are inserted, deleted and moved from a Table menu,
hover grips and a + on each boundary, and with Track Changes on each operation writes the form
format §3.7 already defines, drawn as Word draws it, decided in any order with the same result.
Ranges copy out as tab-separated text and an HTML table, and paste in over cells, growing the
table.

## The prototype

The riskiest question was the first one: can the table stay text, or must it be a widget with its
own editors inside? A throwaway prototype (outside the repo: a copy of `@redlines/editor` with the
table widget off and a new layer of about 1,200 lines) answered it in Chromium, with real clicks
and keys, and in WebKit, the engine of the Mac app, through an offscreen `WKWebView` in a process of
its own that ran the same checks with WebKit's own text insertion (`execCommand('insertText')`) and
synthetic presses.

| Question | Answer |
| --- | --- |
| Do the rows line up as a table? | Yes: block wrapper (`display: table`), rows (`table-row` line decorations), cells (`table-cell` outer marks). 0 px between the left edges of a column's cells, in both engines, with tracked changes, a change bar and a deleted row and a deleted column drawn in place |
| What breaks it? | Anything in a row that isn't a cell becomes a cell of its own: the change bar's `::before` on the row, CodeMirror's hidden-range spans and widget buffers at a non-inclusive mark's edges, the hidden delimiter row's spans, the buffers beside a ghost cell. Each has a fix below, and each fix was checked |
| Do clicks land? | Not in empty cells: CodeMirror's `posAtCoords` finds another cell's text for a point inside an empty cell, in both engines. A mouse selection style that hit-tests the cell box fixes every case |
| Do the keys work? | ← → (across cells and rows) and ↑ ↓ (by coordinates, in the column) work as CodeMirror does them, but ↑ ↓ into an empty cell. A table keymap fixes those, and does Tab, Home, End, Return, ⌫ at a cell's edge and ⌘A. Both engines gave the same result for every case |
| Does typing work? | Yes, in a cell, an empty cell and after a `<br>`, in Chromium by keystroke and in WebKit through its editing code. Tracked typing writes the format's inline marks in the cell, as today |
| Rectangles? | Read from the ordinary selection, drawn by a class on the cells; drag, ⇧-click and ⇧-arrows make them with no new state; clearing one writes one deletion per cell; one Undo restores it |
| Column widths? | The browser's automatic layout of the rows on screen moves columns while a long table scrolls (100/207/215/157 px at its top, 137/253/232/58 at its bottom). Widths computed from every row and laid out fixed are stable, and cheaper |
| What does a keystroke cost? | Chromium, a 10 KB document with a 300-row table: a paragraph 0.5 ms without the layer, 1.0 ms with it (incremental); a cell of the long table 1.1 ms as plain lines, 2.1 ms with fixed widths, 3.2 ms with automatic ones. WebKit (1 ms timer): about 2 ms, at most 3. The long-document test's budget is 16 ms (2 ms measured) |

A second, smaller model settled the format question that matters most (Track Changes, below): which
pending row and column changes can stand together in one table.

## Goals

1. A table looks finished while you edit it: no pipes, no delimiter row, cells you click into and
   type in (#176).
2. The caret, the keys and the mouse behave as in Word, Google Docs and Pages, wherever Markdown can
   hold the result.
3. Selections of cells, whole rows, whole columns and the whole table, by dragging, ⇧-click, the
   keyboard and the grips; Delete clears them; menus count them (#177).
4. Rows and columns inserted, deleted and moved, to any place, the last included, from a menu, the
   keyboard, hover grips and + controls (#178).
5. Rectangles copied to and from spreadsheets and other documents, a paste growing the table when it
   needs more rows or columns (#179).
6. Every one of these tracked when Track Changes is on, drawn as Word draws table changes, in the
   author's color, and decided in any order with the same result (#180).
7. A keystroke in a cell costs about what it does in a paragraph: the table layer's work is the row
   being edited, never the table or the document.

## Non-goals

- Merged cells, column widths stored in the file, captions, cell colors: GFM tables have none
  (design §2).
- Lists and paragraphs in cells. A cell holds inline text and line breaks; pasted lists are
  flattened, as today (`clipboard/place.ts`).
- Sorting, formulas, column types.
- Tables in list items and quotes: their lines carry container prefixes, and they stay Markdown
  source, as today.
- Copy for Word and printing: the static renderer draws tables already (research/tables.md).
- A table toolbar or a size grid. The v0.2 anti-goal against new chrome holds.

## Anti-goals

It fails, even if every operation technically works, if:

- the pipes show again anywhere but Raw, or a key ever deletes one;
- columns shift under the person's eyes while they type or scroll;
- a keystroke in a table is noticeably slower than in a paragraph;
- an ordinary key in a cell is refused (a structural command may be, with a reason);
- a tracked table change reads differently depending on the order it and its neighbors are decided
  in, or leaves a table whose rows have the wrong number of cells;
- a deleted row or column is invisible in Redlines, or a change is lost to a move;
- the right-click menu loses spelling and Look Up.

## Constraints

- **The format's rulings.** Every allowed edit reads the same in every decision order, judged
  exactly (micromark 4.0.2 is the oracle, and must read GFM tables: #146). Refuse rather than
  repair, but ordinary typing refused is a failure. `docs/format.md` is the source of truth;
  §3.7 already defines the marks, and this design adds rules to it deliberately.
- **A keystroke costs what it does on main.** Main's long-document test holds one update to 16 ms
  (32 on CI) and measures about 2 ms.
- **The platform.** Tauri v2 on macOS, `WKWebView`; CodeMirror 6.43, whose block wrappers
  (`EditorView.blockWrappers`) and outer decorations (`EditorView.outerDecorations`) this design
  rests on; native selection (no `drawSelection`); multiple selections off.
- **Accessibility.** Every action has a menu item and a keyboard path; the grips are for the pointer
  only; VoiceOver reads a table as a table wherever WebKit lets it.
- **Block editing (E1).** Blank lines between blocks are structure; Backspace after a table and
  Delete before one move the caret and delete nothing (E1, "as Docs does at a table"); typed
  `| a | b |` and Return makes a table; Tab in a table goes to the next cell and adds a row after the
  last. E1 deferred Return in a cell to this design ("until #176"), and refused line breaks in cells;
  this design decides both (below).

## Decided already

From design §5.8 and research/tables.md, kept: hover controls (a grip for each row and column, a +
on each boundary); a click on a grip selects its row or column; a drag moves it to any position,
the last included; selections of rectangles, whole rows and whole columns; Delete clears every
selected cell; menus count the selection ("Delete 2 rows"); pasting a spreadsheet range grows the
table; tracked changes as in Word, with inserted rows and columns tinted, deleted ones as
struck-through ghosts, moves with a double underline and a double strikethrough, in the author's
color; a move can be suggested and new empty cells are tinted; a table is never re-padded. From the
issues: highlight rows, columns or the table; copy and paste rectangles; insert, delete and move rows
and columns. From format §3.7: the forms of every table mark.

Everything else below is a call. Each is marked **Call:**, with its reason.

## How a table looks

As today's drawn table, while you edit it: the header row quieter and on the darker rule, a rule
under every row, cells padded, the table as wide as the text column, the delimiter row's alignment
applied. No pipes, no padding spaces, no delimiter row, in Clean and Redlines. Raw shows the source
as written. The grips and the + appear only on hover; nothing else is added around a table.

**Call:** no table toolbar and no size grid, though research/tables.md proposed both: the Table menu,
the grips' menus and the keys hold every command, and a toolbar is the new chrome v0.2 ruled out.

## The mechanism: a table stays text

**Call:** the table stays its source, laid out as a table by CodeMirror, not a widget with editors
inside. With the source in the editor, every feature that works on text works in cells as it is:
tracked typing through `trackedEdit`, the caret stepping over hidden markers, spell check, input
methods, dictation, Find, comment anchors, cards on hover, the rail's placement by
`coordsAtPos`, agents' edits, undo. A widget with a live editor per cell would have to rebuild or
forward each of those, and keep two selections, two histories and focus in step.

### Layout

| Piece | How | Why |
| --- | --- | --- |
| The table | Two block wrappers over its lines (`EditorView.blockWrappers`): an outer `div` that scrolls sideways, an inner `div` with `display: table`, `table-layout: fixed`, the column widths as CSS variables, `role="table"` | A real container: one table layout for all rows, sideways scrolling, accessibility roles |
| A row | Its line, with a line decoration: `display: table-row`, `role="row"`, a header class | Lines stay lines: CodeMirror measures and maps them as before |
| A cell | A mark through `EditorView.outerDecorations` (no other mark splits it), `inclusive: true`, `display: table-cell`, `role="cell"` or `"columnheader"`, `data-col`, the column's alignment | Every character of a row is in exactly one cell: a cell runs from the pipe in front of it (the line's start for the first) to the next pipe (the line's end for the last). Inclusive, so the hidden pieces at its edges are inside it |
| Pipes and padding | Replace decorations: the pipe and padding in front of a cell's text, and the padding after it | Hidden, and the caret steps over them (atoms, below) |
| A row's or column's marker | The tracked layer hides `<!--ins ID row-->` (or `col`) as any marker; the space after it is hidden with the cell's leading padding | The cell's text starts after them, so typing at its start goes after the marker (§3.7) |
| The delimiter row | One replace decoration over the line break before it and the row, inside the header's last cell | A hidden block would be a row of its own in the table |
| `<br>` in a cell | A replace decoration drawing a line break, and an atom | A cell's line break (Return, below) |
| An empty cell | A zero-width filler where its caret stop is | Gives the caret a line to stand on |
| A deleted row | A block widget at its place, drawn as a row of cells (`display: table-row`) | Inside the wrapper it is a row of the same table, so its cells line up |
| A deleted column | A replace widget in place of the pipe in front of where it comes back, drawn as a cell, in every row; the next cell's mark starts after that pipe | Between two cells' marks it is a cell of its own row |

**Call:** the blank line after a table and the `<!--del … row=N-->` lines below it are hidden by
block editing's one hidden-line computation (E1, `blocks/hidden.ts`), extended to know a table's
deletion lines, not by a second pass in the table layer: both sit in `tracked/decorations.ts`, and two
computations would disagree about which line is hidden.

Rules the prototype found, each a broken layout before its fix:

- Nothing but a cell may be a direct child of a row: anything else becomes a cell of its own, out of
  flow or not. A row's change bar is drawn by its first cell (`.rl-trow.rl-bar > .rl-tc:first-child::before`),
  not the row. CodeMirror's widget buffers beside a ghost cell are hidden in rows.
- A wrapper takes the blocks that start at its `to`, whatever its documentation says: it ends at
  the table's last line, or the blank line after the table joins it.
- CodeMirror's spacer for rows off screen (`.cm-gap`) lands inside the wrapper when a long table is
  partly drawn: it is laid out as a caption, outside the columns.

### The caret's stops

The caret steps over one atom from the end of a cell's text to the start of the next cell's text,
across padding, pipes, line breaks and the delimiter row (`EditorView.atomicRanges`), so → at the end
of a cell lands at the start of the next in one step, and at the end of a row, at the start of the
next row. A cell's stops are its text's start and end; an empty cell keeps one stop, after the first
space of its padding (in `|  |`, between the two spaces), where typing reads well (`| x |`). Hidden
markers inside a cell are the tracked layer's atoms, as anywhere.

The first atom reaches back over the line break before the table, and the last over the line break
after it, joining E1's atoms for the blank lines around, so the caret goes from the block above
straight into the first cell. No other place in a table's lines is a stop: text typed before a row's
first pipe would add a cell to the header and unmake the table, and text after its last pipe is a
cell GFM doesn't show. A caret or a selection's end that lands there anyway (Find, Undo, an agent's
edit, a reload) moves to the nearest stop of the nearest cell, as the tracked layer moves the caret
out of hidden markers today (`visibleSelection`); and an edit that would put text in a table outside
every cell is refused, as a guard that should never fire.

### Kept up to date, cheaply

A state field keeps the tables (read from the syntax tree) and their decorations. An edit inside one
row's text, with no line break, pipe or backslash in what it adds or removes, reads that row again;
any other edit that touches a table reads that table again; tables the edit doesn't touch are
mapped. In the prototype this matched a full rebuild exactly, and took the cost of a keystroke in a
paragraph from 1.8 ms (rebuilding every table) to 1.0 ms. The selection only redraws the cells whose
selected state changed. Column widths are not measured while you type (below), which takes the last
of the prototype's per-keystroke work out of the keystroke.

### Column widths and wide tables

Widths are computed, not left to the browser, and laid out fixed.

- Each column's width is found from the newest text of every row, those off screen included,
  measured with the fonts its cells use (a canvas: the header's font, bold, code, the body font),
  as a browser's automatic table layout does: each column between its longest word and its longest
  line, the table filling the text column when its lines fit, and narrower columns sharing what is
  left when they don't. Ghost columns count as columns in Redlines. Measurements are cached by cell
  text.
- A view plugin measures (in a `requestMeasure` read) and, after the update, dispatches the widths
  as an effect; the state field keeps them and writes them on the inner wrapper as CSS variables
  (`--w0`, `--w1`…), which each cell's width reads by its column. Until the first measurement, the
  table is laid out automatically. Wrappers are equal only with equal attributes (`BlockWrapper.eq`),
  so new widths make CodeMirror build the wrapper element again; that is acceptable because widths
  change rarely, and the builder may instead keep a stable `data-table` id on the wrapper and write
  the widths into a style rule for that id.
- **Call:** widths hold while the caret is in the table, and are found again when it leaves, after
  a row or column change, a paste, a change of text size, a resize, and when fonts load. Word and
  Docs keep a column's width while you type; a column that widens with each keystroke moves every
  other column, which an anti-goal forbids. While you type, a long word wraps in its cell.
- **Call:** a table never reaches past the text column. When its columns can't fit even at their
  longest words, it scrolls sideways in its own box, as Redlines and GitHub do today, and the caret's
  cell is kept in view. The comment rail lives in the right margin, and a table that reached into it
  would sit under the notes.

## The caret and the keys

One table keymap, at the highest precedence while the caret is in a table, takes the keys below.
The Mac's; Windows and Linux use Ctrl for ⌘ as elsewhere.

| Key | With the caret in a cell | Word · Google Docs · Pages |
| --- | --- | --- |
| ← → | By character; past a cell's edge, to the next cell's text; past a row's end, the next row's first cell | Same |
| ↑ ↓ | By visual line in the cell; from its first or last line to the cell above or below in the same column, at the same x, an empty cell included, skipping deleted rows. ↑ from the header and ↓ from the last row leave the table for the block above or below; when the table ends the document, ↓ opens E1's empty paragraph after it | Same; Word and Docs always keep a paragraph after a table |
| ⌥← ⌥→ | By word, across cells as → does | Same |
| ⌘← ⌘→, Home, End | To the start or end of the visual line in the cell | Same |
| ⌘↑ ⌘↓ | The start or end of the document | Same |
| Tab, ⇧Tab | The next or previous cell, its text selected (an empty cell's stop); Tab in the last cell adds a row and goes to its first cell; ⇧Tab in the first cell does nothing | Word and Pages select the next cell's contents; Docs moves to it; all three add a row after the last |
| ↩, ⇧↩ | A line break in the cell, written `<br>` | A new paragraph in the cell |
| ⌘↩ | Insert Row Below | — |
| ⌫ | The character before; at the start of a cell, and so in an empty cell, nothing: cells never merge, and the table keeps its shape | Same |
| ⌦ | The character after; at the end of a cell, and in an empty one, nothing | Same |
| ⌥⌫, ⌘⌫, ⌥⌦, ⌘⌦ | As in a paragraph, but never past the cell's start or end | Same |
| Typing | Into the cell; a typed `\|` is written `\|`, so it starts no cell | — |
| ⌘A | The cell's text; again, the whole table; again, the document | Pages: the cell, then the table; Word and Docs: the document |
| ⇧ with an arrow | Extends the text selection; once its end leaves the cell, cells are selected (below) | Docs: same |
| Esc | With cells selected: a caret in the cell where the selection ended | — |
| ⌥↑ ⌥↓ | Move Rows Up, Move Rows Down | Elsewhere in the editor they move lines (CodeMirror's default keymap, on in Redlines) |
| ⌥⌘↑ ⌥⌘↓ ⌥⌘← ⌥⌘→ | Insert Rows Above, Below; Insert Columns Left, Right | — |
| ⌥⌘⌫, ⌃⌘⌫ | Delete Rows, Delete Columns | Numbers: the same two |
| ⇧⌘K, ⌃L | Delete Rows, Select Row | CodeMirror's delete line and select line, made to mean the row |
| ⇧⌥↑ ⇧⌥↓, ⌘[ ⌘], ⌘/ | Nothing | CodeMirror's copy line, indent and comment would break the row |

**Call:** Tab selects the next cell's text, as Word and Pages do (and as Tab into a field does on the
Mac), so typing replaces it; an empty cell gets the caret.

**Call:** Return and Shift-Return write a line break in the cell, `<br>`, drawn as a line break and
deleted by one ⌫, in every dialect. Word, Docs and Pages all make a new paragraph in the cell,
design §5.2 already promises "Table cells with line breaks", and `<br>` is how GitHub's tables
write one. This overturns E1's interim refusal: E1 refused because pandoc's Word output drops raw
HTML, which the pandoc filter's planned step (format §11, "Turn raw `<br>` into a line break") and
Redlines' own Word export cover. E1's interim Return (to the cell below, like a spreadsheet) and
its refusal of Shift-Return in a cell go when this lands; the plan names the bindings and tests.
Return writing `<br>` ships before the Word exporter exists (see Export, below).

**Call:** ⌥↑ ⌥↓ move rows, because they already move lines everywhere else in the editor; ⌥⌘arrows
insert, because they are free in the app and in macOS text editing; Delete Rows and Delete Columns
take Numbers' shortcuts. Moving columns has no default shortcut (the menu and a drag do it). All are
menu items, so they can be rebound in System Settings.

**Call:** the Paragraph menu's block commands (Body, Heading 1–6, Quote, the lists, Code Block,
Table, Horizontal Rule, Indent, Outdent) are unavailable in a table: a cell holds inline text. The
Format menu works on a cell's text as anywhere.

Every key writes through the tracked layer as typing does; the table keymap only decides where the
caret goes and what text to type or delete, never markers.

## The pointer

| Gesture | Result |
| --- | --- |
| Press in a cell | The caret in that cell, at the nearest place in its text (an empty cell's stop; the end of the text for a press right of it), even where another cell's text is nearer the point |
| Drag | Text within the cell; once the pointer enters another cell, cells, from the first cell to the one under the pointer; back in the first cell, text again |
| ⇧-press | Extends the selection: into another cell, cells |
| Double-press, triple-press | A word of the cell; the cell's text |
| Press on a deleted row or column | Pins its card, as a press on any change does; the caret doesn't enter it |
| Drag a text selection inside a cell | Moves the text, as anywhere |
| Drag a selection of cells | Nothing: copy and paste move cells |
| Drop text on a cell | As typing: pipes escaped, line breaks as `<br>` |
| Hover | The grips and the + (below), and cards over changes, as anywhere |

**Call:** a press in a cell's box always lands in that cell, through a mouse selection style
(`EditorView.mouseSelectionStyle`) that finds the cell under the point first. Both engines' own
hit-testing found another cell's text for points in an empty cell.

## Selecting cells

There is one selection model: a caret, text inside one cell, or a rectangle of cells. Whole rows,
whole columns and the whole table are rectangles that reach the table's edges.

- **A rectangle is the ordinary selection whose two ends are in two different cells of one
  table.** Every cell in the rows and columns from the one to the other, both included, is
  selected. **Call:** no new
  state: everything that extends a selection (⇧-arrows, ⇧-press, a drag, Undo restoring a
  selection) makes and keeps rectangles for free, and the format sees only positions.
- While a rectangle is selected, ⇧ with an arrow grows or shrinks it by a cell, as in Docs.
- **Drawn:** each selected cell takes the system's selection color as its background, the color of
  selected text, never an author's; the text highlight and the caret are hidden.
- **Whole rows, columns and the table** also come from a grip's press, the Table menu's Select Row,
  Select Column and Select Table, and ⌘A twice.
- **Call:** a selection from outside a table into it covers the whole rows it reaches, as in Word
  and Docs, drawn as selected rows beside the selected text.
- **Call:** selections that reach into a table work from Stage 1, not Stage 4. A selection that
  covers whole tables deletes them as blocks, as block editing deletes covered blocks (format §3.4).
  A selection partly inside a table clears the text of the cells it covers (the whole rows it
  reaches) and deletes the text outside the table, never joining across it. Select All followed by
  Delete, Backspace, Return or typing always works, with a table in the document or not. Reason: an
  ordinary key refused is a failure, and today these work, because a table is source text. Until
  Stage 2 a selection whose two ends are in two cells of one table is held to its first cell (⇧-arrows
  and drags stop at its edge), so no key ever meets a rectangle before the rectangle is built.

What acts on a rectangle:

| Action | Result |
| --- | --- |
| ⌫, ⌦ | Clears every selected cell's text, as one change. Again, when the selection is whole rows or whole columns whose cells are now empty, deletes them |
| Typing | Clears the cells and types into the first, top left, as Word does |
| ⌘X, ⌘C, ⌘V | Below |
| ⌘B, ⌘I, the Format menu | Formats each cell's text, as one change |
| ⌘K | Unavailable |
| New Comment (⌥⌘M) | In one row, on the selected cells' text; across rows, on those whole rows |
| ↩ | Nothing |
| Tab | From the cell where the selection ended |

**Call:** the second ⌫ deletes whole rows or columns only once they are empty, as
research/tables.md decided: deleting a row with text in it is never one keystroke. Docs never
deletes rows from the keyboard, and Word's Backspace on a selected row deletes it at once.

## Rows and columns

### Commands

A **Table** menu after Paragraph, its items unavailable outside a table, the same commands in the
grips' menus:

| Item | Shortcut | Does |
| --- | --- | --- |
| Insert Row Above, Insert Row Below | ⌥⌘↑, ⌥⌘↓ (also ⌘↩, and Tab in the last cell) | As many rows as the selection covers ("Insert 2 Rows Above"), empty; the caret in the first new cell |
| Insert Column Left, Insert Column Right | ⌥⌘←, ⌥⌘→ | As many columns as the selection covers; the caret in the new column, in its row |
| Delete Row, Delete Column | ⌥⌘⌫, ⌃⌘⌫ | The rows or columns the selection touches ("Delete 3 Rows"); the caret in the next row's or column's cell |
| Delete Table | — | The whole table |
| Move Row Up, Move Row Down | ⌥↑, ⌥↓ | The selected rows, one place; they stay selected |
| Move Column Left, Move Column Right | — | The same for columns |
| Select Cell, Select Row, Select Column, Select Table | ⌃L for Select Row | |
| Align Left, Align Center, Align Right, Default Alignment | — | The selected columns, checked for the caret's column |

Insert Table stays in the Paragraph menu (⌥⌘T), with E1's caret in the first header cell, its text
selected. Each command is one step to undo, and Undo brings back the selection it was made with.

**Call:** titles count the selection ("Delete 2 Rows"), as Docs does. `EditorCommand` gains a title
that reads the state, the UI state reports changed titles, and the native menu updates its items, as
it does check marks.

**Call:** the right-click menu stays the system's (spelling, Look Up, Services), as design §5.1 asks
for text. The grips' menus hold what Docs' right-click menu does. A table section added to WebKit's
own menu, natively, is a later, optional stage (5).

### The header row

GFM has exactly one header row, the first; the delimiter row follows it. **Call:** the header is a
row like the others for every command: Insert Row Above it makes a new header (the old one becomes
the first body row, as format §3.7 says), a row moved to the top becomes the header, and deleting
the header makes the first body row the header. The delimiter row always follows the first row, in
every state of every decision. A table keeps at least one row and one column: deleting the last
is refused ("Delete the table instead.").

### Grips and +

- **A row's grip** (⋮⋮) appears in the left margin beside the row under the pointer, left of where
  change bars are drawn and never off the window; **a column's grip** (⋯) above the column, in the
  space above the table. Both show while the pointer is over the table or the strips beside it, and
  hide at the next keystroke.
- **A press on a grip** selects its row or column (⇧-press extends) and opens its menu: insert
  above and below (or left and right), delete, move, Clear Contents (what ⌫ does), and, for a
  column, alignment. Esc closes the menu and keeps the selection.
- **A drag on a grip** moves the row or column, and the others selected with it, to any boundary,
  the last included: the moving rows dim, a copy follows the pointer, a 2 px line in the theme's ink
  marks the drop, the page scrolls near its edges, and Esc cancels.
- **A +** appears within 8 px of a row boundary in the left strip, or a column boundary in the top
  strip, with a thin line across the table; a press inserts one row or column there.
- The grips and the + are drawn by a view plugin in a layer over the editor, and hidden from
  assistive technology: the menu carries every command they offer.

**Call:** a press on a grip both selects and opens the menu, as research/tables.md decided: it makes
the commands discoverable without a right-click menu, and Esc leaves the selection.

## Copy and paste

**Out.** Copying or cutting a rectangle puts on the clipboard:

- tab-separated text: cells parted by tabs, rows by line breaks, a cell that holds a tab, a line
  break (from `<br>`) or a quote in quotes with its quotes doubled, as spreadsheets write it;
- an HTML table of the cells' newest text with its inline formatting, by the existing copy renderer,
  the header row as `th` when it is the table's.

Never markers (design §5.10). Copying text inside one cell is as today.

**In,** with the caret in a cell or cells selected:

| The clipboard | Pasted |
| --- | --- |
| A range: an HTML `<table>` (Sheets, Excel, Numbers, Word, Docs, the web), or text with tabs | Over the cells from the caret's rightward and down, as Sheets and Excel do; onto a selection, from its top-left cell. Rows and columns are added when it needs more |
| One value, onto a selection of cells | Into every selected cell |
| Text without tabs | Into the cell: its line breaks as `<br>`, its pipes escaped (as `place.ts` does today) |
| Anything, with Paste as Plain Text (⇧⌘V) | Into the cell, tabs as spaces |
| A range, outside a table | A new table, as today's paste of an HTML table |

**Call:** text with line breaks and no tabs goes into one cell, as in Word and Docs, not down a
column as in a spreadsheet: a document's pasted text is prose.

With Track Changes on, each overwritten cell is a substitution (an insertion in an empty one), each
added row or column a row or column insertion, and the whole paste one change (one `group`), one
step to undo. A paste that needs rows or columns that rule 2 (below) doesn't allow at that moment is
refused whole, with its reason. A text selection inside the cell is no target of its own: a range
pastes from that cell; to paste the clipboard as text there, use Paste as Plain Text.

## Export

- **Call:** Return writing `<br>` in a cell ships before the Word exporter exists. GitHub renders
  `<br>` in a cell, and the exporter (`docs/word-export`, design only today) handles `<br>` when it
  is built, as a line break in the cell's paragraph; format §11's pandoc filter step ("Turn raw
  `<br>` into a line break") stays on the backlog until then. Nothing gates the key on it.
- Copy for Word is the clipboard's HTML table (above); printing draws the table as the screen
  does.

## Track Changes

### What each operation writes

The forms are format §3.7's; this design adds no mark kind.

| Operation | Written |
| --- | --- |
| Typing, deleting, replacing in a cell | Inline marks in the cell, as anywhere (today) |
| Clearing cells | A deletion in each cell, the marks in one `group` |
| Inserting a row | The row, with `<!--ins ID row-->` and a space at the start of its first cell |
| Inserting a column | Its cells in every row; `<!--ins ID col-->` and a space at the start of its header cell |
| Deleting a row | The row leaves the table, and is kept as `<!--del ID row=N …-->` below it, after one blank line |
| Deleting a column | Its cells leave every row, kept as `<!--del ID col=N …-->` below, its cells top to bottom, delimiter cell included |
| Moving a row or column | A deletion at the old place and an insertion at the new one, linked by `move` in the ledger |
| Aligning a column | A block format change around the table, `align=SPEC`, `SPEC` the old delimiter row |
| Pasting a range | Substitutions and insertions in cells, row and column insertions, one `group` |
| Deleting the table | A whole-block deletion (format §3.4) of the table and its deletion lines |

Pears deleted and Plums added, two pending changes on one axis, which rule 2 allows:

```markdown
| Fruit  | Count |
| ------ | ----- |
| Apples | 3     |
| <!--ins k3x9 row--> Plums | 7     |

<!--del g5nb row=2 \| Pears  \| 5     \|-->
```

Text typed in your own new row or column is part of its insertion and writes no marks (format §3.7
says so of rows; this design says it of a column's cells too, which rejecting it removes). New rows
and cells follow the table's style: padded to line up where every row of the table is, `| a | b |`
otherwise; nothing else is re-padded. Below a table, the deletion lines come first, in their order,
then the closers of marks that end with the table, then a deleted last block or a split (§3.7).

The deletion half of a move keeps the row's text as it reads with every pending change in it
rejected. It is what the ghost at the old place draws, and nothing restores it: rejecting the move
moves the row itself back (below), and only when a text merge has taken the moved row away is the
payload written back instead.

### How it shows

In Redlines (Clean shows the newest table, plain; Raw, the source):

| Change | Drawn | Card |
| --- | --- | --- |
| Inserted row or column | Its cells in the author's tint, its text underlined in the author's color, change bars on its rows | "Inserted row", "Inserted 2 columns" |
| Deleted row | A ghost row at its place: struck text in the author's color on the author's tint; not editable | "Deleted row" |
| Deleted column | A ghost cell in every row at its place | "Deleted column" |
| Moved row or column | A double underline and the tint at the new place, a ghost with a double strikethrough at the old | "Moved row" |
| Alignment | The new alignment, a dotted underline under the column's header text (as format changes are drawn), a bar on the header row | "Formatted: column Count centered (was left)" |
| Cleared cells | Each cell's text struck through | "Deleted 6 cells" |
| A line break in a cell | Inserted: a line break, with its ¶ when line break marks are shown (design §5.5). Deleted: a struck ¶, never the letters of `<br>` | "Inserted line break", "Deleted line break" |
| Deleted table | A ghost table; past eight rows, the rest folded into one line, "and 12 more rows" | "Deleted table (3 columns, 20 rows)" |

Ghost rows and columns take column widths like real ones, and the caret skips them. The marks of one
operation (rows inserted together, a cleared block, a paste) share a `group`, so they are one change
on the review bar and in the cards, decided in one step (design §5.6).

### Deciding

| Mark | Accept | Reject |
| --- | --- | --- |
| Inserted row or column | The marker goes | The row or column goes, with everything in it, other people's pending changes included |
| Deleted row or column | Its deletion line goes | It comes back at its place, as written |
| Move | Both halves, decided together: the markers go | The row or column goes back to its old place, with what was typed in it since, and its comments |
| Alignment | The marker goes | The old delimiter row is written back |

Every decision rewrites the positions of the table's other deletions, as every table operation does
(§3.7: "The serializer rewrites positions whenever the table changes").

**Call:** rejecting a move moves the row back as it is now, rather than writing the payload back:
changes made in the moved row since travel with it, both ways, so the move can be decided in any
order with them.

### Rules that keep every order alike

Each refusal says what to decide first, and names the change ("Bo Chen's deleted column").

1. **A cell is one line.** Text in a row never holds an unescaped `|` or a line break: the editor
   writes `\|` and `<br>`, and the format refuses them from anyone else, an agent included ("In a
   table, write a pipe as \| and a line break as <br>.").
2. **Rows and columns don't change together.** A deleted row keeps its cells as written, and a
   deleted column its cells top to bottom, so a change on the other axis while it is pending leaves
   it the wrong number of cells. The model: every pair of operations by two people, at every place
   in a 3×3 table, decided in every order. Same-axis pairs read alike in every order; across the
   axes only two insertions do; every other pair left rows with the wrong number of cells in every
   layout tried.

   | Pending in the table | Allowed with Track Changes on | Allowed with it off |
   | --- | --- | --- |
   | Rows inserted | Any row change; inserting columns | Anything |
   | Rows deleted or moved | Any row change | Any row change |
   | Columns inserted | Any column change; inserting rows | Anything |
   | Columns deleted or moved | Any column change | Any column change |
   | An alignment change | Any row change | Any row change |

   Refused: "Accept or reject the column changes in this table first." (or row, or alignment).
3. **Another person's pending changes stay theirs.** With Track Changes on, a row or column with
   another person's pending change in it can't be deleted until that change is decided; it can be
   moved, and its changes travel with it. A row or column that is itself another person's pending
   insertion or move can't be deleted or moved. Your own pending changes in a row you delete fold
   into the deletion, which keeps the row as it was before them, as deleting your own insertion
   removes it; your own pending row is removed outright (§3.7), and moved plainly, as it is in no
   original.
4. **Comments in a deleted row or column** become point comments where it was: at the start of the
   row below (the end of the row above, for the last row), or of the cell after. Comments in a moved
   row move with it, both ways.
5. **Alignment and column changes don't mix**, because `align=` keeps the whole old delimiter row:
   an alignment change is refused while a column is pending insertion, deletion or move in the
   table, and a column change while an alignment change is pending. Another person's pending
   alignment change refuses yours; your own is changed in place.
6. **Deleting the table** is refused while it holds another person's pending change; yours fold
   into it, and its comments become point comments where it was.
7. **A row without a leading pipe gets one, plain,** when a marker must stand at its start (§3.2:
   rows that hold markers start with `|`). Both versions get it, and nothing renders differently, as
   Enter at a block's end writes plain line breaks (§3.4). Today that keystroke is refused.
8. **One form per state.** A row typed, pasted or written by an agent into a table is written in the
   row form; a cell added to or taken from every row is a column change; any other change to a
   table's structure is a substitution of the whole table (§3.7).

**Call:** rule 3 replaces format §3.7's "Pending marks inside a deleted row, column or table stay
live inside the payload, escaped" and its "Deleting a pending row" paragraph. No code implements
marks inside payloads, every decision, view and count would have to, and the case (deleting a row
someone else is still changing) is rare and has a one-click way out. Word's model was the reason for
the old rule; it can come back if people ask for it.

**Call:** rule 2 refuses rather than repairs. Payloads could be rewritten to follow the other axis,
but that is a mark changing another mark's payload, which the format has never done.

### Track Changes off

Every operation is an edit of the table itself (format §3.10): rows and columns inserted, deleted
and moved as text, nothing recorded, and what was pending in deleted cells goes with them.

**Call:** with Track Changes off, typing in anyone's pending row or column joins it: it goes if the
row or column is rejected. That is Word's model, and it reads the same in every order. §3.10's "typed
text is never part of a pending change" can't hold here, as the original has no cell to put the text
in.

## Views

- **Clean:** the newest table: no ghosts, no tints; edited as in Redlines. A tracked edit in Clean
  switches to the markup view (Redlines or Simple), as today.
- **Redlines:** as above.
- **Simple** (review views, `2026-11-10-review-views-design.md`) applies to tables as it does
  everywhere: deleted rows, deleted columns and deleted cell text are hidden; inserted rows, columns
  and text are plain, with no tint and no underline; comments are shown as in Redlines. The change
  bars are Redlines' bars on the same rows. **Call:** no ghosts and no tints in Simple, bars only,
  because Simple is Redlines with every change's look off, and a ghost is a look.
- **Raw:** the source as written, the table layout off; editable with Track Changes off, read-only
  with it on, as today.
- **The previews** (the original, one person's changes) draw tables the same way, read-only.

The format's views (§8) learn the table marks: the newest view drops deletion lines and their blank
line; the original removes inserted rows and columns, restores deleted ones, moves rows back and
writes the old delimiter row; the review view, which agents read, writes them in CriticMarkup:

```text
| Fruit | Count |
| --- | --- |
| {++Plums++} | {++7++} |{>>[k3x9 ada] Inserted row<<}
| {--Pears--} | {--5--} |{>>[g5nb bo] Deleted row<<}
```

A column's cells are wrapped the same way, with its note after the header row; a move's notes say
where from and to; an alignment change's note follows the table.

## Agents

Agents edit the newest text with `str_replace`. **Call:** when its old and new text hold the same
table, the format compares them as tables: rows matched by their text, so an added row is a row
insertion, a removed one a deletion and a reordered one a move; a cell added to or removed from
every row, a column insertion or deletion; changed cells, word-by-word marks in those cells. A
replacement whose row and column changes rule 2 doesn't allow together is refused, and the error
tells the agent to make the row changes now and leave the column changes until the person has
decided them (agents never accept or reject). The prompt (`packages/agent-tools/src/prompt.ts`)
gains a line on pipes and `<br>` in cells. Today an agent's added row becomes a generic insertion
with a split, or is refused.

## Accessibility

- The wrapper is `role="table"` with `aria-rowcount` and `aria-colcount`; rows `role="row"` with
  `aria-rowindex`; cells `role="columnheader"` or `"cell"` with `aria-colindex`; a ghost row or cell
  is labelled "Deleted row" or "Deleted column".
- Every command is in the menu bar with its shortcut; the grips and the + are hidden from assistive
  technology.
- Selected cells take the system's selection color; tints are the theme's author tints, which keep
  their contrast.
- VoiceOver inside a `contenteditable` in `WKWebView` is checked in Stage 1. Whatever it does with
  the roles, typing, the arrows and the menu work, and announce text as in any line.

## Edge cases

| Case | Behavior |
| --- | --- |
| A row with fewer cells than the header | Drawn with empty cells after it, as GFM reads it. **Call:** typing into a missing cell writes its pipes first, plain, as rule 7 does |
| A row with more cells than the header | The extra cells, which GFM doesn't show, are hidden and kept |
| A pipe in a code span | Starts a cell, as GFM and GitHub read it; `\|` inside the span doesn't |
| `\|` | Drawn as a pipe |
| A table that ends the document | ↓ from its last row opens E1's empty paragraph after it |
| A table at the very start | ↑ from the header stays put, as at the start of any document |
| Text typed on the line right under a table | Never: blank lines are structure (E1), and the caret can't stand there |
| A selection that reaches into a table | Covers whole rows (above). Delete, Backspace, Return and typing work from Stage 1: whole tables go as blocks, cells of a partly covered table are cleared, the text outside is deleted |
| A comment across cells of one row | Its tint is drawn in each cell |
| Images, links, math, footnote references in cells | As inline elsewhere |
| Input methods in an empty cell | The filler stays until the composition ends, so the composed text isn't redrawn under the input method |
| A file changed on disk | Widths found again; the selection mapped, as today |
| Very long tables | Widths from every row; the table layer's work per keystroke is the row's |

## What changes in design.md and format.md

**design.md**

- §5.8 Tables, rewritten, roughly: "A table is edited as a table: cells you click into and type in,
  with no pipes, in Clean and Redlines (Raw shows the source). The caret moves between cells with
  the arrows and Tab, which selects the next cell's text and adds a row after the last; Return writes
  a line break in the cell. A selection that reaches from one cell into another selects cells: a
  rectangle, whole rows, whole columns or the table. Delete clears selected cells, and again removes
  emptied whole rows or columns. Rows and columns are inserted, deleted, moved and aligned from the
  Table menu, which counts the selection, from hover grips, whose menus hold the same commands, and
  from a + on each boundary; a grip's drag moves its row or column to any place. Ranges copy as
  tab-separated text and an HTML table, and paste over cells, growing the table. With Track Changes
  on…" and the tracked-changes bullets as above, with the rules a person meets (a table's rows and
  columns don't change at once; a row someone is still changing can't be deleted).
- §5.9: the table shortcuts.
- §5.10: pasting ranges into tables.
- §5.2: "Table cells with line breaks" (lists in cells are not covered).
- §6.4: the core draws and edits tables (layout, caret, rectangles, drawing tracked table changes);
  the `tables` plugin adds the grips, the +, dragging and the Table menu's commands.

**format.md**

- §3.7: rules 1 to 8 above; the order of lines below a table; new rows and columns in the table's
  style; the header row and the delimiter row; rejecting a move moves the row back; positions kept by
  every operation and decision. Rule 3 replaces the paragraphs on marks inside payloads and on
  deleting a pending row.
- §3.9: rows and columns have one form.
- §3.10: typing in a pending row or column joins it; structural edits with Track Changes off; rule
  2's second column.
- §8: the table marks in the three views, and the review view's form.
- §12: the oracle reads GFM tables (#146).
- §13, item 4: pairs of row and column changes modelled; sequences covered by the random suite.

## Modules

| Where | What changes |
| --- | --- |
| `packages/format/src/table.ts` (new) | Reading a table: rows, cells, pipes and escapes, the marks by row and column, deletions and their positions. The operations, tracked and untracked: insert, delete and move rows and columns, align, clear cells, paste a range, delete the table. Rules 1–8 |
| `packages/format/src/track.ts`, `untracked.ts` | Typing in cells: rules 1, 7, 8, your own pending row or column (no marks), typing in a pending row with Track Changes off |
| `packages/format/src/decide.ts`, `views.ts` | Deciding table marks (`isDecidable` lets them through); the three views; positions |
| `packages/format/src/agent.ts` | `str_replace` over a table: the table comparison |
| `packages/format/src/test-helpers.ts` | #146: `micromark-extension-gfm-table` (at a version for micromark 4.0.2) in `blockLeaves` and `reading`, so the oracle reads cells |
| `packages/editor/src/table/` (new) | `model.ts` (the tables of a state, kept incrementally), `layout.ts` (wrappers, rows, cells, hidden pieces, atoms), `widths.ts`, `keys.ts`, `mouse.ts`, `cells.ts` (rectangles and what acts on them), `clipboard.ts` (ranges in and out), `draw.ts` (tints, ghosts, moves, the change bar from the first cell) |
| `packages/editor/src/preview/table.ts`, `decorations.ts` | The table widget and the `enterTable` keys go. Review views' drawing of a rewritten cell (old struck above new, inside the cell) and of a struck table block is ported to the cell-as-text layout, with its tests (Stage 1) |
| `packages/editor/src/tracked/field.ts`, `clipboard.ts` | Table marks become drawn changes; rectangles in copy, cut and paste |
| `packages/editor/src/api.ts`, `commands.ts` | `EditorCommand`: the `table` menu and a title that reads the state |
| `plugins/tables` (new) | The grips and the +, dragging, the grips' menus, the Table menu's commands and shortcuts |
| `plugins/review` | The rail's table lookup (`cellAt` in `rail.ts`, which reads the widget's `data-end`) goes: cells have coordinates now. Cards and the review bar for table marks |
| `plugins/formatting` | Block commands unavailable in a table; Insert Table selects the first header cell's text |
| `apps/desktop` | The Table menu (`menu-model.ts`), menu titles that change (`native-menu.ts`), the WebKit check script |
| `packages/agent-tools` | The prompt's line on tables |

**Call:** the core (`@redlines/editor`) owns the layout, the caret, rectangles and the drawing of
tracked table changes; the `tables` plugin owns the grips, dragging and the commands. By design
§6.1's test: without the core's part a Delete across cells would remove pipes and a deleted row would
be invisible; without the plugin's, nothing is damaged or hidden.

## Tests

**The format** (Vitest, Node):

1. #146 first: the oracle reads tables; the random suites run again at `REDLINES_FUZZ=6000`, since
   they couldn't see cells before.
2. `table.test.ts`: reading tables (escapes, pipes in code spans, leading and trailing pipes, ragged
   rows, rows without a leading pipe).
3. Every edit in a cell (insert, delete, replace, next to hidden markers; the first, middle and last
   cell, an empty one, the header, a pipe-less row), tracked and untracked, through
   `expectEveryDecision`: it reads the same in every decision order and gives back the original's
   bytes once rejected, with the oracle reading the cells.
4. Each operation, tracked and untracked: byte-exact fixtures of its form (§3.7's examples become
   fixtures), accept and reject, the positions after each, the three views.
5. The pair model as a test: every pair of operations, of every kind, at every place, the second
   tracked or plain: the allowed pairs pass `expectEveryOrderAlike`; the others are refused with
   their message.
6. A random suite: random tables, random sequences of cell edits, row and column operations,
   alignment and decisions by three people, Track Changes on and off; every state one GFM table to
   the oracle, every order alike, all accepted the newest view, all rejected the original's bytes.
   Run at `REDLINES_FUZZ=6000` before each stage merges.
7. Each refusal's message; agents' `str_replace` fixtures (a row added, removed, reordered; a column
   added; cells changed; rows and columns at once refused).

**The editor** (Vitest, happy-dom):

8. The layout's decorations for fixture tables: wrapper ranges, rows, cells (outer, inclusive), the
   hidden pieces, the atoms, ghosts.
9. The incremental state equals a full rebuild after random edits (as the prototype checked).
10. Keystroke scripts, in E1's style (a document with ‸, the keys, Track Changes on and off, the
    expected source and caret): every row of the tables of keys and of what acts on a rectangle that
    needs no layout (↑ ↓, presses and widths need one, and go to the WebKit check).
10a. Selections that reach into a table, in E1's script style: Select All then Delete, Backspace,
    Return and a typed letter, in documents with one table, two, a table first, a table last and a
    table alone; a selection over a whole table; one from a paragraph into a cell; one from a cell
    into the paragraph below; one from a table into the next; tracked and not, each reading the same
    in every decision order.
11. The clipboard: tab-separated text out, quoting included; HTML out; pasting captures from Sheets,
    Excel, Numbers, Word and Docs (HTML and text) into a cell and onto a selection, growing the table,
    tracked.
12. `long-document.test.ts` gains a 300-row table with 40 marks in its cells: a keystroke in a cell
    and a caret move in the table stay within the budget, and the table layer's share of an update is
    measured beside it.
12a. Simple: a table with an inserted row, a cleared cell, a deleted row and a deleted column draws
    no ghost, no tint, no underline and no struck text, the same bars as Redlines on the same
    rows, and comments in cells; its visible text equals Clean's.

**WebKit**, on a Mac, before each stage merges:

13. `apps/desktop/scripts/check-tables`, as the prototype's harness was built: a small Swift program
    that opens a `WKWebView` in a borderless window of its own process, placed off screen, loads the
    frontend served by `pnpm dev` with a fixture document, runs a file of checks with
    `callAsyncJavaScript`, prints their JSON and exits. The checks: columns line up (0 px), no stray
    cells, ghost rows and columns in place, presses (synthetic `mousedown` and `mouseup` at a point)
    into every kind of cell, ↑ ↓ into empty cells, WebKit's own typing (`execCommand('insertText')`)
    in a cell, an empty cell and after `<br>`, rectangles drawn, and a keystroke's cost (WebKit's
    timer has a 1 ms grain, so medians of 60). It drives nothing but its own window. **Call:** a
    script, not CI: CI runs Linux and Node; a WebKit runner in CI can come later.

**By hand,** at the end of Stages 1 and 3, in the signed app: the caret drawn in an empty cell;
Japanese, Chinese and Korean input methods and dictation in a cell and an empty cell; spell check in
cells; VoiceOver reading a table; trackpad drags of cells and grips; a wide table scrolling with the
caret; light and dark themes.

## Stages

Each ships alone and is worth having alone. Each updates `docs/design.md` and `docs/format.md` in
the same PR, and passes the WebKit script.

| Stage | What | Why alone |
| --- | --- | --- |
| **1. Tables you type in** (#176) | #146; format rules 1 and 7; the layout, the caret's stops, widths held while typing, wide tables; every key of the caret's table but the row and column commands, with ⌘A going from the cell's text to the document; presses; `<br>`; typed pipes; a selection whose ends are in two cells is held to the first cell until Stage 2; selections that reach into a table, deleted, cleared and typed over, and whole tables deleted as blocks; review views' drawing of a rewritten cell and a struck table block ported to the layout; Tab in the last cell and ⌘↩ add a row, plain or as the row insertion of §3.7 (written, drawn, decided, in the views: the first table mark built), with a Table menu holding Insert Row Below; the widget and its keys removed; the rail's lookup removed; roles; tests 1–3, 8–10, 12, 12a (for what Stage 1 draws), 13 | The complaint in #175 is gone: no pipes, and tables edit as in a word processor |
| **2. Selecting and copying cells** (#177, #179) | Rectangles: presses, drags, ⇧-arrows, drawing; clearing, typing over, formatting, comments; ⌘A's table step; Select commands; copy and cut out; paste over cells, adding rows (Stage 1's insertion); copy of a selection that reaches into a table | Highlighting rows, columns and the table, and copying ranges both ways |
| **3a. Rows** (#178, #180) | Insert, delete and move rows, tracked and plain; ghost rows; the header row; rules 2 (rows), 3 and 4; the Table menu's row commands with counted titles; row grips, the + between rows, dragging; the review view and agents for rows | The everyday structural edits, tracked as Word does |
| **3b. Columns** (#178, #180) | Insert, delete and move columns; ghost columns; alignment and rule 5; the rest of rule 2; column grips and the + between columns; pasting that adds columns; the review view and agents for columns | Completes #178 and #180 |
| **4. Whole tables and edges** | Delete Table and its ghost, with rule 6; the second ⌫ on emptied rows, columns and tables; missing cells written on demand | The remaining structural edits |
| **5. The right-click menu** (optional) | A Table section added to WebKit's own context menu natively (`NSView`'s `willOpenMenu:withEvent:` on the web view), keeping spelling and Look Up | For people who reach for a right-click as in Docs |

**Call:** tracked row insertion is in Stage 1, not 3a: Tab in the last cell is part of typing in a
table, and refusing it with Track Changes on would refuse an ordinary key. It is the smallest table
mark to build: a marker in place, removed on accept, its line removed on reject.

## The calls most worth Stephan's look

1. **A table stays text,** laid out as a table by CodeMirror's own wrappers and marks, not a widget
   with editors inside: every text feature works in cells for free; the price is a set of layout
   rules the prototype found, and about 1 ms more per keystroke.
2. **Return in a cell writes a line break (`<br>`),** as Word, Docs and Pages make a new paragraph
   in the cell, overturning E1's "no line break in a cell" (raised for pandoc's Word output, which
   the filter will cover).
3. **A table's rows and columns can't have pending changes at once,** except insertions of both:
   the model shows the format's own payloads go wrong otherwise, and the refusal says what to decide
   first.
4. **A row or column that someone else is still changing can't be deleted with Track Changes on,**
   replacing format §3.7's live marks inside payloads, which nothing implements.
5. **Column widths are computed from every row and held while you type,** settling when the caret
   leaves the table; a table never reaches past the text column, and scrolls sideways instead.

Close behind: Tab selects the next cell's text (Word, Pages; Docs only moves); the right-click menu
stays the system's, with the grips' menus instead; the second ⌫ is what deletes emptied rows.

## Not decided here

- Whether VoiceOver reads ARIA table roles inside a `contenteditable` in `WKWebView`: Stage 1 finds
  out; the keyboard path doesn't depend on it.
- How the drag of a grip looks in detail (the copy that follows the pointer, the dimming), within the
  design language: the builder's, checked by eye.
