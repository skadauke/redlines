// @vitest-environment happy-dom
// ⌥↑ on a code block that nothing closes writes its closing fence and moves the block (#1203),
// tracked with Track Changes on, plain with it off.
import { describe } from 'vitest';
import { afterEach, expect, it } from 'vitest';
import { createEditor, type Editor, type UntrackedAnswer } from '../index.ts';
import { moveBlocks } from './move.ts';
import { scriptRows } from './script.ts';

describe('⌥↑ on code with no closing fence', () => {
  scriptRows([
    {
      name: 'Track Changes off',
      doc: 'A paragraph above.⏎⏎```js⏎const total = 1;‸⏎',
      keys: ['Alt-ArrowUp'],
      tc: false,
      expect: { file: '```js⏎const total = 1;⏎```⏎⏎A paragraph above.' },
    },
    {
      name: 'Track Changes on',
      doc: 'A paragraph above.⏎⏎```js⏎const total = 1;‸⏎',
      keys: ['Alt-ArrowUp'],
      tc: true,
      expect: {
        caret:
          '<sub A paragraph above.⏎⏎```js⏎const total = 1;⏎>⏎⏎```js⏎const total = 1;‸⏎```⏎⏎A paragraph above.⏎</sub>',
      },
    },
    {
      name: 'in a quote, Track Changes off',
      doc: '> One.⏎>⏎> ```js⏎> x‸⏎',
      keys: ['Alt-ArrowUp'],
      tc: false,
      expect: { file: '> ```js⏎> x⏎> ```⏎>⏎> One.⏎' },
    },
    {
      name: 'the Test Drive’s Unclosed fence.md: no line break at the end, Track Changes off',
      doc: 'A paragraph above.⏎⏎```js⏎const total = items.length;⏎console.log(total);‸',
      keys: ['Alt-ArrowUp'],
      tc: false,
      expect: {
        file: '```js⏎const total = items.length;⏎console.log(total);⏎```⏎⏎A paragraph above.',
      },
    },
    {
      name: 'the same, Track Changes on',
      doc: 'A paragraph above.⏎⏎```js⏎const total = items.length;⏎console.log(total);‸',
      keys: ['Alt-ArrowUp'],
      tc: true,
      expect: {
        caret:
          '<sub A paragraph above.⏎⏎```js⏎const total = items.length;⏎console.log(total);>⏎⏎```js⏎const total = items.length;⏎console.log(total);‸⏎```⏎⏎A paragraph above.⏎</sub>',
      },
    },
    {
      name: 'in a quote, to its first place, Track Changes on: nothing is lost (#1236 review)',
      doc: '> One.⏎>⏎> ```js⏎> x‸',
      keys: ['Alt-ArrowUp'],
      tc: true,
      expect: {
        file: '> ```js⏎> x⏎> ```⏎>⏎> One.',
        original: '> ```js⏎> x⏎> ```⏎>⏎> One.',
      },
    },
    {
      name: 'the same under a paragraph',
      doc: 'Intro.⏎⏎> One.⏎>⏎> ```js⏎> x‸',
      keys: ['Alt-ArrowUp'],
      tc: true,
      expect: {
        file: 'Intro.⏎⏎> ```js⏎> x⏎> ```⏎>⏎> One.',
        original: 'Intro.⏎⏎> ```js⏎> x⏎> ```⏎>⏎> One.',
      },
    },
    {
      name: 'the same under a heading in the quote',
      doc: '> # H⏎>⏎> ```js⏎> x‸',
      keys: ['Alt-ArrowUp'],
      tc: true,
      expect: { file: '> ```js⏎> x⏎> ```⏎>⏎> # H', original: '> ```js⏎> x⏎> ```⏎>⏎> # H' },
    },
    {
      name: 'the only block: nothing to move, nothing written',
      doc: '```js⏎x‸⏎',
      keys: ['Alt-ArrowUp'],
      tc: false,
      expect: { file: '```js⏎x⏎' },
    },
  ]);
});

describe('where the move can not be tracked (#1236 review)', () => {
  const DOC = '> One.\n>\n> ```js\n> x';
  const open: Editor[] = [];
  afterEach(() => {
    for (const editor of open.splice(0)) editor.destroy();
    document.body.replaceChildren();
  });

  function load(answer: UntrackedAnswer) {
    const parent = document.createElement('div');
    document.body.append(parent);
    const asked: string[] = [];
    const editor = createEditor(parent, {
      doc: DOC,
      author: { handle: 'ada', name: 'Ada' },
      tracking: true,
      askUntracked: {
        ask: (reason) => {
          asked.push(reason);
          return Promise.resolve(answer);
        },
        skip: () => false,
      },
    });
    open.push(editor);
    editor.view.dispatch({ selection: { anchor: DOC.length } });
    return { editor, asked };
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

  it('Cancel leaves the file as it was: no lone tracked fence', async () => {
    const { editor } = load('cancel');
    moveBlocks(editor.view, true);
    await tick();
    expect(editor.getDoc()).toBe(DOC);
    expect(editor.getParsed().marks).toEqual([]);
  });

  it('Make Edit writes the fence and the move untracked, as one step', async () => {
    const { editor } = load('make');
    moveBlocks(editor.view, true);
    await tick();
    expect(editor.getDoc()).toBe('> ```js\n> x\n> ```\n>\n> One.');
    expect(editor.getParsed().marks).toEqual([]);
    editor.undo();
    expect(editor.getDoc()).toBe(DOC);
  });
});
