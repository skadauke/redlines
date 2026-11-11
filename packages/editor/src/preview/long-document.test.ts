// @vitest-environment happy-dom
import { markdown } from '@codemirror/lang-markdown';
import { forceParsing } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, parsedField, type ViewMode } from '../index.ts';
import { idFor, longDocument } from '../test-documents.ts';
import { buildTables, type Table, tablesField, tablesOf } from '../table/model.ts';
import { trackedDecorations } from '../tracked/decorations.ts';
import { previewDecorations } from './decorations.ts';

/** Tables without their identities, which a rebuild gives new. */
const bare = (tables: readonly Table[]) => tables.map((table) => ({ ...table, id: 0 }));

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const WORDS = 'the quick brown fox jumps over a lazy dog while reviewers read every line twice';

/** The tracked layer's widgets in a state, by what they draw. */
function list(state: EditorState): { widget: string }[] {
  const found: { widget: string }[] = [];
  trackedDecorations(state).between(0, state.doc.length, (_from, _to, value) => {
    const widget = (value.spec as { widget?: { constructor: { name: string } } }).widget;
    if (widget)
      found.push({ widget: widget.constructor.name === 'StruckWidget' ? 'struck' : 'other' });
  });
  return found;
}
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

function time(fn: () => void, runs = 15): number {
  fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return median(samples);
}

function editorFor(
  doc: string,
  resolveImage?: (src: string) => string | null,
  view?: ViewMode,
): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author: ada, resolveImage, view });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  open.push(editor);
  return editor;
}

// The budget for one update is a frame, 16 ms; doubled here for CI's slower machines. Measured
// on a development Mac it takes about 2 ms, with the parse a few ms more in the first read of a
// document and not at all in the update (the ledger is not read again, see `parsedField`).
const BUDGET_MS = 32;

describe('a long document', () => {
  const { doc, firstMark } = longDocument();
  const afterMark = firstMark + `<!--ins ${idFor(0)}-->quick brown<!--/${idFor(0)}-->`.length;
  const mid = Math.floor(doc.length / 2);

  function loaded(view?: ViewMode) {
    const editor = editorFor(doc, (src) => `asset://${src}`, view);
    return editor.view.state;
  }

  it('is the size the budget is measured for', () => {
    const state = loaded();
    expect(doc.split(/\s+/).length).toBeGreaterThanOrEqual(5000);
    expect(state.field(parsedField).marks.length).toBeGreaterThanOrEqual(200);
    let images = 0;
    previewDecorations(state).between(0, state.doc.length, (from, _to, value) => {
      if ((value.spec as { widget?: unknown }).widget && state.sliceDoc(from, from + 2) === '![') {
        images++;
      }
    });
    expect(images).toBe(20);
    let boxes = 0;
    let entities = 0;
    previewDecorations(state).between(0, state.doc.length, (from, _to, value) => {
      if (!(value.spec as { widget?: unknown }).widget) return;
      if (/^[-*+] \[[ x]\] /.test(state.sliceDoc(from, from + 6))) boxes++;
      else if (state.sliceDoc(from, from + 1) === '&') entities++;
    });
    expect(boxes).toBe(30);
    expect(entities).toBe(45);
  });

  it('updates decorations for one keystroke in under 16 ms on the long document', () => {
    const state = loaded();
    const keystroke = time(() => state.update({ changes: { from: mid, insert: 'x' } }).state);
    const afterAMark = time(
      () => state.update({ changes: { from: afterMark, insert: 'x' } }).state,
    );
    expect(keystroke).toBeLessThan(BUDGET_MS);
    expect(afterAMark).toBeLessThan(BUDGET_MS);
  });

  it('updates decorations for a caret move in under 16 ms on the long document', () => {
    const state = loaded();
    expect(time(() => state.update({ selection: { anchor: mid } }).state)).toBeLessThan(BUDGET_MS);
  });

  it('holds the same bounds in Simple, which draws every change as a bar', () => {
    const state = loaded('simple');
    expect(state.field(parsedField).marks.length).toBeGreaterThanOrEqual(200);
    const keystroke = time(() => state.update({ changes: { from: mid, insert: 'x' } }).state);
    const afterAMark = time(
      () => state.update({ changes: { from: afterMark, insert: 'x' } }).state,
    );
    const caret = time(() => state.update({ selection: { anchor: mid } }).state);
    expect(keystroke).toBeLessThan(BUDGET_MS);
    expect(afterAMark).toBeLessThan(BUDGET_MS);
    expect(caret).toBeLessThan(BUDGET_MS);
  });
});

describe('a long document with deleted blocks', () => {
  // 150 KB and 200 marks, 50 of them paragraphs, headings and items deleted whole (design: Part 3),
  // which Redlines draws as blocks. A keystroke and a caret move cost what they do on the same
  // document without them.
  const build = (deleted: boolean) => {
    const ids = Array.from({ length: 200 }, (_, i) => idFor(2000 + i));
    const paragraphs: string[] = [];
    let inserted = 0;
    let removed = 0;
    for (let n = 0; n < 760; n++) {
      let text = `${WORDS} ${n} with *emphasis* and **strong** and a [link](https://example.com/${n}) end, and words to fill the line out to a couple of hundred characters in all, so the document is long.`;
      if (n % 5 === 0 && inserted < 150) {
        const id = ids[inserted++];
        text = text.replace('quick brown', `<!--ins ${id}-->quick brown<!--/${id}-->`);
      }
      paragraphs.push(text);
      if (deleted && n % 15 === 7 && removed < 50) {
        const id = ids[150 + removed++]!;
        const block = [
          'A paragraph that was deleted whole.',
          '## A heading that was deleted',
          'Another paragraph deleted, a little longer than the first one.',
        ][removed % 3]!;
        paragraphs.push(`<!--del ${id} ${block}\\n\\n-->`);
      }
    }
    const marks = ids
      .slice(0, deleted ? 200 : 150)
      .map((id) => `  ${id}: {by: bo, at: 2026-10-31T09:30Z}\n`)
      .join('');
    return `${paragraphs.join('\n\n')}\n\n<!-- redlines\nversion: 1\nmarks:\n${marks}-->\n`;
  };
  const withBlocks = build(true);
  const without = build(false);

  it('is the size the budget is measured for, with 50 blocks drawn in Redlines', () => {
    expect(withBlocks.length).toBeGreaterThanOrEqual(150_000);
    const editor = editorFor(withBlocks);
    expect(editor.view.state.field(parsedField).marks.length).toBe(200);
    // Every one of the 50 is drawn as a block, in view or not: the decorations hold them all.
    const widgets = list(editor.view.state).filter((d) => d.widget === 'struck');
    expect(widgets).toHaveLength(50);
  });

  it('holds the bound of Redlines without them, for a keystroke and a caret move', () => {
    const state = editorFor(withBlocks).view.state;
    const plain = editorFor(without).view.state;
    const at = Math.floor(withBlocks.length / 2);
    const atPlain = Math.floor(without.length / 2);
    const keystroke = time(() => state.update({ changes: { from: at, insert: 'x' } }).state);
    const keystrokePlain = time(
      () => plain.update({ changes: { from: atPlain, insert: 'x' } }).state,
    );
    const caret = time(() => state.update({ selection: { anchor: at } }).state);
    const caretPlain = time(() => plain.update({ selection: { anchor: atPlain } }).state);
    expect(keystroke).toBeLessThan(BUDGET_MS);
    expect(caret).toBeLessThan(BUDGET_MS);
    // And near what it costs without them: the blocks are 50 widgets more among 150 marks.
    expect(keystroke).toBeLessThan(Math.max(BUDGET_MS / 2, keystrokePlain * 2));
    expect(caret).toBeLessThan(Math.max(BUDGET_MS / 2, caretPlain * 2));
  });
});

describe('a long document with a table', () => {
  const { doc } = longDocument({ table: true });
  /** A position in the text of the cell in column 3 of row 150, and its row's start. */
  const cell = doc.indexOf('item 150 |') + 'item 150 | 150 | place 150 | the'.length;
  const header = doc.indexOf('| Item |');

  function loaded() {
    const editor = editorFor(doc, (src) => `asset://${src}`);
    return editor.view.state;
  }

  it('has a 300-row table of 5 columns with 40 marks in its cells', () => {
    const state = loaded();
    const [table] = tablesOf(state);
    expect(table?.rows).toHaveLength(301);
    expect(table?.columns).toBe(5);
    const table0 = doc.slice(header, doc.indexOf('\n\n', header));
    expect((table0.match(/<!--ins /g) ?? []).length).toBe(40);
    expect(state.field(parsedField).marks.length).toBeGreaterThanOrEqual(280);
  });

  it('updates for one keystroke in a cell within the budget', () => {
    const state = loaded();
    const keystroke = time(() => state.update({ changes: { from: cell, insert: 'x' } }).state);
    expect(keystroke).toBeLessThan(BUDGET_MS);
  });

  it('updates for a caret move in the table within the budget', () => {
    const state = loaded();
    expect(time(() => state.update({ selection: { anchor: cell } }).state)).toBeLessThan(BUDGET_MS);
  });

  // A timing test: it runs with REDLINES_COST=check, as CI's check job sets, since a busy machine
  // can't time it. The rows a change rebuilds are pinned by count elsewhere (`layoutStats`).
  it.skipIf(!process.env['REDLINES_COST'])(
    'keeps the table layer’s share of a row edit small',
    () => {
      // A state with the markdown parse and nothing else, and one that has the tables too: what they
      // differ by is the layer's share.
      const make = (extra: boolean) => {
        const view = new EditorView({
          state: EditorState.create({
            doc,
            extensions: [markdown({ extensions: [GFM] }), ...(extra ? [tablesField] : [])],
          }),
          parent: document.body,
        });
        forceParsing(view, doc.length, 10_000);
        // The parse that went on is read by the field at the next transaction.
        const state = view.state.update({ selection: { anchor: 0 } }).state;
        view.destroy();
        return state;
      };
      const apply = (state: EditorState) => {
        const edit = () => state.update({ changes: { from: cell, insert: 'x' } }).state;
        edit();
        const runs: number[] = [];
        for (let i = 0; i < 60; i++) {
          const start = performance.now();
          edit();
          runs.push(performance.now() - start);
        }
        return median(runs);
      };
      const withState = make(true);
      expect(tablesOf(withState)[0]?.rows).toHaveLength(301);
      const plain = apply(make(false));
      const withTables = apply(withState);
      console.log(
        `table layer's share: ${(withTables - plain).toFixed(3)} ms (${plain.toFixed(2)} -> ${withTables.toFixed(2)})`,
      );
      // Under 1 ms here, and on a slower machine (CI's runners take about twice as long) under what the
      // markdown parse alone takes for the same edit: never a table read whole.
      expect(withTables - plain).toBeLessThan(Math.max(1, plain));
    },
  );

  it('keeps the tables of the state equal to a rebuild after keystrokes', () => {
    let state = loaded();
    const rows = [cell, doc.indexOf('item 7 |') + 4, doc.indexOf('item 299 |') + 5];
    for (const at of rows) {
      const here = state.doc.toString().indexOf(doc.slice(at - 4, at + 2));
      for (const insert of ['x', 'yz', ' ']) {
        state = state.update({ changes: { from: here + 4, insert } }).state;
        expect(bare(tablesOf(state))).toEqual(bare(buildTables(state)));
      }
      state = state.update({ changes: { from: here + 4, to: here + 5 } }).state;
      expect(bare(tablesOf(state))).toEqual(bare(buildTables(state)));
    }
  });
});
