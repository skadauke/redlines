// @vitest-environment happy-dom
// Undo after Claude changed the open file from the command line. The app reloads the file, and
// what was done before the reload can't be undone over Claude's version: ⌘Z then Save keeps
// Claude's reply, suggestion and comment, and the file stays sound.

import { createEditor, type Editor } from '@redlines/editor';
import { parse, reviewView, type Parsed } from '@redlines/format';
import { createReview } from '@redlines/review';
import { run, type CliIo } from 'redlines';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentController } from './document.ts';
import type { Host } from './host.ts';
import sample from './sample.md?raw';

const PATH = '/docs/plan.md';
const ada = { handle: 'ada', name: 'Ada Lovelace', email: 'ada@example.org' };

/** A host over files in memory, whose watcher the test fires as the system would. */
function memoryHost(files: Map<string, string>, watchers: Map<string, () => void>): Host {
  return {
    identity: () => Promise.resolve(ada),
    open: () => Promise.resolve(null),
    read: (path) => {
      const text = files.get(path);
      return text === undefined ? Promise.reject(new Error('not found')) : Promise.resolve(text);
    },
    write: (path, text) => Promise.resolve(void files.set(path, text)),
    saveAs: () => Promise.resolve(null),
    watch: (path, onChange) => {
      watchers.set(path, onChange);
      return Promise.resolve(() => watchers.delete(path));
    },
    list: () => Promise.resolve([]),
    askToSave: () => Promise.resolve('cancel'),
    askToOverwrite: () => Promise.resolve('cancel'),
    listenForFiles: () => Promise.resolve(),
  };
}

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** The welcome document, open in an editor with the review interface, as the app has it. */
async function openWelcome() {
  const files = new Map([[PATH, sample]]);
  const watchers = new Map<string, () => void>();
  const parent = document.createElement('div');
  document.body.append(parent);
  // Assigned before the editor reports its first change.
  // eslint-disable-next-line prefer-const
  let controller: DocumentController;
  const editor = createEditor(parent, {
    doc: '',
    author: ada,
    onChange: (text) => controller.markEdited(text),
  });
  editors.push(editor);
  createReview(editor, { author: ada });
  controller = new DocumentController(memoryHost(files, watchers), editor, () => {});
  await controller.open(PATH);
  await new Promise((resolve) => setTimeout(resolve, 0));

  /** Claude runs a command on the file, which then changes on disk, and the app reloads it. */
  const claudeRuns = async (...args: string[]) => {
    let stderr = '';
    const io: CliIo = {
      readFile: (path) => Promise.resolve(files.get(path) ?? ''),
      writeFile: (path, text) => Promise.resolve(void files.set(path, text)),
      stdout: () => {},
      stderr: (s) => (stderr += s),
      now: () => new Date('2026-11-01T10:05:00Z'),
      realpath: (path) => Promise.resolve(path),
      modeOf: () => Promise.resolve(0o644),
      canWrite: () => Promise.resolve(true),
      rename: (from, to) => {
        files.set(to, files.get(from) ?? '');
        files.delete(from);
        return Promise.resolve();
      },
      remove: (path) => Promise.resolve(void files.delete(path)),
      readStdin: () => Promise.resolve(''),
    };
    const [command = '', ...rest] = args;
    const agent = ['--as', 'claude-ada', '--name', 'Claude', '--for', 'ada'];
    expect(await run([command, PATH, ...rest, ...agent], io), stderr).toBe(0);
    watchers.get(PATH)?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.getDoc()).toBe(files.get(PATH));
    return files.get(PATH)!;
  };

  /** ⌘Z, then Save: what is on disk afterwards. */
  const undoAndSave = async () => {
    const mac = /Mac/.test(navigator.platform);
    const init = { key: 'z', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true };
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', init));
    await controller.save();
    return files.get(PATH)!;
  };

  return { editor, controller, claudeRuns, undoAndSave };
}

/** The file is sound: no warnings, and nothing after the ledger. */
function expectSound(text: string): Parsed {
  const parsed = parse(text);
  expect(parsed.warnings).toEqual([]);
  expect(text.slice(text.lastIndexOf('-->') + 3).trim()).toBe('');
  return parsed;
}

describe('undo after Claude changed the file', () => {
  it('keeps Claude’s reply after your own reply', async () => {
    const { editor, controller, claudeRuns, undoAndSave } = await openWelcome();
    const note = [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-note')].find((el) =>
      el.textContent?.includes('Can agents answer comments too?'),
    )!;
    note.querySelector<HTMLButtonElement>('button[aria-label="Reply"]')!.click();
    const box = note.querySelector('textarea')!;
    box.value = 'Agreed.';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(controller.state.dirty).toBe(true);
    await controller.save();

    const theirs = await claudeRuns('reply', 'c8d2', '--text', 'Thanks, Ada.');
    expect(await undoAndSave()).toBe(theirs);
    const thread = expectSound(theirs).ledger.comments.find(({ id }) => id === 'c8d2');
    expect(thread?.replies.map(({ by, text }) => `${by}: ${text}`)).toEqual([
      'claude-ada: Yes. I can reply in a thread and suggest changes to the text it is about.',
      'ada: Agreed.',
      'claude-ada: Thanks, Ada.',
    ]);
  });

  it('keeps Claude’s suggestion after your own tracked typing', async () => {
    const { editor, controller, claudeRuns, undoAndSave } = await openWelcome();
    editor.setTracking(true);
    const at = editor.view.state.doc.toString().indexOf('Each person');
    editor.view.dispatch({ selection: { anchor: at }, userEvent: 'select' });
    editor.view.dispatch(editor.view.state.replaceSelection('Hello '), { userEvent: 'input.type' });
    await controller.save();

    const theirs = await claudeRuns(
      'str-replace',
      '--old',
      'Try it',
      '--new',
      'Try this now',
      '--note',
      'Clearer',
    );
    expect(await undoAndSave()).toBe(theirs);
    const parsed = expectSound(theirs);
    const suggestion = parsed.marks.find((mark) => mark.entry.note === 'Clearer');
    expect(suggestion?.entry.by).toBe('claude-ada');
    expect(reviewView(theirs)).toContain(`## Try {~~it~>this now~~}[${suggestion?.id} claude-ada]`);
  });

  it('keeps Claude’s comment after your own decision', async () => {
    const { editor, controller, claudeRuns, undoAndSave } = await openWelcome();
    editor.accept('k3x9');
    await controller.save();

    const theirs = await claudeRuns(
      'comment',
      '--quote',
      'Try it',
      '--text',
      'Should this be a heading?',
    );
    expect(await undoAndSave()).toBe(theirs);
    const threads = expectSound(theirs).ledger.comments;
    expect(threads.map(({ by, text }) => `${by}: ${text}`)).toContain(
      'claude-ada: Should this be a heading?',
    );
  });
});
