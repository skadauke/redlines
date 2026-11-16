// @vitest-environment happy-dom
// Parsing a long document to its end costs time linear in its length (#696): every step of the
// background parse restyles what it added, not the whole document again.
import { deleteCharBackward } from '@codemirror/commands';
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor } from './index.ts';
import { idFor } from './test-documents.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const WORDS = 'the quick brown fox jumps over a lazy dog while reviewers read every line twice';

/** A document of about `bytes` bytes of headings, lists, tables, quotes and code. */
function documentOf(bytes: number): string {
  const parts: string[] = [];
  let size = 0;
  for (let n = 0; size < bytes; n++) {
    const part =
      n % 10 === 0
        ? `## Section ${n}`
        : n % 10 === 3
          ? `- ${WORDS} ${n}\n- second *item* with [a link](https://example.com/${n})\n  1. nested`
          : n % 10 === 5
            ? `| a | b |\n| - | - |\n| ${n} | ${WORDS} |`
            : n % 10 === 7
              ? `> ${WORDS} ${n}`
              : n % 10 === 8
                ? '```ts\nconst x = 1;\n```'
                : `${WORDS} ${n}, with *emphasis*, **bold** and <!--ins a${n}-->an insertion<!--/a${n}--> in it.`;
    parts.push(part);
    size += part.length + 2;
  }
  return parts.join('\n\n') + '\n';
}

/** Milliseconds to parse a document to its end in steps of 10 KB, as the background parse does. */
function parseAll(doc: string): number {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, view: 'redlines' });
  open.push(editor);
  const chunk = 10_000;
  const started = performance.now();
  for (let at = chunk; at < doc.length + chunk; at += chunk) {
    forceParsing(editor.view, Math.min(at, doc.length), 60_000);
  }
  return performance.now() - started;
}

describe('parsing a long document to its end', () => {
  it('costs time linear in its length', () => {
    const small = documentOf(150_000);
    const large = documentOf(600_000);
    parseAll(small); // warm up
    // The best of two runs each, so that a busy machine doesn't decide it.
    const a = Math.min(parseAll(small), parseAll(small));
    const b = Math.min(parseAll(large), parseAll(large));
    console.log(
      `parse cost: ${small.length} -> ${a.toFixed(0)} ms, ${large.length} -> ${b.toFixed(0)} ms`,
    );
    // Four times the text: linear is 4x; quadratic is 16x.
    // Before the restyling was incremental it was 12 to 16.
    expect(b / a).toBeLessThan(8.5);
  }, 120_000);
});

/** A document of about `bytes` bytes with an insertion in each paragraph, and its ledger. */
function markedDocument(bytes: number): string {
  const ids = Array.from({ length: Math.ceil(bytes / 90) }, (_, n) => idFor(n));
  const parts: string[] = [];
  let size = 0;
  for (let n = 0; size < bytes; n++) {
    const text = `${WORDS} <!--ins ${ids[n]}-->inserted ${n}<!--/${ids[n]}--> end.`;
    parts.push(text);
    size += text.length + 2;
  }
  const entries = ids
    .slice(0, parts.length)
    .map((id) => `  ${id}: {by: bo, at: 2026-10-31T09:30Z}\n`)
    .join('');
  return `${parts.join('\n\n')}\n\n<!-- redlines\nversion: 1\nmarks:\n${entries}-->\n`;
}

/** Milliseconds for a tracked Backspace over a selection of all the text but its ends. */
function deleteAll(doc: string): number {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, view: 'redlines' });
  open.push(editor);
  editor.setTracking(true);
  const { view } = editor;
  view.dispatch({ selection: { anchor: 1, head: doc.indexOf('\n\n<!-- redlines') - 1 } });
  const started = performance.now();
  deleteCharBackward(view);
  return performance.now() - started;
}

// A timing test: it runs when REDLINES_COST is set, as CI's check job does (a busy machine can't
// time it).
describe.skipIf(!process.env['REDLINES_COST'])(
  'deleting a large range with Track Changes on',
  () => {
    it('costs time linear in the size of the range (#744)', () => {
      const small = markedDocument(20_000);
      const large = markedDocument(80_000);
      deleteAll(small); // warm up
      const a = Math.min(deleteAll(small), deleteAll(small));
      const b = Math.min(deleteAll(large), deleteAll(large));
      console.log(
        `deleting: ${small.length} -> ${a.toFixed(0)} ms, ${large.length} -> ${b.toFixed(0)} ms`,
      );
      // Four times the text: linear is 4x; quadratic is 16x. It was 14 before each marker on the
      // old text's one long line searched the line for its start.
      expect(b / a).toBeLessThan(8.5);
    }, 120_000);
  },
);
