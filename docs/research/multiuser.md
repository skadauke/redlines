# Multiuser editing

Status: research study, November 2026.

What Redlines needs so that several people, and one person in several windows, can edit one
document at once. That covers the Mac app, Macs working together with no website in between, and
websites that embed the editor. It covers syncing, failures, and merging copies that diverged.

It builds on two earlier pieces of work:
- [collaboration.md](collaboration.md), which simulated live sessions;
- [design §7](../design.md#7-collaboration).

It changes neither spec. The decisions it needs are in §8.

It draws on four inputs:
- Google Docs, used live in two sessions (§2);
- published work on merging, failover and transports (see Sources);
- a survey of today's code at `3e62086e`;
- the earlier simulations.

## Summary

- **Keep one authority per session.**
  - It orders every edit and every decision.
  - Clients keep their edits as intents, and derive the tracked form again when someone else's edit
    lands first.
  - The simulations support this design: 0–0.4% of sessions confirmed invalid markup. It also
    puts accept and reject in one order, which no authority-free method does for marks that are
    text.
- **Let the authority run anywhere,** with one protocol: in a browser tab, in the desktop app's core,
  on a website's server, or on a host Mac. Several windows, websites and Mac-to-Mac sessions are then
  one design over different transports.
- **Sync the ledger as entries, not as text.**
  - Today every tracked edit rewrites the whole ledger, so any two edits made at once collide there.
  - In a session the ledger should travel as entries (a mark, a reply, a resolve), and every copy
    writes it out in the canonical order.
  - The file doesn't change.
- **Give every participant a replica.** A host whose Mac sleeps or leaves then costs nothing anyone
  has seen: guests keep typing, and later the session can pass to someone else under a new epoch.
- **Merge copies that diverged by replaying edits through the tracking filter.**
  - Edits that don't overlap apply as they were made.
  - Where they overlap, the incoming edits arrive as suggestions in their author's name.
  - Nothing is lost, and nobody sees a conflict dialog.
- **Mirror Google Docs** in presence, per-person undo, suggestions, comments, roles and saving
  status. Improve on it where it loses or muddles work (§2).
- **Transports:**
  - BroadcastChannel between tabs;
  - the app's own commands between windows;
  - a WebSocket to a website's server;
  - iroh between Macs, on one network or across the internet.

  iroh needs a relay for the connections it can't make directly. Who runs that relay is the main
  open decision.
- **Most of the work is in the editor, not the network.**
  - Every command must produce an intent that can be run again.
  - None of the collaboration rules is built yet (§7).
  - The first step that could ship is one document in several windows of one Mac, which needs no
    network.

## 1. The scenarios

| | Scenario | Who holds the document | Network |
| --- | --- | --- | --- |
| S1 | One person, one document in several windows of the app, or several tabs of a website | The app, or the website or browser | None |
| S2 | A website that embeds Redlines, whose users edit one document from any system | The website's server | The site's |
| S3 | Two or more people on Macs, on the same network | The host's Mac | Local network |
| S4 | The same across the internet, with no website in between | The host's Mac | Internet, and a relay for some connections |
| S5 | No live session: a file sent back, a shared folder, git, an agent writing the file | Each person's copy | None, or a sync service |
| S6 | Agents, in all of the above | Their person's client | Their person's |

The Mac app can also join an S2 session: a website's Open in Redlines link carries the server's
address and a token.

## 2. Google Docs as the reference

**Method.** Google Docs was used live on 16 November 2026, with two sessions of one account in two
browser tabs. Google's help pages filled in roles and offline use. Limits:
- with one account, the study couldn't tell who wrote what;
- "at the same time" meant actions a few hundred milliseconds apart;
- tables weren't tested.

**What Docs does**

| Area | Observed |
| --- | --- |
| Presence | Another session shows as a colored caret with a name flag above it. The flag appears when the person moves or types, and fades after about 5 seconds; the caret stays. Their selection shows as a tint in their color. There is no notice when someone joins or leaves. Other accounts also appear as avatars in the header; this study's single account didn't. |
| Typing at once | Two insertions at one place both survive, in the same order everywhere. Text typed into a paragraph that someone else deleted vanished with it, silently. A selection whose text someone deleted shrank to what was left. |
| Undo | Per session. ⌘Z takes back only your own steps, in order, and selects what it restores. Others' edits stay. |
| Suggestions | Three modes, Editing, Suggesting and Viewing, each with a one-line description, and a toast on switching ("You're suggesting"). Typing inside someone's suggestion joins it. A card shows the name, the time, "Add:" or "Delete:", accept, reject and reply. Accept all, in a review panel, shows a live count ("Accept all (2)"), acts on the suggestions that exist at the click, and offers Undo in a toast. A suggestion typed a moment later stays pending. |
| Two decisions at once | One session accepted and the other rejected, a second apart. The text stayed, so it was accepted, and the thread then held both "Suggestion accepted" and "Suggestion rejected". Undoing the accept brought the suggestion back with the rejected record still attached. |
| Comments | Deleting all of a comment's text keeps the thread, still open, in the comments list, labelled "Original content deleted". A resolve from another session threw away the reply being typed. A reply to a resolved thread reopens it ("Re-opened"). |
| Formatting at once | Bold in one session and italic in the other both apply. For a heading level or a list type, the last change wins, and both sessions converge. |
| Replace all | Acts on the text at the click. A matching word typed a moment later is left alone. |
| Version history | Versions grouped by time, with a color dot per author, "Highlight changes", named versions and Make a copy. Restoring is a new revision: the other session's text changed under it live, with no notice. |
| Status | "Saving…" then "Saved to Drive", next to the title. Offline editing must be turned on; edits made offline sync when the connection returns (help pages). |
| Roles | Viewer (reads), Commenter (comments and suggests, but makes no direct edits), Editor (edits, and accepts or rejects suggestions). People who open a shared link without signing in appear as anonymous animals (help pages). |

**What Redlines should do the same way**

1. Show other people as a colored caret with a name flag that fades after about 5 seconds, and their
   selection as a tint.
2. One color per person, the same for everyone in the session, for the caret, the flag, their
   changes and their history entries.
3. Undo and redo per person, selecting what they restore. Nobody else's edit is ever undone.
4. Accept all acts on the suggestions shown when it is clicked, with a live count and Undo.
5. A comment whose text was deleted stays, open, and says so.
6. A reply to a resolved thread reopens it.
7. Formatting changes merge. A block's type is the one set last.
8. Replace all acts on the text as it was at the click.
9. Restoring a version is a forward edit that everyone receives.
10. The saving state is shown next to the title, and offline is a state of its own.
11. Viewer, Commenter and Editor, with Suggesting as a mode.

**Where Redlines should do better**

1. Text typed into a paragraph someone deleted is kept where the paragraph was, with a notice
   (§4.2). Docs loses it.
2. Two decisions on one suggestion leave one outcome and one record (§4.4). Docs records both.
3. A resolve never throws away someone's reply in progress. The draft stays, and posting it reopens
   the thread.
4. A restore tells the others: "Ada restored the version from 3:30 PM."
5. Each person's text stays credited to them, even inside another person's suggestion.

## 3. What decides the architecture

Four facts about Redlines narrow the choice:
1. **Marks are text.** The file holds changes and comments as HTML comments, and the file is the only
   source of truth ([format](../format.md)).
2. **Every edit reads the same in every order of decisions** ([hardening](../hardening.md)).
3. **No accounts or sync service of our own** (the non-goals in [design](../design.md)). Websites
   bring their own server and accounts; Macs meet directly.
4. **Agents are collaborators,** and they edit through tools.

There are three families of methods:

| Method | What it gives | How it fits |
| --- | --- | --- |
| A text CRDT (Yjs, Automerge or Loro over the file's text) | No server, merges in any order, offline for any length | Marks are text, so edits made at once split markers and payloads. Yjs corrupted 40–46% of simulated sessions, and 98–100% after offline periods ([collaboration.md](collaboration.md)). [Peritext](https://www.inkandswitch.com/peritext/)'s authors report the same for Markdown in a text CRDT. **Ruled out.** |
| A structured CRDT: marks as annotations on characters, and the file written out from it | No server, any number of parties, long offline periods | The CRDT becomes the truth and the file an export. An outside edit (a git pull, an agent, a shared folder) has no character identities, so it arrives as a deletion plus an insertion and can duplicate text. An accept and a reject made at once can converge on a state that matches neither order. Peritext models inline marks only, not blocks, table rows or the ledger. **Rejected while the file is the truth.** |
| One authority per session that orders edits, in the manner of CodeMirror's collaboration package | Decisions in one order, the file stays the truth, and clients derive their tracked edits again | Needs someone to run the authority. The simulations cut invalid markup to 0–0.4% of sessions, against 15–84% for rebasing marked-up text. **Recommended.** The rest of this study is about making the host easy to have. |

**Worth a simulation, not yet a decision.** [Eg-walker](https://arxiv.org/abs/2409.14252) (Gentle
and Kleppmann, 2024–25) stores plain edits by position and replays them when copies meet. Replaying
intents through Redlines' tracking filter, in a fixed order, could merge any number of copies with no
authority while the file stays the truth. Nothing like it has been tried with marks, and the
session harness of §6 can test it.

**The collaboration package is frozen.** `@codemirror/collab`, which the design names, is small and
stable. Its last release was 6.1.1, in September 2023, and its GitHub repository was archived in
April 2026. Redlines should vendor it, with the fix collaboration.md found: rebase and receive one
update at a time, on both sides.

## 4. The design

### 4.1 One protocol, an authority that runs anywhere

The authority keeps a log of confirmed updates, the current text and a version. Its protocol is
collab's three messages plus a handshake and presence:

| Message | Purpose |
| --- | --- |
| `hello` | Sends the client's key or token, its protocol and format versions, and the last version it saw. The reply gives its role, its person and the session's epoch |
| `getDocument` | Returns the text and its version |
| `pull` | Streams the updates since a version |
| `push` | Sends updates from a version, each with its footprint and ledger entries. The reply is accepted, rebased, or rejected with a reason |
| `presence` | Carries carets, selections, the change someone has open, and "replying…". It is never stored |

Errors say what to do next:
- `token-expired`: get a new token;
- `forbidden`: stop;
- `stale`: derive again;
- `too-large` and `rate-limited`: back off;
- `update-required`: this app is too old;
- `ended`: the host closed the session.

Where the authority runs:

| Scenario | Authority | Clients reach it through |
| --- | --- | --- |
| S1, desktop | The app's core, one per open document | The app's own commands, with a channel per window |
| S1, browser, no server | A leader tab chosen with Web Locks, with its log in IndexedDB | BroadcastChannel |
| S2 | A small Node server, `@redlines/collab`, which the website runs | A WebSocket, with a token from the site |
| S3 and S4 | The host Mac's app core | iroh (QUIC), or a WebSocket on a local network |

The authority checks every push with the format library, so it should be written once, in
TypeScript, and run in Node, in a browser and in the desktop app. In the app, the Rust core would
host it in a session webview that outlives the document's windows, and do the networking and the
write-ahead log itself. Later, the `redlines` program's QuickJS could host it for a headless server.

A browser can freeze a leader tab without releasing its lock, and Safari has had lock-release bugs
([Web Locks](https://w3c.github.io/web-locks/)). So:
- the leader sends a heartbeat;
- a follower that misses three heartbeats takes the lock (`steal`);
- every version carries an epoch, so a frozen leader's late writes are refused.

### 4.2 Clients keep intents and derive them again

A client keeps each edit that hasn't been confirmed as an **intent**: what the person did, anchored
to the visible text, with its author, time and random bytes. For example:
- "type 'and' after 'cats'";
- "delete from 'The' to 'end.'";
- "make these words bold".

The tracked form is derived from the intent and the text by the same code as today, `trackedEdits`.
When a push is rejected, or a remote update touches an intent, the client derives it again against
the newest confirmed text. The tracking filter never runs on remote updates; it already skips them
(`tracked/typing.ts`).

Every kind of command must produce an intent:
- typing and deleting;
- Return and Backspace at the edges of blocks;
- table operations;
- formatting;
- paste and input methods;
- accept and reject;
- comments and replies.

Toggles carry their target ("bold", not "toggle bold"). That also gives Docs' results: bold and
italic both apply, and the last heading level set wins.

**Place, don't refuse.** When an intent derived again can't be placed exactly, it is placed as near
as possible, and never dropped:
- Text typed into a paragraph that someone deleted outright goes where the paragraph was, with
  "Bo deleted the paragraph you were typing in. Your text is kept here."
- Text typed into a paragraph that someone deleted as a tracked change stays outside the deletion, as
  the format already requires.
- A deletion whose text is already gone does nothing, and says nothing.

The earlier design turned away 0.4–4% of commands while deriving them again. This rule turns away
none, as Redlines' refusal policy asks: write the edit exactly, else write a wider one, else alert.

### 4.3 The ledger travels as entries

Today every edit that touches the ledger replaces the whole ledger in one change
(`ledger-write.ts`). The first tracked edit in a file without a ledger inserts one. In a session,
then:
- any two edits made at once collide in the ledger;
- two first edits make two ledgers.

The simulations ran on an earlier ledger layout and didn't see this.

In a session the document is a body plus a ledger map:
- The body, the text with its markers, syncs as text through the authority.
- The ledger syncs as entries: a mark's entry, a thread, a reply, a like, a resolve, a person, and
  the tracking and view settings.
- Each update in the log carries both, so there is still one order.
- Every copy writes the ledger text from the map in the canonical order it already uses
  (`normalizeLedger`), so all copies agree byte for byte.

Entries with different keys commute, and two replies to one thread are both kept, in the
authority's order. Footprints never include the ledger. The file doesn't change at all. The same map
is what a merge driver needs to merge two ledgers (§4.8).

### 4.4 Decisions are ordered and guarded

- **One outcome.** Accept and reject go through the authority's order, and the first decision wins.
  A second decision on the same mark is dropped with "Ada accepted this a moment ago." The thread
  records one outcome.
- **The guard.** A decision carries the mark as the person saw it. If the mark has changed since, the
  decision isn't applied, and the person sees "Bo changed this suggestion. Review it again."
  - In the simulations the guard turned away 1.4–9% of review clicks, and prevented every loss.
  - A card that updates live makes most of those clicks unnecessary.
- **Accept all** carries the ids shown at the click, with a live count and Undo. Suggestions made
  afterwards stay pending.
- **Undoing a decision** brings the mark back cleanly, with no stale record.

None of this exists yet. `accept` and `reject` act by id on the current text, with no guard
(`decide.ts`).

### 4.5 Undo per person

Undo takes back your own steps, never anyone else's:
- A tracked step is undone by rejecting your own mark, by id.
- An untracked step is undone by its inverse, if nobody has changed that text since. Otherwise it is
  refused, with the reason: "Bo has changed this since."
- Undo selects what it restores.

Today's undo is a copy of CodeMirror's history with agent owners (`history/history.ts`). It applies
the inverse text change, knows nothing of other people's steps, and is wiped when the file reloads.

### 4.6 Presence

- **Carets and flags** in each person's color, with the flag fading after 5 seconds.
- **Selections** as a tint.
- **The change or thread someone has open,** which neither Word nor Docs shows ([ux.md](ux.md)).
- **Avatars** next to the title, with Go to cursor and Show their changes, and later Follow.
- **"Bo is replying…"** on a thread.
- **Agents,** with their badge, and their cursor while they work.
- **Colors** are assigned by the authority, once per person per session, so everyone sees Bo in the
  same color. Today colors are per machine, and you are always the first color (`tracked/colors.ts`).

Presence is ephemeral. Positions travel with the version they refer to and are mapped through later
updates. None of it is stored in the file.

### 4.7 Replicas, epochs and a host that leaves

Every participant keeps a **replica** and saves it as it goes, in IndexedDB in a browser or in the
app's support folder on a Mac. A replica holds:
- the confirmed text;
- its version and epoch;
- the participant's own pending intents.

The host also keeps the write-ahead log.

**When the host's Mac sleeps or drops off,** guests see "Ada's Mac isn't answering. You can keep
editing." and carry on locally. When it answers again, they reconnect and push.

**When the host ends the session:**
- At first, the session simply ends. Guests keep their replicas and can save a copy.
- Later, the host can hand the session on: "Ada left. Bo is hosting now."
  - The new host starts the next **epoch** from the longest confirmed log among the participants.
  - Pushes that carry an older epoch are refused.
  - The old host rejoins as a client, by the merge of §4.8.

**There's no automatic election between two Macs.** Without a majority there is no safe vote, so a
takeover is either the host's handoff or a person's choice ("Take over the session"). A relay, if
there is one, can hold the epoch, which makes a takeover safe without anyone choosing.

When the session has moved on, the owner's file follows. If the owner made no edits since, the file
is brought up to date; if they did, the copies are merged.

### 4.8 Merging copies that diverged

Copies diverge in three ways:
- someone works offline for longer than the host keeps its log;
- a session splits in two;
- any no-session case: a file sent back, a shared folder, git, or an agent or another editor writing
  the file.

**How.** A three-way merge that understands marks:
- The base is the last text both copies confirmed.
- The other side's changes since the base are replayed through the tracking filter onto this side.
- They are replayed as intents where those are known, and otherwise as edits derived from the
  difference.

In the simulations this merged realistic copies cleanly in 100% of cases. That is an upper bound,
since the simulated words were unique. `git merge-file` needed manual work in 93% of cases, and a
character-level three-way merge wrote invalid markup in 0.6–2%.

**What people see**
- Edits that don't overlap apply as they were made: tracked ones stay tracked and untracked ones stay
  untracked. There is nothing to review, as in Docs.
- Where edits overlap, the incoming ones arrive as suggestions in their author's name: "Bo's edits
  from while you were apart are shown as suggestions." Nothing is lost, and nobody gets a conflict
  dialog; reviewing the suggestions is the resolution.
- A mark decided one way on each side (accepted here, rejected there) comes back as a pending
  suggestion, with both decisions noted, for someone to decide again.
- Three or more copies merge one at a time, in a fixed order.

None of this is built:
- there is no merge driver, no three-way merge, and no recovery from git conflict markers in the
  ledger;
- outside edits are reloaded or set aside with a notice (`document.ts`), not shown as tracked changes
  as design §7.3 says.

### 4.9 Identity, invitations and roles

- **Who you are.**
  - Each install has a key pair, kept in the Keychain, and a name, handle and color that the person
    picks.
  - The name is a label; the key is the identity.
  - A handle already in the session gets a suffix (`ada-2`).
  - Today handles come from git config, so two people can both be `ada` (`identity.ts`).
- **Invitations.**
  - An invitation is a link or QR code. It holds the host's key, its addresses, and an invitation
    secret bound to a role, an expiry and a number of uses.
  - The first `hello` binds the guest's key to the role, so later visits need no secret and an
    invitation can be revoked.
  - On a local network the host can also approve each guest: "Bo wants to join. Let in · Not now".
  - The guest remembers the host's key and warns if it changes.
- **Roles, as in Docs.**
  - Viewer, Commenter (comments and suggestions), Editor (direct edits and decisions), and the host
    as owner.
  - The authority enforces roles on every push by reading it with the format library. A
    commenter's push may only add comments and suggestions in their own name.
  - Roles bind the session, not the file. Whoever has a copy can edit their copy, as with any
    exported file.
- **Websites** pass their own accounts in a short-lived signed token (who, name, color, document,
  role), which the server checks.
- **Agents** act with their person's role, under their own handle (`claude-ada`).
  - Their edits must become pushes like anyone else's.
  - Today an agent's write is a line diff of the whole text, with no version check
    (`applyAgentEdit`). In a session it would undo what others typed meanwhile.
  - An agent's `str_replace` is already an anchored intent (find this text, replace it), so it can be
    derived again naturally.
- **Untrusted text.** Everything a guest writes, their name included, is untrusted input for agents,
  as hidden text already is.

### 4.10 Transports

| Transport | For | Notes |
| --- | --- | --- |
| BroadcastChannel and Web Locks | S1 in a browser | Built into browsers; a few hundred lines |
| The app's commands and channels | S1 in the app | Tauri's events aren't meant for streams; its channels are ([Tauri](https://v2.tauri.app/develop/calling-frontend/)) |
| WebSocket | S2, and S3 on a local network | The website's server, or the host. Bonjour (`_redlines._tcp`) finds hosts on a network |
| [iroh](https://github.com/n0-computer/iroh) | S3 and S4 | QUIC, dialed by key, encrypted end to end, with hole punching and a relay when that fails. About 9 in 10 connections are direct, per its docs. Rust, Apache-2.0 or MIT, 1.0 in June 2026 |

Not recommended:
- **CloudKit:** not real time, needs iCloud accounts, and unproven outside the App Store.
- **MultipeerConnectivity:** at most 8 peers, with reliability problems by Apple's own account.
- **WebRTC:** needs signaling and TURN servers that someone runs, and its Rust crate is pre-1.0.
- **libp2p:** heavy, and about 70% of hole punches succeeded in a large measurement.

Shared folders and iCloud Drive stay the slow, file-based path of §4.8.

**The relay.**
- iroh's public relays are [for development, not production](https://docs.iroh.computer/concepts/relays).
- For S4 to work for everyone, someone must run a relay: the project, the user, or a paid service.
- A relay sees only encrypted traffic and which keys talk to each other, never a document.
- This is the open question in design §14, now concrete.

**macOS.**
- Joining or browsing a local network asks for the Local Network permission, on macOS 15 and later.
  The app needs `NSLocalNetworkUsageDescription` and `NSBonjourServices`, a clear purpose string, and
  a plain message when macOS blocks it.
- The app isn't sandboxed, so it needs no network entitlements. That is to be confirmed on a
  notarized build.
- After sleep, the app waits until the network path is ready before it reconnects.

### 4.11 Saving

- The authority is the only writer of the file and of git. It writes the file atomically after a
  pause, and a Save is a commit with `Co-authored-by` lines.
- Guests' replicas live in the app's support folder, and a guest can save a copy.
- In S2 the website stores the text through a callback, and the server keeps the log.
- A change on disk during a session (a git pull, an agent using the command line, another editor) is
  merged in by the host as one update, by §4.8.
- The status next to the title: "Saved", "Saving…", "Offline", "Reconnecting…".

### 4.12 Failures, and what people see

| What happens | What people see | What Redlines does |
| --- | --- | --- |
| The network drops briefly | Nothing for 3 seconds, then "Reconnecting…" | Keeps the edits pending and saved; on return it pulls, derives them again and pushes |
| Someone works offline for a while | "Offline. Your edits are kept on this Mac." | Derives them again if the host's log still reaches back that far; otherwise merges (§4.8) |
| The host's Mac sleeps | "Ada's Mac isn't answering. You can keep editing." | Heartbeats every 10 s, and three missed mean gone; reconnects after wake |
| The host ends the session | "Ada ended the session." Later: "Ada left. Bo is hosting now." | Ends the session; later, a handoff with a new epoch |
| The host's app crashes | As for sleep, then nothing | The write-ahead log restores the session; guests push again |
| Two people both took over | When they meet: "Your copies were merged." | The older epoch's work merges by §4.8 |
| Someone deletes the paragraph you're typing in | "Bo deleted the paragraph you were typing in. Your text is kept here." | Places it, doesn't refuse it (§4.2) |
| You decide a suggestion that just changed | "Bo changed this suggestion. Review it again." | The guard |
| Two people decide one suggestion | "Ada accepted this a moment ago." | The authority's order, and one record |
| Someone resolves the thread you're replying to | Your draft stays, and posting it reopens the thread | Replies are entries |
| The file changes on disk | "This file changed outside Redlines. The changes are shown as suggestions by Bo." | Merges by §4.8, credited to the author when known, else `unknown` |
| An older Redlines tries to join | "Update Redlines to join this session." | `hello` checks the versions |
| A push is invalid or too big | Nothing, or "Redlines reloaded the document." | Checks pushes before logging them, with size and rate limits |
| An invitation has expired or was revoked | "This invitation no longer works. Ask Ada for a new one." | The invitation table |
| macOS blocks the local network | "Redlines can't reach your local network. Allow it in System Settings › Privacy & Security › Local Network." | Detects the denied network path |

## 5. Long documents

Deriving an edit again costs one `trackedEdits` call per pending edit, plus the editor's own update
for each received edit. Measured cold, outside the editor:

| Document | One edit derived again |
| --- | --- |
| 16–150 KB | 23–65 ms |
| 1 MB, 800 marks | 0.2–0.5 s |

A typist three updates behind needs three or four derivations per round trip. That is fine up to a
few hundred kilobytes, and a stall at a megabyte. Before sessions ship for large files they need:
- **Incremental work:** the scan of the marks and the tracked layer's display must both be
  incremental, as the long-document work under way does (#700, #744).
- **A budget:** past it, pending edits are derived again in one batch after a short pause, not on
  every received update.

The authority's own work per push is a parse and a footprint check, and the incremental scan makes
it cheap.

## 6. How we'd know it works

- **A session harness in the repository.** The earlier simulations ran in a lab outside it, with
  their own tracking code and an older ledger layout. The new harness uses:
  - the real format library, and the editor's own commands through keystroke scripts
    (`blocks/script.ts`);
  - an authority and three to five clients;
  - faults: latency and spikes, dropped connections, offline periods, sleep, a lost host, takeovers
    with epochs, crashes and restarts, old versions, and outside edits to the file.
- **Checks after every confirmed state,** not only on the saved file. Writing the text out again
  repairs broken markup, which would hide what people saw. The checks:
  - the markup and the ledger are valid;
  - the four hardening properties hold;
  - nothing is lost, duplicated, left untracked, brought back or credited to the wrong person, as
    the earlier oracle checked;
  - every copy has converged;
  - presence is anchored.
- **A fifth property for [hardening.md](../hardening.md):** a session never confirms invalid
  markup, and never loses anyone's text.
- **The earlier simulations, run again** on today's format before anything builds on their numbers.
  The authority-free replay of §3 runs in the same harness.
- **Deep runs** off CI, like the random suites at depth.
- **Real Macs:**
  - two Macs on one network;
  - two across networks with iroh, both direct and through a relay;
  - sleep and wake;
  - a captive Wi-Fi network;
  - a guest whose macOS denies the local network.

## 7. What it takes

What exists today:
- the tracking filter already ignores remote transactions;
- the tracked form is a pure function of the text, the edit, the author, the time and random bytes;
- accept and reject work by id;
- one file can already open in two windows, as two independent writers, which makes a ready test
  bed.

Nothing else in the collaboration rules is built.

**A small fix worth making now.** Until phase 1 lands, opening a file that is already open should
bring its window forward. Today the two windows each save the same file, and the second save asks
before overwriting the first (`windows.rs`).

Sizes: S is a day or two, M about a week, L several weeks with risk.

| Phase | Work | Size |
| --- | --- | --- |
| **0. Foundations, no network** | Intents, derived again, for every command | L |
| | Footprints (read and write sets) from the format, for every kind of edit | M |
| | The ledger as entries in a session, one ledger, written in canonical order | L |
| | The review guard, and one recorded outcome | M |
| | Undo per person, by mark id | M–L |
| | Define the synced text: `fileText`, line breaks, the open empty paragraph, input methods | M |
| | Agents' edits as pushes, not whole-text diffs | M |
| | Every confirmed state validated, and ids renamed on a collision | S–M |
| | The session harness, and the earlier simulations run again | M |
| **1. One Mac, several windows** | The authority in the app core, windows as clients, presence between windows; the same for browser tabs, with a leader tab | M–L |
| **2. Websites** | `@redlines/collab` (Node), the `SyncProvider` plugin with `getToken`, roles, the storage callback, and Open in Redlines from a website | L |
| **3. Macs on one network** | Hosting, invitations with QR codes, approval, roles, Bonjour, the Local Network permission, and iroh or a WebSocket | M–L |
| **4. Macs across the internet** | iroh with a relay, reconnection, sleep and wake | M, plus running a relay |
| **5. Replicas and merging** | Saved replicas, epochs and handoff, the three-way merge, the merge driver, and outside edits as suggestions | L |
| **6. History** | Version history from the log, named versions, restore as a forward edit, and what's new since you last looked | M–L |

- **Phase 0 holds most of the risk,** and almost all of it is editor work.
- **Phase 1 is the first step that could ship.**
  - It needs no network, no identity and no invitations.
  - It exercises the protocol, intents, the ledger map, presence and undo per person.
  - It starts from the app's existing two-window behavior.
- **Phase 5 pays for itself outside sessions too.** It is how a file that comes back by email, a
  shared folder's conflicted copy and a git merge are reconciled.

## 8. Decisions needed

1. **Order.** Start with phases 0 and 1, several windows on one Mac, as the first Epic?
   Recommended.
2. **The relay for internet sessions.** The choices:
   - the project runs a relay that carries only encrypted traffic (recommended for 1.0, with iroh's
     public relays during the beta);
   - users bring their own relay;
   - internet sessions need a VPN such as Tailscale.

   A relay is the one piece of shared infrastructure, and it never sees a document.
3. **When the host leaves.** End the session, which is simplest and is the current design, or hand
   it on automatically to the guest who has been there longest, which is closer to Docs (phase 5).
   Recommended: end it at first, and hand it on later.
4. **Copies that diverged.** The choices:
   - overlapping edits from the other side arrive as suggestions, and the rest applies silently
     (recommended);
   - everything from the other side is a suggestion;
   - everything applies silently, as Docs does.
5. **Roles.** Viewer, Commenter and Editor as in Docs, with Suggesting as a mode? Recommended.
6. **Identity.** A key per install and a name the person picks, with no accounts? Recommended.
   Websites bring their own accounts.
7. **A session with no host.** Simulate the replay merge of §3 during phase 0, once the harness
   exists, and build it only if it holds up? Recommended.

## Sources

Merging and authorities:
- [Peritext](https://www.inkandswitch.com/peritext/): rich text in a CRDT (Ink & Switch, 2021).
- [Eg-walker](https://arxiv.org/abs/2409.14252): replaying plain edits to merge (2024, EuroSys
  2025).
- [`@codemirror/collab`](https://github.com/codemirror/collab): archived notice. Also
  [its design](https://marijnhaverbeke.nl/blog/collaborative-editing-cm.html) and
  [the rebase discussion](https://discuss.codemirror.net/t/question-when-peer-networks-differ-during-collaborative-editing/7008).
- [Fencing tokens](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html),
  for epochs, and [Raft](https://raft.github.io/raft.pdf), on why two nodes can't elect.

Browsers and the app:
- [Web Locks](https://w3c.github.io/web-locks/) and
  [Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).
- [Tauri: calling the frontend](https://v2.tauri.app/develop/calling-frontend/).

Transports:
- [iroh](https://github.com/n0-computer/iroh): its [relays](https://docs.iroh.computer/concepts/relays),
  [hole punching](https://docs.iroh.computer/concepts/holepunching) and
  [tickets](https://docs.iroh.computer/concepts/tickets).
- [Local Network privacy on macOS](https://eclecticlight.co/2026/01/14/how-local-network-privacy-could-affect-you/).
- [MultipeerConnectivity's limits](https://developer.apple.com/forums/thread/775697).
- [CloudKit isn't real time](https://developer.apple.com/forums/thread/772283).
- [libp2p hole punching, measured](https://arxiv.org/html/2510.27500v1).
- [Noise](https://noiseprotocol.org/noise.html), and
  [access tokens from the host app](https://liveblocks.io/docs/authentication/access-token).

Google Docs and agents:
- Google Docs help: [suggestions](https://support.google.com/docs/answer/6033474),
  [anonymous viewers](https://support.google.com/docs/answer/2494888) and
  [sharing roles](https://support.google.com/drive/answer/7166529).
- [OWASP: prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/), for text
  that agents read.
