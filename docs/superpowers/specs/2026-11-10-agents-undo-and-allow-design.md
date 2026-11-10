# Undo after an agent's edit, and the Allow question

*Design, Nov 10, 2026, for the agents epic (#185): Undo after an agent's edit (#186) and the first-run Allow question (#187). It builds on [design.md](../../design.md) and [format.md](../../format.md), and says where it departs from them.*

## Why

Stephan, reviewing build 10: "I strongly disagree with the idea that Undo for some reason doesn't work anymore after an agent (at least MY agent) made a change to the document." The issue (#186) asks for more than a working ⌘Z: "Undo should keep working across an agent's change (at least the person's own agent's), including undoing the agent's change itself."

On the question an agent's first run in a folder asks (#187): it "is visually confusing. It's not clear there there are buttons and it looks sort of like some other agents answered something." The issue: "Make it read as a question to the person, with buttons that look like buttons."

**Undo today.** An agent's edit reaches the editor as a new version of the whole text. The tool computes its change with `@redlines/format`, `ToolDocument.write(next)` calls `applyAgentEdit(next)` in `apps/desktop/src/document.ts`, and that calls `editor.reloadDoc(next, { agent })`. `reloadDoc` applies a line diff (`lineChanges`) outside the history, and because the text changed, it starts the history over (`startOver` in `packages/editor/src/history.ts`). ⌘Z then does nothing and says "Undo isn't available after Claude's edit."

That was a deliberate fix, not an oversight. v0.1's final review reproduced ⌘Z after an agent's write corrupting the ledger and silently dropping the agent's work. CodeMirror's history maps the person's steps through a change made outside it, which is right for plain text and wrong here: every step that touched the ledger holds the inverse of a whole-ledger rewrite (`commitEdit` → `setLedger` writes the ledger whole, from its blank line to `-->`), and replayed over the agent's own rewrite it kept the agent's new lines and put the old ledger back beside them, leaving a reply's lines after the ledger or a suggestion's entry gone. The live-session research found the same in the body: an inverse text change after someone else's change "was the most damaging single operation: 57 problem updates per 1,000 undos", orphaning markers and bringing back text whose deletion had been accepted ([research](../../research/collaboration.md)). The ruling traded Undo for a sound file. This design keeps the sound file and gives Undo back.

**The question today** is one gray line at the foot of the thread (`plugins/agents/src/live-line.ts`): the agent's dot in its color, "Let Claude read this folder?", the folder, then Allow, Just this document and Not now as `rl-note-button`s, which are transparent, borderless, 22 px tall and in the status line's 12.5 px gray until hovered. A reply's byline also starts with its author's dot, and the line sits where replies go, so it reads as Claude saying something, and the answers read as words.

## In short

- **Undo goes back in time through what this window did:** your edits, decisions, comments and replies, and the runs of your agents. ⌘Z takes back the newest step and ⇧⌘Z puts it back. Each step is the exact inverse of what it did, so Undo gives back a text the file had, byte for byte, and nothing is ever replayed over a text it wasn't made on.
- **A run is one step:** its suggestions or direct edits, the comments it started and its reply. One ⌘Z after a run gives the document back as it was before the run; ⇧⌘Z brings the run back. If you edited while it ran, each stretch of the run between your edits is a step, newest first.
- **Your agent's changes from outside the app,** made in its name with the `redlines` command line (a Claude Code session in a terminal), are steps too, when they are nothing but its suggestions, comments and replies.
- **What others did stays.** ⌘Z never takes back what another app, another person or their agent did to the file; a tracked change of theirs is rejected like any. Until Stage 5, the history still starts over after such a change, as today; Stage 5 keeps your earlier steps, so Undo goes on across it.
- **Undo, Reject and Review › Undo are three things:** Undo goes back in time; Reject decides a suggestion, any time, in any order; an Auto run's Review › Undo reverts its direct edits as a new step of yours.
- **The Allow question** becomes a small panel that Redlines draws in the thread, with no agent dot: "Allow Claude to read this folder?", the folder, one line on what that means, and three real buttons, stacked: Allow, Just This Document, Not Now. It never takes the keyboard, and when it waits out of view a notification says so.

## Goals

1. One ⌘Z after your agent's run takes the run back, whatever it wrote, and ⇧⌘Z brings it back. Undo never again says it isn't available after your agent's edit.
2. Your own steps before the run stay undoable, exactly.
3. Your agent's changes made from a terminal undo the same way.
4. Work that isn't yours is never undone by your ⌘Z.
5. The first-run question reads as Redlines asking you, with buttons that look like buttons.
6. A keystroke costs what it costs on main.

## Non-goals

- Undo after the document closes. The history lives in the window, as in Word, Google Docs and Pages.
- Undoing someone else's work. Reject is for that.
- Taking a run out of the middle of the history while keeping what came after it. That is Review › Undo, which comes with the Auto level.
- The agent levels themselves (Ask and Auto, design §8.2), the run summary in the thread ("6 suggestions · Accept all · Reject all · Show", §8.3) and animated edits (§8.4). This design says how Undo treats them; they are built elsewhere.
- Live sessions (§7.1). Stage 5 builds what they will need for Undo, and nothing else of them.
- The running and failed live lines, which stay as they are.
- Undo in comment boxes and the find field, which stays the text field's own.

## Anti-goals

These would make it a failure even if it technically works:

- **An undo that breaks the file,** or silently drops anyone's work: the v0.1 bug, back.
- **Your ⌘Z taking back another person's work,** or another app's change, without your noticing.
- **Undo out of order:** a ⌘Z that takes back something older while something newer of yours stays, with nothing said.
- **A run started by Undo or Redo.** Only posting a comment starts a run (design §5.7).
- **A consent answer given by a stray keystroke,** a question that looks like an agent's reply, or a question nobody can see holding up a run.
- **New chrome:** a dialog for the question, a toolbar, a badge, an undo history panel.
- **Slower typing.**

## Constraints

- **The format's rulings.** Every allowed edit reads the same in every decision order, judged exactly, with micromark 4.0.2 as the oracle. Redlines refuses rather than repairs, but ordinary typing refused is a failure, and so is ordinary Undo refused. `docs/format.md` is the source of truth for `packages/format`. In Stages 2 to 4, Undo and Redo only ever give back texts the file had, so they write nothing new to judge. Stage 5 writes new texts, and judges each one before it is applied (see Mechanism).
- **A keystroke costs what it does on main.** The history runs on every transaction.
- **The app is the only writer to an open document** while a run is live (design §6.3), and an agent's edit lands in one go: each tool reads the whole text, computes its change and writes the whole new text in the same task (`packages/agent-tools/src/tools.ts`), so the person's typing can't come between a read and its write.
- **The platform.** Tauri v2 on macOS, WKWebView, CodeMirror 6. Edit › Undo and Redo are the menu's predefined items, which reach the page as `beforeinput` events (`historyUndo`, `historyRedo`) in whatever has the keyboard: the document's history in the document, the field's own undo in a comment box. ⌘Z and ⇧⌘Z in the document go through the editor's keymap (`undoKeymap`).
- **Accessibility.** The question is a real group of real buttons for VoiceOver and the keyboard, with visible focus, targets at least 24 px tall at the smallest text size, and contrast that holds in every theme, light and dark, at every text size from 80% to 200%.
- **Color means a person.** The question is in the theme's grays; red is the pen's alone (design §6.6).

## Decided by Stephan

- Undo works after an agent changes the document, at least his own agent, and it can take back the agent's change itself.
- The Allow question reads as a question to the person, with buttons that look like buttons, and not like another agent's answer.

Everything else below is my call, marked **Call:** with its reason.

## Undo

### What a step is

The history holds steps, newest last. ⌘Z takes back the newest; nothing else is ever taken back.

| What changed the text | A step? |
| --- | --- |
| Your typing, pasting, formatting, Find's Replace All, accepting and rejecting, posting comments and replies, in this window | Yes, as today |
| A run you started in this window: your agent, in the thread you posted in | Yes: one step, or one per stretch between your edits |
| Your agent from outside the app: a change on disk that is nothing but suggestions, comments and replies by agents acting for you (`claude-ada` for Ada) | Yes: one step per change on disk |
| Any other change on disk: another app, git, a sync service, another person or their agent, an agent writing the file with its own tools | No. Until Stage 5 the history starts over after it, as today; from Stage 5 it goes on across it |
| A collaborator in a live session, later | No; as Stage 5 |

**Call:** your agent's run is a step in your history, as your own edits are, because the agent acts for you (design §8.1), and Word, Google Docs and Pages put their own AI's edits in your Undo. **Call:** Undo goes back in time and never out of order, because then every step is the exact inverse of the text it left, and the person can always predict what the next ⌘Z does.

### One ⌘Z after a run

**Call:** a run is one step: everything it wrote to the file, its suggestions or direct edits, the comment threads it started on other text, and its reply. One request, one ⌘Z; and a reply left behind ("Cut it from 40 to 18 words.") would describe edits that are gone. ⌘Z after a run that only replied takes the reply back, and the next ⌘Z takes back your comment.

- **Suggest (tracked), your agent.** ⌘Z removes the run's suggestions, their markers and their ledger entries, its new threads and its reply: the file is byte for byte what it was before the run. ⇧⌘Z puts them back.
- **Auto (direct), your agent, when Auto is built.** ⌘Z gives back the text the run replaced, and removes its reply: the same step, the same exactness.
- **Ask, when built.** Apply and Suggest in the chat are your commands, so each is a step of yours.
- **Another person's agent** (`claude-bo`). It never runs in your window: only your posting starts a run, and a run writes as your agent. Its work reaches you through the file, so it is a change from outside: ⌘Z never takes it back. You reject it, as you reject Bo's own changes.
- **Your own last step.** ⌘Z never skips your step to get at the agent's, or the agent's to get at yours: it takes back whichever came last. A decision on one of the run's suggestions is a step of yours after the run, so ⌘Z takes the decision back first, then the run.

**Call:** where your own edits come between a run's edits, the run is a step per stretch, in time order, because taking a run back from under your later typing would replay text over a text it wasn't made on, the v0.1 bug. Selecting, scrolling and writing in a comment box don't change the text, so they don't split a run. Two agents named in one comment run one after the other, and each run is its own step.

**Call:** taking back or bringing back an agent's step puts the caret at the start of the first change it takes back or brings back, and scrolls it into view, as undoing your own edit puts the caret where the edit was, so that you see what went.

### Undo, Reject and Review › Undo

| | ⌘Z, Edit › Undo | Reject (Suggest runs) | Review › Undo (Auto runs, design §8.2) |
| --- | --- | --- | --- |
| Takes back | The newest step: a whole run | One suggestion, all of a run's ("Reject all", §8.3), or any by a bulk decision | An Auto run's direct edits: all of them, or one change in the Review overlay |
| When | In time order, while the document is open in this window | Any time, in any order, by whoever may decide, also after the file is reopened | While the document is open in the window that ran it, in any order |
| Leaves | Nothing: as if the run never happened, its reply gone too; ⇧⌘Z brings it back | A decision: the reply stays, and a file with full history records the `reject` (format §6) | A new step of yours, which ⌘Z takes back; the reply stays |

**Call:** Review › Undo on an Auto run is the same as ⌘Z while the run is the newest step; after that it reverts by content, as `str_replace` finds text: each change of the run whose text is still as the run left it gets its old text back, in one new step, and a change edited since stays and is named ("Kept 1 change you edited since"). This is the shape of Word's Copilot proofing pass, which ends with Keep all and Undo all and offers Undo on each suggestion. It needs no mapping through the history, so it doesn't wait for Stage 5; it is built with Auto.

### Redo

Redo puts back what Undo took back, newest undone first, byte for byte. **Call:** any new step clears Redo, an agent's too, as in every Mac app, because Redo then stays exact. A run that lands an edit after you undid something of yours takes that Redo away; that is rare, and the alternative is replaying the undone step over the agent's text. **Call:** Redo of a run brings back its edits and its reply and starts nothing, and Undo and Redo of a comment that names an agent start nothing either, as a reload, a paste or `setDoc` start nothing today (design §5.7), because only the act of posting starts a run.

### Changes from outside

**Call:** a change from outside stays: ⌘Z never takes back what another app, a person or their agent did, because the window didn't do it, the file on disk has it, and in Google Docs Undo takes back your own edits only. A tracked change from outside is rejected like any; an untracked one is the file's new text (design §7.3).

**Call:** your agent's change from outside is a step, when it is nothing but suggestions, comments and replies by agents acting for you, because Stephan's "at least MY agent" includes the Claude Code session in the next terminal window, which edits through `redlines str-replace` in your agent's name (design §6.3). The test is strict: rejecting the change's new marks and removing its new threads, with their anchors, and its new replies gives back the text the editor had, the body byte for byte and the ledger reading as it did, but for the agents' own entries in `people`. One plain character more makes it a change from outside like any other. **Call:** each such change on disk is one step, because a terminal session has no run to group by, and grouping by time would be a guess. A run in another window on the same document reaches this one as such a change, so it is a step here too.

That step can make the editor differ from the file while the terminal agent goes on working on the file. Undoing it is an unsaved edit, and the agent's next write then meets unsaved edits and gets today's notice, "This file changed on disk. Your unsaved edits are kept." Rejecting the change has the same effect, so this costs nothing that Reject doesn't.

**Other changes on disk** (git, a sync service, another app, another person's agent, an agent writing the file directly): until Stage 5, the history starts over after one that changes the text, and Undo says "Undo isn't available after the file changed on disk.", as today. From Stage 5 the history goes on across it: your steps before it stay undoable where it didn't touch them, and a step it touched is refused once, with the reason, and put away (see What Undo says).

### While a run is live

- **⌘Z during a run** takes back the newest step as always, the run's edits so far among them, and the run goes on. **Call:** Undo never has side effects beyond the text, and Stop is what stops. The agent's next tool call reads the text afresh, as it does for any concurrent edit, and an edit after the undo is a new step.
- **Taking back the comment that started a run stops the run,** with its question if it is asking, and its line goes with the thread. **Call:** a run stops when the comment or reply that started it is gone, however it went, because `read_thread` labels the person's newest comment as the request, so the agent would otherwise answer an older request in the same thread, or a thread that no longer exists. Its edits so far stay, as a step. ⇧⌘Z brings the comment back and starts nothing.
- **Stop and failures.** The edits a run finished before it stopped or failed are its step. Undoing them leaves a failure's line in place: the line is about right now, not about the text.
- **An input method composing** when the agent's edit lands: the composition stays yours. The agent's step never takes it in, and it never joins the agent's step.
- **Another document replacing this one** stops the window's runs and drops the history, as today.

### Keys, menus, views and Track Changes

- **⌘Z and ⇧⌘Z** in the document, and Edit › Undo and Redo while the document has the keyboard, act on this history. In a comment box or the find field they are the field's own, as today. After a comment is posted the keyboard goes back to the document (`view.focus()` in the rail), so ⌘Z right after posting reaches the history.
- **The Edit menu names the step** (Stage 4): "Undo Claude's Changes", "Redo Claude's Changes", "Undo Claude's Reply" for a run that only replied, and for your own steps "Undo Typing", "Undo Paste", "Undo Formatting", "Undo Replace All", "Undo Accept", "Undo Reject", "Undo Comment" and "Undo Reply". With the keyboard in a text field, or nothing to undo, it says "Undo". **Call:** because the person then knows, before pressing, whose work will go, which is the one thing new here. Mac apps commonly name the step ("Undo Typing"); Apple's Pages guide only says Edit › Undo, so that is from memory.
- **Views.** Undo and Redo work in Clean, Redlines and Raw. **Call:** the view follows today's one rule, that a document gaining redlines while shown Clean switches to Redlines (`viewModeField`), whatever brought them, a run or a Redo; Undo never switches it back, as deciding the last change doesn't (design §5.3).
- **Raw with Track Changes on** is read-only, and ⌘Z there says so, as today: "Raw is read-only while Track Changes is on. Turn Track Changes off to edit the source." Raw with Track Changes off undoes as anywhere.
- **Track Changes on or off** doesn't change Undo: it gives back text as it was and makes no mark. Undoing your own tracked insertion removes it; it doesn't record a deletion.

### What the file gets

Nothing new. In Stages 2 to 4, after any Undo or Redo, the editor's text is exactly a text it had before, the ledger and the line breaks included. **Call:** Undo is an edit of yours and waits for ⌘S like any, also after an agent's edit that was saved as it landed (design §8.6), because only the agent's own edits are saved for it, so that the file holds what the agent did; the person's ⌘Z is theirs to keep or not. Taking back a run that was saved makes the document unsaved, and ⇧⌘Z makes it saved again, since its text is then the file's.

### What Undo says

Undo speaks only when it does nothing, or something you may not expect, in the window's notice line, for a moment:

- Raw with Track Changes on: as today.
- Until Stage 5, after another change on disk: "Undo isn't available after the file changed on disk." and "Redo isn't available after the file changed on disk.", as today. The agent variants ("…after Claude's edit.") go: they can no longer happen.
- Stage 5, a step that a change from outside touched: "Undo isn't available for your last edit: Bo Chen changed that text since.", or "…: the file changed there on disk." when nobody can be named; for a comment someone answered since, "Undo isn't available for your comment: Claude has replied to it." The step is then put away, so the next ⌘Z goes on with the one before. **Call:** say it once and move on, because a ⌘Z that kept refusing would leave everything older out of reach.
- Stage 5, the first ⌘Z that reaches past a change from outside: "Undid your edit. Bo Chen's changes from disk stay.", or "Undid your edit. The change on disk stays." Once per change from outside. **Call:** because then ⌘Z takes back something of yours that may be minutes old, and the person may have expected the newer change to go.

### How Word, Google Docs and Pages do it

- **Google Docs:** Undo takes back only your own edits; a collaborator's stay, and version history is the way back past them. Redlines copies this for changes from outside.
- **Word:** after a Copilot rewrite Word offers Replace, Insert below and Regenerate, and guides undo a replaced rewrite with Ctrl+Z, as one step; Copilot's proofing pass ends with Keep all and Undo all, and Undo on each suggestion. Redlines copies the first for runs; the second is design §8.2's Review after Auto. Word saves co-authoring conflicts as tracked changes by "Microsoft Word", to accept or reject.
- **Pages:** Edit › Undo (⌘Z) and Redo (⇧⌘Z) for recent changes, and the document can be put back as it was when it opened. Redlines keeps the Mac's keys and menu items, and names the step in the menu.

## The Allow question

### What changes

The question gets its own look and its own words, at the same place: the foot of the thread that asked. Everything else about it stays: it is asked the first time an agent runs in a folder; the answer is kept for that agent and folder in the app's settings, which Preferences › Agents lists and forgets; Not Now isn't kept; and a folder that is the home folder or the disk's root runs at This document without asking.

**Call:** it stays in the thread, not in a dialog, because it is about that request, it shouldn't stop the rest of the window, and the run's status, question and failure stay in one place. **Call:** Redlines draws it as a panel no comment can look like, because text in a thread can't draw buttons, so a reply can never pass for the question.

### The question

```
╭─ the thread's note ─────────────────────╮
│ ● Ada Lovelace · 10:42                  │
│ @Claude does the importer handle CRLF?  │
│                                         │
│ ┌─ tinted panel ──────────────────────┐ │
│ │ Allow Claude to read this folder?   │ │
│ │ ~/code/redlines                     │ │
│ │ Claude reads files here to answer,  │ │
│ │ and changes only this document.     │ │
│ │ ┌─────────────────────────────────┐ │ │
│ │ │              Allow              │ │ │
│ │ └─────────────────────────────────┘ │ │
│ │ ┌─────────────────────────────────┐ │ │
│ │ │       Just This Document        │ │ │
│ │ └─────────────────────────────────┘ │ │
│ │ ┌─────────────────────────────────┐ │ │
│ │ │             Not Now             │ │ │
│ │ └─────────────────────────────────┘ │ │
│ └─────────────────────────────────────┘ │
╰─────────────────────────────────────────╯
```

- **The title:** "Allow Claude to read this folder?" **Call:** the question's verb is the button's, as in Apple's own permission questions ("Allow … to …?"), and it names the agent as the one being allowed, not the one asking.
- **The folder,** shortened from the home folder as today (`shortFolder`), with the whole path on hover.
- **What it means,** in one line: "Claude reads files here to answer, and changes only this document." **Call:** consent needs the reach and the limit: any file in the folder, hidden ones included, may go to the agent's provider, and the agent writes nowhere but this document, through the toolbox (design §8.6).
- **The answers:** Allow, Just This Document, Not Now. **Call:** title case, as Mac buttons are, and as the install window's Not Now is. **Call:** stacked and full width, because a row doesn't fit. In Carlito at 12.5 px the labels measure 29.7 px (Allow, bold), 98.8 px and 45.3 px, so with 12 px of padding each and 6 px between them a row needs about 260 px, and the panel inside a 248 px note has 206 px. The Mac stacks a narrow alert's buttons the same way.
- **For an agent that can't be kept to a folder** (an Agent Client Protocol agent, `readLimit: 'machine'`): "Allow Gemini to read files on this Mac?", then "Redlines can't keep Gemini to one folder: its own settings decide what it reads.", and Allow and Not Now. Its reach is what its own settings allow (`plugins/agent-acp`), so the question claims no limit for it.

### Behavior

- **It never takes the keyboard.** **Call:** a keystroke meant for the text must never answer it, and the person may well be typing when it appears, a moment after posting. It is answered with a click, or from the keyboard once a button has it: Tab reaches it from the thread's note, and VoiceOver users move to it.
- **Allow looks like the default:** bold, with a stronger edge. **Call:** it does what the person just asked for, and since the question never takes the keyboard, Return presses only the button that has the keyboard, so the look can't consent for anyone. **Call:** Escape on any of its buttons answers Not Now, as Escape cancels a Mac alert.
- **Answered,** the panel turns into the running line in its place, the agent's dot and "Starting…", for Allow and for Just This Document. For Not Now it goes, and the run ends with nothing said, as today.
- **Out of view** (scrolled away, the rail shrunk to dots, or the note not drawn), a notification says "Claude is waiting for your answer." with Show, which scrolls to the thread and opens its note; it goes when the question does. **Call:** a run must never wait on a question nobody can see, and a failure out of view already does this (`createLiveLines`).
- **Taken away** with the comment that asked (see While a run is live), or with the document.

### Look and accessibility

In the rail's interface font and the theme's tokens, light and dark:

```css
.rl-ask {
  margin-top: 8px;
  padding: 8px 10px 10px;
  border-radius: 6px;
  background: var(--rl-tint);
}
.rl-ask-title { font-weight: 700; color: var(--rl-ink); }  /* the rail's 13.5 px */
.rl-ask-folder, .rl-ask-note {
  color: var(--rl-ink-2);
  font-size: calc(12.5px * var(--rl-text-scale, 1));
}
.rl-ask-answers { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.rl-ask-answers button {
  min-height: calc(26px * var(--rl-text-scale, 1));
  padding: 3px 12px;
  border: 1px solid var(--rl-ink-3);
  border-radius: 6px;
  background: var(--rl-page);
  box-shadow: 0 1px 1px rgb(0 0 0 / 0.06);
  color: var(--rl-ink);
  font: inherit;
  font-size: calc(12.5px * var(--rl-text-scale, 1));
  white-space: normal;  /* labels wrap at 200% rather than overflow */
}
.rl-ask-answers .rl-ask-allow { border-color: var(--rl-ink-2); font-weight: 700; }
.rl-ask-answers button:hover { background: var(--rl-pressed); }
.rl-ask-answers button:focus-visible { outline: 2px solid var(--rl-ink-3); outline-offset: 2px; }
```

- No dot and no author color. **Call:** the dot says "this person or agent is speaking", and the question is Redlines speaking.
- Page-colored buttons with a gray edge on a tinted panel, as the Mac's push buttons sit on a gray sheet: 26 px tall at 100% (the target-size floor is 24 px), growing with the text size. The builder checks the edges by eye in all six themes, light and dark; the labels are ink on page, the document's own text contrast.
- The panel is a `role="group"` labelled by its title and described by the folder and the line under it; the buttons are `<button type="button">`, named by their visible words. VoiceOver says once, politely, when it appears, "Claude is waiting for your answer: Allow Claude to read this folder?", through a live region that is in the page before the words go in. The running line keeps `role="status"`.

## Mechanism

### Why the history starts over, and what it takes not to

CodeMirror's history (`@codemirror/commands`) stores each step as the inverse of its changes. A transaction with `addToHistory: false` isn't a step: the history maps every step through it (`addMapping`), so positions move and ranges it replaced drop out. For a Redlines file that is unsound in two ways. Every step that touched the ledger holds a whole-ledger replacement, and mapping it through another rewrite of the ledger leaves fragments of both. And in the body, an inverse mapped through someone else's change can orphan markers or bring back text whose deletion was accepted (the research's 57 in 1,000). `startOver` and `refusedStep` are today's guard.

The way out is different for the two cases:

1. **Your run, in the app.** Its edits aren't outside your history at all: they are steps in it. The app is the only writer, so the history is one line in time, and popping steps in order never maps anything. Stages 2 to 4 need no ledger merging and no mapping, only a history that can group a run's edits across time.
2. **A change from outside.** To keep your steps across it, the history must keep the ledger out of the text it maps, put the ledger back by key, and refuse a step whose text someone else changed since. That is Stage 5, the same machinery live sessions need (design §7.1).

### A history of our own (Stage 2)

**Call:** Redlines keeps its own history module, `packages/editor/src/history/`, starting from a copy of CodeMirror's (MIT, about 400 lines, with its notice), because a run's edits must join one step across seconds and across the person's clicks, and CodeMirror's history joins a transaction to the last step only within half a second of it, and never after a selection change. The copy keeps everything else as it is: events of inverted `ChangeSet`s, done and undone branches, joined typing, `minDepth` 100 (a run counts once), selection undo, mapping of `addToHistory: false` transactions; and it reads CodeMirror's own `isolateHistory` annotation and `invertedEffects` facet, so `decide`, Find and the formatting commands don't change. What it adds:

- **Steps with an owner.** An annotation, `agentStep.of({ group, agent })`, marks an agent's transaction. It joins the newest step when that step has the same `group`, whatever the time and whatever was selected since. Nothing of yours joins an agent's step, and an agent's transaction never joins one of yours: not typing, and not a composition's end, which CodeMirror otherwise joins to whatever came last (`input.type.compose`).
- **The caret for an agent's step:** its start selection is the cursor at its first change, so that undo and redo put the caret there.
- **What the step is,** for the Edit menu (Stage 4): yours by its user event (typing, paste, formatting, Replace All, accept, reject, comment, reply), an agent's by its name and by whether it changed the body or only threads.
- `undoKeymap`, the `beforeinput` handling for the Edit menu, `sayingWhy` and `refusedStep` move into the module unchanged; `startOver` stays for changes on disk until Stage 5, without its agent variants.

### An agent's edit as a step

`Editor.applyAgentEdit(next: string, step: { group: string; agent: string })` replaces `reloadDoc(next, { agent })` for agents. Like `reloadDoc`, it diffs the editor's text against `next` (`lineChanges`) and keeps the selection and the scroll where the text stayed (`followText`). Unlike it, the transaction is a step (`agentStep`), the typing filter leaves it alone (`trackedEditAnnotation`), and draft anchors and the caret follow its text as they follow a reload's (`plugins/review/src/anchors.ts` asks `isUserEvent('reload')` today). **Call:** the tools stay as they are and write whole texts, and the editor diffs them, because a diff's inverse is exact either way, and the tools then needn't know the editor's offsets, which count the file's CRLFs as one character.

Exactness has one subtle part, the file's line breaks. `reloadDoc` swaps the loaded file (`file = next`) and resets the line-break record (`next.reset`), which no history inverts. The agent's step must instead keep the loaded file, and either let the line-break record follow the change as it follows typing, or carry its reset as an effect that the history inverts through `invertedEffects`. Either way, the requirement is the test: after the step, `getDoc()` is the tool's text byte for byte, and after ⌘Z, the text before, in files with LF, CRLF and mixed line breaks.

`DocumentController.applyAgentEdit(next, step)` calls `applyAgentEdit` where it calls `reloadDoc` today; its saving (the base, the disk, writing each edit as it lands while nothing is unsaved) doesn't change. `reloadDoc` loses its `by` argument and is for changes on disk alone.

### Runs (Stage 2)

- `plugins/agents/src/runs.ts` gives each run an id when it starts (`pump`) and passes `{ group: id, agent: name }` with each write, through `RunDeps.document.applyAgentEdit`.
- `PostedComment` (`plugins/review`) carries the id of what was posted: the thread's for a new comment, the reply's for a reply. A run whose post is no longer in the ledger stops, with no line. This is checked before each tool call (`refusal`), and whenever the document changes while a run is starting, asking or running, or waiting in its thread's queue.

### Your agent's changes from outside (Stage 3)

`@redlines/format` gains `agentWorkOf(before: string, after: string, me: Handle): { agent: string } | null`. It answers with the agent's name when every difference between the two texts is new marks, threads and replies by people with `agent: true` and `for: me`, and rejecting those marks (`rejectMarks`) and removing those threads, with their anchors, and those replies from `after` gives `before`'s body byte for byte and a ledger that reads as `before`'s but for those agents' own entries in `people`; otherwise null. Several agents acting for you are named together ("Claude and Codex"). `DocumentController.#sawOnDisk`, and `markEdited` where it reloads the file, ask it before reloading, with the window's author, and call `applyAgentEdit(text, { group: \`disk-${n}\`, agent })` when it answers. It runs once per change on disk, never per keystroke.

### Naming the step (Stage 4)

`EditorUiState` gains `undo` and `redo`: the name of the step each would take ("Claude's Changes", "Typing"), or null. `apps/desktop/src/menu-model.ts` gives the Edit menu's Undo and Redo rows that text while the document has the keyboard, and "Undo" and "Redo" otherwise; `native-menu.ts` sets it on the predefined items, which keep sending `undo:` and `redo:` to the web view, so text fields keep their own undo. If Tauri's predefined items can't take a new title on macOS, the stage is dropped, not worked around: a custom item would break Undo in text fields.

### Across other changes from outside (Stage 5)

What the history needs so that a step below a change from outside can still be taken back:

- **The ledger out of the text it maps.** A step that changes the ledger region (from the ledger's blank line to `-->`) is stored in two parts: the body's inverse, a `ChangeSet` that leaves the ledger region as it was, and the ledger region's text before and after the step. Splitting costs one composition (`tr.changes` composed with putting the old ledger text back) and two string references, and only for transactions that change the ledger region, which `touchesRange` tells cheaply. A change from outside maps steps through its body part only, and positions at the body's end stay in the body.
- **The ledger put back by key.** **Call:** merged three ways, by key, because the ledger is a set of entries keyed by ids and handles, and the format already rules that keeping both sides of a ledger conflict is right (format §7.3). Undoing a step: when the ledger is still the text the step left, it gets back the text before, exactly. Otherwise it is a three-way merge, with the ledger the step left as the base, the ledger before it as ours and the ledger now as theirs (`mergeLedgers` in `@redlines/format`), written in the canonical layout (format §5.7):
  - marks follow the body: an entry for each mark the undone body has, taken from now, else from before the step;
  - people: those there now, without those the step added that nothing refers to any more;
  - threads by id, field by field: replies and likes as sets, by id and by person, in the order they have now, with the step's own put back where they were; `resolved`, `assigned`, `done`, `text`, `edited`, `quote` and `about` as three-way values, so that a step that reopened a thread by replying, undone after someone else's reply, leaves the thread resolved with the newer reply flagged, as format §4 rules for a resolve and a reply made at once;
  - a thread the step started that someone has answered since, and any value both sides changed differently, is a conflict, and the undo is refused;
  - settings, front matter changes and unknown keys as three-way values.

  The merge driver will use the same function, with conflicts kept rather than refused (format §7.4: "The same code runs in the editor").
- **Footprints.** A step is taken back only if no change from outside since touched its footprint, by the research's rules (collaboration.md, Footprints): the ranges it changed and both their ends, every mark it extended or split, every mark with a marker in or touching its ranges, and for a decision the whole mark from its first to its last marker and the block boundaries around it. A step whose footprint was touched is refused with the words above and put away; a step that a change from outside overwrote entirely is dropped when that change arrives, as CodeMirror drops it.
- **Judged before it's applied.** The undo's result is a new text, so it gets the checks a plain edit gets in `commitEdit`, without placement: no new parse warning, nothing after the ledger, every mark of anyone else byte for byte as it was, and every pending change reading the same in every decision order. Anything that fails is refused, never repaired.
- `reloadDoc` then stops starting the history over, and `startOver`, `droppedField` and `outsideField` go.

**Call:** Stage 5 can wait for live sessions, because Stages 2 and 3 answer Stephan's case, Stage 5 is the largest and riskiest piece here, and live sessions need exactly this, so it is best built and fuzzed once, for both. Until then a change on disk that isn't your agent's starts the history over, as today. **Call:** when it is built, a refusal over a touched footprint stays a refusal; the semantic undo of design §7.1, rejecting your own mark by id, is the live-session answer for a suggestion of yours someone edited inside, and comes with them.

### What a keystroke costs

Stage 2's history runs CodeMirror's algorithm plus one annotation read per transaction. Stage 3 runs once per change on disk. Stage 4 compares two short strings per report. Stage 5 adds a composition and two references per transaction that changes the ledger region: none for most keystrokes, which leave the ledger alone. The suite measures it (see Tests).

### Modules that change

| Module | Change | Stage |
| --- | --- | --- |
| `plugins/agents/src/live-line.ts` and its tests | The question's panel, words, behavior and notification | 1 |
| `packages/editor/src/history/` (new; replaces `history.ts`) | The history with owned, grouped steps | 2 |
| `packages/editor/src/index.ts`, `api.ts` | `applyAgentEdit`; `reloadDoc` for disk alone | 2 |
| `apps/desktop/src/document.ts` | `applyAgentEdit(next, step)` | 2 |
| `plugins/agents/src/runs.ts` | Run ids; a run stops when its post is gone | 2 |
| `plugins/review/src/comment-box.ts`, `rail.ts` | `PostedComment.id` | 2 |
| `packages/format` | `agentWorkOf` | 3 |
| `apps/desktop/src/document.ts` | Your agent's changes on disk as steps | 3 |
| `packages/editor` (`EditorUiState`), `apps/desktop/src/menu-model.ts`, `native-menu.ts` | The step's name in the Edit menu | 4 |
| `packages/format` (`mergeLedgers`), `packages/editor/src/history/` | The ledger split, the merge, footprints, judging | 5 |

`packages/agent-tools`, the providers and the `redlines` program don't change.

## Changes to design.md and format.md

**design.md**, in the stage that ships each:

- **A new §5.13 Undo** (Stage 2, grown in Stages 3 to 5): "Undo goes back in time through what this window did: your edits, decisions, comments and replies, and the runs of your agents (§8). ⌘Z takes back the newest step and ⇧⌘Z puts it back; the history lasts while the document is open. A run is one step, its suggestions or direct edits, its comments and its reply, so one ⌘Z after a run gives the document back as it was; where your own edits came between its edits, each stretch is a step, in time order. Your agent's changes from outside, made through the `redlines` command line in its name, are a step each when they are nothing but its suggestions, comments and replies. What other apps, people and their agents did stays: ⌘Z never takes it back, and a tracked change of theirs is rejected like any. Undo makes no mark, with Track Changes on or off, and waits for ⌘S like any edit. The Edit menu says what it takes back (Undo Claude's Changes)." When Stage 5 ships: "Your steps from before a change on disk stay undoable where it didn't change them; one it changed is refused once, with the reason."
- **§5.7, the live line** (Stage 1): "The first time an agent runs in a folder, Redlines asks in the thread, in a panel of its own: 'Allow Claude to read this folder?', with the folder, a line on what that means, and three buttons, Allow, Just This Document and Not Now. It never takes the keyboard, and a notification says when it waits out of view." **§5.7, Only posting starts a run** (Stage 2): add Undo and Redo to what starts nothing, and that a run stops when the comment that started it goes.
- **§8.2:** Auto's row and Review after Auto: Review › Undo is ⌘Z while the run is the newest step, and afterwards reverts the run's changes that nobody edited since, as a step of yours.
- **§8.4:** "Stop removes the unfinished edit and keeps the finished ones", which one ⌘Z takes back.
- **§8.6, Scope:** the first run "asks in its thread (§5.7)", in place of "on its live line". **Where the work happens:** an Undo is the person's edit, and isn't saved for them.
- **§7.1:** "Undo is semantic: it rejects your own mark rather than inverting text" becomes "Undo takes back your own steps (§5.13). A remote change stays, and a step it touched is refused, or, for a suggestion of yours someone edited inside, rejected by its id."
- **§7.3:** "A change from outside isn't undone by ⌘Z (§5.13)."

**format.md:**

- **§6.2** (Stage 2): "One event per editor command, grouped the way undo steps are" gains "except that an agent's run, one step to undo, stays an event per edit, each `str_replace`, `comment` and `reply` its own." Full history isn't written yet; this keeps a run from becoming one event of mixed operations when it is.
- **§7.4** (Stage 5): the three-way ledger merge's rules, as listed under Mechanism, as the merge driver's and the editor's: marks follow the body; people; threads field by field; values three ways; conflicts kept by the driver and refused by Undo.

## Tests: the undo suite

Each script runs on the welcome document (`apps/desktop/src/sample.md`) unless it says otherwise, in an editor with the review interface, the `DocumentController` over files in memory, runs driven by the fake relay through the real toolbox (`plugins/agents/src/fake-provider.ts`), changes on disk made by the real `redlines` commands, and keys pressed as `keydown` events and as the Edit menu's `beforeinput`. "Exactly" means the file's bytes. End-to-end scripts go in `apps/desktop/src/undo-agents.node.test.ts`; the history's own cases in `packages/editor/src/history/`; the classifier and the merge in `packages/format`.

**Stage 1, the question.**

1. A first run in a folder shows the panel: title, folder, line, and three `<button>`s named Allow, Just This Document and Not Now, in that order, in a `role="group"` labelled by the title; no `rl-live-line-dot` and no author class in it.
2. The keyboard stays where it was when the question appears, in the document and in a comment box.
3. Tab reaches the buttons; Return and Space on a button answer it; Escape on one answers Not Now.
4. Allow and Just This Document turn the panel into the running line in the same element; Not Now leaves no line and remembers nothing; Allow and Just This Document are remembered, as today.
5. The machine variant: its title, its line, two buttons.
6. Out of view: a notification "Claude is waiting for your answer." with Show; Show scrolls the thread into view and opens its note in a compact rail; the notification goes when the question does.
7. At 200% text the buttons wrap their labels inside the note, and nothing overflows the rail.
8. VoiceOver's announcement is made once.

**Stage 2, a run is a step.**

1. A Suggest run of one `str_replace` and a reply: ⌘Z gives the file exactly as before the run, ⇧⌘Z exactly as after; Edit › Undo and Redo the same.
2. A run of three `str_replace`s, a `comment` and a `reply`: one ⌘Z takes all of it back.
3. A run that only replies: ⌘Z takes back the reply, the next ⌘Z your comment.
4. Typing before the run: ⌘Z takes back the run, then the typing.
5. Typing between a run's edits: ⌘Z takes back the stretch after the typing, then the typing, then the stretch before, each exactly.
6. Clicks and selections during a run, and writing in a comment box: still one step.
7. Two agents named in one comment: two steps, the second agent's first.
8. Stopped after two edits: they are one step. Failed after an edit: ⌘Z takes it back, and the failure's line stays.
9. ⌘Z during a run takes back its edits so far; the run's next edit is a new step; Redo is cleared.
10. ⌘Z right after posting, before the run's first edit: the comment goes and the run stops, with no tool call acting after it; the same while the question is up, and for a reply that started a run in an older thread, which must not answer the older request. ⇧⌘Z brings the comment back and starts nothing.
11. Redo of a run starts nothing; Undo and Redo of a comment naming @Claude start nothing.
12. Accepting one of the run's suggestions, then ⌘Z twice: the decision, then the run.
13. Typing inside the run's suggestion, which splits it (format §3.10), then ⌘Z until nothing is left: every text on the way is one the file had.
14. An input method's composition while the agent's edit lands: the composition is a step of yours, apart from the agent's.
15. A run saved as it landed, then ⌘Z: unsaved; ⌘S writes the text from before the run; ⇧⌘Z: saved again.
16. A CRLF file, a file with mixed line breaks, and a hand-written ledger in a non-canonical order: run, ⌘Z and ⇧⌘Z, exactly.
17. Raw with Track Changes on: ⌘Z refused with Raw's words. Raw with it off: ⌘Z takes back the run.
18. In Clean, the run's suggestions switch the view to Redlines; ⌘Z leaves it in Redlines.
19. A change on disk by another app still starts the history over, with today's words; nothing ever says "after Claude's edit".
20. Random: interleavings of tracked and untracked typing, decisions, comments, replies and runs through the real tools, then ⌘Z to the start and ⇧⌘Z to the end. At every step the file is byte for byte the text it had at that point, with no new parse warning (`REDLINES_FUZZ` for longer runs).
21. Cost: 1,000 keystrokes on the long document of `preview/long-document.test.ts` (about 6,000 words and 240 marks), with Track Changes on and off, on main and on the branch: the same within the measurement's noise.

**Stage 3, your agent from outside.** The desktop test `undo-after-reload.node.test.ts` changes its expectation: Claude acting for Ada is Ada's agent, so ⌘Z now takes its change back.

1. `redlines reply|str-replace|comment … --as claude-ada --for ada` on the file: ⌘Z gives back the text from before it, exactly; the file still has the change until ⌘S.
2. The same with `--as claude-bo --for bo`: not a step; the history starts over (until Stage 5).
3. A change by Claude for Ada with one plain character more elsewhere: not a step.
4. Three commands in a row: three steps.
5. `agentWorkOf`: suggestions, comments and replies alone, by one or two agents for you, are named; anything else gives null; so does a change whose marks, rejected, wouldn't give back the body byte for byte.

**Stage 4, the names.** Edit › Undo says "Undo Claude's Changes" after a run, "Undo Claude's Reply" after a run that only replied, "Undo Typing" after typing, and "Undo" with the keyboard in a comment box or with nothing to undo; Redo likewise.

**Stage 5, across other changes from outside.**

1. Your tracked insertion, then Bo's suggestion elsewhere, from disk: ⌘Z takes back your insertion and its entry; Bo's suggestion and its entry stay byte for byte; no warning.
2. The same when your insertion was the document's first change, which created the ledger: the ledger stays, with Bo's entries.
3. Your reply, then `claude-bo`'s reply to the same thread, from disk: ⌘Z takes back yours, and theirs stays.
4. Your reply that reopened a resolved thread, then another reply from disk: ⌘Z leaves the thread resolved and the newer reply flagged.
5. Your new comment, then a reply to it from disk: refused ("Undo isn't available for your comment: …"); the next ⌘Z takes back the step before it.
6. Your untracked edit in a paragraph the change on disk rewrote: dropped. Partly rewrote: refused with the reason, then put away.
7. Your tracked insertion with Bo's deletion inside it, from disk: refused, naming Bo Chen.
8. Your accept of Bo's insertion, then a comment elsewhere from disk: ⌘Z brings back the insertion, its markers and its entry, and the comment stays.
9. Redo after each of these; and an undo whose result would read differently in some decision order: refused.
10. The hint after the first ⌘Z past a change from disk, once.
11. A change on disk that replaces the whole file, as another branch checked out does: the steps it overwrote dropped, and nothing corrupt.
12. Random: steps of yours, the real commands on the file as changes from outside, plain text changes, ⌘Z and ⇧⌘Z. Never a new warning, never text after the ledger, every mark of anyone else byte for byte, every result reading the same in every decision order with micromark as the oracle, and the ledger the merge driver would write for the same three ledgers.
13. `mergeLedgers`, a case for each rule.
14. Cost: as Stage 2's, with the split.

## Stages

Each ships alone and is worth having alone.

| Stage | What ships | Size |
| --- | --- | --- |
| **1. The Allow question** | The panel, its words, its keyboard and VoiceOver behavior, the notification out of view; design §5.7. Closes #187 | Small: one plugin file and its tests |
| **2. A run is a step** | The history module, `applyAgentEdit`, run ids, a run stopping when its post goes; design §5.13 and §5.7, format §6.2. Closes #186 for runs in the app | Medium |
| **3. Your agent from outside** | `agentWorkOf` and the controller's use of it | Small |
| **4. The Edit menu names the step** | Undo and Redo titles that follow the history | Small, if Tauri allows it |
| **5. Undo across other changes from outside** | The ledger split, `mergeLedgers`, footprints, judging, the refusals and the hint; format §7.4 | Large; with live sessions |

Stages 1 and 2 can be built at once, in separate worktrees: they touch different files. Review › Undo for Auto runs comes with the Auto level.

## Calls most worth Stephan's look

1. **One ⌘Z takes back the whole run, its reply included,** rather than its edits alone, so that the thread never keeps an answer about edits that are gone.
2. **Your agent's changes from the command line are undoable with ⌘Z too,** when they are nothing but its suggestions, comments and replies, at the cost that undoing one makes the window differ from the file the terminal agent may still be working on, as rejecting it does.
3. **Undo keeps time order:** if you type while a run works, the run comes back off in stretches around your typing, rather than as one step taken out from under it.
4. **The question stays in the thread, as a panel with stacked buttons, Allow looking like the default, and never takes the keyboard,** rather than a dialog, or three equal buttons.
5. **Stage 5 waits for live sessions,** so that until then a change on disk that isn't your agent's still starts the history over, as today.

## Left to the builder

- The panel's exact spacing and the buttons' edges, by eye in every theme, light and dark, within the tokens above.
- How the line-break record follows an agent's step (following the change, or a reset the history inverts), as long as the bytes come out exact.
- Whether Tauri's predefined Undo and Redo items take a new title on macOS; if not, Stage 4 is dropped.
- The run id's form, and where the check for a run's post lives.

## Sources

Checked Nov 10, 2026.

- **Google Docs:** [6 fast fixes for common Google Docs problems](https://www.computerworld.com/article/3616678/6-fast-fixes-for-common-google-docs-problems.html) (Undo only for your own edits); [New features for Google Drive Realtime](https://gsuite-developers.googleblog.com/2013/04/new-features-for-google-drive-realtime.html) (undo of local changes only)
- **Word:** [Rewrite text with Copilot in Word](https://support.microsoft.com/en-US/word/copilot/rewrite-text-with-copilot-in-word); [Fix spelling and grammar faster with Copilot in Word](https://techcommunity.microsoft.com/t5/microsoft-365-insider-blog/fix-spelling-and-grammar-faster-with-microsoft-365-copilot-in/ba-p/4450625) (Keep all, Undo all, Undo per suggestion); [Troubleshoot common coauthoring errors](https://support.microsoft.com/en-us/word/troubleshoot-common-coauthoring-errors) (conflicts saved as tracked changes)
- **Pages:** [Undo or redo changes in Pages on Mac](https://support.apple.com/guide/pages/tana7e101d4c/mac)
