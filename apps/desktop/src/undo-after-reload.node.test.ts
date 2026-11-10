// @vitest-environment happy-dom
// Undo after an agent changed the open file from the command line (design: Changes from outside,
// and Tests › Stage 3). The real `redlines` commands write the file, and the watcher fires. A change
// that is nothing but the work of Ada's agents, Claude for Ada among them, is a step that ⌘Z takes
// back exactly, while the file keeps it until ⌘S. Any other change starts the history over, as
// before: what was done before it can't be undone over it, and the file stays sound.

import { parse, resolve, applyChanges, reviewView, type Parsed } from '@redlines/format';
import { run, type CliIo } from 'redlines';
import { afterEach, describe, expect, it } from 'vitest';
import { CHANGED_ON_DISK } from './document.ts';
import sample from './sample.md?raw';
import { ada, openWindow, PATH, settle, type Window } from './undo-harness.ts';

const UNDO_AFTER_RELOAD = 'Undo isn’t available after the file changed on disk.';
const CLAUDE_ADA = ['--as', 'claude-ada', '--name', 'Claude', '--for', 'ada'];
const CLAUDE_BO = ['--as', 'claude-bo', '--name', 'Claude', '--for', 'bo'];

const windows: Window[] = [];
afterEach(() => {
  for (const window of windows.splice(0)) window.editor.destroy();
  document.body.replaceChildren();
});

/** The welcome document, open in a window as the app has it. */
async function open(doc = sample) {
  const w = await openWindow(doc);
  windows.push(w);

  /** An agent runs a command on the file, as `agent` says; the watcher hasn't fired yet. */
  const command = async (agent: string[], ...args: string[]) => {
    let stderr = '';
    const io: CliIo = {
      readFile: (path) => Promise.resolve(w.files.get(path) ?? ''),
      writeFile: (path, text) => Promise.resolve(void w.files.set(path, text)),
      stdout: () => {},
      stderr: (s) => (stderr += s),
      now: () => new Date('2026-11-01T10:05:00Z'),
      realpath: (path) => Promise.resolve(path),
      modeOf: () => Promise.resolve(0o644),
      canWrite: () => Promise.resolve(true),
      rename: (from, to) => {
        w.files.set(to, w.files.get(from) ?? '');
        w.files.delete(from);
        return Promise.resolve();
      },
      remove: (path) => Promise.resolve(void w.files.delete(path)),
      readStdin: () => Promise.resolve(''),
      randomHex: (n) => 'ab'.repeat(n),
    };
    const [name = '', ...rest] = args;
    expect(await run([name, PATH, ...rest, ...agent], io), stderr).toBe(0);
    return w.files.get(PATH)!;
  };
  /** An agent runs a command on the file, and the watcher fires. */
  const runs = async (agent: string[], ...args: string[]) => {
    const written = await command(agent, ...args);
    await w.changeOnDisk(written);
    return written;
  };
  /** Claude for Ada runs a command, and the window takes the file. */
  const claudeRuns = async (...args: string[]) => {
    const theirs = await runs(CLAUDE_ADA, ...args);
    expect(w.editor.getDoc()).toBe(theirs);
    expect(w.controller.state.dirty).toBe(false);
    return theirs;
  };

  return { w, command, runs, claudeRuns };
}

/** The file is sound: no warnings, and nothing after the ledger. */
function expectSound(text: string): Parsed {
  const parsed = parse(text);
  expect(parsed.warnings).toEqual([]);
  expect(text.slice(text.lastIndexOf('-->') + 3).trim()).toBe('');
  return parsed;
}

/** ⌘Z gives back `before` exactly, unsaved, while the file keeps `theirs`; ⇧⌘Z brings it back,
 * saved again; ⌘Z once more, and ⌘S writes `before`. */
async function expectTakenBack(w: Window, before: string, theirs: string) {
  w.undoKey();
  expect(w.editor.getDoc()).toBe(before);
  expect(w.controller.state.dirty).toBe(true);
  expect(w.files.get(PATH)).toBe(theirs);
  w.redoKey();
  expect(w.editor.getDoc()).toBe(theirs);
  expect(w.controller.state.dirty).toBe(false);
  w.undoKey();
  expect(await w.controller.save()).toBe(true);
  expect(w.files.get(PATH)).toBe(before);
  expect(w.overwriteAsked()).toBe(0);
  expect(w.notices).toEqual([]);
  expectSound(before);
}

describe('undo after your agent changed the file from the command line', () => {
  it('takes back Claude’s reply from the command line with ⌘Z, exactly, and the file keeps it until ⌘S', async () => {
    const { w, claudeRuns } = await open();
    const before = w.editor.getDoc();
    const theirs = await claudeRuns('reply', 'c8d2', '--text', 'Thanks, Ada.');
    const thread = expectSound(theirs).ledger.comments.find(({ id }) => id === 'c8d2');
    expect(thread?.replies.at(-1)).toMatchObject({ by: 'claude-ada', text: 'Thanks, Ada.' });
    await expectTakenBack(w, before, theirs);
  });

  it('takes back Claude’s suggestion from the command line with ⌘Z, exactly', async () => {
    const { w, claudeRuns } = await open();
    const before = w.editor.getDoc();
    const theirs = await claudeRuns(
      'str-replace',
      '--old',
      'Try it',
      '--new',
      'Try this now',
      '--note',
      'Clearer',
    );
    const suggestion = expectSound(theirs).marks.find((mark) => mark.entry.note === 'Clearer');
    expect(suggestion?.entry.by).toBe('claude-ada');
    await expectTakenBack(w, before, theirs);
  });

  it('takes back Claude’s comment from the command line with ⌘Z, exactly', async () => {
    const { w, claudeRuns } = await open();
    const before = w.editor.getDoc();
    const theirs = await claudeRuns(
      'comment',
      '--quote',
      'Try it',
      '--text',
      'Should this be a heading?',
    );
    expect(expectSound(theirs).ledger.comments.map(({ by, text }) => `${by}: ${text}`)).toContain(
      'claude-ada: Should this be a heading?',
    );
    await expectTakenBack(w, before, theirs);
  });

  it('takes back Claude’s change to a CRLF file exactly', async () => {
    const { w, claudeRuns } = await open(sample.replaceAll('\n', '\r\n'));
    const before = w.editor.getDoc();
    expect(before).not.toMatch(/[^\r]\n/);
    const theirs = await claudeRuns('str-replace', '--old', 'Try it', '--new', 'Try it now');
    expect(theirs).not.toMatch(/[^\r]\n/);
    await expectTakenBack(w, before, theirs);
  });

  it('takes back Claude’s change after your own edit, then your edit', async () => {
    const { w, claudeRuns } = await open();
    const start = w.editor.getDoc();
    w.editor.accept('k3x9');
    await w.controller.save();
    const mine = w.editor.getDoc();
    await claudeRuns('reply', 'c8d2', '--text', 'Thanks, Ada.');
    w.undoKey();
    expect(w.editor.getDoc()).toBe(mine);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(start);
  });

  it('makes three commands in a row three steps', async () => {
    const { w, claudeRuns } = await open();
    const texts = [w.editor.getDoc()];
    texts.push(await claudeRuns('str-replace', '--old', 'Try it', '--new', 'Try it now'));
    texts.push(await claudeRuns('comment', '--quote', 'Open this', '--text', 'Which document?'));
    texts.push(await claudeRuns('reply', 'c8d2', '--text', 'Thanks, Ada.'));
    for (let i = texts.length - 2; i >= 0; i--) {
      w.undoKey();
      expect(w.editor.getDoc()).toBe(texts[i]);
    }
    for (let i = 1; i < texts.length; i++) {
      w.redoKey();
      expect(w.editor.getDoc()).toBe(texts[i]);
    }
    expect(w.notices).toEqual([]);
  });

  it('takes back Claude’s revision of its own suggestion, then the suggestion', async () => {
    const { w, claudeRuns } = await open();
    const before = w.editor.getDoc();
    const first = await claudeRuns('str-replace', '--old', 'Try it', '--new', 'Try it now');
    const id = parse(first).marks.find(
      (mark) => mark.entry.by === 'claude-ada' && mark.id !== 'p7qd',
    )?.id;
    expect(id).toBeDefined();
    const second = await claudeRuns(
      'str-replace',
      '--old',
      'Try it now',
      '--new',
      'Try it right now',
      '--note',
      'Sooner',
    );
    // The same suggestion, grown, with its note replaced: no new mark.
    expect(parse(second).marks.map((mark) => mark.id)).toEqual(
      parse(first).marks.map((mark) => mark.id),
    );
    expect(parse(second).ledger.marks[id!]?.note).toBe('Sooner');
    w.undoKey();
    expect(w.editor.getDoc()).toBe(first);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(before);
  });

  it('takes back Claude’s reply in a resolved thread, and gives the thread back resolved', async () => {
    const { w, claudeRuns } = await open();
    // Ada resolved the thread in another window: a change of hers, which starts the history over.
    const mine = w.editor.getDoc();
    const resolved = applyChanges(
      mine,
      resolve(mine, 'c8d2', { author: ada, time: '2026-11-01T10:00Z' }),
    );
    await w.changeOnDisk(resolved);
    expect(w.editor.getDoc()).toBe(resolved);
    const theirs = await claudeRuns('reply', 'c8d2', '--text', 'One more thing.');
    expect(parse(theirs).ledger.comments.find(({ id }) => id === 'c8d2')?.resolved).toBeUndefined();
    w.undoKey();
    expect(w.editor.getDoc()).toBe(resolved);
    expect(w.editor.getParsed().ledger.comments.find(({ id }) => id === 'c8d2')?.resolved).toEqual({
      by: 'ada',
      at: '2026-11-01T10:00Z',
    });
  });

  it('keeps your ⌘Z of Claude’s change when Claude writes again, and asks before ⌘S overwrites', async () => {
    const { w, runs, claudeRuns } = await open();
    const before = w.editor.getDoc();
    await claudeRuns('reply', 'c8d2', '--text', 'Thanks, Ada.');
    w.undoKey();
    expect(w.editor.getDoc()).toBe(before);
    const newer = await runs(CLAUDE_ADA, 'str-replace', '--old', 'Try it', '--new', 'Try it now');
    expect(w.editor.getDoc()).toBe(before);
    expect(w.controller.state).toMatchObject({ dirty: true, notice: CHANGED_ON_DISK });
    expect(await w.controller.save()).toBe(false);
    expect(w.overwriteAsked()).toBe(1);
    expect(w.files.get(PATH)).toBe(newer);
  });

  it('takes Claude’s newer change as a step when ⇧⌘Z brings back the text it was made on', async () => {
    const { w, runs, claudeRuns } = await open();
    const before = w.editor.getDoc();
    const first = await claudeRuns('reply', 'c8d2', '--text', 'Thanks, Ada.');
    w.undoKey();
    const newer = await runs(CLAUDE_ADA, 'str-replace', '--old', 'Try it', '--new', 'Try it now');
    expect(w.editor.getDoc()).toBe(before);
    // No edits are left to keep: the file as it is now becomes the text, as Claude's step.
    w.redoKey();
    await settle();
    expect(w.editor.getDoc()).toBe(newer);
    expect(w.controller.state).toMatchObject({ dirty: false, notice: null });
    w.undoKey();
    expect(w.editor.getDoc()).toBe(first);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(before);
  });
});

describe('undo after anyone else changed the file', () => {
  it('starts over after Claude for Bo’s change, keeping its work, as before', async () => {
    // Your reply, then Claude for Bo's reply.
    {
      const { w, runs } = await open();
      w.replyIn('c8d2', 'Agreed.');
      expect(w.controller.state.dirty).toBe(true);
      await w.controller.save();
      const theirs = await runs(CLAUDE_BO, 'reply', 'c8d2', '--text', 'Thanks, Ada.');
      expect(w.editor.getDoc()).toBe(theirs);
      w.undoKey();
      expect(w.notices).toEqual([UNDO_AFTER_RELOAD]);
      expect(await w.controller.save()).toBe(true);
      expect(w.files.get(PATH)).toBe(theirs);
      const thread = expectSound(theirs).ledger.comments.find(({ id }) => id === 'c8d2');
      expect(thread?.replies.map(({ by, text }) => `${by}: ${text}`)).toEqual([
        'claude-ada: Yes. Mention me in a comment and I answer in its thread, and I can suggest changes to the text it is about.',
        'ada: Agreed.',
        'claude-bo: Thanks, Ada.',
      ]);
    }
    // Your tracked typing, then its suggestion.
    {
      const { w, runs } = await open();
      w.editor.setTracking(true);
      w.type(w.editor.view.state.doc.toString().indexOf('Each person'), 'Hello ');
      await w.controller.save();
      const theirs = await runs(
        CLAUDE_BO,
        'str-replace',
        '--old',
        'Try it',
        '--new',
        'Try this now',
        '--note',
        'Clearer',
      );
      w.undoKey();
      expect(w.editor.getDoc()).toBe(theirs);
      const parsed = expectSound(theirs);
      const suggestion = parsed.marks.find((mark) => mark.entry.note === 'Clearer');
      expect(suggestion?.entry.by).toBe('claude-bo');
      expect(reviewView(theirs)).toContain(
        `## Try {~~it~>this now~~}[${suggestion?.id} claude-bo]`,
      );
    }
    // Your decision, then its comment.
    {
      const { w, runs } = await open();
      w.editor.accept('k3x9');
      await w.controller.save();
      const theirs = await runs(CLAUDE_BO, 'comment', '--quote', 'Try it', '--text', 'A heading?');
      w.undoKey();
      expect(w.editor.getDoc()).toBe(theirs);
      expect(expectSound(theirs).ledger.comments.map(({ by, text }) => `${by}: ${text}`)).toContain(
        'claude-bo: A heading?',
      );
    }
  });

  it('starts over after a change of Claude’s with one plain character more', async () => {
    const { w, command } = await open();
    w.editor.accept('k3x9');
    await w.controller.save();
    const theirs = await command(CLAUDE_ADA, 'reply', 'c8d2', '--text', 'Thanks, Ada.');
    const more = theirs.replace('# Welcome to Redlines', '# Welcome to Redlines!');
    await w.changeOnDisk(more);
    expect(w.editor.getDoc()).toBe(more);
    w.undoKey();
    expect(w.editor.getDoc()).toBe(more);
    expect(w.notices).toEqual([UNDO_AFTER_RELOAD]);
  });
});
