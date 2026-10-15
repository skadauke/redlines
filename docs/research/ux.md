# Review workflows in Word and Google Docs

Status: research notes, October 2026. How Word and Google Docs handle suggesting, markup views,
cards, moving through changes, bulk decisions, comments and AI edits, and what follows for Redlines.

Redlines follows the review model that Word and Google Docs share, and it exchanges files with
both. This page records how each of them handles review and where each falls short. The design
that follows from it is in [design.md](../design.md).

## Method

- Sources: help pages, changelogs, release notes and forum threads, read in October 2026.
- Most findings come from documentation, not from using the apps. Hands-on tests are in other
  notes: Word for Mac in [word.md](word.md), Google Docs tables in Suggesting mode in
  [tables.md](tables.md), and Google Docs' Markdown mode in [ecosystem.md](ecosystem.md#google-docs).
- What users say is thin, because the search budget ran out midway.
- The source of every claim is in the project's lab, outside this repository. Claims that rest on
  one source or a third-party guide are marked there.

## Modes and tracking

- Word and Google Docs have converged on one model: a mode menu with Editing, Suggesting and
  Viewing. These are Google Docs' names; Word 365 calls the middle one Reviewing.
- Word also has Track Changes in the Review menu (⌘⇧E on the Mac). It can track everyone's edits
  ("For Everyone") or only your own ("Just Mine").
- Word's mode switcher turns tracking off silently, which users complain about.
- Google Docs leaves it to people to remember to switch to Suggesting, and it can't lock editors
  into suggesting.

## Markup views and change bars

- Word shows changes in four views: All Markup, Simple Markup, No Markup and Original.
- Word defaults to Simple Markup, which hides how much has changed.
- Clicking a change bar in Word switches between All Markup and Simple Markup.
- Google Docs shows suggestions in one color per author. In a table test, a replacement showed the
  new text underlined and the old text struck through, a deleted column stayed in place struck
  through, and new empty cells showed nothing, where Word tints them ([tables.md](tables.md)).

## Cards

- Word's cards cover the text. Hovering Accept or Reject previews the result.
- Google Docs lists every suggestion as its own card in the comments panel, with ✓ and ✗ on hover.
  Users find one card per suggestion cluttered.
- In Google Docs, an operation on a block of table cells is one card, accepted or rejected
  together ([tables.md](tables.md)).

## Moving through changes

- Word has "Accept and Move to Next."
- Google Docs has no keys to accept or reject. Its comment rail has the keys J, K, R and E.

## Bulk decisions

- Word can accept or reject one person's changes, behind a filter that resets when the file
  reopens.
- Google Docs can't accept or reject by person.

## Comments

- Google Docs' comment rail has a "For you" filter, other filters, and search.
- In Word a comment is a private draft until it is posted with ⌘↩, and only one unposted comment
  can be open at a time.
- Word marks the active thread: clicking a card or its anchor highlights the card and darkens the
  anchor's tint, with no connector lines.
- Word's Reviewing Pane lists every change.
- Google Docs moves decided suggestions to a Resolved section that records "Suggestion accepted"
  or "Suggestion rejected," who decided and when ([tables.md](tables.md)).
- How Word stores threads, replies and likes, and what it does with a comment whose text is
  deleted, is in [word.md](word.md).

## Presence and compare

- Neither Word nor Google Docs shows which thread or change someone is looking at.
- Word's and Google Docs' compare credit every difference to one name.

## AI edits

- In 2026 both turned AI edits into reviewable changes. Word's Copilot writes tracked changes, and
  Gemini's edits in Google Docs are suggestions.
- Their defaults differ. Word shows AI changes to everyone; Gemini keeps them private to the person
  who asked until that person approves them.
- Word's Legal Agent offers "Apply edit with comment," so an edit can carry its reason (one
  source).
- Gemini in Google Docs drafts comment replies for a person to post under their own name, so AI
  text appears under a person's name.
- Neither shows the agent as a named author, with its own cursor and a "drafting…" state in a
  thread.

## Markdown and file exchange

- Since October 2026 Google Docs opens and edits `.md` files natively, and since September 2026
  its API lets apps write suggestions and comments.
- In Google Docs' Markdown mode, Redlines markers show as raw code. Converting a Redlines file into
  a Google Doc drops them all, which silently accepts every change
  ([ecosystem.md](ecosystem.md#google-docs)).
- Word files with tracked changes open in Google Docs as suggestions, so Redlines' Word export
  reaches Google Docs users with no integration.

## What follows for Redlines

These choices in the design follow from the findings above:

- All Markup is the default, not Simple Markup, and clicking the change bar switches views.
- Cards never cover the changed text and can be turned off. Hovering Accept or Reject previews the
  result.
- The mode menu that Word and Google Docs share (Editing, Suggesting, Viewing) comes with Word's
  Track Changes toggle, and the mode never changes silently. Where a host enforces roles,
  non-owners are locked in Suggesting. Agents follow their person's mode, or a level set for them:
  Ask, Suggest or Auto.
- A review bar shows "Change 3 of 17," filter chips by person, agent and kind, and Accept and
  Reject buttons that move on, with single-key triage (J, K, A, X, R, E, U).
- Bulk decisions work by person, selection, section or agent run. Each is confirmed with counts and
  undone in one step.
- The comment rail has Google Docs' filters and Word's active-thread highlight. Changes appear on
  the rail only once someone replies to them; the rest stay inline.
- Agents reply in threads as themselves, show "drafting…" with a Stop button, and their cursor
  moves while they work. Each agent edit can carry its reason in the mark's `note`.
- An automatic conversion can be undone in one step, as with Word's AutoCorrect button.
- Git gives compare with real authors, catch-up since your last look, named versions as tags, and
  restores that are themselves tracked.

## What goes in the file

- With `tracking: everyone` in the ledger, everyone who opens the file in Redlines starts in
  Suggesting, like Word's "For Everyone" ([format.md](../format.md#5-the-ledger)). The value is a
  word, not `on`, because PyYAML reads `on` as `True` (checked). This is the same YAML 1.1 rule
  that turns a key named `on:` into `true` ([ids-and-ledger.md](ids-and-ledger.md)). The file has
  no list of owners, because permissions belong to hosts.
- Nothing is written by default. Opening and saving an untouched file leaves it byte for byte the
  same, and the ledger exists only while it holds something.
- Agent runs reuse the mark field `group`.
- View mode, filters, comment drafts, folds, the last commit each person viewed, reviewed sections
  and presence stay with each person, outside the file.

## Still to check

- Redlines' review shortcuts against Word's full list, and Ctrl+Alt shortcuts on European
  keyboards, where Ctrl+Alt acts as AltGr.
- 2026 claims that rest on one source.
