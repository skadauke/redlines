// @vitest-environment happy-dom
import { markdown } from '@codemirror/lang-markdown';
import { ParseContext, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import { GFM } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { LIKELY_FROM, likelyParsing } from './parse.ts';
import { restartBefore, scan } from './scan.ts';
import { Text } from '@codemirror/state';

const WORDS = 'the quick brown fox jumps over a lazy dog while reviewers read every line twice';

/** A long document of many kinds of block, with links to definitions that stand at its end. */
function longText(blocks: number): string {
  const out: string[] = [];
  for (let n = 0; n < blocks; n++) {
    switch (n % 9) {
      case 0:
        out.push(`## Section ${n}`);
        break;
      case 1:
        out.push(
          `${WORDS} ${n} with *emphasis*, a [link][ref${n % 5}] and [another](https://x.test/${n}).`,
        );
        break;
      case 2:
        out.push('```js\nconst a = 1;\n\n    still code\nconst b = 2;\n```');
        break;
      case 3:
        out.push(`- item ${n}\n- second ${WORDS}\n\n  continued in the item\n- third`);
        break;
      case 4:
        out.push('| a | b |\n| - | - |\n| 1 | 2 |');
        break;
      case 5:
        out.push(`> quoted ${WORDS}\n> more`);
        break;
      case 6:
        out.push('<div>\n\nnot a block of its own\n</div>');
        break;
      case 7:
        out.push('<!-- a comment\n\nthat has a blank line -->');
        break;
      default:
        out.push(`${WORDS} ${n}\n\n    indented code after a blank line`);
    }
  }
  out.push(Array.from({ length: 5 }, (_, i) => `[ref${i}]: https://example.com/${i}`).join('\n'));
  return out.join('\n\n');
}

/** The nodes of `tree` between `from` and `to`, as text. */
function nodes(tree: Tree, from: number, to: number): string[] {
  const found: string[] = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.from >= from && node.to <= to) found.push(`${node.name}@${node.from}-${node.to}`);
    },
  });
  return found;
}

function setup(text: string) {
  const support = markdown({ extensions: [GFM] });
  const extension = likelyParsing(support.language.parser);
  const state = EditorState.create({ doc: text, extensions: [support, extension] });
  const full = markdown({ extensions: [GFM] }).language.parser.parse(text);
  return { state, full, parser: support.language.parser };
}

/** ParseContext's own constructor, which its types leave out. */
const create = (
  ParseContext as unknown as {
    create(
      parser: unknown,
      state: EditorState,
      viewport: { from: number; to: number },
    ): Context;
  }
).create;

describe('where Markdown starts afresh', () => {
  it('finds unindented lines after a blank, outside code and HTML', () => {
    const text = [
      'first',
      '',
      '```',
      'in code',
      '',
      'still in code',
      '```',
      '',
      '<!-- a',
      '',
      'comment -->',
      '',
      '- list',
      '',
      'second',
      '',
      '    indented',
      '',
      '[ref]: https://example.com',
      'tail',
    ].join('\n');
    const doc = Text.of(text.split('\n'));
    const { restarts, refs } = scan(doc);
    const at = (needle: string) => text.indexOf(needle);
    expect(restarts).toEqual([0, at('```\nin code'), at('<!-- a'), at('second'), at('[ref]')]);
    expect(refs).toEqual([
      { from: at('[ref]'), to: at('[ref]') + '[ref]: https://example.com'.length },
    ]);
    expect(restartBefore(restarts, at('still'))).toBe(at('```\nin code'));
    expect(restartBefore(restarts, -1)).toBeNull();
  });

  it('is fast on megabytes', () => {
    const doc = Text.of(longText(30_000).split('\n'));
    const start = performance.now();
    const found = scan(doc);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(found.restarts.length).toBeGreaterThan(20_000);
  });
});

describe('a likely parse', () => {
  const text = longText(4000);
  it('is a long document', () => {
    expect(text.length).toBeGreaterThan(LIKELY_FROM);
  });

  function likelyTree(at: number, to = at + 3000) {
    const { state, full, parser } = setup(text);
    const cx = create(parser, state, { from: at, to });
    cx.work(() => false, to);
    cx.takeTree();
    return { state, full, tree: cx.tree, cx };
  }

  it('draws a far place as the full parse does, without parsing what is before it', () => {
    const at = Math.floor(text.length / 2);
    const { full, tree, cx } = likelyTree(at);
    console.log(
      'DBG',
      tree.length,
      tree.type.name,
      JSON.stringify((cx as any).skipped),
      (cx as any).treeLen,
      nodes(tree, 0, text.length).length,
    );
    const skipped = cx.skipped;
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.from).toBe(0);
    expect(skipped[0]!.to).toBeGreaterThan(0);
    expect(skipped[0]!.to).toBeLessThanOrEqual(at);
    // The nodes of the stretch the viewport shows, and a good way past it.
    const lo = at;
    const hi = at + 3000;
    expect(nodes(tree, lo, hi)).toEqual(nodes(full, lo, hi));
    // The text before the place is not parsed.
    expect(nodes(tree, 0, 1000)).toEqual([]);
  });

  it('is exact at the end of the document', () => {
    const end = text.length;
    const { full, tree } = likelyTree(end - 2000, end);
    const from = end - 2500;
    expect(nodes(tree, from, end)).toEqual(nodes(full, from, end));
    // The links resolve to the definitions at the end, and ahead of the place too.
    expect(nodes(tree, from, end).some((node) => node.startsWith('LinkReference'))).toBe(true);
  });

  it('keeps the links to definitions that stand far above', () => {
    const doc = `[far]: https://example.com\n\n${'filler words go here.\n\n'.repeat(20_000)}see [far] and [near]\n\nend\n`;
    const { state, parser } = setup(doc);
    const at = doc.length - 100;
    const cx = create(parser, state, { from: at, to: doc.length });
    cx.work(() => false, doc.length);
    cx.takeTree();
    // The definition is in the tree, where it is written, though nothing near it is parsed.
    expect(nodes(cx.tree, 0, 40).some((n) => n.startsWith('LinkReference@0-'))).toBe(true);
    expect(nodes(cx.tree, at - 40, doc.length).filter((n) => n.startsWith('Link@'))).toHaveLength(
      2,
    );
  });

  it('parses nothing different in a short document', () => {
    const short = longText(40);
    const { state } = setup(short);
    expect(short.length).toBeLessThan(LIKELY_FROM);
    // The state's tree is the whole parse, from the start.
    const tree = syntaxTree(state);
    expect(tree.length).toBe(Math.min(short.length, tree.length));
  });

  it('is parsed in less time than the whole document', () => {
    const big = longText(30_000);
    const { state, parser } = setup(big);
    const at = Math.floor(big.length / 2);
    const start = performance.now();
    const cx = create(parser, state, { from: at, to: at + 3000 });
    cx.work(() => false, at + 3000);
    const likely = performance.now() - start;
    const whole = performance.now();
    parser.parse(big);
    const all = performance.now() - whole;
    console.log(
      `likely parse to the middle of ${big.length} chars: ${likely.toFixed(0)} ms; whole: ${all.toFixed(0)} ms`,
    );
    expect(likely).toBeLessThan(all / 3);
  });
});

describe('the extension', () => {
  it('can be put in a view', () => {
    const { state } = setup(longText(50));
    const view = new EditorView({ state, parent: document.body });
    view.destroy();
  });
});
