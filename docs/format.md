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
| `align=SPEC`               | Table column alignment changed; `SPEC` is the old delimiter row                               |

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
and rejecting every mark there, the new ones and the others, with every mark left pending on the
way, with the comments and highlights and without them. A decision that one order refuses can work
in another. Each state must read as the same words as the same decisions without this change, all of
the block, and once the new marks are rejected, it must have the same bytes. A decision refused
without this change must be refused with it, as nothing shows what it would come to. Too many marks
to try (more than five, or fewer in a long block) is refused too. It is read on both readings of
CommonMark: since 0.31 a symbol such as an emoji is punctuation, and GitHub does not read it so yet.

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
  level, when it stands on its own, with a blank line or the start or end of the file before and
  after it. Markdown would otherwise read the new block into the one next to it, as a lazy line. A
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
  except where a numbered item after it and the lines under it would then be read into it, or where
  the lines under it would no longer be indented enough to be its own. A numbered item that doesn't
  start at 1 can't interrupt text: indenting or outdenting one right after text is refused. Changing
  one item of a numbered list can renumber the items after it, as Markdown reads them; that is no
  change of their text.
- Its markers go only where §3.1 lets a marker go: not after a backslash at the end of a line, not
  between a hard break and the line end, and not inside a link, a tag or a code span.
- Indenting a list item moves it, and the lines under it, to the content column of the item before
  it, as that item's child. Outdenting moves it to its parent's column. The mark is `was=indent=N`,
  where `N` is the number of spaces that were in front of its bullet, and it stands after the bullet
  and closes at the end of the item's last line, its children included. Rejecting moves every line of
  the mark back by the same number of spaces. The first item of a list isn't indented, and lines
  indented with tabs, or by less than an outdent takes away, are refused.
- Checking a box is a point mark at the end of the item's first line, with no closer, and the box is
  changed in place: `- [x] Buy milk<!--fmt k3x9 +check-->`. Rejecting writes the old box back
  (`-check=X` when it was `[X]`), and accepting takes the marker away.
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
  order, as above: more than five items of one list at once are too many to try.
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

A change that would put a marker in one of these places is widened instead, so that the newest and
the original text stay as they are: over the whole construct, as a substitution of it (§3.5), or by
one character where a marker would change how emphasis flanks. A marker also never cuts a run of
`*`, `_` or `~` in two. The editor refuses a change that has no place at all, such as a change
inside the prefix of the first line of the file (`- `, `> `, `##`; every other prefix is changed
together with the break in front of it, §3.4) or after a heading's closing `#`s, with the error
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
  line of its own. A closer never stands at the start of a line that has text after it. An edit
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
  their content indentation, or before front matter.
- Nothing follows `-->` on a marker line. A block's leading spaces go after an own-line marker,
  never before it.

A mark that ends at the end of a block closes at the end of the block's last text line: before an
ATX heading's closing `#`s or its `{#id}`, and on a setext heading's text line, not its
underline. After fenced code, a thematic break or an HTML block, the closer goes on the following
line. After a table, it goes after one blank line.

A closing fence may have nothing but spaces after it on its line: with a marker there, the code
block would run on to the end of the file. When the new text of an insertion or a substitution
ends with a fenced code block, the line break after the closing fence, with the prefix of the
fence's lines (the content indentation in a list item, `> ` in a quote), is part of that text,
and the closer stands alone on the next line. A split right after a closing fence stands on that
line too, in front of its break.

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
no break in front of it: a change inside its prefix is refused.

**An inserted break** is a `split` point marker at the end of the first block. Rejecting it
removes the break and the next block's prefix. An inserted hard line break is a `split` before the
break syntax; a deleted hard break is a deletion whose payload is the break.

```markdown
The first half.<!--split s3vb-->

The second half.
```

The break is one line break, the blank line after it if there is one, and the prefix of the next
block (`- `, `> `, `## `, or the indentation of a list item's lines). A line break typed inside a
paragraph is a split too, and so is each break in typed text, but for the breaks inside a fenced
code block, which are its text (§3.5); breaks after the last typed text go behind the insertion
that holds it, so that its closer does not start a line. Accepting a split
removes the marker. Rejecting it removes the marker and the break, and the original view leaves the
break out.

**Deleting the break of a split.** Deleting the break of your own pending split (Backspace at the
start of the second half) cancels the split, as in §3.6: the marker, the break and the ledger entry
go, and the paragraph is whole again. Deleting the break of someone else's pending split is a join:
the deletion of the break stands right after the split's marker, with the break as its payload
(`One<!--split s3vb--><!--del d3x9 \n\n-->two`). It belongs to the split. The original view leaves
it out, and rejecting the split removes both. Accepting the split leaves the deletion pending.

**Typing on the line after a break.** Text typed right after the break of your own pending split
becomes one insertion with the split, as if the break and the text had been typed together:
`One<!--ins k3x9--><!--split w8nn-->\nX<!--/k3x9-->two`. After another person's split whose break
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
split that leaves its line breaks as they are, and after which the break reads as long as what is
written, changes the break, and the split stays: white space taken out of it (such a space, or a
hard break's spaces), or the prefix of the line after it taken out or made white space, as
Backspace right after Enter does in a quote (it takes the new line's `> ` away) or a list item (it
makes the bullet the item's indentation): `> One<!--split s3vb-->\ntwo.`. Taking a line break out
of the break cancels the split. In another person's break, the text is refused until that change
is decided, white space too: it would part the break, and rejecting the split would then take one of
its line breaks away and leave the other. Deleting the text again gives the blank line back: where a
deletion brings two of your splits together, the second right behind the first's break, the first's
break takes the second's in, as far as it reads, and the second's marker goes, or moves behind it
with the rest of its break, as Enter makes them.

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
  text writes the line breaks and no mark, where blank lines change nothing that is rendered. The
  original text has them as well. That is not so inside fenced or indented code, an HTML comment
  or a raw-text HTML block, where a blank line is content (markers are not read there, so Enter is
  refused); between the items of a tight list, which a blank line makes loose; and in front of a
  wrapped line that starts with a number other than 1, which is text until a blank line makes it a
  list. There Enter is a split, or refused where a break has no form that keeps the next bullet.
  Where the original text goes on, Enter is a split: in the middle of a block, next to a pending
  split, and in front of a pending deletion of the rest of the paragraph.
- Backspace over line breaks that were typed plain, and nothing else, takes them out as they were
  put in, with no mark, when the blocks around them stay apart. Enter and then Backspace leaves the
  file as it was, and is not a join.
- Text typed on a blank line that has a blank line above it and below it (Enter twice, or Enter on
  a blank line) is a block of its own: a whole-block insertion, with its opener on a line of its
  own (§3.3). On the line right below a paragraph, as after one Enter, it continues that
  paragraph, as in Markdown, and is a substitution of the line break by itself and the text
  (§3.2). After a heading, which is one line, it is a block.
- A line break typed in front of markers is written after them, so that none starts the new line:
  `the <!--ins k3x9--><!--split s3vb-->\nnew` and not `the <!--split s3vb-->\n<!--ins k3x9-->new`.
  With spaces and then a marker after it, a break of one line is refused, and one with a blank
  line gives the marker a line of its own.
- Deleting all of a block's text deletes the block together with one adjacent break. Deleting all
  the text of a block's first line, when more lines follow, takes the line break after it, and the
  next line's text takes its place.
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
typing the same text again cancels the deletion. Replacing text inside someone else's insertion
is a substitution inside it, and deleting there is a deletion inside it. With Track Changes off,
typed text joins no pending change, your own included (§3.10).

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
`frontmatter`, one entry per changed key with the old value (§5.4). Until the editor does that,
an edit or a comment there is refused with the error code `front-matter`: "Front matter can't be
edited with Track Changes on yet."

### 3.9 One form per state

The serializer always writes the same bytes for the same state:

- adjacent deletions by the same author in one editing burst merge into one mark;
- a change that covers whole blocks uses the block forms of §3.4;
- whole-block insertions use own-line markers.

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

The ledger is written only when an entry comes or goes. Otherwise it is left as it is, in whatever
form it has, and even when it can't be read.

## 4. Comments

A comment thread is anchored in the body and stored in the ledger under the same id.

- **Anchors:** `<!--cmt ID-->text<!--/ID-->` for a range, `<!--cmt ID-->` alone for a point. A
  range may span blocks, as one segment per block with the same id. It may contain any marks and
  overlap other comments and highlights. A range of whole blocks, from the first column of a
  paragraph, item, quote or heading to the first column of the next block, starts at the text
  after the prefix (`- `, `> `, `## `) and ends where the last block's text ends.
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
  has several loses only the segment that covered nothing.

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
- The ledger never goes in front matter. A `<!-- redlines` comment inside code is not a ledger
  (§2.1).

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
| `tracking`    | `everyone`: everyone who opens the file in Redlines starts with Track Changes on (§5.6)            |
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
  file in Redlines starts with Track Changes on, under a notice that says so. Without it, whether
  each person's changes are tracked is their own setting and is never saved, as with Word's "Just
  Mine".
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
