# Widen, alert or disable instead of refusing

*Design, Nov 14, 2026, lane R of the usability Epic ([#537](https://github.com/skadauke/redlines/issues/537)),
for issue [#497](https://github.com/skadauke/redlines/issues/497), written for Stephan's review on
Monday Nov 16, before anything is built. It builds on [format.md](../../format.md),
[hardening.md](../../hardening.md) and the refusal inventory (190 distinct refusals, thrown from
about 300 places). The file forms in §2 and §6 were probed against the format library at `24a41633`
and read by micromark 4.0.2 with GFM; the probes are throwaway tests that are not in the
repository, and Appendix A says what they did and what they did not cover. No production code
changes in this PR.*

## Why

Stephan, on the Test Drive: refusing is the wrong default, and Redlines refuses many edits that it
could track as a wider change. "Refuse rather than repair" was written so that the file is never
written wrong, and it did that, but every hard case became a refusal, and a refusal passes every
test, so refusals counted as successes. The five that people meet most are an edit next to another
person's pending change, Return, Tab and Backspace in lists, typing in code, changing a block's
type, and the "make smaller changes" self-check. All five are the same condition: a fine-grained
marker would read differently in some order of decisions. Word and Google Docs never ask people
to decide a neighbour's change first, because their model is not text.

The new policy, decided on Nov 14, in order: track the edit finely when that is sound; else
**widen** it into a replacement of the smallest unit that holds it, with other people's pending
changes kept in its old text; else **ask**, and make the edit untracked; **disable** commands that
never make sense; and keep a refusal only where any write would leave the file wrong.

## In one paragraph

A widened edit is one substitution of a whole block, list item, list, code block or table. Its
payload, the old text, is the unit as it was, and where other people have pending changes in it,
the payload holds them as marks, in the payload's own escapes (`<!-\-ins k3x9-\->`). Rejecting the
replacement gives the unit back byte for byte, with their changes pending again; accepting it gives
the new unit; deciding one of their changes while the replacement is pending changes the old text
as deciding it in the file would have. The format gains nothing else: no new kind, no new marker,
no change to the grammar; the only new rule is that the old text of a substitution may hold
marks. The probes found that this reads the same in every order of decisions (§2.6): 655 tables
with two people's row, column and alignment changes (3,552 decisions inside the old text) and 2,011
random blocks (16,456 decisions) all agreed with deciding in the file, every pending file read as
its newest view in micromark, and accepting gave the new unit exactly. What does not exist yet is
the engine side: today the parser doesn't look inside a payload, and rejecting such a replacement is
refused. That is the first PR.

## 1. The policy and its order

### 1.1 The five tiers

| Tier | What it is | What the person sees | Where the code decides |
| --- | --- | --- | --- |
| 1. Fine | The edit as marks at the finest grain that reads alike in every order of decisions (today's rules) | Nothing special | The first try in `trackedEdits`, `trackedFormat`, the table operations and the key plans, unchanged |
| 2. Widen | The edit as a replacement of the smallest unit that holds it, other people's changes in its old text | A notice that doesn't interrupt: "Tracked as a replacement of the whole table." | A new `widen` step, tried when tier 1 throws a widenable error |
| 3. Alert | The edit made untracked, after asking | The alert of §3 | When tier 2 has no unit that passes, and for the three cases that never reach it |
| 4. Disable | A command that has no sound target | The command grayed in the menus and toolbar, its hint says why; a key says it as a notice | Before the edit: `disabledReason(state)` on the command, and the key plans |
| 5. Keep | A refusal, in words that say why | The refusal notice, as now | Errors whose code is in the keep list (§5) |

The order is also the order the code tries. Tier 4 is checked first for a command, since a grayed
command never starts an edit; for an edit that is typed, pasted or dropped, the order is 1, 2, 3, and
5 is what any tier throws when the file would be wrong.

### 1.2 How the code decides

Today every refusal is an `EditError` with a message and one of twelve codes. The rule that replaces
"refuse rather than repair" is one `switch` on the code, in one place:

```ts
// packages/format/src/errors.ts (new)
export type Tier = 'widen' | 'alert' | 'disable' | 'keep';
/** What becomes of an edit that tier 1 threw: widen it, ask, or refuse. */
export function tierOf(error: EditError): Tier;
```

- **Keep** is a closed list of codes: `unreadable-ledger`, `unclosed-end`, `markup` (typed or pasted
  markup that would forge a mark, and a link destination that holds some), `unknown-id`,
  `no-match`, `many-matches`, and three new codes for what are argument errors or races and carry no
  code today: `bad-argument` (an index outside the table, half a character), `stale` (an insert that
  lost a race), `broken-random`. Everything else thrown while writing a tracked edit
  (`no-legal-placement`, `inside-code`, `would-hide-marks`, `empty-range` for what is not a disable)
  is **widenable**: the writer tries tier 2, and tier 3 if tier 2 finds no unit. `front-matter` goes
  to tier 3 at once, since no unit can hold YAML.
- A test (`refusals.node.test.ts`) reads the sources of `packages/format/src`, `packages/editor/src`
  and `plugins/*/src` and fails when a `new EditError(` or a `notice(` that refuses has no entry in
  `refusals.ts`, where each carries its tier. That is how "never add a new refusal" is held by a
  machine and not by a note: a refusal with no tier is a red test.
- `SELF_CHECK`, `EVERY_ORDER`, `FORMAT_SELF_CHECK` and the other safety nets stay as assertions in
  the writer: a widened write that still fails them is a bug, and shows as a bug notice ("Redlines
  couldn't make this change, and the file is unchanged. This is a bug."), never as "make smaller
  changes".

The first thing the widener has is the intended newest text. The format already maps a source
offset to the newest view (`view.map.fromSource`, which `selfCheck` uses). So for any edit,
including Return in a list, which the key plans build themselves:

```
N = the edit applied to the newest text of the unit     (what Track Changes off would write there)
R = a substitution of the unit, with N as new text and the unit as old text
```

That is the whole idea, and it is why one writer serves all 143 cases: the 143 differ in why the
fine form failed, not in what to write.

### 1.3 The unit, and how it grows

A unit is a piece of Markdown that can be replaced whole, in a form §3.3 and §3.5 already write:

| Unit | Is | Opener and closer |
| --- | --- | --- |
| block | a paragraph, heading, alert, definition or quote paragraph, with its container prefix | As §3.3: the opener alone on the line before the block, the closer at the end of its last line |
| list item | an item's content, with the bullet outside | The opener after the bullet, the content on the next line (§3.3) |
| list | a whole list, with its markers, and the items of loose lists with their blank lines | As a block |
| code block | fenced, indented, display math, raw-text HTML | The form of rule 9 (§3.5): the closer in the blank line after it |
| table | the table, with its deletion lines | The same form: the opener on the line before the table, the closer in the blank line after it (the probe's tables) |

The edit is widened to the **smallest** unit that holds it, found by a ladder, and the first rung
that passes the gate is used:

1. the unit the edit is in: the block, the table, the code block;
2. its list item, if it is in one;
3. its list;
4. the quote that holds it, if the list or block is in one.

**The gate** for a rung is: the writer builds R; `selfCheck` finds the newest text equal to the
intended one and the original text equal to the original before; no marker is left at a line start
that wasn't; and the file with R pending reads as its newest view in micromark. A rung that fails
the gate is skipped, and the next one is tried. That is not a loophole: it is how 12.3 below goes up
from the item to the list (the probe shows the item's form can't be written in a tight list).

**Closure.** A unit must hold every mark it touches whole. A comment, a highlight or a change that
starts inside the unit and ends outside it (a deletion across two paragraphs, a comment across a
table's edge, a split) makes the unit grow to the blocks that hold it. The random documents of the
probes never drew such marks (Appendix A), so this is a rule to be tested, not one that was tried.

**The cap.** A unit may hold at most 8 top-level blocks after closure (a list and a table count as
one). Past that the unit is not a reasonable thing to ask a reviewer to read, and the edit goes to
tier 3. Recommendation: 8. It is one constant (`WIDEN_MOST_BLOCKS`), and §8 asks.

**Your own marks fold in.** Your own pending changes in the unit are not nested: they go into the
replacement as rejecting them would, as a deleted table already does with them (§3.7, rule 6, "Your
own fold into the deletion"). Other people's stay as marks.

**Once.** Only the first keystroke widens. The next keystrokes in the same unit are edits of your
own pending replacement's new text, which §3.6 already makes in place: no mark, no widening, no
cost. Undo takes the whole widening back in one step, as it takes back one keystroke.

### 1.4 Where it hooks in

- `trackedEdits` (`track.ts`): the loop over `MOST_MODES` ends in a throw. It ends in
  `widened(text, edits, ctx)` instead, for a widenable code, and throws a new `Untrackable` (not an
  `EditError`: it is not a refusal) when no unit passes.
- The key plans (`blocks/edits.ts`, `joins.ts`, `tab.ts`, `open.ts`) carry a `refusal` field that
  becomes `refusedEditEffect`. Each plan gets the same fallback: run the plan with Track Changes off
  on the newest text of the unit to get N, then write R.
- `trackedFormat` (`format-blocks.ts`, `formatting.ts`, `highlights.ts`, `comments.ts`): a block
  change that throws becomes a replacement of the block in its new syntax. A comment or a highlight
  that has no place is anchored on the whole block instead (the inventory's 4 + 3).
- The table operations (`table-ops.ts`, `table-cols.ts`, `table-align.ts`): a table operation that
  today says "Decide it first" becomes a replacement of the table.
- With Track Changes off, `untracked.ts` has its own twelve refusals (the inventory marks 27 as
  showing with Track Changes off too). §3.4 says what they become.
- The plugins. **The inventory counted `packages/format` and `packages/editor` and missed the
  notices in `plugins/formatting` (20 `notice(` sites), `plugins/review` (4), `plugins/palette` (3)**,
  and 12.3, 12.4 and 12.5 live there (`NO_CODE_IN_CONTAINER`, `NO_TRACKED_HEADING_CODE`,
  `NOT_IN_ITEM`). They count as refusals, they get a tier in `refusals.ts`, and they are converted in
  the PR of their unit. Appendix B lists the ones I found.

## 2. The widened replacement, in the format

### 2.1 The form

A replacement is a substitution (§2.2) written in the block forms that already exist; its payload is
the whole old unit. A paragraph:

```markdown
Intro.

<!--sub r2zd The importer ships in April.-->

The importer ships in May, after the review.<!--/r2zd-->

Outro.
```

A table, which Ada rewrote while Bo had a pending change in it (the pipes in the payload are `\|`,
§2.5; Bo's insertion is the `<!-\-ins k3x9-\->` in the old row, and the closer stands in the blank
line after the table, the rule-9 form):

```markdown
Intro.

<!--sub r2zd \| Fruit \| Count \|\n\| -\-\-\-\- \| -\-\-\-\- \|\n\| Apples \| <!-\-ins k3x9-\->3<!-\-/k3x9-\-> \|\n\| Pears \| 5 \|\n-->

| Fruit | Count | Price |
| ----- | ----- | ----- |
| Apples | 3 | 1 |
<!--/r2zd-->
Outro.
```

Everything about the form (where the opener and closer stand, the carrier, the blank line that the
payload's final line break keeps, the closer after a fence) is §3.3 and §3.5, unchanged. The probe
read both with micromark: the table file reads as the new table, and accepting `r2zd` gives
`Intro.\n\n| Fruit | Count | Price |\n…\n\nOutro.\n`, exactly.

### 2.2 The old text holds other people's marks

**The rule.** The payload of a substitution is its old text, in the encoding of §2.5. An old text
that has other people's pending changes in it keeps them, written as the marks they are, in that
encoding. The encoding already writes a `-` that follows a `-` as `\-`, so that `--` never appears
and the comment can't end early; `<!--ins k3x9-->` is written `<!-\-ins k3x9-\->`, and decoded it
is the marker again. Nothing in the grammar changes, and nothing in a payload can end the comment.

```markdown
<!--sub r2zd <!-\-ins k3x9-\->Fast <!-\-/k3x9-\->importer ships <!-\-del w2rf very -\->April.-->

## Fast importer ships April.<!--/r2zd-->
```

Here Bo's insertion `k3x9` (Fast) and deletion `w2rf` (very) were pending in the paragraph when Ada
made it a heading, which the fine form can't do because Bo's insertion starts the block (inventory
#37). Her new text, the heading, is the paragraph as it reads with Bo's changes accepted. The old
text is the paragraph as it was, with Bo's changes still pending in it.

A mark in a payload is read as a mark when all of these hold, and is text otherwise, with a
warning (`payload-mark`):

1. its id has a ledger entry, and appears nowhere else in the body outside this payload;
2. its opener, closer and every segment are in the same payload (§2.2's forms, in one piece);
3. it nests no deeper than three payloads. A payload holds a payload when the unit replaced holds
   another person's replacement that itself holds a third person's marks in its old text. That is
   rare, and the limit bounds the backslashes, which double at each level (`\x60` is `\\x60`, then
   `\\\\x60`). Past it the edit goes to tier 3.

Their ledger entries stay in `marks` and in `comments`, as they were. Today the parser ignores a
payload, and a mark found only there is an orphan entry, which a save drops (probe: `orphan-entry`).
Making the parser read them is part of PR R1.

**What the marks are.** Other people's insertions, deletions, substitutions, format changes, splits
and table marks (`row`, `col`, `align=`, the deletion lines `row=N`), comments and highlights: all
the kinds. A comment is not a change, but it is a mark with an anchor, and the unit must hold its
anchor whole (closure, §1.3); see §2.3 for what accepting does to it.

**Code is the one unit that has none inside.** No marker is ever written inside a fenced block, so
no pending change of another person is inside a code block's text; the marks around it (a pending
insertion that holds the block, a substitution of it) are either the unit's closure or the first
mark that the replacement is stacked in (§2.4). The probes of this unit are in §2.4.

### 2.3 What accepting and rejecting do, in every order

Call the replacement R, its old text U (with Bo's marks m₁…mₙ in it) and its new text N.

| Decision | Result | The file |
| --- | --- | --- |
| Reject R | The old text, with its marks live again | Byte for byte the file before the edit (line breaks as the file has them, §8): R's markers, N and the carrier go, the decoded payload comes back. Bo's marks, and their ledger entries, are as they were. |
| Accept R | N, plain | R's markers go. m₁…mₙ go with U, and their ledger entries are dropped on save. A comment in U becomes a point comment at the start of N (the rule of a deleted block, §3.4 and §3.7 rule 4); a highlight in U goes. |
| Accept or reject mᵢ while R is pending | U changes as it would in the file: an accepted insertion becomes plain text in U, a rejected one leaves it, a deletion is the reverse | The payload is rewritten, and N is not touched. Rejecting R afterwards gives the file as if mᵢ had been decided before R was written. |
| Any order of these | Every order reads alike | A rejection of R, after any set of decisions on the mᵢ, equals those decisions in the file before the edit; an acceptance of R is N whatever was decided inside. |

A decision on mᵢ is refused exactly when it would be refused in the file: the rule is "decide mᵢ in
U as in the file, and put U back in the payload". The probe held the two equal on 20,008 decisions
(§2.6), and none was refused on one side and not on the other.

What this needs from the engine, beyond the writer: a parse that reads marks in payloads
(`parse.ts`, `scan.ts`), a decision that is aware of them (`decide.ts`: today it refuses
rejection, probe: "This decision would change the original text…"), the views (§2.5) and one
function `decideInPayload` that decodes a payload, decides one mark in it with the existing
`accept` and `reject`, and encodes it again.

### 2.4 A later edit inside it

The new text N of a replacement is text like any other text in a substitution: §3.6 says "an
insertion or substitution may contain other people's deletions, substitutions and format changes".
So:

- **By the author.** Further keystrokes of the author in N edit it in place, with no mark (§3.6,
  "Editing your own pending change"). When N becomes the unit as it reads with Bo's marks accepted
  again, the net change is nothing and R is removed: the file is the file before the edit, with Bo's
  marks pending where they were (it is a rejection of R). The author's own earlier changes that
  folded into R do not come back; that is what folding means.
- **By another person (a second person's replacement).** Bo's edit in N is an edit of text that
  Ada's pending substitution holds. If a fine mark reads alike, it is written inside N, as for an
  inline substitution (probe: typing, replacing and deleting a cell's text in Ada's new table, all
  sound in every order). If not, Bo's edit **widens in its turn, to a unit inside N**, written inside
  Ada's mark, stacked: Bo's replacement's payload is Ada's new text (plain), and Ada's marks stand
  around it.

  ```markdown
  <!--sub r2zd \| A \| B \|\n\| - \| - \|\n\| a \| b \|\n-->

  <!--sub s3vb \| A \| B \|\n\| - \| - \|\n\| z \| y \|\n-->

  | A | B |
  | - | - |
  | q | r |
  <!--/s3vb--><!--/r2zd-->
  ```

  Probe: stacked, in both forms (the two closers together, or apart), the file reads as its newest
  view in micromark, accepting Ada's first leaves Bo's pending with Ada's new text as its old text,
  rejecting Ada's first removes Bo's with it, and every order of the four decisions reads alike. The
  same holds for a code block (`r2zd` then `s3vb` around a fenced block), and for Ada's replacement
  of a block inside Bo's pending insertion of it. **§3.5 says "No form of a second substitution in
  the new text of a first reads the same in every order of decisions", which the probes show to be
  false for these forms**, and `format.md` changes (§2.7). The fine rules still hold for where a mark
  may go inside code, which is nowhere.
- **Nobody edits U.** The old text is hidden, as a deleted passage is. The only things to do with it
  are the decisions of the marks in it.

### 2.5 How the views and the cards draw and describe it

- **Redlines** draws R as a deleted block and a new block, as a replaced block is drawn today
  (`struck-check.ts`): U struck, in the author's color, and N after it. Bo's changes in U are drawn
  in Bo's color inside the struck text, so that who made what is still visible, and not editable.
- **Clean** shows N. **The simple look** shows where changes are: the old unit hidden, N marked as
  an insertion, the change bar for the whole of N (so a bar spans the table, and that is the right
  size: it is the change), and Bo's marks in U not drawn.
- **The review view** (CriticMarkup, what agents read) writes R as a substitution of the old unit's
  newest text by N, and names Bo's marks in a note, so that an agent can decide them by id:
  `{~~Fast importer ships April.~>## Fast importer ships April.~~}[r2zd ada]{>>[r2zd ada] Replaced a paragraph with a heading; its old text holds [k3x9 bo] and [w2rf bo]<<}`.
  When the words are the same and only the syntax differs, as in a change of type, it is the
  format change's note instead: `## Plan{>>[r2zd ada] Formatted: Heading 2 (was Paragraph)<<}`.
- **The original view** is U with its marks rejected, recursively: `originalView` of the file in §2.2
  is "Fast" gone and "very" back. Today it leaves the nested marker as text (probe), so this is
  engine work (PR R1).
- **The card** (`describeChange`, `plugins/review/src/shared.ts`) says what happened in Word's words:
  `Replaced table (3 columns, 4 rows) with table (2 columns, 2 rows)`, `Replaced “The importer ships…”
  with “The importer ships…”`, `Changed to Heading 2` when only the syntax differs, `Joined
  paragraphs` when two blocks became one. A second line says `Includes 2 pending changes by Bo Chen`,
  with a link that opens Review Changes at Bo's first change in it, and Bo's changes are
  decided there like any other, with the card of R as their context. Bo's card for each mark is not
  in the rail while R is pending; they are one step in R's.
- **The notice**, which doesn't interrupt (`ui/notifications.ts`, the theme's grays, never red, never
  takes the focus): "Tracked as a replacement of the whole table.", "…of the whole list item.", "…of
  the whole list.", "…of the whole code block.", "…of the whole paragraph." (heading, quote, alert),
  once for the keystroke that widened. An agent's edit shows no notice; its card says it.

### 2.6 How it reads in every order, and the suite that proves it

**What was tried** (Appendix A has the details). In a throwaway test, a replacement R was written by
hand for each unit, its old text holding other people's marks in the encoding above:

- **Tables.** Every first operation of Ada's on a small table (insert, delete, move a row or a
  column, align), then every second of Bo's, as the pair model draws them (`table-pairs.test.ts`):
  655 tables. Each was replaced by a table of another shape. The file with R pending read as the
  new table in micromark in 655 of 655; accepting R gave the new table exactly in 655; and deciding
  each of the 3,552 marks, accepted or rejected, inside the payload gave the same file as deciding it
  in the file and writing the result back, in 3,552 of 3,552, with no decision refused on either
  side.
- **Blocks.** 1,079 random documents (`randomDocument`: paragraphs, bullet and numbered lists,
  quotes, headings, alerts, with insertions, deletions, substitutions, comments and highlights
  nested to depth 3), 2,011 units that hold their marks whole (163 more skipped: a list item next to
  another list item is one list, so the unit is the list: §1.3's ladder, and the first thing the
  probe taught): the pending file read as its newest view in 2,011, accepting gave the new block
  exactly in 2,011, and the 16,456 nested decisions all agreed.
- **Stacking** (§2.4): sound in every order of decisions, micromark included, for a table, for a
  fenced block, for Bo's insertion around Ada's replacement.

**What the probes did not do**, which the real suite must: marks that cross the unit's edge
(closure); the engine's own `reject` of R, which refuses today (the probe wrote the proxy by
hand); comments in the payload and what accepting does to them (the probe's accept dropped them
and left their threads orphans); front matter; CRLF files; and R with Bo's marks drawn at random for
code and quotes inside list items.

**The suite** is `packages/format/src/widen-random.test.ts`, in the shape of
`code-substitution-random.test.ts` and `table-pairs.test.ts` (it uses `randomDocument`,
`listDocument`, the pair model's tables and the code generator), and holds these, for every
document and every unit that the writer widens:

1. **Sound.** `expectSound` on the result: every order of decisions of every mark, the replacement
   and the marks in its payload, reads alike, none is stuck, and the file on the way reads as its
   newest view in micromark.
2. **Commutes.** For every mark mᵢ in the payload and each of accept and reject: rejecting R after
   deciding mᵢ in the payload equals deciding mᵢ in the file after rejecting R.
3. **Exact.** Rejecting R gives the file before the edit, byte for byte, in LF and in CRLF files;
   accepting gives the intended newest text; the original view equals the original view before.
4. **Ledger.** After accepting R no mark of the payload has an entry left; after rejecting R every
   one has; ids are unique; comment threads of the payload have a point comment at the start of N
   after accepting.
5. **Stacked.** A second and a third person's edits in N, widened in their turn, in every order.
6. **Never refused.** Every edit that tier 1 refuses today, taken from the existing refusal tests
   (about 2,000 assertions mention a refusal), is widened or alerted, and none is refused unless its
   code is in the keep list.

It runs at `fuzzCount(300)` in a PR (about 20 s, with a 60 s timeout, as the probes ran) and at 5,000
in the sweep. It is the "random suite of its own" that the plan promises, and `hardening.md`'s
"How to add a rule" step 2 is met by it.

### 2.7 The text of `docs/format.md` that changes

The new section, and the edits, exactly. (Sentences not quoted stay.)

**New §3.12 (after §3.11).**

> ### 3.12 Widened replacements
>
> An edit that can't be written as marks at the grain it was made, so that every order of
> decisions reads alike, is written as a substitution of the smallest unit that holds it (below)
> with the unit as the old text and the unit as it reads with the edit made as the new text. There
> is no refusal for an edit that would read differently in some order of decisions: it is written
> this way. A substitution of this kind is written in the forms
> of §3.3 (a paragraph, a heading, a quote's paragraph, a list item, a list) and of §3.5 (a code
> block, display math, raw-text HTML) and §3.7 (a table), and nothing about its markers differs from
> theirs.
>
> **The unit** is a paragraph, a heading, an alert, a definition, a list item (its content, with the
> bullet outside the substitution), a list, a code block or a table. The edit is written as the
> replacement of the smallest of them that holds it and for which the file reads as its newest view
> with the replacement pending, the original view is what it was, and no marker stands at the start
> of a line that it didn't; otherwise of the next larger one: a block, then its list item, its list,
> and the quote that holds it. A unit holds every mark it touches whole: a comment, a highlight or a
> change that starts in the unit and ends outside it takes the blocks it spans into the unit. A unit
> of more than eight top-level blocks is not written, and the edit is not tracked (§3.13).
>
> **The old text holds other people's marks.** Marks in a payload are written in the payload's
> encoding (§2.5): `<!--ins k3x9-->` is `<!-\-ins k3x9-\->`. A decoded payload's marker is a mark
> when its id has a ledger entry and stands nowhere else in the body, its opener and closer are in
> the same payload, and payloads nest at most three deep. The entries of such marks stay in the
> ledger. Your own pending changes in the unit are not kept: they fold into the replacement, as
> rejecting them would.
>
> - Rejecting the replacement writes the decoded payload, marks included, where the replacement was:
>   the file as it was before the edit, byte for byte but for the file's line breaks (§8).
> - Accepting it leaves the new text. The marks in the payload go with the old text, with their
>   entries; a comment in it becomes a point comment at the start of the new text, as for a deleted
>   block (§3.4, §3.7); a highlight goes.
> - Accepting or rejecting a mark in the payload decides it in the old text, as it would be decided
>   in the file, and writes the payload again; the new text is not touched. It is refused exactly when
>   it would be refused in the file.
> - Every order of these decisions reads alike: the old text is, after any decisions, what
>   deciding them in the file before the edit would have left, and rejecting the replacement gives
>   that; accepting it gives the new text whatever was decided.
>
> **Editing it.** The author's further edits in the new text are made in place, with no mark (§3.6).
> When the new text is the unit as it reads with the marks of the old text accepted, the replacement
> is removed, and the unit is as it was, with those marks pending. Another person's edit in the new
> text is written as a mark in it where a fine mark reads alike in every order, and else as a
> replacement of a unit of the new text, written inside the first replacement's text: its old text is
> the first's new text, and the marks of the first stand around it. Accepting the first leaves the
> second pending, with the first's new text as its old text; rejecting the first takes the second
> with it.
>
> **With Track Changes off** an edit that can't be made without deciding other people's pending
> changes in its unit is made after an alert (§3.13), and decides them: the unit is written as the
> edit makes it from the newest text, which accepts those changes.
>
> Every order of decisions reads the same, judged against micromark 4.0.2 with GFM
> (`widen-random.test.ts`).

**New §3.13, Untracked edits** (after §3.12), for the alert: "An edit that can't be tracked, and
that no unit holds, or that is in front matter or in Raw while Track Changes is on, is made without
tracking after the person is asked, and leaves no mark and no ledger entry. In a file
that keeps its full history it is an `edit` event, as every edit with Track Changes off is (§3.10,
§6.2). An agent's edit is never made so: it is refused, with words for the agent."

**§2.1, after the payload line of the ABNF's bullets**, add: "A payload may hold marks, written in its encoding (§3.12)."

**§2.2, the Substitution row**, Records: `Replaced text; the payload is the old text, and may hold other people's marks (§3.12)`.

**§3.5**: replace "Another person's pending insertion or substitution that holds the block is
theirs to decide first. The edit is refused (`no-legal-placement`) and names them: "This would
change how Bo Chen's insertion reads. Decide it first, or turn off Track Changes." No form of a
second substitution in the new text of a first reads the same in every order of decisions." with:
"Another person's pending insertion or substitution that holds the block is theirs to decide, and
an edit of the block is a replacement of the block written inside it (§3.12): a second
substitution in the new text of a first reads the same in every order of decisions." Delete the
bullet "A marker anywhere in a block's range … is a pending change in the code, and the edit is
refused…" (a marker there is another person's mark that the block's replacement takes into its
payload, §3.12), the bullet on mixed line breaks (the payload gives the file's line break back, as
§8 says of every restored text), and the paragraph "Not built yet, and refused…" (code that starts a
list item, indented code in an item or a quote, are changed as part of their item or their list,
§3.12).

**§3.6, first paragraph**: replace "Payloads never contain markers, because an HTML comment can't
contain another." with "A payload never holds a marker as HTML, because an HTML comment can't contain
another: it holds it encoded (§2.5), and where it decodes to marks, §3.12 reads them."

**§3.7, rule 6, "Another person's pending changes stay theirs"**: replace "With Track Changes on, a
table that holds one can't be deleted until it is decided (…)" with "The deletion's payload holds the
table with them in it (§3.12), and so for a row or column that is another person's pending
insertion or move, or that holds their pending change: the operation is a replacement of the table
where its fine form is not sound." Delete the three comment refusals of the rule ("A comment with one
end in the table and the other outside it is refused…" and "…no text next to the table can keep it"):
a comment is a mark in the payload, and one that crosses the table's edge takes the block it
crosses into the unit (§3.12). The refusals "Decide it first" of rows, columns and alignment in
rules 2, 3 and 5 become replacements of the table in the same way.

**§3.8, first paragraph**: replace "Until the editor does that, an edit there is refused with the error
code `front-matter`: "Front matter can't be edited with Track Changes on yet."" with "An edit there
with Track Changes on is made after the alert of §3.13, and leaves no mark." The comment and
highlight sentences become: the commands are disabled in front matter.

**§8, the Original view**: after "every pending change rejected", add "A replacement's old text is
read as it would be with its own marks rejected too."; **the Review view**: add a paragraph, the one in
§2.5 above.

**§12**: add to the list: "The widened replacements of §3.12 are held by `widen-random.test.ts`:
every order of decisions of the replacement and of the marks in its payload reads alike."

**`hardening.md`**, property 2: "Redlines is meant to widen rather than refuse, and ask before an
untracked edit." Its text: "An edit that no fine form can write soundly is written as a replacement
of the smallest unit that holds it, with other people's pending changes in its old text, or, where no
unit can be written, made without tracking after the person is asked. A refusal is kept only where
every write would leave the file wrong (an unreadable ledger, forged markup, an agent's quote that is
not there), in words that name the cause." "How to add a rule", step 4: "Widen where no fine form
reads alike. Don't add a refusal: `refusals.node.test.ts` fails on one with no tier." The section
"Refusals that are planned to go away" goes.

## 3. The alert

### 3.1 When it shows

Only when no unit can hold the edit (tier 3). The inventory's three are front matter and Raw, which
never reach tier 2 (no unit can hold YAML, and Raw is not a unit), and #6, which tries tier 2 first:

| Case | Inventory | When | The detail line under the title |
| --- | --- | --- | --- |
| Front matter | #141 | Typing, deleting or pasting in the YAML front matter, Track Changes on | Front matter is data that other tools read, so Redlines can't mark a change in it. |
| Raw | #73 | Typing in Raw, Track Changes on | Raw shows the file's own text, where Redlines can't mark changes. |
| The first line of the file | #6 | Backspace at the start of a nested item or quote on the file's first line, when widening that list or quote fails the gate | A marker at the start of the file can't be taken out as a tracked change. |
| No unit passes | the `widened` fallback | A unit larger than the cap, a closure that reaches the whole document, a file whose end can't hold the marks | This change is too large to track as one replacement. |

The alert is a sheet attached to the window (not a system dialog, so that it can hold the
checkbox), modal to that document, in the app's own look; title and buttons are fixed:

> **This edit can't be tracked. Make it without tracking?**
> *(detail line from the table)*
> ☐ Don't ask again in this document
> **Cancel**  **Make Edit**

- **Return and Escape are Cancel; Make Edit is a click or ⌘↩.** A person who types and presses
  Return must not make an untracked edit by habit. This is a ruling; §8 asks.
- **One answer per run.** Make Edit applies to the edit, and to the edits that follow it in the same
  run (the same unit, no other activity for five seconds, still in Raw, still in the front matter),
  so that typing a word in Raw is one alert, not one for each letter. Cancel drops the edit.
- **"Don't ask again in this document"** is kept by the app for that file, in its application
  support folder, keyed by the file's path, and not in the file: Bo opening Ada's file must be
  asked. It ends the question for that file on that Mac; Preferences › Editing has "Ask again in all
  documents" (a button). It is not a ledger setting (§5.6), because a ledger setting would pass
  Ada's answer on to everyone who opens the file.
- It is asked once for any way the edit is made: a key, a paste, a drop, a menu command, an input
  method's composition, and the sheet takes the edit and holds it. The transaction filter is
  synchronous, so it swallows the transaction, sends an `untrackedAsk` effect with the edit and the
  document it was made against, and, on Make Edit, applies it again with Track Changes off if the
  document is unchanged (it is modal, so it always is), and drops it otherwise.

### 3.2 What the untracked edit leaves

Per Stephan's decision 8, **no trace in the ledger**: no mark, no entry, no `note`, as in Word. In a
file that keeps its full history (§6.2) it is an `edit` event, as every edit with Track Changes off
already is (§3.10); that is the history the person chose to keep, not the ledger of marks. Nothing
else records it. Undo takes it back as any edit.

### 3.3 What an agent's edit does

**An agent can't answer an alert, and an untracked edit by an agent is an invisible change to a
person's document, so it is never made.** I take your suggestion: the agent's edit is **widened where
it can be**, with its `note`, and is **refused, with words to the agent,** where it can't. The refusal
is the only place "alert" becomes "refuse", and it is an existing refusal, not a new one. The words
say what happened and what to do, since the agent reads them and the person doesn't:

- front matter: "Front matter can't be edited as a tracked change. Don't edit it, or ask the person
  to edit it."
- no unit: "This change would replace more than {n} blocks that hold {Bo Chen}'s pending changes, so
  it can't be tracked as one change, and nothing was written. Make smaller edits, or ask the person
  to decide those changes first."

Widening for an agent is subject to the same cap (8 blocks) and closure. A small agent edit that
becomes a whole-table replacement because Bo has a pending change in the table shows on the card as
the agent's replacement with Bo's changes in it; its `note` says what the agent meant, and
`group` groups it with its siblings as always (§5.4).
`NO_MATCH`, `MANY_MATCHES` and the unreadable ledger stay as they are (§5).

### 3.4 Track Changes off

27 refusals show with Track Changes off too; the whole family of `untracked.ts` (inventory #168–174,
#132, #133 and the decisions). With Track Changes off a keystroke is an edit of the text itself and
has no marks to write; it is refused today where Bo's pending changes around it would read
differently once it is made. Tiers 1 and 3 only, since there is nothing to track:

1. **Fine** as today.
2. **Else, the unit is rewritten from its newest text, and Bo's pending changes in it are accepted**
   (they are the baseline that the edit was made against: it is what the person sees). That decides
   another person's changes without asking, so it is behind the alert, with its own words: **"This
   edit can't be made without accepting Bo Chen's 2 pending changes in this paragraph. Make the
   edit?"** — Cancel / Make Edit. The reject direction is never chosen for them.
3. **Else**, the bug notice.

§8 asks whether accepting is the right direction. It is how Word behaves when the text of a tracked
insertion is edited with tracking off: the text is edited and stays pending; it can't be kept
pending here, because that is what the refusal was about.

## 4. Disable

### 4.1 The 33

A command is disabled when it has no target or no sound meaning. The hint is one sentence in the
words of the interface: what the thing is, then what to do. Where the command is a key with no menu
item, the key shows the hint as a notice that doesn't interrupt (a key that does nothing and says
nothing is a bug, `hardening.md`). "Mechanism" says where it is grayed.

| # | Command | Situation | Hint |
| --- | --- | --- | --- |
| 4 | Shift-Return | caret in a heading | A heading is one line. Press Return to start a new paragraph. (key notice) |
| 5 | Shift-Return | a line break is already there | There is a line break here already. Return starts a new paragraph. (key notice) |
| 14 | Tab, Indent (⌘]) | the first item of a list | The first item of a list can't be indented: there is no item to put it under. |
| 15 | Tab, Indent | an empty item that follows text | An empty item can't go under a line of text. Type in the item first. |
| 16 | Indent, Outdent | the caret is not in a list item | Only a list item can be indented or outdented. (Paragraph menu, toolbar) |
| 17 | Outdent (Shift-Tab, ⌘[) | a top-level item | This item isn't under another item. Backspace at its start takes the bullet away. |
| 41 | Reject, on the card and in Review Changes | a format change whose block no longer has that syntax | This change can only be accepted: its block no longer has that syntax. |
| 42 | Alert type | the caret is not in an alert | Put the caret in an alert (a quote whose first line is [!NOTE]) to change its type. |
| 45 | Reject | an alert change whose first line lost its type | This change can only be accepted: its alert no longer has a type on its first line. |
| 46 | Alert type | a type with a character that isn't a lowercase letter, digit or hyphen | The type picker offers valid types only. The agent tool keeps an error for a bad argument (re-tiered: **keep**, see §4.3). |
| 47 | Reject | a format change whose text lost the formatting | This change can only be accepted: its text no longer has that formatting. |
| 67 | typing in a heading's closing #s or {attributes} | the characters are syntax, drawn in no view | (none: the caret can't enter them in Clean or Redlines; in Raw with Track Changes on, the alert) |
| 74 | Undo, Redo | after the file changed on disk | The file changed on disk, so Undo isn't available. |
| 75 | any edit | no author set | Not a command: the person is asked for their name once, in a sheet (**re-tiered: ask**, §4.3). |
| 84 | Accept, Reject | a kind of change Redlines can't decide yet | Redlines can't decide this kind of change yet. |
| 85 | Reject | a format change whose old text can't be restored | This change can only be accepted: its old text can't be restored. |
| 108 | Reject | an alignment change after the columns changed | This change can only be accepted: the table no longer has the columns it had. |
| 109 | Align Left, Center, Right | the column is aligned that way already | Shown as the current state (checked) and does nothing: The column is already aligned this way. |
| 110 | Delete Column | the table has one column | A table keeps at least one column. Delete the table instead. |
| 111 | Delete Row | it would delete every row | A table keeps at least one row. Delete the table instead. |
| 113 | Insert Rows, Columns | the agent asks for what is there | Not a command: the agent tool answers "No change needed: the rows are already there" (**re-tiered: success with no change**, §4.3). |
| 116 | Return in a table cell | a pipe or a line break typed raw | A table cell holds one line. Tab moves to the next cell. A pipe typed is written `\|`. |
| 118 | any key | the selection is in a gap of a table outside its cells | (key ignored: the caret can't rest there; no notice, as the inventory says) |
| 135 | Bold, Italic, Link, … | selection inside code, an HTML block or an HTML comment | Formatting doesn't apply inside code. Select text outside it. |
| 136 | Bold, Italic, … | selection is part of a code span | Select the whole code span to format it. |
| 137 | Insert Image, paste or drop an image | the caret is in code | An image can't go inside code. |
| 140 | Format | the selection is in front matter | Front matter is YAML, not text to format. |
| 152 | Format | a line that defines a link | This line defines a link. It holds no text to format. |
| 161 | any format not built | — | Not registered: a command that isn't built isn't in the menu. |
| 179 | Comment | the selection is in front matter | A comment can't be anchored in front matter. Select text in the body. |
| 182 | Highlight | the selection is in front matter | A highlight can't be made in front matter. Select text in the body. |
| 185 | Highlight | nothing selected, or only line breaks and markers | Select some text to highlight. |
| 186 | Accept, Reject | a comment | A comment is resolved or deleted, not accepted or rejected. (its card shows Resolve and Delete) |

### 4.2 How the menus and the toolbar gray them

`EditorCommand` already has `isEnabled(state)`, which `menu-model.ts` reads (`enabledCommands`) and
`native-menu.ts` follows with `setEnabled`. Two additions, both small:

- **`disabledReason?(state): string | undefined`**, beside `isEnabled`: the hint above, or nothing.
  `isEnabled` is derived from it (`disabledReason(state) === undefined`) so that the two can't
  disagree, and a test holds every disabled command to a reason.
- The editor's UI state gains `disabledReasons: Record<commandId, string>`, as it has
  `enabledCommands`. The toolbar (lane B) shows a disabled button grayed, with its reason in the
  hover hint, in the same words. **A native menu item can't show a hint** (muda has no per-item
  tooltip, to be verified in PR R6): it is grayed, and the same command's shortcut shows the reason
  as a notice when it is pressed. The decision refusals (rows 41, 45, 47, 84, 85, 108, 186) are
  Reject (or Accept) buttons on a card and in Review Changes: grayed, with the hint, and "Reject All
  Changes" leaves such changes pending and says how many ("2 changes can only be accepted; they
  were left pending.").
- Lane B builds the toolbar; PR R6 gives it the reasons and does not touch its layout.

### 4.3 What I would move

Three of the 33 are not menu commands: #46 (a bad alert type is an argument error: the picker offers
valid types, the agent tool refuses a bad one; **keep**), #75 (no author: ask for a name once; no
refusal, no disable), and #113 (an agent asks for rows that exist: a success with no change, not an
error). The count of the tier stays 33; the mechanism of these three differs.

## 5. Keep

These 11 stay refusals. Each rests on one reason: **any write would leave the file wrong, or the
edit has no meaning to apply.** They are listed in `refusals.ts`, with the code that marks them, and
a test holds their words.

| # | Refusal | Why it stays |
| --- | --- | --- |
| 86 | Unknown id (decide, reply, comment) | An argument error: a stale id must not decide a different mark. |
| 114 | An index outside the table (agent, API) | An argument error: an out-of-range index must not write at another cell. |
| 138 | An image insert that lost a race with another edit | A stale insert would write into text that moved. |
| 139 | The file ends inside an unclosed code block or comment, so the ledger can't be added | Without a ledger the change reads as plain text; writing it would misrecord silently. |
| 160 | A link destination that holds Redlines markup | A destination with markup forges marks. |
| 175 | An edit that splits a surrogate pair (API) | Half an emoji corrupts text, and no keyboard can do it. |
| 176 | Text that holds Redlines markers, pasted or typed | It could close someone else's insertion or forge a mark. |
| 177 | The ledger can't be read | Overwriting it would silently lose who made what. |
| 178 | The random source gives the same bytes | A reused id would collide silently with another mark. |
| 187 | An agent's quote that isn't in the text | Writing at a guessed place would change the wrong text. |
| 188 | An agent's quote that is in the text more than once | The same, at the wrong occurrence. |

**#139, #176 and #177 are the three where a person, not an agent, could be asked instead** (an alert,
then an untracked edit of the body: the ledger is not written). Stephan's list keeps them as
refusals, and so does this design; a person typing a marker is rare, and a file with a ledger that
can't be read is a file to fix first. §8 asks whether to offer the alert.

## 6. Stephan's five, from the Test Drive

Each was written by hand and run through the library and micromark. Reject gives the file before the
edit, accept gives the intended text, and every order of decisions reads alike, except where it says
what doesn't.

### 12.1 Joining a paragraph into a `===` heading

Today refused (`SETEXT_JOIN`, #11): the heading's underline would have to follow the new text, behind a
marker. **No refusal.** The join is a replacement of the heading and the block below it, and the
new heading is written as an ATX heading of the same level (`===` is `#`, `---` is `##`):

```markdown
Intro.

<!--sub k3x9 Plan\n====\n\nNext paragraph.-->

# Plan Next paragraph.<!--/k3x9-->

Outro.
```

Rejecting gives `Plan\n====\n\nNext paragraph.` back exactly; accepting gives `# Plan Next paragraph.`,
exactly (probe: both, micromark: reads as the new heading, every order alike). The file's heading
syntax changes in the process, which is what you asked for. The card says `Joined paragraphs`, and the
notice "Tracked as a replacement of the heading and the paragraph below it." The ATX form is written
whether the underline was `=` or `-`, and a setext heading that isn't joined stays as it is.

### 12.2 Front matter

The alert of §3, with the detail line "Front matter is data that other tools read, so Redlines can't
mark a change in it.", then the edit made without tracking, no mark and no ledger line. Typing in
front matter with Track Changes off is as it is. A comment or a highlight on front matter is
disabled (#179, #182), and Format is (#140). An agent's edit is refused with the words of §3.3.

### 12.3 Code that starts a list item

Today refused ("A tracked change can't go in code that starts a list item yet", #129). **Widened.**
You decided the list item; the probe says the item's form can't be written in a *tight* list, and
that the list's can:

```markdown
- ```js
  let a = 1;
  ```
- two
```

Typing in the code with Track Changes on writes, with the unit the list:

````markdown
Intro.

<!--sub k3x9 - \x60\x60\x60js\n  let a = 1;\n  \x60\x60\x60\n- two\n-->

- ```js
  let a = 2;
  ```
- two
<!--/k3x9-->
Outro.
````

For the item (the opener after the bullet, the content on the next line, the closer alone on the line
after the closing fence) the probe found two failures: the closer's own line is a blank line in a
tight list, which makes it loose, so accepting leaves `  \n- two` (a loose list: it reads
differently from the file before), and the file doesn't read as its newest view in micromark. The
ladder (§1.3) therefore goes up from the item to the list, because that is the first rung that
passes the gate. **For an item of a loose list, or the last item with a blank line after it, the
item's form passes and is used.** §8 asks you to confirm this.

### 12.4 A heading made into a code block

Today refused in the plugin ("A heading can't become a code block while Track Changes is on. Make it
body text first.", `NO_TRACKED_HEADING_CODE`). **Widened to the block:**

````markdown
Intro.

<!--sub k3x9 ## Setup\n-->

```
Setup
```
<!--/k3x9-->
Outro.
````

The heading's `## ` is not in the code: the new text is the heading's words in a fence, as Paragraph
› Code Block makes them for a paragraph. Probe: reject gives `## Setup`, accept gives the block, the
file reads as its newest view, every order alike. The card says `Replaced “Setup” with a code block`.

### 12.5 A list item made into a heading

**Disabled**, in the Paragraph menu and the toolbar, with the hint "A list item can't be made into a
heading. Take it out of the list first (Shift-Tab, or Backspace at the start of the item)." The plugin
refuses it today in words of its own (`NOT_IN_ITEM`, `A list item can't become …`); that notice becomes
the hint, for the other two types it names as well ("A list item can't become a quote…"). The
inventory's #23 `INSIDE` ("a block inside a list or a quote can't change type", widen) is a
different case: a paragraph *inside* an item or a quote, which widens to the item or the quote. The
plugin's `NOT_IN_ITEM` is a 34th row for the disable table that the inventory didn't see
(Appendix B). **Note that 12.5 is disabled and #23 is widened, and the two look alike in the menu:**
the command is disabled when the caret is in the item's own first block (a list item *is* a
paragraph with a bullet), and a quote paragraph or a second block inside an item is a block that
widens.

## 7. The order of work for next week

Tests are written first, in the PR of the unit, against the refusal tests that exist now: a refusal
test that asserts `toThrow` for a case that widens becomes a test that the edit is widened and every
order reads alike. PRs are small and one per unit; each says how many refusals it takes off and
carries journey screenshots of the change in the flow it is for (the alert, the notice, the card, a
grayed command).

| PR | Unit | What | Tests | Takes off |
| --- | --- | --- | --- | --- |
| **R1** | the engine | `parse.ts`/`scan.ts` read marks in payloads and warn on the rest; `decide.ts` rejects, accepts and decides inside R; `views.ts` (original, review); the comment-point rule; `widen.ts`: unit ladder, closure, the writer, the gate; `format.md` §2.1, §2.2, §3.5 (the sentences above), §3.6, new §3.12, §3.13, §8; `hardening.md`; `refusals.ts` and its test, with every refusal given a tier | `payload-marks.test.ts`, `widen-random.test.ts` (§2.6's six properties), the probes' pair model as a permanent test, a differential run against main on the existing random suites (no existing suite changes) | none: a writer that nothing calls yet, and the one rule that no refusal may be added |
| **R2** | tables | `trackedEdits`-style fallback for the table operations and the cell edits: the unit is the table. Rows, columns, alignment, deleting a table with others' changes, formatting a cell, highlighting across rows | `table-widen.test.ts` over the pair model (§3.7: every pair of operations, now also widened), `table-cols-random`, `table-rows-random`, `table-format-random` extended to draw the widening; Lane T's journey "Insert Column in a heavily edited table" (Test Drive 11.2) | 28 widen; the "Decide it first" guards of rules 2, 3, 5 and 6 in `table-rules.ts` (1,056 lines), `table-ops.ts`, `table-align.ts` |
| **R3** | lists | Return, Tab, Shift-Tab, Backspace, change of list type, in lists: key plans fall back to the list item or the list. The four list refusals for too many pending changes | `blocks/walk.test.ts` and the Tab walks now with the widening on and no refusal allowed (the skipped seeds 46, 130, 146 are drawn again); `list-widen.test.ts` (the layouts of `listDocument`) | 22 widen; `TOO_MANY_ITEMS`, `format-apart.ts`'s "marks apart" machinery (902 lines) |
| **R4** | blocks | Type changes, joins, splits, formatting next to others' marks, the self-check nets, the agents' two block refusals, comments and highlights that have no place; the Test Drive's 12.1 | `block-widen.test.ts`, `first-prefix-random`, `join-random` (the join of an agent's edit now widens: #189), `agent.test.ts` | 79 widen + 4 + 2 (comments, highlights, agents); the largest part of `track.ts`'s placement refusals (51 sites), `break-reach.ts`, parts of `placement.ts`, `wrapped-line.ts` |
| **R5** | code | Typing in code, a fence, a block of code that starts a list item (12.3), a heading to a code block (12.4), math and raw HTML | `code-widen.test.ts`, `code-substitution-random.test.ts` extended to draw others' marks around the block and the stacked form | 14 widen; `code-edit.ts` guards, §3.5's "Not built yet" paragraph |
| **R6** | alert and disable | The sheet, the held transaction, "Don't ask again", the untracked path's own fallback (§3.4), front matter (12.2), Raw; `disabledReason`, the 33 hints, the toolbar's hover hints with lane B | Playwright journeys for the alert, the notice, a grayed command with its hint; unit tests for `tierOf`, for the held transaction (key, paste, IME) and for the 33 | the `RAW_READ_ONLY` and front-matter refusals, 33 disable sites, the plugin's notices of Appendix B |
| **R7** | sweep | What is left: the rules in `format.md` that exist only to make a fine edit sound or to refuse it; `hardening.md`'s list of refusals planned to go away; the issues R takes (#284, #285, #420, #448, #454, #477, #478) closed with their PR | The Epic sweep's full tier: `widen-random` at 5,000, the walks at depth, every journey in four looks | the rest |

R1 goes first and alone; R2 to R5 follow in that order, as the plan says, and each can be merged
as soon as its tests pass; R6 starts when R1 has merged and runs beside them in a session of its own,
because it touches the editor's UI and the plugins and not the format library. R6 and lane B's toolbar
meet at `disabledReason`; R6 gives B the interface on its first day.

**What can be deleted once widening covers it, roughly** (an estimate by file and by the inventory,
not a measure): of the roughly 300 places that throw, the 143 widen refusals are about 215; the
`format.md` sentences that mention a refusal are about 200, and I'd expect 120 to 150 of them to
change or go; the guards in `format-blocks.ts` (65 sites), `table-ops.ts` (57), `track.ts` (51) and
`formatting.ts` (44) are most of it; the "marks apart" argument of §2.6 and its code
(`format-apart.ts`, 902 lines, with 73 KB of tests) exists to bound how many marks a format change
is checked against, and does not need to once an edit past the bound widens; `break-reach.ts` (538)
and the sections of `placement.ts` that exist to refuse. That is 1,500 to 2,500 lines of source,
and a rule's tests mostly flip from "is refused" to "is widened", not to nothing. The refusal
tests that assert a refusal (about 2,000 mentions of `toThrow`, `EditError` or "refus" in the test
files) are the first check of each PR: **a refusal that is still thrown is a failing test**, which
is the inverse of what they were.

**What I would not delete** without a reason of its own: `SELF_CHECK`, `EVERY_ORDER`,
`FORMAT_SELF_CHECK`, `UNTRACKED_SELF_CHECK` and `CANT_MAKE_HERE_YET` as assertions (the inventory
says the same), the placement rules of §3.1 to §3.5 that write the fine forms, and the cost gates.

## 8. Risks and open questions for Stephan

Each with a recommendation. They are in the order of how much each changes what gets built.

1. **12.3 asked for the list item; the probe says the item's form fails in a tight list.** Widen to
   the item where its form passes and to the list where it doesn't (the ladder). *Recommend: yes.*
   The alternative is to make the list loose, which changes how every renderer shows it.
2. **The cap on a widened unit: 8 top-level blocks.** A comment across ten paragraphs makes a
   ten-block replacement, which no reviewer wants to read; past the cap the edit is alerted (or
   refused to an agent). *Recommend 8,* with the number a constant to change after the Test Drive.
3. **With Track Changes off, an edit that can't be made without deciding Bo's pending changes
   accepts them, after an alert that names them (§3.4).** The other directions are to reject them
   (loses Bo's words) or to refuse (the refusals this lane removes). *Recommend: accept, behind the
   alert.* It decides another person's change on their behalf, with the person's say; Word's
   own tracking-off edit inside a pending insertion edits it and leaves it pending, which can't be
   written here.
4. **The alert's default is Cancel, and the sheet is modal and holds the edit.** *Recommend: yes.* A
   typed Return mustn't make an untracked edit. Say if you want Make Edit the default, as Word's
   alerts usually have it.
5. **"Don't ask again in this document" is kept by the app, by file path, not in the file.**
   *Recommend this:* a ledger setting would pass Ada's answer to Bo. Its cost: moving or renaming
   the file asks again, and a second Mac asks too.
6. **Comments and highlights in a replaced unit.** I kept them in the payload, so that rejecting is
   exact; accepting turns a comment into a point comment at the start of the new text and drops a
   highlight (the rule a deleted block has). *Recommend: yes.* The alternative is to make them point
   comments at once, which loses their range when the replacement is rejected.
7. **Bo's changes in Ada's old text are decidable while R is pending** (one step in R's card, and by
   id for agents). *Recommend: yes.* The alternative, "decide R first", is the refusal again.
8. **File size and readability.** A replaced table is one long line of payload, as a replaced code
   block already is, and git diffs of it are unreadable. A rewritten table over a heavily edited
   one doubles that text. *Recommend: accept,* with the depth limit of three and the cap of 8 blocks
   as the bounds, and watch real files in the Test Drive; Simplify markup (§3.6) can collapse later.
9. **Hidden text.** The old text of a replacement is hidden text that a renderer that passes HTML
   through publishes (§9.6 says so of every deletion); a widened replacement holds more of it, and
   holds Bo's pending words in it. *Recommend: say so in §9.6's text and nothing else.*
10. **Word export.** Word's own model has this: a revision inside a revision (Bo's insertion that
    Ada deleted is `w:ins` around `w:del`). The exporter writes a substitution as a deletion and an
    insertion (§2.2) and has never seen marks in the old text. *Recommend: an issue for after the
    Epic,* with the export writing the old text's marks accepted until then.
11. **The plugins' notices were not in the inventory** (Appendix B: about 27 sites). They get tiers in
    the same PRs. *Recommend: audit them first,* in R1, since 12.3, 12.4 and 12.5 are among them and
    a count of "190" understates the work.
12. **The three keeps where a person could be asked instead: #139, #176, #177.** Offer the alert
    there too? *Recommend: no,* as you listed them; a file that can't take a ledger is better
    fixed first, and a paste that holds markers is better escaped by the paste (a separate fix).
13. **Marks that cross a unit's edge were never drawn by the probes.** Closure is a rule, argued
    and not tried. *Recommend: R1 ships with `widen-random` drawing them (block-spanning
    deletions, comments across blocks, splits, a column insertion's marks), and R2 doesn't start until
    it passes.*
14. **Cost.** The first keystroke that widens parses, finds the unit, writes a payload, and runs the
    gate. A table of 150 KB with 200 changes is the case. *Recommend: a row in the cost gate*
    (`cost.test.ts`: twice the cost of a fine keystroke is the existing bound, hardening.md property
    4) *and a measure in R1 before R2 builds on it.* Later keystrokes are free (§1.3, "Once").
15. **A widened change is one big reviewable thing.** Someone reviewing sees "Replaced table (3
    columns, 4 rows) with table (3 columns, 4 rows)" for an edit of one cell. The card's second line
    must say what differs. *Recommend: the card shows the cells that changed* (a diff of the
    two, which the table diff already computes: `table-diff.ts`). This is a design of the card, not
    of the format, and goes to the review lane.
16. **One tracked change can now carry other people's changes in it.** Accepting Ada's replacement
    drops Bo's pending changes, which Bo has not seen. This is the real cost of the policy, and Word
    has the same: Bo's insertion, deleted by Ada's accepted deletion, is gone. *Recommend: the card
    says it ("Includes 2 pending changes by Bo Chen") and Accept All says how many changes of other
    people it dropped.*

## Appendix A. What the probes did

Seven throwaway test files (`zz-widen-probe*.test.ts`), run at `24a41633` in this worktree with vitest and micromark 4.0.2 with GFM
(`readAs`, `expectSound` and `expectEveryOrderRead` of `oracle.ts`), not committed; their sources and
output are in the Epic folder (`lane-R-probes/`). In order:

1. **A hand-written replacement of a table, with Bo's insertion in the payload** (§2.1). The file
   with it pending reads as the new table in micromark. The library, as it is today, treats the
   payload as text: `orphan-entry: The ledger entry k3x9 has no mark`, the original view leaves the
   nested marker as text, and rejecting R is refused ("This decision would change the original text,
   because a marker that goes lets the text next to it be read otherwise"), in three forms of the
   closer. The form of rule 9 (the closer in the blank line after the table, the payload ending with
   the line break) accepts to `Intro.\n\nN\n\nOutro.` exactly; the other two leave extra blank lines.
2. **655 tables** (the pair model's first and second operations by Ada and Bo, §2.6) with R written by
   hand: read as new 655/655, accept exact 655/655, 3,552 decisions inside the payload = deciding in the
   file and writing back, 3,552/3,552, no refusal on either side.
3. **1,079 random documents**, 2,174 blocks: 163 skipped (a list item beside another item is one list),
   2,011 units; read as new 2,011/2,011, accept exact 2,011/2,011, 16,456 nested decisions equal. 
   (The first run had 48 "differences", all a trailing space at the end of a unit, an artifact of the
   proxy file; and 9 units that didn't read as the new block, all the list-beside-list case.)
4. **Stacked and nested replacements** (§2.4), by hand: a second person's replacement of the whole
   new table; of the new fenced block, closers together and apart; a replacement of a code block inside
   another person's pending insertion of it. All read as new, and every order of the decisions is sound.
   Bo's typing, replacing and deleting a character in Ada's new table: written by the existing
   engine inside her mark, sound.
5. **The five cases** (§6): 12.1 and 12.4 read, accept and reject exactly, and are sound; 12.3 as an item
   fails (the closer's blank line loosens a tight list: `reads as newest: false`), as the list it
   passes.

**Not tried:** marks across the unit's edge; the engine's own rejection of R (refused today); comments
in the payload under Accept; CRLF; front matter; the agents' path; the keys. They are the first work of
R1.

## Appendix B. Refusals the inventory didn't count

In `plugins/formatting/src/index.ts`, as constants and `notice(` calls: `ALREADY_CODE` ("This is
already a code block": disable), `MARKS_IN_CODE` ("Accept or reject the changes in these lines
first, then make them a code block": widen the block), `NOT_IN_ITEM` (12.5: disable), `WRITE_ITEM`
("Write the item first.": disable), `CHANGE_IN_WAY` and `BOX_STUCK` and the box notices ("Accept or
reject Bo's change to this box first.": widen the item), `NO_BOX` ("Check Item works on a task list
item": disable), `NO_CODE_IN_CONTAINER` (12.3's cousin: "A code block can't be made inside a list or a
quote yet.": widen the list or the quote), `NO_TRACKED_HEADING_CODE` (12.4: widen), `TAGS_NOT_A_PAIR`
(widen), `MARKER_ONLY` (disable), "There is no text in the selected cells to make …" (disable). In
`plugins/review` (`highlight.ts`, `rail.ts`: the Raw refusal, an alert) and `plugins/palette` (an
image paste's "no text": disable). About 27 sites. They are in `refusals.ts` with the rest, and the
test fails until they are.
