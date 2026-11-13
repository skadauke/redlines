// @vitest-environment happy-dom
import type { EditorView, Tooltip } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { file, mount, PEOPLE, unmountAll } from './test-helpers.ts';

type Source = (
  view: EditorView,
  pos: number,
  side: -1 | 1,
) => Tooltip | null | Promise<Tooltip | null>;

/** The functions that were given to `hoverTooltip`, as the cards' are, which decide the cards. */
const sources: Source[] = [];

vi.mock('@codemirror/view', async (importOriginal) => {
  const real = await importOriginal<typeof import('@codemirror/view')>();
  return {
    ...real,
    hoverTooltip: (source: Source, options?: Parameters<typeof real.hoverTooltip>[1]) => {
      sources.push(source);
      return real.hoverTooltip(source, options);
    },
  };
});

afterEach(() => {
  unmountAll();
  sources.length = 0;
});

const doc = file('We ship the <!--ins k3x9-->new <!--/k3x9-->importer.', [
  ...PEOPLE,
  'marks:',
  '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
]);

describe('where a change card is placed', () => {
  it('is never put away for being above the top of the editor’s box, less the host’s room', async () => {
    const { editor } = mount(doc);
    const inserted = editor.view.contentDOM.querySelector<HTMLElement>('.rl-ins');
    if (!inserted) throw new Error('nothing inserted is drawn');
    const source = sources.at(-1);
    if (!source) throw new Error('the cards ask for no hover tooltip');
    const tooltip = await source(editor.view, editor.view.posAtDOM(inserted), 1);
    expect(tooltip).not.toBeNull();
    // CodeMirror puts a tooltip away when its anchor is above the editor's own box plus the scroll
    // margins that a host keeps for what floats over the page (the title bar's). The page scrolls,
    // so that box is the whole document, which starts below that room already: the room would be
    // taken twice, and a change on the first line would have no card. `visibleSpace` keeps the card
    // where it can be seen.
    expect(tooltip?.clip).toBe(false);
    expect(tooltip?.above).toBe(true);
  });
});
