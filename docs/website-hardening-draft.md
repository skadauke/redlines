# Why you can trust the file: a draft for the website

**A draft of a page's words, not a page.** `website/` is one page today, and a page added to it is
deployed when it is merged; so this stays here until it has been read. It is for readers and
adopters. [hardening.md](hardening.md) is the contributors' version, with the files and switches.
Every number below is cited from a merged pull request's own checks and was not run again for this
page; the state of the issues is as of 13 November 2026. Where a sentence says *proved*, the format's
specification has a written proof; everywhere else it says *tested*. The only comparisons are with
Word and Google Docs.

---

## A plain file, and what that promises

A Redlines document is an ordinary Markdown file. Open it in GitHub, VS Code,
pandoc, R Markdown, Quarto, Hugo or Docusaurus and you read the newest version of the
document, because every change and comment is an HTML comment that those programs hide. Nothing
else is needed:

- Every change and every comment has its author and its time, as in Word.
- Two branches that edit different text merge in git, and the only conflicts are in the block at the
  end of the file that lists the people and the marks; keeping both sides always resolves them.
- The file keeps working when another tool touches it: a formatter, another editor, knitr, pandoc.
- There is one file. No sidecar, no database.
- It can keep its own full history, so that any earlier version can be rebuilt without git.

A raw file with pending changes is not meant to be pleasant to read. The document comes first;
changes are read in Redlines.

## What Redlines promises about every edit

An editor that writes into a file other programs read has a harder job than one that keeps its
changes to itself. Four promises, and what holds each.

**Whatever order you decide the changes in, the document reads the same.** You can accept and
reject pending changes in any order. Redlines only writes an edit when every order of those
decisions gives the same text, and "the same" is judged by an independent Markdown reader
(micromark 4.0.2, with GitHub's tables and strikethrough), not by us.

**When it can't be sure, it says no, and says why.** It does not guess and it does not tidy. A key
that cannot be written soundly is refused in words that name the cause and the way out. Nothing
fails silently.

**No marker starts a line.** In Markdown a line that begins with an HTML comment is read as a
different kind of block, and the rest of the line changes meaning. Redlines never writes one there.

**Typing stays fast.** A keystroke in a long document with many changes may take at most twice what
the same key takes in a plain editor, and that bound is tested on every change.

## Why Redlines sometimes says no, where Word wouldn't

Word and Google Docs keep changes in a format and a place of their own, and can record any edit. A
Markdown file is read by many programs, by rules written for plain text, and a tracked change can
change how the text *around* it reads: a marker in front of a line, a blank line that makes a list
loose, a bold change decided before a row moves. So Redlines refuses some edits that Word would
make. These are real refusals and their words:

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

In most of these the way out is to decide the other person's change first, or to turn Track Changes
off for the edit; the refusal says which.

**Some of these are meant to go away.** Code that starts a list item, and indented code in an item
or a quote, can't change with Track Changes on yet (#284). Typing in code that holds another
person's pending code change is refused today (#285). Aligning a table's column with Track Changes
on is not built (#281). Bold over a table's cells used to be refused beyond five cells and no longer
is (#267).

## The evidence, in numbers

Each of these is from the checks of a merged pull request, and says what was compared with what.

- **571,930 single decisions** on 10,451 random documents with pending row moves, run against the
  previous version (#297). The new version refused 42 decisions that the old one had written; in every
  one of them the old result read differently in some order, or reached a dead end.
- **40,000 list layouts**, every line the reading calls an item held to micromark 4.0.2's reading
  (#288).
- **66,587 probes** (pastes of delimiter runs and other keys next to another person's pending
  insertions, substitutions and deletions), judged by micromark in every order of decisions (#277): none newly wrong, 5,081 newly sound, 812
  newly refused, and over 23,000 of the old version's wrong writes refused now. Five cases in one
  shape are still wrong, and the old version writes the same bytes there (#276).

These are *tested*. What is *proved* is smaller and stated in the format's specification, with its
argument: for instance that marks inside a numbered item's text, after its first character, can't
change how the numbers below it are read, in any order of decisions, and what that proof does not
cover.

## What isn't covered

We would rather say it than have you find it.

- The specification lists what is not yet tested: Word import into the full history, and live
  sessions with several authors in the full history, among other things.
- In a list under review with more than five changes pending, a change to the list's structure is
  refused for their count. Some shapes of numbered lists (nested in another item, with mixed
  delimiters) are still tried one change at a time, or refused.
- The refusals listed above.
- Layout, the system's selection and input methods are only seen in the app, by hand, before each
  release; they are not part of the automatic tests.

Every change to how an edit is written is reviewed by someone who did not write it and whose job is
to break it, and each round of fixes is reviewed again. The pull request says what each round found.

*For how this is kept up, and how to add a rule without loosening one, see
[the contributors' notes](https://github.com/skadauke/redlines/blob/main/docs/hardening.md).*
