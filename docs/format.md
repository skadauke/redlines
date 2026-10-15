# The Redlines format

Status: draft for review, format version 1. Nothing is implemented yet.

This document specifies how Redlines stores tracked changes, comments and history in a Markdown
file. The editor and the tools around the format are described in [design.md](design.md). The
tests behind the rules are in [research](research/README.md).

## 1. Overview

### 1.1 Requirements

A Redlines file:

1. is an ordinary Markdown file (`.md`, `.qmd` or `.Rmd`) that renders as its newest version in
   any renderer that hides HTML comments, including GitHub, VS Code, pandoc, R Markdown, Quarto,
   Hugo and Docusaurus 3;
2. records every change and comment with its author and time, as Word does;
3. merges in git: when two branches edit different text, the only conflicts are in the ledger,
   and keeping both sides always resolves them;
4. keeps working when other tools touch it: formatters, other editors, knitr and pandoc;
5. keeps everything in the one file, with no sidecar files and no database;
6. can keep its own full history, so any earlier version can be rebuilt without git;
7. reads the same in JavaScript, Python and R.

A raw file with pending changes is not meant to be pleasant to read. The rendered document comes
first; pending changes are read in Redlines, in the views of §8, or through the pandoc filter (§11).

### 1.2 Example

An insertion by Ada, a substitution by Claude working for Ada, and a deletion and a comment by Bo:

```markdown
# Launch plan

We will ship the <!--ins k3x9-->new <!--/k3x9-->importer in <!--sub p7qd March-->April<!--/p7qd-->, after the <!--cmt c8d2-->security review<!--/c8d2-->.<!--del w2rf  The old exporter stays as it is.-->

<!-- redlines
# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.
version: 1
people:
  ada: {name: Ada Lovelace, email: ada@example.org}
  bo: {name: Bo Chen, email: bo@example.org}
  claude-ada: {name: Claude, agent: true, for: ada}
marks:
  k3x9: {by: ada, at: 2026-10-13T22:30Z}
  p7qd: {by: claude-ada, at: 2026-10-13T22:31Z, note: Matches the roadmap}
  w2rf: {by: bo, at: 2026-10-13T22:35Z}
comments:
  c8d2:
    by: bo
    at: 2026-10-13T22:40Z
    text: |-
      Who signs off on the security review?
-->
```

GitHub renders it as:

> # Launch plan
>
> We will ship the new importer in April, after the security review.

Redlines shows "new" underlined in Ada's color, "March" struck through before "April", the
deleted sentence struck through in Bo's color, and Bo's comment in the margin.

### 1.3 Structure

A file has up to three parts, in this order:

1. **The body:** the document's Markdown, with the newest text and the marks (§2–§4).
2. **History blocks,** one HTML comment per save, only when the file keeps full history (§6).
3. **The ledger:** one HTML comment at the end of the file holding a YAML mapping with people,
   each mark's author and time, comment threads and settings (§5).

A file with no pending changes, comments or settings has no ledger. It is plain Markdown.

### 1.4 Why HTML comments

Every Markdown renderer hides HTML comments, and they pass through formatters, knitr and pandoc's
Markdown reader unchanged. Inline syntaxes such as CriticMarkup (`{++new++}`) show their
delimiters wherever they aren't supported, and carry no author or time. The costs are a noisier
raw file, and pending deletions that are invisible to someone reading the rendered file outside
Redlines.

## 2. Marks

### 2.1 Syntax

A mark is one or more HTML comments in the body. An opening marker names the kind and the id. Marks
that cover text end with a closing marker that names the id.

```text
<!--KIND ID-->text<!--/ID-->
<!--KIND ID PAYLOAD-->text<!--/ID-->
<!--KIND ID PAYLOAD-->
```

- Fields are separated by one space. The payload is everything after the space that follows the
  id, up to `-->`. It may be empty.
- A closing marker carries only the id. Ids are unique in a document, so ranges can overlap
  (§3.6).
- A mark's author and time are in its ledger entry (§2.4), which keeps markers short.

```abnf
opener   = "<!--" kind SP id [SP payload] "-->"
closer   = "<!--/" id "-->"
kind     = "ins" / "del" / "sub" / "fmt" / "hl" / "cmt" / "split"
id       = id-first 3id-rest
id-first = "b" / "c" / "d" / "f" / "g" / "h" / "j" / "k" / "m" / "n"
         / "p" / "q" / "r" / "s" / "t" / "v" / "w" / "x" / "z"
id-rest  = id-first / "2" / "3" / "4" / "5" / "6" / "7" / "8" / "9"
payload  = *CHAR   ; any character but a line break, encoded as in 2.5
```

An HTML comment that matches this grammar is a Redlines marker, except a `cmt` anchor whose thread
isn't in the ledger, which is ordinary content. Every other HTML comment, such as `<!-- TODO -->`,
is ordinary content. Ids start with a letter and have no vowels, so ordinary comments don't match
by accident.

### 2.2 Kinds

| Kind          | Form                                       | Records                                    | Renders as |
| ------------- | ------------------------------------------ | ------------------------------------------ | ---------- |
| Insertion     | `<!--ins k3x9-->new text<!--/k3x9-->`      | Added text                                 | new text   |
| Deletion      | `<!--del w2rf old text-->`                 | Removed text, kept in the payload          | nothing    |
| Substitution  | `<!--sub p7qd old-->new<!--/p7qd-->`       | Replaced text; the payload is the old text | new        |
| Format change | `<!--fmt m2bd +bold-->**word**<!--/m2bd-->` | Changed formatting, same words (§2.6)     | **word**   |
| Highlight     | `<!--hl h4kz-->text<!--/h4kz-->`           | A reviewer's highlight                     | text       |
| Comment       | `<!--cmt c8d2-->text<!--/c8d2-->`          | The text a comment thread is about (§4)    | text       |
| Point comment | `<!--cmt c9qf-->`                          | A comment on a point                       | nothing    |
| Split         | `<!--split s3vb-->`                        | An inserted block break (§3.4)             | a break    |
| Row, column   | `<!--ins k3x9 row-->`, `<!--ins k3x9 col-->` | An inserted table row or column (§3.7)   | nothing    |

- A substitution is one mark, accepted or rejected as a whole. Word export writes it as a
  deletion and an insertion with the same author and time.
- Joining two blocks deletes the break between them (§3.4). There is no separate kind for it.
- A highlight is a review annotation, hidden outside Redlines like every mark. Highlighting as
  part of the content (`==text==`, `<mark>`) is formatting, and adding it is a format change
  (`+mark`).

### 2.3 Ids

- An id is four characters. The first is one of `bcdfghjkmnpqrstvwxz`, the other three one of
  `bcdfghjkmnpqrstvwxz23456789`, which gives 373,977 ids. Without vowels, ids never spell words.
  Without `0`, `1`, `l` and `o`, they can't be misread. No YAML parser reads any of them as a
  number, boolean, date or null; all of them were checked.
- The client that creates a mark, comment, reply or group draws its id from a cryptographic
  random source, and draws again while the id is used anywhere in the document.
- Ids never change and are never reused. The exception is a duplicate, which a concurrent edit, a
  merge without the merge driver or a paste can create: the earlier mark keeps the id and the
  later one gets a new one.
- In a live session, an id may change until the server confirms the edit, and never after that.
- People don't see ids. The editor numbers changes in document order ("Change 3 of 17"), as
  Word's Reviewing pane does. Ids appear only in the raw view, the inspector and the agent API.

Sequential numbers would be shorter, but they collide whenever two people work in parallel. In
simulated live sessions, 14–30% of new sequential ids were already taken by another client, and
every pair of parallel git branches collides. Repairing a collision means renaming, which breaks
references held by agents, chat transcripts and other tools, and GitHub's merge button never runs
code that could rename. Random ids collided in 1 of 935 merges of two 20-mark branches, a case the
merge driver repairs. Word itself renumbers its revision ids on every save and keeps durable
random ids only for comments ([research](research/ids-and-ledger.md)).

### 2.4 Authors and times

Each mark's author and time are in the ledger, one line per mark, such as
`k3x9: {by: ada, at: 2026-10-13T22:30Z}` (§5.4).

- **The handle** names the author. It uses lowercase letters, digits, `-` and `_`, and starts with
  a letter. It is never `y`, `n`, `yes`, `no`, `on`, `off`, `true`, `false` or `null`, which YAML
  1.1 readers turn into booleans. The ledger's `people` maps it to a name and email (§5.3).
- **An agent** gets one handle per person it acts for: `claude-ada` is Claude working for Ada.
- **`unknown`** is reserved for an author nobody recorded: Word's "Unknown", someone who edited the
  file outside Redlines, or a mark whose ledger entry is missing.
- **The time** is UTC, to the minute: `2026-10-13T22:30Z`. Every YAML parser tested reads this
  form as a string; with seconds added, four of six turn it into a date.

Keeping the author and time in the ledger keeps markers short. The cost is more merge conflicts in
the ledger, and keeping both sides resolves every one of them (§7).

### 2.5 Payload encoding

Payloads hold deleted or replaced text and format operations. A payload must not end its comment
early, must stay on one line, and must not let other tools act on what it contains.

| Text                                                                         | Written as                       | Why                                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| a line break                                                                 | `\n`; a blank line is `\n\n`     | A multi-line payload leaks into the rendered page on GitHub and in VS Code when one of its lines starts with block syntax |
| a `-` that follows a `-`                                                     | `\-` (`---` is written `-\-\-`)  | So `--`, and with it `-->`, never appears                                                                          |
| a `-` that is the payload's last character                                   | `\x2d` (`a--` is written `a-\x2d`) | GitHub and VS Code reject comment text that ends in `-`                                                          |
| a backtick                                                                   | `\x60`                           | knitr runs R code it finds in comments, deleted text included                                                      |
| `\|`                                                                         | `\|`                             | An unescaped pipe splits a table cell, even inside a comment, and kramdown reads any line with one as a table row |
| `{{` and `{%`                                                                | `{\{` and `{\%`                  | Liquid (Jekyll, GitHub Pages) runs them                                                                            |
| a `\` before `-`, `n`, `x`, `\|`, `{`, `%`, `\`, a backtick or a line break  | `\\`                             | Keeps every escape unambiguous                                                                                     |

- A reader decodes left to right, after turning CRLF and CR into LF. The escapes are `\\`, `\n`,
  `\-`, `\xHH`, `\|`, `\{` and `\%`. Any other backslash is literal, so Markdown escapes such as
  `\*` are kept as written.
- All 271,452 non-empty strings of up to five characters over a 12-character alphabet of the
  characters above round-trip.
- The ledger uses the same escapes, except that a value may span lines (§5.5).

### 2.6 Format changes

A format change records formatting that changed while the words stayed the same. It is a kind of
its own for two reasons. Word records formatting changes as old and new properties ("Formatted:
Bold"), not as deleted and inserted text. And rejecting one must undo only the formatting, even
when other people's changes sit inside the range.

A change is a format change when the plain text of the range is identical before and after. If
the words change too, it is a substitution.

The payload is a list of operations separated by spaces. Each says what changed, and rejecting
applies its inverse:

| Operation                  | Meaning                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `+bold`, `-bold`           | Strong emphasis added or removed. Also `italic`, `strike`, `code`, `mark`, `sub`, `sup`, `underline` |
| `+link`, `-link=URL`       | Link added; link removed, with its old target                                                 |
| `link=URL`                 | Link target changed; `URL` is the old target                                                  |
| `+html=TAG`, `-html=TAG`   | Inline HTML element added or removed. `-html` records the whole original tag, attributes included |
| `@NAME=OLD`, `@NAME`       | An HTML or pandoc attribute changed (`OLD` is its old value), or added (it was absent)        |
| `+check`, `-check`         | A task checkbox checked or unchecked, as a point change at the end of the item's first line   |
| `was=TYPE`                 | Block type changed; `TYPE` is the old type                                                    |
| `align=SPEC`               | Table column alignment changed; `SPEC` is the old delimiter row                               |

- Block types: `p`, `h1`–`h6`, `ul`, `ol`, `task`, `quote`, `indent=N`, `callout-TYPE`, and
  `md-image`, which restores Markdown image syntax when an image resize is rejected.
- Values are escaped as payloads, and a space inside a value is written `\x20`.
- The serializer writes formatting in the file's dialect: `<sub>` in `.md`, `~x~` in pandoc files
  (§9.1).
- An inline format change stays inside one block. A block format change opens on its own line
  before the block (§3.3) and closes at the end of the block.

```markdown
Plain text, then <!--fmt m2bd +bold-->**newly bold**<!--/m2bd--> text.
See the <!--fmt n8fx link=https://old.example-->[guide](https://new.example)<!--/n8fx-->.

<!--fmt q2hw was=p-->

## This paragraph became a heading<!--/q2hw-->
```

- Rewriting `*` as `_`, or any other rewrite that renders the same, is not a change. The
  serializer never makes one.
- A format change also covers deleted text inside its range, as in Word. Rejecting the deletion
  brings the text back with the new formatting.
- Accepting or rejecting must not leave `_` emphasis attached to a letter or digit, which renders
  literally (`re_built_`). If it would, the `_` is rewritten as `*`.
- Accepting all changes re-serializes the document. Stripping markers instead would, for example,
  turn two bold runs separated by deleted text into `****`.

## 3. Where markers go

Markers sit in Markdown that other programs parse, so they may only go where no renderer changes
how it reads the line. The rules below were checked on 72 cases. All render identically on
GitHub, cmark-gfm, markdown-it (VS Code), micromark, commonmark.js and pandoc, with two
exceptions: pandoc's GFM reader doesn't detect one form of task-list item, and one GitHub alert
form renders as an alert only on GitHub ([research](research/renderers.md)).

### 3.1 Inside a line

Inside a line, a marker sits only at a text boundary: between two characters of ordinary text, or
at the outer edge of a whole inline construct. A marker never goes:

1. inside a code span, autolink, bare URL, `www.` or email link, entity, backslash escape,
   footnote reference, emoji shortcode, math, inline HTML tag, task checkbox, list marker or
   heading `#` sequence;
2. inside a link destination, title or reference label, between `]` and `(`, or inside the text of
   a collapsed or shortcut reference link (`[text]`, `[text][]`). The text of an inline link is
   fine;
3. directly before `www.`;
4. directly after an unescaped backslash. Visible text that ends in a backslash is written `\\`;
5. where it would change how an emphasis delimiter flanks: on the inner side of `**`, `*` or `~~`
   only when the run's outer neighbor is a space, punctuation or a line edge, and never next to a
   `_` whose other neighbor is a letter or digit;
6. between a hard break's trailing spaces or backslash and the line end. It goes before them;
7. on a line that is only syntax (thematic break, setext underline, table delimiter row, fence,
   front-matter delimiter), or after an ATX heading's closing `#`s;
8. inside an image, in its alt text or source. A changed image is a substitution of the whole
   image. In pandoc files, a figure caption may hold inline marks;
9. inside pandoc's `~x~` or `^x^`; after or inside `{…}` attributes; on `:::` lines; before or
   inside `[!TYPE]`; on a link reference definition line; right after `[^n]: `; between a letter
   and an emoji shortcode; or inside `{{< >}}`, `@fig-x` or `(\#fig:x)`.

### 3.2 Line starts

No line of a paragraph, heading, list item, block quote, footnote, table row or HTML-block
paragraph begins with a marker after its container prefix (indentation, `>`, list bullet,
checkbox) and up to three spaces. This includes continuation and lazy lines. In CommonMark, a line
that starts with `<!--` starts an HTML block: the rest of the line renders as raw text, and in the
middle of a paragraph it splits the paragraph.

- The serializer never breaks a line in front of a marker. It keeps the marker at the end of the
  previous line.
- A table row that holds a marker is written with a leading `|`.

### 3.3 Marks that start or end a block

A mark that starts at the beginning of a block puts its opener alone on the line before the
block. The opener then means that the mark starts at the block's first character. The line holds
only the container prefix: nothing at top level, `> ` in a block quote, the content indentation
in a list item, and never an indented code block's four spaces.

```markdown
<!--del t6wv Note: -->

The importer ships in April.

- one
- <!--ins k3x9-->
  two<!--/k3x9-->
```

- At top level, a blank line follows the opener. In a tight list none does, because a blank line
  would make the list loose.
- For a list item's first block, the opener follows the bullet, and the content starts on the next
  line at the item's content column.
- In a GitHub alert, the opener is appended to the `[!NOTE]` line. A mark at the start of the
  alert's body uses a blank `>` line after `[!TYPE]`.
- An image alone in its paragraph gets own-line markers with blank lines around them. Any marker
  inside that paragraph stops pandoc from making the image a figure.
- An own-line marker never sits between two lines of one paragraph, heading or table, between
  setext text and its underline, on a blank line inside a list, between list items at less than
  their content indentation, or before front matter.
- Nothing follows `-->` on a marker line. A block's leading spaces go after an own-line marker,
  never before it.

A mark that ends at the end of a block closes at the end of the block's last text line: before an
ATX heading's closing `#`s or its `{#id}`, and on a setext heading's text line, not its
underline. After fenced code, a thematic break or an HTML block, the closer goes on the following
line. After a table, it goes after one blank line.

### 3.4 Block breaks, splits and joins

A block break (the blank line and prefix between two blocks) is text, and a deletion may contain
it. It is written as `\n\n` followed by the next block's prefix (`## `, `- `, `> `).

**A deletion across blocks** is one mark in the merged block. Deleting from the middle of one
paragraph, across a heading, to the middle of a third paragraph:

```markdown
Alpha one <!--del k3x9 two three.\n\n## Middle heading\n\nGamma four -->five six.
```

The merged block keeps the first block's type, as in Word. Rejecting puts the exact bytes back.

**A join** is a deletion of the break and the second block's prefix:
`Para<!--del j7mm \n\n## -->Heading text`.

**An inserted break** is a `split` point marker at the end of the first block. Rejecting it
removes the break and the next block's prefix. An inserted hard line break is a `split` before the
break syntax; a deleted hard break is a deletion whose payload is the break.

```markdown
The first half.<!--split s3vb-->

The second half.
```

**Whole-block deletion** uses the same mechanism: a deletion at the start of the following block,
with a payload that ends in `\n\n`. At the end of the document, it is a deletion at the end of the
previous block, with a payload that starts with `\n\n`. A join and a deletion inside a block can
look alike, so:

- the deletion's first own-line segment opens the block (only other whole-block deletions come
  before it) and never starts with `\n\n`; a payload of just `\n\n` in that place is a join;
- its last segment ends with `\n\n`;
- other people's segments between its first and last segments belong to the deleted block;
- an empty segment (`<!--del ID -->`) stands for a paragraph's empty prefix;
- a payload directly after a deleted break starts with the next block's prefix.

**Whole-block insertion** puts the opener on its own line before the first new block (§3.3) and
the closer at the end of the last one. Every inserted break inside it is a `split` with the
insertion's id; the opener never implies a break. Otherwise a block whose remaining text is all
someone's insertion would read like a whole-block insertion, and rejecting it would remove a
block that existed before.

```markdown
<!--ins v2pc-->

A new paragraph.<!--split v2pc-->

## A new heading<!--/v2pc-->
```

**There are no empty blocks.** Markdown can't store an empty paragraph, which Word can.

- A split that would leave an empty block isn't written until that block has content.
- Deleting all of a block's text deletes the block together with one adjacent break.
- A block whose only content is pending marks may have no visible text for a while. When its last
  mark is decided and nothing is left, the block goes with its break. If that break is someone
  else's pending split, the split goes too.

**Interactions:**

- Accepting a whole-block deletion also accepts the other deletions inside that block.
- Rejecting a deletion inside a block that someone else deleted whole brings the block back: the
  break-and-prefix part of the other deletion is rejected too, and the editor says so.
- Joining or deleting across a block with a pending block-format change, or deleting someone
  else's pending inserted break, is refused until that change is decided.

### 3.5 Atomic content

Some content can't hold markers. A change to it replaces it whole, as a substitution:

- inline: code spans, math, autolinks, footnote references, images, link destinations (link text
  takes marks), inline HTML tags, and HTML comments that aren't Redlines markers;
- blocks: fenced code blocks (R Markdown and Quarto chunks included), display math, raw-text HTML
  elements (`<script>`, `<style>`, `<textarea>`, `<pre>`, `<title>`), Quarto shortcodes
  (`{{< … >}}`) and attribute blocks (`{#fig-plot}`).

A changed code block is a whole-block substitution with the old block as payload, its backticks
escaped so knitr can't run it. The fence holds the newest code, so the document still runs.

In HTML blocks such as `<details>` and `<div>`, markers may go in element content, including at
the start of any line but the block's first. They never go inside a tag or inside `script`,
`style`, `textarea`, `pre` or `title`, and they never add or remove blank lines inside the block.

An ordinary HTML comment is content. Inserting one is an insertion that contains it. Deleting one
is a deletion whose payload holds it, escaped: `<!--del b4rt <!-\- TODO -\->-->`.
Editing inside one is a substitution of the whole comment.

### 3.6 Nesting

Payloads never contain markers, because an HTML comment can't contain another. The structure is
as flat as Word's, where a run of text is plain, inserted, deleted, or inserted and then deleted
by someone else.

**An insertion or substitution may contain other people's deletions, substitutions and format
changes.** Rejecting the insertion removes everything inside it.

```markdown
The <!--ins k3x9-->shiny <!--del b4rt very -->new <!--/k3x9-->importer
```

| Action        | Result                                                       |
| ------------- | ------------------------------------------------------------ |
| Accept `k3x9` | The insertion becomes plain text; Bo's deletion stays pending |
| Reject `k3x9` | Everything inside it goes, Bo's deletion included            |
| Accept `b4rt` | "very " is gone from Ada's still-pending insertion           |
| Reject `b4rt` | "very " is back inside Ada's insertion                       |

**Insertions never contain insertions.** Typing inside someone else's insertion splits it around
the new one. A mark written in several segments repeats its kind and id in each segment.

```markdown
The <!--ins k3x9-->shiny <!--/k3x9--><!--ins w8nn-->and fast <!--/w8nn--><!--ins k3x9-->importer<!--/k3x9-->
```

**A deletion or substitution that covers existing marks is split around them,** with one id.
Here Bo deletes a passage that contains Cy's pending deletion, and each can be decided on its own:

```markdown
Ship <!--del b4rt the old --><!--del c2zf legacy --><!--del b4rt exporter -->now.
```

**Comments and highlights** may contain any change marks and may overlap each other, because
their closing markers name their ids.

**Editing your own pending change** changes it in place, as in Word, without a new mark. Deleting
text and typing the same text again cancels the deletion.

**Simplify markup.** When many people rewrite one sentence in turn, it can carry many small
marks. The editor's Simplify markup collapses such a region into one whole-block substitution:
the old blocks as payload and the newest blocks in the file. The marks it replaced are kept in the
ledger under `parts` (§5.4), so their authorship isn't lost. The editor never does this on its
own, because it changes what reviewers can accept piece by piece. The Word importer uses the same
form for revisions that don't map to Markdown.

### 3.7 Tables

A GFM table can't contain a line that isn't a row. Inserted rows were tested in simulated live
sessions and git merges. Columns, moves and header changes follow the same design but have not
been simulated yet.

Text in cells takes inline marks, as anywhere else.

**An inserted row** carries a marker at the start of its first cell, followed by one space:

```markdown
| Fruit                     | Count |
| ------------------------- | ----- |
| Apples                    | 3     |
| <!--ins k3x9 row--> Pears | 5     |
```

- The payload `row` makes this a point form of `ins`, with no closer. An ordinary insertion opener
  never has a payload, so the two can't be confused. In an empty first cell, the marker stands
  alone: `| <!--ins … row--> | 5 |`.
- The marker has no position, so a text merge can't attach it to the wrong row.
- The row's own text carries no marks. Every character outside other people's marks belongs to
  the row's insertion, including text its author types later. Other people's typing, deletions
  and format changes in the row are marked as usual, and accepting one leaves its text in the row,
  still pending with the row. Typing at the start of the first cell goes after the marker.
- Accepting the row removes the marker; other pending marks inside stay pending. Rejecting the row
  removes it with everything in it.
- A new header row has the marker in its first header cell. The old header becomes body row 1, and
  rejecting the insertion makes it the header again. Making an existing row the header is a move
  to the top.

**An inserted column** carries `<!--ins ID col-->` and one space at the start of its
header cell. Its body cells and delimiter cell carry no marks. Rejecting it removes every cell of
the column and its delimiter cell.

**Deleted rows and columns** leave the table and are kept in deletions after one blank line below
it, one per line:

```markdown
| Fruit  | Count |
| ------ | ----- |
| Apples | 3     |

<!--del g5nb row=2 \| Pears \| 5 \|-->
```

- A deletion whose payload starts with `row=` or `col=` belongs to the nearest table above it.
  Without the blank line, several renderers read it as another table row, and formatters such as
  Prettier insert the blank line anyway. The block exists only while rows or columns are deleted.
- A row's payload is `row=N` and the row as written. A column's is `col=N` and its cells from top
  to bottom, delimiter cell included (so its alignment comes back), separated by `\n`.
- Positions count the table as written. The header is row 0 and body rows count from 1; neither
  the delimiter row nor deleted rows count. Columns count from 1. A deletion names the position
  the row or column takes when restored. The serializer rewrites positions whenever the table
  changes, and several deletions at one position keep their order.
- **Deleting a pending row:** if its author deletes it and nobody else's pending marks are inside,
  the row is removed. Otherwise it becomes a tracked deletion of a pending insertion, as in Word,
  with the row as written in the payload, marker escaped:
  `<!--del m2bd row=2 \| <!-\-ins k3x9 row-\-> Pears \| 5 \|-->`.
  Rejecting the deletion restores the pending row, and accepting it removes the row with every mark
  in it. Rejecting the insertion removes both, and accepting it leaves an ordinary deleted row.
- Pending marks inside a deleted row, column or table stay live inside the payload, escaped.
  Rejecting the deletion restores them as pending; accepting it drops them.
- A table keeps at least one row. Deleting the last one, or rejecting the insertion of the last
  one, is refused.
- A text merge can leave a deletion's position stale, so that rejecting it would restore the row in
  the wrong place, although no text is lost. The merge driver recomputes positions (§7.4).

**Other table rules:**

- Rows that hold markers have a leading `|`.
- The serializer keeps a table's padding style and never re-pads rows it didn't change, so diffs
  stay small.
- An alignment change is a block format change (`align=SPEC`) around the table.
- A moved row or column is written at its new place with the in-row marker, and as a deletion at
  its old place. The ledger links the two with `move`.
- A deleted last block, or a split right after a table, goes on its own line below the table,
  after the row and column deletions.
- Any other structural change is a substitution of the whole table. GFM tables have no merged
  cells.
- Pandoc's `markdown` reader gives a pipe table relative column widths once a line is longer than
  its column limit (72 by default). A marker adds about 20 characters to its row, so marked rows
  can trigger it. Only the widths change.

The design comes from simulation. An earlier form put an insertion in every cell of a new row.
It lost rows in 9.2% of simulated live table sessions, because its marks broke as soon as someone
else typed in the row. A marker below the table with a row number fixed that, but went stale in
text merges. The in-row marker lost no rows and merges as well as the per-cell form
([tables](research/tables.md), [collaboration](research/collaboration.md)).

### 3.8 Front matter

YAML front matter must come first in R Markdown, Quarto and Jekyll, so nothing goes before it,
inside it, or on its closing line. A change to it has no marker. The ledger records it under
`frontmatter`, one entry per changed key with the old value (§5.4).

### 3.9 One form per state

The serializer always writes the same bytes for the same state:

- adjacent deletions by the same author in one editing burst merge into one mark;
- a change that covers whole blocks uses the block forms of §3.4;
- whole-block insertions use own-line markers.

The parser accepts the other valid forms, and warns.

## 4. Comments

A comment thread is anchored in the body and stored in the ledger under the same id.

- **Anchors:** `<!--cmt ID-->text<!--/ID-->` for a range, `<!--cmt ID-->` alone for a point. A
  range may span blocks, as one segment per block with the same id. It may contain any marks and
  overlap other comments and highlights.
- **Typing** at the end of a comment's range extends it. Typing at its start doesn't.
- **A comment about a change,** like Word's comment on an insertion, has `about: ID` in the
  ledger and a point anchor right after the mark, so it keeps its place when the mark is accepted
  or rejected.
- **Comments on deleted text stay.** When all the text a comment covers is deleted and the
  deletion is accepted, or a covered insertion is rejected, the thread becomes a point comment at
  that place. The ledger keeps the covered text in `quote`, recorded when the comment is created;
  recording it when the range empties would make the result depend on the order of decisions. Word
  deletes such comments. Redlines keeps them, and shows them as "On deleted text". Word export
  anchors them to the nearest surviving word, because Word has no empty ranges.

  ```markdown
  <!--cmt c8d2--><!--del b4rt Uptime target is 99.9%.--><!--/c8d2-->
  ```

- **Replies** are one level deep, in conversation order, as in Word.
- **Likes** are the reaction Word keeps. Other reactions are allowed; Word export keeps only the
  likes.
- **Resolved is a state.** A thread with `resolved` is resolved. Replying to a resolved thread in
  the editor reopens it by removing `resolved`, as Google Docs does. A resolve and a reply made at
  the same time, live or in a merge, leave the thread resolved, and the editor flags the newer
  reply.
- **Assignment,** as in Word: `assigned` names a person and `done` marks the task complete.
- **Mentions** are `@handle` in comment text, at the start or after a space or punctuation, where
  the handle is in `people`. Anything else, such as an email address, is plain text. Mentioning
  someone adds them to `people`, and the editor shows the mention as `@Display Name`. Mentions
  never go in the body: in pandoc files, `@key` in the body is a citation.
- **Edits** to a comment are allowed only to its author and are not tracked. `edited` holds the
  time of the last one.
- **A thread leaves the file** only when someone deletes it. A thread whose anchor is gone, for
  example after a hand edit, is kept and shown as detached until someone deletes it.

## 5. The ledger

### 5.1 Placement

The ledger is one HTML comment at the end of the file, after a blank line. It starts with
`<!-- redlines` on its own line, ends with `-->` on its own line, and holds a YAML mapping, like
front matter in R Markdown and Quarto.

- The word `redlines` comes first, so other tools don't mistake the comment for their own. Marp,
  for one, reads a leading YAML comment as slide settings.
- The ledger appears with the first tracked change, comment or setting, and is removed when
  nothing is left in it.
- Text typed after the ledger is tolerated. The editor moves the ledger back to the end on its next
  save.
- Documents joined by Quarto includes or knitr child documents can contain several ledgers. A
  marker belongs to the first ledger after it. The editor always writes one.
- The ledger never goes in front matter.

### 5.2 Keys

```yaml
# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.
version: 1
tracking: everyone
history: full
people:
  ada: {name: Ada Lovelace, email: ada@example.org, accounts: [github:ada-l]}
  alex-kim: {name: Alex Kim, email: alex.kim@example.org}
  alex-kim-2: {name: Alex Kim, email: akim@law.example, org: Example Law}
  claude-ada: {name: Claude, agent: true, for: ada}
marks:
  m4vf: {by: alex-kim, at: 2026-10-13T22:31Z, move: n5vt}
  p7qd: {by: claude-ada, at: 2026-10-13T22:32Z, group: g2rs, note: Matches the roadmap}
  n5vt: {by: alex-kim, at: 2026-10-13T22:31Z, move: m4vf}
comments:
  c8d2:
    by: ada
    at: 2026-10-13T22:36Z
    about: p7qd
    resolved: ada 2026-10-13T22:41Z
    likes:
      - alex-kim-2 2026-10-13T22:39Z
    replies:
      - id: r5tw
        by: claude-ada
        at: 2026-10-13T22:37Z
        text: |-
          The tiers are in the appendix.
    text: |-
      Can we settle this before the review, @claude-ada?
      \
      See the pricing table.
frontmatter:
  - {key: title, by: ada, at: 2026-10-13T22:42Z, was: Launch}
```

| Key           | Holds                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `version`     | The format version, `1`                                                                            |
| `tracking`    | `everyone`: everyone who opens the file in Redlines starts in Suggesting (§5.6)                    |
| `history`     | `full`: the file keeps its own history (§6). Absent means `current`                                |
| `people`      | Handles and the people they stand for (§5.3)                                                       |
| `marks`       | Each mark's author and time, and its extras (§5.4)                                                 |
| `comments`    | Comment threads (§4, §5.4)                                                                         |
| `frontmatter` | Pending changes to the YAML front matter (§3.8)                                                    |

Defaults are never written. Unknown keys are kept and ignored, so later versions can add fields.

### 5.3 People

- `people` maps a handle (§2.4) to a person. Fields: `name` (required; what Word shows), `email`,
  `org`, `accounts` (stable ids such as `github:ada-l` or Microsoft 365 ids from Word, used to
  match the same person across documents and on Word import), `aliases` (other names seen on
  import), `agent: true` and `for: HANDLE` for an agent acting for a person, `members` for a team
  that can be mentioned, and `deleted: true` for someone who left; their handle stays.
- A handle is derived from the email's local part, or else from the name, with `-2`, `-3` appended
  on a clash. Two people with the same name get different handles (`alex-kim`, `alex-kim-2`). The
  editor shows the `org` or email when names collide, and Word export appends the `org`, because
  Word identifies authors by name only.
- Renaming someone changes only `name`. Handles never change. The same person found under two
  handles, for example after a merge, keeps the older one and records the other in `aliases`.

### 5.4 Marks, threads and front matter

- **`marks`** has one entry per mark, in document order: `by` and `at` (§2.4), plus the extras
  below when the mark has them. An entry whose mark is no longer in the body is ignored, and removed
  on the next save. A mark without an entry is shown with the author `unknown`, and the parser
  warns.
  - `note`: the author's reason for the change. Agents always give one.
  - `group`: the id of a group of marks that are decided together, such as all edits from one
    agent run.
  - `move`: the id of the other half of a move, a deletion and an insertion that the editor shows
    as "Moved" and Word export writes as `w:moveFrom` and `w:moveTo`.
  - `parts`: for a substitution made by Simplify markup, a literal copy of the marked-up region it
    replaced (§3.6).
- **`comments`** has one entry per thread, keyed by id, in the document order of the anchors.
  Fields, in this order: `by`, `at`, `about`, `edited`, `resolved` (`handle time`), `assigned`,
  `done`, `likes` (a list of `handle time`), `reactions`, `replies` (a list of `id`, `by`, `at`,
  `text`), `quote`, `text`. The lists that grow come before the text, so changes made on different
  branches land on different lines (§7.3).
- **`frontmatter`** lists pending changes to front matter, one entry per key: `key`, `by`, `at`,
  and `was`, the old value, absent when the key is new.

### 5.5 YAML rules

The ledger is YAML 1.2, written so that YAML 1.1 readers such as PyYAML and R's `yaml` read the
same values.

- Its first line is a fixed YAML comment for whoever resolves a merge conflict, a person or an AI:
  `# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.`
  (§7.3). Readers ignore it, and the serializer always writes it.
- Readers keep every value a string and reject duplicate keys: the JavaScript `yaml` package with
  `schema: 'failsafe'`, js-yaml with `FAILSAFE_SCHEMA`, PyYAML's `BaseLoader` plus a duplicate
  check, and R's `yaml` with string handlers.
- Keys are ids, handles and fixed names, none of which YAML can read as another type.
- Free text (comment text, replies, notes) is always a literal block (`|-`). Text a person types
  may start with `@`, contain `: ` or ` #`, or say `No`; as a plain or flow scalar, each of these
  broke or changed the value in every parser tested.
- Other strings are quoted when they need to be. Times are minute-precision strings (§2.4).
- Values use the payload escapes (§2.5), except that a value may span lines inside a literal block.
  A blank line inside a value is written as a line holding only `\`, because some Markdown tools end
  an HTML comment at a blank line, and a line holding only a literal `\` is written `\\`.
- Because values never contain `--`, `-->` can't appear inside the ledger. The ledger never uses
  YAML document markers (`---`).

### 5.6 Settings

- **`tracking: everyone`** works like Word's Track Changes "For Everyone": everyone who opens the
  file in Redlines starts in Suggesting, under a notice that says so. Without it, each person's
  mode is their own and is never saved, as with Word's "Just Mine".
  - Someone has to turn it on. It is never added by default.
  - A plain file can't enforce it. It is a default, like Word's Lock Tracking without a password.
    Hosts with real permissions enforce roles themselves.
  - Word export writes it as `w:trackRevisions`, and import reads it back.
  - The value is a word because YAML 1.1 readers read `on` as `true`.
- **No owners list.** Permissions belong to hosts, not to files.
- **Per-person state never goes in the file:** view, mode, filters, comment drafts, folds, the last
  version someone saw, and presence.

### 5.7 Layout

Saving the same state always writes the same bytes, and diffs stay small:

- keys in the order of §5.2;
- `people` sorted by handle, one line each, in flow style;
- `marks` in document order, one line each, in flow style;
- `comments` in document order;
- the field order of §5.4 inside each thread.

## 6. History

### 6.1 Pending changes and history

Pending changes are flat, as in Word. Each pending mark is a property of a range of the current
text: inserted, deleted, replaced, reformatted, or inserted and then deleted by someone else.
Nothing nests deeper (§3.6). This model only covers what is pending. Once a change is accepted or
rejected, the text it belonged to may be gone, and Word keeps no record of it.

Redlines therefore has two modes, set by the ledger's `history` key:

- **Current,** the default. The file holds the current text and the pending changes, and a decided
  change leaves the file. If the file is in git, earlier versions are in git, one per commit.
- **Full** (`history: full`). The file also keeps a log of every edit, from which every earlier
  version can be rebuilt byte for byte, without git. Contract negotiations and regulated documents
  need this.

The history is a log of edits, not a set of properties, so replaying it never depends on the flat
model. A prototype rebuilt every earlier version of every branch from the final file alone,
including after real git merges: 54,324 versions in 410 merge trials ([research](research/history.md)).

### 6.2 Save blocks

Each save adds one HTML comment block between the body and the ledger. Shortened:

```markdown
<!-- redlines-history xz89 after:xgns from:bcp94ft4 to:k6sq7x62
xz89.1 ada 2026-10-14T08:15Z accept cd9x | @646:<!-\-sub cd9x 30-\-> | @648:<!-\-/cd9x-\-> | x cd9x {by: bo, at: 2026-10-13T14:02Z}
xz89.4 ada 2026-10-14T08:16Z edit | @140+7:Ltd.
xz89.6 ada 2026-10-14T08:20Z new pp5q | @1689+73
end xz89 -->
```

- **The header** names the save with a new random id (from the mark-id alphabet). `after:` lists
  the save or saves it started from, so the history is a graph, not a numbered list; a
  document-wide counter would collide on every branch, as sequential ids do. `from:` and `to:` hash
  the document before and after the save.
- **Blocks are sorted by id** and never change after the save. Every line starts with the block's
  id, so git can't line up two blocks on a shared line.
- **Events** are one line each, in the order they happened: `ID.N BY TIME OP ARGS | ITEMS`. The
  order comes from line order and `after:`, never from times.

| Op                                          | Meaning                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `new`, `revise`                             | A mark created, or its author changing their own pending mark            |
| `accept`, `reject`                          | Decisions, including groups and both halves of a move                    |
| `edit`                                      | An untracked change, made directly or outside Redlines                   |
| `collapse`                                  | Simplify markup; the stored text is the substitution's `parts`           |
| `cmt`, `reply`, `like`, `resolve`, `person` | Threads and people                                                       |
| `merge`, `checkpoint`                       | Kinds of save, written by the merge driver or the editor                 |

- **Items are undo-only patches,** `@POS[+LEN][:TEXT]`: the event inserted `LEN` characters at
  `POS` and removed `TEXT`. `x ID {…}` records a mark's ledger entry as it was before the event, so
  stepping back restores it, and `was VALUE` records a replaced `resolved`.
- **One event per editor command,** grouped the way undo steps are.

In the example, `xz89.1` is Ada accepting Bo's substitution; the line keeps the markers it removed
and the mark's ledger entry.
`xz89.4` is Ada's direct edit: 7 inserted characters at position 140, replacing "Ltd.". `xz89.6` is
a new mark, stored by length only, because its text is still in the body.

### 6.3 Nothing current is copied

Every piece of text is stored once: in the body while it is current, and in the history from the
event that removed it.

- A decision stores the markers it removed, word for word, and the mark's ledger entry.
- A `new` event stores only lengths, plus its author and time, which replay checks against the
  mark's ledger entry. This repeats about 23 bytes per mark and catches a hand-edited author.
- Comment text and people are only in the ledger. Comment edits are not recorded.

### 6.4 Positions

Positions count Unicode code points from the start of the body, with CRLF read as LF. Code points
count the same in every language; the editor, which counts UTF-16 units, converts at its boundary.
Removed text uses the payload escapes (§2.5), with `\|` between items.

### 6.5 Replay and merges

Replay starts from the current file and undoes events in reverse order, so positions stay valid.
It never depends on matching text.

A single list of positions can't survive a merge, because positions refer to each branch's own
text. The reader replays the graph of saves instead. It gives every character that ever existed
an identity, follows it through both branches, and keeps a character at a merge unless a branch
deleted it. Every version is checked against the stored hashes.

- A clean plain-git merge needs nothing more. The next save names both parents in `after:`.
- A conflict between history blocks only is resolved by keeping both sides. That was right in all
  72 such conflicts in testing.
- After a prose conflict resolved by hand, `redlines repair` records the resolution as a `merge`
  save, using git's parents. Without git, the editor writes a `checkpoint`.
- The merge driver writes a `merge` save itself.

### 6.6 Integrity

On open, the editor compares the document with the newest `to:` hash. A mismatch means an edit
made outside Redlines. The editor records it as an `edit` event, from git's copy or its own last
save, or writes a `checkpoint`. The hashes detect accidental and outside edits. They are not
signatures.

### 6.7 Compaction and size

- `redlines compact --keep N` deletes the oldest save blocks. Kept blocks don't change, so
  compaction merges cleanly with concurrent work. It never removes a pending `collapse`.
  `redlines compact --all` returns the file to current mode.
- A 50-save negotiation of a 247 KB contract, with 3,804 events, added 271 KB of history (78 KB
  gzipped, as git stores it), about 71 bytes per event. Opening the current state took 7.3 ms
  instead of 6.8 ms, because the ledger can be read without touching the history. The editor
  suggests compaction when the history outgrows the body.
- Word has no equivalent. Word export writes the current state only.

## 7. Merging

### 7.1 What must hold

Redlines files are shared through git, shared folders and email. In git, a merge must never
corrupt a file silently, and every conflict that isn't in the prose must have a mechanical
resolution, so that a person, an AI or a tool can apply it without judgment. (Live sessions don't
merge: a server orders their edits; see [design.md](design.md).)

### 7.2 Plain git

- **Markers sit on the lines they change.** A mark's kind, id and old text are in its markers, so
  branches that edit different paragraphs touch different lines of the body.
- **The ledger is laid out for merging:** one line per mark and per person, marks and threads in
  document order, people sorted, and a thread's growing lists before its text. Additions from two
  branches often land in different places.
- **Random ids don't collide** (§2.3).

Every new mark still adds a line to the ledger, so parallel work often conflicts there. Measured
with plain git, with branches that edit different paragraphs, so that only the ledger can conflict
([research](research/ids-and-ledger.md)):

| Scenario                                                                         | Merges with a conflict |
| -------------------------------------------------------------------------------- | ---------------------- |
| Two reviewers each add 20 marks                                                  | 47%                    |
| A reviewer adds marks and comments while the owner accepts, rejects and resolves | 30%                    |
| Two branches each add 3 marks, a comment and a reply to a large document         | 1%                     |
| Three branches, merged one after another                                         | 78%                    |
| One agent working in three sessions at once                                      | 67%                    |
| Two branches each add a new person                                               | 97%                    |

When two branches edit the same paragraph, the prose itself conflicts in most merges (59–100%),
whatever the format does. Those conflicts need judgment, as in any text file.

### 7.3 Keeping both sides

A conflict in the ledger is resolved by keeping both sides:

- **Order carries no meaning.** Every entry is keyed by a unique id or handle, and the serializer
  rewrites the canonical order (§5.7) on every save. A merge that keeps every entry from both sides
  is correct in whatever order it leaves them.
- **Stale entries are harmless.** If one branch accepted or rejected changes, keeping both sides
  can bring back their ledger entries. An entry whose mark is no longer in the body is ignored and
  removed on the next save (§5.4).
- **The ledger says so.** Its first line tells whoever resolves the conflict, a person or an AI, to
  keep both sides (§5.5).

In the tests, keeping both sides gave the right result in every ledger conflict, apart from those
stale entries and one rare case: two different people given the same handle on two branches. That
leaves a duplicate key, which the merge driver and the editor repair by renaming the newer handle;
since markers carry no handles, the rename touches only the ledger. In GitHub's conflict editor,
keeping both sides means deleting the three conflict-marker lines.

### 7.4 Resolving conflicts automatically

- **The merge driver.** `redlines merge-driver install` adds `*.md merge=redlines` (and the same for
  `.qmd` and `.Rmd`) to `.gitattributes`, and the driver's command to the clone's git config. Git
  requires the second step on every clone, so that cloning a repository can't make anyone run its
  code. The driver merges the body with git's own three-way merge, and the rest by meaning:
  - the ledger as sets keyed by id or handle: additions from both sides, field-by-field merges of
    changes to the same entry, then the canonical layout (§5.7). Times only break ties, such as a
    resolve and a reply made in the same minute;
  - history blocks by union, plus a `merge` save;
  - duplicate ids and handles renamed, and table deletion positions recomputed (§3.7).

  In 80,511 simulated merges, the prototype left no ledger conflicts and no silent mis-merges.
  Only prose conflicts remained. The same code runs in the editor when it brings in commits, and in
  hosts that merge on their servers.
- **Redlines itself.** When it opens a file whose ledger holds git conflict markers, it keeps both
  sides and tidies the ledger, and writes the result when you save. The ledger is inside an HTML
  comment, so the file still renders while the conflict is open. Conflicts in the prose are shown
  for you to resolve.
- **AI assistants** that resolve merge conflicts follow the ledger's first line.
- **GitHub's, GitLab's and Bitbucket's merge buttons** never run custom merge drivers. A pull
  request with a ledger conflict is resolved by one of the above, or by deleting the conflict
  markers in GitHub's conflict editor.

### 7.5 Where the author and time go

The author and time could also go in each marker: `<!--ins k3x9 ada 2026-10-13T22:30Z-->new <!--/k3x9-->`
instead of `<!--ins k3x9-->new <!--/k3x9-->`. A new mark would then add nothing to the ledger, and
fewer merges would conflict. With plain git, and branches on different paragraphs:

| Where the author and time are                         | Two reviewers, 20 marks each | Reviewer and owner | Three branches |
| ----------------------------------------------------- | ---------------------------- | ------------------ | -------------- |
| In the ledger, entries sorted by id                   | 100%                         | 99%                | 100%           |
| In the ledger, entries in order of creation           | 100%                         | 50%                | not measured   |
| In the ledger, entries in document order (this spec)  | 47%                          | 30%                | 78%            |
| In the marker                                         | 0%                           | 0%                 | 43%            |

The format keeps them in the ledger anyway:

- **Markers stay short,** by about 20 characters each, so the raw file and its diffs stay readable.
- **The ledger conflicts either way.** New people, comment threads and merges of three branches
  conflict in the ledger even with authors and times in markers, so the keep-both-sides rule is
  needed in any case. Once it exists, more frequent conflicts cost little.
- **Merge conflicts are more and more often resolved by tools:** the driver, the editor, and AI
  assistants, for which the rule is mechanical.

The costs are more conflicts with plain git, and a mark and its ledger entry that can drift apart
after a hand edit. Drift is handled: stale entries are ignored and removed, and a mark without an
entry shows the author `unknown`. Ordering entries by time instead of by document position wouldn't
help, because every new entry would go to the end of the list, where entries from two branches
always meet.

### 7.6 Shared folders

Dropbox, iCloud Drive, OneDrive and Google Drive don't merge. When two people change the same file
at once, they keep both copies. Redlines can compare the two copies and show the differences as
tracked changes (design.md).

## 8. Views

The library derives three read-only views of a document. None is ever stored.

- **Newest:** the text with every pending change accepted, without markers or ledger. Renderers
  show this, and the editor's Clean view shows it formatted. Accept-all export writes it as plain
  Markdown.
- **Original:** every pending change rejected.
- **Review:** the newest text with pending changes in CriticMarkup notation, each followed by its
  id and author in brackets. Language models know CriticMarkup from their training data, so this is
  the view agents read:

  ```text
  We will ship the {++new ++}[k3x9 ada]importer in {~~March~>April~~}[p7qd claude-ada], after the {==security review==}{>>[c8d2 bo] Who signs off on the security review?<<}.{-- The old exporter stays as it is.--}[w2rf bo]
  ```

Agents edit the newest view, and the library turns their edits into tracked changes in their name
(design.md). CriticMarkup is never used for storage.

## 9. Files and other tools

### 9.1 File types and dialects

- A Redlines file keeps its extension: `.md`, `.qmd` or `.Rmd`. A new extension would lose GitHub's
  rendering and every Markdown, R Markdown and Quarto tool.
- `.md` files are written in GitHub Flavored Markdown: `<sub>`, `<sup>`, `<mark>`, `<ins>` for
  underline, `<img width>`, `<dl>`, GitHub alerts.
- `.qmd` and `.Rmd` files are written in pandoc's Markdown: `~x~`, `^x^`, `[x]{.mark}`,
  `{width=}`, `{#id}`, Quarto callouts.
- Both read every common variant, and the serializer never rewrites syntax it didn't change.
- MDX is not supported: MDX can't compile HTML comments.
- A file is a Redlines file if it contains Redlines markers or a `<!-- redlines` ledger. Tools that
  need a media type can use `text/markdown; variant=redlines` (RFC 7763 allows a `variant`
  parameter).

### 9.2 Untouched files

A file changes only when its content does.

- Opening a file never writes it. Saving without edits leaves it byte for byte the same.
- A file whose changes are all decided and whose threads are all deleted is plain Markdown again.
- Defaults are never written: no `history: current`, no empty `people`.
- Untouched parts of a file are never reformatted: no re-padded tables, no changed line endings,
  no added final newline.

### 9.3 How other tools show a Redlines file

| Tool                                                                  | What it shows                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| GitHub, VS Code's preview, Hugo, Docusaurus 3, other CommonMark renderers | The newest version                                                                |
| Pandoc, R Markdown, Quarto                                            | The newest version. Comments are dropped from Word, PDF and plain-text output         |
| Pandoc with the Redlines filter                                       | The newest, original or markup view, and Word files with tracked changes (§11)        |
| Jekyll and GitHub Pages                                               | The newest version. Payloads escape Liquid's tags (§2.5)                              |
| Editors that show HTML comments as text, and Google Docs' Markdown mode | Every marker and the ledger, as text. Saving keeps them; Google Docs also reformats the file (§9.5) |
| Marp                                                                  | The newest version, with every marker and the ledger in the speaker notes             |
| MDX                                                                   | A compile error                                                                       |

### 9.4 R Markdown, Quarto and knitr

- Rendering needs no extra tools. knitr leaves HTML comments in place and pandoc drops them, so a
  marked-up `.Rmd` or `.qmd` renders the newest version.
- Code keeps running. Markers never appear inside chunks, inline R code, chunk options (`#|`
  lines), front matter, math, shortcodes or cross-reference labels, and a chunk's fence always
  holds its newest code. Chunk options are kept byte for byte.
- knitr runs code it finds inside HTML comments, in payloads and in the ledger alike, so both
  escape every backtick (§2.5). This was verified with knitr 1.51.
- No Redlines comment starts with `#`, which Jupytext's cell markers and Quarto's editing comments
  use.
- The visual editors of RStudio and Quarto keep HTML comments, but rewrite the whole file in
  pandoc's style when they open it, loosen tight lists that use the list-item opener (§3.3), push
  markers to line starts with their `column` and `sentence` wrap settings, and show markers as
  code. Edit Redlines files in source mode; `editor: source` in `_quarto.yml` makes that the
  default. Plain `pandoc -t markdown` turns markers into visible code, and `github_document` and
  `md_document` re-wrap at 72 columns unless given `--wrap=preserve`.

### 9.5 Formatters and other editors

- **Safe:** Prettier with `proseWrap: "preserve"` (its default), remark-stringify, mdformat without
  `--wrap`, and markdownlint's `--fix`.
- **Not safe:** anything that re-wraps prose, because it pushes markers to line starts (§3.2).
  Prettier also rewrites `*` emphasis as `_` next to a marker; the rule in §2.6 repairs the result
  when a change is decided.
- **Google Docs' Markdown mode** keeps every marker and the ledger, but an edit there rewrites the
  whole file. It removes the blank line before a line that starts with a marker or the ledger, puts
  `&nbsp;` paragraphs around a table's deletion block, escapes GitHub alerts (`\[\!NOTE\]`),
  re-pads tables with explicit left alignment, and drops the final newline. The parser accepts all
  of this. On its next save, the serializer puts the markers back where §3 places them and leaves
  everything else as Google Docs wrote it. It offers to remove `&nbsp;` paragraphs next to a
  deletion block, but never removes them on its own.
- **Converting** a Redlines file into a Google Doc drops every marker and the ledger: every change
  is silently accepted and every comment lost ([research](research/ecosystem.md)).

### 9.6 Hidden is not removed

Markers are hidden, not removed. A renderer that passes HTML through publishes deleted text and
comment threads in the page source; GitHub strips them. Marp exports them into speaker notes.
When a document leaves review, publish the newest view.

## 10. Word

Pending changes map onto Word's revisions
([Word export](word-export/README.md), [import](word-export/import.md)):

| Redlines                 | Word (OOXML)                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Insertion, deletion      | `w:ins`, `w:del`                                                                     |
| Substitution             | `w:del` then `w:ins`, with the same author and time                                  |
| Inline format change     | `w:rPrChange`                                                                        |
| Block format change      | `w:pPrChange`                                                                        |
| Table alignment change   | `w:pPrChange` on the paragraph of each cell in the column                            |
| Inserted or deleted row  | `w:ins` or `w:del` in the row's properties                                           |
| Inserted column          | `w:cellIns`                                                                          |
| Deleted column           | `w:cellDel` where Word accepts it, otherwise deleted runs and a comment              |
| Move                     | `w:moveFrom` and `w:moveTo`                                                          |
| Split, join              | An inserted or deleted paragraph mark                                                |
| Comment thread           | A comment with replies, resolved state and durable ids, in Word's comment parts      |
| `tracking: everyone`     | `w:trackRevisions`                                                                   |
| People                   | Author names, with the `org` appended when names collide                             |
| History                  | Not exported. Word keeps no history                                                  |

- Export writes `compatibilityMode` 15. Every reply gets its own range and reference mark.
- Import reads UTC times from `w16du:dateUtc` and `w16cex:dateUtc`. Word for Mac writes `w:date`
  in local time with a misleading `Z`, so it is only a fallback.
- For round trips, export stores the original Markdown and the ledger in a custom XML part
  (`customXml/redlines-source.xml`) and in bookmarks named `_rl_…`, which Word keeps.

## 11. The pandoc filter

A pandoc Lua filter, packaged as a Quarto extension and a small R package, brings Redlines to the
render button that R Markdown and Quarto users already use. It adds:

- a `redlines` render option: `edited` (the default, the same as rendering without the filter),
  `original` (every change rejected), or `markup`, in which HTML output shows changes and
  comments;
- Word output with real tracked changes, through pandoc's `.insertion` and `.deletion` spans;
- a second implementation of this spec, run against the same fixtures (§12).

Pandoc parses each marker as raw HTML, so the filter works on pandoc's document tree and reads the
ledger with pandoc's own YAML parser. A prototype, [`redlines.lua`](pandoc-filter/redlines.lua),
turns insertions, deletions and substitutions into Word tracked changes with their authors and
dates. It reads them from the ledger, as this spec stores them, but under an older key
(`changes`), so it doesn't yet read files written to this spec.

Still to do:

1. Read the `marks` key instead of `changes`, and leave out the date when a mark has none.
2. Decode the escapes, and parse payloads as Markdown.
3. Handle markers that pandoc reads as raw blocks: openers at block starts, whole-block changes,
   row and column deletions.
4. Recurse into insertions, so nested deletions survive.
5. In the default view, strip every mark and the ledger. Emit tracked-change spans only for Word
   or in the markup view.
6. Turn raw `<br>` into a line break, and warn about HTML lists in pipe-table cells, which pandoc
   deletes.

Pandoc's Word writer has no comment replies, resolved state, likes, moves or formatting revisions.
Full-fidelity Word files come from Redlines' own exporter; the filter serves the render pipeline.
R users can still get full fidelity: the R package can run the TypeScript exporter through the
`V8` package, without Node.

## 12. Conformance

- The format library ships conformance fixtures: documents with their expected views, decisions
  and warnings. Every implementation, the TypeScript library and the pandoc filter alike, runs
  them.
- The placement rules of §3 come with 72 render cases, checked on GitHub, cmark-gfm, markdown-it,
  micromark, commonmark.js and pandoc.
- A parser returns the views (§8), the marks as ranges (possibly in several segments), the people
  and threads, and warnings: unknown keys, duplicate ids, markers at a line start, segments whose
  kinds disagree, marks without ledger entries, ledger entries without marks, and threads without
  anchors.
- Markup that breaks these rules, for example after a bad merge, is reported, shown with a warning
  and otherwise treated as text, so the document still opens.

## 13. Open questions

1. **What the history hashes cover.** They should cover a canonical form of the ledger, so that a
   change of layout doesn't break old hashes.
2. **Shorter times in history events,** such as `08:15` when the date matches the save's, would
   save about 15% of the history's size, at some cost in readability.
3. **Two owners editing the same spot directly on two branches.** The merge driver keeps both
   edits in a fixed order. Should that be a conflict instead?
4. **Not yet tested:** front-matter changes in full history; Word import into full history (Word
   doesn't record the order of its changes); live sessions with several authors in full history;
   and table column changes, moves and header changes in simulation.
5. **Likes in Word round trips.** Word stores likes in `commentsExtensible.xml`; whether they
   survive a round trip is untested.
6. **Full history with authors and times in the ledger.** The history prototype kept them in
   markers. Decision events now also store the mark's ledger entry (§6.2); that variant hasn't been
   run yet.
7. **Live sessions with a ledger entry per mark.** The live-session simulations kept authors and
   times in markers. With an entry per mark, concurrent edits also touch the ledger. The entries
   form a set, so the server can treat concurrent additions to the ledger as independent, but the
   simulations need a rerun.

## Appendix: prior art

| Project | Where changes live | Metadata | What Redlines takes from it |
| ------- | ------------------ | -------- | --------------------------- |
| Microsoft Word (OOXML) | Revision properties on runs, paragraphs, rows and cells; comments in separate parts | Author and date per revision; threads, resolved state and likes in extension parts | The model for pending changes (§6.1, §10) |
| Google Docs | Suggestions and comments in its own document model; exported to `.docx` as tracked changes and comments | Author and time | The review workflow, together with Word's |
| [CriticMarkup](https://github.com/CriticMarkup/CriticMarkup-toolkit) | Inline delimiters such as `{++ ++}`, visible wherever unsupported | None | The notation of the review view (§8), never storage |
| [Pandoc](https://pandoc.org/MANUAL.html#track-changes) | Spans: `[text]{.insertion author="…" date="…"}`, and comment spans | Author and date; comments without replies or resolved state | The pandoc filter's Word output (§11) |
| [alevi/redline](https://github.com/alevi/redline) | A sidecar JSON file | Comments anchored by quoted text plus surrounding context | Quoted text for comments on deleted text (§4) |
| Syrus Design Docs | Database rows, anchored by hidden HTML comments | In the database | Hidden comment anchors; the Syrus plugin translates between the two |
| [trackdown](https://claudiozandonella.github.io/trackdown/) | Google Docs, with code chunks removed before upload | Google Docs suggestions and comments | Keeping code out of prose review |
| [redoc](https://github.com/noamross/redoc) | Word, with code chunks in hidden styles | Lost on the way back | Carrying code through a Word round trip, for the importer |
