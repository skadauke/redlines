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

A comment inside code, in a fenced code block or a code span, is part of the code: it is neither a
marker nor a ledger, whatever it says, so a document can show examples of both. Readers do not look
for indented code blocks, and read a marker there as a marker. A fenced code block ends where
CommonMark ends it: at a closing fence in the same container, indented at most three columns past
where the container's content starts (the left edge at the top level, a list item's content
column, the text after the quote markers in a quote); where its container ends (at a line with
fewer quote markers, blank or not, or a line with text to the left of its list item's content); or
at the end of the file. An ordered list item numbered other than 1 can't interrupt a paragraph, so
after a line of text a fence after its number opens nothing. Readers take a fence indented four
columns or more for one too, as they can't always tell which list item it is in.

But every renderer shows a marker in indented code as code, so no edit puts one there: an edit that
would write a marker into an indented code block, in a list item or a quote too, as CommonMark reads
the file, its newest view or its original view (and as micromark reads them where the two part ways,
and as markdown-it reads a line indented four columns that comes after the rows of a table with no
blank line between: as code, where GitHub reads another row; the rows of a table go on to a blank
line or to another block, and a line without a `|` is one of them), is refused with the code
`inside-code`, in the words of an edit inside fenced code. Where the same edit in fenced code would
touch a fence's own line, it is refused there for that line instead (a line that is only Markdown
syntax takes no change, or a fence would be left open), and indented code has no such line: such an
edit is refused as one in code, or made when none of its markers lands in the code. A mark goes
around the whole block where it does around a fenced one, with its markers in the text before and
after the block or on lines of their own, never on a line of the block or in its indentation; when
the new text of an insertion ends with the block, or goes on after it past a blank line, its closer
or the split after it stands alone on the line after it (§3.3). An edit that would make other
markers code, as a blank line typed above a line that goes on a paragraph does, and a decision that
would bring a marker onto a line of code, are refused as hiding other changes (`would-hide-marks`);
when the markers are a comment's, which no decision takes away, the refusal says to delete that
comment first. A line that is code in one view only counts: a blank line that a pending change adds
above it, or takes away, decides whether it is. Markers that a file has in indented code already, as
earlier versions wrote them, stay as they are: what is refused is a change that leaves more of a
mark's markers there than the file had.

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
| Checked box   | `<!--fmt k3x9 +check-->`                   | A task box checked or unchecked (§2.6)     | nothing    |
| Row, column   | `<!--ins k3x9 row-->`, `<!--ins k3x9 col-->` | An inserted table row or column (§3.7)   | nothing    |

- A substitution is one mark, accepted or rejected as a whole. Word export writes it as a
  deletion and an insertion with the same author and time.
- Joining two blocks deletes the break between them (§3.4). There is no separate kind for it.
- A highlight is a review annotation, hidden outside Redlines like every mark. Highlighting as
  part of the content (`==text==`, `<mark>`) is formatting, and adding it is a format change
  (`+mark`). Accepting or rejecting a highlight dismisses it and leaves the text; a highlight
  whose text is all removed by a decision goes with it.

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
  `\*` are kept as written. When a payload goes back into the text, as when a deletion is
  rejected, its line breaks are written as the file writes them.
- The file writes line breaks as its body has them: CRLF when the body has a CRLF, and when it has
  none, as the ledger's lines end, which were written while the body still had its CRLFs, as when
  the last of them are deleted; LF in a file with neither. The body is the file without the ledger
  and its blank line (§5.1), so adding the ledger never changes this. Typed text and the ledger
  take the same line breaks. A payload's line break of another kind, as in a file with mixed line
  breaks, comes back in the file's.
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
| `-bold=SYNTAX`             | The same, when it was written otherwise than the serializer writes it. `SYNTAX` is what stood in front of the text: `**` or `__` for `bold`, `*` or `_` for `italic`, `~~` or `~` for `strike`, and backticks with at most one space after them for `code`. Rejecting writes it back, and its mirror image behind the text. An operation with anything else is kept, and not decided |
| `+link`, `-link=URL`       | Link added; link removed, with what stood between its parentheses, title included             |
| `link=URL`                 | Link target changed; `URL` is the old target as it was written. A title stays as it is        |
| `+html=TAG`, `-html=TAG`   | Inline HTML element added or removed. `-html` records the whole original tag, attributes included |
| `@NAME=OLD`, `@NAME`       | An HTML or pandoc attribute changed (`OLD` is its old value), or added (it was absent)        |
| `+check`, `-check`         | A task checkbox checked or unchecked, as a point change at the end of the item's first line   |
| `-check=X`                 | The same, when the box was written `[X]`                                                      |
| `was=TYPE`                 | Block type changed; `TYPE` is the old type                                                    |
| `was=TYPE=SYNTAX`          | The same, when the old syntax was written otherwise than the serializer writes it (`3. `, `* `) |
| `was=indent=N`             | List item indented or outdented; `N` is the number of spaces that were in front of its bullet |
| `was=indent=N was=ol=SYNTAX` | A numbered item indented to be the first of a new sublist, which is written `1.`; `SYNTAX` is the number it had (`3.\x20`). Rejecting moves it back and writes that number |
| `align=SPEC`               | Table column alignment changed; `SPEC` is the old delimiter row, a value as above (§3.7)      |

- Block types: `p`, `h1`–`h6`, `ul`, `ol`, `task`, `quote`, `indent=N`, `callout-TYPE`, and
  `md-image`, which restores Markdown image syntax when an image resize is rejected.
- Values are escaped as payloads, and a space inside a value is written `\x20`, so a space only
  ever parts two operations. A reader splits the payload at its spaces first, and then reads the
  escapes of each value.
- The serializer writes formatting in the file's dialect: `<sub>` in `.md`, `~x~` in pandoc files
  (§9.1). New emphasis is `*` and `**`, strikethrough is `~~`, and code has one more backtick than
  its text has in a row, with a space inside them next to a backtick. Emphasis written with `_`
  stays as it is.
- An inline format change stays inside one block. A block format change opens on its own line
  before the block (§3.3) and closes at the end of the block.
- A range that crosses blocks is one mark per block, and the marks share a `group` (§5.4).
- Every segment of a mark repeats its opener with its own operations (§3.6): rejecting one of them
  needs nothing from the others, which a decision may have taken away.

```markdown
Plain text, then <!--fmt m2bd +bold-->**newly bold**<!--/m2bd--> text.
See the <!--fmt n8fx link=https://old.example-->[guide](https://new.example)<!--/n8fx-->.

<!--fmt q2hw was=p-->

## This paragraph became a heading<!--/q2hw-->
```

**The range.** The syntax goes right against the first and the last character of the text, and the
markers right against the syntax, inside the marks that stand there already. White space at the
ends of a range stays outside. Text that has the format already is left out, and turning a format
off in a part of a run turns it off in the whole run: `**more text**` with `text` selected is
`<!--fmt m2bd -bold-->more text<!--/m2bd-->`. A change inside a construct that takes no marker
covers all of it (§3.5). A change in code, an HTML block or an HTML comment is refused with the error
code `inside-code`, except that code can be turned off in code.

**Other people's changes.** A format change is refused while another person's pending change (an
insertion, a deletion, a substitution, a format change or a split) is in the paragraph, with the
message "Accept or reject the changes in this paragraph first." (`no-legal-placement`). The
paragraph goes on into the paragraphs that a pending mark in it reaches into, as rejecting a split or
an insertion with a break in it joins two paragraphs. Comments and highlights don't count, and nor
do changes in other paragraphs, though those in the same list, table or block quote are tried with
the change (below).

Your own pending changes don't count:

- Text that is all inside your own insertion, or the new text of your own substitution, takes the
  syntax as typed text, with no mark, whatever else the paragraph has: the insertion grows, and
  rejecting it takes the syntax with it.
- A block change of a block that is all your own pending insertion, such as a paragraph you typed
  (`One.\n\n<!--ins k3x9-->\n\n## Title<!--/k3x9-->`) or an item your pending split made and you typed
  in, is an edit of that insertion: the block's new syntax is written in it as Track Changes off
  would write it in the newest view, as typed text, and the change makes no mark of its own. In the
  break of your own split inside the insertion, the syntax stays where it is written, so that an
  indent re-indents the split's break (`- two<!--ins k3x9--><!--split d3x9-->\n  - X<!--/k3x9-->`).
  It is so only where every line the change reads or writes is all your own new text; where no
  marker but those of that insertion and of the marks inside it stands between the block and the
  text around it (another mark there could, once decided, bring the block into the text next to it,
  where its syntax would be text); where the edit makes no mark, leaves the original view as it was
  and makes no marker start a line; and, where it is not written as typing is, where every order of
  deciding the marks it stands in (the insertion and the marks inside it, four at most) reads the
  same and rejecting the insertion gives back what it did before. Otherwise the change is a block
  change, below.
- A format change of your own that is turned back goes away, or loses that operation, and a link of
  your own takes the new target (§3.6).
- Your other pending changes in the paragraph stay, and the change is tried against them, below.

**Overlapping.** Format changes nest as other marks do (§3.6). A mark that a decision can take text or
syntax out of (an insertion, a substitution, another format change) is either all inside the new
mark, with text of the new mark on both sides of it, or the new mark is all inside it, or the range is
cut at its edge, in segments with one id. So the new syntax stands against text that no decision of
that mark takes away, and the markers don't cross:

```markdown
<!--fmt m2bd +bold-->**Hello<!--ins k3x9-->, big<!--/k3x9--> world**<!--/m2bd--> here.
Plain <!--ins k3x9-->**new** <!--/k3x9--><!--fmt m2bd +bold-->**text**<!--/m2bd-->.
```

With `k3x9` your own insertion: the first wraps around it, and in the second, the part in it is typed
syntax. Written around an insertion that starts or ends it, the syntax would be left behind when the
insertion is rejected, as `****` or `** text**`.

- A format change around all of the text of another format goes outside its syntax, and one in part
  of another stays inside it. One that would cross the edge of another format, of the text of a link
  or of a table cell is cut there. A mark inside another's range stands inside its markers:
  `<!--fmt m2bd +bold--><!--fmt n8fx +italic-->***text***<!--/n8fx--><!--/m2bd-->`. Rejecting either
  takes its own delimiters from the run. Removing formats that stand one inside the other with
  nothing between them is one mark (`-bold -italic`). Where text stands between them, as in
  `**a *b* c**`, a mark can't hold another of its own id, so they are two marks in one `group`.
- A format change may hold deletions, and comments and highlights may overlap it (§3.6). A deletion
  that holds a line break cuts it: rejecting the deletion would part the syntax on either side.

**Track Changes off.** A format change writes no mark, and its syntax is typed and deleted text
(§3.10). The same rule refuses it next to another person's pending change in the paragraph. It stays
outside pending insertions, and syntax that would have to go in the middle of one is refused, because
it would split the insertion, and its new part has no decisions of the old.

**What can't be written.** A format change is refused (`no-legal-placement`) when its result can't be
shown to read right, so that the plain text stays as it was, as above. Before it is written, it is
tried on the block it is in, by itself: the whole list, from its first item to its last, the whole
table, the whole block quote, or the paragraph when it stands alone, and the blocks a mark joins it
to. Out of its block, a line can read otherwise: a nested item indented by four spaces would be code,
and a row with no header row would have no cells. On that block it tries every order of accepting
and rejecting every mark there, the new ones and the others but those apart from it (below), with
every mark left pending on the way, with the comments and highlights and without them. A decision
that one order refuses can work in another. Each state must read as the same words as the same
decisions without this change, all of the block, and once the new marks are rejected, it must have
the same bytes. A decision refused without this change must be refused with it, as nothing shows
what it would come to. Too many marks to try (more than five, or fewer in a long block, marks apart
not counted) is refused too, in words that go by the marks that are tried: when those are the new
marks only, it says to change fewer items at once, as deciding the marks apart would not help. In a
cell of a table, the marks counted are those of the cell (§3.7, "Cells apart"). It is
read on both readings of CommonMark: since 0.31 a symbol such as an emoji is punctuation, and GitHub
does not read it so yet. Emphasis is read as micromark 4.0.2 reads it: each run of `*` or `_` that
can close, left to right, pairs with the nearest run before it that can open, on what is left of the
two after the pairs made before, the rule of three included (`***word** x**y` leaves one `*` before
`word`, and 1 + 2 makes the `**` of `x**y` text); the runs between a pair are then paired among
themselves, as they are left, and are text after that. GFM's strikethrough is read in the same
pass, as micromark with `micromark-extension-gfm-strikethrough` 2.1.0 reads it: a run of one or two
`~` pairs only with a run of its own length; a run of three or more is text; a `*` or `_` next to a
`~` reads as if the `~` were a letter on the other side (a run before a `~` can open, and a run
after it can close); and each kind of run is paired in a pass of its own, the kind that comes first
in the paragraph first, so that a run left over by one pass is text for the other. The runs between
a pair are paired as above, strikethrough first.

**Marks apart.** An inline format change (a format turned on or off, a link, clearing) leaves the
marks of its block that are apart from it pending while it tries the others: words inserted, deleted,
replaced or highlighted in a paragraph of their own, which no decision can make anything but words of
that paragraph. In a list under review that is most of them. A mark is apart when

- it is an insertion, a deletion, a substitution or a highlight that accepting and rejecting decide,
  each part of it on one line, with no carrier, holding no marker of another mark and in no other mark;
- what its decisions bring into the text or take out of it (its text, the old text of a deletion or
  a substitution, the text of a highlight, which its markers stop parting from the text next to it)
  has no line break, backtick, `<`, `>`, backslash, `|` or control character;
- its paragraph is none that the change writes in, and every mark there but a comment is apart;
- every line of that paragraph starts, after its container prefix, with a letter or a digit that no
  marker holds, or for a row of a table under its delimiter row, with the row's `|` (the row then has
  a character other than `|`, `-`, `:` and white space that no mark holds, so that it never reads as
  a delimiter row; no mark is in the header or the delimiter row, and every row of the table starts
  with a `|` that no mark holds, so that the table is one whatever is decided); a line under the
  first has nothing but quote markers and white space in front of it; no line has `<` or `>` after
  its prefix;
- its first line starts a block whatever is decided, as CommonMark reads it: it is the first line of
  the block that is tried, or a blank line that no mark or edit touches is above it, or it is a row,
  or it starts a list item in every decision (below); and so does the line after its last: a blank
  line that no mark or edit touches, a list item in every decision, or, after a row, a row whose `|`
  no mark holds. A line starts a list item in every decision when its prefix and the first character
  of its text are fixed, and a bullet or the number 1 stands less than four columns in, after its
  quote markers; or anything stands less than four columns in right under a blank line that stays
  blank, with no indented code above it; or else the nearest item above it at its column or to the
  left of it, in the same quote, starts one in every decision too, with lines of text (each starting
  with a letter or a digit that no mark holds), items further in and blank lines between, and the
  line stands at that item's marker, or less than four columns past that item's text: right under
  a line of a paragraph, as a bullet or a 1 only, which alone interrupt one, unless an item further
  in is open there. A line under a blank line between them stays in that item's text, and none of
  them is code. Anything else could be more of the paragraph above: a number other than 1 can't
  interrupt a paragraph, nor a line that would be code, and a bare `-` under a line of text is a
  setext underline, a bare `*` more text;
- each run of marks next to one another on those lines stands between characters that no marker
  holds: the one before is neither a backtick nor a backslash, and the one after is no backtick, or
  the line ends there.

A mark touches what its decisions take away or bring back, and a split stands for its break: the
line break, a blank line and the prefix of the next line, which rejecting it takes away. So a split
at the end of the line before a paragraph, or before the blank line above it, touches the paragraph,
and its marks are not apart: rejecting the split would join the paragraph to the block before it.

The block reading of §3.2 reads a list marker right under a line of a paragraph as CommonMark does
where it can tell what holds the paragraph, as CommonMark's containers do. That is the nearest
line above, with no blank line between, that starts an item (also with nothing but markers after
its marker), with the items that line is in; a line above that only looks like an item, and is more
of the paragraph (`  2. b` under `- a`), holds nothing and is passed. Without one, at the start of
the body the paragraph is in no item, and after a blank line or a heading its item's text is no
further in than its first line. As far in as that item's text or further, a bullet or a 1 less than
four columns past it starts an item, and anything else is more of the paragraph: a number other
than 1 can't interrupt a paragraph, nor can a line four columns in, which would be indented code.
Left of that text the line ends the item and is in the item further out that it reaches, or at the
left edge: less than four columns past where that one's text starts, it starts an item whatever its
number, and further in it is more of the paragraph. Where the reading can't tell, it takes a bullet
or a 1 for an item, and another number only on a list it goes on, as before. That leaves these
lines read otherwise than CommonMark reads them: a bare `-` under a line of text, which is a setext
underline; a line under a blank line in a list, whose item the reading can't tell, so that a number
there left of the item's text, which goes on that list, is read as text; a line under a heading, or
in a quote under lines of another depth; and a line under more than eight lines in a row that only
look like items. So a block leaves no mark apart, and every mark is tried, when, as it is written,
a line that the block reading takes as the start of a list item right under a line of a paragraph
is not surely one to CommonMark, by the rule for a list item above, read on the lines as they are, each with the indentation written on it: a list marker with nothing but
markers after it, as an opener alone on a bullet's line (§3.3) or the deletion of an item's text,
stands for text where the markers start, after the spaces written after the marker; one with
nothing at all after it is an item that interrupts no paragraph, and ends at a blank line or at a
line left of its text. A state of the walk with such a line, which a decision made, tries every
mark. The walk, its budget and its words are then those of a format change before marks apart.

Deciding a mark apart takes its markers away and leaves its text, or puts the old text back, and
does nothing else, alike in the block with the change and without it: no marker of it starts a line
or stands alone on one, and what comes or goes starts or ends no code, comment, HTML block or cell.
So its paragraph begins and ends where it does whatever is decided, no line of it starts a block of
its own, and it starts no definition, fence, HTML block, comment or delimiter row and gives no other
row other cells. A decision of a mark apart changes the words of its own paragraph, alike with the
change and without it, and nothing that another paragraph reads as, whatever else is decided; the
reading of emphasis, code and links stays in a paragraph. The states are therefore compared piece by
piece, each paragraph of marks apart and each run of the other paragraphs between them, and pieces
that read the same read the same with the marks apart decided in any way, as what changes in them
changes alike. A paragraph of marks apart reads the same in both only if what it is read with is the
same: its markers, which a reading as code would show, are there to tell. Its markers are also there
to be hidden: while it is pending, a decision that would hide them in code or a comment is refused,
and once it is decided that decision may work. So every mark is tried, as for a block change, when
a paragraph of marks apart is, at some state, not the paragraph it was (not the same segments of
those marks, but for a highlight's, which changes no text; other visible text; or a marker of a
mark that is tried), when the pieces of a state read the same only all together, when the
definitions differ while a paragraph of marks apart has a bracket that one could make a link, or
when a decision refused with and without the change works in both with the marks apart accepted.

When format changes were new, a shortcut of this kind left out the marks of the change's own
paragraph that did not stand right next to its syntax, and tried them only all accepted and all
rejected. It was wrong on both counts: a delimiter far off in the paragraph pairs with the new one
once a deletion next to it is decided, and a decision that one order refuses works in another. Every
mark of the change's own paragraph is tried, as it reads with the change, and every state of the
marks apart is shown to read as the state with them pending.

**Marks apart for block changes.** A change of a block (its type, an item indented or outdented, a
box checked or unchecked) leaves the marks that are apart from it pending too, in a list under
review: words inserted, deleted, replaced or highlighted inside the text of other items, after the
first character of the item's text. A mark is apart from a block change when it is apart as above,
taking the edits of the change as those it makes. A mark that a decision could make reach a line's
start or a line break (one at an item's first character, or one that holds a line break, a backtick,
`<`, `>`, a backslash or `|`) is tried with the change, and counts toward the limit of the marks to
try (rule 5, above): the refusals' numbers are of the marks tried, the new marks among them. So Tab
in a list in which eight words are pending, none of them at an item's first character, is written;
with six that a decision could make reach a line's start it is refused, in the words above, with
Track Changes on, and with seven with it off.

A pending box change (`+check`, `-check`) is apart too, whoever made it, so that a checklist can be
checked item by item, as often as it has items. It is apart when it is the only mark on its item's
line, its point is the end of the line, and the item's text after the box starts with a letter or a
digit. Accepting it takes its marker away, and rejecting it takes the marker away and writes the old
character in the box: neither moves a line start or a line break, the item is a task item with the
same text either way, and the box's character is counted among what can change (it is no character
that a reading of a line start may rely on). A box change that does not meet these is tried with the
change, as before.

The proof of the marks apart above, for an inline change, does not carry over as it stands. An
inline change writes inside a paragraph, and no line starts differently for it. A block change
writes in the lines of its blocks: the syntax at the start of a line (a bullet, a number, a box, a
`#`, a `> `, the indentation of an item and of the items in it), its opener alone on a line or after
the bullet, and its closer at the end of the block. So the reading of the lines around it can
change, and three things are different.

- What the change writes counts as what changes: every edit it makes, in the lines of its blocks,
  those of the items nested in an item it moves and of the items that an outdent makes its children
  included. A paragraph that meets one is not apart. A line whose prefix, or first character, an
  edit writes is no line whose start is known, and the reading of list items (the rule for a list
  item above) takes it for none, wherever it consults it.
- A paragraph is not apart where it stands against a line that the change writes without a line it
  is sure of in between. The paragraph after a written item is apart where its own line starts an
  item whatever stands above it: a bullet, or the number 1, less than four columns in, with its
  prefix and its first character unwritten and unheld; or where it starts a numbered item, with any
  number, less than four columns in, with its prefix and first character unwritten and unheld,
  because what it is read as, an item or more of the paragraph above, depends on the lines above and
  on nothing that a mark apart can change (the proof below); or where a blank line that no mark or
  edit touches is above it. The paragraph before a written item is apart only where such a blank
  line, or such an item, stands after it: a line that the change writes is neither. So the marks of
  the item right above the one that changes are tried, and the others are left pending, those of
  the numbered items under it too.
- A line that no mark tried and no edit holds reads in every state as it was written. Deciding a
  mark of the walk writes only where its own markers stand or where its edits were: accepting takes
  its markers away, and rejecting puts back what its edits took, the old syntax, the old indentation
  and the old marker, in the lines it wrote and no others. So a line that nothing of this holds is
  not written in any state, and a blank line that nothing touches is blank in every state.

Why no decision of the marks apart can change what the walk finds. Take a state of the walk, in
which the new marks and the marks tried are decided in some way and the marks apart are pending, and
a mark apart in it, with its paragraph. (1) Its paragraph begins and ends where it does in every
state. Its first line is the first line of the block that is tried, or follows a blank line that
nothing touches, or starts an item whose prefix and first character nothing writes: such a line is
an item whatever stands above it, unless that makes it code, a fence or an HTML block, and the
change writes none of these (its syntax is the block's own, an opener that closes on its own line,
an item's marker), nor can a state of the marks tried, which the walk reads as it goes. The line
after its last is a blank line that nothing touches, or an item of this kind, which interrupts the
paragraph, or, for a row, a row. A line that reads its start from the lines above it (a line under a
blank line) consults only lines whose prefix no edit writes, down to one that is an item by itself,
so none of what it consults is a line of the change. A numbered item with a number other than 1, the
numbers below the change among them, is read from the lines above it, the lines of the change
included: it starts an item there if a list of its delimiter is open, and otherwise goes on the
paragraph above it, where a number other than 1 can't interrupt one. That reading is the same in
every state of the marks apart, which is all (1) needs of it (for a flat list, below, it is read in one pass over the lines above, once for the list): it consults the lines above, their
prefixes and the shape of their blocks (an item, a blank line, text), and every line of the
paragraphs of the marks apart has a letter or a digit for its first character and holds nothing
that decides a block (a marker, a backtick, `<`, `>`, a backslash, `|`), whatever is decided. So
deciding a mark apart in an earlier item changes none of the lines such a number reads. What does
differ between states is the state of the marks tried and of the new marks (a deleted item, a line
break), and the walk reads that: it reads each state in the file with the change and in the file
without it, and a numbered item that is an item in one and more of a paragraph in the other, or in
either only in some states, has a paragraph that is not the one it was, with other visible text or
the markers of a mark that is tried, and the walk tries every mark (below). The first line of the
region is an item whatever its number, as nothing is above it. (2) Its lines are no line
of a block of the change, and no state of the change writes in one of them: the edits and the
decisions of the change are in the lines of its own blocks. (3) The rest is the proof of the marks
apart above. Deciding a mark apart takes its markers away and leaves its text, or puts back its old
text, so it always works, alike in the file with the change and without it, and changes the words of
its own paragraph, which begins and ends as (1) says, and nothing else. The walk checks each state
as it goes, piece by piece, the paragraphs of marks apart one by one and the runs of the other
paragraphs between them, and where a state reads otherwise than the same state without the change,
or its pieces are alike only all together, it tries every mark instead. The check before the walk
(the change reads as the file without it) is made with the marks apart pending too, so that a line
which the change makes more of the paragraph before it, as lazy text, can't go unseen: the pieces
differ, and the change is refused, as it is for any change.

What the proof doesn't give. Five shapes keep marks tried, and a block change in a list under review
with more than five changes pending is refused for their count, with "The lines below would be read
again." at the end.

- A numbered item with a number other than 1, four columns in or more.
- A numbered item with a number other than 1 that is not the next item of a flat list. A list is flat
  when every line above the item, down to the start of the region, is one of these:
  - an item less than four columns in, with one delimiter (`.` or `)`) and one quoting depth
    (right-aligned numbering, ` 1.` to `10.`, and lists indented one, two or three columns are
    covered, whichever of its siblings an item stands more or less in than);
  - a wrapped line of an item, or any line in the text of the last item (indented to it or more);
  - a blank line, a heading or a rule, which end a list: a list that starts after them, or after the
    start of the region, may start with any number, and so may one after another list and a blank
    line, with whatever delimiter;
  - a paragraph, with no blank line between it and the list: then only a bullet or a 1 starts the
    list, and a number other than 1 is more of the paragraph, so the lines under it are no flat list.
- A numbered item with a number other than 1 in a list that is not flat: nested in another item,
  mixing delimiters with no blank line between (`10.` then `10)`, which Markdown reads as two lists),
  with an item whose own text starts a list or a quote, or under a closed fence, a quote or an HTML
  block, which the reading doesn't look through. Its number is read from the lines above through the
  reading of list items (`listItemAt`), which is sure of it only in the cases its comments name.
- The empty item that Markdown can't hold, which the person's own Tab or Return made (design: block
  editing, "The empty paragraph"), is open and is not in the file. The editor gives a block change
  the document with it, where it is a line that starts no known block (an empty item under a line of
  text), so every mark of the list is tried: the change leaves that item as it is, and a box
  clicked in a list with more than five changes pending while it is open is refused, in the words
  above.
- A line that the editor reads as an item and Markdown as more of the paragraph above (#139).

A numbered list in order (1, 2, 3), in any order, right-aligned or indented, that is flat is covered,
under a paragraph, a heading, a rule or a list and a blank line as at the start of a file: Tab on an
item with ten pending changes below it is written, at about the cost it has in a bulleted list (the
same for twenty). A pending change at the first character of the item above that leaves a space
(`6. {--new --} beta`) no longer reads two ways: in a flat list a number below is the next item
whatever the content column of the item above is.

Bold right after bold would be `****` once accepted. `**` after a letter and in front of punctuation
opens nothing, as in `a**(b)**`. Code around text with syntax in it (`` `*b*` ``, or `` `![a](b)` ``)
would show that syntax as words. Text in an HTML block or an indented code block is not formatted, as
it is not read as Markdown; `inside-code` is the error code. A link is not written around text with a
bracket in it or around a reference, and the address of a reference link can't be changed here. A
change that touches a line of a link reference definition or the first line of a footnote
definition (`[r]: …`, `[^1]: …`) is refused with "This line defines a link.": syntax there would
leave every link that uses it with no definition. A definition is what CommonMark reads as one: a
label, a colon, an address in angle brackets or with no space in it, and an optional title, with
nothing after it on its line. `[Note]: this is important.` is a paragraph, and so is a line under a
definition that is not its title.

**Deciding.** A decision takes the markers away and undoes the operations, and rewrites nothing else
but for the `_` below. In v0.2, accepting all changes does not re-serialize the document: what would
come out wrong is refused when the format change is written. Decisions and views agree exactly:
accepting every change, in any order, gives the newest view, and rejecting every change, in any
order, gives the original view (§8). They are compared as Markdown reads blank lines: a run of two
or more line breaks, with only spaces or tabs between them, counts as one paragraph break (a CRLF as
an LF), and blank lines at the very start and end of a view don't count. Everything else is compared
exactly: whether there is a break between two lines of text at all, a single line break, `>` and
`_`. So a decision that changes the number of blank lines in a fenced code block, or after a fence
left open at the end, or in an indented code block, is not caught. A decision whose result would not equal the view it keeps is
refused, never written, and says to decide the changes next to it first. So a decision leaves
delimiters as they are, also where taking text away brings two runs together or leaves a pair with
nothing between them, as `****` or `[](url)`: the newest view reads them so too. That can happen in
an order that the change didn't make, as when another person deletes the text of a format change,
and is no loss of text.

A format change whose syntax is in a change inside it, as when its text is deleted with its
delimiters, can't be rejected until that change is decided, and says so. Rejecting everything rejects
format changes after the other changes, which brings the syntax back. A format change that it still
can't reject stays pending, and the others are rejected. Rejecting leaves the original view as it was,
and accepting the newest view, as every decision does.

A row that a pending move writes is not in the original view, so there a decision is held to the
view of the file with the moves accepted too: the file reads as it would if the moves were decided
first. That is how text typed against the closing delimiter of a pending bold change (`**x**` and
a `q` typed after it, which is written as the substitution of `x**` by `x**q` inside the change,
the delimiter in its old text) reads alike wherever the row is (#280, #295). Rejecting the bold
change while that substitution is pending is refused in a moved row as it is anywhere, with the
words of every refused decision: decide the changes next to it first. Rejecting the substitution
first, or accepting the bold change, is possible in every order.

- Rewriting `*` as `_`, or any other rewrite that renders the same, is not a change. The
  serializer never makes one.
- A format change also covers deleted text inside its range, as in Word. Rejecting the deletion
  brings the text back with the new formatting.
- Accepting or rejecting must not leave `_` emphasis attached to a letter or digit, which renders
  literally (`re_built_`). If it would, the `_` is rewritten as `*`. The views write the same `*`
  where taking the markers of format changes away leaves the `_` against a letter, so they read as
  the decisions do.

**Blocks.** A change of a block's type is one mark on each block, `was=TYPE`, and the marks of one
change share a `group`. The mark stands where any mark that starts the block stands (§3.3): alone on
the line before a paragraph or a heading, followed by a blank line; after the bullet (and box) of a
list item; and after the `> ` of a block quote. It closes at the end of the block's last line. The
syntax of a heading is the block's, inside the mark. A bullet, a box and a `> ` are the container's:
they stand in front of the opener, and in a quote `> ` starts each of the block's lines. Rejecting
takes away the syntax the block has now and writes the old syntax back; accepting takes the markers
away.

```markdown
<!--fmt q2hw was=p-->

## A heading<!--/q2hw-->

- <!--fmt m2bd was=p-->
  An item<!--/m2bd-->

> <!--fmt n8fx was=p-->
>
> A quote, whose lines
> all start with `> `<!--/n8fx-->
```

- New syntax is the serializer's: `#` headings with one space, `- ` bullets, `1. ` numbers, `- [ ] `
  boxes, and `> ` on every line of a quote. Old syntax written otherwise is kept in the value, after
  the type: `was=ol=3.\x20`, `was=ul=*\x20`, `was=task=-\x20[x]\x20`, `was=h2=##\x20\x20`. So
  rejecting gives back the bytes. A quote whose lines don't all start with `> `, a quote that holds
  a list or another quote, a heading with closing `#`s, a setext heading and a paragraph indented by
  spaces don't change type.
- Old syntax must be what its type writes: `[-+*]` and spaces for `ul`, `\d{1,9}[.)]` and spaces for
  `ol`, a list marker, spaces, `[ ]`, `[x]` or `[X]` and spaces for `task`, `#`s of its level and
  spaces for a heading, `>` and at most one space for `quote`, and nothing for `p`. `N` is at most two
  digits, and rejecting refuses an indentation that would make the item an indented code block. A
  value that isn't one of these is kept as written and not decided, as an inline operation's is.
- A paragraph, a heading, a list item or a block quote changes into another of these at the top
  level, when it stands on its own: before it a blank line, the start of the file, or a heading, a
  thematic break or the closing fence of a fenced code block, which take no lazy line, and after it
  a blank line or the end of the file. Markdown would otherwise read the new block into the one
  next to it, as a lazy line. The same holds in the original text, with every pending change
  rejected. A paragraph under a heading, a thematic break or a closing fence is a block of its own,
  also for the marks of other changes (the line is not a line of the block above). A
  heading is one line, so a paragraph of more than one line doesn't become one. A quote of more than
  one paragraph doesn't change type.
- A block doesn't change type, indent or quote while a pending change, anyone's and your own
  included, adds or takes away a line break in it or between it and the block before or after it.
  What the block is, and where it ends, would depend on that change. Decide it first. A change holds
  a line break when its text as a view reads it has one: an insertion's or a substitution's new text
  in the newest view, a deletion's or a substitution's old text in the original view, and a split's
  break. A line break that only carries a marker is in no view, and is not one: typing at the start
  of a paragraph, or replacing its first word, writes such a line. A change that only ends at the
  end of the block before, as a paragraph or a line added there, is not between them. A deletion of
  a whole block that stands right in front of the block is as the blank line it leaves: a break in
  front of the deleted block counts, and the deletion's own does not. A numbered item that doesn't
  start at 1 can't interrupt a paragraph, so for one (now, or in the syntax a change of it keeps), a
  pending change in the lines right above it that touch it, with no blank line between, counts too,
  when in some decision of the changes there it doesn't go on with a numbered list: whether it is an
  item or text depends on them. Those are the changes that hold a line break, or that stand at the
  start of a line, in its indentation or list marker or right at the start of its text, as a
  deletion of a marker does. A blank line that a pending change wrote, or that one stands at, may
  not be there: the lines above it are read too, and so are those above a blank line that a line
  indented more than the item follows (more of an item above, as its second paragraph), or that code
  comes before. In `1. <!--split s3vb-->⏎gamma beta⏎2. delta`, `2. delta` is the list's second item
  with the split rejected, and text of the paragraph `gamma beta` with it accepted. With `1. new`
  typed under `gamma beta` as well, the newest and the original view both read `delta` as an item,
  but with the split accepted and `1. new` rejected it is text. The decisions are read line by line,
  from the top of those lines, keeping each state the list can be in: where such a change stands,
  the reading goes on both ways, the change accepted and rejected, and states that are the same are
  kept once (a state is the list's state and what the reading can see of the line so far, not its
  words, so they are few at each line however many changes stand in it). They are read as
  CommonMark reads them: a blank line keeps an item open for a paragraph indented to its text, an
  item that starts empty takes nothing after a blank line, a heading, a fence or a thematic break
  under an item is no lazy line of it and ends the list (`- - -` is a thematic break, not a bullet,
  and `- -` a bullet holding an empty one, which opens no paragraph), a line indented four columns
  past the item, after a paragraph, is more of the paragraph (as is an item numbered from 2, or an
  empty one), and after code a numbered item from 2 is text. Enter in a list, which leaves an item
  or a line of one, Backspace that joins two items, words typed, and a break above any other block
  change nothing there.
- A block doesn't change where Markdown would then read it otherwise: where a line of it would start
  a block of its own in the new block (a list marker, a `>`, a `#`, a fence, a thematic break or an
  HTML block at its start, as a heading `# 1. Intro` would as a paragraph), where a box at the start of
  its text would make a bulleted or numbered item a task, and where the block after the blank line is
  indented far enough to become the new list item's.
- A list item changes between the types of list (`ul`, `ol`, `task`) wherever it is, nested or not,
  except where a numbered item after it and the lines under it would then be read into it, where
  the lines under it would no longer be indented enough to be its own, or where a narrower bullet
  would take in lines under it that stand between the two content columns (a bullet two columns in,
  under `1. `, is a list of its own, and an item of `- [ ] `; so are a quote, a fence and a line of
  HTML there, each read at the column it starts at, its quote markers included): "This item can't
  get a narrower bullet: lines under it that are not part of it now would be read as part of it."
  (the wider direction has its own words, above). The change would read a line it does not write
  otherwise, and it is refused, not repaired, with Track Changes off as on. A line of text under a
  line of a child's paragraph, a child's fence and what its HTML holds read the same either way
  and are no reason. The lines of the item's own paragraph count as the lines they are, at every
  indent of the item: a line of text there stays lazy, and one that starts a block at a column
  between the two content columns (`  1. target` with `    - a` under it) refuses, with Track
  Changes on as off. A child of the item (not of a child) four
  columns or more past the content column of one type and less than four past the other's is a
  block in one and indented code or more of the paragraph in the other: `1. target` with
  `      - a` under it, three columns past its text, loses the child as a narrower bullet, and
  refuses with the same words. A number other than 1 can't interrupt a paragraph, so a lazy `2. a`
  reads alike in both and is no reason. A numbered item that doesn't
  start at 1 can't interrupt text: outdenting one right after text is refused, and so is outdenting
  an item that has no item under it when its old sibling, numbered otherwise than 1, would become
  its first child right under its text; and so is indenting
  one right after text where it would not be the first of a new sublist, unless the sublist above it
  is numbered with the same delimiter, which it joins with the number it has. Indenting one that
  becomes the first of a new sublist writes `1.` (the mark keeps the old number, below). Changing
  one item of a numbered list can renumber the items after it, as Markdown reads them; that is no
  change of their text.
- Its markers go only where §3.1 lets a marker go: not after a backslash at the end of a line, not
  between a hard break and the line end, and not inside a link, a tag or a code span.
- Indenting a list item moves it, and the lines under it, to the content column of the item before
  it, as that item's child. Outdenting moves it to its parent's column. In a quote (or a quote in a quote) the item is read behind its `>` markers: its indentation and
  `N` are the spaces after them, each line moves by the same number after its own markers, and a
  list whose `>` has no space after it is refused (the lines would need one the quote doesn't have).
  The mark is `was=indent=N`,
  where `N` is the number of spaces that were in front of its bullet, and it stands after the bullet
  and closes at the end of the item's last line, its children included. Rejecting moves every line of
  the mark back by the same number of spaces. The first item of a list isn't indented, and lines
  indented with tabs, or by less than an outdent takes away, are refused. A numbered item that
  doesn't start at 1 and moves in right under the text of the item above it becomes the first
  item of a new sublist, which Markdown reads as text unless it is numbered 1: the item is written
  `1.`, with the same delimiter and spaces, and the same mark keeps the number it had,
  `was=indent=0 was=ol=3.\x20`. Rejecting moves the lines back and writes that number again;
  accepting takes the mark away and keeps `1.`. The change is one change of one list item: its
  view name is Indent, and outdenting it again, with the mark still pending, takes the mark away.
- The region of a block change is the list CommonMark reads, which is what the proof of decisions
  tries: a list ends, across blank lines, where the next item's marker is of another type (another
  bullet character, or `.` and `)`), so a bulleted, a numbered and a task list one after another
  are not one region (a task list written with the same bullet as the list before it is one list).
  Where a pending change stands at either marker, or in the blank lines between them, the two
  are kept as one, as a decision of that change could make them one list.
- Checking a box is a point mark at the end of the item's first line, with no closer, and the box is
  changed in place: `- [x] Buy milk<!--fmt k3x9 +check-->`. Rejecting writes the old box back
  (`-check=X` when it was `[X]`), and accepting takes the marker away. A box in a quote is read behind the
  `>` markers, as an item's indentation is (the box of `> - [ ] milk` or `> > 1. [ ] milk`), and
  is checked and unchecked as any other, at every depth.
- Another person's pending change in the block refuses a block change, as it does an inline one. And
  while another person's block change is pending, an edit that would put a line break (as above, in
  the text a view reads), or the prefix that starts a line (`> `, a list item's indentation), into a
  pending change in that block, or between it and the block before or after it (with the lines right
  above a numbered item, as above, before the edit and after it), is refused: rejecting the block
  change takes the old syntax from the block's lines, which such a change would add or take away,
  and what the block is and where it ends would depend on that change. A line typed after a heading
  is a paragraph of its own, and after a list item more of the item; the lines of a paragraph joined
  to the block's last line would be the same. Decide their change to the block first. As for a block
  change itself, a change that only ends at the end of the block before, or only starts the block
  after, is not between them. Text typed at the start of the block's text, or over its text from
  there, goes behind their opener and its carrier, on whichever side of the hidden markers the caret
  or the range stands (§3.3), so that the block change can still be rejected once the text is
  decided; any other edit that would leave text in front of the opener on its line, or change the
  container's syntax there, is refused, because rejecting the change would no longer find the
  block's syntax there. Typing within a line of the block, at the start of its text too, and
  retyping the text of a block of one line are edits like any other. Three more edits there are
  refused, as rejecting would read the block's lines otherwise: deleting the whole text of a line of
  a block of more than one line; changing the prefix of a line (a heading's `#`s, a bullet or a box,
  `>`); and an edit after which the text of a line starts, after its prefix, with what it didn't
  before: what would start a block of its own (`#` and a space, `>`, a list marker, a fence, a
  thematic break, `|`), white space that makes it code once the change is rejected (four columns:
  four spaces typed in front of a heading's text), or white space that moves an item's content where
  the text follows a bullet in one reading of the change and not the same way in the other (a box is
  text, a number is wider, a paragraph has none) and a block is under the item, a nested list, a
  second paragraph, a quote, a fence or a heading. The space would move those blocks out of the item
  in one reading only. The line is judged as the edit leaves it, whatever was typed, so that two
  edits can't come to what one may not, as `x    ` typed and then the `x` deleted. One space in
  front of a heading's text, which Markdown reads past, and a first word deleted without its space
  under an indent change, which keeps the bullet in both readings, are edits like any other. A block
  change of your own is changed in place: changing the block back to its old type takes the mark
  away, and changing it to a third type keeps the type it was in the payload. A block that another
  pending change or a comment starts, with its opener in front of the block, doesn't change until
  that is decided, and a range over a block that can't change refuses the whole change. In the lines
  right above a numbered item, a change at the start of a line counts as a break does.
- Each item of a list is a mark of its own, and the marks in one list are tried together in every
  order, as above. What limits a change is the number of marks to try, the new ones and the pending
  changes of its region, and a region longer than about a thousand characters counts more, so these
  numbers hold for a short list. An inline format works with four other pending changes in its
  region and is refused with five, and with five items of one list at once and not six ("Change up
  to five items at a time."). A block change has a larger budget, and leaves the marks apart from
  it pending too (Marks apart for block changes, above). Of the marks that it tries, with Track
  Changes on, where it adds a mark to try, it works with five other pending changes in its list
  and is refused with six; with it off, where it adds none, it works with six and is refused with
  seven; a change of up to six items at once is checked, and seven are too many ("Change up to six
  items at a time."). A refusal for too many marks says how many stand in the region and where:
  "There are 7 pending changes in this list, too many to check this change against. Accept or
  reject some of them first."; a box click says "This box can't be changed while 7 changes in its
  list are pending…". Whether a change is in the region counts every pending change there, apart
  or not.
- With Track Changes off, the same syntax is typed and deleted, with no mark.

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
4. directly after an unescaped backslash. Visible text that ends in a backslash is written `\\`.
   The change takes in what follows instead, so that its closer does not stand there:

   - A change whose text would end in a backslash right in front of its closer takes the text after
     it into its change, as a substitution, so that the closer follows that text. In front of
     a character, that character, which the backslash escapes or stands in front of
     (`One<!--sub k3x9  -->\ <!--/k3x9-->two.`).
   - In front of a line break, the line break and the first word of the next line, past its prefix
     (`> One two<!--sub k3x9 \n> three.-->\⏎> three.<!--/k3x9-->`), past a code span or a whole
     construct that the word is in, and past a backslash that the word ends in, with the character
     after it. At the end of a block, the paragraph break and the next block's first word. At the
     end of the document, where nothing follows, the line break that ends it (§3.4).
   - Your own insertion or substitution that a backslash typed at its end, or a deletion of what
     follows one there, would leave so is changed the same way: the insertion becomes a
     substitution of the same id, and the substitution takes in more. Once its new text is text of
     yours and then its old text, with no backslash at the end of yours, as when you type on after
     the backslash or Backspace takes it, it is an insertion of the same id again, in front of the
     old text.
   - Line breaks typed right after a backslash, as Return or Shift-Return type them (with a hard
     break's backslash, and the next line's prefix, a list item's bullet or number among it), are
     written as they are in the text of the change, with no split, in your own substitution or
     insertion and in a new change (§3.4).

   Nothing can follow in front of a line that is only syntax or takes no closer: a thematic break,
   a setext underline, an empty heading, a fence, a table row, a link reference definition, one of
   CommonMark's seven starts of an HTML block (the seventh, a whole tag alone on its line, only
   after a blank line, or as the first line of a quote or an item, where it is the first block of
   that container and no paragraph goes on), a line that starts with a marker, or indented code.
   The backslash (typed, or left by a deletion) is refused with Track Changes on, in words that say
   so; where another person's marker is what follows, the words name their change. A line that
   starts with an inline tag or an autolink is text, and the change takes in its first word. A
   backslash typed at the end of a link reference definition is refused too, whatever follows. A
   deletion is refused where the next thing is another change's marker.

   No edit leaves a marker right after an unescaped backslash, in the file or in any order of
   decisions. Where the old text of a substitution ends in one and a marker of the edit follows
   its closer, or text that ends in one is replaced by more than one substitution, so that
   deciding the changes in another order gives the backslash back in front of a marker, the edit is
   refused, in words that say so or name the change whose marker it is;
5. where it would change how an emphasis delimiter flanks: on the inner side of `**`, `*` or `~~`
   only when the run's outer neighbor is a space, punctuation or a line edge, and never next to a
   `_` whose other neighbor is a letter or digit. A renderer reads a marker next to a run as
   punctuation, which can make a run that a letter is on both sides of close where it could also
   open. That is no change when the closer is one of the change's own: a run that closes an
   emphasis that the change's text opens, which the rule of three reads the same with the markers
   as without them, stays where it is typed, so that text ending in `**` before a letter is an
   insertion (`Start <!--ins k3x9-->Hello **there**<!--/k3x9-->middle`, #81). The line around the
   change is read with its markers and without them, and the change is written as it is only where
   the same delimiters pair, and every run that no pair uses up opens and closes as it did; else the
   change takes the character on one side, or on both.
   Where another mark stands against the change, with nothing between, its markers and its text
   come and go with its decisions: the change is written as it is typed only where the paragraph
   reads alike in the file and after every order of accepting and rejecting the marks that touch
   it, one after another. Else it takes the character on one side, or on both, if that reads alike
   in every order, but never a character of the text of another person's insertion or
   substitution: that is not the author's to write again (a deletion holds no text, and the change
   may stand behind its marker). Where no way reads alike, the change is refused, in words that name
   the other person's change and ask for it to be decided first;
6. between a hard break's trailing spaces or backslash and the line end. It goes before them;
7. on a line that is only syntax (thematic break, setext underline, table delimiter row, fence,
   front-matter delimiter), or after an ATX heading's closing `#`s. A line of `=` or `-` is a setext
   underline only in the container of the line of text above it: under a list item's line and to
   the left of its text, or with fewer quote markers, it would be a lazy line, which no underline
   can be, and `- ` there is the bullet of the next item;
8. inside an image, in its alt text or source. A changed image is a substitution of the whole
   image. In pandoc files, a figure caption may hold inline marks;
9. inside pandoc's `~x~` or `^x^`; after or inside `{…}` attributes; on `:::` lines; before or
   inside `[!TYPE]`; on a link reference definition line; right after `[^n]: `; between a letter
   and an emoji shortcode; or inside `{{< >}}`, `@fig-x` or `(\#fig:x)`.

A change that would put a marker in one of these places is widened instead, so that the newest and
the original text stay as they are: over the whole construct, as a substitution of it (§3.5), or by
one character where a marker would change how emphasis flanks. A marker also never cuts a run of
`*`, `_` or `~` in two. The editor refuses a change that has no place at all, such as a change
inside the prefix of the first line of the file (`- `, `> `, `##`; every other prefix is changed
together with the break in front of it, §3.4), except the deletion of all of a list marker or a
quote marker there, with its text staying (§3.4), or after a heading's closing `#`s, with the error
code `no-legal-placement`.

### 3.2 Line starts

No line of a paragraph, heading, list item, block quote, footnote, table row or HTML-block
paragraph begins with a marker after its container prefix (indentation, `>`, list bullet,
checkbox) and up to three spaces. This includes continuation and lazy lines. In CommonMark, a line
that starts with `<!--` starts an HTML block: the rest of the line renders as raw text, and in the
middle of a paragraph it splits the paragraph.

- The serializer never breaks a line in front of a marker. It keeps the marker at the end of the
  previous line.
- A change that starts at the beginning of a wrapped line does the same: its marker goes at the end
  of the previous line, and the line break goes into the change. Typing `X ` at the start of the
  second line of `one two⏎three` is `one two<!--sub ID \n-->⏎X <!--/ID-->three`, a substitution of
  the break by itself and the new text, so that both views keep the break.
- A table row that holds a marker is written with a leading `|`.
- A closer alone on a line, with no text after it, starts no line of a paragraph: the line is an
  HTML block that ends on that line. It stands after a closing fence (§3.3) and after the line
  break that a change brings at the end of the document (§3.1, 4), which the ledger follows.

### 3.3 Marks that start or end a block

A mark that starts at the beginning of a block puts its opener on the line before the block, with
nothing after it. The opener then means that the mark starts at the block's first character. The
line holds the container prefix and markers, and nothing else: nothing at top level, `> ` in a
block quote, the content indentation in a list item, and never an indented code block's four
spaces. The markers in front of the opener are the closers of marks that end where the block
starts (below).

```markdown
<!--del t6wv Note: -->

The importer ships in April.

- one
- <!--ins k3x9-->
  two<!--/k3x9-->
```

- The line break after the opener, the blank line if there is one, and the container prefix of the
  block's lines (`> `, the content indentation of a list item) belong to the opener, not to the
  text. They are hidden in every view, and they go with the opener when its mark is accepted,
  rejected or replaced by its payload. Text typed in front of the opener of another person's
  change of the block's type, quote or indent goes behind it, at the start of the block's text
  (§2.6). Marks that start one block stand one after the other, each
  alone on its line. The closers of marks that end where the block starts may stand in front of
  the opener on its line (`<!--/k3x9--><!--del w2rf …-->`), which keeps a closer from starting a
  line of its own. A closer never stands at the start of a line that has text after it. (A closer alone on
  a line, with nothing after it, is allowed: after a closing fence, and after the line break that a
  change brings at the end of the document, §3.1.) An edit
  is widened until none would (§3.2), or refused. A decision that takes away the opener in front
  of a closer (accepting or rejecting the mark, or deleting a thread) leaves no more of them than
  the file had either: the closer of a comment or a highlight goes back to the end of the line
  before, by moving the line break, the blank lines and the prefix to its other side (the mark ends
  by white space earlier, and no view changes); between two blocks, in both views, another closer
  gets a line of its own; where neither is possible, the decision is refused with the error code
  `no-legal-placement`, until the other changes at that place are decided. Nor does a decision
  make a line break the carrier of an opener: when accepting a split leaves the opener of a
  comment or a highlight last on its line, in front of the break of the split, the opener goes
  behind the break (no view changes); for any other mark the decision is refused. Nor does it let
  the carrier of a change's opener reach further than it did, over the blank lines after a marker
  that it takes away, such as the closer of a block change whose text is all deleted: the opener
  would then start the next block, and rejecting its change would join its text to that block.
  Such a decision is refused until the change is decided.
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
  their content indentation, or before front matter. Right after front matter, on the line after
  its closing line, it starts the first block of the body (§3.8).
- Nothing follows `-->` on a marker line. A block's leading spaces go after an own-line marker,
  never before it.

A mark that ends at the end of a block closes at the end of the block's last text line: before an
ATX heading's closing `#`s or its `{#id}`, and on a setext heading's text line, not its
underline. After fenced code, a thematic break or an HTML block, the closer goes on the following
line. After a table, it goes after one blank line; below a table's deletion lines (§3.7) it goes
after one blank line too, in front of the closers that stand there already.

A closing fence may have nothing but spaces after it on its line: with a marker there, the code
block would run on to the end of the file. When the new text of an insertion or a substitution
ends with a fenced code block, the line break after the closing fence, with the prefix of the
fence's lines (the content indentation in a list item, `> ` in a quote), is part of that text,
and the closer stands alone on the next line. A split right after a closing fence stands on that
line too, in front of its break. So it is when the new text ends with an indented code block, where
a closer at the end of the last line would be code, and when a blank line and more text follow the
block in it, where the split of the line break after it would be: the block is one piece of the
typed text, with no split between its lines, and it takes the line break after its last line with
the prefix of its lines, so that the closer or the split stands alone on the next line. Typed text
holds such a block only where that can be told for sure: its lines are indented four spaces past
where the text of their container starts, with blank lines between them, back to a blank line in
the typed text, or to its start at the start of a line that has a blank line or no line above it;
nothing follows the last of them on its line; and a blank line comes after it in the typed text,
or, at its end, in a list or a quote, as after a fence. Other typed text with indented code in it
is refused (`inside-code`), and so is code that the next line with text would go on.

Typed text holds a fenced code block only where it can be told for sure how CommonMark reads it:
the opening fence starts the text of a line, after a container prefix whose content column is
known, and at most three spaces, not a tab. That prefix is quote markers with a space after them,
list markers with the one to four spaces after them that the item's content starts after, or the
container of the line before; an ordered marker numbered other than 1 counts only after a blank
line or an item of its list, because it can't interrupt a paragraph. Every line of the block has
the container prefix, or is blank in the same container (`>` is no blank line in a list); the
closing fence is the opening one's character, at least as long, after at most three spaces, with
nothing after it, also in the text that follows the edit on its line. No line of the code may look
like a fence indented by four columns, which a reader would take otherwise once a decision took the
opening fence away, and the next line with text after the block may not be indented code. Any
other typed text with a line that may be a fence is refused (`no-legal-placement`).

````markdown
Some text<!--ins k3x9--><!--split w8nn-->

```py
print(1)
```
<!--/k3x9-->
````

Accepting keeps that line break: where a line break follows already, the code block has one blank
line more after it. At the top level that changes nothing that is rendered. In a list or a quote a
blank line can make a list loose, the enclosing ones too, so there the block must have a blank line
after it already, or end the text, and is refused otherwise. A split in front of the fence can't
be rejected: the fence would no longer start its line, and its closing fence would open a block
that never ends. It goes with the insertion that holds it, and an editor does not offer to reject
it. Rejecting a split behind the closer while the mark is pending is refused, because the closer would
start a line of text.

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
`Para<!--del j7mm \n\n## -->Heading text`. A change that starts at the first column of a line with
a prefix (`- `, `> `, `## `) and goes on past it changes the text after the prefix, and the prefix
stays: the block keeps its type.

**A change inside a prefix** does not touch the line break in front of the block: the digit of a
list item's number replaced by the next (the editor does that to the items below the one Enter is
pressed in), a bullet replaced by another, the `#`s of a heading. A marker can't stand in a
prefix, so the change is a substitution of the break and the prefix by the break and the new
prefix, and the old and the new text are widened by the same text: the break in front, and the
part of the prefix on either side of the change. A closer can't start the line of the block
either, so the substitution goes on to the end of the block's first word:
`Two.<!--sub k3x9 \n5. Switch-->⏎6. Switch<!--/k3x9--> between views.` Rejecting brings back every
byte, and accepting gives the break and the new prefix. Deleting a whole prefix is the same with
only the break as the new text: the line stays a line, of the paragraph above it. When the opener
would stand on the line of an empty item (`5. ` and nothing after it), a line break right after
it would be read as its carrier (§3.3): the change is refused until the item has text. The editor
makes the edits of one keystroke the last one first, so that the item that Enter adds is not there
yet when the numbers after it change, and that order is not refused. The first line of a file has
no break in front of it: a change inside its prefix is refused. A deletion of the whole first line,
when it holds only a list marker (an empty item, as Return in it takes it away), is not a change
inside a prefix: it is the deletion of the line and its break, as anywhere, and the next item's
marker or the next block's text follows on the same line. The format writes it as the join it
reads as, the first item kept and the break and marker after it deleted
(`- <!--del k3x9 \n- -->\n  two.`), which reads as `- two.` in the newest view, gives `- ` and
`- two.` back when rejected, and has one mark, so that every order of decisions reads alike. An
editor that wants the line's place left empty writes its own line breaks in front of the mark, as
they are, and the file never holds them (Return in the empty first item of a list at the start of a
file).

**The prefix of the first line, taken away.** A deletion of all of the prefix of the first line of
the body, a list marker or a quote's `>` with the white space after it, where the text of its block
stays on the line (taking the first block of a longer list or quote out of it), is the prefix's
own deletion: its text is the marker, `<!--del k3x9 - -->`, and the opener stands where the marker
was, alone on the line, for the text that stays is the block it starts: the line break and the
blank line after it are its carrier (§3.3), `<!--del k3x9 - -->\n\none\n- two`. Accepting takes the
marker, the opener and its carrier away, `one\n- two`, and rejecting writes the marker back in
their place, `- one\n- two`, so that the original is what the file was, and the newest view reads
as the file does in CommonMark, in every order, with one mark. It is written only where nothing
else could stand against it: with no other marker in front of the text or among the prefix, which
the deletion would join, or the opener would start a line that has text after it. A heading's `#`s
and the first line's indentation alone are not a prefix of this kind, and are refused as before.
A task item's box is part of the prefix (`- [ ] `). The lines below the first, up to the next blank
line, are read three ways, in the file, in the newest view and in the original view (a CRLF file as
the same file in LF), and the rule is written only where all three read alike and nothing there
turns into text of the first line or into its heading: an underline (`===`, `--`), and, because an
empty item (a bullet, or a number of any value) or an item numbered other than 1 can't interrupt a
paragraph, such an item once the first item's marker is gone (`1. one\n2. two` leaves `one\n2. two`,
one paragraph). Such an item is let through only where no marker is on the lines below, so that the
file, the newest and the original view read it alike. A pending deletion that empties an item reads as
an item with text in the file and as an empty item in the view, and is refused, as is any mark on
those lines in front of such an item. A refusal says that the changes below are to be decided first,
or that the marker can be taken out with Track Changes off. The editor keeps the first item of a
list in its list while a line below it would read as text of it, and says so.

**An inserted break** is a `split` point marker at the end of the first block. Rejecting it
removes the break and the next block's prefix. An inserted hard line break is a `split` before the
break syntax; a deleted hard break is a deletion whose payload is the break.

```markdown
The first half.<!--split s3vb-->

The second half.
```

The break is one line break, the blank line after it if there is one, and the prefix of the next
block (`- `, `> `, `## `, or the indentation of a list item's lines: in a quote in a list item, the
next line's `  > `, or its `  ` alone, the white space in front of the quote's markers, as Backspace
leaves it when it takes the `> ` that Enter typed there). Right after the line break, a setext
underline in the container of the split's line, with a blank line after it, is a part of the break
too, with its line break: Return in the middle of a setext heading gives the first half the same
underline, `He<!--split s3vb-->⏎===⏎⏎ad⏎===`, which CommonMark and GitHub read as the heading it is
in the newest view, and rejecting the split takes the underline away with the rest of its break
(review I6). A marker after the underline would make a paragraph of it (§3.1). So a line of `=` or
`-` with a blank line after it, typed or in the text, is never a line of its own behind a split, and
a line break typed in front of a `===` that ends a paragraph, which would make that paragraph a
setext heading, is refused with Track Changes on. So is the join of the block below onto a setext heading, which
would write the underline again behind the joined text, as an insertion whose closer ends the
underline's line, and no order of the marks gives a line of only `=` or `-` there: a renderer reads
that line as text, and the newest view as a heading. A line break typed inside a paragraph is
a split too, and so is each break in typed text, but for the breaks inside a fenced code block,
which are its text (§3.5); breaks after the last typed text go behind the insertion that holds it,
so that its closer does not start a line. When the new text of an insertion ends with a line break
of one line (and the prefix of its container) and the next line is a list item, that line break is
the last of the text, and the closer stands alone on the line after it, as after a fence: it is the
line break that parts the item from the text above it with a blank line, which an item numbered
other than 1 needs (`X` and `3. two` on two lines are one paragraph), and rejecting the change takes
it away with the text. It is so where Return on an empty item in the middle of a list leaves an
empty paragraph between two lists, and where Delete joins a paragraph with the first item of a list
numbered from another number (review I5). Behind text that is itself an item of that list, where a
blank line would make the list loose, the line break stays what it was. Line breaks alone, with no text typed in them, are written so
too, behind text that is no item of that list (Return on the first item of a list, which is empty): with an item of the list above them
the newest view reads the blank lines as a loose list, and the closer in front of the next item would
end it for every other reader, so there they are refused. Accepting a split
removes the marker. Rejecting it removes the marker and the break, and the original view leaves the
break out.

**A blank line and an item in an item's text.** An empty item can't start a list under a line of
text, so Return at the start of the first item of a list that stands under the text of its own
item, which puts an empty item above it, puts a blank line between the text and the new list, and
the item that holds them reads as loose, in the newest view and in the file. It is one insertion at
the end of the line above, the blank line, the indentation and the new item's marker, which the
format writes as one split whose break is all of that
(`- One\n  Beta<!--split k3x9-->\n\n  + \n  + delta`). Written as two changes, the blank line
would be an insertion whose closer stands on it, a line that is no blank line to a reader that
doesn't know the markers, and the item would be tight in the file and loose in the newest view.
As one split the blank line is a line of the file as it is, and rejecting the split takes the blank
line and the item away with it, the item above tight again.

**Return next to a hard line break.** An edit that replaces a hard break (a backslash that no
other backslash escapes, or two spaces or more, at the end of a line, with its line break and the
prefix of the next line) by a paragraph break, as Return on either side of it does, is written
whole: kept as the line break the two share, with a split in front of it, it would leave the
backslash as text at the end of a paragraph. A backslash that another escapes (`One\\`) is text,
and no hard break. In the original text the edit is a substitution of the break by the paragraph
break, which goes on to the end of the first word of the next line, and past a whole construct or
a run of emphasis that the word is in, where its closer may stand (§3.1), as a change inside a
prefix does (above): `One <!--sub k3x9 \\\ntwo.-->\n\ntwo.<!--/k3x9-->`, and
`One <!--sub k3x9 \\\n**two**-->\n\n**two**<!--/k3x9-->`. In the break of your own pending split,
the split takes the paragraph break as its break and stays: `One <!--split s3vb-->\n\ntwo.`. Where
the closer has no place on the next line, the edit goes to the rules below, which refuse it. In
another person's pending hard break it is refused until that change is decided: a substitution
after their marker, or a deletion of their break with a split of yours, reads otherwise in some
order of the decisions (rejecting their split leaves the hard break, or takes away yours).

**Keys next to a hard break's backslash.** A change that would start right after a hard break's
backslash (`One\⏎two.`, with a character typed there, or Delete) starts in front of the backslash
instead: the backslash is the first character of its old and its new text, so that rejecting it
gives back the hard break exactly (`One<!--sub k3x9 \-->\x<!--/k3x9-->⏎two.`, and for Delete
`One<!--sub k3x9 \\\nt-->\t<!--/k3x9-->wo.`). Where the backslash is the first text of its line, the
opener in front of it would start the line (§3.2): the key is refused. A backslash typed in front of
a hard break's own (`One‸\⏎two`) is that change: `One<!--sub k3x9 \-->\\<!--/k3x9-->⏎two`. Line
breaks typed right after a backslash, as Return, Shift-Return and Enter in a quote or an item type
them, are text of the change, with no split, in a new change as in your own (§3.1): the change goes
on past the line break that is there, to the end of the first word of the next line, past a code
span that the word is in (`One<!--sub k3x9 \\\ntwo.-->\⏎⏎two.<!--/k3x9-->`, and after a backslash
in the middle of a line `C:<!--sub k3x9 \U-->\⏎U<!--/k3x9-->sers`). Enter in front of a space that
follows a backslash typed in your own change takes the space and types its break in the change's
text; the change then takes in the word after its closer, so that the closer does not start the
line, and so does a break typed between the two backslashes of your own `\\`
(`- One two<!--sub k3x9  x--> C:\⏎- x<!--/k3x9-->`). The two trailing spaces of a hard break take no
marker among them or behind them (§3.1, 6): a change that would stand among them starts in front of
them, and one that would end behind them goes on past the line break, to the end of the first word
of the next line (`One<!--sub k3x9   \ntwo-->\  ⏎two<!--/k3x9-->`).

**A hard break typed behind a pending deletion.** A backslash typed at the end of a line that ends
in the marker of a pending deletion, in front of the line's soft break (Shift-Return with the caret
in front of the marker, which no one sees: the caret steps over a deletion), goes behind the marker
and is the same change as any backslash in front of a line break: it takes the break and the first
word of the next line, `one alph<!--del k3x9 a--><!--sub w8nn \nx-->\⏎x<!--/w8nn--> café`. No
marker is right after the backslash, the deletion's marker is not touched, and rejecting either
change leaves the other as it was, in every order, so that the original view is `one alpha⏎x café`
and the newest `one alph\⏎x café`. The same typed in front of the marker would put the line break
inside the text it ends, in front of the deletion, and is not written.

**A backslash typed at the end of the document.** Where nothing follows, the change takes the
line break that ends the block, and its closer stands alone on the line after the backslash, where
no block follows to read it with, as after a closing fence (§3.3): `One two<!--sub k3x9 \n-->\⏎<!--/k3x9-->`.
A body ends where its ledger begins, and the line breaks that part the two are the ledger's (§2.5), so
a body whose last block ends the text has none to take: the change brings a line break of its own, the
last of its text, and is an insertion: `One two<!--ins k3x9-->\⏎<!--/k3x9-->`. Rejecting it gives back
the text as it was, and the other orders of decisions read the same. The line break that the change
brought goes when its text no longer ends in a backslash (as the substitution that a backslash made
is an insertion again when you type on), and Backspace of the only backslash takes the insertion
away with it. Two other forms were weighed against the oracle (#223): the backslash written as
`\\`, which renders the same, but writes what was not typed, and the next key can't tell it from a
`\\` typed on purpose, to turn it back into one; and the key held back until the next one, which Return,
a change of window, saving and a switch of view would each have to answer. The paragraph breaks and the
next block's first word are taken where a block follows, as before a line break.

The closer alone on the line stands only as the last line of the body. A key that leaves anything
after it in a list item (a bullet, an indented line, a number: Return in an item gives them),
or puts a marker after the prefix of a line, is refused, in words that say so: in a list the
line with the marker is not a blank line to a renderer that does not know the markers, which
would end the item, or the list, or loosen it, where the newest view does not. In a paragraph
or a quote it reads alike, and is written.

**Deleting the break of a split.** Deleting the break of your own pending split (Backspace at the
start of the second half, after Enter) cancels the split, as in §3.6: the marker, the break and the
ledger entry go, and the paragraph is whole again. That is so where the first half is an empty
block, as Enter in front of the first word of a list item or a heading leaves it (`- ` or `## ` and
the marker): no text of that block is deleted, so the block is not deleted with its break (below),
and the item or the heading is whole again. Backspace takes one line break: after Enter
twice, whose break has two, the first Backspace takes one of them and the split stays (below), and
the second cancels it. Deleting the break of someone else's pending split is a join: the deletion
of the break stands right after the split's marker, with the break as its payload
(`One<!--split s3vb--><!--del d3x9 \n\n-->two`). It belongs to the split. The original view leaves
it out, and rejecting the split removes both. Accepting the split leaves the deletion pending.

**Typing on the line after a break.** Text typed right after the break of your own pending split
becomes one insertion with the split, as if the break and the text had been typed together:
`One<!--ins k3x9--><!--split w8nn-->\nX<!--/k3x9-->two`. So it is right after the bullet or number
that the break wrote, as after Enter at the start of an item's text, at any item of the list:
`- one⏎- <!--ins k3x9--><!--split w8nn-->⏎- X<!--/k3x9-->two` (#143). After another person's split whose break
has a blank line, the text starts a block (§3.3). On a wrapped line after the break of another
person's split, typing is refused until that change is decided.

**Typing in a break.** Text typed right after a split's marker, at the end of its line, goes in
front of the marker, the same place to the eye. Text typed at the start of the line after the break,
in front of that line's prefix, goes after the prefix, as text typed in a prefix does. Text typed
anywhere else in the break of your own pending split, on the blank line of a paragraph break or in
the syntax of a hard break, stays where it is typed: the split is cancelled and its break typed
again with the text, as one insertion, as if the two had been typed together. On the blank line, the
text is a line of the split's block, after the prefix its lines have (`> ` in a quote, the
indentation of a list item's lines). Enter twice in the middle of `One two` and `new` on the blank
line give `One <!--ins k3x9--><!--split w8nn-->\nnew<!--/k3x9--><!--split p3qz-->\ntwo`. Your splits
right behind the break, as Enter three times leaves them, are typed again with it, so that the line
break after the text does not stand right in front of theirs. White space alone typed on the blank
line is a part of the break, which still reads as a blank line. An edit of the break of your own
split after which the break still has a line break, and reads as long as what is written, changes
the break, and the split stays: white space taken out of it (such a space, or a hard break's
spaces), or the prefix of the line after it taken out or made white space, as Backspace right after
Enter does in a quote (it takes the new line's `> ` away) or a list item (it makes the bullet the
item's indentation): `> One<!--split s3vb-->\ntwo.`; or one of the two line breaks of a blank line
taken out, as Backspace after Enter twice does at the start of the second half or on the blank
line: `One<!--split s3vb-->\ntwo`. Where your split stands right behind the break, as Enter three
times leaves it, the break so shortened takes that split's in, as far as it reads, as when a
deletion brings two of your splits together (below). Where the break so edited is line breaks and
white space, or blank lines of the quote its line is in where the quote ends there, that it would
not read as written, as Backspace after Enter at the end of the last item of a list leaves it (the
bullet made the item's indentation, the new line a blank line, of the quote in a quote, which the
break would take with the line break after it), and Enter would write them plain at the
split's place, with a blank line in front of the next block already, blocks around that read the
same with the line breaks as without them (below), or the end of the text, the split is cancelled
and the break stays, plain: a blank line there changes nothing that is rendered, and Backspace takes
its white space and its line break out plain too, leaving the blocks as far apart as the original
has them. Where the next block follows with no blank line and the blocks would read otherwise, the
split is cancelled as before.
Taking the last line break out of the break cancels the split. In another person's break, the text
is refused until that change is decided, white space too: it would part the break, and rejecting the
split would then take one of its line breaks away and leave the other. Deleting the text again gives
the blank line back: where a deletion brings two of your splits together, the second right behind
the first's break, the first's break takes the second's in, as far as it reads, and the second's
marker goes, or moves behind it with the rest of its break, as Enter makes them. Deleting such a
line together with a line break of it leaves the other line break, as in plain text: a deletion of
nothing but your own pending text and splits writes no marker, wherever it starts. Where the marker
of a comment stands in it, which stays, the deletion is placed as any change is.

**Enter twice.** A line break typed right after the break of your own pending split makes that
break longer and leaves one split: Enter twice in the middle of a paragraph is one split whose
break is a blank line (`One<!--split s3vb-->\n\ntwo`), and rejecting it brings the paragraph back.
So does a line break typed right in front of that break (Enter at the end of the line above it),
when the two read the same in either order, up to the white space next to their line breaks, as
line breaks alone do. Where the break would not be read as long as it was written (it is a blank
line already, or a bullet follows it), or when the split is another person's, the new break is a
split of its own:

- next to a break that is a blank line already, behind it, on the line after the blank line:
  `One<!--split s3vb-->\n\n<!--split w8nn-->\ntwo`. Where your own split stands there already, its
  break grows instead: Enter twice at the end of the first half of a split paragraph gives
  `One<!--split s3vb-->\n\n<!--split w8nn-->\n\ntwo`, as four Enters in a row do;
- in front of a break that a bullet follows, in front of it, where the bullet keeps the two lines
  apart, or behind it when the new break carries a list number (the editor numbered it for the
  place behind);
- next to another person's break of one line, nowhere: Enter is refused until that change is
  decided.

**Two breaks side by side.** A split's break is read when the split is decided, and it takes a
blank line that follows it and the prefix of the line it reads last; how much of that line's
indentation it takes depends on the prefix of the split's own line. Where the marker of another
change stands in the text that reading looks at, deciding that change can make the break read
otherwise, and the same decisions in different orders give different text. A split alone on the
line after another split's break of one line is that: accepted, it leaves a blank line that the
other's break then takes in, and rejecting the other takes away both line breaks. So no edit leaves
a split whose break could read otherwise once the changes next to it are decided:

- a break of one line, followed by a line that starts, behind its quote markers and indentation,
  with another change's marker, unless the split stands alone on its line and every way of deciding
  the changes there reads the break the same (the opener of a block, with its text after it, does);
- a split with no line break right after it, followed by other changes (their markers, and the text
  of an insertion or a substitution) and the syntax of a hard break (spaces, or a backslash), and
  then a line break, as the deletion of its break is when another split stands behind it; or the
  deletion of its break with a change after it that, once the deletion is rejected, makes the break
  it gives back read longer than the one it deleted;
- a change behind the prefix characters of the line the break reads its prefix from, or of the
  split's own line in front of it, that once decided leaves white space or syntax there that makes
  the break read otherwise, as a bullet typed on the line of a split that stands behind a paragraph
  break; and white space that other changes put in front of a split with nothing else on its line,
  as a space typed there;
- other splits in front of the split's own line, one line up after the other: the split whose
  break ends on that line, in front of the split, then the split whose break ends on the line of
  its marker, and so on. Rejecting the nearest k of them takes their line breaks away, and the line
  goes on from the line of the kth one's marker, whose prefix can read the break otherwise. In
  `- one<!--split s3vb-->⏎new<!--split w8nn-->⏎  two`, the second break takes the item's
  indentation of `  two` once the first split is rejected, and leaves it while the first is
  pending; so does the third break of `- one<!--split s3vb-->⏎new<!--split k3x9-->⏎x<!--split
  w8nn-->⏎  two` once the first two are rejected.

Such an edit is refused (`no-legal-placement`), with Track Changes on or off, until that change is
decided, as is Enter where a new split has no other legal form (a hard break's two spaces before a
marker, a line that is only syntax, a marker that would start a line). The rule is counted for each
split: an edit is refused when it gives a split such a break that it did not have, so a file that
has such a pair already, as an older one may, keeps it, and edits elsewhere are not refused for it.

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

The blocks around the deleted ones stay as they are. A deleted block takes its own prefix with it,
so that `## Commands` followed by a paragraph leaves the paragraph a paragraph, and a quote line
leaves no `> ` in front of what comes after. When the block after it is the next item of the same
list or quote, its prefix stays in front of the deletion instead and takes the place of the next
item's, because a marker can't stand between two items:
`- one`, `- two`, `- three` without `- two` is `- one`⏎`- <!--del k3x9 two\n- -->`⏎`  three`. The
break that goes is the one after the blocks, or the one before them when that is the stronger of
the two, so that the last item of a list and the paragraph after it stay a list and a paragraph.

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

- A split that would leave an empty block isn't written until that block has content. Line
  breaks typed at a block boundary are plain instead: Enter at the end of a paragraph, a heading
  or the last item of a list, on a blank line, in front of the first block or at the end of the
  text writes the line breaks and no mark, where blank lines change nothing that is rendered. Typed at
  the end of a line's text, white space after the last line break is a part of them where it is no
  wider than that line's indentation: the text column of a numbered item (`   `) after its
  paragraph indented by four, as numbered steps are written, is a blank line too. Wider white
  space, or white space in front of text, which could make it code, is no part of them. The original text has them as well. That is not so inside fenced or indented code, an HTML comment
  or a raw-text HTML block, where a blank line is content (markers are not read there, so Enter is
  refused); between the items of a tight list, which a blank line makes loose; and in front of a
  wrapped line that starts with a number other than 1, which is text until a blank line makes it a
  list. There Enter is a split, or refused where a break has no form that keeps the next bullet.
  Where the original text goes on, Enter is a split: in the middle of a block, next to a pending
  split, and in front of a pending deletion of the rest of the paragraph.
- Enter at the end of the last line of a quote, which the editor types as a line break and the
  quote's `> ` (`> > ` in a quote in a quote, `  > ` in a quote in a list item), is plain too, when
  the quote ends there, with a line that has nothing on it or with the text: the new line goes on
  from the line above in its quote, as deep, and is a blank line of the quote, which changes
  nothing that is rendered either. A split can't hold it. Its break would take the blank line after
  it, and with it the line break that ends the new line, which is the one in front of the next
  block: rejecting the split would make that block a line of the quote. So is Enter at the end of
  a paragraph of a quote that a blank line of the same quote follows, as deep, as between two
  paragraphs of the quote (`> one⏎>⏎> two`): the new line stands next to that blank line, and a
  renderer reads the two as one; its markers make no list that the quote is in loose. A line of
  quote markers with no line of its quote right above it, as after a blank line, or deeper than
  the line above, opens a quote of its own, a block that a renderer shows even with nothing in it:
  it is never written plain. Whether a line is in a quote is read from the first line of its block
  down: a `>` at the start of a line in an HTML block or in code is text of that block, and where
  the quote holds an HTML block, a fence or indented code, what a blank line does there is not read
  either; there the edit is tracked as anywhere else. Only a fence or a raw block still open at the
  line is code there, and only the lines that CommonMark starts an HTML block with (a tag of a
  block element, a comment, a declaration, a tag alone on its line) are raw: a quote that holds a
  closed fenced block, or an HTML block that a blank line of the quote ended, or a `<` that is an
  autolink or a tag with text after it, is an ordinary quote, and Enter at the end of its last
  line is plain (#130). At the end of the last item of a list, Enter
  types a bullet, whose line is no blank line, and is a split.
- Backspace over line breaks that were typed plain, and nothing else, takes them out as they were
  put in, with no mark, when the blocks around them stay apart: with a blank line between them, or
  with one line break between two blocks that read the same without a blank line as with one. That
  is what the text means, not what a line looks like: the blocks from the line at the top level
  above them to the one below, read as CommonMark reads them, are the same blocks, of the same
  kinds, with the same text, in the same containers (quotes, with their lazy lines, and list items),
  and the two are not both in list items, whose list a blank line between them makes loose. A
  heading, a fence, a thematic break or a quote after a paragraph keeps apart from it; a quote after
  a lazy line of a quote goes on with that quote, and a line that only looks like a block (a fence
  whose info string has a backtick, `<!` with no comment or letter after it, a tag of its own) is a
  line of the paragraph above. As in CommonMark, only spaces and tabs make a line blank: a line of a
  no-break space, a form feed or other white space is a line of text, and a carriage return alone
  ends a line. Where a mark other than a comment is near, or the reading meets what it does not know
  (a tab, a carriage return alone, an empty item, a link reference definition, a tag alone on its
  line), it is a join, tracked, as anywhere else. Enter and then Backspace leaves the file as it
  was, and is not a join. So does Backspace over the white
  space of a blank line, but for the indentation in front of a quote marker, and over the quote
  markers of a blank line that goes on from the line above in its quote, one quote at a time: at the
  end of a quote, the quote ends a line earlier.
- Taking out a whole run of a quote's blank lines at once, in one edit, is plain too: the line
  breaks, the quote markers and the spaces of lines that have nothing else on them, at the end of
  a line of the quote's text, where the blocks around them read the same without the run as with
  it (the editor's Return in the empty paragraph at the end of a quote, a quote in a quote or in a
  list item, writes them so). Backspace over them one quote at a time is the same text. Where the
  quote goes on after the run, or the first line of it opens a quote of its own, the edit is
  tracked or refused as below. The editor types a paragraph break as its two line breaks at once;
  it is read as Enter twice is.
- Where the quote goes on after such a line, taking its quote markers out parts the quote in two,
  which a reader sees, and no marker can stand in a prefix. Where the line is the quote's only blank
  line there, that is refused. Where it is one of a run of blank lines of the same quote, as deep,
  however the run came to be (Enter at the end of a paragraph of the quote writes one, above; the
  file may have one), and text of the quote follows the run, the parted quote is a substitution of
  the break, from the end of the line above the run to the end of the first word of the line after
  it (behind a heading's `#`s), which must be a plain word for the closer to stand after. Its new
  text is the break as it now is; its old text is the break with the line taken out, which reads
  the run as one line and renders the same, so the original text loses that line, plain:
  `> one<!--sub k3x9 \n>\n> two-->⏎⏎>⏎> two<!--/k3x9-->`. Its opener, the edit and its closer are
  written around the text that stays, so that another part of the same keystroke finds its text in
  the new text, as the editor's third Enter there, which leaves the quote, takes the markers of two
  new lines at once. Backspace on the line break then gives the old text back, and the substitution
  goes (§3.6): Enter and Backspace leave the file as it was. So it goes where the new text comes to
  read as the old one with a run of the quote's blank lines read as one, as after Enter three times
  and the Backspaces, and the new text stays, plain. The quote markers of a line that opens a quote
  of its own are a block, and taking them out is a tracked deletion.
- Text typed on a blank line that has a blank line above it and below it (Enter twice, or Enter on
  a blank line) is a block of its own: a whole-block insertion, with its opener on a line of its
  own (§3.3). On the line right below a paragraph, as after one Enter, it continues that
  paragraph, as in Markdown, and is a substitution of the line break by itself and the text
  (§3.2). After a heading, which is one line, it is a block.
- A line break typed in front of markers is written after them, so that none starts the new line:
  `the <!--ins k3x9--><!--split s3vb-->\nnew` and not `the <!--split s3vb-->\n<!--ins k3x9-->new`.
  With spaces and then a marker after it, a break of one line is refused, and one with a blank
  line gives the marker a line of its own.
- Deleting all of a block's text deletes the block together with one adjacent break. The first
  block of a file, or of the body after front matter (§3.8), goes with the break after it when
  another block follows: blank lines in front of it are no break between blocks. Deleting all
  the text of a block's first line, when more lines follow, takes the line break after it, and the
  next line's text takes its place. Text that is all your own pending insertion is taken away
  instead, as in §3.6, with no block or break of the original deleted, when that leaves the
  insertion nothing, or nothing but your splits, which stay behind the text of the line above: the
  text is as it was before it was typed. The letter typed on the new item after Enter at the end of
  a list item, in one insertion with the split, leaves the new item, empty, as Enter made it; the
  letter typed on the line after a heading, or after Enter twice, a block of its own, leaves the
  line breaks that Enter wrote, with no mark.
- A replacement that takes away all the text of such a line but keeps the line break after it, as
  an agent's `str_replace` can, asks for a line with nothing but white space on it. Where the closer
  of another person's mark stays on that line, the deletion stands there, as asked. Otherwise its
  marker would be alone on the line and take the line break for its carrier (§3.3). A line of white
  space is a blank line, so the line goes with its break when the next line has the same white
  space in front of its text, which the views read as asked; any other such replacement is refused.
- A block whose only content is pending marks may have no visible text for a while. When its last
  mark is decided and nothing is left, the block goes with its break. If that break is someone
  else's pending split, the split goes too.

**Interactions:**

- Accepting a whole-block deletion also accepts the other deletions inside that block.
- Rejecting a deletion inside a block that someone else deleted whole brings the block back: the
  break-and-prefix part of the other deletion is rejected too, and the editor says so.
- A decision leaves the view it decides toward as it is: accepting leaves the newest text,
  rejecting the original, and dismissing a highlight or deleting a thread both. When a marker that
  goes would let the text next to it be read otherwise, and no form keeps the text, the decision
  is refused (`no-legal-placement`) until the change next to it is decided. That is a `* ` that a
  marker kept from being a bullet, which the break of a split would then take, so that rejecting
  the split took text that is not its own; or a line break that would become the carrier of an
  opener (§3.3).
- Joining or deleting across a block with a pending block-format change is refused until that
  change is decided. So is deleting someone else's pending inserted break together with other
  text; the break alone is a join (above).
- **Replacing everything** (select all, type) is a substitution of everything after the prefix of
  the first block, with the old text, its breaks and the prefixes of the other blocks as payload,
  and the new text as content, each break in it a split: `# <!--sub k3x9 Title\n\nFirst para.-->New
  text<!--/k3x9-->`. The first block keeps its type, as in a deletion across blocks. Typing
  nothing makes it one deletion. Where other people's changes are in it, it is a deletion split
  around them, and an insertion after it (§3.6). Rejecting brings every byte back.
- **An agent's `str_replace` that takes the line break in front of a block and keeps that block's
  marker** (`## `, `> `, `- ` or `1. `) in the new text asks for the marker as text. A deletion
  of the break takes the marker of the block that follows it, so the marker is written again as
  text, in the same change as the break: `two<!--sub s7q7 \n\n## --> ## <!--/s7q7-->Head` reads
  `two ## Head` in the newest view. This holds for each form the edit may be written in (joined,
  whole-block or word by word). Where a change takes such a break, the newest view is checked
  against the text that was asked for (apart from white space around breaks and the numbers of a
  list); if it still reads otherwise the form is refused, and the edit when no form can be written
  (`no-legal-placement`). Edits that take no break in front of a marker are not checked this way.
- **An agent's `str_replace` at a pending insertion**, anyone's, leaves that insertion rejectable.
  Where the insertion could be rejected before the edit and rejecting it would be refused after,
  whatever the cause, the edit is refused (`no-legal-placement`) and writes nothing.

### 3.5 Atomic content

Some content can't hold markers. A change to it replaces it whole, as a substitution:

- inline: code spans, math, autolinks, footnote references, images, link destinations (link text
  takes marks), inline HTML tags, and HTML comments that aren't Redlines markers;
- blocks: fenced code blocks (R Markdown and Quarto chunks included), display math, raw-text HTML
  elements (`<script>`, `<style>`, `<textarea>`, `<pre>`, `<title>`), Quarto shortcodes
  (`{{< … >}}`) and attribute blocks (`{#fig-plot}`).

A changed code block is a whole-block substitution with the old block as payload, its backticks
escaped so knitr can't run it. The fence holds the newest code, so the document still runs.

This is rule 9. It holds for fenced code (R Markdown and Quarto chunks too), indented code, display
math (`$$x = 1$$` in a paragraph, or a line of `$$`, the math, a line of `$$`, blank lines in it
allowed) and the raw-text elements `script`, `style`, `pre`
and `textarea`, and for an edit of any kind inside the code: a letter, a line break, a deletion, a
replaced selection. The block is written as a block that starts a mark and ends one (§3.3), the
opener alone on the line before it and the closer alone on the line after it:

````markdown
Intro.

<!--sub k3x9 \x60\x60\x60js\nlet a = 1;\n\x60\x60\x60\n-->

```js
let a = 2;
```
<!--/k3x9-->
Next paragraph.
````

- The payload is the whole old block, from its fence to its closing fence (for indented code, the
  lines with their indentation), in the encoding of §2.5. Where a blank line follows the block at
  the top level, the closer stands in that blank line and the payload ends with the block's line
  break, so that both views, the accepted file and the rejected one keep as many blank lines as the
  file had; the example above is that form. Otherwise (the next line is text, or the block is in a
  quote or a list item) the closer stands alone on the line after the closing fence, with the
  container's prefix, and accepting leaves one blank line more, as any closer after a closing fence
  does (§3.3). Rejecting gives the old block back, byte for byte. In a quote or a list item the
  opener stands on a line of its own with the container's prefix, and every line of the block keeps
  it.
- The code of a raw-text element is what stands between its opening tag's `>` and its closing tag
  (also on one line: `<title>Docs</title>`); of display math, what stands between its two `$$`.
  A change on a fence's line, in a tag, on a `$$` line outside the two `$$`, is not a change of the
  code, and is refused (`no-legal-placement`): "A tracked change can't go on the line that opens or
  closes code, math or raw text." No marker is ever written inside a block. So is an edit that
  would end the block: a line of the code that closes the fence, `$$` or the closing tag, a line of
  indented code that is not indented, or a line without the container's prefix ("This would end
  the code block it is typed in."). An edit that crosses a block's edge is an edit of the text
  around it and the block, and is refused as before.
- Indented code that someone else's pending deletion of the blank line above it joins to the text
  above (it is code in the original text and text of that block in the newest) takes no key until
  it is decided: the edit is refused, naming the person, as for a marker in the block. Your own
  marks never refuse.
- Against the `$$` of display math, at the exact start of the opening line or the exact end of the
  closing line, only line breaks are written (as the text around the block), with the prefixes of
  the container's lines when the math is in a quote (`\n>\n> `) or a list item; text typed there
  is refused. The line that Return at the end of indented code opens is no part of the block until
  something that is not white space is typed on it; then it is code, and the substitution's payload
  is the block without it.
- Under a closing fence, line breaks are written plain at the top level, in a quote and in a list
  item, in LF and CRLF files alike.
- A marker anywhere in a block's range, its fence or tag lines and what follows the closing tag on
  its line included, is a pending change in the code, and the edit is refused, naming the person
  ("Bo Chen's pending change is in this code block. Decide it first, or turn off Track Changes.";
  "Your pending change…" for your own, except the substitution of this block that the edit goes
  on through, below).
- A block whose line breaks are not all the file's (a CRLF line in an LF block) is refused: the
  payload gives one kind back ("…line breaks that the rest of the file doesn't…").
- Further keystrokes of the author in a block that their own pending insertion or substitution
  holds edit the newest code and make no mark: the pending change already holds the block, and its
  payload is still the old block. The same goes for a block inside an insertion of the author's
  that holds more than the block.
- Another person's pending insertion or substitution that holds the block is theirs to decide
  first. The edit is refused (`no-legal-placement`) and names them: "This would change how Bo
  Chen's insertion reads. Decide it first, or turn off Track Changes." No form of a second
  substitution in the new text of a first reads the same in every order of decisions.
- Indented code is changed this way at the top level only, and only when no marker stands in the
  block or in the lines between it and the text above it, where a change that adds or takes away a
  blank line would make it code in one view and text in the other (§2.1). Not built yet, and
  refused in words that name the code ("A tracked change can't go in code that starts a list item
  yet. Turn off Track Changes to edit it."; "…in indented code in a list item or a quote yet…"):
  fenced code that starts an item of a list (`- ```js`), and indented code in a list item or a
  quote. With Track Changes off every key works in them as in any code. `pre` and `title` (and the
  other raw-text elements) inside a quote or a list item are not read as raw text yet (#284): the
  scan finds raw text only where it starts at the left edge, so a change there is written as in
  any HTML block, and the promise that no marker goes inside them holds at the top level only. A `title` element is raw
  text like the others, where its closing tag comes before a blank line. Front matter is never
  touched by this rule (§3.8).

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
the new one; typing at its start or end goes before or after it. A mark written in several
segments repeats its kind and id in each segment. Line breaks after the last typed text go into the
second segment, behind its opener, as splits of the new text's author, so that the opener does not
start the line after them: `<!--/k3x9--><!--ins w8nn-->x<!--/w8nn--><!--ins k3x9--><!--split
p3qz-->⏎words<!--/k3x9-->`.

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

**Editing your own pending change** changes it in place, as in Word, without a new mark. Typing
at the start or the end of your own insertion extends it, and deleting all of its text removes the
insertion and its ledger entry. A deletion next to your own deletion joins it. Deleting text and
typing the same text again cancels the deletion. Deleting text from your own substitution until its
new text is its old text again removes the substitution and its ledger entry, and the old text stays
as it was, as when the text typed on the line after Enter at the end of a block is deleted again.
Text taken out of the new text of your own substitution, with no other marker in it, changes that
text where it is, line breaks and prefixes too, and nothing around it is widened, as long as some
of it stays and its closer stays behind text; where that leaves it reading as its old text with a
run of a quote's blank lines read as one line, which renders the same, it goes too, and its new
text stays, plain.
Replacing text inside someone else's insertion is a substitution inside it, and deleting there is a
deletion inside it. With Track Changes off,
typed text joins no pending change, your own included (§3.10).

**Simplify markup.** When many people rewrite one sentence in turn, it can carry many small
marks. The editor's Simplify markup collapses such a region into one whole-block substitution:
the old blocks as payload and the newest blocks in the file. The marks it replaced are kept in the
ledger under `parts` (§5.4), so their authorship isn't lost. The editor never does this on its
own, because it changes what reviewers can accept piece by piece. The Word importer uses the same
form for revisions that don't map to Markdown. An agent's edit is joined as it is first written
(§3.11), which collapses nothing that was recorded.

### 3.7 Tables

A GFM table can't contain a line that isn't a row. Inserted rows were tested in simulated live
sessions and git merges. Columns, moves and header changes follow the same design but have not been
simulated live yet; every pair of operations on rows and columns by two people was decided in every
order (the pair model), and random tables with three people's operations, edits, format changes and
comments were decided in every order, against micromark 4.0.2 with GFM tables.

Text in cells takes inline marks, as anywhere else.

**What reads as a table.** The reader agrees with micromark 4.0.2 with GFM tables on the whitespace
that leads a line, a header row, the delimiter row and every row below. Leading whitespace is counted
in columns, a tab going to the next multiple of four, so a tab anywhere in it makes four columns or
more. A header row or delimiter row of four columns or more is indented code, and makes no table;
a row of four columns or more ends the table's rows. Spaces up to three, in front of any row, are no
part of its first cell. (Before this, the reader counted a tab as one character and read a delimiter
row led by a tab as a table's, where micromark reads a paragraph.)

**A table typed with Track Changes on.** The editor's Return at the end of a line of cells
(`| a | b |`) alone in a paragraph writes the table's delimiter row and an empty first row, as one
edit. Where the line is the author's own pending insertion, the two rows are written into that
insertion as its text, with no split and no mark of their own: a table is no paragraph, and its
rows are not paragraph breaks. Where the line is anything else (the file's own, or another person's),
Return there is the ordinary Return, a new paragraph, and the line stays a paragraph: with Track
Changes on only Paragraph › Table makes a table. With Track Changes off the rows are written
as typed.

**An inserted row** carries a marker at the start of its first cell, followed by one space:

```markdown
| Fruit                     | Count |
| ------------------------- | ----- |
| Apples                    | 3     |
| <!--ins k3x9 row--> Pears | 5     |
```

- The payload `row` makes this a point form of `ins`, with no closer. An ordinary insertion opener
  never has a payload, so the two can't be confused. In an empty first cell, the marker stands
  alone but for its space: `| <!--ins … row-->  | 5 |`, written with the space the cell's width asks for
  after the marker's own.
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

**An inserted column** carries `<!--ins ID col-->` and one space at the start of its header cell.
Its body cells and delimiter cell carry no marks. Rejecting it removes every cell of the column and
its delimiter cell, with everything in them, other people's changes included; accepting it removes
the marker and the one space after it, whatever the cell holds. Columns inserted together share a
group, each with a marker of its own, and a cell is written for each in every row, so that a column
is the same cell in every line. Text typed in the cells of your own inserted column is part of its
insertion too, and writes no marks: rejecting the column removes it.

- A new column follows the table's style: where the rows line up it is three wide, its delimiter
  cell three dashes and its other cells blank, with the marker in the header's making it wider until
  it is accepted (the width a row's marker gives its first cell); otherwise as narrow as the table's
  narrowest column, `|  |` for a cell.
- A row with fewer cells than the header has columns is written no cell for a column beyond its last
  (GFM reads the rest as blank), and one with more keeps them where they are, past the header's
  width.
- A row with no pipe at its edges gets the pipe it needs, plain: a leading pipe in front of a new
  first column, a closing pipe after a new last cell, and a closing pipe where the last cell of a
  row without one is taken out or moved, so that the row still ends in a cell GFM reads as one.
  Rejecting does not take the pipe away: both versions have it, and they read alike.
- The marker of a row inserted and not yet decided stays in the first cell of its row, whichever
  column that is: a column put in front of it, or its first column taken out, moves the marker to
  the new first cell, and accepting or rejecting the column in any order writes the same bytes.
- The marker of a column stands in the header, so the header keeps its place while a column is
  pending: a row can't be inserted above the header, nor the header deleted or moved, and a column
  can't be inserted while the header is itself a pending inserted row, with Track Changes on or off
  ("Accept or reject the column changes in this table first." or "… the row changes …").

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
- A row's payload is `row=N` and the row as written. A column's is `col=N` and its cells from top to
  bottom, delimiter cell included (so its alignment comes back), separated by `\n`: each cell as
  written between its pipes, padding included, as it reads with every pending change in it rejected,
  format changes undone as well, so that rejecting the deletion writes the cells back as they were.
  The first cell follows the one space after `N`.
- Positions count the table as written. The header is row 0 and body rows count from 1; neither
  the delimiter row nor deleted rows count. Columns count from 1. A deletion names the position
  the row or column takes when restored. The serializer rewrites positions whenever the table
  changes, and several deletions at one position keep their order.
- **Rule 3, deleting a row with Track Changes on.** Another person's pending changes stay theirs. A
  row with another person's pending change in it can't be deleted until that change is decided
  ("Bo Chen's pending change is in this row. Decide it first."), and nor can a row that is another
  person's pending insertion or move ("Bo Chen's inserted row is pending. Decide it first."). Your own
  pending row is removed outright, as rejecting it would, and your own pending changes in a row you
  delete fold into the deletion, which keeps the row as it reads with them rejected, as deleting your
  own insertion removes it. Deleting your own moved row removes the row at its new place and leaves
  the old place a plain deletion. With Track Changes off the row goes as text, and what was pending in
  it goes with it.
- **Rule 4, comments in a deleted row.** A comment in a row that leaves the table, deleted or
  rejected, becomes a point comment at the start of the text of the first cell of the row below, or at
  the end of the text of the last cell of the row above for the last row (and where the row below has
  no pipe at its start, which could not hold the marker, there too). A comment with a part that
  stays loses only the part in the row, and one with an end in the row keeps its other end, the end
  that left standing where the point goes. A highlight has no point form and goes.
- **Rules 3 and 4 for columns.** A column with another person's pending change in it can't be
  deleted until that change is decided ("Bo Chen's pending change is in this column. Decide it
  first."), nor can a column that is another person's pending insertion or move ("Bo Chen's inserted
  column is pending. Decide it first."); it can be moved, and its changes travel with it. Your own
  pending column is removed outright, deleting your own moved column removes the column at its new
  place and leaves the old place a plain deletion, and your own pending changes in a column you
  delete fold into the deletion. A comment in a column that leaves the table, deleted or rejected,
  becomes a point comment at the start of the text of the cell after it in the same row, or at the
  end of the text of the cell before it for the last column; a comment in a moved column moves with
  it, both ways. A comment that starts above the table, on a line of its own because a marker can't
  start the line of a header without a leading pipe, and ends in a column that moves or is deleted,
  refuses the operation with Track Changes on, in words that name its author ("Ada Lovelace's
  comment starts above this table and ends in this column. Delete it first, or turn off Track
  Changes."): its end would leave without its start, and the change could not be rejected. Another
  column of the table, and the operation with Track Changes off, are not refused. A table keeps at
  least one column: deleting the last, or rejecting the insertion of the last, is refused ("Delete
  the table instead."). With Track Changes off the columns go from the original as well, so the last
  column that is not pending can't be taken out ("Accept or reject the column changes in this table
  first.").
- **Order and positions.** The deletion lines are kept in the order of their positions, those at one
  position in the order the rows had. A row is written back at its position when its deletion is
  rejected, in front of the row that is at that position then; the deletions at the same position
  that come after it move down with the rows below it, so that every order of decisions writes the
  rows in the order they had. Deleting a row at index N takes the positions above N up by one;
  writing one at N, inserted, restored or moved, takes those above N, and those of a row at N whose
  line comes after it, down by one. A moved row's deletion counts the table with the row at its new
  place in it, so that taking that row away and writing the deletion back puts the row where it was.
- **Moving rows.** A row (or rows) moved to a boundary of the table (0 above the header, up to the
  number of rows below the last) is written there as the row, in its current text, with the in-row
  marker `<!--ins ID row-->`, and kept below the table as `<!--del ID2 row=N …-->` at its old place
  (the row as it reads with every pending change in it rejected, comments left out); the ledger
  links the two with `move`, each entry naming the other, and rows moved together share a `group`.
  Another person's pending changes in the row travel with it, and so do comments, and what is typed in
  it afterwards, by anyone, is a change like any other, because the row at its new place is a move and
  no row of its own (typing in your own new row is part of the row's insertion, §3.7 above); their pending
  insertion or move can't be moved. A row that is your own pending insertion is moved plainly. A row
  moved to the top is the new header, the delimiter row following it in every state. Accepting a move
  takes the marker and the deletion line away; rejecting it moves the row itself back, with what was
  typed in it since and its comments, and takes the deletion line away. Either half decides both. A
  row with no pipe at its start (a table without outer pipes) is written at its new place with a
  plain `| ` in front of its marker, as an inserted row is, and its deletion keeps the row with the
  same pipe: the pipe is no change, both versions have it, and rejecting the move gives the row back
  at its place reading as it did, whatever has been typed, commented or decided in it since (a mark
  at the start of the row could not stand there without the pipe). A move is never refused once it is made, and
  two kinds are refused when it is made. A row that would be the header, moved to the top, must have
  as many cells as the header has columns ("This row has a different number of cells than the
  header, so the table would stop reading as a table. Make its cells match the header first."),
  tracked or not; a table whose header has another number of cells than its delimiter row is no
  table. And with Track Changes on, a comment that runs from one row of the table into another is
  refused, naming its author ("Bo Chen's comment runs from one row of this table into the next.
  Delete or resolve it first, or turn off Track Changes."). A comment that starts a row with no pipe
  at its start has its opener at the end of the row above, so it crosses the line break, and moving
  rows beside it could be accepted but not rejected. For the same reason, adding such a comment in a
  table with a row move pending is refused, naming the person who moved the rows. Deleting the header
  is refused in the same two cases (the row that would be the header has another number of cells,
  or a comment's marker after its closing pipe is a cell too many), tracked or not. A
  text merge that took the moved row away leaves only the deletion, which is an ordinary deleted
  row.
- **Moving columns.** A column (or columns) moved to a boundary of the table (0 before the first
  column, up to the number of columns) is written there with its cells as they are now, the header's
  carrying the marker `<!--ins ID col-->`, and kept below the table as `<!--del ID2 col=N …-->` at
  its old place (the column as it reads with every pending change in it rejected); the ledger links
  the two with `move`, each naming the other, and columns moved together share a group. N counts the
  table with the column at its new place in it, so that taking that column away and writing the
  deletion back puts it where it was. Accepting a move takes the marker and the deletion line away;
  rejecting it moves the column itself back, with what was typed in it since and its comments, and
  takes the deletion line away. Either half decides both. Another person's pending changes travel
  with a moved column; their pending insertion or move can't be moved. A column that is your own
  pending insertion is moved plainly. A column that has no cell in some row of the table (a row
  shorter than the header) can't be deleted (with Track Changes on) or moved ("A row of this table
  has fewer cells than its header. Fill it in first."). **With Track Changes off, an edit in a cell
  of a pending move's copy (a moved column or a moved row) is written in both halves of the move:**
  the cell at its new place, and the same cell in the kept copy below the table, escaped as the
  payload is. A plain edit changes both views as it says, and the original reads the cell at the old
  place from the kept copy; so accepting the move keeps the text at the new place, rejecting gives
  it back at the old place, and the original view has it. The move is not decided for the person,
  and the key is not refused. If the edit can't be written into both halves so that the move can
  still be decided either way, it is refused: "Bo Chen's move of this column is pending. Decide it
  first, or turn on Track Changes."
- **The header.** A row inserted above the header is the new header, with the marker in its first
  cell, and the old header the first body row; deleting the header makes the first body row the
  header; the delimiter row follows the first row in every state.
- A table keeps at least one row. Deleting the last one, or rejecting the insertion of the last
  one, is refused.
- A text merge can leave a deletion's position stale, so that rejecting it would restore the row in
  the wrong place, although no text is lost. The merge driver recomputes positions (§7.4).

**Other table rules:**

- Rows that hold markers have a leading `|`. When a marker has to stand at the start of a row
  that has none, because a change begins in its first cell, the editor writes a plain `| ` in
  front of it first, in both versions, so that nothing reads differently. This holds for a row with
  no pipe at all too (the first under the delimiter row, say). A format change in a row without one
  is still refused.
  The same is written when an edit takes all the text of the first cell of a row that has no leading
  pipe, or of the last cell of one that has no trailing pipe (a deletion, tracked or not): the pipe
  beside the cell would become the row's outer pipe, the row would have a cell less, a header one
  too few for the delimiter row, and the table would be none. The editor writes `| ` in front of the
  first cell or ` |` after the last, plain, in both versions, and the table reads as it did with the
  cell empty, in every order of decisions. An edit that takes only part of the text, or replaces it,
  writes nothing.
- **A cell is one line.** Text in a row never holds an unescaped `|` or a line break: a pipe in
  a cell is written `\|`, a line break `<br>`. An edit that changes a table's lines or the
  unescaped pipes in them, so that it would add a cell, take one away or split a row, is refused:
  "In a table, write a pipe as \| and a line break as <br>." An agent's `str_replace` is held to
  the same rule. An edit over the whole table is a change of a block, not of its cells, and is not
  held to this: a deletion of a whole table is the block deletion of §3.4, its marker standing in
  front of the table's first row as it does in front of a paragraph's first line, and everything
  the table holds is in the marker's payload. A row whose cells are all dashes is a row like any
  other; with Track Changes on, only the delimiter row takes no change. With it off, a plain edit
  of the delimiter row is written as any plain edit is (held to the same rule of one line, and it
  can unmake the table, as an edit of any line can unmake what it is).
- The serializer keeps a table's padding style and never re-pads rows it didn't change, so diffs
  stay small.
- An alignment change is a block format change (`align=SPEC`) around the table.
- A moved row or column is written at its new place with the in-row marker, and as a deletion at
  its old place. The ledger links the two with `move`.
- Below a table, the deletion lines come first, in their order, then the closers of marks that end
  with the table, then a deleted last block or a split, on its own line (§3.4). A row inserted
  below the last row goes above all of them, at the end of that row.
- A new row follows the table's style: padded to line up where every row of the table is, `| a | b |`
  otherwise, with as many empty cells as the header and a leading pipe (rule above). Nothing else is
  re-padded.
- **Aligning columns (rule 5).** A column's alignment is the colons in its cell of the delimiter row.
  **Redlines writes alignment changes with Track Changes off only** (the Align commands are refused with
  Track Changes on: "Aligning a column with Track Changes on isn't ready yet. Turn off Track Changes to
  align it."), and an agent's edit that changes alignment is a cell edit as it is on main. A tracked
  alignment change that another tool wrote is read, drawn, carded and decided as below, and edits right
  under its table are refused while it is pending (the closer's line, #281). The form is a block format
  change around the table, `align=SPEC`, whose
  `SPEC` is the old delimiter row as written, as a value (§2.6: a space is `\x20`, a pipe `\|`).
  Its opener stands alone on the line before the table, with the blank line after it (§3.3), and its
  closer after one blank line below the table and its deletion lines, in front of the closers that
  stand there already:

  ```markdown
  <!--fmt k3x9 align=\|\x20:-\-\-\-\-\x20\|\x20-\-\-\-\-\x20\|-->

  | Fruit  | Count |
  | :----- | :---: |
  | Apples | 3     |

  <!--del w8nn row=2 \| Pears \| 5 \|-->

  <!--/k3x9-->
  ```

  - The new delimiter row is the old one with the colons of the columns changed: each cell as wide
    as it was (a cell of one dash grows by the colons), left `:--`, center `:-:`, right `--:`, none
    all dashes. The cells of columns not changed are not touched.
  - Accepting takes the markers away, the opener with its line break and blank line (§3.3) and the
    closer with the line break and blank line before it, so that nothing else changes; rejecting writes
    `SPEC` back as the delimiter row, so that every byte is as it was. It is decided after the other
    marks of the table, on the text they leave, so that every order of decisions writes the same
    bytes.
  - **Edits under the table.** While an alignment change is pending, a tracked edit on the lines between
    the table's last line (its deletion lines and the closers included) and the first character of the next
    block is refused, in words that name the person: "Bo Chen's alignment change to the table above is
    pending. Decide it first, or turn off Track Changes." The closer stands on a line of its own there, and
    a mark of an edit that shared its line would read otherwise in some order of decisions. An edit at the
    end of the last row is the cell's, and an edit further into the next block is its own; neither is
    refused, nor is any edit with Track Changes off. Every single decision of such a file is possible in
    every order, which the pair model and the random suites hold the format to.
  - **One change per table.** The author's own pending alignment change is changed in place, and is
    taken away, with its old row written back as it was, when the new alignments are the old ones.
    Another person's pending alignment change refuses yours: "Bo Chen's alignment change is pending.
    Decide it first." A request that changes nothing is refused: "The columns are already aligned that
    way."
  - **Alignment and column changes don't mix,** because `SPEC` keeps the whole old delimiter row, a
    cell for each column the table had: an alignment change is refused with Track Changes on while a
    column is pending insertion, deletion or move ("Accept or reject the column changes in this table
    first."), and every column operation, tracked or not, while an alignment change is pending
    ("Accept or reject the alignment change in this table first."). Any row change is allowed beside
    an alignment change, and an alignment change beside any row change: a row is never a cell of the
    delimiter row.
  - **With Track Changes off** the delimiter row is changed as it says and no mark is written. It is
    allowed beside a pending column change, and the other places that keep the cell are changed too,
    so that a plain edit changes both views (§3.10): the old row of a pending alignment change (so
    that rejecting it keeps what was done, and the change goes when its old and new alignments are
    the same), and the kept copy of a column that is a pending move's, in both halves of the move.
  - A table keeps its alignment when its columns are inserted (a new column has none), deleted or
    moved: the delimiter cell travels with the column, and a deleted column keeps its own in its
    payload, as above.
- **Rows and columns don't change together,** because a deleted row keeps its cells as written and a
  deleted column its cells top to bottom, so a change on the other axis while it is pending would
  leave it the wrong number of cells. With Track Changes on, a pending change allows:

  | Pending in the table      | Allowed                                   |
  | ------------------------- | ----------------------------------------- |
  | Rows inserted             | Any row change; inserting columns         |
  | Rows deleted or moved     | Any row change                            |
  | Columns inserted          | Any column change; inserting rows         |
  | Columns deleted or moved  | Any column change                         |
  | An alignment change       | Any row change                            |

  Anything else is refused, and the refusal says what to decide first: "Accept or reject the column
  changes in this table first." (or the row changes, or the alignment change). Deleting or moving a
  row is a row change that keeps the row as written, so it is refused with a column pending
  insertion too (rejecting the column would leave the kept row a cell too long). With Track Changes
  off the same pairs are refused where a pending deletion or move would be left the wrong number of
  cells, and the table allows what it allows with Track Changes on otherwise. The same holds for
  columns: deleting or moving a column with a row inserted is refused with Track Changes on (the
  kept column would lack a cell for the row), and any column change with a row deleted or moved or
  an alignment change pending is refused, tracked or not ("Accept or reject the row changes in this
  table first." or "… the alignment change …"). An alignment change is allowed with any row pending,
  and with a column pending only with Track Changes off (rule 5 above). Decisions are made on the lines of the table in this order: the other marks, then
  the columns, then the moves of rows, each on the text the ones before leave.
- **Cells apart.** A format change confined to the text of one cell is checked against the marks in
  that cell, and not against the marks of the other cells (§2.6, rule 5's count and the check of every
  order). GFM cuts a row into cells at the pipes that no backslash escapes before it reads any inline
  syntax: emphasis, a code span, a link and a bit of HTML can't reach from one cell into another, and
  a `|` inside a code span still ends a cell. The markers of a mark never hold such a pipe (a payload
  writes it as `\|`, §2.6), so a mark that lies wholly in one cell's text, accepted or rejected,
  can't change how any other cell reads, in any order of decisions. What a change in a cell has to
  show is therefore about the cell's marks: that every order of deciding them reads as it would
  without the change, and that rejecting it gives back the bytes. The marks of other cells stay
  pending, the same in the file with the change and in the file without it, and so do those that
  lie in the header row; a mark that crosses a pipe, or lies outside the table, is not apart. The
  table's own marks, the rows and columns pending, the moves and an alignment change, are decided in
  their own tiers (the other marks, then the columns, then the moves of rows, each on the text the
  ones before leave, as above) and still take part in the check, and a decision is still held to the
  view with the pending moves accepted (the check of a decision in a moved row). Where none of them
  is pending in the table, the lines checked are its header row, its delimiter row and the cell's
  row, which read as they do among any rows, so that the cost of a change in a cell does not grow
  with the table. Two things follow for what a person does. Bold or italic over a rectangle of cells
  (a column, or the whole table) is one change group, a mark for each cell, each checked on its
  own, and any number of cells is no more than that many small checks. And a cell that holds
  another person's change, or is in their inserted or moved row, can't be formatted until that is
  decided, as a paragraph can't, and the refusal says so of the cell and the person ("Bo Chen's
  insertion is in the cell in row 3, column 2. Accept or reject it first, then format the cell.");
  a change in another cell of the row does not matter. A row without a leading pipe takes no
  format change (the cells of such a row are cut by the line's start, which a mark could change).
  The pair model, a suite of random rectangles over tables with other people's marks, pending rows
  and columns and alignment changes (every order of decisions, judged against micromark 4.0.2), and
  the cases of a pipe in a code span, a cell that is only a marker, CRLF and a table without outer
  pipes hold the format to this.
- A deleted last block, or a split right after a table, goes on its own line below the table,
  after the row and column deletions.
- **An agent's `str_replace` over a table.** When the old and the new text hold the same table, with
  the text around it as it was, the two are compared as tables: rows are matched by their text, so
  an added row is a row insertion (with its cells), a removed one a deletion and a reordered one a
  move, and a row that stays with some cells changed gets word-by-word marks in them, all one group.
  An edit of cells alone is written as any edit in cells is. A replacement that changes rows and
  columns together is refused: "Make the row changes now and leave the column changes until the
  person has decided them." Tables of the same height are compared by their columns in the same way:
  a column added to every row is a column insertion (with its text, which is part of the insertion),
  one taken from every row a deletion, and columns of the same text in another order a move; the
  cells that changed in a column that stays get word-by-word marks. Tables of the same size whose
  columns are not all the same as before are compared by cells.
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
`frontmatter`, one entry per changed key with the old value (§5.4). Until the editor does that,
an edit or a comment there is refused with the error code `front-matter`: "Front matter can't be
edited with Track Changes on yet."

Line breaks put at the end of the closing line, such as the empty paragraph Enter opens there, are
the body's, and are written plain; anything else typed there is refused as an edit of front matter.

The body starts on the line after the closing line, and is read as a file of its own: that line is
the first line of a file, with no line in front of it, and no change takes the line break that ends
the closing line, whether a blank line follows the front matter or not. A mark that starts the
first block puts its opener where §3.3 puts it at the start of a file: in front of a paragraph or a
heading, alone on the line before it with a blank line after it, which is between the closing line
and the block where the block starts right under it; after the bullet of a list item, or the `> `
of a quote. A comment on the first word of a post that starts right under its front matter:

```markdown
---
title: Notes
---
<!--cmt c8d2-->

First<!--/c8d2--> words of the text.
```

The opener takes its line break and blank line with it when the mark is decided, which gives back
the bytes, so the closing line stays as it is in every state, and Pandoc, Quarto, Jekyll and Hugo
read the same front matter. As on the first line of a file, a change inside the prefix of the first
line (`- `, `> `, `##`) is refused (§3.4), a deletion of the whole first block takes the break after
it and never one in front, and the first block changes type as a block at the start of a file does
(§2.6). A reader that doesn't know front matter shows it as text, and reads a closing `...` and the
line under it as one paragraph, which such an opener parts.

Front matter is YAML, not Markdown, and is read as YAML only. A line in it that a Markdown block
would start with, such as a fence or an HTML tag in a block scalar (`description: |` and then a
line of three backticks, or `<div>`), starts no block, and a code span in it ends there: the body
is read from its first line, as a file is, whatever the front matter holds. That goes for HTML
comments too: front matter ends at its closing line, and a `<!--` in it that is not closed before
that line stays inside it, so that it hides nothing in the body, as it does for pandoc, Quarto and
GitHub, which end the front matter at its closing line. A marker that someone
wrote in front matter by hand, which no edit does, is still found there, and reads as it did.

### 3.9 One form per state

The serializer always writes the same bytes for the same state:

- adjacent deletions by the same author in one editing burst merge into one mark;
- a change that covers whole blocks uses the block forms of §3.4;
- whole-block insertions use own-line markers.
- a row inserted into a table is written in the row form of §3.7, in the table's padding style, and
  a column in the column form, a cell in every row, in the same style;
- text typed in a row its author inserted is written plain: it is part of the row's insertion, and
  has no mark of its own (§3.7).

The parser accepts the other valid forms, and warns.

### 3.10 Editing with Track Changes off

With Track Changes off, an edit is an edit of the text itself, as a direct edit is in Word. It
makes no mark and records nobody, and the original text changes with the newest. Typing, pasting,
cutting, Enter, Backspace, Delete, typing over a selection and dropping text all follow these rules.
In a file with full history, such an edit is an `edit` event (§6.2).

**Typed text is never part of a pending change,** anyone's, the editing person's own included.

- At the edge of an insertion or a substitution, it goes outside the mark: after the closer, and
  before the opener. At the start of a substitution's new text, that is in front of its old text,
  as with Track Changes on (§3.6).
- In the middle of an insertion's or a substitution's new text, it splits the mark in two around
  the new text. The part before it keeps the id, and the old text of a substitution. The part after
  it is a new mark of the same kind with a new id (§2.3), and its ledger entry is a copy of the
  first part's: author, time, `note` and `group`, but not `move` or `parts`. A thread about the
  change (`about`) stays with the first part. The second part of a substitution has no old text.
  Typing `fast ` into Ada's `<!--ins k3x9-->new importer<!--/k3x9-->` before "importer" gives

  ```markdown
  We will ship the <!--ins k3x9-->new <!--/k3x9-->fast <!--ins w8nn-->importer<!--/w8nn--> in April.
  ```

  with `w8nn: {by: ada, at: 2026-10-13T22:30Z}` in the ledger, the time of `k3x9`.
- A blank line typed in an insertion splits it the same way, and the second part opens the new
  block on a line of its own (§3.3). Where the first part would end at the start of the block after
  the break of a split inside the mark, it ends in front of the split instead, and the split and its
  break belong to neither part: `Para one.<!--/k3x9--><!--split s3vb-->⏎⏎X<!--ins w8nn-->Para two.`
- Text typed next to a pending deletion goes where it is typed, before or after the deleted text,
  which the editor shows. Text is never typed between a split and its break: it goes in front of
  the split. Text typed further into the break, on the blank line of a paragraph break, would part
  the break, which rejecting the split could then read otherwise: the edit is refused until the
  split is decided, or made with Track Changes on (§3.4), where your own split is typed again with
  the text. A line break typed there is a blank line more, as in plain text.
- Comments and highlights mark text and change none. Their range takes typed text as it takes any
  text: text typed in it, or at its end, is in it, and text typed at its start is not (§4). Text
  typed in a format change takes the formatting around it. None of them is split.
- A line break is not text of a range, and no marker may start a line (§3.2). Typed text that starts
  with a line break goes after a closer, so that the closer still ends its line; text that ends with
  one, as Enter's does (with the next item's bullet in a list), goes after a closer, an opener or a
  point comment, which would otherwise start the new line or stand on it alone. Enter at the end of
  a commented line gives `note<!--/c8d2-->⏎⏎Next.`, and Enter in front of a comment
  `One <!--cmt c8d2-->⏎two<!--/c8d2-->`; text that starts with a line break and goes on stays in
  front of an opener.

**Deleted text is gone for good,** with what was pending about it, as when a deletion is accepted.

- A mark whose text is all deleted goes, with its ledger entry: an insertion, a highlight or a
  format change with nothing left in it, and a split whose break is deleted. A mark that keeps some
  of its text keeps the rest. An insertion that still holds another person's change keeps it, and
  stays.
- A pending deletion whose marker is in the deleted text goes, its old text with it. So does the
  old text of a substitution whose opener is in the deleted text; what is left of its new text stays
  new, as a substitution with no old text.
- A substitution whose new text is all deleted, and not its opener, keeps its old text as a
  deletion with the same id and ledger entry.
- A comment whose range is all deleted becomes a point comment where the text was (§4), and keeps
  its thread. A point comment in the deleted text stays, where the text was.

**Typing over a selection** deletes it and types the new text where the deleted text started: text
typed over all the text of a comment's range is in the range, and text typed over the end of an
insertion goes after it.

**Both views change as the plain edit says.** The newest text is the plain edit of the newest text.
The original text is the same edit of the original text, where the edit is in text that both have:
typed text is in both views, and deleted text that both had is gone from both. Typed text stands in
the original where it was typed, at the place of the mark it was typed in or beside. Deleted new
text was never in the original, and old text deleted with its marker goes from it.

**What has no legal form is refused,** and the file is left as it was. Typed text must not leave a
marker where §3.1 to §3.3 allow none, and some edits have no form that keeps it out of a mark: a
single line break typed in front of an insertion or in one, after which a marker of the insertion
would start a wrapped line; text typed at the start of a wrapped line in an insertion, whose closer
would start the line; text typed inside a link, an image or a code span in an insertion; taking out
the blank line between the breaks of two splits, which would leave them side by side (§3.4). Such an
edit, and one that would leave a marker at the start of a line or alone on it, is refused with the
error code `no-legal-placement`; one that would hide other changes in code or an HTML comment, with
`would-hide-marks`. The refusal says what can't be done, names the change in the way ("Bo Chen's
insertion"), and the way around: accepting or rejecting that change first, or, where that is
allowed, making the edit with Track Changes on, which writes it as a change of its own. Two line
breaks side by side are refused with Track Changes on too, so that refusal offers only the first. In
Raw, with Track Changes off, the editor edits the source as written, markers included.

**Tables.** Inserting rows into a table with Track Changes off writes plain rows, with no marker and
no ledger entry, in the table's padding style (§3.7), and is refused where a pending column deletion
or move would be left the wrong number of cells (the table of §3.7). Deleting and moving rows with
it off takes them out and writes them again as text; what was pending in a deleted row goes, a
moved row's changes go with it, and deleting the row at the new place of a pending move removes the
move's deletion too. Text typed in a row or a column
that is pending insertion is part of that insertion, as §3.7 says, so it goes if the row or column is
rejected: the original has no cell to put it in, and so §3.10's rule that typed text is never part
of a pending change does not hold there.

The ledger is written only when an entry comes or goes. Otherwise it is left as it is, in whatever
form it has, and even when it can't be read.

### 3.11 Changes from a new text

An agent's `str_replace` gives the old text and the new text, not the keystrokes between them
(design §8.3), and the library works out the changes. It compares the two piece by piece, a piece
being a word (a run of letters, digits, combining marks and `_`), a run of white space or one other
character; the pieces that agree at both ends are left out, and the rest is matched as the longest
run of pieces the two texts share. That leaves changes, each a stretch of the old text and the new
text that takes its place. A comparison of more than 4,000,000 pairs of pieces is one change, from
the first piece that differs to the last. Then:

1. **Changes close together are one.** Two changes in one block, with unchanged text between them,
   become one change when that text has no more words than either change has: a change counts the
   words it takes out or the words it puts in, whichever are more, so the text has at most as many
   words as the smaller of the two, and a tie joins; a change of white space only (an unwrapped line
   break) counts for nothing, and joins as far as the change on its other side allows, while two
   of them join over no word. The unchanged text must be plain (below), and
   neither change may reach into a line's prefix (indentation, `>`, a bullet or a number, a box, a
   heading's `#`s; an insertion reaches the character it stands before). The unchanged text then
   belongs to both the old and the new text of the change, and the change counts the words it took
   in. This repeats from the first change on until no two changes can be joined.
2. **A block rewritten is replaced whole.** When rule 1 is done and fewer than half of a block's
   words are left unchanged, in the block as it was and in the block as it becomes alike (each has
   at least one word, and the words that a join took in count as changed, not as left), the
   unchanged text that is left is plain, and every line prefix in the block's old text, as the edit
   quotes it (indentation, `>`s, an item's own marker), comes back unchanged in its new text, line
   by line (the new text may have more lines; a line it lacks was a continuation line like the
   others), the block's changes become one substitution of all of it. Prefixes are no syntax in the
   text that is left, and the first line's own prefix stays out of the substitution. A prefix that
   would change (a list number, a marker, a quote's depth) keeps the block from being replaced
   whole. The substitution is written in the forms of §3.3:
   its opener after a heading's `#`s, after a list item's bullet with the text on the next line,
   after a quote's `> `, inside a cell's pipes, and on a line of its own before a paragraph.
3. **As asked, or as compared.** The joined changes are written only when the newest text then reads
   as the agent asked, compared as a decision's views are (§3.4: a run of blank lines counts as
   one, and blank lines at the start and the end of the body as none), and the original text is as
   it was, byte for byte. Otherwise the changes are written as the
   comparison found them, with the ids they would have had; when that is refused too, the refusal
   is the agent's error.

**Blocks.** A block is a paragraph (also one in a list item or a quote), a heading or a table cell,
and an edit of several blocks is judged block by block. Unchanged text that holds a blank line, or
a line break before a line that starts a block (a list item, a heading, a table row, a quote of
another depth than the line above), ends the block before it and starts the next; the break, with
the next line's prefix, belongs to neither. A line of the same quote goes on its paragraph, as a
wrapped line does, and so does a wrapped list item's next line.
In a table row, a line whose text starts with `|`, each unescaped pipe with the white space around
it ends a cell. A change that holds a block break, in its old or its new text (a paragraph split, or
two joined), or a pipe in a table row, belongs to no block: it is never joined, and the blocks on
either side are never replaced whole; they are compared, and joined by rule 1, on their own.

**Plain** text:

- has no marker in it, a comment's and a highlight's included, and no marker next to it where a
  change would take it in; and it is no part of a pending change, anyone's, the agent's own
  included, so that another person's pending words are never written again as the agent's, and the
  agent's own pending change is changed in place (§3.6). Markers are looked for only in the
  unchanged text that would be taken in: the text the agent asked to change is written as the
  comparison has it. At the two ends of a block replaced whole, what stands outside the block stays
  outside, so a comment on the whole paragraph keeps its range around the substitution;
- ends no block: it has no blank line, and a line break in it only wraps its paragraph, the next
  line having nothing in front of its text but indentation, never a list marker, a quote marker, a
  heading or a table row;
- holds none of `` * _ ` ~ [ ] ( ) < > # | \ ! = + ^ { } $ & @ ``.

So the line breaks of a wrapped paragraph don't keep two changes apart, and the new text's line
breaks are written as typed line breaks are (§3.4).

"The importer reads every file in the folder and writes one record for each line it finds there."
rewritten as "The importer reads each file once and writes a record per line." keeps three of its
eighteen words, and is replaced whole:

```markdown
<!--sub k3x9 The importer reads every file in the folder and writes one record for each line it finds there.-->

The importer reads each file once and writes a record per line.<!--/k3x9-->
```

"in March" to "in April" stays one substitution of the word, and two words fixed far apart in a
sentence stay two.

The marks of one such edit share a `group` when there are several (§5.4). Nothing that was recorded
is collapsed: this is how one edit is first written, as typing over a selection writes one
substitution; Simplify markup (§3.6) is the command that collapses marks already written. A person's
typing is recorded as it is typed and is never joined.

## 4. Comments

A comment thread is anchored in the body and stored in the ledger under the same id.

- **Anchors:** `<!--cmt ID-->text<!--/ID-->` for a range, `<!--cmt ID-->` alone for a point. A
  range may span blocks, as one segment per block with the same id. It may contain any marks and
  overlap other comments and highlights. A range of whole blocks, from the first column of a
  paragraph, item, quote or heading to the first column of the next block, starts at the text
  after the prefix (`- `, `> `, `## `) and ends where the last block's text ends. A range that
  starts on a blank line, one with nothing on it but its container's prefix (a quote's `>`, an
  item's indentation), starts where the text above it ends, as at the start of any line; at the
  start of the body, and under another blank line, where no text is right above it, it starts at
  the text of the block below: an opener alone on the blank line would take its line break for its
  carrier (§3.3).
- **Typing** at the end of a comment's range extends it. Typing at its start doesn't. A highlight's
  range takes typed text the same way, with Track Changes on or off. A line break is not text of
  the range: Enter at its end goes after the closer, and in front of it after the opener, so that
  no marker starts a line (§3.10).
- **A comment about a change,** like Word's comment on an insertion, has `about: ID` in the
  ledger and a point anchor right after the mark, so it keeps its place when the mark is accepted
  or rejected.
- **Comments on deleted text stay.** When all the text a comment covers is deleted and the
  deletion is accepted, or a covered insertion is rejected, the thread becomes a point comment at
  that place. The ledger keeps the covered text in `quote`, recorded when the comment is created,
  as the newest view shows it (without markers or deleted text); recording it when the range
  empties would make the result depend on the order of decisions. Word
  deletes such comments. Redlines keeps them, and shows them as "On deleted text". Word export
  anchors them to the nearest surviving word, because Word has no empty ranges. A comment that
  covers only part of the removed text keeps the rest of its range, and a range of a comment that
  has several loses only the segment that covered nothing. A range that covers no text (nothing, or
  only markers), in text that a decision removes on both sides of it, is emptied with that text: a
  comment's becomes a point comment there, and a highlight goes. Its closer would otherwise stay
  behind its opener where the removal leaves them, which can be the start of a block, where each
  would need a line of its own.

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
  nothing is left in it. The view (§5.6) is a setting that never keeps one: a file with no ledger
  gets none for it, and a ledger left with nothing but a view is removed.
- The file's last line break stays its last. The ledger goes in front of it, after a blank line
  of two line breaks, also in a file with no text, where the blank line keeps what is typed first
  apart from the ledger; a file without a final line break ends with `-->`. The ledger's lines end in the file's line break (§2.5), and
  so do the two of its blank line, except after a body that ends in a CR alone: there they are
  two CRLFs, because an LF would make one CRLF of that CR and itself for a CommonMark reader.
  The blank line is written with a new ledger only: writing the ledger again leaves the blank
  line that is there as it is, whatever its line breaks, but for CRs alone (below).
- Removing the ledger takes away just what adding it put in, its blank line and the comment, and
  leaves the rest of the file as it was (§9.2). What rejecting a change puts back is the change's
  own: the line breaks of its old text are written as §2.5 says.
- A reader takes as the ledger's own the two LFs or two CRLFs in front of it, or the one LF or
  CRLF that a tool may leave (§9.5). A CR in front of them is the body's, a line break of its
  own. The line break after `-->` is the body's, so a file written before this rule, whose ledger
  always ended with a line break, reads as a body that had one.
- A `<!-- redlines` comment that a CR alone precedes, or whose first line ends in a CR alone, is a
  ledger that can't be read, as one with a merge conflict in it is: Redlines changes nothing in
  it, and writes no second ledger beside it. The editor wrote such ledgers before in files whose
  first line break is a CR. It still reads them, and with the next edit writes them again with the
  line breaks above.
- Text after the ledger is tolerated, though the editor never puts any there. It stays where it
  is: the ledger is written again in place, and removing the ledger leaves that text after the
  body. A change that another tool makes there stays there, and has its entry in the ledger in
  front of it, the file's last.
- Documents joined by Quarto includes or knitr child documents can contain several ledgers. A
  marker belongs to the first ledger after it. The editor always writes one.
- The ledger never goes in front matter. A `<!-- redlines` comment inside code is not a ledger
  (§2.1).

### 5.2 Keys

```yaml
# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.
version: 1
tracking: everyone
view: redlines
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
| `tracking`    | `everyone`: everyone who opens the file in Redlines starts with Track Changes on (§5.6)            |
| `view`        | `clean` or `redlines`: the view the file opens in, as it was when it was last saved (§5.6)         |
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
  - `note`: the author's reason for the change. Agents always give one. When an author edits
    their own pending mark in place (§3.6) and gives a note, the new note replaces the old one; an
    edit with no note leaves it.
  - `group`: the id of a group of marks that are decided together, such as all edits from one
    agent run. A group can hold several edits, each with its own `note`; what is decided together
    is the marks of the group that have the same author and the same `note` (or all have none), so
    each note's marks are one suggestion, and a mark with no `group` is one on its own. Comments are
    not part of one. A client shows a suggestion as one card and accepts or rejects all its marks in
    one step, or none of them when one can't be decided.
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
- Keys are ids, handles and fixed names, none of which YAML can read as another type. They are
  written as they are, without the payload escapes. A key that is not made of letters, digits, `-`
  and `_`, or is a word such as `no`, is written in double quotes. A `--` in a key is written
  `-\x2d`, a YAML escape, so that `--` never appears in the ledger.
- The text of a comment and of a reply is always a literal block (`|-`). Text a person types may
  start with `@`, contain `: ` or ` #`, or say `No`; as a plain or flow scalar, each of these broke
  or changed the value in every parser tested.
- Other strings, a mark's `note` among them, are written inline: the entry of a mark is one line in
  flow style (§5.4, §5.7). A string is plain when it starts with a letter or `_`, holds only
  letters, digits, spaces and the punctuation `_ . @ / + ( ) = ! ' \ | * & % $ ~ ^ < > ; : -`, has
  no `: ` and no space at its end, and is not a word such as `no` (§2.4). Any other string is
  quoted, because a `,`, `?`, `[`, `]`, `{`, `}` or `#` would end it early in some parser. Times
  are minute-precision strings, written plain (§2.4).
- Values use the payload escapes (§2.5), except that a value may span lines inside a literal block.
  A blank line inside a value is written as a line holding only `\`, because some Markdown tools end
  an HTML comment at a blank line, and a line holding only a literal `\` is written `\\`.
- A literal block takes its indentation from its first line, so spaces at the start of that line
  are written `\x20`. Control characters, which YAML can't hold, are written `\xHH`.
- Because values never contain `--`, `-->` can't appear inside the ledger. The ledger never uses
  YAML document markers (`---`).

### 5.6 Settings

- **`tracking: everyone`** works like Word's Track Changes "For Everyone": everyone who opens the
  file in Redlines starts with Track Changes on, under a notice that says so.
  - Turning Track Changes on in Redlines writes it, and turning it off takes it away, as Word saves
    Track Changes in the document. The file is edited like any other change to it: the switch is
    written at once, so the document has unsaved edits until it is saved, and switching back
    leaves the file as it was. A file with no text yet gets the ledger after a blank line, like
    any file (§5.1).
  - A file that can't take a ledger, because its ledger can't be read (§5.1) or its end is inside a
    code block or a comment that is never closed, can't have Track Changes turned on. Redlines says
    why, in the words of the refusal, and leaves it off: with it on, no tracked change could be
    written there either.
  - A plain file can't enforce it. It is a default, like Word's Lock Tracking without a password.
    Hosts with real permissions enforce roles themselves.
  - Word export writes it as `w:trackRevisions`, and import reads it back.
  - The value is a word because YAML 1.1 readers read `on` as `true`.
- **`view: clean` or `view: redlines`** is the view the document opens in, the one it was in when
  it was last saved. Redlines opens the file in it, in place of the markup view that the person
  has remembered, which opens the files that have none.
  - Only Clean and Redlines are written. Raw never is: nobody wants a document to open as source,
    and a save made in Raw leaves the view the file had. Simple, which the app shows as one of its
    markup views, is written as `redlines`.
  - Switching views never changes the file, and so never makes a document edited. The view is
    written when the file is written for another reason, a Save, so reading a document changes
    nothing and its history stays quiet. An agent's edits, and the `redlines` command line, leave
    it as it is.
  - A view alone is no reason for a ledger. A plain file gets none for it, a ledger that holds
    nothing else doesn't take it, and one left with nothing but a view is removed (§5.1). In a
    file with no changes or comments, Clean and Redlines look the same anyway.
  - A value other than these two is dropped with a warning, as an unknown `tracking` is.
  - Other readers keep their own rules: an agent's run in a comment always suggests, and a preview
    of the file, such as Quick Look's, always shows it Clean. Word has no setting for it: its
    `w:view` is the page layout (Print, Web, Draft), not how markup is shown.
- **No owners list.** Permissions belong to hosts, not to files.
- **Per-person state never goes in the file:** mode, zoom and text size, the markup view a person
  has remembered, filters, comment drafts, folds, the last version someone saw, and presence. The
  two settings above are the exceptions: they belong to the document, and anyone who saves it
  records them.

### 5.7 Layout

Saving the same state always writes the same bytes, and diffs stay small:

- keys in the order of §5.2;
- `people` sorted by handle, one line each, in flow style, with the fields in the order of §5.3;
- `marks` in document order, one line each, in flow style, with the fields `by`, `at`, `group`,
  `note`, `move`, `parts` in that order;
- `comments` in document order;
- the field order of §5.4 inside each thread;
- fields that a version doesn't know come after the known ones in their person, mark entry, thread
  or reply, and top-level keys that it doesn't write itself, such as `frontmatter`, come after
  `comments`, all in the order they were read.

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
- **One event per editor command,** grouped the way undo steps are, except that an agent's run,
  one step to undo, stays an event per edit, each `str_replace`, `comment` and `reply` its own.

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
since markers carry no handles, the rename touches only the ledger. A second such case is two
branches that saved the document in different views (§5.6): keeping both sides leaves two `view`
lines, and a ledger with a duplicate key can't be read until one is deleted. Either is right,
because the setting only records how the document was last saved, and the merge driver keeps
`redlines`. In GitHub's conflict editor, keeping both sides means deleting the three
conflict-marker lines.

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
- **Original:** every pending change rejected. Format changes are undone after the other changes,
  as rejecting all of them does, and one inside another before the one around it: the old syntax as
  it was written, the old indentation, the old box. One that can't be undone keeps its text as it
  is. Restored text has the file's line breaks, as rejecting writes it.
- **Review:** the newest text with pending changes in CriticMarkup notation, each followed by its
  id and author in brackets. Language models know CriticMarkup from their training data, so this is
  the view agents read:

  ```text
  We will ship the {++new ++}[k3x9 ada]importer in {~~March~>April~~}[p7qd claude-ada], after the {==security review==}{>>[c8d2 bo] Who signs off on the security review?<<}.{-- The old exporter stays as it is.--}[w2rf bo]
  ```

  A format change is named by the operations that rejecting it undoes: its text highlighted and a
  note after it, `{==**newly bold**==}{>>[m2bd ada] Formatted: +bold<<}`. A block's change puts
  the note after the block's text (`## Plan{>>[q2hw ada] Formatted: was=p<<}`), and a box's stands
  where its marker does. One inside another's highlight is named in the note of the outermost
  highlight it is in, once, however deep, and each segment of a change is named where it is: bold
  on `alpha beta` and then italic on `beta gamma` give
  `{==**alpha *beta***==}{>>[m2bd ada] Formatted: +bold; [n8fx ada] Formatted: +italic<<} {==*gamma*==}{>>[n8fx ada] Formatted: +italic<<}`.
  One that accept and reject don't decide is shown as its text, and so is one that has only its
  syntax left, with no change in it (`****`, two backticks, `[](url)`). Such a change can only be
  accepted, and a person isn't offered to reject it.

  A comment is written as `{>>[id author] text<<}` after the text it covers. Each reply to the
  thread follows it as a comment of its own, in the order of the ledger, with the thread's id and
  the author of the reply, so an agent answers with that id:

  ```text
  the {==security review==}{>>[c8d2 bo] Who signs off?<<}{>>[c8d2 ada] The CTO does.<<}
  ```

  A resolved thread (§4) ends with one more comment, by whoever resolved it, with the time:
  `{>>[c8d2 bo] Resolved: 2026-10-14T11:00Z<<}`, after the replies. A reader that knows only the
  form without replies or without this line sees comments by `[id author]` as before and ignores
  the ones it doesn't expect; a thread that is open has no such line. Replying to a resolved
  thread reopens it (§4), so the line is gone from the next view.

  An inserted row (§3.7) is in the newest view without its marker and the space after it, and in the
  original view not at all, its line break with it; the positions of the table's deleted rows move
  up. In the review view each cell of the row that has text is inserted text, and a note follows the
  row (another person's change inside a cell stands between pieces of its inserted text, `{++Plu++}{++x++}[m2bd bo]{++ms++}`,
  as CriticMarkup has no change inside another):

  ```text
  | {++Plums++} | {++7++} |{>>[k3x9 ada] Inserted row<<}
  ```

  Accepting an inserted row removes the marker and the one space after it, whatever the cell holds
  (what follows must not decide, or deciding the row and a change in its cell would write different
  bytes in different orders), and a new row is written with that space, so the cell is as wide as
  its neighbors'. Rejecting it removes the row with everything in it, other
  people's changes included, and the line break before it, and moves the positions of the table's
  deleted rows up. A new header is rejected by writing the delimiter row after the next row, which
  becomes the header. Comments in the row become point comments (§3.7, rule 4).

  A deleted row (§3.7) is in the newest view not at all, its line and the blank line before the
  deletion lines gone with it when it was the last, and in the original view at its position, the
  inserted rows and the new places of moves gone. In the review view it is written back at its
  place, each cell that has text deleted text, with a note after it (a deleted first row stands under
  the header, whose place is kept); a moved row's notes say where from and to:

  ```text
  | {--Pears--} | {--5--} |{>>[g5nb bo] Deleted row<<}
  | {++Plums++} | {++7++} |{>>[k3x9 ada] Moved row from row 4<<}
  | {--Plums--} | {--7--} |{>>[w8nn ada] Moved row to row 2<<}
  ```

  Accepting a deleted row takes its line away, and the blank line before the deletion lines when it
  was the last; rejecting it writes the row back at its position and takes the line away. Accept all
  and Reject all decide rows and deletions with the other changes.

  An inserted column (§3.7) is in the newest view without its marker and the space after it, and in
  the original view not at all, its pipe in every line with it; a deleted column is in the newest
  view not at all, and in the original view at its position, its cells written back in every line,
  the inserted columns and the new places of moves gone. In the review view an inserted column's
  cells are inserted text and a note follows the text of its header cell, a deleted column is
  written back at its place with its cells as deleted text and its note after its header's, and a
  move's notes say where from and to:

  ```text
  | Fruit | {++Count++}{>>[k3x9 ada] Moved column from column 3<<} | {--Price--}{>>[w8nn ada] Moved column to column 2<<} |
  ```

  Accepting columns removes the markers and the deletion lines; rejecting them takes inserted
  columns out of every line, writes deleted columns back at their positions and moves a moved column
  back. Accept all and Reject all decide columns with the other changes.

  An alignment change of a table (§3.7) is in the newest view as the new delimiter row, without its
  markers or the blank line before the closer, and in the original view as the old one. In the review
  view its closer is replaced by a note, on a line of its own after the table, that names what
  changed: `{>>[k3x9 ada] Formatted: column Count centered (was default)<<}`.

Agents edit the newest view, and the library turns their edits into tracked changes in their name
(design.md). CriticMarkup is never used for storage.

## 9. Files and other tools

### 9.1 File types and dialects

- A Redlines file keeps its extension: `.md`, `.qmd`, `.Rmd` or `.txt`. A new extension would lose
  GitHub's rendering and every Markdown, R Markdown and Quarto tool.
- `.md` files are written in GitHub Flavored Markdown: `<sub>`, `<sup>`, `<mark>`, `<ins>` for
  underline, `<img width>`, `<dl>`, GitHub alerts.
- `.qmd` and `.Rmd` files are written in pandoc's Markdown: `~x~`, `^x^`, `[x]{.mark}`,
  `{width=}`, `{#id}`, Quarto callouts.
- Both read every common variant, and the serializer never rewrites syntax it didn't change.
- `.txt` files are read and written as `.md` files are, in GitHub Flavored Markdown: a plain text
  file is a document like any other, and its tracked changes and comments are the same markers and
  ledger. Text that Markdown reads as syntax, such as a line of `=` under another line or a `*` at
  the start of a line, shows as Markdown and stays as it was written. Other tools show a `.txt`
  file as plain text, with every marker and the ledger (§9.3).
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
| GitHub and the other tools that show a `.txt` file as plain text      | Every marker and the ledger, as text                                                  |
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
| `view`                   | Not exported. Word's `w:view` is the page layout, not how markup is shown            |
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
- The test oracle, micromark 4.0.2, reads GitHub Flavored Markdown tables and strikethrough, as
  the file is read (§9.1): a table is one block whose cells, row by row, the tests compare, so that
  every allowed edit to a table's text can be judged by how the cells read.
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
   and table column changes, alignment changes, moves and header changes in live simulation.
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
