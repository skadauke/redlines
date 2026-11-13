// @vitest-environment happy-dom
// A plain text file is a document (format §9.1): it opens in the editor, read as Markdown is, takes
// Track Changes like any document, and saves under its own name, its bytes as they were but for the
// edits. With real files, the real editor and the document controller, as a window has them.

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditor, type Editor } from '@redlines/editor';
import { newestView, parse } from '@redlines/format';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentController, type DocumentState } from './document.ts';
import { BROWSER_IDENTITY, decodeText, FileExistsError, type Host } from './host.ts';

/** A host over the machine's files. Nothing here changes on disk while it is open. */
function nodeHost(): Host {
  return {
    identity: () => Promise.resolve(BROWSER_IDENTITY),
    open: () => Promise.resolve(null),
    read: async (path) => decodeText(await readFile(path)),
    write: (path, text) => writeFile(path, text),
    // As the app does: never over a file that is there.
    rename: async (from, to) => {
      if (existsSync(to)) throw new FileExistsError(to);
      await rename(from, to);
    },
    exists: (path) => Promise.resolve(existsSync(path)),
    reveal: () => Promise.resolve(),
    print: () => Promise.resolve(),
    saveAs: () => Promise.resolve(null),
    watch: () => Promise.resolve(() => {}),
    projectRoot: (path) =>
      Promise.resolve({
        folder: path.slice(0, path.lastIndexOf('/')),
        isRepo: false,
        tooBroad: false,
      }),
    list: () => Promise.resolve([]),
    openDefault: () => Promise.resolve(),
    allowDocument: () => Promise.resolve(),
    allowImages: () => Promise.resolve(false),
    imageUrl: () => null,
    forgetDocuments: () => Promise.resolve(),
    askToSave: () => Promise.resolve('cancel'),
    askToOverwrite: () => Promise.resolve('cancel'),
    askToDiscardDraft: () => Promise.resolve(false),
    openWindow: () => Promise.resolve(),
    windowStart: () => Promise.resolve({ path: null, line: null }),
    readClipboardText: () => Promise.resolve(''),
    askToSaveForImage: () => Promise.resolve(false),
    chooseImages: () => Promise.resolve(null),
    addImages: () => Promise.resolve({ paths: [], refused: [] }),
    listenForImageDrops: () => Promise.resolve(() => {}),
    listenForFiles: () => Promise.resolve(),
  };
}

/**
 * Notes as a plain text editor leaves them: a byte order mark, Windows line ends, a tab, trailing
 * spaces, lines that Markdown would read as a heading and as lists, backslashes and underscores, a
 * `<` that is no tag, and no line end at the end.
 */
const NOTES =
  '\uFEFFGroceries\r\n' +
  '=========\r\n' +
  '\r\n' +
  '* eggs\r\n' +
  '* flour  \r\n' +
  '1) call mum\r\n' +
  '\tback by 6\r\n' +
  '\r\n' +
  'C:\\Users\\ada\\snake_case_name <3\r\n' +
  'no line end here';

let folder = '';
let editor: Editor;
let controller: DocumentController;
let state: DocumentState | null = null;

beforeEach(async () => {
  // As the real path of the folder: on macOS the temporary folder is below a link.
  folder = await realpath(await mkdtemp(join(tmpdir(), 'redlines-text-')));
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

/** Writes `text` as `name` in the folder and opens it. */
async function open(name: string, text: string): Promise<string> {
  const path = join(folder, name);
  await writeFile(path, text);
  await controller.open(path);
  return path;
}

/** Types `text` in the editor right after the first `after`, as the keyboard does. */
function typeAfter(after: string, text: string): void {
  const at = editor.view.state.doc.toString().indexOf(after);
  expect(at).toBeGreaterThanOrEqual(0);
  editor.view.dispatch({ selection: { anchor: at + after.length } });
  editor.view.dispatch(editor.view.state.replaceSelection(text), { userEvent: 'input.type' });
}

describe('a plain text file', () => {
  it('opens as it is, and saving it without an edit leaves it byte for byte the same', async () => {
    const path = await open('notes.txt', NOTES);
    expect(editor.getDoc()).toBe(NOTES);
    expect(state).toMatchObject({ path, name: 'notes.txt', dirty: false, notice: null });
    expect(await controller.save()).toBe(true);
    expect(await readFile(path)).toEqual(Buffer.from(NOTES, 'utf8'));
  });

  it('saves an edit under its own name, with every other byte as it was', async () => {
    const path = await open('notes.txt', NOTES);
    typeAfter('* eggs', ' and milk');
    expect(state?.dirty).toBe(true);
    expect(await controller.save()).toBe(true);
    const expected =
      '\uFEFFGroceries\r\n' +
      '=========\r\n' +
      '\r\n' +
      '* eggs and milk\r\n' +
      '* flour  \r\n' +
      '1) call mum\r\n' +
      '\tback by 6\r\n' +
      '\r\n' +
      'C:\\Users\\ada\\snake_case_name <3\r\n' +
      'no line end here';
    expect(await readFile(path)).toEqual(Buffer.from(expected, 'utf8'));
    expect(state).toMatchObject({ path, name: 'notes.txt', dirty: false });
  });

  it('takes a tracked change, which is written in the file as in any document', async () => {
    const path = await open('plan.txt', 'Pack the bags.\n');
    editor.setTracking(true);
    typeAfter('Pack the bags', ' tonight');
    expect(await controller.save()).toBe(true);
    const saved = await readFile(path, 'utf8');
    const parsed = parse(saved);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.marks.map((mark) => [mark.kind, mark.entry.by])).toEqual([['ins', 'ada']]);
    expect(newestView(saved).text).toBe('Pack the bags tonight.\n');
  });

  it('keeps its .txt when it is renamed to a name without one, with its bytes', async () => {
    const path = await open('notes.txt', NOTES);
    expect(await controller.rename('groceries')).toBe(true);
    const renamed = join(folder, 'groceries.txt');
    expect(state).toMatchObject({ path: renamed, name: 'groceries.txt', dirty: false });
    expect(existsSync(path)).toBe(false);
    expect(await readFile(renamed)).toEqual(Buffer.from(NOTES, 'utf8'));
  });
});
