// @vitest-environment happy-dom
// The open file changes on disk because Claude edits it with the command line, which writes a new
// file next to it and renames it over the old one. With real files, a real watcher and the real
// command line: the app reloads the file each time, keeps unsaved edits when there are some, and
// takes the agent's version once they are undone. The same when the file was opened through a
// symbolic link, which the command line follows.

import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { createEditor, type Editor } from '@redlines/editor';
import { parse } from '@redlines/format';
import { nodeIo, run, type CliIo } from 'redlines';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANGED_ON_DISK, DocumentController, type DocumentState } from './document.ts';
import { BROWSER_IDENTITY, decodeCapped, decodeText, watchFile, type Host } from './host.ts';
import sample from './sample.md?raw';

/**
 * A host over the machine's files, watching them as the desktop app does: `watchFile` over the
 * system's watcher (Node's, where the app uses the file system plugin's), so that a file replaced
 * by a rename stays watched, and over the real paths of links (`real_path` in the app).
 */
function nodeHost(): Host {
  return {
    identity: () => Promise.resolve(BROWSER_IDENTITY),
    open: () => Promise.resolve(null),
    read: async (path) => decodeText(await readFile(path)),
    readCapped: async (path, limit) => decodeCapped(await readFile(path), limit),
    write: (path, text) => writeFile(path, text),
    rename: () => Promise.reject(new Error('not renamed here')),
    exists: (path) => Promise.resolve(existsSync(path)),
    reveal: () => Promise.resolve(),
    print: () => Promise.resolve(),
    saveAs: () => Promise.resolve(null),
    watch: (path, onChange) =>
      watchFile(
        path,
        onChange,
        (watched, onEvent) => {
          const watcher = watch(watched, (_type, file) => {
            // Node doesn't always say which file; an event without a path says so in the plugin too.
            onEvent({ type: 'any', paths: file ? [join(watched, file)] : [], attrs: {} });
          });
          return Promise.resolve(() => watcher.close());
        },
        (file) => realpath(file),
      ),
    projectRoot: (path) =>
      Promise.resolve({ folder: dirname(path), isRepo: false, tooBroad: false }),
    list: () => Promise.resolve([]),
    openDefault: () => Promise.resolve(),
    allowDocument: () => Promise.resolve(),
    forgetDocuments: () => Promise.resolve(),
    askToSave: () => Promise.resolve('cancel'),
    askToOverwrite: () => Promise.resolve('cancel'),
    openWindow: () => Promise.resolve(),
    windowStart: () => Promise.resolve({ path: null, line: null }),
    readClipboardText: () => Promise.resolve(''),
    listenForFiles: () => Promise.resolve(),
  };
}

/** The command line, quiet; returns its exit code and what it said on stderr. */
async function redlines(...argv: string[]): Promise<{ code: number; stderr: string }> {
  let stderr = '';
  const io: CliIo = { ...nodeIo, stdout: () => {}, stderr: (s) => (stderr += s) };
  return { code: await run(argv, io), stderr };
}

/** Waits until `ready` holds, checking every 20ms, for at most 5 seconds. */
async function until(ready: () => boolean | Promise<boolean>): Promise<void> {
  for (let waited = 0; waited < 5000; waited += 20) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out');
}

let folder = '';
let editor: Editor;
let controller: DocumentController;
let state: DocumentState | null = null;

beforeEach(async () => {
  // As the real path of the folder, so that no file is reached through a link by accident: on
  // macOS the temporary folder is below /var, which is a link to /private/var.
  folder = await realpath(await mkdtemp(join(tmpdir(), 'redlines-watch-')));
  const parent = document.createElement('div');
  document.body.append(parent);
  editor = createEditor(parent, {
    doc: '',
    author: BROWSER_IDENTITY,
    onChange: (text) => controller.markEdited(text),
  });
  controller = new DocumentController(nodeHost(), editor, (next) => (state = next));
});

afterEach(async () => {
  controller.dispose();
  editor.destroy();
  document.body.replaceChildren();
  await rm(folder, { recursive: true, force: true });
});

/** Opens a copy of `text` as `name` in the folder; resolves once the watcher has started. */
async function open(name: string, text: string): Promise<string> {
  const path = join(folder, name);
  await writeFile(path, text);
  await controller.open(path);
  // The watcher starts after the file is open.
  await new Promise((resolve) => setTimeout(resolve, 100));
  return path;
}

describe('the open file, reached through a symbolic link', () => {
  const agent = ['--as', 'claude-ada', '--name', 'Claude', '--for', 'ada'];

  /**
   * Opens `link`, a link to the file `target`, which holds the welcome document, and has the
   * command line suggest a change through the link, and accept it. The command line follows the
   * link and writes the target, in the target's folder and under its name; each time the app
   * reloads the file.
   */
  async function changeThroughTheLink(link: string, target: string): Promise<void> {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, sample);
    await mkdir(dirname(link), { recursive: true });
    // A relative link, as `ln -s` makes it.
    await symlink(relative(dirname(link), target), link);
    await controller.open(link);
    // The watcher starts after the file is open.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const replaced = await redlines(
      ...['str-replace', link, '--old', 'in any app', '--new', 'in every app'],
      ...[...agent, '--note', 'Reads better'],
    );
    expect(replaced).toEqual({ code: 0, stderr: '' });
    const first = await readFile(target, 'utf8');
    expect(first).not.toBe(sample);
    await until(() => editor.getDoc() === first);
    // The welcome document already holds a suggestion of Claude's; this is the new one.
    const suggestion = editor
      .getParsed()
      .marks.find((mark) => mark.entry.by === 'claude-ada' && mark.entry.note === 'Reads better');
    expect(suggestion?.kind).toBe('sub');

    expect((await redlines('accept', link, suggestion!.id)).code).toBe(0);
    const second = await readFile(target, 'utf8');
    await until(() => editor.getDoc() === second);
    expect(second).toContain('through every save, in every app.');
    expect(state).toMatchObject({ dirty: false, notice: null });
    // The link is still a link: the command line wrote through it.
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  }

  it('reloads each time when the link names a file in another folder', async () => {
    await changeThroughTheLink(join(folder, 'notes', 'plan.md'), join(folder, 'work', 'plan.md'));
  }, 20_000);

  it('reloads each time when the link names a file of another name in the same folder', async () => {
    await changeThroughTheLink(join(folder, 'plan.md'), join(folder, 'real-2026.md'));
  }, 20_000);
});

describe('the open file, changed by the command line', () => {
  it('reloads after each atomic write, and shows the agent’s suggestion', async () => {
    const path = await open('sample.md', sample);
    const agent = ['--as', 'claude-ada', '--name', 'Claude', '--for', 'ada'];

    const replaced = await redlines(
      'str-replace',
      path,
      '--old',
      'in any app',
      '--new',
      'in every app',
      ...agent,
      '--note',
      'Reads better',
    );
    expect(replaced).toEqual({ code: 0, stderr: '' });
    const first = await readFile(path, 'utf8');
    await until(() => editor.getDoc() === first);
    const suggestion = editor
      .getParsed()
      .marks.find((mark) => mark.entry.by === 'claude-ada' && mark.entry.note === 'Reads better');
    expect(suggestion?.kind).toBe('sub');
    expect(suggestion?.payload).toBe('any');
    expect(editor.getUiState()).toMatchObject({ view: 'redlines', hasRedlines: true });
    expect(editor.getUiState().changes.map(({ id }) => id)).toContain(suggestion?.id);
    expect(state).toMatchObject({ dirty: false, notice: null });

    // The file was replaced by a rename; the next write is seen too.
    expect((await redlines('accept', path, suggestion!.id)).code).toBe(0);
    const second = await readFile(path, 'utf8');
    await until(() => editor.getDoc() === second);
    expect(editor.getParsed().marks.some((mark) => mark.id === suggestion!.id)).toBe(false);
    expect(second).toContain('through every save, in every app.');
    expect(state).toMatchObject({ dirty: false, notice: null });
  });

  it('keeps unsaved edits, and takes the new file once they are undone', async () => {
    const path = await open('sample.md', sample);
    // An edit of yours, with Track Changes off, not saved.
    const at = editor.view.state.doc.toString().indexOf('Welcome to Redlines') + 'Welcome'.length;
    editor.view.dispatch({ changes: { from: at, insert: ', friend,' }, userEvent: 'input.type' });
    expect(state?.dirty).toBe(true);

    const replied = await redlines(
      'reply',
      path,
      'c8d2',
      '--text',
      'I can also accept changes from the command line.',
      '--as',
      'claude-ada',
      '--name',
      'Claude',
      '--for',
      'ada',
    );
    expect(replied.code).toBe(0);
    await until(() => state?.notice === CHANGED_ON_DISK);
    // Neither side is overwritten: the edit stays here, the reply on disk.
    expect(editor.getDoc()).toContain('Welcome, friend, to Redlines');
    expect(editor.getDoc()).not.toContain('I can also accept changes');
    const onDisk = await readFile(path, 'utf8');
    expect(onDisk).toContain('I can also accept changes from the command line.');
    expect(onDisk).not.toContain('friend');

    // Undone, there are no edits left to keep: the new file is the text.
    editor.view.dispatch({
      changes: { from: at, to: at + ', friend,'.length },
      userEvent: 'delete',
    });
    expect(editor.getDoc()).toBe(onDisk);
    expect(state).toMatchObject({ dirty: false, notice: null });
    const thread = editor.getParsed().ledger.comments.find(({ id }) => id === 'c8d2');
    expect(thread?.replies.at(-1)?.text).toBe('I can also accept changes from the command line.');
  });

  it('accepts and rejects inserted line breaks from the command line', async () => {
    const split = [
      'One half.<!--split s3vb-->',
      '',
      'The other half.<!--split w8nn-->',
      '',
      'The end.',
      '',
      '<!-- redlines',
      'version: 1',
      'people:',
      '  bo: {name: Bo Chen}',
      'marks:',
      '  s3vb: {by: bo, at: 2026-10-31T09:30Z}',
      '  w8nn: {by: bo, at: 2026-10-31T09:31Z}',
      '-->',
      '',
    ].join('\n');
    expect(parse(split).warnings).toEqual([]);
    const path = await open('halves.md', split);
    expect(editor.getUiState().changes.map(({ kind }) => kind)).toEqual(['split', 'split']);

    expect((await redlines('accept', path, 's3vb')).code).toBe(0);
    let text = await readFile(path, 'utf8');
    await until(() => editor.getDoc() === text);
    expect(text.startsWith('One half.\n\nThe other half.<!--split w8nn-->')).toBe(true);

    expect((await redlines('reject', path, 'w8nn')).code).toBe(0);
    text = await readFile(path, 'utf8');
    await until(() => editor.getDoc() === text);
    expect(text).toBe('One half.\n\nThe other half.The end.\n');
    expect(editor.getUiState()).toMatchObject({ hasRedlines: false, changes: [] });
  });
});
