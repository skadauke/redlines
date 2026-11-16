// @vitest-environment happy-dom
// The preview's decorations, kept and restyled only where a change can touch them (#696), are
// what drawing the whole document again would give: after edits, moves of the caret and steps of
// the parse, in a document of every kind of block.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import type { DecorationSet } from '@codemirror/view';
import { createEditor, type Editor } from './index.ts';
import { keptPreviewDecorations, previewDecorations } from './preview/decorations.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const WORDS = 'the quick brown fox jumps over a lazy dog while reviewers read every line';

function documentOf(blocks: number): string {
  const parts: string[] = [];
  for (let n = 0; n < blocks; n++) {
    parts.push(
      [
        `## Section ${n}`,
        `${WORDS} ${n}, with *emphasis*, **bold**, \`code\` and [a link](https://example.com/${n}).`,
        `- ${WORDS}\n- second *item*\n  1. nested one\n  2. nested two\n- [ ] a task`,
        `| a | b |\n| - | - |\n| ${n} | ${WORDS} |`,
        `> ${WORDS}\n> more`,
        '```ts\nconst x = 1;\n\nconst y = 2;\n```',
        `${n}. ${WORDS}\n${n + 1}. again`,
        '> [!NOTE]\n> a callout',
        '---',
        `line with a hard break  \nnext line ${n} <!--ins a${n}-->inserted<!--/a${n}-->`,
      ][n % 10]!,
    );
  }
  return parts.join('\n\n') + '\n';
}

/** What a set draws, as text: positions, sides and what the decoration is made of. */
function show(set: DecorationSet): string[] {
  const lines: string[] = [];
  for (const cursor = set.iter(); cursor.value; cursor.next()) {
    const { value } = cursor;
    const spec = value.spec as { class?: string; attributes?: object; widget?: object };
    lines.push(
      [
        cursor.from,
        cursor.to,
        value.startSide,
        spec.class ?? '',
        JSON.stringify(spec.attributes ?? null),
        spec.widget ? spec.widget.constructor.name : '',
      ].join('|'),
    );
  }
  return lines;
}

/** A small deterministic random generator. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const SNIPPETS = [
  'x',
  ' word ',
  '\n\n',
  '\n',
  '```\n',
  '- ',
  '> ',
  '# ',
  '**',
  '1. ',
  '|',
  '\n\n---\n\n',
  '<!--',
  '-->',
];

describe('restyling only what changed', () => {
  it.each([7, 11, 23, 41, 59])(
    'gives what drawing it all again gives, through edits, carets and the parse (seed %i)',
    (seed) => {
      const doc = documentOf(120);
      const parent = document.createElement('div');
      document.body.append(parent);
      const editor = createEditor(parent, { doc, author, view: 'redlines' });
      open.push(editor);
      const { view } = editor;
      const next = random(seed);
      const check = (what: string) => {
        const kept = show(keptPreviewDecorations(view.state));
        const fresh = show(previewDecorations(view.state));
        expect(kept, what).toEqual(fresh);
      };
      // The parse goes on in steps.
      for (let at = 2000; at < view.state.doc.length + 2000; at += 2000) {
        forceParsing(view, Math.min(at, view.state.doc.length), 10_000);
        check(`parse to ${at}`);
      }
      for (let step = 0; step < 160; step++) {
        const length = view.state.doc.length;
        const pos = Math.floor(next() * length);
        const kind = next();
        if (kind < 0.35) {
          const insert = SNIPPETS[Math.floor(next() * SNIPPETS.length)]!;
          view.dispatch({
            changes: { from: pos, insert },
            selection: { anchor: pos + insert.length },
          });
          check(`insert ${JSON.stringify(insert)} at ${pos}`);
        } else if (kind < 0.55) {
          const to = Math.min(length, pos + Math.floor(next() * 40));
          view.dispatch({ changes: { from: pos, to } });
          check(`delete ${pos}-${to}`);
        } else if (kind < 0.9) {
          view.dispatch({
            selection: { anchor: pos, head: Math.min(length, pos + Math.floor(next() * 30)) },
          });
          check(`select ${pos}`);
        } else {
          forceParsing(view, view.state.doc.length, 10_000);
          check('parse to the end');
        }
      }
    },
    60_000,
  );
});
