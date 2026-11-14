# Block editing that feels like a word processor

*Design, Nov 10, 2026, for epic [#168](https://github.com/skadauke/redlines/issues/168) and its
sub-issues #169–#174, #198 and #204, with the Enter and Backspace issues linked there as its test cases.
It builds on [design.md](../../design.md) and [format.md](../../format.md), and says where it
departs from them. The file forms marked ✓ below were probed against the format library at
`ad51806`, and a prototype of hidden blank lines ran in a browser, in a copy of the editor. Neither
is in the repository.*

## Why

Stephan, on the epic: "I think this issue deserves some deep thinking and making sure whatever
changes don't break expected behavior." And, on what the design must cover: "I actually think you
need to think deeply through all the different scenarios where someone hits enter (or backspaces to
delete that same "enter" action) and what should happen, in all possible scenarios: 1. Within a
header line 2. Within a list (important, after an empty entry or a filled entry) 3. Within a block
quote 4. etc. This also relates to the mandatory-empty-line issue. The UX of editing the markdown
should be exactly like editing a Word or Google Doc document but needs to respect the underlying
Markdown syntax."

Today the editor edits the Markdown source line by line, and the keys are CodeMirror's: Return is
`insertNewlineContinueMarkup` (one line break, or a new bullet in a list), Backspace is
`deleteMarkupBackward` and then a plain character deletion, Tab is unbound and Shift-Return is a
plain line break. So, in the build 10 test drive (`findings-structure.md`):

- The blank lines that Markdown needs between blocks are lines you can click into, type on and
  delete. Return writes one line break, so what you type next continues the paragraph above, and
  leaves two gaps where there was one; it takes Return twice to start a paragraph.
- The same Backspace on gaps that look alike removes a line, joins two blocks, or joins them and
  deletes the next item's bullet.
- Typing on the blank line between two paragraphs joins them both into one.
- ⌘2 is refused on a block with no blank line above it (Markdown allows a paragraph right under a
  heading), and on a paragraph you just typed (#173).
- The list, quote and heading commands do nothing on an empty line (#170); Tab does nothing; no
  numbered item but the first can be indented (#171); a lightly edited list refuses ⌘] (#172).

The format already reads blank lines as structure (format §3.4: there are no empty blocks; Enter
at a block's end writes plain line breaks; text after two Enters is a block of its own). The
editor research planned the answer and it was never built: "hidden blank lines given the
paragraph gap" and "a block-editing layer, with keystroke scripts as its conformance suite"
(research/editor.md, risks 3 and 4).

## In one paragraph

A document is blocks: paragraphs, headings, list items, quotes, code, tables. The blank lines
between them are structure, not text: Clean and Redlines never show them and the caret never rests
on one; the space between blocks is drawn, by the kinds of block, whatever the file has between
them. Return makes a new block, Shift-Return a line break inside one, Backspace at the start of a
block joins it to the one above (a list item first loses its bullet, as in Word, and a first item or a
quote's first paragraph is first taken out of its list or quote), Delete at the end
joins the next one, and Tab and Shift-Tab indent and outdent list items. Markdown can't hold an
empty paragraph, so the empty paragraph Return opens exists only while you are in it: type and it
is a paragraph, leave it and it goes, and the file never gets it. Backspace right after a Return
takes that Return back exactly. With Track Changes on, each key writes what the format writes for
that edit today, plain where nothing a reader sees changes; a few format rules are added so that
no ordinary key is refused.

## Goals

1. Return, Shift-Return, Backspace, Delete, Tab and Shift-Tab do what they do in Word, Google Docs
   and Pages, in every kind of block, wherever Markdown can hold the result; where it can't, the
   key does the nearest thing Markdown can hold, and this document says what and why.
2. The person never sees, clicks into or types on a blank line between blocks.
3. Backspace right after Return gives back the file byte for byte, with Track Changes on or off,
   and leaves no change. Every key is one step to undo.
4. With Track Changes on, every key writes a sound tracked form, or plain line breaks where the
   rendered document doesn't change. No ordinary key is refused.
5. What Clean and Redlines draw is what Markdown renders: one gap between blocks however many blank
   lines the file has, list numbers as Markdown counts them, a hard break as a line break.
6. Lists work as in a word processor: Tab and Shift-Tab, numbered sublists, Return on an empty item
   to leave the list, checkboxes that look like the rest of the page.

## Non-goals

- Tables edited as tables: that is epic #175. This design gives tables only the keys that keep a
  table valid while it is edited as source.
- Empty paragraphs used as spacing. Markdown keeps no extra space, and Redlines doesn't pretend it
  does.
- Line breaks in headings and table cells. `<br>` renders in both on GitHub and a setext heading can
  hold a hard break, but `<br>` is HTML, which pandoc's Word export drops, and setext headings exist
  only for levels 1 and 2. Refusing is right.
- Moving blocks with the keyboard (design §5.12, a Should).
- Drawing a paragraph's soft line breaks as spaces. Return never writes one any more; files from
  elsewhere keep them drawn as line breaks, as today (Stage 7).
- Copy, cut and paste across blocks (#196).
- Raw: it stays a source editor with CodeMirror's keys.
- Rewriting what the person didn't touch: no renumbering of later list items, no re-indenting, no
  normalizing of blank lines elsewhere in the file.

## Anti-goals

These would make it a failure even if everything technically works:

- **A refused Return, Backspace or Tab** in an ordinary document under review.
- **Return and then Backspace that don't give the file back**, or that leave a pending change.
- **Keys alone leaving stray blank lines in a file**, or turning a tight list loose.
- **A change mark for something no reader can see**, such as a pending change to a blank line.
- **The caret on an invisible line**, or text landing in a block other than the one it looks to be
  typed in (a lazy line, a setext underline, a numbered item read as text).
- **Decoration changes on the line an input method is composing.**
- **New chrome:** no block handles, placeholders, "type here" hints or toolbars.
- **Tab that traps the keyboard,** with no way to move focus out of the document.

## Constraints

- **The format's rulings.** Every allowed edit reads the same in every order of deciding the
  changes, judged exactly; micromark 4.0.2 is the oracle; the format refuses rather than repairs,
  but ordinary typing refused is a failure; `docs/format.md` is the source of truth for the format,
  and changes to it are made there deliberately. The editor's keys produce plain text edits, and the
  format library (`trackedEdit`, `untrackedEdit`, `trackedFormat`) decides how they are recorded, as
  typing is today.
- **A keystroke costs what it does on main.** Return and Backspace make one call into the format
  library, as typing does; finding the block at the caret is a walk up the syntax tree.
- **The platform.** Tauri v2, the system's WebKit on macOS (WKWebView), CodeMirror 6 (view 6.43,
  commands 6.11, lang-markdown 6.5). Text editing stays native: spell checking, text replacements,
  smart quotes, dictation and input methods work as in other Mac apps. The document isn't
  autocorrected (#160).
- **Accessibility.** VoiceOver reads the blocks in order with no "blank" between them. Every key
  and command works from the keyboard, and the keyboard can always leave the document.
- **Design.md's rules.** Color means a person; no number badges; syntax shows only around the
  caret; Clean shows the newest text, Redlines the changes, Raw the source.

## What main changed since this was written

The design was written at `ad51806`; `origin/main` was merged into this branch on Nov 10. What it
changes:

- **#161, line-break marks hidden by default.** A split or a join is drawn by its change bar and its
  card; the ¶ shows only with Preferences › Editor › Show line break marks, and then stands right
  after the break (a second break's beside the first, a list item's at the break). **Call:** the
  hidden-line pass keeps the change bar on the line where a break is drawn, with the preference
  either way, and the suite runs the #198 cases both ways, so a hidden mark never hides a card.
- **#201 (#163), interface text sizes.** Interface text is at least 13 px (12 for a caption or hint)
  and takes `var(--rl-size-ui)` or `var(--rl-size-ui-small)` (or the `-scaled` pair), never a size in
  em or %; `apps/desktop/src/interface-text.node.test.ts` reads every style source. **Call:** every
  piece of interface text this design adds (a refusal's notice, "Write the item first.", a
  checkbox's focus ring label if drawn) takes those tokens and passes that test; the spacing tokens
  and the box's 0.8 em square are document text, not interface text.
- **#160, spelling on, autocorrect off.** Already assumed (Constraints).
- **#205 (open; fixes #153): no edit writes markers into an indented code block.** If it merges
  first, Return and Tab in indented code with Track Changes on are refused with its words, as in
  fenced code, and Stage 6's whole-block substitution (format §3.5) covers both kinds. The plan's
  Stage 6 reads `docs/format.md` as it stands when that stage starts.
- **#167 (open)** fixes the block commands on empty lines (blank lines around inserted blocks, the
  typed `>` that disappears, Horizontal Rule under a paragraph, fences around an item's marker).
  **Call:** Stage 1 needs only its caret rule (a line the caret is on is never hidden as "only
  markers", which the typed `>` shows); Stage 4's Paragraph menu on an empty paragraph starts only
  once #167 has merged.
- **#198 and #204**, filed under #168, are cases in the matrix (the task box, the card of a break on
  a hidden line, three list keys) and scripts in the suite.

## What Word, Google Docs and Pages do

Checked where it could be, from Microsoft's and Apple's documentation and reports; the sources are
at the end. Where the three differ, the design says which it follows.

| Situation | Word | Google Docs | Pages |
| --- | --- | --- | --- |
| Return at the end of a paragraph | A new empty paragraph, same style | Same | Same |
| Return at the end of a heading | The next paragraph is Normal (the style's "Style for following paragraph") | Normal text | The style's following style, Body |
| Return in the middle of a paragraph or heading | Two paragraphs, both with its style | Same | Same |
| Return at the start of a paragraph | An empty paragraph above; the caret stays with the text | Same | Same |
| Return on an empty paragraph | Another empty paragraph | Same | Same |
| Shift-Return | A line break inside the paragraph, also in a heading | Same | Same |
| Backspace at the start of a paragraph | Joins it to the one above; the paragraph above keeps its formatting (Word 2013 and later; older Word kept the second's) | Joins; the one above keeps its style | Joins |
| Delete at the end of a paragraph | Joins the next one; this one's formatting wins | Same | Same |
| Return at the end of a list item | A new item | Same | Same |
| Return on an empty item | Below the top level, changes its level (up); at the top level it ends the list | Ends the list; on a nested item, not confirmed | "Press Return twice ... to end the list" |
| Backspace at the start of an item's text | Removes the bullet and keeps the indent; again, outdents | Outdents or takes the item out of the list | Delete at the start of an empty item ends the list |
| Tab in a list item | At the start: demotes. In mid-text: a tab character | At the start: demotes; in mid-text, not confirmed | "Click anywhere in the item, then ... press Tab" |
| Shift-Tab in a list item | Promotes | Promotes | Promotes |
| Return in a table cell | A new paragraph in the cell | Same | Same |
| Tab in a table | The next cell; in the last cell, a new row | Same | Same |
| Typed `* `, `- `, `1. ` | AutoFormat makes a list | With "Automatically detect lists", a list, when the space is typed | Automatic lists |
| Typed `# `, `[] ` | Nothing | With "Automatically detect Markdown": a heading, a checkbox, when the space is typed | Nothing |
| Typed `> ` | Nothing | Nothing | Nothing |

## Why structure, not text

The investigation laid out four answers to "what is a blank line between blocks to the person"
(`findings-structure.md` §3):

- **(A) Structure, not text.** Hidden; never a place for the caret; Return, Backspace and Delete
  act on blocks.
- **(B) Visible lines the editor keeps correct.** The gaps stay lines, but the keys write the blank
  lines Markdown needs. The file comes out right, but the person still sees, clicks into and
  deletes lines that render as nothing, every gap is still a place where typing could land in the
  wrong block, and Backspace on a gap still needs a meaning of its own. No word processor has such
  lines.
- **(C) Show the difference, change nothing:** two blank lines drawn as one, soft line breaks marked.
  It explains the surprises and prevents none.
- **(D) Fix the worst cases.** It keeps the model that causes them.

**Call: (A).** It is what Word, Docs and Pages do, what the format already reads (§3.4), what the
research planned, and what Stephan asks for. It costs the most: a layer of keys, hidden lines, and an
answer to the empty paragraph Markdown can't hold, which the next section gives. The stages spread
the cost, and the first one is worth shipping alone.

## The model

### Blocks and breaks

A document is a sequence of blocks, some inside containers: a list item holds blocks, and so does a
quote. Between two blocks is a **break**: the line break that ends the first, any blank lines, and
the next block's prefix (`## `, `- `, `> `, a list item's indentation). The person writes blocks;
the editor writes breaks.

Each block has **text**: the characters after its prefix, on its lines. The caret is always in a
block's text, at its start, in it, or at its end, or in the one empty paragraph or empty line
described below. A block's prefix and the hidden markers at its edges belong to the break, for the
keys: ← at the start of a block's text goes to the end of the text above, in one press. The one
exception is the syntax a line shows while the caret is in it (a bullet's source, a heading's `##`,
a quote's `>`): a click can put the caret in it, and there Backspace, Delete and typing edit it as
text, as today, while Return and Tab act as at the start of the block's text. **Call:** a heading's
`#`s and a quote's `>` show as source only while the caret is inside them, as a list's marker
already does, not whenever it is on their line (today's `onLine`), so that ← at the start of a
heading's text goes to the end of the text above in one press, and what Backspace takes is never
drawn as text.

### What Clean and Redlines draw

- **Blank lines between blocks are never drawn.** They are hidden as whole lines, with the line
  breaks around them, and the caret steps over them as it steps over a hidden marker line today.
  Blank lines that are content stay: in code, front matter, HTML blocks that hold them, and math.
- **The space between blocks is drawn by kind**, as padding on the first line of the block below,
  and is the same whether the file has no blank line there (a paragraph right under a heading), one,
  or three: 16 px between blocks, 18 px under a heading 1, 10 px under headings 2 to 6, 6 px between
  the items of a tight list, 16 px between the items of a loose list and between the paragraphs of a
  quote or an item (today's gap heights, now theme tokens). **Call:** spacing comes from the blocks,
  not from blank lines, so a file reads as it renders and a tight file isn't cramped.
- Raw draws every line as written.
- **The keys do the same in Clean and Redlines,** and the same with Track Changes on and off, but for
  the refusals the format keeps. What differs is what is drawn: Clean shows the newest text; Redlines
  also shows the changes the keys make, as today (a new paragraph underlined as an insertion, a split
  or a join as a change bar on its line, its ¶ only with Preferences › Editor › Show line break marks, #161; the bar and the card say it either way). A
  change whose marker stands on a hidden line, as a split typed next to another person's split does,
  opens its card from where it is drawn, at the end of the text above (#198).

### The empty paragraph

Markdown can't hold an empty paragraph; it can hold an empty heading, list item, quote or code
block, each of which renders. So:

- **Return opens an empty paragraph** where Word would put one. It is a real empty line in the text,
  with a blank line above and below it (or the start or end of the document), and the container's
  prefix in a quote or a list item, drawn as an empty line of body text with the caret in it.
- **It is shown while the caret is in it, or in the block you pressed Return in** (Return at the
  start of a paragraph leaves the caret with its text, as in Word, and ↑ goes into the empty
  paragraph above).
- **Typing fills it:** it is a paragraph, or, if you type `## ` or `- `, a heading or an item.
- **Leaving it empty takes it back.** The moment the caret goes elsewhere, the Returns that opened
  it are taken back, as if they hadn't been pressed: with nothing else done since, they also leave
  Undo's history, so ⌘Z after that undoes what came before them. When something else was done in
  between, the empty paragraph goes as an edit of its own, which ⌘Z can bring back.
- **The file never gets it.** Saving, and everything else that reads the document for the file,
  get the text as if it had been taken back; so does the host's edited state, which a Return alone
  doesn't set. A save at the wrong moment can't leave stray blank lines, or a list read as loose.
- **Return in an empty paragraph does nothing** at the top level. **Call:** Markdown can keep a second empty paragraph only as a paragraph of a no-break space or
  `&nbsp;`, content the file would keep and every renderer would draw as a paragraph; Redlines
  writes none, and Word's habit of Return Return for space has no form that stays empty. In a
  container it moves the empty paragraph out one level, as Return on an empty list item does: at the
  end of a quote, out of the quote; in the middle of one, it parts the quote; at the end of a list
  item, it becomes a new empty item after it; between two paragraphs of an item, nothing. Return at
  the end of a block whose empty paragraph is already open below it (you pressed Return, went back up) puts the caret in it.
  Return at the start of a block whose empty paragraph is open above it (you pressed Return there)
  does nothing, as in an empty paragraph. **Call:** a second empty paragraph has no form.
- **What makes an empty line the open empty paragraph** is any empty line between blank lines, or at
  the document's edges, that the caret lands on, not only one a key opened: after ⌘Z of typing in it,
  after ⌘Z of a take-back, after deleting all the text of your own new paragraph with Track Changes
  on (format §3.4 leaves the line breaks). An empty document is one empty paragraph. A take-back
  that is an edit of its own goes into the transaction that moves the caret, so that ⌘Z puts the
  caret back inside. **Call:** otherwise `caretOutOfHiding` moves the caret into the next block and
  the extra lines stay in the file.
- **An agent's edit while it is open:** `reloadDoc` diffs the new file against `textWithoutOpen`,
  not the live text, and maps the open block through that diff; the block stays open when the blocks
  on either side of it survive, and otherwise the caret goes to the end of the block above.
  **Call:** otherwise the diff deletes the open paragraph's line breaks, the caret maps into the
  block beside it and the next letters land there, which is the anti-goal of text in another block.
- **Spacing and numbers while it is open** are read as if the open block held a character (from
  `textWithoutOpen` with it added), never from the live text alone. **Call:** an empty paragraph
  opened in the middle of a list leaves `- one⏎⏎ ⏎⏎- two` in the live text, which CommonMark reads
  as one loose list; the list must not be drawn loose while the caret is there.
- An **empty line** opened by Shift-Return at the end of a block's text behaves the same way
  (below, "Shift-Return").
- **An empty item that Tab indents under a line of text is open too (Stage 2).** Markdown has no
  empty item right under a line of text in a tight list: an empty bullet item there is a setext
  underline (`- one⏎- two⏎  - ` is `<li><h2>two</h2></li>`), and an empty numbered one is the
  paragraph's text (`2. two⏎   1. ` is `<li>two 1.</li>`). So when the person's own Return made an
  empty item and Tab (or Shift-Tab back and Tab again) moves it to a level where it would be one, it
  is open, as the empty paragraph is: drawn as an empty item at its level, with spacing and numbers
  read as if it held a character; left out of the file, with the line break and the marker that make
  it (`textWithoutOpen`), so that the file never holds the form Markdown can't; written when text is
  typed in it (`- two⏎  - x`; with Track Changes on the split's break is edited and no mark is made
  for the indentation); taken back, with its Return, when the caret leaves; and an ordinary item
  again when Shift-Tab or Return moves it to a level where Markdown can hold it (`- two⏎- `, as
  Return writes it). **Call:** only an empty item the person's own keys made: a file that already
  holds `- one⏎  -` is read as Markdown reads it, and Tab on an empty item that Return didn't just
  make, where it would make this form, is refused ("An empty item can't be indented under a line
  of text in Markdown. Type in it first."). Backspace or Delete over the only character of an item
  that the file holds opens it the same way when the item's line and the end of the line above carry
  no marker of a change (#204; with Track Changes on the item goes whole instead).

**Call:** the empty paragraph is transient. Showing it after you leave would draw something no
renderer shows; keeping its blank lines in the file would leave stray lines that pile up.

The same rule covers an empty paragraph left by deleting all of a paragraph's text with Track
Changes off: it shows while the caret is in it and goes when it leaves. With Track Changes on,
deleting all of an existing block's text deletes the block (format §3.4), as today.

### Taking a Return back

The editor keeps a record of the last Returns pressed one after the other (Return, Shift-Return,
and the Returns that leave a list or quote), each with the exact text it replaced. Any other edit
(typing, a command, an agent's edit) ends the record, and so does the caret leaving the empty block
and the block Return was pressed in, once the record has taken that empty block back.

- **Backspace right after a Return takes that Return back exactly,** from the record, as an edit of
  its own (⌘Z brings the Return back), when the caret is where that Return left it. So does Delete
  when the Return left the caret in an empty block. Pressed again, Backspace takes back the Return before it. Delete in an
  empty paragraph right after Return takes the Return back and puts the caret at the start of the
  next block's text (where the rules put it, and where Word does), not where Return was pressed.
- **The view:** a split switches Clean to Redlines (design §5.3); Backspace right after takes the
  split back and gives the view back, the record keeping the view the Return switched from. An empty
  line opened by Shift-Return holds both the switch and its card until the first character is
  typed, since the line goes again if the caret leaves.
- **History:** the take-backs go in with `addToHistory: false`, marked so that `history.ts`'s
  `outsideField` skips them (it reads that annotation as a change from outside the history and would
  check every later undo and redo as one); they map the history exactly.
- **The mouse:** a mousedown that leaves the empty paragraph doesn't take it back at once, since the
  text under the pointer would move up a line and a drag started there would select from the moved
  text; it is taken back when the mouse selection ends.
- Without a record, Backspace and Delete follow the rules of "Backspace and Delete at block edges",
  which give the same result in the common cases, as the probes show (in a list item it takes two presses, the first taking off the bullet).

**Call:** Backspace undoes the Return from the record, not by rules, so that it is exact in every
case Stephan asked about, including the ones where a rule would leave a blank line more (a heading
with no blank line under it) or put back a different split id.

A Return that replaced a selection is recorded without the deletion: Backspace right after it joins
the blocks again and leaves the deleted text deleted, as in Word.

### What a key writes

Each key computes plain edits of the text and hands them to the tracked layer, which records them
through `trackedEdit` (Track Changes on) or `untrackedEdit` (off), as typing is recorded today; the
caret then goes where the key says. A block change of a block that stands alone (the `<fmt>` rows: a
one-item list, a one-paragraph quote, an item outdented or indented) goes through `trackedFormat`
and `untrackedFormat`, as the Paragraph menu's do. Where the block doesn't stand alone (the `<sub>`
and `<del>` rows: the first item of a longer list, the first paragraph of a longer quote) the key
writes the plain edit through `trackedEdit` or `untrackedEdit`, because the two format calls refuse
those blocks ("Only a block with a blank line before and after it can change…", "A quote of more
than one paragraph can't change type."). The suite checks each row's form, so a wrong call shows. Where the key acts on your own
pending change (an item your Return made, a paragraph you typed), it edits that change and writes no
mark of its own (see "Track Changes").

## The matrix: Return, and the Backspace that takes it back

Notation: ‸ is the caret, ⏎ a line break, · a no-break space. Markers are shortened: `<split>` is
`<!--split ID-->`; `<ins>x</ins>` is `<!--ins ID-->x<!--/ID-->`; `<del x>` is `<!--del ID x-->`;
`<sub x>y</sub>` is `<!--sub ID x-->y<!--/ID-->`; `<fmt was=p>` is `<!--fmt ID was=p-->`. Only the
lines around the caret are shown. "Plain" means no mark. "Backspace right after" is from the record,
and gives back the starting text exactly in every row. ✓ marks a form probed with the format library,
in both modes; a form without it is what the format's rules give, and the conformance suite checks
every row.

### Paragraphs

The document `One two.⏎⏎Next.` unless the row says otherwise.

| Where | Word · Docs | Redlines | File, Track Changes off | Track Changes on | Backspace right after |
| --- | --- | --- | --- | --- | --- |
| End of the text | Same | An empty paragraph below, the caret in it | `One two.⏎⏎‸⏎⏎Next.` | Plain ✓ | `One two.‸⏎⏎Next.` ✓ |
| …then type `X` | Same | A paragraph | `One two.⏎⏎X‸⏎⏎Next.` | `One two.⏎⏎<ins>⏎⏎X</ins>⏎⏎Next.` ✓ (a whole-block insertion) | Backspace deletes `X`, then the next takes the Return back ✓ |
| End, the next block right under it (`Intro:⏎- a`) | Same | The same; the new paragraph gets a blank line on each side | `Intro:⏎⏎‸⏎⏎- a` | Plain ✓ | `Intro:‸⏎- a` ✓ |
| End of the last block (`One two.⏎`) | Same | The same | `One two.⏎⏎‸⏎` | Plain ✓ | ✓ |
| Middle of the text (`One ‸two.`) | Same | Two paragraphs, the caret at the start of the second | `One ⏎⏎‸two.` | `One <split>⏎⏎‸two.` ✓ | `One ‸two.` ✓ (the split goes) |
| At a soft line break, the end of a source line inside the paragraph (`One two‸⏎three.`) | — | Two paragraphs; the caret at the start of `three.` | `One two⏎⏎‸three.` | `One two<split>⏎⏎⏎‸three.` ✓ | ✓ |
| Start of the text (`One.⏎⏎‸Two.`) | Same | An empty paragraph above; the caret stays at the start of `Two.`; ↑ goes into the empty one | `One.⏎⏎⏎⏎‸Two.` | Plain ✓ | `One.⏎⏎‸Two.` ✓ |
| Start of the first block | Same | An empty paragraph at the top | `⏎⏎‸One two.` | Plain | ✓ |
| In the empty paragraph | Another empty paragraph | Nothing | — | — | — |
| A selection in one paragraph (`One [two] three.`) | Replaces it with a paragraph break | Two paragraphs | `One ⏎⏎‸ three.` | `One <del two><split>⏎⏎‸ three.` ✓ | Joins them; `two` stays deleted |
| A selection across blocks (`One [two.⏎⏎Th]ree.`) | Deletes it; two paragraphs | The selected text goes from both; the blocks stay apart, each its own kind | `One ⏎⏎‸ree.` | `One <del two.>⏎⏎<del Th>⏎⏎ree.` ✓ (two deletions; the break untouched) | Joins them (the deletions stay) |
| The space between two blocks | — | The caret can't be there; a click in its upper half goes to the end of the block above, in its lower half to the block below | — | — | — |
| The second of several Returns whose splits stand beside each other (#198) | — | The card of each break opens by hovering where the break is drawn, at the end of the text above, though its marker is on a hidden line | Plain | Splits | ✓ |
| Return again, at the start of a block whose empty paragraph is open above it | Another empty paragraph | Nothing | — | — | — |
| At a hard line break, either side (`One ‸\⏎two.`, `One \⏎‸two.`) | A new paragraph | The hard break becomes the paragraph break: two paragraphs, the caret at the start of the second | `One ⏎⏎‸two.` | Your own pending hard break: its split takes a blank line as its break; another person's or one in the original text: a substitution of the break (format rule 10) | ✓ |
| Right after Shift-Return, in mid-text (`One \⏎‸two.`) | — | The record takes the Shift-Return back and Return acts at that place: two paragraphs | `One ⏎⏎‸two.` | `One <split>⏎⏎‸two.` | Back to the hard break |
| Inside bold, emphasis, strikethrough, a code span or a link's text (`One **bold ‸text** two.`) | Splits the run, or the link, in two | The construct is closed before the break and opened again after it; a space at the split goes outside the delimiters | `One **bold**⏎⏎ **‸text** two.` (probed) | `One **bold<sub ␣>**<split>⏎⏎ **</sub>text** two.` (probed; ␣ is the space); a link: two links with the destination repeated, `[the](url)⏎⏎ [guide](url)` | ✓ |
| At the edge of such a construct, or in an atom (image, autolink, math, inline tag) | — | The break goes outside the construct, or after the atom | | | ✓ |
| A selection across three or more blocks | Deletes it; two paragraphs | The blocks inside the selection go whole and one break stays; the first half keeps the first block's kind, the second half the last block's | | A whole-block deletion of each block between, as in the row above | Joins them (the deletions stay) |
| A selection covering all of one block's text | Deletes it; an empty paragraph | The text goes and an empty paragraph opens | | The block's deletion, and the empty paragraph after it | Joins; the text stays deleted |
| Before a block that takes no text, with no paragraph above it (the opening fence of code that starts the document or follows another such block, a table's first `\|`, an HTML block) | An empty paragraph above, as above a table at the top of a document | An empty paragraph above it | `⏎⏎‸` then the block | Plain | ✓ |

**Call:** a new block always gets a blank line above and below it, whatever the file's habit: in a
file with no blank lines under its headings, the paragraph you add under one gets one. It reads the
same everywhere, and no new block is ever read into its neighbour (a lazy line, a setext underline,
a numbered item that can't interrupt a paragraph). The blocks you didn't touch keep their spacing.

**Call:** Return at a soft line break writes the paragraph break there and puts the caret at the
start of the line below, which begins the new paragraph, as it looks; it doesn't open an empty
paragraph between them. With Track Changes off the line break that is already there becomes the paragraph break and one more is inserted beside it (`One two⏎⏎‸three.`, probed), so no extra blank line is left. With Track Changes on the paragraph break goes in front of the soft one (two inserted line breaks, which read as one): a single line break there is refused, because rejecting its split would take the soft line break with it.

**Call:** Return on either side of a hard line break replaces the hard break with a paragraph break
and puts the caret at the start of the second paragraph. The plain middle-of-text rule there writes a
literal backslash at the end of the first paragraph (`One \⏎⏎⏎two.`; every renderer shows `One \`),
and Shift-Return then Return is the natural way to say "I wanted a paragraph".

**Call:** Return inside emphasis, strikethrough, a code span or a link's text closes the construct
before the break and opens it again after it. The old Return wrote one line break, which these span;
the paragraph break ends them, so both halves would show `**` or `[` (probed). Word splits a bold
run into two runs and a link into two links. The block structure reads which constructs are open at
the caret from lezer's inline tree.

**Call:** Return over a selection that crosses blocks keeps each block's kind, where Word, once the
deletion merges the blocks, gives both halves the first block's kind: only text was selected, and
the kinds are what the person sees. Return over all of one block's text leaves an empty paragraph
because both halves would be empty.

**Call:** Return with the caret before a block that takes no text and nothing above it opens an empty
paragraph above it, as Word does above a table at the top of a document; no other key reaches that
place.

### Shift-Return

| Where | Word · Docs | Redlines | File, Track Changes off | Track Changes on | Backspace right after |
| --- | --- | --- | --- | --- | --- |
| Middle of a paragraph's text (`One ‸two.`) | A line break | A line break, the `\` hidden | `One \⏎‸two.` | `One <split>\⏎‸two.` ✓ | `One ‸two.` ✓ |
| End of the text (`One two.‸⏎⏎Next.`) | A line break and an empty line | An empty line in the paragraph, the caret on it | `One two.\⏎‸·⏎⏎Next.` | `One two.<ins><split>\⏎·</ins>⏎⏎Next.` ✓ | ✓ |
| …then type `X` | Same | Text on the new line | `One two.\⏎X‸⏎⏎Next.` (the `·` goes) | `…\⏎X</ins>` ✓ | — |
| In a list item, middle | Same | Same | `- One \⏎  ‸two.` | `- One <split>\⏎  ‸two.` ✓ | ✓ |
| In a list item, end | Same | Same | `- One two.\⏎  ‸·` | `<ins><split>\⏎  ·</ins>` ✓ | ✓ |
| In a quote, middle | Same | Same | `> One \⏎> ‸two.` | `> One <split>\⏎> ‸two.` ✓ | ✓ |
| In a quote, end | Same | Same | `> One two.\⏎> ‸·` | `> One two.<ins><split>\⏎> ·</ins>` ✓ | ✓ |
| On the empty line, or in an empty paragraph | Another line break | Nothing | — | — | — |
| Return on the empty line | A new paragraph | The Shift-Return is taken back, from the record, and Return opens an empty paragraph below the block | `One two.⏎⏎‸⏎⏎Next.` | Plain (replacing the line break in one edit leaves your split pending, probed, so it is two steps) | Back to the empty line |
| In a heading | A line break in the heading | Refused: "A heading is one line in Markdown." | — | — | — |
| In a table cell | A line break in the cell | Refused: "A table cell is one line in Markdown." | — | — | — |
| At a soft line break (`One two‸⏎three.`) | A line break | The backslash goes in front of the line break that is already there, which is drawn as the line break Redlines already draws; the caret at the start of `three.` | `One two\⏎‸three.` | `One two<ins>\</ins>⏎‸three.`, sound once format rule 11 lands | ✓ |
| A selection across blocks | Replaces it with a line break | The selection is deleted as typing deletes it (a join), then the hard break is written | | | |
| In emphasis or a link's text | A line break | A hard break inside it (`**bold\⏎ text**` renders) | `**bold\⏎‸text**` | A split before the backslash | ✓ |
| In a code span | A line break | The hard break goes after the span, since a line break in a span reads as a space | | | ✓ |
| In code or front matter | — | A line break, as Return | | | |

**Call:** Stage 1 binds Shift-Return too: in mid-text it writes the hard break, and at a block's end
it does what Return does (the empty paragraph) until Stage 4 brings the empty line. CodeMirror's
`insertNewlineAndIndent` would otherwise write a line break that puts the caret on a line Stage 1
hides.

**Call:** Shift-Return in a heading or a table cell is refused with a one-line notice, not turned
into a Return: Markdown's headings and cells are one line, and a different key's result would
surprise more than a word of why.

**Call:** a hard break is a backslash and a line break, not two trailing spaces. The backslash is
visible in Raw and survives editors and hooks that trim trailing spaces; CommonMark, GFM, pandoc and
micromark all read it. A file that uses two-space breaks keeps them; the editor hides both kinds'
syntax and treats either as one character for Backspace.

**Call:** at the end of a block's text, the new line holds a no-break space until the first
character is typed, which replaces it (an input method's text replaces it when composition ends).
A hard break with nothing after it is a literal backslash in every renderer
(`a\⏎⏎b` renders `a\`), and an empty line in a list would make the list loose; the format refuses
both forms with Track Changes on, and accepts this one in every container. Like the empty paragraph,
it is taken back if the caret leaves, and the file never gets it.

### Headings

The document `Para.⏎⏎## Head line⏎⏎Next.`.

| Where | Word · Docs | Redlines | File, Track Changes off | Track Changes on | Backspace right after |
| --- | --- | --- | --- | --- | --- |
| End of the text | A Normal paragraph below | An empty paragraph (body) below | `## Head line⏎⏎‸⏎⏎Next.` | Plain ✓ | ✓ |
| End, a paragraph right under it (`## Head⏎Para.`) | Same | The same; blank lines around the new paragraph | `## Head⏎⏎‸⏎⏎Para.` | Plain ✓; typed text a whole-block insertion ✓ | `## Head‸⏎Para.` ✓ (from the record) |
| Middle (`## Head ‸line`) | Two headings | Two headings of the level | `## Head ⏎⏎## ‸line` | `## Head <split>⏎⏎## ‸line` ✓ | ✓ |
| Start of the text | An empty paragraph above in the heading's style; the caret stays | An empty body paragraph above; the caret stays | `Para.⏎⏎⏎⏎## ‸Head line` | Plain ✓ | ✓ |
| Start, with another person's pending change to the heading | — | The same: the line breaks go in front of its opener's line | `Para.⏎⏎⏎⏎<fmt was=p>⏎⏎## Head…` | Plain ✓ | ✓ |
| Middle, with another person's pending change to the heading | — | Refused, with the format's words: "Decide Bo's change to this block first." | — | — | — |
| A setext heading (`Head⏎===`), end | Same | After the underline | `Head⏎===⏎⏎‸⏎⏎Next.` | Plain | ✓ |
| A setext heading, middle | Same | Two headings; the first half gets the same underline | `He⏎===⏎⏎‸ad⏎===` | A split | ✓ |
| Shift-Return | A line break in the heading | Refused (above) | — | — | — |

**Call:** Return at the start of a heading leaves an empty body paragraph above it, where Word and
Docs leave an empty heading (ruled by Stephan, Nov 10). Markdown could hold Word's form (`## ` on
its own is an empty heading), so this is a choice, not a limit: only empty paragraphs are taken back
when the caret leaves, so an empty heading would stay in files, a blank heading with its margins
and an empty anchor on GitHub; what people add above a heading is mostly body text; and typing `## `
turns the paragraph into a heading.

Heading levels 1 to 6 behave alike. In a quote or a list item, the same rows apply inside the
container (below).

### List items

The document `- one⏎- two⏎⏎After.` (a tight list) unless the row says otherwise. What is said for
`- ` holds for `*` and `+` bullets (the list's own character is used), numbered items and task
items, at every depth; the rows after the first block say what differs.

| Where | Word · Docs · Pages | Redlines | File, Track Changes off | Track Changes on | Backspace right after |
| --- | --- | --- | --- | --- | --- |
| End of a filled item | A new item | A new item | `- two⏎- ‸` | `- two<split>⏎- ‸` ✓ | `- two‸` ✓ |
| …then type `X` | Same | Text in the new item | `- two⏎- X‸` | `- two<ins><split>⏎- X</ins>` ✓ | Deletes `X`, then takes the Return back ✓ |
| End, a loose list (`- one⏎⏎- two`) | Same | A new item, with the blank line the list has | `- two⏎⏎- ‸` | `- two<split>⏎⏎- ‸` ✓ | ✓ |
| End of an item with a nested list under it (`- one‸⏎  - sub`) | A new item; the nested items move under it | Same | `- one⏎- ‸⏎  - sub` | `- one<split>⏎- ‸⏎  - sub` ✓ | ✓ |
| End of the first paragraph of an item that has a second (`- p1‸⏎⏎  p2`; reason below) | A new item | An empty paragraph inside the item, between the two | `- p1⏎⏎  ‸⏎⏎  p2` | Plain ✓ | ✓ |
| Middle of the text (`- one ‸two`) | Two items | Two items; what follows in the item goes with the second | `- one ⏎- ‸two` | `- one <split>⏎- ‸two` ✓ | ✓ |
| Start of the text (`- ‸two`) | An empty item above; the caret stays | Same | `- ⏎- ‸two` | `- <split>⏎- ‸two` ✓ | ✓ |
| An empty nested item (`- one⏎  - ‸`; after a Return, Tab it is open: the file has `- one` without it until text is typed, above, "The empty paragraph") | Up one level (Word; Docs not confirmed) | Up one level | `- one⏎- ‸` | Your own item: the split's break edited ✓; another's: refused until their change is decided (the tracked layer takes no edit of their break) | `- one⏎  - ‸` (the open item again) ✓ |
| An empty item at the top level, the last | Ends the list: an empty Normal paragraph | Leaves the list: an empty paragraph after it | `- two⏎⏎‸⏎⏎After.` | `- two<split>⏎⏎‸⏎⏎After.` ✓ (your split's break changed) | Back to the empty item `- two⏎- ‸` ✓ |
| An empty item at the top level, in the middle | Ends the list there; the rest is another list | The same: an empty paragraph between two lists (while it's empty the file would read one loose list, which is why saving leaves it out) | `- one⏎⏎‸⏎⏎- two` | A split changed, as above | ✓ |
| An empty item in a list in a quote (`> - one⏎> - ‸`) | — | Leaves the list, stays in the quote | `> - one⏎>⏎> ‸` | Plain or your split's break | ✓ |
| Numbered, end of an item | The next number | The next number | `2. two⏎3. ‸` | `2. two<split>⏎3. ‸` ✓ | ✓ |
| Numbered, in a list numbered `1.` throughout | Same | `1.` | `1. b⏎1. ‸` | A split | ✓ |
| Numbered, middle of the list | Later items renumber | The new item takes the next number; the items after it keep theirs, and are drawn as Markdown counts them | `1. one⏎2. ‸⏎2. two` | `1. one<split>⏎2. ‸⏎2. two` | ✓ |
| Task item, end (`- [x] two`) | A new unchecked box | A new unchecked item | `- [x] two⏎- [ ] ‸` | `- [x] two<split>⏎- [ ] ‸` ✓ | ✓ |
| An empty task item | Ends the checklist | Leaves the list, as an empty bulleted item does | `- [x] two⏎⏎‸⏎⏎After.` | ✓ | Back to `- [ ] ‸` ✓ |
| End of the last paragraph of an item that has several (`1. a⏎⏎   b‸`, numbered steps, #204) | A new item | A new item | `1. a⏎⏎   b⏎2. ‸` | `1. a⏎⏎   b<split>⏎2. ‸` (it was refused with "A marker here would start a line."; the format writes it since #204) | ✓ |
| Return on the empty item that holds nested items (`- one⏎- ‸⏎  - sub`) | Up a level | The nested items go back under the item above and the empty paragraph opens after them (what taking the first Return back and leaving the list gives) | `- one⏎  - sub⏎⏎‸` | Plain or your split's break | Back to the empty item |
| Start of a task item's text (`- [x] ‸two`) | An empty item above | A new empty unchecked item above; the item keeps its own box | `- [ ] ⏎- [x] ‸two` | `- [ ] <split>⏎- [x] ‸two` | ✓ |
| A task item just made by Return (`- [ ] ‸`) | An empty box | An empty box at the item's indent, not `• [ ]` at the column's edge (#198) | | | |
| Shift-Return | A line break in the item | A hard break, the next line at the item's text column | `- One \⏎  ‸two.` | ✓ | ✓ |

**Call:** Return at the end of an item's first paragraph, with a second after it, opens an empty
paragraph inside the item, where Word makes a new item: Word's form `- p1⏎- ⏎⏎  p2` reads `p2` out
of the list while the new item is empty (an item that starts empty takes nothing after a blank
line), probed, and Track Changes on writes it anyway. Return at the end of the item's last
paragraph makes the new item, because that is where "the next item" is meant.

The chain Stephan asked about, probed with Track Changes on and off: in `- one⏎  - sub⏎⏎After.`,
Return at the end of `sub` (a new nested item), Return (up one level), Return (out of the list),
then Backspace three times, gives back the starting text exactly, the item, the level and the list
returning one Backspace at a time.

**Call:** Return on an empty item goes up one level, and out of the list at the top, as in Word;
in a list inside a quote, it leaves the list and stays in the quote. One container per Return.

**Call:** the items after a new numbered item are not renumbered. Markdown numbers a list from its
first item, and renders later numbers as it counts them, so renumbering changes nothing a reader
sees; with Track Changes on it would make a change of every later item, each "Replaced '5.' with
'6.'", which would also fill the list's budget for block changes (#172). Numbers are drawn as
Markdown counts them, and the source number shows when the caret is on the marker, as today.

### Quotes

The document `> One two.⏎⏎After.` unless the row says otherwise.

| Where | Word · Docs | Redlines | File, Track Changes off | Track Changes on | Backspace right after |
| --- | --- | --- | --- | --- | --- |
| End of the quote's last paragraph | (No quote blocks: a Quote is a paragraph style) | An empty paragraph in the quote | `> One two.⏎>⏎> ‸⏎⏎After.` | Plain ✓ | ✓ |
| …then type `X` | | A second paragraph of the quote | `…⏎>⏎> X‸` | `> One two.⏎>⏎> <ins>⏎>⏎> X</ins>` ✓ | ✓ |
| End of a paragraph with another after it (`> One.⏎>⏎> Two.`) | | An empty paragraph between them | `> One.⏎>⏎> ‸⏎>⏎> Two.` | Plain ✓ | ✓ |
| Middle (`> One ‸two.`) | | Two paragraphs of the quote | `> One ⏎>⏎> ‸two.` | `> One <split>⏎>⏎> ‸two.` ✓ | ✓ |
| At the end of a line that a paragraph of the quote goes on after, also a lazy line (`> A long quote that⏎wraps lazily.‸⏎> q`) | | Return in the middle, as the paragraph goes on: two paragraphs of the quote (never a plain blank line, which would part the quote, #136); the caret at the start of `q` | `…wraps lazily.⏎>⏎> ⏎> ‸q` | `…wraps lazily.<split>⏎>⏎> ⏎> ‸q` ✓ (a single `⏎>` is refused, as at a soft line break) | ✓ |
| Start of the quote's first paragraph | | An empty paragraph above, in the quote; the caret stays | `> ⏎>⏎> ‸One two.` | `> <split>⏎>⏎> ‸One two.` ✓ | ✓ |
| The empty paragraph at the end of the quote | | Leaves the quote: an empty paragraph after it | `> One two.⏎⏎‸⏎⏎After.` | Plain ✓ | Back into the quote ✓ |
| An empty paragraph in the middle of a quote | | Parts the quote, with an empty paragraph between | `> One.⏎⏎‸⏎>⏎> Two.` | A deletion and a split (two quotes is a change a reader sees) | ✓ |
| An empty paragraph in a quote in a quote (`> > x⏎> >⏎> > ‸`) | | Out one level | `> > x⏎>⏎> ‸` | Today a deletion and a split; plain once the format rule below lands | ✓ |
| End of a GitHub alert's first line (`> [!NOTE]‸`) | | Into the alert's body | `> [!NOTE]⏎> ‸` | Plain | ✓ |
| Shift-Return | | A hard break | `> One \⏎> ‸two.` | ✓ | ✓ |

### Containers inside containers

The rules apply to the innermost container first, one level per key.

| Where | Redlines | File, Track Changes off |
| --- | --- | --- |
| End of a quote in a list item (`- > q‸`) | An empty paragraph in the quote, in the item | `- > q⏎  >⏎  > ‸` |
| The empty paragraph at the end of that quote | Leaves the quote, stays in the item: an empty paragraph in the item | `- > q⏎⏎  ‸` |
| End of an item in a list in a quote (`> - a‸`) | A new item | `> - a⏎> - ‸` |
| An empty item there | Leaves the list, stays in the quote | `> - a⏎>⏎> ‸` |
| A heading in a quote or an item, end | An empty paragraph in the container | `> ## H⏎>⏎> ‸` |
| An empty paragraph at the end of a list item (`- p1⏎⏎  ‸`) | A new empty item after the item | `- p1⏎- ‸` |
| A nested item three levels down, empty | Up one level per Return, then out of the list | |

With Track Changes on, each writes what the same key writes at the top level: plain at a block's
edge, a split in a list or in mid-text. These rows weren't all probed one by one; the suite runs
them.

### Code, tables, front matter, HTML blocks and rules

| Where | Word · Docs | Redlines | Track Changes off | Track Changes on | Backspace right after |
| --- | --- | --- | --- | --- | --- |
| In fenced or indented code | — | A line break in the code, with the line's indentation | `let a = 1;⏎‸` | Refused today ("A tracked change can't go inside code…"); a whole-block substitution once format §3.5 is built (Stage 6) | ✓ |
| Backspace at the start of the first code line, Delete at the end of the last (also in math and front matter) | — | Nothing, as at the ends of a file in a code editor (Delete there writes the closing fence into the code, probed) | | | |
| Backspace in an empty code block | — | The block goes whole, as other empty blocks do | | A whole-block deletion | ✓ |
| On the empty last line of an HTML block that a blank line ends (CommonMark types 6 and 7) | — | Leaves the block, as in code; a second line break would end it anyway | | | ✓ |
| On the empty last line of code | — | Leaves the block: the empty line goes, an empty paragraph opens after the closing fence | `let a = 1;⏎```⏎⏎‸⏎⏎After.` | As above | Back to the empty line in the code ✓ |
| End of the opening fence (```` ```js‸ ````) | — | Into the code | ```` ```js⏎‸⏎``` ```` | As above | ✓ |
| In a table row (source, until #176) | A new paragraph in the cell | The same cell in the row below, which changes nothing; on the last row, a new row (shown) | `\| 1 \| 2 \|⏎\|  \|  \|` | Today an insertion with a split (✓ exact); the row marker of format §3.7 is #178's | ✓ |
| On an empty last row | — | Leaves the table: the row goes, an empty paragraph opens after it | | | ✓ |
| In front matter | — | A line break, with the line's indentation | `title: x⏎‸` | Refused (format §3.8) | ✓ |
| End of front matter's closing line | — | An empty paragraph at the start of the body | `---⏎⏎‸⏎⏎Body.` | Plain ✓ | ✓ |
| In an HTML block | — | A line break (the block stays one block) | | As code | ✓ |
| End of an HTML block's last line | — | An empty paragraph after it | | Plain | ✓ |
| A thematic break | A border or an object | The caret never rests on it; Return before or after it is Return at the edge of the block beside it | | | |

**Call:** a thematic break is an atom, like an image: the caret skips it, and Backspace after it or
Delete before it deletes it. It has no text to hold a caret, and typing on its line would turn it
into a paragraph of dashes.

**Call:** Return in code is a line break in the code, and Return on its empty last line leaves the
block. Code holds blank lines, so "Return twice" can't mean "leave"; a trailing blank line in a
fence is never meant.

**Call:** Stage 1 binds Return in a table and at an HTML block's end too, because CodeMirror's
`insertNewlineAndIndent` would put the caret on a line it hides: at the end of the last row, and at
the end of an HTML block's last line, Return opens the empty paragraph after it; in a row it does
nothing until Stage 6.

**Call:** display math and R Markdown chunks behave as code; pandoc `:::` divs behave as a
container, like a quote; link reference definitions and a footnote definition's first line behave
as code (Backspace at the start of the paragraph below one moves the caret and deletes nothing,
since joining text into a definition changes its address and every link that uses it).

**Call:** until tables are edited as tables (#176), Return in a table moves to the cell below and
adds a row at the end, as a spreadsheet does. A Markdown cell holds one line, so Word's "new
paragraph in the cell" has no form.

## Backspace and Delete at block edges

When there is no record of a Return to take back (the caret came here otherwise), Backspace at the
start of a block's text and Delete at the end of it act on blocks:

| Where | Word · Docs | Redlines | Track Changes off | Track Changes on |
| --- | --- | --- | --- | --- |
| Backspace at the start of a paragraph or heading, a block above it | Joins; the block above keeps its formatting | Joins; the block above keeps its kind | `One.‸Two.` | `One.<del ⏎⏎>‸Two.` ✓ |
| …a heading after a paragraph | Same | The heading's text becomes body text of the paragraph | `One.‸Two` | `One.<del ⏎⏎## >‸Two` ✓ |
| …a paragraph after a heading | Same | The text joins the heading | `## Head‸Two.` | `## Head<del ⏎⏎>‸Two.` |
| …a paragraph after a list | Joins into the last item | Same | `- b‸Para.` | `- b<del ⏎⏎>‸Para.` ✓ |
| …the block above is an empty heading, item or quote | The empty paragraph goes; this one keeps its style | The empty block goes; this one keeps its kind | | A whole-block deletion of the empty block, or plain if your own |
| …the block above is code, a table, an HTML block or front matter | Docs and Word don't join a paragraph into a table | Nothing is deleted; the caret goes to the end of that block (none for front matter) | | |
| …the block above is a thematic break | Removes the line | The rule is deleted | | A whole-block deletion of the rule |
| …the first block of the document, or of the body after front matter | Nothing | Nothing, but a first list item or quote is taken out of it (below) | | |
| Backspace at the start of a list item's text, an item above it in its list, first press | Removes the bullet, keeps the indent | Removes the bullet and keeps the text in place: a hard line break after the item above (at the end of that item, or of its last nested item) in a tight list, a second paragraph of that item in a loose one | tight `- one\⏎  ‸two`; loose `- one⏎⏎  ‸two` | tight `- one<del ⏎- ><split>\⏎  ‸two` ✓ (two marks); loose `- one<sub ⏎⏎- two>⏎⏎  ‸two</sub>` ✓ |
| …second press | Again, outdents; then joins | Joins it to the item above (a loose list: the join of a later paragraph, below) | tight `- one‸two` | tight `- one<del ⏎- >‸two` ✓ (cancels your split) |
| …the item above ends in a heading | — | Joins at once, since a heading can't take a line break | `## H‸two` | `## H<del ⏎- >‸two` |
| …the item above ends in code, a table, an HTML block | — | Nothing is deleted; the caret goes to the end of that block | | |
| Backspace at the start of a later paragraph of a list item (`- a⏎⏎  ‸b`, #204) | Joins | Joins it to the paragraph above in the item; the item's indentation goes with the break | `- a‸b` | `- a<del ⏎⏎  >‸b` |
| Backspace in an empty item at any depth, not after a Return (`- one⏎  - ‸`, #204) | Removes the bullet | The item goes with the break above it and its indentation; the caret at the end of the line above | `- one‸` | A whole-block deletion of the empty item (`- one<del ⏎  - >`; the last item of the file, a substitution of its break by a space, `- one<sub ⏎  - > </sub>`), or plain if your own |
| Delete in an empty item at any depth, an item after it (`- one⏎  - ‸⏎- two`, #204) | Removes the bullet | The item goes, the next block keeps its kind, the caret at its start | `- one⏎- ‸two` | `- one<del ⏎  - >⏎- ‸two`: the break above goes with the item, as Backspace takes it, since the format has no place for the marker of a deletion of `  - ` alone at the start of its line (it was refused: "A line that is only Markdown syntax takes no change.") |
| Backspace or Delete over the only character of an item's text, where the empty item is no item in Markdown (a nested bullet under text, a numbered one under text: `- one⏎  - x‸`, #204) | The bullet stays, empty | Track Changes off, on a plain line: the character goes and the empty item is open, as Return and Tab left it: drawn, out of the file, gone with the next Backspace, written when text is typed in it (the file held `  - ` alone, which Markdown reads as the underline of `one` while the editor drew an empty item). With a marker of a change on its line or ending the line above, the plain key (the take-back would decide that change: #442) | `- one` (the item open) | Your own typed text: the item goes whole with the character, `- one‸`; text that isn't yours: the format deletes the whole item, `- one<del ⏎  - x>`, or refuses in its words where it can't (another item right after it, code or a table) |
| …the first item of a nested list | Removes the bullet | Up one level | `- a⏎- ‸b` | `- <fmt was=indent=2>⏎  ‸b</fmt>` ✓ (your own item: its split edited) |
| …the first item of a list at the top level | Removes the bullet | Takes it out of the list: a paragraph; in a numbered list whose next item isn't 1, a blank line after it | `Para.⏎⏎‸one⏎- two` | `Para.<sub ⏎⏎- one>⏎⏎one</sub>⏎- two` ✓; a one-item list `<fmt was=ul>` ✓ |
| Backspace at the start of a quote's first paragraph | — | Takes it out of the quote (one level) | `Para.⏎⏎‸One two.` | One paragraph: `<fmt was=quote>` ✓; more: each of its lines' `> ` taken out, as substitutions of the break ✓ |
| Backspace at the start of a later paragraph of a quote | — | Joins it to the paragraph above, in the quote | `> One.‸Two.` | A join ✓ |
| Backspace in an empty paragraph | The empty paragraph goes | It goes; the caret at the end of the block above | | Plain |
| Backspace in an empty item, heading or quote | Removes the bullet, or the paragraph | It goes with the break above it; the caret at the end of the line above | | A whole-block deletion, or plain if your own |
| Delete at the end of a block, a block after it | Joins the next; this one's formatting wins | Joins the next block's text into this one; this one keeps its kind | `One.‸Two.` | `One.<del ⏎⏎>Two.` ✓; into a heading's text `One.<del ⏎⏎## >Two` ✓ |
| …the next block is empty | Removes the empty paragraph | It goes | | |
| …the next block is code, a table, an HTML block | Nothing | Nothing | | |
| …the next block is a thematic break | Removes it | It is deleted | | |
| Delete in an empty paragraph or block | Joins the next into it | The empty block goes; the next block keeps its kind; the caret at its start | | |
| A selection, any | Deletes it | Deletes it; across blocks a join, the first block keeping its kind (format §3.4) | | ✓ |
| A selection from the start of a block's text to the start of another's (Shift-↓ from a heading's start: `## [One.⏎⏎]Two.`) | Deletes the heading's paragraph too | The covered blocks go whole, with their breaks, in both modes; the block where the selection ends keeps its kind | `Para.⏎⏎Two.` (the untracked edit widened to the start of the line) | `<del ## One.⏎⏎>` ✓ |

**Call:** Backspace at the start of a list item follows Word (ruled by Stephan, Nov 10): the first
press removes the bullet and keeps the text where it is, the second joins it to the item above.
Markdown can hold the first step: as a hard line break in a tight list (`- one\⏎  two`, which
renders as Word shows and leaves the list tight) or as a second paragraph of the item in a loose
one (it was loose already). The other forms are worse: a soft break renders joined to the item above
with a space, and a continuation paragraph in a tight list makes the whole list loose. The ladder
also gives a key that takes a bullet off an item in the middle of a list, which Body refuses (a
block that doesn't stand alone) and Shift-Tab doesn't do at the top level. The item's nested items
become the item above's, after the text. Backspace right after Return still takes the Return back
from the record in one press, as Stephan asked. A first item goes up a level, or out of the list
at the top, as Word removes its bullet. The first press is skipped on an empty item, which would
show nothing. Delete at the end of an item joins the next item's text at once, Word's second step.

**Call:** a paragraph taken out of a list (Backspace at the start of the first item) right under
another list item, or a lazy line of one, gets a blank line above it (`- a⏎⏎b`), since `- a⏎b`
would make it a lazy line of `a` (probed). A join that leaves a numbered item other than 1 right
under text keeps a blank line before that item, as Backspace in such a list already does: Delete at
the end of `Para.` before `2. one⏎3. two` would otherwise turn `3. two` into text of the paragraph
(probed).

**Call:** deleting a selection that covers all of a block's text and reaches the start of the next
block's text deletes the covered blocks whole, with their breaks, in both modes, as the format
already does with Track Changes on (Word's result: the selection holds the paragraph mark); with
Track Changes off the plain edit would turn the next block into the first one's kind. Typing over
such a selection replaces the covered text and keeps the break, as over a triple-click selection.

**Call:** Backspace never joins into code, a table, an HTML block or front matter: it moves the caret
there and deletes nothing, as Docs does at a table.

Joins next to other people's changes follow the format: the deletion of another person's pending
line break is a join that belongs to their split (`<split><del ⏎⏎>`, probed); the key's edit covers
the break as a reader sees it, with the hidden markers at its edges left outside, which is what
makes it a join and not a refused deletion "together with other text".

**Option-Backspace and Command-Backspace** at the start of a block's text act as Backspace there,
and **Option-Delete** at the end as Delete.

## Tab and Shift-Tab; numbered sublists

| Where | Word · Docs · Pages | Redlines | Track Changes off | Track Changes on |
| --- | --- | --- | --- | --- |
| Tab anywhere in a list item | Word: demotes at the start, types a tab character in mid-text; Docs: demotes at the start; Pages: demotes anywhere | Indents the item under the one above, with its nested items | `- one⏎  - ‸two` | `<fmt was=indent=0>` on the item; on your own new item, its split's break edited, no mark ✓ |
| Tab in the first item of a list | Word indents the whole list | Refused, with the format's words ("The first item of a list can't be indented: there is no item to put it under.") | | |
| Tab in a numbered item (`2. two⏎3. ‸three`) | A sublist numbered from 1 | A sublist numbered from 1: the item becomes `1.` | `2. two⏎   1. ‸three` | `<fmt was=indent=0 was=ol=3.\x20>`; on your own new item, edits ✓ |
| Shift-Tab anywhere in a list item | Promote | Outdents; the items after it in its list become its children, as in Word | | `<fmt was=indent=N>` |
| Shift-Tab in a top-level item | Word: nothing | Nothing | | |
| Tab or Shift-Tab with a selection over several items | Each | Each, one change per item in one group | | |
| Tab in a paragraph, heading or quote | A tab character or a first-line indent | Nothing | | |
| Tab in code | — | The code's indentation unit; Shift-Tab takes one away | | As code |
| Tab in a table | The next cell; a new row after the last | The same; Shift-Tab the cell before | | |
| Tab in front matter | — | Two spaces | | Refused |

**Call:** Tab and Shift-Tab indent and outdent a list item wherever the caret is in it, as in Pages.
A tab character means nothing in Markdown prose (it renders as a space), and in front of a line it
makes code. ⌘] and ⌘[ stay, as the menu's Indent and Outdent.

**Call:** outside lists, code, tables and front matter, Tab does nothing; the keyboard leaves the
document as it does in CodeMirror today, with Escape and then Tab, or with ⇧⌥M, which switches Tab
to moving focus. Mac apps keep Tab in the document; neither way traps the keyboard.

**Call:** a numbered item indented into a new sublist is renumbered to 1, and the change keeps its
old number, so rejecting it gives back the bytes. Markdown reads a number other than 1 right under a
line of text as more of that text, which is why every numbered item but the first is refused today
(#171). Outdenting keeps the number written: an item that isn't first in its list renders as counted
whatever its number.

Tab right after Return, the common way to start a nested item, edits your own new item's split, as
the probe shows (`- two<split>⏎  - ‸`), so it writes no block change and is never too many changes
to check (#172). That empty item is open, not in the file (see "The empty paragraph"): the file has
`- two` until text is typed in it, and the item is written then, as `- two<ins><split>⏎  - X</ins>`.

## Typed syntax and the Paragraph menu on an empty paragraph

Typing Markdown at the start of an empty paragraph makes that block, when the syntax is complete,
as Docs converts on the space:

| Typed | Becomes | When |
| --- | --- | --- |
| `#` to `######` and a space | A heading of that level | On the space |
| `-`, `*` or `+` and a space; `1.` or `1)` and a space | A bulleted or numbered item | On the space |
| `- [ ] ` | A task item | On the space after `]` |
| `>` | A quote | At once |
| Three backticks or tildes | A code block, closed at once, the caret after the opening fence for a language | On the third |
| `---`, `***` or `___`, then Return | A thematic break, and an empty paragraph after it | On Return |
| `\| a \| b \|` and Return | A table's header row, its delimiter row and an empty first row, the caret in its first cell | On Return |

Until it is complete, the line is drawn as body text: today a lone `#` draws a heading 1 and a lone
`-` a bullet, so the line jumps as each character is typed. **Call:** the moment of change is the
space, as in Docs, so a line never changes kind twice while its syntax is typed.

**Call:** the typed table's extra empty first row is there so that the caret has a cell to be in. With
Track Changes on, the delimiter row and the first row join the paragraph's own pending insertion as
text, with no split and no mark of their own (format §3.7: a table can't hold a line that isn't a
row); where the header line is not the person's own pending insertion, Return there is an ordinary
Return, and Paragraph › Table makes a table. With Track Changes off the rows are written as typed.

**Call:** three backticks close the block at once. An open fence runs to the end of the file, over
the ledger, so the format refuses it with Track Changes on ("unclosed-end"), probed.

With Track Changes on, syntax typed into an empty paragraph is part of the paragraph's whole-block
insertion, probed for `## `, `> `, `- `, `1. `, `- [ ] `, `---` and `| a |`. At the start of an
existing paragraph's text, `## ` is written as an insertion today, while `- ` and `> ` are refused ("a
marker would start a line"); Stage 7 writes all of them as the block change the menu makes
("Formatted: Bulleted List"), which is also what a reviewer should read.

**The Paragraph menu on an empty paragraph (#170)** writes the block's syntax there, as typing, the
caret after it: Heading 1–6 `#…# `, Quote `> `, Bulleted List `- `, Numbered List `1. `, Task List
`- [ ] `; Code Block a closed fence with the caret inside; Table the table with the caret in its
first header cell; Horizontal Rule `---` and an empty paragraph after it. Body does nothing. On a
block with text, they change its type as today. Inserted blocks keep a blank line on each side
(#167, E0).

**Call:** an empty heading, item, quote or code block stays when you leave it; an empty paragraph
goes. Markdown renders the first four, and can't hold the last.

## Arrows, clicks, selection and Mac keys

- **← and →** cross a break in one press, bound by the block layer at a block's edges: from the start of a block's text to the end of the text
  above, and back, over a prefix whether it is showing or not. They don't stop in a hidden prefix or blank line.
- **↑ and ↓** move by visual line and keep the column, and never land on a hidden line: the
  prototype moved from a paragraph's first row to the previous paragraph's last row at the same
  column, over the hidden blank line.
- **⌘← and ⌘→** go to the start and end of the visual line; on a block's first row, the start is the
  start of its text, not the hidden prefix.
- **⌥↑ and ⌥↓** go to the start of the paragraph, or of the one before when already there, and to
  the end, or the next one's, as in other Mac apps; with ⇧ they select. **Call:** CodeMirror's
  defaults move the source line up or down, which would move markers and other blocks' syntax.
- **⌥← and ⌥→** move by word, and cross a break as they cross a line break in other Mac apps.
- **Clicks** in the space between blocks: in its upper half they put the caret in the last row of the
  block above, at the click's column; in its lower half, in the block below (prototype). **Call:** the
  spacing is padding on the block below, but in Word and Docs the space after a paragraph belongs
  to that paragraph, and a click just under its last line is the usual way to carry on writing at
  its end. A click on a bullet, number or box shows its source as today. A click below the last
  block puts the caret at the end of its text.
- **A thematic break** is skipped by the caret; Shift-arrows select across it.
- **Triple-click** selects a block's text, not its line break. **Call:** CodeMirror selects the source
  line with its line break, and typing over that would join two blocks.
- **Home and End** scroll on the Mac and don't move the caret (research/editor.md, risk 8); this
  design doesn't change the rest of risk 8.

### Other keys and input that edit line breaks

CodeMirror's Mac defaults stay bound in Clean and Redlines (`editingKeymap`), and each of these edits
line breaks without the block layer (⌃K at a paragraph's end writes one paragraph with Track
Changes off and a join with it on). **Call (Stage 1):** the block layer binds them in Clean and
Redlines, so that none puts the caret on a hidden line or joins blocks silently: ⌃H and ⌃D act as
Backspace and Delete; ⌃K and ⌘⌦ at a block's end act as Delete; ⌘Return acts as Return at the end
of the block (Word's page break has no Markdown form); ⌃O acts as Return with the caret left where
it was; ⇧⌘K and ⌃L act only on the block's text, not its line break; ⌃T does nothing across a break
(it would turn `One.⏎⏎Two.` into one paragraph); ⌃A and ⌃E act as ⌘← and ⌘→. Line breaks also
arrive as input, dictation's "new line" and "new paragraph" among them: a `beforeinput` handler maps
`insertParagraph` to Return and `insertLineBreak` to Shift-Return (on the Mac CodeMirror reads them
from the DOM as typed text), and as a backstop a user edit from anything else that adds or removes
a line break in a hidden run is dropped.

## Checkboxes (#174, #198)

- Drawn as a small SVG box, not a font glyph, 0.8 em square, centred on the x-height, so it is the
  size of the text in every theme and at every text size. Unchecked: a 1.25 px border in the theme's
  third ink, radius 0.18 em. Checked: filled in the second ink, with a check mark drawn in the page's
  color. Hover darkens the border; a keyboard focus ring shows when it has focus. **Call:** grays
  only, as every control; today's box is a font's ✓ in a CSS square, which sits off-centre and
  changes with the theme's font.
- **A box with a pending change** is drawn in its new state in its author's color (border and fill),
  with the line's change bar, instead of showing its source as today.
- **An empty task item** (after Return) is drawn as an empty box at the item's indent, not as `• [ ]`
  at the column's edge (#198). Clicking it says "Write the item first." as today: GitHub renders a
  box with no text after it as the text `[ ]`.
- **A checked item's text is not struck through.** Docs strikes it through unless you pick its other
  checklist style. **Call:** strikethrough means a deletion in Redlines.
- **Paragraph › Check Item (⇧⌘U)** checks or unchecks the task items in the selection; tracked as a
  box change, as a click is. **Call:** a box must change without a mouse, for the keyboard and
  VoiceOver; ⇧⌘U is free in the menus and is the Mac's own Notes shortcut for checking an item.
- The box's source shows while the caret touches the marker, as today; its column doesn't move.

## Track Changes: what the format writes, and what it must learn

### What each key writes

Every row above marked ✓ was probed with `trackedEdit` and `untrackedEdit` at `ad51806`. In short:

- **Return at a block's edge** (end, start, an empty paragraph, the end of a quote, out of a list or
  quote) writes plain line breaks, with no mark: the rendered document doesn't change until text is
  typed (format §3.4, "there are no empty blocks"). Text typed there is a whole-block insertion.
- **Return in the middle of a block, and Return in a list,** write a split (`<split>`), one mark,
  whose break is the blank line and the next block's prefix. A list's new item is a split with the
  bullet. Taking the Return back removes the split and its ledger entry.
- **Shift-Return** writes a split before the hard break's backslash.
- **Backspace at the start of a list item** writes two marks, a deletion of the break and the bullet
  and a split before the hard break's backslash (a substitution in a loose list); the next
  Backspace deletes the hard break, which cancels your split.
- **Joins** write a deletion of the break, with the next block's prefix (`<del ⏎⏎## >`), or the
  deletion of another person's split's break that belongs to it.
- **Unlist, unquote, outdent and indent** write block changes (`was=ul`, `was=quote`, `was=indent=N`),
  or, where the block doesn't stand alone, substitutions of the break and prefix (format §3.4).
- **Keys on your own pending blocks** edit them in place: Tab after Return edits your split's break;
  ⌘2 on a paragraph you typed types `## ` into your insertion (below).

A Return at a block's edge makes no mark, so in Clean it doesn't switch the view to Redlines; a
split does, as today (design §5.3).

### New format rules

1. **Block changes of your own new blocks are edits (#173, #171).** A block change of a block that
   is all your own pending insertion, or an item that your pending split made, writes the new syntax
   into that change as typed text and writes no mark of its own, as inline formats already do (format
   §2.6, "Your own pending changes don't count"): `## ` typed into the insertion, a split's break
   re-indented. Probed: `One.⏎⏎<ins>⏎⏎## Title</ins>`, and `- two<ins><split>⏎  - X</ins>`. Today
   ⌘2 there is refused ("A pending change or a comment starts this block…").
2. **A block right under a heading, a thematic break or a closing fence may change kind.** Today a
   block changes only "with a blank line or the start or end of the file before and after it",
   because Markdown would read it into the block next to it as a lazy line; a heading, a rule and a
   fence take no lazy lines. The rule after the block stays.
3. **Indenting a numbered item renumbers it (#171).** Indenting a numbered item that becomes the
   first of a new sublist writes `1.` and keeps the old marker in the same mark:
   `was=indent=0 was=ol=3.\x20`. Rejecting moves it back and writes `3. `.
4. **The region of a block change is the list CommonMark reads (#172):** a list ends where the next
   item's marker type changes (a bullet character, `.` or `)`), as CommonMark ends it, unless a
   pending change could make the two one list. Today blank lines between a bulleted, a numbered and
   a task list make them one region.
5. **The refusal says how many and where (#172):** "There are 7 pending changes in this list, too
   many to check this change against. Accept or reject some of them first." A box click says "This
   box can't be changed while 7 changes in its list are pending…", not that Track Changes is on.
6. **Marks apart for block changes (#172, Stage 3).** A block change leaves pending the marks of its
   region that no decision can make reach a line's start or a line break: words inserted, deleted or
   replaced inside an item's text, after its first character. It is the block version of format
   §2.6's marks apart, with its own proof; the inline proof doesn't carry over, because a block
   change writes in its own block's lines. Until it lands, a block change in a list with more than
   five other pending changes is refused, in the words above.
7. **A quote's blank lines taken out at once are plain.** Taking out, in one edit, a run of a quote's
   blank lines that reads as one (its markers, spaces and line breaks), where the quote reads the same,
   is plain, as Backspace over them one quote at a time already is (format §3.4). Today one deletion of
   `⏎>⏎> ` is tracked (`> One two.<del ⏎>⏎> >`), probed; the editor's keys use the forms the format
   already reads as plain until this lands, and the record covers the Backspace right after Return.
   The same rule makes leaving a quote in a quote or in a list item plain: probed, leaving a quote in
   an item in one edit leaves a pending deletion of its blank quote lines, which no reader can see.
8. **Enter in a quote that holds code or a line starting with `<` (#130)** must be written, not
   refused: read only the fences and raw blocks still open at the line, and CommonMark's HTML-block
   start rules instead of any `<`. A quote with an autolink is ordinary.
9. **Code edited with Track Changes on (format §3.5, Stage 6).** The format specifies a changed code
   block as a whole-block substitution; the library refuses any edit in code today.
10. **Return next to a hard line break is written (Stage 1).** A hard break (a backslash and a line
   break) is replaced by a paragraph break. Your own pending hard break: its split takes a blank line
   as its break (a soft break would read as one in the newest view). Another person's, or one in the
   original text: a substitution of the break. Today the original's is refused and your pending
   one's is wrong.
11. **A typed backslash is not followed by a closer (Stage 1).** With Track Changes on every typed
   backslash is written `<!--ins X-->\<!--/X-->`, in mid-line too, and `parse` gives no warning, but
   format §3.1 forbids a marker directly after an unescaped backslash: other renderers read `\<` as an
   escaped `<` and show the closer as text. Typing does this today; Shift-Return at a soft break
   would too. A format issue to file, found by the builder check.
12. **Return at the end of an item's last paragraph in numbered steps is written (#204, Stage 1),**
   not refused with "A marker here would start a line." The cause isn't investigated.

### Refusals that remain

These are refused with the format's words, and each is a format issue already open:

- Return or Shift-Return right next to another person's pending line break of one line (#112), and
  in the middle of a block another person's block change is pending on. (A hard break is not one of these: see rule 10.)
- Tab or Shift-Tab in a list with more than five other pending changes that a decision could make
  reach a line's start or a line break, or in a numbered list or beside an open empty item (rule 6
  leaves those marks tried, not apart; a list numbered 1 2 3 has the weaker limit).
- Edits in code and front matter with Track Changes on, until format §3.5 and §3.8's front-matter
  records are built.
- The rare layouts of #102, #107–#110, #119, #120 and #143, which the conformance suite runs (Tests).

## Input methods and accessibility

- **No decoration changes on the composing line.** The empty paragraph is drawn exactly as a body line,
  so the first composed character changes no class. Typed syntax changes a line's kind on the space,
  which input methods don't compose. An empty line's no-break space is replaced when composition
  ends, in the step that makes the composed text a tracked change (`finishComposition`).
- Return that confirms a composition is not a Return: CodeMirror ignores keys while composing, and
  in Safari the Enter whose keydown comes after `compositionend` (`ignoreDuringComposition`).
- The empty paragraph is taken back only after composition ends.
- **VoiceOver** reads blocks in order; hidden blank lines aren't in the DOM. An empty paragraph is
  read as blank. Task boxes keep `role="checkbox"` and `aria-checked`.
- **Keyboard:** every key here, the Paragraph menu and Check Item. Escape then Tab, or ⇧⌥M, leaves
  the document.
- **Reduced motion:** nothing here animates.

## Raw

Raw is the source, unchanged: every line drawn, CodeMirror's and lang-markdown's keys, read-only
while Track Changes is on. Switching to Raw takes back an empty paragraph or line first. Switching
back puts a caret that is on a blank line at the nearest block, as a view switch does today.
**Call:** Raw stays a source editor; it is where the syntax itself is edited, and the one view where
blank lines are text.

## Where Redlines differs from Word and Docs, and why

1. **An empty paragraph exists only while you're in it, and Return in one does nothing.** Markdown
   has no empty paragraph.
2. **Return at the start of a heading leaves an empty body paragraph above it,** not an empty
   heading. A choice (ruled Nov 10): Markdown could hold an empty heading.
3. **No line break in a heading or a table cell.**
4. **Tab anywhere in a list item indents it,** as in Pages; Word types a tab character in mid-text.
5. **Return in a table moves to the cell below,** until #176.
6. **A checked item's text isn't struck through.**
7. **Typed `> ` makes a quote,** which neither has.
8. **List numbers aren't rewritten** in the file; they are drawn as counted, which is what Word and
   Docs show too.
9. **Return over a selection across blocks keeps each block's kind;** in Word both halves take the
   first block's kind once the deletion merges them.
10. **Return at the end of a quote stays in the quote;** Word's Quote style hands the next paragraph
    to Normal.
11. **Return at the end of an item's first paragraph, with a second after it, opens a paragraph in
    the item;** Word makes a new item, which Markdown reads wrongly while it is empty.
12. **Backspace right after Return in a list takes the Return back;** Word's Backspace removes the
    new bullet first. Without a record Backspace follows Word.

## Mechanism

### Modules

| Piece | Where | What |
| --- | --- | --- |
| Block structure | `packages/editor/src/blocks/structure.ts` (new) | The block at a position, read from the syntax tree: its kind, containers (list items with depth, marker and looseness; quotes with depth), text range, prefix, the break before and after (with the hidden markers at their edges), and its neighbours, skipping lines that hold only markers, and which inline constructs are open at a position (lezer's inline tree). Pure functions |
| Keys | `blocks/keys.ts` (new) | Return, Shift-Return, Backspace (and a list item's two-press ladder), Delete, Tab, Shift-Tab, ← and → at block edges, ⌥↑, ⌥↓, ⌘← and ⌘→, Option-Backspace at an edge, the Mac control keys and the `beforeinput` handler of "Other keys", and triple-click. Each computes plain edits, or a block change, and dispatches them with a user event the tracked layer records (`input.break`, `input.break.line`, `delete.backward.block`, `delete.forward.block`, `indent`) |
| The empty block and the record | `blocks/open.ts` (new) | A state field: the empty paragraph or line, the block Return was pressed in, and the record of Returns (each transaction's inverse changes). The filter that takes them back when the caret leaves. `textWithoutOpen(state)` |
| Hidden lines and spacing | `tracked/decorations.ts` and `preview/decorations.ts` | One computation of hidden lines: marker lines (as now), blank lines between blocks, the ledger; the empty block excepted; the spacing class on the first line after each hidden run; the atomic ranges. Today `gaps()` draws blank lines as short lines; it goes |
| Preview | `preview/decorations.ts`, `preview/theme.ts`, `preview/task.ts` | Numbers drawn as counted; a hard break's `\` or spaces hidden and stepped over; a line of bare syntax drawn as body until it is complete; the empty task box; the SVG box; the spacing tokens |
| Editor API | `packages/editor/src/index.ts`, `api.ts` | `getDoc` and `onChange` give `textWithoutOpen`; `reloadDoc` diffs against it; Raw takes the empty block back; the block layer's indent and outdent exported for the formatting plugin |
| Formatting | `plugins/formatting` | The Paragraph menu on an empty paragraph; Indent and Outdent call the block layer; Check Item |
| Format | `packages/format` | Rules 1–12 above |
| Markdown parse | the editor's `markdown()` setup | A small `@lezer/markdown` extension that reads leading front matter as one block, which fixes #154 and replaces the preview's own detection |

### CodeMirror facilities

- **Keys:** a `keymap` at `Prec.highest`, active in Clean and Redlines only (a `Facet` or check of
  `viewModeField`), above lang-markdown's Enter and Backspace, which stay for Raw. CodeMirror's own
  keys run when a block key declines.
- **Hidden lines:** `Decoration.replace({ block: true })` over whole blank lines, from a state field,
  as the tracked layer hides marker lines today, and `EditorView.atomicRanges` over each run with the
  line breaks around it. The prototype confirmed in a browser that vertical motion, ← and →, and clicks
  behave as above with this alone. It also found that the preview's table keys (`renderedTable`)
  take any block decoration for a rendered table and jump onto the hidden line: they must look for
  the table's widget.
- **Spacing:** `Decoration.line` classes with `padding-top` from theme tokens. No margins.
- **The empty block:** a `StateField`, mapped through changes, dropped when a change it didn't make
  touches its line. An `EditorState.transactionFilter` appends, when a transaction moves the selection
  out of it and its block, the inverses from the record as sequential transactions with
  `Transaction.addToHistory.of(false)` and the tracked layer's annotation: CodeMirror's history then
  drops the Returns' events, because their changes map to nothing (`addMappingToBranch`). When the
  record isn't intact, the generic removal goes in as an ordinary transaction, one undo step.
- **The empty line's no-break space:** a transaction filter that, when text is typed, pasted or
  dictated on the line, deletes it in the same transaction; and the composition step.
- **Triple-click:** `EditorView.mouseSelectionStyle`, for three clicks.
- **Focus:** CodeMirror's Escape-then-Tab (`tabFocusMode`) and `toggleTabFocusMode` (⇧⌥M, in the
  default keymap) are kept.
- **History:** Return, Backspace and Tab isolate their events (`isolateHistory`), so each is one undo
  step and typing after them starts a new one.

### Reading the blocks

The block layer reads lezer's tree, which the preview already reads. Where lezer and CommonMark could
differ (a lazy line, a fence whose info string has a backtick, the start of an HTML block, front
matter), the keys check the few lines around the edit with the format's block reading
(`block-read.ts`, exported for this). A conformance test compares lezer's block boundaries with
micromark's on the format's random documents.

### Cost

A key does one block lookup (a walk up the tree from the caret) and one format call, as typing does.
The hidden lines are found in the pass that finds the marker lines today, once per change, in time
linear in the lines, with lookups in sorted spans (#20 asks this of the marker lines already).
Measure Return and Backspace on 16 KB and 150 KB documents with marks against main.

## Changes to design.md and format.md

**design.md:**

- §5.1, "How it works": a bullet, "Blocks are structure: the person writes paragraphs, headings,
  items and quotes, and the editor writes the blank lines Markdown needs between them and never
  shows them (§5.13)."
- New **§5.13 Writing in blocks**: the model in a page: blank lines are the space between blocks;
  Return makes a block, Shift-Return a line break; the empty paragraph exists while you're in it; Backspace
  right after Return takes it back; Backspace and Delete join at edges; Tab indents in lists, and
  numbered sublists start at 1; typed syntax becomes a block on the space; where Redlines departs
  from Word and why (the departures above, shortened).
- §5.3: "Clean and Redlines draw the blank lines between blocks as the space between them, never as
  lines; Raw shows them."
- §5.5: "A Return at a block's edge is no change until something is typed there: a new paragraph is
  an insertion of the whole block. A Return inside a block is a split ('Inserted paragraph break'),
  and Backspace at a block's start a join ('Joined paragraphs')."
- §5.9, the shortcuts: Return and Shift-Return (new paragraph, line break); Tab and Shift-Tab (indent
  and outdent in a list; ⌘] and ⌘[ remain); ⌥↑ and ⌥↓ (by paragraph); ⇧⌘U (Check Item).
- §6.6: "generous, even space between blocks, drawn by their kinds, whatever blank lines the file
  has", and the spacing tokens.
- The welcome document (`apps/desktop/src/sample.md`): "Press Enter twice to start a new paragraph"
  becomes "Press Return to start a new paragraph, and Shift-Return for a line break in one."
- research/editor.md, risks 3 and 4: "answered by §5.13 and this design".

**format.md:**

- §2.6, "Your own pending changes don't count": a block change of a block that is all your own
  insertion, or of an item your split made, is an edit of that change (rule 1).
- §3.1: a typed backslash is never followed directly by a closer (rule 11). §3.4: Return next to a
  hard line break (rule 10). Rule 12 is a fix with no change of the rule.
- §2.6, "Blocks": "with a blank line or the start or end of the file before and after it" becomes
  "…before it a blank line, the start of the file, or a heading, a thematic break or a closing fence,
  which take no lazy lines; and after it…" (rule 2); indenting a numbered item into a new sublist
  writes `1.` and keeps the old marker, `was=indent=N was=ol=SYNTAX` (rule 3); the region is the list
  CommonMark reads (rule 4); the words name the count (rule 5); marks apart for block changes (rule 6,
  its own section after "Marks apart").
- §3.4, "There are no empty blocks": a run of a quote's blank lines taken out at once (rule 7);
  Enter in a quote that holds code or a `<` line (rule 8, #130). One sentence: "The editor types a
  paragraph break as its two line breaks at once; it is read as Enter twice is."
- §3.5: no change of the rule; the library builds it (rule 9).

## Tests

**The conformance suite** is keystroke scripts, in `packages/editor/src/blocks/*.test.ts`, happy-dom,
on the real editor with the formatting plugin, keys through `runScopeHandlers` as the findings'
probes did. Each row of every table above is a script: a document with ‸, the keys, Track Changes on
and off, the author and other authors' marks, and the expected text, caret, newest and original
views, and refusal. Run on every script:

- Return then Backspace gives back the text byte for byte, and the ledger.
- The caret is never in a hidden range; Clean and Redlines draw no blank line between blocks.
- No refusal unless the script expects one, and then the expected words.
- The tracked text passes the format's checks (every order of decisions reads as the views), and no
  marker starts a line.
- `getDoc` never holds an empty paragraph or an empty line's no-break space.
- Return never leaves a delimiter showing in either half, or a literal backslash at a paragraph's end.
- Backspace at a list item's start takes two presses (bullet, then join) and the second gives the
  text of the item above and this one joined; Backspace right after Return takes one.
- Undo after each key gives back the state before it; after leaving an empty paragraph, Undo skips
  the Returns that opened it.

**Random walks**, extending `tracked/typing-random.test.ts` and the format's random suites: the
format's random documents (`random-docs.ts`), keys at random block edges and in random blocks,
typing, Track Changes on and off, two authors, with the invariants above; seeds recorded, longer runs
under `REDLINES_FUZZ`.

**The linked issues as scripts:** #143 (typing on a blank line in a list item), #136 (the two
layouts: the keys never write their plain blank line), #130 (Enter in a quote with an autolink),
#120 (the four edits), #112 (Return next to another's line break: refused, with its words, until the
format changes), #102, #107, #108, #109, #110, #119 (their sequences, made with the new keys where
they can be), #154 (list keys under front matter closed by `...`), #35 (a selection of spaces and
Return: the spaces are replaced), #20 (4,000 own-line markers: the hidden-line pass stays linear),
#198 (the empty task box; the card of a break whose marker is on a hidden line opens from where it is
drawn), #204 (Backspace in an empty nested item at 2 spaces and deeper, Return at the end of an
item's last paragraph in numbered steps, Backspace in front of an item's second paragraph), #161
(the hidden-line scripts run with line break marks hidden and shown), #167 and #153/#205 (as
scripts once they have merged).

**Lezer and micromark** agree on block boundaries on the random documents, or the script records
where the keys defer to the format's reading.

**In WKWebView, by hand at each stage,** until a WebKit runner exists: ↑ and ↓ over hidden lines and
past tables and images; clicks in gaps; Japanese, Chinese and Korean input methods in an empty
paragraph, on an empty line and at the start and end of a block; dictation and press-and-hold
accents there; text replacements; spell check underlines on a new paragraph; VoiceOver reading a
document with empty paragraphs and checked boxes.

**Cost:** Return and Backspace on 16 KB and 150 KB documents with 200 marks, against main.

## Stages

Each stage ships on its own and is worth having. E0's #167 (blank lines kept around inserted blocks,
the typed `>` that disappears, Horizontal Rule under a paragraph, fences around an item's marker) lands
first; Stage 4's Paragraph menu on an empty paragraph waits for it, Stage 1 needs only its caret rule.

| Stage | What | Why here |
| --- | --- | --- |
| **1. Blocks are structure** | Hidden blank lines and spacing by kind; the block structure; Return, Backspace and Delete at block edges for paragraphs, headings, list items and quotes at every depth; the empty paragraph, the record and taking it back, `getDoc` without it; ←, →, ⌘←, ⌘→ and clicks over breaks; numbers drawn as counted, no renumbering; format rule 1 (#173), since every paragraph typed with Track Changes on is your own insertion and ⌘2 on it is the next thing people do; Shift-Return in mid-text (at a block's end it does what Return does until Stage 4), Return in a table's last row and at an HTML block's end, the Mac control keys and `beforeinput`, ← and → over prefixes, the list item's Backspace ladder, Return inside inline syntax and at a hard break, format rules 10, 11 and 12; the front-matter parse (#154); the suite for all of it. Checked in WKWebView before it ships | The model. Hidden lines and the new Return can't ship apart: with lines hidden, today's Return would put the caret on a hidden line |
| **2. Tab and numbered sublists** | Tab and Shift-Tab; format rules 3, 4 and 5; ⌥↑ and ⌥↓; triple-click | Asked for (#171, #172); small once Stage 1's structure exists |
| **3. Marks apart for block changes** | Format rule 6 | Tab and box clicks in a list under review; the riskiest format work, so on its own |
| **4. Line breaks and typed blocks** | Shift-Return and the empty line; hard breaks drawn; typed syntax's moments, the closed fence; the Paragraph menu on an empty paragraph (#170); format rules 2, 7 and 8 | Completes the keys for text blocks |
| **5. Checkboxes** | The box, its pending state, the empty task item (#174, #198), Check Item | Independent; can go any time after E0 |
| **6. Code, tables, front matter** | Their keys; format rule 9 (code with Track Changes on) | Rarer in prose; rule 9 is its own piece of format work |
| **7. Later** | Typed syntax at the start of existing text written as a block change; soft line breaks drawn as spaces, after a prototype on hard-wrapped files with marks | Polish, with its own risks |

## Decisions most worth Stephan's look

1. The empty paragraph exists only while you are in it: leaving it takes the Return back, and the
   file never gets it. It is the largest departure from Word, which keeps empty paragraphs.
2. Return in an empty paragraph does nothing, so Return Return makes no space.
3. A new block gets a blank line on each side even in a file that has none under its headings.
4. (Ruled Nov 10: follows Word.) Backspace at the start of a list item removes the bullet and keeps
   the text in place, a hard line break in a tight list and a second paragraph in a loose one; a
   second Backspace joins it to the item above. A first item goes up a level or out of the list.
5. Tab anywhere in a list item indents it (Pages), not only at the start (Word).

Ruled with it: Return at the start of a heading leaves an empty body paragraph above, not an empty
heading.

Also decided, and worth a glance: no renumbering of later items; Shift-Return writes `\` (and a
no-break space on an empty line until text comes); Return in a table moves down; ⇧⌘U for Check Item.

## Left to the builder

- The exact theme tokens for the spacing and the box, within §6.6.
- The order of edits inside one keystroke, which the format processes last first.
- The code block's indentation unit for Tab (its language's, or what its lines use).
- Whether the block structure reads lezer alone where the conformance test shows it always agrees
  with micromark.
- How the record is kept across view switches between Clean and Redlines (it should survive them).

## Sources

Checked Nov 10, 2026.

- **Word:** merging paragraphs and which formatting wins, Microsoft's knowledge base
  ([Backspace to delete paragraph mark changes formatting](https://techshelps.github.io/MSDN/KB/Source/word/q105776.htm)),
  for Word 6, and for Word 2013 a comparison of its paragraph merges posted to
  [OASIS office-collab](https://lists.oasis-open.org/archives/office-collab/201211/msg00016/MCT_-_paragraph_merges.pdf)
  (the list's server refused it to a fetch; quoted as search indexes give it), which agrees with
  format §3.4's "the merged block keeps the first block's type, as in Word";
  ending a list ("press ENTER twice, or press BACKSPACE"),
  [Microsoft support](https://support.office.com/en-us/article/1f85275b-faa0-4596-b7d6-b07f35012b28),
  and Enter on an empty item below the top level changing its level, a Microsoft MVP in
  [Microsoft Tech Community](https://techcommunity.microsoft.com/discussions/word/word-bullet-points/4009480/replies/4030003);
  Tab and Shift-Tab at the start of an item,
  [BetterSolutions](https://bettersolutions.com/word/bullets/multi-level-bullets-increasing-decreasing.htm).
- **Google Docs:** [Compose with Markdown in Google Docs](https://workspaceupdates.googleblog.com/2022/03/compose-with-markdown-in-google-docs-on.html)
  (conversion on the space; `[] ` for checkboxes); Backspace at the start of a list item,
  [W3C bug 14059](https://www.w3.org/Bugs/Public/show_bug.cgi?id=14059).
- **Pages:** [Format lists](https://support.apple.com/en-au/guide/pages/tan724896ee/mac) ("click
  anywhere in the item" for Tab and Shift-Tab; "press Return twice or press Delete" to end a list).
- **Notes:** [Keyboard shortcuts in Notes on Mac](https://support.apple.com/guide/notes/apd46c25187e/mac)
  (⇧⌘U checks or unchecks a checklist item). Docs' checklist styles, with and without
  strikethrough: [Control Alt Achieve](https://www.controlaltachieve.com/2022/01/docs-checklists.html).
- **CommonMark and micromark:** the renderings quoted above are micromark 4.0.2's.
- **CodeMirror:** `@codemirror/view` 6.43.14 (`moveVertically`, `skipAtoms`, `tabFocusMode`,
  `ignoreDuringComposition`) and `@codemirror/commands` 6.11.1 (`addMappingToBranch`), read in the
  installed packages.
