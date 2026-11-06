// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { createEditor } from '@redlines/editor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFormatting } from './index.ts';

const reads = vi.hoisted(() => ({ count: 0 }));

vi.mock('@codemirror/language', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codemirror/language')>();
  return {
    ...actual,
    syntaxTree: (...args: Parameters<typeof actual.syntaxTree>) => {
      reads.count++;
      return actual.syntaxTree(...args);
    },
  };
});

const author = { handle: 'ada', name: 'Ada Lovelace' };
let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.replaceChildren();
});

describe('the block commands that are on', () => {
  it('are worked out once for a state, however many commands ask', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const editor = createEditor(parent, { doc: '- One\n- Two\n', author });
    const remove = createFormatting(editor, { author, notice: () => {} });
    cleanup = () => {
      remove();
      editor.destroy();
    };
    forceParsing(editor.view, editor.view.state.doc.length, 5000);
    editor.view.dispatch({ selection: { anchor: 3 } });
    const { state } = editor.view;
    const blocks = editor.commands.list().filter(({ id }) => id.startsWith('block.'));
    expect(blocks.length).toBeGreaterThan(10);

    reads.count = 0;
    const first = blocks.map((command) => command.isActive?.(state));
    const afterFirst = reads.count;
    const second = blocks.map((command) => command.isActive?.(state));
    expect(afterFirst).toBeLessThanOrEqual(1);
    expect(reads.count).toBe(afterFirst);
    expect(second).toEqual(first);
    expect(first).toContain(true);
  });
});
