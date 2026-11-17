# How Redlines keeps the file sound: a draft for the website

**A draft of a page's words, not a page.** `website/` is one page today, and a page added to it is
deployed when it is merged; so this stays here until it has been read. It is for readers and
adopters. [hardening.md](hardening.md) is the contributors' version, with the files and switches.
Every number below is cited from a merged pull request's own checks and was not run again for this
page; the numbers of #297 and #277 are from a reviewer's probes, whose scripts are not in the
repository. The state of the issues is as of 17 November 2026. Where a sentence says *proved*, the
format's specification has a written argument; everywhere else it says *tested*. The only
comparisons are with Word and Google Docs.

---

## A plain file, and what that is meant to give

A Redlines document is an ordinary Markdown file. Open it in GitHub, pandoc, R Markdown, Quarto,
Hugo or Docusaurus 3 and you read the newest version of the document, because every change and
comment is an HTML comment that those programs hide. The format is designed so that:

- Every change and every comment has its author and its time, as in Word.
- Two branches that edit different paragraphs conflict only in the block at the end of the file that
  lists the people and the marks, and keeping both sides resolves it. Such conflicts are common:
  measured with plain git, anywhere from 1% to 97% of merges, depending on how much each branch
  adds. The specification lists the exceptions, among them two people given the same handle on two
  branches, which a merge repairs by renaming one.
- The file keeps working when another tool touches it: a formatter, another editor, knitr, pandoc.
  Not every tool is safe, and the specification says which: anything that re-wraps prose pushes
  markers to line starts; an editor that rewrites the whole file when it opens it does that and
  loosens some tight lists, so Redlines files should be edited in source mode there; converting a
  file into a Google Doc drops every marker and the ledger, so that every change is accepted and every
  comment lost; and MDX can't compile the comments, so it is not supported.
- There is one file. No sidecar, no database.
- It can keep its own full history, so that any earlier version can be rebuilt without git.

A raw file with pending changes is not meant to be pleasant to read. The document comes first;
changes are read in Redlines.

## What Redlines is built to hold about every edit

An editor that writes into a file other programs read has a harder job than one that keeps its
changes to itself. Five properties, and what tries to break each. They are what the tests aim at,
not a promise that nothing breaks: the exceptions found so far are listed at the end, and a known
exception is a bug.

**The document is meant to read the same in whatever order its changes are decided.** Each pending
change can be accepted or rejected, some only once the one next to it is decided. Redlines is built to
write an edit only where every order of those decisions gives the same words, and "the same" is
judged by an independent Markdown reader (micromark 4.0.2, with GitHub's tables and strikethrough),
not by us.

**When an edit can't be written the usual way, it is meant to be written another way, or to ask.**
Redlines does not guess and does not tidy. Where no small, in-place form of an edit reads the same in every
order, it writes the smallest whole unit that holds the edit (a word, a list item, a block, a table
row) as one replacement, with anyone else's pending changes kept in the text it replaces. Where no
unit can be written, it asks before making the edit without tracking, as Word does. A refusal stays
only where every way of writing would leave the file wrong, and it says why in words that name the
cause. A key that does nothing and says nothing is a bug, and a test counts the places in the code that
refuse, so that a new one is a failing test.

**No line of a paragraph, a heading, a list item, a quote or a table row is meant to begin with a
marker.** In Markdown a line that begins with an HTML comment is read as a different kind of block,
and the rest of the line changes meaning. A marker that opens a change at the start of a block stands
alone on the line before it, which Markdown reads as a block that ends on that line, and a marker may
start a line inside an HTML block's own content; nowhere else is a line to begin with one.

**Typing is meant to stay fast.** A keystroke in a long document with many changes may take at most
twice what the same key took in the editor before its block keys were written, and that bound is
tested on every change, on documents of 16 KB and 150 KB with 200 changes.

**When several people edit at once, every confirmed state is a sound file.** A seeded simulation of
live sessions, run over the editor's own writers, checks each confirmed state: the markup and the
ledger are valid, the body reads as the newest view, no word is lost, duplicated or credited to the
wrong person, nothing decided comes back, and every copy has the same text at the same version.

## Where Redlines widens, asks or refuses

Word and Google Docs keep changes in a format and a place of their own. A Markdown file is read by
many programs, by rules written for plain text, and a tracked change can change how the text *around*
it reads: a marker in front of a line, a blank line that makes a list loose, a bold change decided
before a row moves. So some edits can't be written as a small change in place. What Redlines does
then:

- **It widens.** Return at the start of the first item of a nested list, a bold over many table
  cells, an edit in code that starts a list item: each is written as a replacement of the smallest
  unit that holds it. Accepting gives the new unit and rejecting gives the old
  one back, and the same in every order.
- **It asks.** An edit that no unit can hold, or one in front matter or in Plain, is made without
  tracking only after you say so, and then leaves no trace, as in Word.
- **It refuses, in a few places, and says why.** One refusal is kept on purpose: when another
  person's pending change ends exactly at the edge of the unit (a split's break right in front of
  it, an insertion right after it), the edit is not written, because a heading typed after another
  person's split would read `## xbeta` in one order and `xbeta` in another (#107). The words are
  *"This would change how Bo Chen's insertion reads. Decide it first, or turn off Track Changes."*
  Typing in code that holds another person's pending code change is refused (#285); a pull
  request that writes it is open (#1016). Other refusals are kept where the file would be unreadable or forged.

In the cases that remain, the way out is to decide the other person's change first, or to turn Track
Changes off for the edit; the refusal says which.

## The evidence, in numbers

Each of these is from the checks of a merged pull request, and says what was compared with what.

- **571,930 single decisions** on 10,451 random documents with pending row moves, run against the
  previous version by a reviewer (#297). The new version refused 42 decisions that the old one had
  written; in every one of them the old result read differently in some order, or reached a dead end.
- **66,587 probes** by a reviewer (pastes of delimiter runs and other keys next to another person's
  pending insertions, substitutions and deletions), judged by micromark in every order of decisions
  (#277): none newly wrong, 5,081 newly sound, 812 newly refused, and over 23,000 of the old
  version's wrong writes refused now.
- **40,000 list layouts**: the test of #288 holds every line that the reading of lists is sure is an
  item to micromark 4.0.2's reading; it draws 4,000 layouts each time it runs, and its checks ran it
  over 40,000.

These are *tested*. What is *proved* is smaller, and written out in prose in the format's
specification: that a format change can be tried against the marks of its block with the marks that
are *apart* from it left out (plain words, with no line break, backtick, `<`, `>`, backslash or `|`,
on lines that start with a letter or a digit that no marker holds, and more), and a second argument
for changes to a list's structure, and that a format change inside one table cell can be checked
against that cell's marks only. They are arguments, checked by review and by the tests, and the
specification records an earlier shortcut in one of them that was wrong.

## What isn't covered

We would rather say it than have you find it.

- **Silent wrong writes, and changes that can't be decided, found so far.** In a few shapes Redlines
  still writes something that reads differently from what it shows, or leaves a change that can't be
  decided. Each is an open issue, and the list is what has been found, not a count of what is there:
  - a deletion inside a blank line of a quote between two paragraphs, in a few shapes (#447), and a
    change in the break of your own pending line break there (#419);
  - a highlight that runs from the text above a table into its header row can make another person's
    pending column change impossible to decide (#396);
  - five cases in one shape of pastes next to another person's marks (#276);
  - Return at the start of a nested first item, in four more shapes (#395);
  - pandoc's `~x~` and `^x^` in Quarto and R Markdown files, which a marker can stand inside (#370).
- In a file with mixed line breaks, the editor writes a break whose line feed a tracked edit takes out
  as the file's own kind. The command line writes it as it was (#924).
- A unit of more than eight blocks is not written as a replacement: the edit is asked about and made
  without tracking.
- The specification lists what is not yet tested: Word import into the full history, and live
  sessions with several authors in the full history, among other things.
- A renderer that passes HTML through publishes the hidden text: when a document leaves review,
  publish the newest view.
- Layout, the system's selection and input methods are only seen in the app, by hand; they are not
  part of the automatic tests.

The pull requests record how each change was reviewed: a review by someone who did not write it,
whose job was to break it, and fix rounds.

*For how this is kept up, and how to add a rule without loosening one, see
[the contributors' notes](https://github.com/skadauke/redlines/blob/main/docs/hardening.md).*
