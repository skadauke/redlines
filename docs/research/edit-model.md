# The edit model: accept, reject and paragraph breaks

Status: research notes, October 2026. A reference model of Word-style tracked changes,
property-tested against the file format.

An earlier version of the format spec called its model of changes "as flat as Word's": every
change is a property of a run of text, and nothing nests deeper. These tests check that claim and
its edge cases: changes across many paragraphs, whether inline changes need a length limit, text
edited several times over, whether every edit can be replayed, comments on text that is later
deleted, and whether complex edits need a tag type of their own.

The examples below use the marker form of the time, without the author and time.

## Method

- A reference model built on Word's run model, at character level. Every character is plain,
  inserted, deleted, or inserted-then-deleted. A paragraph break is a character too, and comments
  are zero-width anchors. On top of it: a serializer and parser for the format, and accept and
  reject.
- An edit simulator that behaves like the editor in tracking mode. It has three authors and
  matches the Word behavior observed in the [Word tests](word.md):
  - typing inside someone's insertion splits it;
  - deleting part of it nests the deletion;
  - typing at a pending deletion goes before it.
- Property tests over seeded random edit scripts, with shrinking to minimal counterexamples:
  - P1: parse and serialize round-trip exactly.
  - P2: the edited view equals the raw edits applied untracked.
  - P3: the original view equals the starting text.
  - P4: accept and reject in any order give the same result.
  - P5: the file stays valid after any partial accept or reject.
  - P6: cmark-gfm renders the file exactly like its newest version.

The code and data are in the project's lab, outside this repository.

## Results

### The flat model holds

In the character model, accept and reject are order-independent by construction. Every failure
came from how the file encodes the model, never from the model itself, and Word behaves the same
way on all the inline cases. The work is in the encoding.

### What broke, ranked

1. Empty paragraphs.
   - Word has them; Markdown can't hold one.
   - The earlier spec allowed blank lines between a marker line and its block (its rule 1), and
     read a one-line deletion on its own line as belonging to the next block (its rule 2).
     Together these misread some states:
     - Enter at the start of a paragraph can't be written.
     - A paragraph whose text is all deleted is read back as a deletion at the start of the next
       one, and rejecting marks in different orders gives different documents (P4 fails).
   - Fix: the format has no empty blocks. A split that would leave an empty block isn't written
     until the block has content. Deleting all of a block's text deletes the block, together with
     one adjacent break.
2. A payload ending in `-` turns the comment into visible text in GitHub, VS Code and CommonMark
   0.30 renderers. About 11% of random deletions hit this.
   - Fix: a trailing `\` guard, verified in all four parsers. A later survey
     ([ecosystem.md](ecosystem.md)) replaced it with `\x2d`, because Python-Markdown shows the `\`
     as text. The [format spec](../format.md#25-payload-encoding) uses `\x2d`.
3. `<!--join-->` has no payload. Rejecting a join can't restore the second block's type: a heading
   comes back as a plain paragraph (867 of 1,000 scripts).
   - Fix: the join must record the second block's prefix (see
     [Paragraph breaks](#paragraph-breaks)).
4. A comment's `quote` depended on the order of decisions when it was captured at the moment the
   range emptied (772 of 1,000 scripts).
   - Fix: record the quote when the comment is created, as Google Docs does (0 of 1,000).
5. Text next to a marker changes parsing:
   - a backslash just before a marker;
   - 1–3 spaces before a marker at a line start (still an HTML block);
   - emphasis delimiters next to a marker;
   - a literal `<!--` in the text, which captures the next marker.

   These are now placement rules in the [format spec](../format.md#3-where-markers-go).

6. Substitutions nested inside insertions, which the earlier spec allowed, behave differently from
   Word after accept and reject.
   - Fix: split them the way Word does, into a deletion nested in the insertion plus a new
     insertion.

### Gaps in the earlier spec

Places where the model had to invent a rule:

- Multiple valid files for one state. An inserted paragraph can be written three ways, and a
  whole-block deletion two ways. The spec said the editor "prefers" one, which isn't
  deterministic.
- Merging repeated deletions. Three Backspaces give three deletion marks. The spec didn't say
  whether adjacent deletions by the same author merge. Word shows one.
- Typing at the edge of your own insertion extends it. The spec didn't say which side wins when two
  insertions touch.
- Comment range boundaries. The spec didn't say whether typing at the end of a range goes inside
  or outside it. The model chose inside at the end and outside at the start.
- A comment about a mark (key `on`, since renamed `about`) becomes a point comment "at that place"
  once the mark is decided, but the spec didn't say which place when the mark has three segments.
  The answer: a point marker right after the mark ([ids-and-ledger.md](ids-and-ledger.md)).
- There was no notation for a split that someone else joined.
- One worked example in the earlier spec restored "importersoon." because its last payload was
  missing the trailing space.

## Paragraph breaks

This is the central case. A deletion from the middle of paragraph 1 to the middle of paragraph 3,
across a heading, is common, and the earlier spec's rule that inline marks stay inside one block
left no complete encoding for it. Word stores it as deleted runs plus deleted paragraph marks, and
the merged paragraph keeps the first block's type.

Four encodings were property-tested over 1,000 scripts each. All share one model: a paragraph
break is a character carrying the next block's type.

| Encoding                                                                                           | Result                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) the earlier spec's `split`/`join` point marks                                                  | Fails: the join loses the second block's type (P1 fails 867/1000)                                                                                           |
| (a+) as (a), with the join recording the second block's prefix (`<!--join j7mm ## -->`)            | Passes everything                                                                                                                                           |
| (b1) break as text in the payload, using the earlier spec's blank-line escape (a line holding `\`) | Fails rendering (P6 950/1000): payload lines that start with `## `, `- ` or `> ` interrupt the paragraph. The [renderer tests](renderers.md) found the same |
| (b2) break as text in a one-line payload, written `\n`                                             | Passes everything. One mark per change: `First <!--del j7mm para\n\n## Second\n\nThird--> para`                                                             |

The same deletion under (a+) needs five segments in the merged paragraph:
`First <!--del j7mm para--><!--join j7mm--><!--del j7mm Second--><!--join j7mm ## --><!--del j7mm Third--> para`.

(a+) also passes every property test, but (b2) is the recommended encoding for deletions, with
`split` kept for inserted breaks, for three reasons:

1. It is one mark per change, like Word's single balloon.
2. It handles a code block or a multi-line list in the middle, which (a+) would also need a newline
   escape for.
3. The renderer tests verified the one-line form on GitHub and in every renderer.

In (b2), a join is a deletion of the break plus the second block's prefix
(`Para<!--del j7mm \n\n## -->Heading text`). The merged block keeps the first block's type, as in
Word. A `split` point marker at the end of the first block still marks an inserted break, because
inserted text has to be visible and can't sit in a payload. The
[format spec](../format.md#34-block-breaks-splits-and-joins) uses (b2).

## Length, complex edits and replay

- No length limit is needed. With one-line payloads, length doesn't affect rendering: a
  5,000-character payload rendered cleanly everywhere. Long payloads only hurt raw readability,
  and the editor can offer Simplify markup, as the spec says.
- Complex edits. The earlier spec's answer was a whole-block substitution that keeps the collapsed
  marks in `parts`. It is the right primitive, but `parts` wasn't specified well enough to undo
  the collapse or to replay it. That takes an ordered list of the collapsed marks, each with:
  - kind, author, time and note;
  - a patch relative to the region's old text (`pos`, removed text, inserted text), in the order
    applied.

  Applying the patches in order to the old payload then yields the new text, and un-collapsing is
  mechanical. This patch list was not prototyped. The [history prototype](history.md) later
  replaced it with a literal copy of the marked-up region, which holds the same information and
  expands back into marks directly.

- Replay (`history: full`) was not tested here. Reasoning from the model: events need a total
  order. Minute-precision times tie, and Word's own revision times also have minute precision. So
  replay needs a per-document sequence number, with offsets defined on the raw body text (markers
  included, ledger excluded). Untracked edits by the owner must be events too. Each event becomes
  an invertible patch on the body text, which makes replay exact. The
  [history prototype](history.md) later confirmed the invertible patches and the events for
  untracked edits, but replaced the sequence number with a graph of saves, because a
  document-wide counter collides on every branch.

## Fixtures

[`fixtures/edit-model.json`](fixtures/edit-model.json) holds 29 fixtures (input, operations,
expected output):

- 16 for single paragraphs: worked cases from the earlier spec (the notes call them
  "spec case N"), the five Word behaviors, own-insertion rules, the `-` guard, the leading-space
  rule, and repeated Backspace;
- 9 for paragraph breaks, in encodings (a+) and (b2);
- 4 for comments, including the quote-order pair.

Fixtures marked INVENTED or PROPOSED encode a choice the spec of the time didn't make. The fixtures
predate the current marker layout: they record authors in the ledger (`{by: …}` entries), not in
the markers.
