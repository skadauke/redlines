// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from '../index.ts';
import { type Block, blockAt, breakAfter, breakBefore, neighbours } from './structure.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** An editor on `doc` (`⏎` a line break, `‸` the position), and the position. */
function at(doc: string): { editor: Editor; pos: number } {
  const text = doc.replaceAll('⏎', '\n');
  const pos = text.indexOf('‸');
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc: text.replace('‸', ''), author });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  open.push(editor);
  return { editor, pos };
}

/** A block as text: its kind and what its ranges hold. */
function described(editor: Editor, block: Block | null) {
  if (!block) return null;
  const slice = (span: { from: number; to: number }) =>
    editor.view.state.sliceDoc(span.from, span.to).replaceAll('\n', '⏎');
  return {
    kind: block.kind,
    ...(block.level !== undefined ? { level: block.level } : {}),
    ...(block.setext ? { setext: true } : {}),
    text: slice(block.text),
    prefix: slice(block.prefix),
    containers: block.containers.map((c) => ({
      kind: c.kind,
      depth: c.depth,
      prefix: slice(c.prefix),
      ...(c.ordered ? { ordered: true } : {}),
      ...(c.task ? { task: c.task } : {}),
      ...(c.kind === 'item' ? { loose: !!c.loose } : {}),
    })),
  };
}

function blockIn(doc: string) {
  const { editor, pos } = at(doc);
  return described(editor, blockAt(editor.view.state, pos));
}

const item = (depth: number, prefix: string, more: object = {}) => ({
  kind: 'item',
  depth,
  prefix,
  loose: false,
  ...more,
});
const quote = (depth: number, prefix: string) => ({ kind: 'quote', depth, prefix });

describe('blockAt', () => {
  it.each([
    ['a paragraph', 'One ‸two.⏎⏎Next.', { kind: 'paragraph', text: 'One two.', prefix: '' }],
    ['a paragraph of two lines', 'One⏎tw‸o.', { kind: 'paragraph', text: 'One⏎two.', prefix: '' }],
    [
      'an ATX heading',
      '## Head ‸line',
      { kind: 'heading', level: 2, text: 'Head line', prefix: '## ' },
    ],
    [
      'an ATX heading with a closing sequence',
      '# Ti‸tle ##',
      { kind: 'heading', level: 1, text: 'Title', prefix: '# ' },
    ],
    [
      'a setext heading',
      'He‸ad⏎===⏎⏎Next.',
      { kind: 'heading', level: 1, setext: true, text: 'Head', prefix: '' },
    ],
    [
      'a fenced code block',
      '```js⏎let ‸a;⏎```',
      { kind: 'code', text: '```js⏎let a;⏎```', prefix: '' },
    ],
    ['an indented code block', 'Para.⏎⏎    co‸de', { kind: 'code', text: 'code', prefix: '    ' }],
    [
      'a table',
      '| a | b |⏎| - | - |⏎| 1‸ | 2 |',
      { kind: 'table', text: '| a | b |⏎| - | - |⏎| 1 | 2 |', prefix: '' },
    ],
    ['an HTML block', '<div>⏎x‸⏎</div>', { kind: 'html', text: '<div>⏎x⏎</div>', prefix: '' }],
    ['a thematic break', 'One.⏎⏎-‸--⏎⏎Two.', { kind: 'rule', text: '---', prefix: '' }],
    ['display math', '$$⏎x ‸= 1⏎$$', { kind: 'math', text: '$$⏎x = 1⏎$$', prefix: '' }],
    [
      'a link reference definition',
      '[a]: https://x.e‸xample',
      { kind: 'definition', text: '[a]: https://x.example', prefix: '' },
    ],
  ])('reads %s', (_, doc, want) => {
    expect(blockIn(doc)).toEqual({ containers: [], ...want });
  });

  it('reads the items of a tight list, nested three deep', () => {
    const doc = '- one⏎  - two⏎    - th‸ree⏎⏎After.';
    expect(blockIn(doc)).toEqual({
      kind: 'paragraph',
      text: 'three',
      prefix: '    - ',
      containers: [item(1, '  '), item(2, '  '), item(3, '- ')],
    });
    expect(blockIn('- one⏎  - t‸wo')).toMatchObject({
      text: 'two',
      prefix: '  - ',
      containers: [item(1, '  '), item(2, '- ')],
    });
    expect(blockIn('- o‸ne⏎  - two')).toMatchObject({
      text: 'one',
      prefix: '- ',
      containers: [item(1, '- ')],
    });
  });

  it('reads a loose list, and an item of two paragraphs as loose', () => {
    expect(blockIn('- one⏎⏎- t‸wo')).toMatchObject({
      containers: [item(1, '- ', { loose: true })],
    });
    expect(blockIn('- p1⏎⏎  p‸2⏎- next')).toEqual({
      kind: 'paragraph',
      text: 'p2',
      prefix: '  ',
      containers: [item(1, '  ', { loose: true })],
    });
    // Nested items apart don't make the outer list loose.
    expect(blockIn('- o‸ne⏎  - a⏎⏎  - b⏎- two')).toMatchObject({
      containers: [item(1, '- ')],
    });
  });

  it('reads numbered and task items', () => {
    expect(blockIn('1. one⏎2. t‸wo')).toMatchObject({
      text: 'two',
      prefix: '2. ',
      containers: [item(1, '2. ', { ordered: true })],
    });
    expect(blockIn('- [x] do‸ne⏎- [ ] open')).toMatchObject({
      text: 'done',
      prefix: '- [x] ',
      containers: [item(1, '- [x] ', { task: 'done' })],
    });
    expect(blockIn('- [x] done⏎- [ ] op‸en')).toMatchObject({
      containers: [item(1, '- [ ] ', { task: 'open' })],
    });
  });

  it('reads an empty item as an empty paragraph in it', () => {
    expect(blockIn('- one⏎- ‸')).toEqual({
      kind: 'paragraph',
      text: '',
      prefix: '- ',
      containers: [item(1, '- ')],
    });
  });

  it('reads a quote in a list item and an item in a quote', () => {
    expect(blockIn('- > q‸uoted')).toEqual({
      kind: 'paragraph',
      text: 'quoted',
      prefix: '- > ',
      containers: [item(1, '- '), quote(1, '> ')],
    });
    expect(blockIn('> - a‸b')).toEqual({
      kind: 'paragraph',
      text: 'ab',
      prefix: '> - ',
      containers: [quote(1, '> '), item(1, '- ')],
    });
    expect(blockIn('> > dee‸p')).toMatchObject({
      prefix: '> > ',
      containers: [quote(1, '> '), quote(2, '> ')],
    });
  });

  it('reads a lazy line of a quote as part of its paragraph', () => {
    expect(blockIn('> A long quote that⏎wraps la‸zily.⏎⏎After.')).toEqual({
      kind: 'paragraph',
      text: 'A long quote that⏎wraps lazily.',
      prefix: '> ',
      containers: [quote(1, '> ')],
    });
  });

  it('reads a heading in a quote', () => {
    expect(blockIn('> ## H‸ead')).toMatchObject({
      kind: 'heading',
      level: 2,
      text: 'Head',
      prefix: '> ## ',
    });
  });

  it('finds no block on a blank line, a line of markers alone or the ledger', () => {
    expect(blockIn('One.⏎‸⏎Two.')).toBeNull();
    expect(blockIn('> One.⏎>‸⏎> Two.')).toBeNull();
    const marked =
      'One.⏎⏎<!--del k3x9 Old-->‸⏎⏎Two.⏎⏎<!-- redlines⏎marks:⏎  k3x9: {by: bo, at: 2026-11-01T10:00Z}⏎-->⏎';
    expect(blockIn(marked)).toBeNull();
    expect(blockIn(marked.replace('‸', '').replace('marks:', 'ma‸rks:'))).toBeNull();
  });

  it('keeps blank lines in code part of the code', () => {
    expect(blockIn('```⏎a⏎‸⏎b⏎```')).toMatchObject({ kind: 'code' });
  });
});

describe('neighbours and breaks', () => {
  it('skips blank lines and lines of markers alone', () => {
    const { editor, pos } = at(
      'One.⏎⏎<!--del k3x9 Old-->⏎⏎T‸wo.⏎⏎<!-- redlines⏎marks:⏎  k3x9: {by: bo, at: 2026-11-01T10:00Z}⏎-->⏎',
    );
    const { state } = editor.view;
    const block = blockAt(state, pos)!;
    const { prev, next } = neighbours(state, block);
    expect(described(editor, prev)?.text).toBe('One.');
    expect(next).toBeNull();
    const before = breakBefore(state, block)!;
    expect(before.blank).toBe(2);
    expect(state.sliceDoc(before.from, before.to)).toBe('\n\n<!--del k3x9 Old-->\n\n');
    expect(before.hidden.map((s) => state.sliceDoc(s.from, s.to))).toEqual([
      '\n<!--del k3x9 Old-->\n',
    ]);
    expect(breakAfter(state, block)).toBeNull();
  });

  it('gives the nested item above as the block before an item', () => {
    const { editor, pos } = at('- one⏎  - sub⏎- t‸wo');
    const { state } = editor.view;
    const block = blockAt(state, pos)!;
    expect(described(editor, neighbours(state, block).prev)?.text).toBe('sub');
    const before = breakBefore(state, block)!;
    expect(before.blank).toBe(0);
    expect(before.hidden).toEqual([]);
    expect(state.sliceDoc(before.from, before.to)).toBe('\n- ');
  });

  it('reads the break under a heading with no blank line, and over three', () => {
    const { editor } = at('## Head⏎Para.⏎⏎⏎⏎Last.');
    const { state } = editor.view;
    const head = blockAt(state, 3)!;
    const under = breakAfter(state, head)!;
    expect(under.blank).toBe(0);
    const para = blockAt(state, under.to)!;
    const over = breakAfter(state, para)!;
    expect(over.blank).toBe(3);
    expect(over.hidden.map((s) => state.sliceDoc(s.from, s.to))).toEqual(['\n\n']);
    expect(breakBefore(state, head)).toBeNull();
  });
});
