// @vitest-environment happy-dom
// A move that reaches more blocks than a widened edit holds is never refused: the person is asked,
// and the move is made without tracking on Make Edit (design: widen, alert or disable, §3.1).
import { newestView } from '@redlines/format';
import { afterEach, describe, expect, it, vi } from 'vitest';
// No fine or widened write is made for a move this far (a document that only a mock can reach).
vi.mock('@redlines/format', async (importOriginal) => {
  const format = await importOriginal<typeof import('@redlines/format')>();
  return {
    ...format,
    trackedBlockMove: () => {
      throw new format.Untrackable('too-large', 'This change would replace 12 blocks.', 12);
    },
  };
});

import { EditorView } from '@codemirror/view';
import {
  createEditor,
  type Editor,
  type Intent,
  intentOf,
  moveRunTo,
  runOfSelection,
  type UntrackedAnswer,
  type UntrackedReason,
} from '../index.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const DOC = Array.from({ length: 12 }, (_, i) => `P${i}.`).join('\n\n') + '\n';

const intents: Intent[] = [];

function load(answers: UntrackedAnswer[], asking = true) {
  intents.length = 0;
  const asked: UntrackedReason[] = [];
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc: DOC,
    author: { handle: 'ada', name: 'Ada' },
    tracking: true,
    ...(asking
      ? {
          askUntracked: {
            ask: (reason: UntrackedReason) => {
              asked.push(reason);
              return Promise.resolve(answers.shift() ?? 'cancel');
            },
            skip: () => false,
          },
        }
      : {}),
    extensions: [
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) {
          const intent = intentOf(tr);
          if (intent) intents.push(intent);
        }
      }),
    ],
  });
  open.push(editor);
  editor.view.dispatch({ selection: { anchor: 1 } });
  return { editor, asked };
}

/** Moves the blocks at the caret to the last gap, as a drag to the end does. */
function dragToEnd(editor: Editor): boolean {
  const run = runOfSelection(editor.view.state)!;
  return moveRunTo(editor.view, run, run.gaps.at(-1)!);
}

const view = (editor: Editor) => newestView(editor.getDoc()).text;

describe('a move that reaches too many blocks to be tracked', () => {
  it('asks first, and moves the blocks untracked on Make Edit', async () => {
    const { editor, asked } = load(['make']);
    expect(dragToEnd(editor)).toBe(true);
    // Held while the sheet is up.
    expect(editor.getDoc()).toBe(DOC);
    await tick();
    expect(asked).toEqual(['accept-pending']);
    expect(view(editor).endsWith('P0.\n')).toBe(true);
    expect(editor.getParsed().marks).toEqual([]);
    // The move made without tracking is recorded as the plain edits it was.
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ kind: 'typing', tracking: false });
  });

  it('writes nothing on Cancel', async () => {
    const { editor, asked } = load(['cancel']);
    dragToEnd(editor);
    await tick();
    expect(asked).toEqual(['accept-pending']);
    expect(editor.getDoc()).toBe(DOC);
  });
});
