# Full history (`history: full`)

Status: research notes, October 2026. A prototype of the optional mode in which a file keeps every
earlier version of itself, tested for replay, size and git merges.

The prototype was built with authors and times in the markers, a layout in which the ledger
holds no record of pending marks ([ids-and-ledger.md](ids-and-ledger.md)). It tests whether a file
can replay every earlier version without copying what the markers already hold, and record that
history without adding merge conflicts. The format has since moved authors and times into the
ledger, so a decision also stores the mark's ledger entry
([format §6.2](../format.md#62-save-blocks)); the prototype hasn't been rerun with that change. It also shows
what a file with full history looks like. The [edit-model tests](edit-model.md) did not cover
full history.

The prototype covers:

- a 53-event contract negotiation, written out in four candidate layouts;
- a long contract: 3,804 events and 1,994 marks over 50 saves;
- 410 real `git merge` trials with two and three branches.

Every earlier version was rebuilt from the final file alone and compared byte for byte with the
file the editor had actually written at that step.

The code and data are in the project's lab, outside this repository.

## Summary

- In the default mode (`history: current`), git is the history. While a change is pending, its
  marker carries the author and time. Once it is accepted or rejected, it leaves the file and git
  keeps the record. Word behaves the same way.
- In full mode, the file keeps its own history, so it can step back to any version without git.
  - Accepting or rejecting a mark moves its marker, word for word, into the history. Pending marks
    are their own record, so nothing current is copied.
  - The one deliberate repetition: each mark's creation line repeats its author and time, about 23
    bytes per mark, so that replay can check the marker. A hand-edited author is caught ("marker
    of pp5q says bob…, the history says ada…").
- The history lives in one HTML comment block per save, between the body and the ledger, not in
  the YAML.
  - Blocks are sorted by a random session id and never changed after the save.
  - Every line starts with that id, so git can't line up two blocks on a shared line.
- Merge conflicts from the history:

  | Merge path            | Conflicts from the history                                           | Result                                                           |
  | --------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
  | GitHub's merge button | 72 of 410 parallel merges (18%); 21% at 4 saves, 15% at 20, 3% at 50 | Keeping both sides was correct every time (72 of 72)             |
  | Redlines merge driver | 0 in 410                                                             | Every version replayed                                           |
  | Clean plain-git merge | none                                                                 | Every version of every branch replayed with no tool (147 of 147) |

## What it looks like

The end of the negotiation file, before the ledger. Each block is one save; each line is one
event, and stores exactly what is needed to undo it:

```markdown
<!-- redlines-history xz89 after:xgns from:bcp94ft4 to:k6sq7x62
xz89.1 ada 2026-10-14T08:15Z accept cd9x | @646:<!-\-sub cd9x bo 2026-10-13T14:02Z 30-\-> | @648:<!-\-/cd9x-\->
xz89.4 ada 2026-10-14T08:16Z edit | @140+7:Ltd.
xz89.6 ada 2026-10-14T08:20Z new pp5q | @1689+73
xz89.8 ada 2026-10-14T08:21Z reject zfk3 | @1348+161:<!-\-del zfk3 bo 2026-10-13T14:12Z  This obligation survives …-\->
end xz89 -->
```

The header: `xz89` is the save's random id. `after:` names the save it started from, or several
after a merge, so the history is a graph, not a numbered list; a document-wide counter would
collide on every branch, as serial ids do. `from:` and `to:` are hashes of the document before and
after the save.

The lines:

- `xz89.1`: Ada accepted Bo's substitution. The line keeps the marker it removed, author and time
  included.
- `xz89.4`: Ada's own untracked edit. It stores the 7 characters she inserted at position 140 and
  the text "Ltd." they replaced.
- `xz89.6`: a new mark, stored by length only, because its text is still in the body.
- `xz89.8`: a rejected deletion that crossed a heading. Its marker, with the `\n` breaks, is kept
  exactly, so the deleted heading comes back byte for byte when you step back.

The events:

| Event                                       | Meaning                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `new`, `revise`                             | Marks created, or the author changing their own pending mark                                                                 |
| `accept`, `reject`                          | Decisions, including groups and both halves of a move                                                                        |
| `edit`                                      | An untracked change: the owner's direct edit, or an edit made outside Redlines tools                                         |
| `collapse`                                  | Simplify markup into one substitution. Its stored text is the substitution's `parts`, a literal copy of the marked-up region |
| `cmt`, `reply`, `like`, `resolve`, `person` | Threads and people                                                                                                           |
| `merge`, `checkpoint`                       | Kinds of save, written by the merge driver or the editor                                                                     |

Times are UTC to the minute, as in markers. Order comes from the line order and `after:`, never
from times.

## Replay results

| Test                                                  | Versions checked                    | Result                                                                                                                                                                           |
| ----------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Negotiation, 7 saves, 53 events, four layouts         | 54 per layout, backward and forward | All identical; all hash checks passed                                                                                                                                            |
| 200 random review histories                           | 16,859 per layout                   | All identical                                                                                                                                                                    |
| Long contract, 50 saves, 3,804 events                 | 77 samples per layout, every hash   | All identical                                                                                                                                                                    |
| 410 git merge trials                                  | 54,324 versions on branches         | See [Merges](#merges)                                                                                                                                                            |
| Editing after a merge (plain git, driver, checkpoint) | 643, 1,662 and 30                   | All identical                                                                                                                                                                    |
| Tampering                                             | 8 kinds                             | 7 caught: hand-edited authors, outside edits, changed history text, deleted or swapped events, a removed middle block. Removing the oldest block is allowed (that is compaction) |

The negotiation covers:

- insertions, deletions, substitutions, and typing inside someone else's insertion;
- a deletion across a paragraph, a heading and part of the next paragraph, later rejected with the
  exact bytes back;
- a split and join, a table row inserted and another deleted, a format change, a heading-level
  change and a move;
- an agent's grouped suggestion with a note;
- threads with replies, likes, resolve and reopen;
- a comment on text that was deleted, which became a point comment;
- mixed decisions, untracked edits by the owner, and a pending Simplify-markup collapse.

Not caught: a forger who rewrites the marker, the event and every hash consistently. The hashes
have no key, so evidence would need signed commits or signatures.

## Layouts compared

| Layout                                               | Survives merges                                                                               | Readability                                                                                                    | Verdict         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------- |
| A. One numbered `log:` list in the ledger            | **0 of 410**: every parallel merge conflicts or breaks replay                                 | Fine                                                                                                           | Rejected        |
| B. One entry per save, inside the ledger YAML        | Mostly, but keeping both sides broke the YAML in 11 of 263 conflicted merges (duplicate keys) | Fine                                                                                                           | Rejected        |
| C. "Ghost" comments in the body, one per change      | Like D                                                                                        | In editors that show HTML comments as text, comment text in 400 of 401 paragraphs; rendering broke in 3 places | Rejected        |
| **D. One comment block per save, before the ledger** | Keeping both sides was always right; 2 failures in 263, both the ledger's own                 | Body unchanged; the history sits after it                                                                      | **Recommended** |

## Size and speed

Measured on the long contract, whose body is 247 KB.

| Measure                    | No history | With layout D                                                            |
| -------------------------- | ---------- | ------------------------------------------------------------------------ |
| File size                  | 375 KB     | 646 KB (+72%; about 71 bytes per event; 78 KB gzipped, as git stores it) |
| Opening the current state  | 6.8 ms     | 7.3 ms (the ledger can be read without touching the history)             |
| Stepping back one save     | —          | 43 ms (Python prototype)                                                 |
| Stepping back to the start | —          | 1.3 s (Python prototype)                                                 |

- The history is made of:
  - event headers, 56%;
  - removed text, 24%;
  - positions, 13%.
- Compaction keeps the size in check. `redlines compact --keep N` drops the oldest save blocks.
  Because the kept blocks don't change, it merges cleanly with concurrent work.
  - Keeping 40 saves: 591 KB. Keeping 10: 430 KB.
  - `--all` returns to `history: current`, with the `parts` it needs.

## Merges

A single linear list of positions can't survive a merge. Positions refer to each branch's own
text, and replaying a merged history as one list was right in 0 of 410 trials. The reader
therefore replays the graph of saves:

- It gives every character that ever existed its own identity and follows it through both
  branches.
- At a merge, a character survives unless some branch deleted it.
- Every version is checked against the stored hashes.
- A clean git merge needs no tool. The next save names both parents in `after:`.

| What happened                        | What fixes it                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Clean merge on GitHub                | Nothing; every version replays                                                                                                |
| Conflict only between history blocks | Keep both sides in GitHub's conflict editor; always right (72 of 72)                                                          |
| Conflict in the prose                | `redlines repair` (with git) records the person's resolution as a `merge` save; without git, the editor writes a `checkpoint` |
| Merge with the Redlines merge driver | No history conflicts; the driver writes a `merge` save (410 of 410 merges, 54,324 of 54,324 versions)                         |

### A finding about the ledger

Keeping both sides of a conflict between comment threads silently filed a reply under the wrong
thread in 22 of 410 trials, with or without history.

- The cause: a reply added to one thread and a new thread added after it land at the same spot.
- The fix: put each thread's growing lists before its text
  (`by, at, about, resolved, likes, replies, quote, text`). Wrong results fell from 12 to 0 in 200
  trials.
- The history detects the problem, and `redlines repair` rebuilds the threads.

## In the format spec

The [format spec's history section](../format.md#6-history) is based on this prototype:

- layout D, one comment block per save before the ledger;
- undo-only events;
- per-save hashes instead of one checksum;
- `parts` as a literal copy of the marked-up region;
- merges replayed when the file is read;
- the merge driver, `redlines repair`, checkpoints and compaction;
- positions counted in Unicode code points, as in the prototype, because every language can count
  them. CodeMirror counts UTF-16 units, so the editor converts at its boundary.

Related rules for legal use and storage:

- Legal evidence comes from signed git commits; the file carries no signatures of its own.
- Edits to comments aren't recorded in the history, even for legal use.
- There are no sidecar files: the history stays in the file. Editors that show HTML comments as
  text show it after the body, 8,399 lines in the long contract.

## Open questions

1. What the hashes cover: they should cover a canonical form of the ledger, so that changing its
   layout (such as the thread order above) doesn't break old hashes.
2. Shorter times (`08:15` when the date matches the save's) would save about 15%, at some cost in
   readability.
3. Edits by two owners at the same spot on two branches: the driver keeps both in a fixed order.
   Whether that should be a real conflict instead is open.
4. Not yet prototyped:
   - changes to front matter;
   - importing from Word, which doesn't record the order of its changes;
   - live sessions with several authors.

The prototype assumed the trailing-hyphen guard `\`, which the [ecosystem survey](ecosystem.md)
replaced with `\x2d`. The history stores markers verbatim, so nothing else changes.
