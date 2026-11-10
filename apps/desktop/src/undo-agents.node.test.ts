// @vitest-environment happy-dom
// Undo and Redo of your agent's runs, end to end: the welcome document in a window as the app
// makes it, runs of fake agents through the real toolbox, and ⌘Z and ⇧⌘Z as keys and as the Edit
// menu's input events. "Exactly" is the file's bytes: `getDoc()` against the text recorded then.
// (docs/superpowers/specs/2026-11-10-agents-undo-and-allow-design.md, Tests, Stage 2.)

import { redoDepth } from '@redlines/editor';
import { newestView, parse } from '@redlines/format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sample from './sample.md?raw';
import {
  comment,
  field,
  gate,
  openWindow,
  PATH,
  replace,
  reply,
  script,
  settle,
  type Window,
  write,
} from './undo-harness.ts';

const UNDO_AFTER_RELOAD = 'Undo isn’t available after the file changed on disk.';
const RAW_READ_ONLY =
  'Raw is read-only while Track Changes is on. Turn Track Changes off to edit the source.';

const windows: Window[] = [];
afterEach(() => {
  for (const window of windows.splice(0)) window.editor.destroy();
  document.body.replaceChildren();
});

async function open(doc = sample): Promise<Window> {
  const window = await openWindow(doc);
  windows.push(window);
  return window;
}

/** Posts `text` on `word` and waits for its runs to end; returns the text just after posting. */
async function ask(w: Window, text: string, word = 'Try it'): Promise<string> {
  w.post(word, text);
  const posted = w.editor.getDoc();
  await w.runsEnd();
  return posted;
}

/** Where `text` is in the editor's document. */
const at = (w: Window, text: string) => {
  const found = w.editor.view.state.doc.toString().indexOf(text);
  expect(found).toBeGreaterThanOrEqual(0);
  return found;
};

describe('undo of a run', () => {
  it('takes back a run of one suggestion and a reply with one ⌘Z, and brings it back with ⇧⌘Z, exactly; Edit › Undo and Redo the same', async () => {
    const w = await open();
    w.claude.script = script([replace('Try it', 'Try it now'), reply('Added now.')]);
    const posted = await ask(w, '@Claude make it urgent');
    const after = w.editor.getDoc();
    expect(after).not.toBe(posted);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
    w.redoKey();
    expect(w.editor.getDoc()).toBe(after);
    w.menuUndo();
    expect(w.editor.getDoc()).toBe(posted);
    w.menuRedo();
    expect(w.editor.getDoc()).toBe(after);
  });

  it('takes back three suggestions, a comment on other text and a reply with one ⌘Z', async () => {
    const w = await open();
    w.claude.script = script([
      replace('Try it', 'Try it now'),
      replace('Open this document.', 'Open this file.'),
      replace('then type.', 'then start typing.'),
      comment('From the command line', 'Is this heading right?'),
      reply('Three edits and a question.'),
    ]);
    const posted = await ask(w, '@Claude tidy this');
    expect(parse(w.editor.getDoc()).ledger.comments).toHaveLength(3);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
  });

  it('takes back a run that only replied, then your comment', async () => {
    const w = await open();
    w.claude.script = script([reply('Looks right.')]);
    const posted = await ask(w, '@Claude is this right?');
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(sample);
  });

  it('takes back the run, then your typing before it', async () => {
    const w = await open();
    w.type(at(w, 'Press '), 'Then ');
    const typed = w.editor.getDoc();
    w.claude.script = script([replace('Try it', 'Try it now'), reply('Done.')]);
    const posted = await ask(w, '@Claude go');
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(typed);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(sample);
  });

  it('takes back a run around your typing in stretches, newest first, each exactly', async () => {
    const w = await open();
    const go = gate();
    w.claude.script = script([replace('Try it', 'Try it now')], go.opened, [
      replace('then type.', 'then start typing.'),
      reply('Two edits.'),
    ]);
    w.post('Try it', '@Claude go');
    const posted = w.editor.getDoc();
    await waitFor(() => w.editor.getDoc() !== posted);
    const first = w.editor.getDoc();
    w.type(at(w, 'Press '), 'Then ');
    const typed = w.editor.getDoc();
    go.open();
    await w.runsEnd();
    w.undoKey();
    expect(w.editor.getDoc()).toBe(typed);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(first);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
  });

  it('keeps a run one step through clicks, selections and writing in a comment box', async () => {
    const w = await open();
    const go = gate();
    w.claude.script = script([replace('Try it', 'Try it now')], go.opened, [
      replace('then type.', 'then start typing.'),
      reply('Two edits.'),
    ]);
    w.post('Try it', '@Claude go');
    const posted = w.editor.getDoc();
    await waitFor(() => w.editor.getDoc() !== posted);
    w.editor.view.dispatch({ selection: { anchor: 3 }, userEvent: 'select.pointer' });
    const from = at(w, 'Enter twice');
    w.editor.view.dispatch({ selection: { anchor: from, head: from + 5 }, userEvent: 'select' });
    expect(w.review.startComment()).toBe(true);
    write(field(w.editor)!, 'Not yet');
    go.open();
    await w.runsEnd();
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
  });

  it('makes two agents named in one comment two steps, the second’s first', async () => {
    const w = await open();
    w.claude.script = script([replace('Try it', 'Try it now'), reply('Claude here.')]);
    w.codex.script = script([replace('then type.', 'then start typing.'), reply('Codex here.')]);
    w.post('Try it', '@Claude @Codex both of you');
    const posted = w.editor.getDoc();
    await w.runsEnd();
    // The text when Claude's run was done, before Codex's first edit.
    const claudes = w.texts.findLast(
      (text) => text.includes('Claude here.') && !reads(text).includes('start typing'),
    )!;
    expect(claudes).toBeDefined();
    w.undoKey();
    expect(w.editor.getDoc()).toBe(claudes);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
  });

  it('makes a stopped run’s edits one step, and leaves a failed run’s line when its edit is taken back', async () => {
    const w = await open();
    w.claude.script = script(
      [replace('Try it', 'Try it now'), replace('then type.', 'then start typing.')],
      gate().opened,
    );
    const thread = w.post('Try it', '@Claude go');
    const posted = w.editor.getDoc();
    await waitFor(() => w.editor.getDoc().includes('start typing'));
    w.runs.stop(thread);
    await w.runsEnd();
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);

    const v = await open();
    v.claude.script = script([replace('Try it', 'Try it now')], {
      type: 'error',
      message: 'Something broke.',
    });
    const failed = v.post('Try it', '@Claude go');
    const before = v.editor.getDoc();
    await v.runsEnd();
    expect(v.runs.line(failed)).toMatchObject({ kind: 'failed' });
    v.undoKey();
    expect(v.editor.getDoc()).toBe(before);
    expect(v.runs.line(failed)).toMatchObject({ kind: 'failed', message: 'Something broke.' });
  });

  it('takes back a run’s edits so far while it runs; its next edit is a new step, and Redo is cleared', async () => {
    const w = await open();
    const go = gate();
    w.claude.script = script([replace('Try it', 'Try it now')], go.opened, [
      replace('then type.', 'then start typing.'),
      reply('Done.'),
    ]);
    w.post('Try it', '@Claude go');
    const posted = w.editor.getDoc();
    await waitFor(() => w.editor.getDoc() !== posted);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
    expect(w.runs.isLive()).toBe(true);
    go.open();
    await w.runsEnd();
    const after = w.editor.getDoc();
    expect(after).toContain('start typing');
    expect(reads(after)).not.toContain('Try it now');
    expect(redoDepth(w.editor.view.state)).toBe(0);
    w.redoKey();
    expect(w.editor.getDoc()).toBe(after);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(sample);
  });

  it('stops the run when ⌘Z takes back the comment that started it, and ⇧⌘Z starts nothing', async () => {
    const w = await open();
    const go = gate();
    const answers = script(go.opened, [replace('Try it', 'Try it now'), reply('Late.')]);
    w.claude.script = answers;
    const thread = w.post('Try it', '@Claude go');
    const posted = w.editor.getDoc();
    await waitFor(() => w.claude.requests.length === 1);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(sample);
    await settle();
    expect(w.runs.line(thread)).toBeNull();
    expect(w.runs.isLive()).toBe(false);
    go.open();
    await settle();
    expect(answers.answers.every((answer) => answer.isError)).toBe(true);
    expect(w.editor.getDoc()).toBe(sample);
    w.redoKey();
    expect(w.editor.getDoc()).toBe(posted);
    await settle();
    expect(w.claude.requests).toHaveLength(1);
    expect(w.runs.isLive()).toBe(false);
  });

  it('starts nothing on Redo of a run, or on Undo and Redo of a comment naming @Claude', async () => {
    const w = await open();
    w.claude.script = script([replace('Try it', 'Try it now'), reply('Done.')]);
    await ask(w, '@Claude go');
    expect(w.claude.requests).toHaveLength(1);
    w.undoKey();
    w.redoKey();
    await settle();
    w.undoKey();
    w.undoKey();
    w.redoKey();
    await settle();
    w.redoKey();
    await settle();
    expect(w.claude.requests).toHaveLength(1);
    expect(w.runs.isLive()).toBe(false);
  });

  it('takes back your decision on the run’s suggestion, then the run', async () => {
    const w = await open();
    w.claude.script = script([replace('Try it', 'Try it now'), reply('Done.')]);
    const posted = await ask(w, '@Claude go');
    const after = w.editor.getDoc();
    const mark = w.editor
      .getParsed()
      .marks.find((m) => m.entry.by === 'claude-ada' && m.id !== 'p7qd')!;
    w.editor.accept(mark.id);
    expect(w.editor.getDoc()).not.toBe(after);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(after);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
  });

  it('passes only through texts the file had when your typing split the run’s suggestion', async () => {
    const w = await open();
    w.claude.script = script([replace('Try it', 'Try it right now'), reply('Done.')]);
    await ask(w, '@Claude go');
    w.editor.setTracking(true);
    w.type(at(w, 'right now') + 'right'.length, ' here');
    expect(parse(w.editor.getDoc()).warnings).toEqual([]);
    expectWalkBack(w);
  });

  it('makes a saved run unsaved when it is taken back: ⌘S writes the text before it, or ⇧⌘Z makes it saved again', async () => {
    for (const branch of ['save', 'redo'] as const) {
      const w = await open();
      w.claude.script = script([replace('Try it', 'Try it now'), reply('Done.')]);
      const posted = await ask(w, '@Claude go');
      const after = w.editor.getDoc();
      expect(w.files.get(PATH)).toBe(after);
      expect(w.controller.state.dirty).toBe(false);
      w.undoKey();
      expect(w.controller.state.dirty).toBe(true);
      expect(w.files.get(PATH)).toBe(after);
      if (branch === 'save') {
        expect(await w.controller.save()).toBe(true);
        expect(w.files.get(PATH)).toBe(posted);
      } else {
        w.redoKey();
        expect(w.controller.state.dirty).toBe(false);
      }
      expect(w.overwriteAsked()).toBe(0);
    }
  });

  it('is exact in a CRLF file, a mixed one and one with a hand-written ledger out of order', async () => {
    const crlf = sample.replace(/\n/g, '\r\n');
    const lines = sample.split('\n');
    const mixed = lines.slice(0, 8).join('\r\n') + '\r\n' + lines.slice(8).join('\n');
    const handWritten = ledgerOutOfOrder(sample);
    expect(parse(handWritten).warnings).toEqual([]);
    for (const file of [crlf, mixed, handWritten]) {
      const w = await open(file);
      w.claude.script = script([replace('Try it', 'Try it now'), reply('Done.')]);
      const posted = await ask(w, '@Claude go');
      const after = w.editor.getDoc();
      w.undoKey();
      expect(w.editor.getDoc()).toBe(posted);
      w.redoKey();
      expect(w.editor.getDoc()).toBe(after);
      w.undoKey();
      w.undoKey();
      expect(w.editor.getDoc()).toBe(file);
    }
    // Your own undo of a deletion across a line break of the other style, in the mixed file.
    const w = await open(mixed);
    const end = w.editor.view.state.doc.line(8).to;
    w.editor.view.dispatch({ changes: { from: end - 2, to: end + 1 }, userEvent: 'delete' });
    expect(w.editor.getDoc()).not.toBe(mixed);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(mixed);
  });

  it('refuses ⌘Z in Raw with Track Changes on, in Raw’s words, and takes the run back with it off', async () => {
    const w = await open();
    w.claude.script = script([replace('Try it', 'Try it now'), reply('Done.')]);
    const posted = await ask(w, '@Claude go');
    const after = w.editor.getDoc();
    w.editor.setViewMode('raw');
    w.editor.setTracking(true);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(after);
    expect(w.notices.at(-1)).toBe(RAW_READ_ONLY);
    w.editor.setTracking(false);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
  });

  it('leaves Clean as it is through a run and its ⌘Z and ⇧⌘Z, and selects the thread’s note after ⌘Z of a reply-only run', async () => {
    const w = await open();
    w.editor.setViewMode('clean');
    // In Clean there are no notes to post in: the post is made in Redlines, and the view put back.
    w.editor.setViewMode('redlines');
    const thread = w.post('Try it', '@Claude go');
    w.editor.setViewMode('clean');
    w.claude.script = script([replace('Try it', 'Try it now'), reply('Done.')]);
    await w.runsEnd();
    expect(w.editor.getUiState().view).toBe('clean');
    w.undoKey();
    expect(w.editor.getUiState().view).toBe('clean');
    w.redoKey();
    expect(w.editor.getUiState().view).toBe('clean');
    expect(thread).toBeTruthy();

    // A run that only replied, in Redlines: ⌘Z puts the caret in the thread's anchor, and selects
    // its note.
    const v = await open();
    v.claude.script = script([reply('Yes.')]);
    const asked = v.post('Try it', '@Claude is this right?');
    await v.runsEnd();
    v.editor.view.dispatch({ selection: { anchor: 0 } });
    v.undoKey();
    const mark = v.editor.getParsed().marks.find((m) => m.id === asked)!;
    expect(v.editor.view.state.selection.main.head).toBe(mark.segments[0]!.content.from);
    await settle();
    const selected = v.editor.view.dom.querySelector('.rl-note-selected');
    expect(selected?.textContent).toContain('@Claude is this right?');
  });

  it('still starts over after another app’s change on disk, in today’s words, never “after Claude’s edit”', async () => {
    const w = await open();
    w.claude.script = script([replace('Try it', 'Try it now'), reply('Done.')]);
    await ask(w, '@Claude go');
    const theirs = w.editor.getDoc().replace('# Welcome to Redlines', '# Welcome');
    await w.changeOnDisk(theirs);
    expect(w.editor.getDoc()).toBe(theirs);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(theirs);
    expect(w.notices).toEqual([UNDO_AFTER_RELOAD]);
    expect(w.notices.some((notice) => notice.includes('Claude’s edit'))).toBe(false);
  });

  it('keeps a ⌘Z of the run’s edit that is still being written: no reload over it, and ⌘S writes the undone text without asking', async () => {
    const w = await open();
    const go = gate();
    const then = gate();
    w.claude.script = script(go.opened, [replace('Try it', 'Try it now')], then.opened, [
      reply('Done.'),
    ]);
    const thread = w.post('Try it', '@Claude go');
    const posted = w.editor.getDoc();
    await waitFor(() => w.files.get(PATH) === posted);
    const release = w.holdWrites();
    go.open();
    await waitFor(() => reads(w.editor.getDoc()).includes('Try it now'));
    expect(w.files.get(PATH)).toBe(posted);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(posted);
    release();
    await settle();
    // The run's edit is on disk now, and the watcher's echo of it reloads nothing.
    expect(reads(w.files.get(PATH)!)).toContain('Try it now');
    await w.changeOnDisk(w.files.get(PATH)!);
    expect(w.editor.getDoc()).toBe(posted);
    expect(w.controller.state.dirty).toBe(true);
    expect(await w.controller.save()).toBe(true);
    expect(w.files.get(PATH)).toBe(posted);
    expect(w.overwriteAsked()).toBe(0);
    then.open();
    await w.runsEnd();
    expect(w.runs.line(thread)).toBeNull();
  });

  it('starts over after another app’s change during a run, and takes back the run’s next edit exactly', async () => {
    const w = await open();
    const go = gate();
    w.claude.script = script([replace('Try it', 'Try it now')], go.opened, [
      replace('then type.', 'then start typing.'),
      reply('Done.'),
    ]);
    w.post('Try it', '@Claude go');
    const posted = w.editor.getDoc();
    await waitFor(() => w.editor.getDoc() !== posted);
    await settle();
    const theirs = w.editor.getDoc().replace('# Welcome to Redlines', '# Welcome');
    await w.changeOnDisk(theirs);
    expect(w.editor.getDoc()).toBe(theirs);
    w.undoKey();
    expect(w.notices).toEqual([UNDO_AFTER_RELOAD]);
    expect(w.runs.isLive()).toBe(true);
    go.open();
    await w.runsEnd();
    expect(w.editor.getDoc()).toContain('start typing');
    w.undoKey();
    expect(w.editor.getDoc()).toBe(theirs);
  });
});

describe('a run stopped by an undo', () => {
  it('stops a run from inside the editor’s update, with its live line drawn in the thread', async () => {
    const w = await open();
    const go = gate();
    w.claude.script = script(go.opened, [reply('Late.')]);
    w.post('Try it', '@Claude @Codex look');
    const posted = w.editor.getDoc();
    await waitFor(() => w.claude.requests.length === 1);
    await settle();
    expect(w.editor.view.dom.querySelector('.rl-live-line-running')).not.toBeNull();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // The undo's update tells the runs, which stop the run and draw its thread again from
      // inside it.
      w.undoKey();
      expect(w.runs.isLive()).toBe(false);
      expect(w.editor.view.dom.querySelector('.rl-live-line')).toBeNull();
      go.open();
      await settle();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
    expect(w.codex.requests).toHaveLength(0);
    w.redoKey();
    expect(w.editor.getDoc()).toBe(posted);
    await settle();
    expect(w.claude.requests).toHaveLength(1);
    expect(w.codex.requests).toHaveLength(0);
  });
});

/** The text as it reads with every pending change made. */
const reads = (text: string) => newestView(text).text;

/** Waits until `done` holds, as the run's promises and timers go on. */
async function waitFor(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Waited too long');
}

/**
 * ⌘Z until nothing is left: every text on the way is one the window had, each older than the one
 * before, the last the one it opened with.
 */
function expectWalkBack(w: Window): void {
  let index = w.texts.lastIndexOf(w.editor.getDoc());
  expect(index).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < 100; i++) {
    const before = w.editor.getDoc();
    w.undoKey();
    const now = w.editor.getDoc();
    if (now === before) break;
    const found = w.texts.lastIndexOf(now, index - 1);
    expect(found, 'an undo gave a text the file never had').toBeGreaterThanOrEqual(0);
    index = found;
  }
  expect(w.editor.getDoc()).toBe(w.texts[0]);
}

/** The welcome document's ledger with its comments listed before its marks. */
function ledgerOutOfOrder(text: string): string {
  const marks = /\nmarks:\n(?: {2}.*\n)+/.exec(text)![0];
  const comments = /\ncomments:\n(?: {2,}.*\n)+/.exec(text)![0];
  return text.replace(marks, '\n').replace(comments, comments + marks.slice(1));
}
