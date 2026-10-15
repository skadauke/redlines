# Live collaboration and saving

Status: research notes, October 2026. Simulations of live collaboration with tracked changes, and
how a live session saves its work and merges copies that diverged.

Live collaboration in Redlines uses `@codemirror/collab`, with a central authority that orders
every change. An earlier version of the design tracked changes on the client before sending them,
so that the authority synced plain text and collab rebased the tracked changes like any other
text. These notes test that design in simulation and derive the rules that replace it. The first
simulation covered insertions and deletions; a
[second](#a-second-simulation-every-kind-of-change) covered every other kind of change, and a
[third](#a-third-simulation-inserted-table-rows) inserted table rows.

The code and data are in the project's lab, outside this repository. Running `npm run reproduce`
there reruns each simulation.

## Method

- Simulation: a seeded network simulation with an authority and three clients: ada the owner, bo
  and cy as reviewers. 20 edits each, latency 5–225 ms with spikes, and some clients offline for
  2–8 s.
- Real code: clients use the real `@codemirror/collab` (`collab()`, `receiveUpdates`,
  `sendableUpdates`, `rebaseUpdates`), the real CodeMirror history, and a tracking transaction
  filter that writes marks as the format specified at the time.
- Workloads:
  - hot: everyone in one paragraph
  - spread: anywhere
  - typical: 80% of each person's edits in their own paragraph
- Checks after every run:
  - every copy has identical text
  - markers are well formed, with no marker inside a payload
  - ids and ledger entries match, and the ledger is valid, sorted YAML
  - an oracle confirms that no one's text was lost, swallowed, duplicated, left untracked,
    resurrected or misattributed
- Scale: 500 sessions per row unless noted.

## Results

### Rebasing tracked changes corrupts the markup

| Strategy                                                                                                      | Typical: sessions corrupted | Hot: sessions corrupted | Push rejections (typical) |
| ------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------- | ------------------------- |
| (a) the earlier design: collab rebases the tracked changes, and a deletion wraps the deleted text in a marker | **57%**                     | **94%**                 | 0%                        |
| (b) as (a), but a deletion replaces the range                                                                 | **70%**                     | **95%**                 | 0%                        |
| (c1) clients keep their raw edits and re-derive the tracked form; authority rejects stale pushes              | **0%**                      | **0%**                  | 23%                       |
| (c2) as c1, but the authority rebases unless a newer edit touched the push's footprint                        | **0%**                      | **0%**                  | 7%                        |
| c-naive: re-derive on the client while the authority still rebases                                            | 39%                         | 92%                     | 0%                        |

Typical failures under (a) and (b):

- Concurrent typing inside a range being deleted. Bo types inside a range Ada is deleting, and the
  rebase puts Bo's insertion inside Ada's deletion payload:
  `<!--del nqs1 O4 <!--ins 03os-->B1 <!--/03os-->O5 O6 -->`. The comment closes early, and Bo's
  word becomes untracked.
- Overlapping deletions keep both copies of the shared words. Rejecting both then gives
  `O4 O5 O5 O6`.
- The owner accepts while a reviewer extends the same insertion. The extension becomes untracked
  text that the owner never saw.

The fix is to re-derive. Each client keeps its pending edits as raw intents (such as "delete
these words" or "type this"). When a push is rejected, or a remote change touches a pending edit,
the client re-runs the tracking filter against the newest confirmed text. The authority still
needs no knowledge of marks: it only orders updates and compares ranges.

### Other findings

| Finding                                                                                                                                                                                                                                                                                                                                                                                                                       | Evidence                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `@codemirror/collab` itself can diverge. If the authority rebases a late push over several logged updates at once, and a client receives them one at a time, client and authority end with different text. The client believes its edit was confirmed. Fix: rebase and receive one update at a time on both sides (0 divergence in 3,000 sessions)                                                                            | Minimal repro without any Redlines code, to report upstream |
| Undo must be semantic. CodeMirror's history undo applies an inverse text change. After someone split your insertion it leaves orphaned markers, and it can resurrect text whose deletion the owner accepted. It was the most damaging single operation: 57 problem updates per 1,000 undos. "Undo" should mean "reject my own last mark, by id"                                                                               | Undo-heavy workload                                         |
| Accept and reject need a guard. If the mark changed between the click and the confirmation, drop the command and ask again. Without the guard, 35% of hot sessions lost or wrongly accepted text; with it, 0%. 2.5–3% of review clicks were dropped in the typical workload                                                                                                                                                   | Review-guard runs                                           |
| Serial ids collide live. 14% (typical) to 30% (hot) of new serial ids were already taken by another client. Renumbering during rebase was itself unreliable: in the hot workload, 986 of 2,525 renames introduced a new problem. Random ids: 0 collisions in 33,000 marks                                                                                                                                                     | Id runs                                                     |
| Yjs is not a fallback. A CRDT merges characters with no point at which marks can be re-derived. 40–46% of live typical sessions corrupted with Yjs's undo manager, 98–100% after offline periods. Yjs could only work if marks became structured attributes instead of text, which a text-based format rules out                                                                                                              | Yjs runs                                                    |
| External changes need a markup-aware merge. For an offline copy, a Dropbox conflict, `git pull`, or an agent writing the file: `git merge-file` needed manual resolution in 93% of realistic cases, and a character-level three-way merge produced invalid markup in 0.6–2%. Replaying the other side's marks through the tracking filter merged 100% cleanly in the simulation (an upper bound: simulated words were unique) | 500-case merge runs                                         |
| Restarting the authority from a text snapshot alone loses confirmed edits or diverges. A write-ahead log of accepted updates fixes it                                                                                                                                                                                                                                                                                         | Restart repro                                               |

## A second simulation: every kind of change

The second simulation rebuilt the harness for every kind of change, in the format with authors and
times in the markers, and checked every state the authority confirmed, not only the saved file.

Method:

- A model-based tracking filter. Each operation parses the text into atoms (characters, breaks,
  block prefixes, point comments, table cells) that carry their marks, edits that model, and
  writes the text back canonically. The tracked change is the difference.
- The format tested: author and time in the marker, vowel-free random ids, one-line payloads,
  `split` markers, joins as deletions of the break, table deletions after a blank line, and the
  matching ledger layout ([ids-and-ledger.md](ids-and-ledger.md)). The format has since moved
  authors and times into the ledger, which these simulations haven't been rerun with
  ([format §13](../format.md#13-open-questions)).
- 23 kinds of operation:
  - typing, deleting and substituting, also across someone's insertion;
  - bold, heading level and highlight;
  - range and point comments, replies, likes, resolve and reopen, and comment edits by their
    author;
  - Enter, Backspace joins, new and deleted paragraphs, and deletions across blocks;
  - cell edits, row insertions and row deletions;
  - accept, reject and undo.

  Moves weren't modeled.

- Checks on every confirmed state: marker syntax and placement, payload encoding, the ledger
  (YAML, threads, document order), rendering in markdown-it and micromark against the model's
  accepted text, and the first simulation's oracle, extended to formatting, comment anchors and
  threads.
- Scale: about 39,000 seeded sessions:
  - four workloads (hot, typical, spread, and review, where the owner decides while others edit),
    500 sessions per strategy;
  - each kind of change on its own, 200 sessions per strategy;
  - footprint ablations.

  The whole matrix reruns in about 15 minutes on 16 cores.

Results. In each cell, the first number is the share of sessions corrupted at the end; the second,
the share in which invalid markup was confirmed at any point.

| Workload | (a)           | (b)           | (c1)        | (c2)        | Pushes rejected, c1 / c2 |
| -------- | ------------- | ------------- | ----------- | ----------- | ------------------------ |
| hot      | 72.2% / 89.8% | 81.8% / 93.6% | 0.0% / 0.2% | 0.4% / 0.8% | 35.4% / 15.0%            |
| typical  | 15.0% / 26.2% | 20.6% / 31.4% | 0.4% / 0.6% | 0.4% / 0.8% | 21.6% / 2.4%             |
| spread   | 67.0% / 84.2% | 75.4% / 87.8% | 0.2% / 0.6% | 0.2% / 0.4% | 36.9% / 9.2%             |
| review   | 71.4% / 87.4% | 84.0% / 92.2% | 0.0% / 0.4% | 0.0% / 0.6% | 36.8% / 10.5%            |

- Re-deriving holds for every kind of change. One kind at a time, c1 and c2 stay at 0–2%. (a) and
  (b) corrupt 34–100% of sessions for every kind except row insertions (1–3%).
- What remains comes from the format, not from concurrency. The few failures under c1 and c2, at
  most 1 in 500 sessions per workload, also happen under c1, which never rebases. They come from
  gaps in the format (below), which the [format spec](../format.md) now closes.
- c2's footprints need a read set. When a push declared only the ranges it changes, c2 confirmed
  invalid markup in 8.5% of hot sessions, and in 43.5% of sessions that toggled bold. A footprint
  must also declare what its result depends on ([Footprints](#footprints)).
- Two read-set rules proved necessary when removed one at a time: the nearest visible character on
  each side of every marker position, and the whole table (or a lock on its structure) for row
  operations. The other rules made no measurable difference once these were in place. They are
  kept as cheap safety.
- Checking only the saved file undercounts. Writing the text back canonically repairs broken
  markup on the next edit. With write-only footprints, 97% of hot sessions ended clean, yet about
  8% had confirmed invalid markup along the way, which other people saw and acted on.
- The review guard is essential. Without it, 15–17% of review sessions lost text or left it
  untracked; with it, none did. It turned away 1.4–9% of accept, reject and undo commands, because
  someone had changed the mark first.
- c2 compared with c1: the same safety, but c2 rejected 2.4–15% of pushes where c1 rejected
  21.6–37%, and confirmed edits faster (hot workload, median 247 ms against 329 ms). Both turn
  away 0.4–4% of commands while re-deriving, and the editor must explain why (for example
  "nothing left to delete" or "the word you typed next to was removed").
- The second simulation fixed two bugs in the first one's harness: only a push's first update
  carried its footprint, and positions mapped through changes to marked-up text could land inside
  words. Both now shape the rules below.

Gaps in the format that the second simulation found, each with a minimal reproduction:

| Gap               | What goes wrong                                                                                                             | Where the format spec covers it                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Escaping          | `{%`, and a backslash before a backtick or a line break, didn't round-trip                                                  | [Payload encoding](../format.md#25-payload-encoding)                                             |
| Implied breaks    | A block whose remaining text is all one person's insertion reads like a whole-block insertion                               | [Block breaks](../format.md#34-block-breaks-splits-and-joins): every inserted break is a `split` |
| Joins             | A join at the start of a block looks like a whole-block deletion                                                            | [Block breaks](../format.md#34-block-breaks-splits-and-joins)                                    |
| Split deletions   | A whole-block deletion split around another marker doesn't show where the block starts                                      | [Block breaks](../format.md#34-block-breaks-splits-and-joins)                                    |
| Tables            | A deleted block or split right after a table has no place to go; a row insertion loses its signature once others type in it | [Tables](../format.md#37-tables): a marker in the inserted row's first cell (third simulation)   |
| Bold              | Deleted text inside a bold range can't say "not bold"; stripping markers turns two bold runs into `****`                    | [Format changes](../format.md#26-format-changes)                                                 |
| Deleted blocks    | Rejecting a deletion inside a block someone deleted whole needs the block back                                              | [Block breaks](../format.md#34-block-breaks-splits-and-joins)                                    |
| Empty blocks      | A block can be left with no visible text, which the rule against empty blocks can't remove                                  | [Block breaks](../format.md#34-block-breaks-splits-and-joins), with a rule chosen by default     |
| Undefined forms   | Comments across blocks, substitution segments, leading spaces, joins across pending block formats                           | [Where markers go](../format.md#3-where-markers-go), [Comments](../format.md#4-comments)         |
| Resolve and reply | "A reply later than `resolved` reopens" is ambiguous within one minute                                                      | [Comments](../format.md#4-comments): resolved is a state                                         |

Limits:

- The tracking filter, serializer and parser are the harness's own. The results describe them plus
  the format with these fixes, not a real editor.
- Where the format had gaps, the harness chose rules; another choice could behave differently.
- Unique word tokens, no punctuation, three clients with about 25 operations each.
- Bold is the only inline format, and headings only go to level 3. There is one two-column table,
  with no column operations.
- No lists, quotes, code, links, images, footnotes or front matter; no mentions, assignments or
  moves.
- A 0% from 200 sessions means only that the rate is likely below about 1.5%.

## A third simulation: inserted table rows

The second simulation found that the format recognized an inserted row only by its signature, an
insertion in every cell, which breaks once someone else types in the row. The third compared
three forms on identical seeds, and added two row checks to the oracle (the second simulation's
oracle had none, so it never saw lost rows):

| 500 sessions per cell                               | Signature (earlier form) | Marker below the table (`row=N`) | Marker in the row's first cell |
| --------------------------------------------------- | ------------------------ | -------------------------------- | ------------------------------ |
| Mixed table work, c1 / c2: sessions with rows lost  | 9.2% / 9.2%              | 0% / 0%                          | 0% / 0%                        |
| Row insertions under OT (a / b): sessions corrupted | 20.0% / 22.4%            | 100% / 100%                      | 22.4% / 21.4%                  |
| 400 git merges: clean                               | 24%                      | 15%                              | 24%                            |
| Clean but wrong                                     | 15 of 93                 | 21 of 59 (all invalid markup)    | 15 of 93                       |
| Main workloads (regression)                         | unchanged                | unchanged                        | unchanged                      |

- The in-row marker fixes the live failures, as the below-table marker does, and survives text
  merges as well as the signature, because it travels with its row.
- The 15 bad clean merges in the signature and in-row columns are stale deletion positions: a
  reject would restore a row in the wrong place, but no text is lost. The merge driver recomputes
  them.
- Footprints: a row operation now declares its row plus the deletion block, or the point where
  the block would go. That rejected 26.7% of pushes in mixed table work, against 32.5% for the
  whole table.
- Rendering: the marker is invisible in all 11 renderer setups, GitHub included, in first cells,
  empty cells, header cells, lists, quotes, and before bold, code, links and `www.` autolinks. The
  space after the marker is needed for `www.` autolinks. Long marked rows make pandoc's `markdown`
  reader use relative column widths.
- More commands are turned away in mixed table work (12.5%, against 5.4%), mostly by the new rule
  that drops a row deletion if someone changed the row since. The editor must explain these.
- Not run: columns, moves and header changes (specified in the
  [format spec](../format.md#37-tables)), and the in-row marker in Word and in other Markdown
  editors.

## One app as the authority

One desktop app can act as the authority, with the other apps as its clients; that is collab's
own model. The authority is small: a log, the current text, and three message types (pull, push,
get document). It can run in the host app's main process, with the host's own editor connected
like any other client.

Networking, simplest first:

1. On a LAN: a WebSocket server in the host, found with Bonjour, plus manual address entry. On
   macOS 15+, joining apps need the Local Network permission.
2. Over the internet: a relay that both apps connect to outbound, which needs no knowledge of the
   document. A tunnel (Cloudflare, ngrok) or a mesh VPN (Tailscale) also works.
3. WebRTC still needs signaling and TURN servers. It's optional, not a first step.

Fairness costs something. With a 200 ms internet guest, c2 rejected 11% of the guest's pushes in
the typical workload (95% of edits confirmed within 0.8 s); c1 rejected 37%. The guest's own
typing always shows instantly.

## Saving, and merging copies that diverged

A live session has no separate in-memory models to merge at intervals: collab merges
continuously, within one round trip. Saving works like this:

- The authority is the only writer of the file and of git.
- It appends every accepted update to a write-ahead log, and writes the file atomically about
  2 seconds after editing pauses.
- Save is a git commit of that text, with co-author trailers.

Copies that diverge, and need a merge, only arise without a live session:

| Situation                                                             | How it merges                                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A client was offline, but the authority kept its log                  | Its stale push is re-derived (c1/c2); nothing special                                                                                                                                      |
| Offline past the log, or the authority lost it                        | Markup-aware three-way replay, using the client's last confirmed text as the base                                                                                                          |
| Two people edit the same file in Dropbox or OneDrive, with no session | The app spots the conflicted copy and runs the same markup-aware merge                                                                                                                     |
| Git branches                                                          | git, line by line. Conflicts were common with the earlier ledger layout ([ids-and-ledger.md](ids-and-ledger.md)); the merge driver (`redlines merge-driver`) runs wherever it is installed |
| An agent edits the file while a session is open                       | The authority's file watcher merges it in as one update. Better: agents join the session as clients                                                                                        |

## Rules for live collaboration

These rules follow from the simulations. [design.md](../design.md) summarizes them.

1. The authority orders, persists and broadcasts. It never transforms tracked changes. It appends
   a push based on the current version. It rebases a stale push one logged update at a time, and
   only if the push's declared footprint touches no update accepted since its base; otherwise it
   rejects it. The footprint travels with every update of the push, not only the first
   ([Footprints](#footprints)). Clients apply received updates one at a time.
2. Clients keep intents. Each pending edit stores:
   - the raw edit;
   - its tracked form;
   - its new mark ids and time;
   - its footprint: everything it changed or depended on (the whole deleted range, any mark it
     extended or split, the ledger insertion point).

   On rejection, or when a remote update touches a footprint, the client re-derives that edit and
   all later ones against the newest confirmed text. It does so as soon as a received batch
   touches a pending edit, even while a push is in flight. Intents are anchored to visible words
   ("type this before that word"), not to positions mapped through changes to marked-up text, and
   toggles carry their target state ("make bold" rather than "toggle bold").

3. The tracking filter's output is valid markup for the exact text it was computed against, and
   deterministic. It never runs on remote transactions or on history undo and redo.
4. Accept, reject and undo are commands by mark id, not inverse edits.
   - Accept and reject carry the mark as the reviewer saw it, and are dropped if the mark has
     changed since. For a row insertion, what the reviewer saw is the whole row; for a deletion
     in segments, everything from its first to its last segment. Expect 1.4–9% of review
     commands to be turned away, with a message.
   - Undo of a tracked change rejects your own most recent mark.
5. Ids are random. A pending mark's id may change during re-derivation; once confirmed, it never
   changes.
6. Awareness (presence, cursors, selected change, view mode, "drafting…") is a separate,
   never-persisted channel. Anything reviewed, attributed or saved goes through the log.
7. Persistence:
   - write-ahead log plus snapshot;
   - crash recovery replays the log;
   - clients persist their own pending intents, because collab keeps them only in memory;
   - autosave is snapshot plus log; Save is a commit.
8. External changes (git pull, synced folders, agents, other editors) are detected by hash and
   merged markup-aware. Untracked edits become tracked changes by the commit author, the agent or
   `unknown`. Anything that can't be anchored goes to the owner as a conflict, never as a raw text
   merge.
9. No Yjs fallback.
10. Validate every confirmed state, not only the saved file. Writing the text back repairs broken
    markup, which hides what other people saw in between.
11. Use c2, rebasing unless footprints touch. It is as safe as c1 and rejects far fewer pushes.

### Footprints

A pushed edit declares a footprint: the ranges it changes (its write set) and everything its
result depends on (its read set), as ranges in the text it was computed on. The authority attaches
the footprint to every update of the push, mapped to where that update applies. A stale push is
rebased one logged update at a time, and rejected if its footprint touches the footprint of any
update logged since its base. Touching ends count.

| Edit                                               | Declares, besides the ranges it changes                                                                                                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anything that places, moves or removes a marker    | The markers around that position, and the nearest visible character on each side within the block; if there is none on a side, the block's start or end region                                            |
| Typing                                             | The whole insertion it extends or splits, and every comment, highlight or format change the new text joins                                                                                                |
| Deleting or substituting, within or across blocks  | Both ends, and the whole of every mark with a marker in or touching the range, except other deletions. When a block empties, the block and both breaks next to it                                         |
| Format change                                      | Its whole range and both ends. A block-format change: the whole block, its own-line markers and both breaks next to it                                                                                    |
| Highlight or range comment                         | The range and both ends                                                                                                                                                                                   |
| Point comment                                      | Its position. A new comment also declares the ledger gap its thread goes into                                                                                                                             |
| Reply, like, resolve or reopen                     | The reply list, the likes list, or the resolved field and the reply list                                                                                                                                  |
| Editing a comment's text, or taking a comment back | That thread's or reply's text lines; taking it back, also its markers and the whole thread                                                                                                                |
| Enter                                              | Its position, every mark open across it, and the rest of the block                                                                                                                                        |
| Backspace at the start of a block                  | Everything from the end of the previous block's last line to the start of this block's text, and every mark with a marker there                                                                           |
| New paragraph                                      | The break it goes into                                                                                                                                                                                    |
| Cell edit                                          | Its cell                                                                                                                                                                                                  |
| Adding or removing a row                           | Its row plus the deletion block, or the point where the block would go (third simulation). The second simulation used the whole table, or the row with the delimiter row as a structure lock              |
| Accept, reject, undo                               | The mark from its first to its last marker, both ends, every mark with a marker inside, the block boundaries for split, join, whole-block and block-format marks, and the table rule for marks in a table |

Without the read set, 8.5% of hot sessions confirmed invalid markup. With these rules, c2's
remaining failures also occur under c1, so they aren't caused by footprints.
