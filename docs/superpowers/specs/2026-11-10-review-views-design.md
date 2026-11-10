# Reading a review: Simple, one change for a rewrite, and deleted blocks

*Design, Nov 10, 2026, for the epic "reading a review" (#181): a Simple view (#182), deletions in a rewrite (#183) and one change for a rewrite (#184). It builds on [design.md](../../design.md) and [format.md](../../format.md), and says where it departs from them.*

## Why

The epic comes from Stephan's review of build 10: "How changes read when you go through a document under review: a quieter view, deletions that don't drown a rewrite, and changes grouped the way a person thinks of them." Its three issues:

- **#182:** "Between Clean and Redlines, a view that hides deletions and shows insertions without underline or color, with comments still shown, so the text reads as it will once accepted while you can still see where the changes are. Switched with a click in the change-bar margin, as Word's Simple Markup is."
- **#183:** "When much of a paragraph is rewritten, by an agent especially, the deletions shown struck through make it impossible to read what the new text says. Look at how newer versions of Word show deletions, and decide how Redlines should, before implementing anything."
- **#184:** "When an agent rewrites a whole paragraph, the change is recorded and shown as many small insertions and deletions. It may read better as one deletion of the old paragraph and one insertion of the new one. Decide when changes are consolidated, for agents and perhaps for people, and how that fits the format's marks."

**Today.**

- **Three views and nothing between.** `ViewMode` is `'clean' | 'redlines' | 'raw'` (`packages/editor/src/api.ts`), on ⌥⌘1 to ⌥⌘3, which are provisional (design §14, question 6). Clean hides every mark; Redlines draws them all, with change bars 24 px left of the text (`packages/editor/src/tracked/decorations.ts`). The bars can't be clicked.
- **An agent's edit is cut into words.** `str_replace` compares `old_str` with `new_str` piece by piece, a piece being a word, a run of white space or one other character, and any piece the two share ends a change, a single space included (`wordHunks` in `packages/format/src/agent.ts`). Rewriting two sentences of design §8.6 ("Redlines never reads, stores or passes Claude or ChatGPT credentials. Whether someone is signed in…", 36 words) as one new sentence of 34 made **28 marks**: 25 substitutions, 2 insertions and a deletion, each old word struck right in front of its new one. Those marks share a `group`, so the card, the note and the review bar already decide them as one (design §5.6, §5.7): the word marks give a reviewer nothing the app lets them use, and they cost the reading.
- **A deleted paragraph runs into the next one.** Its marker stands on a line of its own, which is hidden, and its text is drawn struck at the start of the paragraph below, its break a space (`hideMarkerLines`; the test "keeps a deleted paragraph apart from the one beside it" pins `Two. Three.` as one line). It reads as the first sentence of the paragraph under it. The old text of a paragraph replaced whole is drawn in the same place, run into the new text.

## In short

- **A rewrite is one change** (#184). An agent's edit is still compared word by word, and then changes close together become one, and a paragraph (a heading, an item, a cell) that keeps fewer than half of its words becomes one substitution of the paragraph: the old paragraph out, the new one in, one Accept. A light edit keeps a mark for each word or phrase it changed. The file format doesn't change: a substitution is a substitution. A person's typing is recorded as it is typed, never joined.
- **Deletions don't drown a rewrite** (#183). Newer Word for Mac moves deletions out of the text into balloons in the margin. Redlines doesn't: its margin is the comments' and notes', and balloons there would crowd out and push away the notes. It answers with the three parts of this design: a rewrite is one struck run and one underlined run instead of a struck word in front of every new one; a deleted or replaced paragraph is drawn as a paragraph of its own, struck, where it was or above its new text; and Simple reads with no deletions at all.
- **Simple** (#182), a fourth view between Clean and Redlines (⌥⌘2; Clean ⌥⌘1, Redlines ⌥⌘3, Raw ⌥⌘4). It shows the newest text as Clean does, with a change bar in its author's color beside every line that has a pending change, and the comments, their tints and the rail as in Redlines. A click on a change bar switches Simple to Redlines and Redlines to Simple, with the line under the pointer where it was. The markup view you chose last, Simple or Redlines, is remembered, and Redlines uses it wherever it picks one for you; at first it is Redlines.

## Goals

1. An agent's rewrite of a paragraph reads, and is decided, as one change: the old paragraph and the new one.
2. A light edit still shows each word or phrase that changed.
3. A view in which the text reads as accepted, with change bars and comments, and a click on a bar that switches to all the markup and back.
4. A deleted paragraph reads as a deleted paragraph.
5. No agent edit that works today is refused or written differently, and a keystroke costs what it costs on main.

## Non-goals

- **Deletions in balloons in the margin,** newer Word for Mac's default. See "How deletions read".
- **Joining a person's changes.** Simplify markup (format §3.6), which collapses marks already written, stays a command for later.
- **Splitting a joined change back into words.**
- **Drawing the formatting of struck text** (bold, a link's text) instead of its Markdown characters, which is what deleted text shows today.
- **The previews** of the original and of one person's changes (design §5.3), **Compare** (§5.6) and **outside changes as tracked changes** (§7.3). None is built. When they are, the last two work their changes out with the rule of Part 1.
- **Deleted table rows and columns,** which this version doesn't draw.
- **Windows and Linux keys** for the views: the Mac comes first, and Ctrl+Alt is AltGr on European keyboards.

## Anti-goals

These would make it a failure even if it technically works:

- **An agent's edit refused, or written other than it asked,** that works today.
- **Another person's words credited to an agent:** a join that takes in someone else's pending text, or a comment's anchor, and writes it again as the agent's.
- **A change hidden without a trace.** Simple hides how a line changed, never that it did.
- **A click in the margin that moves the text under the pointer,** or the caret or the selection.
- **Deciding blind:** the review bar stepping through changes that the page doesn't show.
- **New chrome:** a toolbar, a mode switch, a badge, a second margin.
- **Slower typing.**

## Constraints

- **The format's rulings.** Every allowed edit reads the same in every decision order, judged exactly, with micromark 4.0.2 as the oracle. Redlines refuses rather than repairs, but ordinary typing refused is a failure, and so is an agent's edit that works today. `docs/format.md` is the source of truth for `packages/format`: the joining rule goes into it (format §3.11, new), and the file format itself doesn't change.
- **A keystroke costs what it does on main.** The tracked layer's `analyze` runs on every change of the text; Simple and Part 3 add a condition or two per mark to it, and nothing per keystroke elsewhere. The joining rule runs only on an agent's edit.
- **The platform.** Tauri v2 on macOS, WKWebView, CodeMirror 6. The views are the core's (`@redlines/editor`, design §6.4), and so are the change bars and their click; the rail, cards and review bar are `@redlines/review`'s; menus, icons and settings are `apps/desktop`'s.
- **Color means a person** (design §6.6). Bars keep their author's color, gray for several people.
- **Accessibility.** A view switch is a menu item and a key, so nobody needs the bar to switch. The bar's target is 24 px wide. Struck text keeps the author colors' 4.5:1 contrast: it isn't faded. VoiceOver reads the View menu's check marks.
- **Per-person state stays out of the file** (format §5.6): the view, and the markup view remembered, live in the app's settings.

## Decided by Stephan

- A Simple Markup view between Clean and Redlines: deletions hidden, insertions without underline or color, comments still shown.
- It is switched with a click in the change-bar margin, as in Word.
- How deletions show in a rewrite is decided from what newer Word does, before anything is built.
- An agent's rewrite of a paragraph may read better as one deletion and one insertion; when changes are consolidated, for agents and maybe people, is to be decided within the format's marks.

Everything else below is my call, marked **Call:** with its reason.

## How Word, Google Docs and Pages do it

- **Word, Display for Review:** Simple Markup, All Markup, No Markup and Original, set for the application, not the document. Simple Markup shows the text with changes incorporated and a red line in the margin beside each changed line; a click on the line (a double-click in some versions) switches to All Markup, where the line is gray, and back. The line gives no sign under the pointer. Comments stay in the margin. Word for the web calls it "Markup in margin (Simple Markup)".
- **Word, deletions:** newer Word for Mac shows a deletion in a balloon in the right margin, not struck in the text, and keeps insertions inline; Balloons › Show All Revisions Inline strikes deletions through in the text again. Its advanced options can also mark a deletion as hidden, a caret or a #.
- **Word, typing over a selection** with Track Changes on: one deletion of what was selected and one insertion of what was typed.
- **Word, Copilot** (April 2026): its tracked changes are word-level by design, and Microsoft's sample prompt asks Copilot not to rewrite whole sentences unless it must. Word keeps the marks fine and asks the agent to edit less; a reader of that post reports whole paragraphs deleted and rewritten anyway.
- **Google Docs:** suggestions inline, the old text struck and the new in the suggester's color, with a card such as "Replace: … with …". Tools › Review suggested edits previews Accept all or Reject all. There is no view with bars.
- **Pages:** Markup, Markup Without Deletions and Final, and change bars in the margin while tracking is on.

Redlines copies Word's Simple Markup and its click, Pages' bars in every markup view, Word's inline strikethrough for a small deletion, and Word's typing over a selection for an agent's rewrite. It doesn't copy the balloons.

## How deletions read (#183)

**The decision.** A deletion is hard to read in a rewrite for two reasons, and each has its own answer:

1. **It is interleaved.** Today a rewrite strikes one old word in front of each new one. Part 1 records a rewrite as one change, so its old text is one struck run and its new text one underlined run, and a paragraph mostly rewritten is the old paragraph replaced by the new.
2. **It is in the way.** Even one struck run sits in the line the eye follows. Part 3 draws the old text of a paragraph replaced whole on its own line, above the new text, and a deleted paragraph as a paragraph of its own where it was; Simple (Part 2) hides deletions for reading.

**Call:** no balloons in the margin, because the rail is the margin: it holds the comments and the agents' notes level with their anchors, and a rewrite's deletions would fill it, push the notes away from what they are about, and turn to dots in a window under about 1,000 px. Word itself makes the inline display a choice, and its own Copilot leans on fine inline marks. Simple gives what the balloons give, the text without deletions, without taking the margin.

**Call:** a short deletion stays struck where it was, inline, as Word's Show All Revisions Inline and Google Docs show it, because a struck word right before its replacement is the plainest way to show a small edit.

**Call:** struck text keeps its full contrast, and isn't hidden behind a caret or a # as Word's options allow, because a reviewer must be able to read what they are about to accept away, and a caret hides it behind a hover.

## Part 1: one change for a rewrite (#184)

### The rule

An agent's `str_replace` (design §8.3), from the toolbox and from `redlines str-replace`, is compared as today: piece by piece, a piece being a word (a run of letters, digits, combining marks and `_`), a run of white space or one other character; the pieces that agree at both ends are left out, and the rest is matched as the longest run of pieces the two texts share. That leaves changes, each a stretch of the old text and the new text that takes its place. Then:

1. **Changes close together are one.** Two changes in one block, with unchanged text between them, become one change when that text has no more words than either change has (a change counts the words it takes out or the words it puts in, whichever are more), when that text is plain (below), and when neither change reaches into a line's prefix (indentation, `>`, a bullet or a number, a box, a heading's `#`s). The unchanged text then belongs to both the old and the new text of the change. This repeats until no two changes can be joined.
2. **A block rewritten is replaced whole.** When fewer than half of a block's words are left unchanged, counted in the block as it was and as it becomes alike, no marker stands anywhere in the block's text, its unchanged text is plain and no change reaches into a prefix, its changes become one substitution of all its text, from after its prefix to its end. A block is a paragraph (also one in a list item or a quote), a heading or a table cell.
3. **As asked, or word by word.** The joined changes are written only when the newest text then reads as the agent asked, compared as decisions are (format §2.6, `paragraphBreaks`), and the original text is as it was, byte for byte. Otherwise the changes are written as the comparison found them, as today; when that is refused too, the refusal is the agent's error, as today.

**Plain** text:

- has no marker in it, a comment's and a highlight's included;
- ends no block: it has no blank line, and a line break in it only wraps its paragraph, the next line having nothing in front of its text but indentation (none at the top level, the item's in a list item), so never a list marker, a quote marker, a heading, a fence or a table row;
- holds none of `` * _ ` ~ [ ] ( ) < > # | \ ! = ^ { } $ & @ ``.

So the line breaks of a wrapped paragraph don't keep two changes apart.

**Call:** an agent's edit is recorded as a person's is when they select text and type over it, one change, wherever the word marks would interleave, because `str_replace` *is* "this text, replaced by that", Word records typing over a selection as one deletion and one insertion, and the reader sees a rewrite as one act. The word-by-word comparison stays, so a light edit keeps its precise marks.

**Call:** the join takes no more unchanged words than either change has, because that is the rule that makes a comparison read as a person would mark it: "fox" between "quick brown → fast red" and "jumps → leaps" goes in, and the ten words between two one-word fixes keep them apart. It needs no tuning: a word between two changes of one word is joined, two words aren't.

**Call:** a block is replaced whole when fewer than half of its words survive, before and after alike, because a paragraph that keeps most of its words reads better word by word, one that keeps few reads better as two paragraphs, and "before and after alike" keeps a deleted sentence a deletion and an added sentence an insertion (the block then keeps all its words on one side).

**Call:** a join never crosses into another block, a line's prefix, Markdown syntax or any marker, because each block is read and decided on its own; a join over another person's pending words would write them again as the agent's (the views would match, and the authorship would be wrong, which no check of the text catches); a joined change that starts in a line's prefix (a list number, `#`s) would leave the prefix as it was (format §3.4), not as the agent asked; and syntax inside joined text is where placement refusals come from.

**Call:** the joined form is kept only when it writes exactly what the agent asked, and otherwise the edit is written as today, because then no edit that works today can be refused or come out differently. In the prototype it also lets through edits that today's form refuses (Measured).

**Call:** the rule lives in `@redlines/format` (`agent.ts`), so that the toolbox, the command line and the skill route all write the same, and Compare and outside changes take it when they are built. It goes into format.md as §3.11, because format.md is the source of truth for `packages/format`, even though a reader of the file needs to know nothing about it.

### Examples

From paragraphs of design.md and rewrites of the kind an agent makes when asked (prototype, Measured):

| Edit | Marks today | With the rule |
| --- | --- | --- |
| "in March" → "in April" | 1 | 1, the same |
| A light copy edit: "user", "like a finished document" → "finished" | 3 | 2 |
| Tightening a sentence, keeping its middle | 6 | 2 |
| Rewriting the two sentences of design §8.6 into one | 28 | 1: the paragraph replaced |
| Rewriting most of a bulleted item that starts with bold | 9 | 4 |
| Two one-word fixes far apart | 2 | 2, the same |
| A sentence deleted, or one added | 1 | 1, the same |

The file, for "The importer reads every file in the folder and writes one record for each line it finds there." rewritten as "The importer reads each file once and writes a record per line.":

```markdown
The importer reads <!--sub k3x9 every-->each<!--/k3x9--> file <!--sub p7qd in the folder-->once<!--/p7qd--> and writes <!--sub w8nn one-->a<!--/w8nn--> record <!--sub b4rt for each-->per<!--/b4rt--> line<!--del m2bd  it finds there-->.
```

That is today's file: five marks in one group. With the rule, three of its 18 words survive ("The importer reads"), so the paragraph is replaced whole:

```markdown
<!--sub k3x9 The importer reads every file in the folder and writes one record for each line it finds there.-->

The importer reads each file once and writes a record per line.<!--/k3x9-->
```

### What the file gets

Fewer and longer marks of the kinds it has now: a substitution, with the old text as its payload and the new text between its markers, at the places format §3 gives them. A substitution of a block's whole text puts its opener where any mark that starts a block puts it (format §3.3): on a line of its own before a paragraph, after a list item's bullet with the text on the next line, after a heading's `#`s, after a quote's `> `. One entry in the ledger instead of one per word, with the agent's `note`; a `group` only when the edit still makes several marks (several blocks, or changes kept apart). Rejecting gives back every byte; accepting leaves the new text. Word export (format §10) writes each substitution as one `w:del` and one `w:ins` (format §10), so Word shows a rewritten paragraph as the old paragraph deleted and the new one inserted, as #184 asks. The review view agents read shows `{~~old paragraph~>new paragraph~~}[k3x9 claude-ada]`.

### How it shows and decides

- **Redlines:** the old text struck and the new underlined, in the agent's color, as one run each; for a paragraph replaced whole, the old text on its own line above the new (Part 3). One card, "Replaced “…” with “…”", each text quoted to 40 characters as cards quote today.
- **Simple:** the new text, plain, with the agent's bar; the agent's note in the rail.
- **Clean:** the new text. **Raw:** the markers above.
- **Deciding:** one mark, so one Accept and one Reject on the card, the note and the review bar, one Undo step; "Change 3 of 17" counts it once. An edit that spans several blocks makes a mark per block in one group, decided as one suggestion as today.

**Call:** a joined change can't be accepted in part, because the app already decides an agent's edit as one suggestion, so the word marks bought that only for the command line; to keep part of a rewrite, accept it and edit, or reject it and ask again. Design §8.3's "Marks are word by word, so a reviewer can accept part of a rewrite" is replaced.

### People

**Call:** a person's edits are recorded as they are made, and never joined, because each is a deliberate act that Word, Google Docs and Pages record as made too; joining while someone types would merge and move marks under their caret; and a person who rewrites a paragraph selects it and types, which is one substitution already. The marks a person makes one word at a time read word by word in Redlines and as plain text in Simple.

### Agents and the command line

- The toolbox's `str_replace` description says: "Replace text in this document with a tracked change in your name. old_str must match the newest text exactly once. Only the words that differ are recorded; changes close together are one, and a paragraph mostly rewritten is replaced whole." Its result line stays ("Suggested 1 change: k3x9").
- `integrations/claude-code/SKILL.md` says the same of `redlines str-replace`.
- The system prompt doesn't change: an agent that wants a fine edit makes a small one.
- Agents edit as suggestions whatever their person's Track Changes (design §8.6), so the rule applies to all their edits. When Auto is built (design §8.2), its edits make no marks, and its Review overlay, a redline worked out from the text before the run, takes the same rule.

### Edge cases

- **Several blocks in one edit.** Each block is judged by itself: one rewritten, one lightly edited, one untouched. Their marks share a group.
- **A paragraph split or two joined by the edit.** A change that adds or takes away a block break is never part of a join across that break, and the blocks on either side are never replaced whole; they are compared as today.
- **Another person's pending change in the paragraph.** The join stops at its markers on either side, and the paragraph is never replaced whole, so their words stay theirs. Between their marks, changes still join.
- **The agent's own pending change there.** The same: no join over it, and an edit inside it changes it in place, as today ("Changed in place").
- **A comment on the whole paragraph,** as an @mention asking for the rewrite often is: its opener stands on its own line before the paragraph and its closer at the end, outside the paragraph's text, so the paragraph is replaced whole inside the comment's range, and the thread stays on it. A comment on part of the paragraph stops joins at its markers.
- **A list item, a quote, a heading, a table cell:** as a paragraph, inside its prefix. A cell is replaced inside its pipes.
- **A wrapped paragraph** (a line break every 80 or 100 columns): changes join across its line breaks; the new text's line breaks are written as the format writes typed line breaks.
- **A number or a bullet changed by the edit:** that change is never joined (it is in a prefix), and is written as today.
- **Very long texts:** today a comparison of more than 4,000,000 pairs of pieces is one change from the first difference to the last (`MOST_PAIRS`), and it stays so.

## Part 2: Simple (#182)

### The four views

**Call:** Simple is a fourth view, not a mode of Redlines, because Word and Pages list it beside the others, the View menu then says exactly what the page shows, and it gets a key of its own. **Call:** it is named Simple, Word's Simple Markup in one word like its neighbors.

| | Clean | Simple | Redlines | Raw |
| --- | --- | --- | --- | --- |
| Inserted text | Plain | Plain | Underlined, in its author's color | Source |
| Deleted text | Hidden | Hidden | Struck, in its author's color (Part 3) | In its marker |
| Format change | Plain | Plain | Dotted underline | Source |
| Inserted or deleted line break | Nothing | Nothing | A ¶ when line break marks are shown | Source |
| Change bars | None | Beside every changed line | Beside every changed line | None |
| Comment anchors, highlights | Untinted | Tinted | Tinted | Markers |
| Point comments | Nothing | Their pin | Their pin | Markers |
| The rail | Hidden | Shown | Shown | Hidden |
| Ordinary HTML comments | Hidden | Hidden | Small dimmed notes | Source |
| Hover cards on changes | None | None | Yes | None |
| Editing | Yes | Yes | Yes | With Track Changes off only |

- **Call:** the bars keep their author's color in Simple, not Word's one red, because color means a person, and in Simple the bar is the only sign of who changed the line.
- **Call:** comments, highlights and the rail show in Simple, the agents' notes on their changes among them, because #182 keeps comments, an agent's note is its comment on its change (Word's Simple Markup keeps its comments in the margin), and the column then doesn't move when Simple and Redlines switch.
- **Call:** ordinary HTML comments and line break marks are hidden in Simple, as in Clean, because Simple reads as the result.

### Keys and menus

| View | Key | View menu | Eye menu |
| --- | --- | --- | --- |
| Clean | ⌥⌘1 | Clean | A page of text |
| Simple | ⌥⌘2 | Simple | A page with a change bar (today's Redlines icon) |
| Redlines | ⌥⌘3 | Redlines | Simple's, with one mark of markup on it |
| Raw | ⌥⌘4 | Raw | Angle brackets |

The View menu and the title bar's eye list the four in this order, as radio items with a check mark. **Call:** the keys follow the menu's order, Redlines moving from ⌥⌘2 to ⌥⌘3 and Raw from ⌥⌘3 to ⌥⌘4, because they were provisional (design §14, question 6) and numbers in menu order are learned at a glance. **Call:** no item in Preferences: the View menu is where the choice is made, and it is remembered (below), as Word remembers Display for Review.

### A click in the margin

- **Where.** Beside any line that has a change bar, in Simple and in Redlines: a target 24 px wide, centered on the bar, the full height of the bar, which is the line's, wrapped lines included. A struck block of Part 3 has its own bar, which works the same. Clean and Raw have no bars, and a click in their margin does what it does today.
- **What.** A press and release there that moves less than 4 px switches Simple to Redlines, or Redlines to Simple. The press doesn't start a selection and the release doesn't move the caret, the selection or the keyboard focus. A press that moves farther does nothing. A press with ⌘, ⌥, ⇧ or ⌃ isn't the bar's: it does what a press in the margin does today. The second click of a double-click does nothing, so a double-click, which Word takes in some versions, switches once.
- **The line stays where it was.** After the switch, the line under the pointer has the same height on the screen, to the pixel, though the lines above it grew or shrank; a line that the new view doesn't draw (a struck block, in Simple) gives its place to the line after it.
- **Under the pointer.** The pointer is a hand, the bar draws 3 px wide instead of 2, and after the usual hover delay a hint in the interface's hint style names what a click does and its key: "Show Redlines ⌥⌘3" in Simple, "Show Simple ⌥⌘2" in Redlines. **Call:** the hint names the result of the click, because the bar has no label, and every control without one is explained on hover (design §5.1).
- **For VoiceOver and the keyboard,** the bar is decoration: the View menu and the keys do the same thing.

**Call:** a click switches the whole view, as Word's does and as #182 asks, not just the changes of that line. **Call:** the target is 24 px wide and shows the hand and the wider bar, because a 2 px line can't be aimed at, 24 px is WCAG 2.2's least target, and Word's line gives no sign at all. **Call:** a press there never selects, and a moved press does nothing, so that a switch can't be half a selection and a drag never switches.

### Which markup view, when

Simple and Redlines are the markup views. **Call:** Redlines remembers the one you chose last, in the app's settings, and uses it wherever it picks a markup view for you, because Word keeps Display for Review per application and a reader who prefers Simple shouldn't choose it for every document. **Call:** at first it is Redlines, because then nothing changes for anyone who never picks Simple.

| What happens | Today | With this design |
| --- | --- | --- |
| A document with redlines opens | Redlines | The markup view |
| A document without redlines opens | Clean | Clean |
| A document shown Clean gains redlines (an agent's suggestions arrive) | Redlines | The markup view |
| A tracked change made in Clean | Redlines | The markup view |
| A comment added in Clean; drafts coming back to a document shown Clean | Redlines | The markup view |
| The review bar opens, or moves to a change, from Clean, Simple or Raw | Redlines | Redlines |
| The View menu, the eye, ⌥⌘1 to ⌥⌘4 | That view | That view; Simple or Redlines becomes the markup view |
| A click on a change bar | — | Simple ⇄ Redlines; that becomes the markup view |
| The last change decided | The view stays | The view stays |

The setting reaches every window, for the documents each opens next and for its own switches; it never changes the view a window shows. **Call:** because a window's view is what its person is looking at, and only a choice made in it changes it. In an embedded editor, the host gives it (`EditorOptions.markupView`, default `'redlines'`) and is told when the person chooses (`EditorUiState.markupView`).

### Editing and Track Changes in Simple

- **The caret and the keys** behave as in Clean: the caret steps over hidden markers and deleted text, and Backspace and Delete act on what shows, never on a marker.
- **Track Changes on:** typed text is a tracked insertion, drawn plain, and its line gets your bar; a deletion makes the text go, and the bar stays. **Call:** a tracked change made in Simple stays in Simple, unlike one made in Clean, because the bar shows it, and Word's Simple Markup behaves so too. Deleting your own pending insertion removes it, and its bar with it.
- **Track Changes off:** edits are plain, as in Clean, and make no bar.
- **Raw** stays read-only while Track Changes is on, as today.

### The rail, cards and the review bar in Simple

- **The rail** is as in Redlines: threads, the notes of noted suggestions, drafts, resolved threads by the setting, dots in a narrow window. Selecting a suggestion's note tints its changed text, as it does in Redlines, which in Simple is how its new words show.
- **Cards.** **Call:** none appears on hover in Simple, and a click on the text pins none, because the text reads as accepted, and a card over plain-looking words would surprise; the bar, the note and the review bar are the ways in. A note's Accept and Reject decide as in Redlines.
- **The review bar** switches to Redlines when it opens or moves, from Simple as from Clean and Raw (today's `opening` in `plugins/review/src/bar.ts`, unchanged). **Call:** because the bar is for deciding change by change, and in Simple a deletion is invisible: nothing is decided blind. Closing the bar leaves Redlines. **Call:** closing it leaves the view as it is, as it does today, because the person may still be reading the changes. A click on a change bar while the review bar is open switches to Simple, and the review bar's next move switches back.

### What the file gets

Nothing. The view and the markup view are the person's, kept in the app's settings and never in the file (format §5.6): opening a document in Simple, a switch, or a click on a bar changes no byte.

### Printing, Copy and Copy for Word

- **Print** prints the view as it shows, without the rail, in light ink, as today (design §5.1). **Call:** Simple prints the newest text with its change bars, as a revised SOP marks its revised lines, so Simple is the way to print a clean copy that still says what changed. A printed page drops backgrounds, and the bars are a background today, so in print they are drawn as a left border, which prints; this also makes Redlines' bars print. Comments don't print in any view, as today.
- **Copy and Copy for Word** give the newest text in Simple, as in Clean and Redlines, and the source in Raw (design §5.10). **Call:** because a copy never carries markup (design §5.10), and Simple is a way of reading, not a third kind of text.
- **Find** searches the newest text in every view, as today.

### Edge cases

- **A document with comments and no changes:** Simple and Redlines look the same.
- **A deletion alone on a line:** the bar marks the line where the text was. A paragraph deleted whole: the bar marks the first line of the block after it, or the last line of the block before it at the end of the document.
- **A comment on deleted text** ("On deleted text"): its note sits at its point, as in Redlines.
- **An image in a pending insertion** shows its alt text until the insertion is accepted, in Simple as in every view (design §8.6): Simple isn't acceptance.
- **A move:** a bar at both ends. **A format change, a block change, a checked box:** a bar.
- **Tables:** the newest text in the cells, and the row's bar, as the table widget draws them through the tracked layer (`trackedText`).
- **A narrow window:** the rail shrinks to dots in Simple as in Redlines; the bars stay.
- **Live sessions,** later: the view is each person's, as today.

## Part 3: deleted and replaced blocks (#183)

### What is drawn as a block

In Redlines:

1. **A whole-block deletion** (format §3.4): each block it deleted is drawn where it was, as a block of its own, its text struck in its author's color, with the change bar beside it. Several blocks deleted together are drawn as several blocks.
2. **A substitution of a block's whole text** (as Part 1 writes for a rewritten paragraph, and as typing over a whole paragraph writes): its old text is drawn struck and ends its own line, and the new text, underlined, starts on the line below, in the same block. A rewritten paragraph reads as the old paragraph above the new one, a rewritten heading as the old heading above the new, at the heading's size, an item as its old text above its new text, beside one bullet.
3. **Everything else stays as today:** words deleted inside a block are struck where they were, a substitution's old text is struck right in front of its new text, and a deletion that runs from the middle of one block into another (a join) is struck inline with a space, or a ¶ when line break marks are shown, for each break.

**Call:** deleted blocks are drawn as blocks where they were, because a deleted paragraph drawn at the start of the next one reads as that paragraph's first sentence, and Word draws a deleted paragraph as a paragraph, struck. **Call:** a block's replaced text goes above its new text in the same block, not as a block of its own, because the block wasn't deleted (its type, its place in a list and its comments stay) and the two then read as before and after of one thing.

### How it looks

- **The block's look:** a paragraph in body text; a heading at its level's size and weight; a list item with its bullet or number, at its indentation; a quote with its bar; any other block (code, a table, HTML, math, a rule) as its source in the body font. The type comes from the deleted text's own prefix (`## `, `- `, `1. `, `> `), which a whole-block deletion keeps in its payload (format §3.4). **Call:** a deleted block looks like what it was, not like the block after it, because a deleted heading must read as a heading and not as the paragraph under it.
- **Its text** is drawn as deleted text is today: its Markdown characters, line breaks inside it as spaces, or, with Preferences › Editor › Show line break marks, a struck ¶ at the end of each deleted block.
- **The space around it** is the block's own, as for any block, so the page reads as if the block were still there, struck.

### The caret, the pointer and cards

- **The caret** steps over a struck block, as over deleted text: ↑ and ↓ go past it, ← and → never enter it, Backspace at the start of the block below acts on that block as it does today.
- **Hovering** over the struck text opens its card after the usual delay, placed above or below the struck block so that it covers neither it nor the new text. **A click** on it pins the card, as on struck text today.
- **Its bar** is a change bar like any (Part 2): a click there switches to Simple, where the struck block isn't drawn, and the block below keeps the place.

### Views and Track Changes

Only Redlines draws struck blocks. Simple and Clean show the newest text, and Raw the source. Track Changes doesn't change the drawing; with Track Changes off, deleting a struck block's surrounding text follows format §3.10, as today. The file is as it was: this is how Redlines draws it.

### Edge cases

- **A deleted list item between two others** (`- one`, `- <!--del k3x9 two\n- -->`, `  three`): a struck item "two" with its bullet, between "one" and "three".
- **The last block deleted** (its marker after the block above, its payload starting with the break): a struck block after the block above.
- **A comment on a deleted block:** its note stays level with the struck block; once the deletion is accepted, it is a point comment "On deleted text" (format §4), as today.
- **A deleted table:** a block of its source, struck, until tables draw their deletions (design §5.8).
- **Someone else's change inside a deleted block** (format §3.4, "other people's segments between its first and last segments belong to the deleted block"): drawn as part of the struck block, each part in its author's color.

## Mechanism

### Part 1: joining (`packages/format`)

- **`agent.ts`.** `wordHunks` stays the comparison. A new `joinedHunks(view, start, before, after, parsed)` turns its operations into runs (unchanged or changed, with their pieces), joins runs by rule 1, and widens by rule 2. Its idea of plain text maps a stretch of the newest view to the source with `view.map.toSource` and looks for markers in `parsed.marks` (every segment's opener, carrier and closer), and for prefixes with the line-prefix pattern `track.ts` already has (`LINE_PREFIX`). A block's text and bounds come from the newest view's lines, with `prefixLength`, `lineStart`, `lineEnd` and `blockEdges` (`blocks.ts`).
- **`suggestReplace`** first writes the joined changes with `trackedEdits`, then checks that the newest view of the result reads as the asked text with `paragraphBreaks` (exported from `edit-support.ts`), and that its original view is the original's byte for byte; on an `EditError` or a mismatch it writes the changes of `wordHunks`, as today. `suggestReplaceAsOne` doesn't change: it gives a group when there are several marks.
- **Cost.** An agent's edit costs one more `trackedEdits` only when the joined form is refused, and two views more for the check: milliseconds in the app, and some tens of them in the `redlines` program's QuickJS (where a `view` of a 68 KB document with 77 marks took about 30 ms, v0.2 design), against a model's turn of seconds. Typing never runs it.
- **`packages/agent-tools/src/tools.ts`:** the description. **`integrations/claude-code/SKILL.md`:** the sentence on `str-replace`. **`apps/desktop/redlines`:** nothing but a new bundle (`scripts/build-redlines`).

### Part 2: Simple

- **`packages/editor/src/api.ts`:** `ViewMode` gains `'simple'`; `type MarkupView = 'simple' | 'redlines'`; `EditorOptions.markupView`; `EditorUiState.markupView`; `setViewMode` documents that choosing Simple or Redlines makes it the markup view.
- **`packages/editor/src/tracked/field.ts`:** a `markupViewFacet`; `viewModeField.create` starts a document with redlines in the markup view, and a document shown Clean that gains redlines switches to the markup view.
- **`packages/editor/src/index.ts`:** a `markupViewCompartment`, as `lineBreakMarksCompartment` is, so the choice holds for the documents opened later (`setDoc`); `setViewMode` reconfigures it for Simple and Redlines; `uiFor` reports it. Reporting already follows a change of view.
- **`packages/editor/src/tracked/decorations.ts`:** `analyze` draws Simple as Redlines with every change's look turned off: deleted text and splits become parts with no class (`className: ''`, `change: true`), which take a bar and draw nothing, the kind the layer already has for a break while marks are hidden; insertions and format changes become layers that only count for bars and add no mark decoration; comments, highlights and pins as in Redlines; ordinary comments hidden as in Clean. `bars()` doesn't change. The view's class is `rl-view-simple`. The caret's atoms are then those of Clean.
- **A new `packages/editor/src/tracked/bar-switch.ts`:** a `ViewPlugin` with `mousedown`, `mousemove` and `mouseleave` handlers on `view.scrollDOM`, so that presses in the margin outside `.cm-content` reach it. The hit test takes the line at the pointer's height (`view.posAtCoords` at the content's left edge, then the line's element) and checks for `rl-bar`; the struck blocks of Part 3 carry it too. The hovered line gets the class `rl-bar-hot` through a decoration from the plugin (CodeMirror redraws line elements, so a class set by hand would go), and the hint is a CodeMirror tooltip at the line, styled as the review bar's hints. On a release within 4 px it notes the line's distance from the scroller's top, dispatches the new view through `setViewModeEffect` and the markup view, and puts the line back in a `requestMeasure` (read the new distance, write `scrollTop`). The core owns it, because the views and the bars are the core's, so an embedded editor has it with no plugin.
- **Automatic switches** take the markup view instead of `'redlines'`: `trackedSpec` and composition in `packages/editor/src/tracked/typing.ts`, `plugins/formatting/src/index.ts`, and the two in `plugins/review/src/rail.ts` (`startComment` and `giveBack`), which today switch any view but Redlines and must switch Clean only. The review bar's `opening` keeps `'redlines'`.
- **`plugins/review`:** the rail shows in Simple and Redlines (`sync`, `shown`); cards stay Redlines-only, as `redlines(view)` already makes them.
- **`apps/desktop`:** four rows in `menu-model.ts` (⌥⌘1 to ⌥⌘4) and four items in `ui/titlebar.ts`; a `simple` icon (today's `redlines`) and a new `redlines` icon in `ui/icons.ts`; `markupView` in `settings.ts`, kept like `showResolved`, passed to each editor and saved when `EditorUiState.markupView` changes; in `styles.css`'s print rules, `.rl-bar::before` drawn as a 2 px left border in its color (`--rl-mixed` for several people).

### Part 3: blocks

- **`packages/format`:** `deletedBlocks(segment)`, the blocks a whole-block deletion's payload holds, each with its kind (paragraph, heading level, item with its marker, quote, other) and its text, or null when the payload isn't whole blocks (format §3.4's forms: a payload that ends with the break at the start of the block after it, or starts with one at the end of the text). The reading of payloads stays in the format library.
- **`decorations.ts`:** `hideMarkerLines` replaces the hidden lines of such a deletion with a block widget (`Decoration.replace({ block: true, widget })`) that draws its blocks, instead of moving its text to the start of the block below; at the end of the text, `Decoration.widget({ block: true, side: 1 })` after the line above. The tracked field is a `StateField`, which block decorations need, as hidden lines already do. A substitution whose segment runs from the start of its block's text to its end marks its deleted part `whole`, and `MarkupWidget` draws it followed by a line break element, so that the new text starts on the next line; the builder picks the element (a `<br>`, or an inline block as wide as the line) by what keeps CodeMirror's measuring right in a list item's hanging line. Each widget carries `data-mark` with its mark's id, its bar's classes, and the line classes the preview gives that kind of block (`rl-h2`, `rl-quote`, a list item's indentation).
- **`plugins/review/src/cards.ts`:** a struck block finds its change by its `data-mark`, not by matching its text; its card is placed against the widget's box.

### What a keystroke costs

Simple adds to `analyze` one comparison per mark and no new work: it draws less than Redlines. Part 3 adds, per deletion that stands on a hidden line, a look at its payload's end, which `analyze` reads already. The margin plugin does nothing on a keystroke. The long-document test (`packages/editor/src/preview/long-document.test.ts`) runs in Simple too, and holds the same bound as in Redlines.

### Modules that change

| Module | Part | Change |
| --- | --- | --- |
| `packages/format/src/agent.ts` | 1 | Joining, whole blocks, the check and the fallback |
| `packages/format/src/edit-support.ts` | 1 | Export `paragraphBreaks` |
| `packages/format/src/blocks.ts` or a new module | 3 | `deletedBlocks` |
| `packages/agent-tools/src/tools.ts` | 1 | `str_replace`'s description |
| `integrations/claude-code/SKILL.md` | 1 | The `str-replace` sentence |
| `packages/editor/src/api.ts` | 2 | `'simple'`, `MarkupView`, the option and the state |
| `packages/editor/src/index.ts` | 2 | The markup view's compartment and report |
| `packages/editor/src/tracked/field.ts` | 2 | `markupViewFacet`; the view field |
| `packages/editor/src/tracked/decorations.ts` | 2, 3 | Simple's drawing; struck blocks; the hot bar's style |
| `packages/editor/src/tracked/bar-switch.ts` (new) | 2 | The click in the margin |
| `packages/editor/src/tracked/typing.ts` | 2 | Switch to the markup view |
| `plugins/formatting/src/index.ts` | 2 | Switch to the markup view |
| `plugins/review/src/rail.ts` | 2 | The rail in Simple; switch to the markup view |
| `plugins/review/src/cards.ts` | 3 | Cards on struck blocks |
| `apps/desktop/src/menu-model.ts`, `ui/titlebar.ts`, `ui/icons.ts` | 2 | Four views, keys, icons |
| `apps/desktop/src/settings.ts`, `main.ts` | 2 | The markup view kept and passed |
| `apps/desktop/src/styles.css` | 2 | Bars that print |

## Measured

A throwaway in the scratch folder, on the tree of Nov 10 (`4de60b1`): the joining rule written against the real `@redlines/format` (`trackedEdits`, the views, `accept`, `reject`), and not in the repo.

- **Real paragraphs,** the table of Examples above: 28 marks become 1 for a rewritten paragraph, 6 become 2 and 9 become 4 for edits that keep part of a paragraph, and light edits keep their marks.
- **Random edits:** 4,000 seeded documents from `randomDocument` (every kind of mark, other people's among them, front matter, lists, quotes, constructs), each with a random stretch of a line of its newest text rewritten at a random density, 1,660 edits in all. Today's form wrote 1,351 of them and refused the rest. With the rule, 1,432 were written, every one that today's form writes among them; each newest view read exactly as asked, each original view was the original's byte for byte, rejecting everything gave the original back, and for each of the 1,419 edits with at most four new marks, every order of deciding them, with the other marks left pending, gave one text per set of decisions. The edits both forms wrote made 2,148 marks today and 1,673 with the rule. Random words at random densities understate the gain on prose: the real paragraphs show it.
- **The fallback** wasn't needed once with the rule as written here, and 329 of the edits both forms wrote got fewer marks. It was needed before the guards below were in.
- **What found the guards:** with no guard for prefixes, three edits that changed a list number had it joined with the words after it and came out with the number unchanged, which the exact check catches and today's form writes right; with no guard for markers, replacing a paragraph whole over another person's insertion deleted their words and wrote them again as the agent's, with the same views, which only the marker rule prevents.

## Changes to design.md and format.md

**format.md:**

- **§3.11 Changes from a new text** (new, after §3.10): the rule of Part 1 as written there, the plain text, and these sentences: "The marks of one such edit share a `group` when there are several (§5.4). Nothing that was recorded is collapsed: this is how one edit is first written, as typing over a selection writes one substitution; Simplify markup (§3.6) is the command that collapses marks already written. A person's typing is recorded as it is typed and is never joined."
- **§3.6, Simplify markup:** one sentence pointing at §3.11 for an agent's edit.

**design.md:**

- **§5.3,** renamed "Views: Clean, Simple, Redlines, Raw": "**Simple** (⌥⌘2): the same text as Clean, with a change bar beside each line that has a pending change, in its author's color, and the comments with their notes: deletions are hidden, and inserted and reformatted text is plain (Word's Simple Markup). A click on a change bar switches to Redlines, and in Redlines back to Simple, with the line where it was." The keys of the others (⌥⌘1, ⌥⌘3, ⌥⌘4). "Simple and Redlines are the markup views, and Redlines remembers the one you chose last, Redlines at first. A document with redlines opens in it, … Making a tracked change in Clean, or adding a comment there, switches to it …; so does a document shown Clean that gains redlines. Reviewing switches to Redlines, where each change shows." "The View menu always offers the same four views."
- **§5.1,** the File menu: "Printing holds the whole document in light ink and prints the view as it shows, without the rail: Simple prints the newest text with its change bars."
- **§5.5,** change bars: "In Simple and Redlines a click on a bar switches between them; the bar widens under the pointer, and its hint names the view a click gives." New bullet: "**Deleted blocks show as blocks.** A paragraph, heading, item or quote deleted whole is drawn where it was, struck through, with its look. A block whose whole text was replaced, as an agent's rewritten paragraph is, shows its old text struck on its own line above the new. Words deleted inside a block are struck where they were."
- **§5.6,** the review bar: "Opening it switches to Redlines from Clean, Simple and Raw, so that each change shows while you decide it."
- **§5.7:** "The rail shows in the Simple and Redlines views. Adding a comment in Clean switches to your markup view"; drafts coming back the same.
- **§5.9,** the table: a row "Clean, Simple, Redlines, Raw | ⌥⌘1, ⌥⌘2, ⌥⌘3, ⌥⌘4 | not chosen yet".
- **§5.10:** "Clean, Simple and Redlines copy the newest text."
- **§6.3 and §6.4:** "the Clean, Simple, Redlines and Raw views".
- **§8.3,** the `str_replace` row: "`old_str` must match the newest view exactly once. The library compares it with `new_str` word by word: words changed close together are one change, and a paragraph mostly rewritten is replaced whole ([format §3.11])". The bullet "Marks are word by word, so a reviewer can accept part of a rewrite." becomes: "A rewrite reads as one change: a paragraph that keeps fewer than half of its words is the old paragraph replaced by the new, decided with one Accept, and a light edit keeps a mark for each word or phrase it changed."
- **§14, question 6:** "Shortcuts for the views: ⌥⌘1 to ⌥⌘4, in the menu's order. Word for Mac gives ⌥⌘1 to ⌥⌘3 to headings, which Redlines puts on ⌘1 to ⌘6; kept unless the clash proves real."

## Tests

**Part 1** (`packages/format/src/agent.test.ts`, and a random test beside it):

1. The examples above, each as a file: today's word marks where they stay (a word, two far fixes, a sentence deleted or added), one substitution where changes close together join, a paragraph, a heading, an item, a quote and a cell replaced whole, with the forms of format §3.3. Each new file is checked with `expectInOrder` (canonical ledger, no nested insertions, no problems) and `expectEveryDecision` against the file before the edit; accepting gives the asked text, rejecting the original bytes.
2. Never across blocks: two items, two paragraphs, a heading and its paragraph, two cells. Never into a prefix: an edit that changes a list number. Never over a marker: another person's insertion and deletion in the stretch (their marks keep their ids, kinds and text), the agent's own pending change, a comment on part of the paragraph. A comment on the whole paragraph: one substitution inside its range, the thread still on it. Never over syntax: bold, a link, code.
3. The fallback: an edit whose joined form is refused, or reads otherwise, written as today; and one that today's form refuses and the rule writes.
4. The tests that pin word marks today ("marks each changed word, so that a reviewer can accept part of a rewrite", "keeps punctuation, line breaks and words apart") keep their purpose with edits whose changes stand far apart.
5. **The random test,** with `fuzzCount`: seeded `randomDocument`s, random stretches of their newest text rewritten at random densities. For each: when today's form writes it, so does the rule; the newest view reads as asked, by `paragraphBreaks`, and the original is byte for byte the same; `expectEveryDecision` against the document before the edit, with the edit's marks as the fresh ones, and `expectEveryOrderAlike` with micromark's leaves, where the file has few enough marks to walk (their `limit`), so every order of deciding reads the same; and every mark another person had before the edit has its id, kind, author and text after it.
6. `packages/agent-tools/src/tools.test.ts`: a rewritten paragraph is "Suggested 1 change: …". `apps/desktop/redlines/tests/commands.rs`: `redlines str-replace` on a rewritten paragraph, through the real program, prints one change.

**Part 2:**

1. `packages/editor/src/tracked/tracked.test.ts`: Simple draws no `.rl-ins`, `.rl-del`, `.rl-fmt`, `.rl-split` or `.rl-comment`; it draws `.rl-cmt` tints and `.rl-cmt-point` pins, and the same bar classes on the same lines as Redlines, for every kind of change, tables included; its visible text and its atoms are Clean's.
2. The view field: a document with redlines opens in the markup view; one shown Clean that gains redlines, a tracked edit in Clean, a format change in Clean, a comment in Clean and drafts coming back switch to it; a tracked edit in Simple stays in Simple; `setDoc` keeps the markup view; choosing Simple or Redlines sets it, and the review bar doesn't.
3. `bar-switch.test.ts` (happy-dom): a press and release on a bar's target switches Simple to Redlines and back; the line under the pointer keeps its top within a pixel; the selection, the caret and the focus stay; a press that moves 5 px, a press with a modifier, a press beside a line with no bar, and any press in Clean or Raw switch nothing; a double-click switches once; the hot class and the hint come and go with the pointer.
4. `plugins/review`: the rail shows in Simple (`rail.test.ts`); no card on hover or click in Simple (`cards.test.ts`); the review bar opened in Simple switches to Redlines (`bar.test.ts`).
5. `apps/desktop`: four views on ⌥⌘1 to ⌥⌘4 in the View menu and the eye (`menu-model.test.ts`, `titlebar.test.ts`); the markup view's default and how it is kept (`settings.test.ts`); the print rules draw bars as borders (`styles.node.test.ts`).
6. The long-document test in Simple.

**Part 3:**

1. `tracked.test.ts`: the test "keeps a deleted paragraph apart from the one beside it" becomes: the deleted paragraph is a block of its own, struck, and the next paragraph's line holds only its own text; at the end of the document, after the block above. A deleted heading has its level's class, a deleted item its bullet, a deleted quote its bar; several blocks deleted are several; a deletion across blocks stays inline. A substitution of a block's whole text draws its old text ending its line and its new text on the next, in the same line element; one of part of a block stays inline. With line break marks shown, each deleted block ends with a struck ¶.
2. The caret steps over struck blocks with ←, →, ↑ and ↓, and Backspace at the start of the block below acts as today.
3. `cards.test.ts`: hovering over a struck block opens its change's card, found by `data-mark`; a click pins it.
4. Simple and Clean draw no struck block.

## Stages

Each stage is one PR, ships on its own and is worth having without the others.

| Stage | Work | Worth having alone because |
| --- | --- | --- |
| **1. One change for a rewrite** (#184) | Part 1 in `@redlines/format`; the tool's description and the skill; format §3.11, design §8.3 | An agent's rewrite reads as one change in Redlines, in Word export and in the review view agents read, and is one entry in the ledger |
| **2. Simple** (#182) | Part 2: the view, its drawing, the click in the margin, the markup view kept, the rail, the menus and keys, print; design §5.1, §5.3, §5.5 to §5.7, §5.9, §5.10, §6.3, §6.4, §14 | A reading view for any review, whoever made the changes |
| **3. Deleted and replaced blocks** (#183) | Part 3: struck blocks, cards on them; design §5.5 | A deleted paragraph reads as one, and a rewritten paragraph from Stage 1 as the old above the new |

**Call:** one change for a rewrite comes first, because it is the smallest, all in one package, and takes most of #183's pain away by itself. Stages 1 and 2 touch different packages and can be built side by side. Stage 3 comes after Stage 1, whose whole-text substitutions it draws best; without it, it still draws the paragraphs people deleted, or replaced by typing over them.

**To try by hand in a build:** the click on a bar, with a trackpad and a mouse, near and away from the text; reading a long agent rewrite in Simple, then in Redlines; printing a document in Simple.

## Calls most worth Stephan's look

1. **An agent's rewrite is recorded as one change:** changes close together joined, and a block that keeps fewer than half of its words replaced whole, so a rewrite can no longer be accepted word by word (design §8.3's promise goes).
2. **People's edits are never joined:** they are recorded as typed, as in Word, Google Docs and Pages.
3. **No deletion balloons in the margin,** newer Word for Mac's default: #183 is answered by one change for a rewrite, struck blocks, and Simple.
4. **Simple is a fourth view, and the view keys are renumbered in menu order** (Redlines moves to ⌥⌘3, Raw to ⌥⌘4); a click on a bar switches Simple and Redlines both ways.
5. **The markup view you chose last is remembered** and used wherever Redlines picks one, so a document with redlines can open in Simple; and Simple keeps the rail, shows no hover cards, and hands the review bar to Redlines.

## Left to the builder

The Redlines icon once Simple takes today's, within the icon rules (a line icon on the 16 × 16 grid that reads at 16 px). The exact element that ends a replaced block's old line (Part 3). The hint's delay, which is the title bar's. Whether `deletedBlocks` lives in `blocks.ts` or a module of its own.

## Sources

Checked Nov 10, 2026.

- **Word:** [Track changes in Word](https://support.microsoft.com/en-us/office/track-changes-in-word-197ba630-0f5f-4a8e-9a77-3712475e806a) (the four markup views, balloons); [WdDeletedTextMark enumeration](https://learn.microsoft.com/en-us/office/vba/api/word.wddeletedtextmark) (deletions hidden, a caret, a #); [Simple Markup view in Word for the web](https://techcommunity.microsoft.com/blog/microsoft365insiderblog/simple-markup-view-in-word-for-the-web/4214635); [Markup View quick switch in Word 2013](https://office-watch.com/2013/markup-view-quick-switch-in-word-2013/) (the line's click, red and gray); [Delete in track changes does not show-up as strikethrough in Word for Mac v.16.109.2](https://learn.microsoft.com/answers/a/12807386) (deletions in balloons, Show All Revisions Inline); [Copilot in Word: new capabilities for document workflows](https://techcommunity.microsoft.com/blog/microsoft365copilotblog/copilot-in-word-new-capabilities-for-document-workflows/4508974) (word-level tracked changes, April 2026)
- **Google Docs:** [Suggest edits in Google Docs](https://support.google.com/docs/answer/6033474?hl=en) (Review suggested edits, previews)
- **Pages:** [Track changes in Pages on Mac](https://support.apple.com/guide/pages/tan2685b84ff) (Markup, Markup Without Deletions, Final; change bars)
