# Ids, the ledger and git merges

Status: research notes, October 2026. How mark ids and the YAML ledger behave in git merges, in
YAML parsers and in knitr, and where each mark's author and time should go.

Two questions shaped these tests. The first is whether mark ids should be serial numbers, which
are shorter and look tidier, or random strings. The second is how the ledger, a YAML mapping
inside an HTML comment at the end of the file, holds up: in git merges, in YAML parsers for R,
Python and JavaScript, with two people of the same name, and with richer data such as teams and
task assignment.

## Method

- Merge trials: 80,511 seeded merge trials of generated Redlines documents, run by a mix of:
  - two or three branches;
  - reviewers;
  - an owner who accepts, rejects and resolves;
  - an agent in parallel sessions.
- Designs: 33 ledger designs compared.
- Each trial was merged three ways:
  1. with plain git, which is what GitHub's merge button runs, checked against real `git merge`
     (400/400 identical);
  2. by keeping both sides of every conflict, the obvious manual fix;
  3. with a prototype mark-aware merge driver.
- YAML: 59 pitfall cases in six parser configurations (JavaScript `yaml` in 1.2 and 1.1 mode,
  `js-yaml`, PyYAML, ruamel.yaml, R `yaml`), and every possible id run through five of them.
- knitr 1.51, on R code inside Redlines comments.
- Live sessions: results from the [collaboration simulation](collaboration.md).
- Word: results from the [Word tests](word.md).

The code and data are in the project's lab, outside this repository.

## The earlier layout, tested

An earlier version of the format kept each mark's author and time in the ledger, one line per
mark (`k3x9: {by: ada, at: 2026-10-13T22:30:00Z}`), with marks and comments sorted by id and a
`checksum:` line at the end. Ids were four characters from `a`–`z` and `0`–`9`. Its claims and
assumptions, checked (quotations are from the earlier spec):

| Claim or assumption                                                                                            | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Random ids "spread new ledger entries across the file, so parallel additions usually merge without a conflict" | False for real sessions. Two branches adding 20 marks each conflicted in 300/300 trials; a reviewer alongside the owner in 298/300; three branches in 100/100. New entries only need to land in the same _gap_: with N entries, one addition per side conflicts with probability about 2/(N+2), and five per side conflict 96% of the time at N=10, 60% at N=50                                                                                                                                                                      |
| "A collision is never silent"                                                                                  | Only within one ledger section. Forced mark–mark collisions always showed as conflicts (215/215). An id used for a mark on one branch and for a comment or reply on the other never did (0/74)                                                                                                                                                                                                                                                                                                                                       |
| The `checksum:` line detects edits made outside the editor                                                     | It makes every parallel edit conflict (100%). After any merge it no longer matches, so merged-in work would be recorded as untracked edits by `unknown`                                                                                                                                                                                                                                                                                                                                                                              |
| Keeping both sides of a ledger conflict is a safe resolution                                                   | Wrong in 88–100% of cases (100% with the checksum): it leaves duplicate keys, which five of six parsers reject and PyYAML silently resolves by keeping the last                                                                                                                                                                                                                                                                                                                                                                      |
| "R, Python and JavaScript parsers read it after one decoding step"                                             | They read different values. 0.6–0.8% of ids in the earlier alphabet are not strings in some parser (`0042` is 42 in JavaScript but 34 in PyYAML and R; `1e10`, `0x1f`, `null`, `true`), so a document with 100 ids has one 44–55% of the time. The comment key `on:` becomes `true` in PyYAML and R. A reply `No` becomes `false`. Text starting with `@claude` is a parse error everywhere. ` #12` silently truncates text. `Yes, agreed` in flow style splits into a stray key. Timestamps become datetimes in four of six parsers |
| knitr leaves comments alone                                                                                    | knitr runs R code it finds in the ledger: a review comment containing `` `r …` `` executes at every knit                                                                                                                                                                                                                                                                                                                                                                                                                             |
| One agent handle with `for: ada`                                                                               | Breaks when the agent works for two people. A clean merge silently flipped all of Claude's marks to "for bo"                                                                                                                                                                                                                                                                                                                                                                                                                         |

The earlier ledger also couldn't represent:

- two pending front-matter changes;
- text typed after the ledger, which happens in editors that show HTML comments as text;
- team mentions or task assignment (Word has both);
- a thread resolved on one branch and replied to on another.

51 scenarios were walked through in total.

## Serial or random ids

| Consideration                                                                            | Serial `7`                                                                                                                                                                      | Per-author `ada7`                                                                            | Random (recommended)                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Live session (ids created before the authority confirms)                                 | 14–30% of new ids already taken by another client; renumbering during rebase broke markup in 986 of 2,525 renames                                                               | Collides when one person or agent uses two tabs or sessions                                  | 0 collisions in 33,000 marks                                          |
| Git branches                                                                             | Every parallel branch collides by construction. With plain git, 49% of reviewer + owner merges **silently** duplicated ids                                                      | No collisions between different people; one agent in three sessions collided in 100% of runs | About 1 in 935 merges of two 20-mark branches, repaired automatically |
| References from outside (Syrus rows, chat links, a request such as "accept change k3x9") | Max+1 reuses ids; dedup renames ids people already quoted                                                                                                                       | Same                                                                                         | Stable                                                                |
| Copy and paste between documents                                                         | A pasted `<!--ins 3-->` binds to the target's own mark 3 and is misattributed                                                                                                   | Rare                                                                                         | Unknown ids degrade safely                                            |
| What Word does                                                                           | Word renumbers its revision `w:id`s on every save (verified: 101 → 9 → 8). It keeps durable identity only for comments, as random 8-hex-digit `durableId`s ([word.md](word.md)) |                                                                                              | Same idea as Word's durable ids                                       |
| What people see                                                                          | The editor numbers changes in document order ("3 of 17"), as Word's Reviewing pane does. People never see ids in any scheme                                                     |                                                                                              |                                                                       |

Deduplicating serial ids in a merge step doesn't work, for three reasons:

1. The merge code doesn't run where most merges happen. GitHub's merge button and conflict
   editor, GitLab.com and Bitbucket never run custom merge drivers. On that path, serial ids
   collide every time.
2. Where it does run, dedup means renaming. Renaming breaks every reference already made by
   Syrus, an agent transcript or a chat link, and the format promises that ids never change.
3. Live sessions have no merge step. Renaming would have to happen inside every client's rebase,
   which the simulation showed is fragile.

The benefit of serial ids is cosmetic, and the editor's "Change 3 of 17" numbering already
provides it.

The id rules that follow from this, now in the [format spec](../format.md#23-ids):

- Ids are random and four characters long. The first character comes from `bcdfghjkmnpqrstvwxz`,
  the other three from `bcdfghjkmnpqrstvwxz23456789` (373,977 ids).
  - No vowels, so no words.
  - No `0 1 l o`, so nothing to misread.
  - None that any YAML parser reads as a number, boolean, date or null (every id checked).
  - The ids fit Word's `durableId` (below 2³¹).
- Ids are drawn from a cryptographic source, unique across marks, comments, replies and groups,
  and never renumbered.
- If a duplicate ever appears, the earlier one keeps the id and the other is renamed.

## Authors and times: in the marker or in the ledger

One layout tested moves each mark's author and time out of the ledger and into its opening marker.
That removes most ledger conflicts in git merges: the ledger then keeps only people, comment
threads, and the few marks that carry extras (note, group, move). The layout as tested:

```markdown
We will ship the <!--ins k3x9 ada 2026-10-13T22:30Z-->new <!--/k3x9-->importer in <!--sub p7qd claude-ada 2026-10-13T22:31Z March-->April<!--/p7qd-->.
```

```yaml
version: 1
people:
  ada: { name: Ada Lovelace, email: ada@example.org }
  alex-kim: { name: Alex Kim, email: alex.kim@example.org }
  alex-kim-2: { name: Alex Kim, email: akim@law.example, org: Example Law }
  claude-ada: { name: Claude, agent: true, for: ada }
marks:
  p7qd: { group: g4rs, note: Matches the roadmap }
comments:
  c8d2:
    by: ada
    at: 2026-10-13T22:36Z
    resolved: ada 2026-10-13T22:41Z
    text: |-
      Can we settle this before the review, @claude-ada?
      \
      See the pricing table.
    likes:
      - alex-kim-2 2026-10-13T22:39Z
    replies:
      - id: r5tw
        by: claude-ada
        at: 2026-10-13T22:37Z
        text: |-
          The tiers are in the appendix.
```

Layout rules:

- `people` is sorted by handle, one line each.
- Threads are in document order. Inside a thread, rarely changing fields come first, then `text`
  as a literal block, then the growing lists (`likes`, `replies`), so that resolving, liking and
  replying on different branches touch different lines. The [history prototype](history.md) later
  found that with this order, keeping both sides of a conflict can file a reply under the wrong
  thread, and moved the growing lists before the text. The
  [format spec](../format.md#5-the-ledger) uses that order.
- Replies are a list in conversation order.
- Free text is always a literal block, so anything a person types is safe: a leading `@`, `: `,
  ` #`, quotes.
- Times are UTC with minute precision (`2026-10-13T22:30Z`). Every parser reads that as a string,
  while `…:00Z` becomes a datetime in four of six parsers.
- There is no `checksum`. Edits made outside the editor are detected against git or the editor's
  last saved copy.
- An agent gets one handle per person it acts for (`claude-ada`, `claude-bo`).

Merges with plain git, which is what GitHub's merge button runs, on branches that edit different
paragraphs. The first four rows give the share of merges with a ledger conflict; the last, how
often keeping both sides of a conflict gives a wrong result:

| Scenario                        | Earlier layout | Earlier layout without checksum | Authors and times in the marker |
| ------------------------------- | -------------- | ------------------------------- | ------------------------------- |
| Two branches, 20 marks each     | 100%           | 100%                            | **0%**                          |
| Reviewer and owner in parallel  | 100%           | 99.3%                           | **0%**                          |
| Small additions to a big ledger | 100%           | 17.7%                           | **1%**                          |
| Three branches                  | 100%           | 100%                            | **43%**                         |
| Keeping both sides is wrong     | 100%           | 88–100%                         | **0%**                          |

Putting an agent's note and group in the marker too would remove the remaining conflicts of
parallel agent sessions (0% instead of 94%), at the cost of agent notes appearing inline.

The cost of this layout is longer opening markers. All marker text in the body grows by about
50%, which anyone reading the raw file sees, on GitHub or in an editor that shows HTML comments as
text.

The alternative tested, R2, keeps the short markers of the earlier layout (`<!--ins k3x9-->`) and
lays out the ledger the same way, with one line per mark in document order. It merges better than
the earlier layout but worse than authors and times in the marker:

| Scenario                        | R2: short markers | Authors and times in the marker |
| ------------------------------- | ----------------- | ------------------------------- |
| Two branches, 20 marks each     | 46.7%             | 0%                              |
| Reviewer and owner in parallel  | 30.3%             | 0%                              |
| Small additions to a big ledger | 1.3%              | 1%                              |
| Three branches                  | 78%               | 43%                             |
| One agent in three sessions     | 67%               | 94%                             |
| Two branches add new people     | 97%               | 97%                             |

With R2, keeping both sides of a conflict was right in every scenario except two. In merges of a
reviewer's and an owner's branches, it brought back the ledger entries of marks the owner had
accepted or rejected (every such merge). And when two different people get the same handle on two
branches, it leaves a duplicate key, as in every layout.

The format uses R2. It makes the returning entries harmless (an entry whose mark is no longer in
the body is ignored and removed on the next save), and states the keep-both-sides rule in the
ledger's first line, for whoever resolves the conflict. The reasons are in
[format §7.5](../format.md#75-where-the-author-and-time-go): shorter markers, and a ledger that
conflicts in either layout.

## Other ledger rules

- The comment key for a comment about a mark is `about`, not `on`, because YAML 1.1 parsers read
  `on` as `true`.
- Handles:
  - letters, digits, `-` and `_`, starting with a letter;
  - never `y`, `n`, `yes`, `no`, `on`, `off`, `true`, `false` or `null`;
  - derived from the email's local part, else from the name;
  - `-2`, `-3` appended on a clash, so two people with the same name get different handles.
- A team is a `people` entry with `members: [ada, bo]`, and can be mentioned.
- Departed people keep their handle: `{name: Former member, deleted: true}`.
- The same person under two handles (after a merge) keeps the older handle and records the other
  in `aliases`.
- The comment fields `assigned` and `done` hold Word's task assignment, and `reactions` holds
  reactions beyond "like" (exported to Word as likes only).
- A comment about a mark also gets a point marker right after the mark, so it keeps its place
  when the mark is accepted or rejected.
- A reply later than `resolved` reopens the thread. The second
  [collaboration simulation](collaboration.md) found this ambiguous when both happen in the same
  minute, and the [format spec](../format.md#4-comments) makes `resolved` a state instead.
- `frontmatter` is a list, one entry per changed key.
- Readers keep every value a string and reject duplicate keys:
  - `yaml` with `schema: 'failsafe'`
  - js-yaml with `FAILSAFE_SCHEMA`
  - PyYAML with `BaseLoader` plus a duplicate check
  - R `yaml` with string handlers
- Text typed after the ledger is tolerated; the editor moves the ledger back to the end on save.
- 2,000 marks and 500 threads make about 270 KB of ledger, parsed in 9–76 ms (267 ms in
  pure-Python PyYAML). That is fine for git; the editor should parse it incrementally.

## The merge driver

A prototype merge driver (`redlines merge-driver`) removed every ledger conflict and every silent
mis-merge in 80,511 merges. Only real prose conflicts were left: the same paragraph edited on two
branches. It can run in:

- local clones (`redlines merge-driver install` writes the git config);
- the Syrus plugin's server-side merges;
- the editor's "fold in commits" step.

GitHub's merge button never runs it, so the file has to merge safely without it: either with
fewer conflicts (authors and times in the marker) or with conflicts that keeping both sides always
resolves, which is the format's choice. The [format spec](../format.md#7-merging) describes merging
with and without the driver.
