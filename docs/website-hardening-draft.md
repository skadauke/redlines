# How Redlines keeps the file sound: a draft for the website

**A draft of a page's words, not a page.** `website/` is one page today, and a page added to it is
deployed when it is merged; so this stays here until it has been read. It is for readers and
adopters. [hardening.md](hardening.md) is the contributors' version, with the files and switches.
Every number below is cited from a merged pull request's own checks and was not run again for this
page; the numbers of #297 and #277 are from a reviewer's probes, whose scripts are not in the
repository. The state of the issues is as of 13 November 2026. Where a sentence says *proved*, the
format's specification has a written argument; everywhere else it says *tested*. The only
comparisons are with Word and Google Docs.

---

## A plain file, and what that is meant to give

A Redlines document is an ordinary Markdown file. Open it in GitHub, pandoc, R Markdown, Quarto,
Hugo or Docusaurus and you read the newest version of the document, because every change and
comment is an HTML comment that those programs hide. The format is designed so that:

- Every change and every comment has its author and its time, as in Word.
- Two branches that edit different paragraphs conflict only in the block at the end of the file that
  lists the people and the marks, and keeping both sides resolves it. Such conflicts are common:
  measured with plain git, anywhere from 1% to 97% of merges, depending on how much each branch
  adds. The specification lists the exceptions, among them two people given the same handle on two
  branches, which a merge repairs by renaming one.
- The file keeps working when another tool touches it: a formatter, another editor, knitr, pandoc.
  Not every tool is safe, and the specification says which: anything that re-wraps prose pushes
  markers to line starts, and the visual editors of RStudio and Quarto rewrite the whole file, so
  Redlines files should be edited in source mode there.
- There is one file. No sidecar, no database.
- It can keep its own full history, so that any earlier version can be rebuilt without git.

A raw file with pending changes is not meant to be pleasant to read. The document comes first;
changes are read in Redlines.

## What Redlines is built to hold about every edit

An editor that writes into a file other programs read has a harder job than one that keeps its
changes to itself. Four properties, and what tries to break each. They are what the tests aim at,
not a promise that nothing breaks: the known exceptions are listed at the end, and a known exception
is a bug.

**Whatever order the same decisions are made in, the document reads the same.** You can accept and
reject pending changes in any order. Redlines is built to write an edit only where every order of
those decisions gives the same words, and "the same" is judged by an independent Markdown reader
(micromark 4.0.2, with GitHub's tables and strikethrough), not by us.

**When it can't be sure, it says no, and says why.** It is meant not to guess and not to tidy. An edit
that cannot be written soundly is refused in words that name the cause and the way out, and a key
that does nothing and says nothing is a bug.

**No line of a paragraph, a heading, a list item, a quote or a table row begins with a marker.** In
Markdown a line that begins with an HTML comment is read as a different kind of block, and the rest
of the line changes meaning. The change to a whole block puts its opener and closer on lines of
their own, which Markdown reads as a block that ends on that line; nowhere else does a line begin
with one.

**Typing stays fast.** A keystroke in a long document with many changes may take at most twice what
the same key took in the editor before its block keys were written, and that bound is tested on every
change, on documents of 16 KB and 150 KB with 200 changes.

## Why Redlines sometimes says no, where Word wouldn't

Word and Google Docs keep changes in a format and a place of their own. A Markdown file is read by
many programs, by rules written for plain text, and a tracked change can change how the text *around*
it reads: a marker in front of a line, a blank line that makes a list loose, a bold change decided
before a row moves. So Redlines refuses some edits that Word would make. These are real refusals and
their words:

- *"This would change how Bo Chen's insertion reads. Decide it first, or turn off Track Changes."*
  Your edit would reach into text another person has proposed, and no way of writing it reads the
  same in every order of deciding.
- *"An empty item can't start a list right under a line of text in Markdown, and a blank line there
  would make the item above it loose. Put a blank line above the list first."* Return, at the start
  of the first item of a list, under a line of text.
- *"A line break typed here would be read as a different break once the changes are made together.
  Make the changes one at a time."*
- *"A tracked change can't go in code that starts a list item yet. Turn off Track Changes to edit
  it."*
- *"Bo Chen's pending change is in this code block. Decide it first, or turn off Track Changes."*
- *"Aligning a column with Track Changes on isn't ready yet. Turn off Track Changes to align it."*

In most of these the way out is to decide the other person's change first, or to turn Track Changes
off for the edit; the refusal says which.

**Some of these are meant to go away.** Code that starts a list item, and indented code in an item or
a quote, can't change with Track Changes on yet (#284). Typing in code that holds another person's
pending code change is refused (#285); the open issue asks for a way of writing it that reads the same
in every order, or for a proof that there is none, with the refusal kept. Aligning a table's column
with Track Changes on is refused for now (#281). Bold over more than five cells of a table used to be
refused, and no longer is (#267).

## The evidence, in numbers

Each of these is from the checks of a merged pull request, and says what was compared with what.

- **571,930 single decisions** on 10,451 random documents with pending row moves, run against the
  previous version by a reviewer (#297). The new version refused 42 decisions that the old one had
  written; in every one of them the old result read differently in some order, or reached a dead end.
- **66,587 probes** by a reviewer (pastes of delimiter runs and other keys next to another person's
  pending insertions, substitutions and deletions), judged by micromark in every order of decisions
  (#277): none newly wrong, 5,081 newly sound, 812 newly refused, and over 23,000 of the old
  version's wrong writes refused now. Five cases in one shape are still wrong, and the old version
  writes the same bytes there (#276).
- **40,000 list layouts**: the test of #288 holds every line that the reading of lists calls an item
  to micromark 4.0.2's reading; it draws 4,000 layouts each time it runs, and its checks ran it over
  40,000.

These are *tested*. What is *proved* is smaller, and written out in prose in the format's
specification: that a format change can be tried against the marks of its block with the marks that
are *apart* from it left out (plain words, with no line break, backtick, `<`, `>`, backslash or `|`,
on lines that start with a letter or a digit that no marker holds, and more), and a second argument
for changes to a list's structure, and that a format change inside one table cell can be checked
against that cell's marks only. They are arguments, checked by review and by the tests, and the
specification records an earlier shortcut in one of them that was wrong.

## What isn't covered

We would rather say it than have you find it.

- **Silent wrong writes that are known today.** In a few shapes Redlines still writes something
  that reads differently from what it shows, and each is an open issue: numbered lists under
  Backspace (#292); a prefix edit of a blank quote line between two paragraphs (#358); typing over
  one `*` of a pending bold's `**` (#299); Return in two rare layouts, a quote whose last line is a
  lazy continuation followed by another quote and a paragraph followed by a line that looks like a
  fence (#136); five cases in one shape of pastes next to another person's marks (#276); and
  pandoc's `~x~` and `^x^` in Quarto and R Markdown files, which a marker can stand inside (#370).
- The specification lists what is not yet tested: Word import into the full history, and live
  sessions with several authors in the full history, among other things.
- In a list under review, a change to its structure is refused when more than five marks have to be
  tried with it; some shapes of numbered lists (nested in another item, with mixed delimiters) keep
  their marks tried and so count toward that.
- The refusals listed above.
- A renderer that passes HTML through publishes the hidden text: when a document leaves review,
  publish the newest view.
- Layout, the system's selection and input methods are only seen in the app, by hand; they are not
  part of the automatic tests.

The pull requests record how each change was reviewed: a review by someone who did not write it,
whose job was to break it, and fix rounds.

*For how this is kept up, and how to add a rule without loosening one, see
[the contributors' notes](https://github.com/skadauke/redlines/blob/main/docs/hardening.md).*
