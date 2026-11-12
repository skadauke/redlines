// @vitest-environment happy-dom
// Bold and italic over a rectangle of cells with Track Changes on (issue #267): written as one
// change group however many cells, and read alike in every order of decisions, judged by micromark
// (format §3.7, "Cells apart"). The 300-row table is judged by accepting all and rejecting all; the
// small ones in every order.
import { forceParsing } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EditError,
  accept,
  acceptAll,
  applyChanges,
  newestView,
  originalView,
  parse,
  reject,
  rejectAll,
} from '@redlines/format';
import { createFormatting } from '../../../../plugins/formatting/src/index.ts';
import { createEditor, type Editor } from '../index.ts';
import { longDocument } from '../test-documents.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** A file with the ledger of `body`, whose marks are Bo's (`marks`) or Ada's. */
function file(body: string, marks: Record<string, string> = {}): string {
  const entries = Object.entries(marks).map(
    ([id, by]) => `  ${id}: {by: ${by}, at: 2026-10-13T22:30Z}`,
  );
  const ledger = [
    '<!-- redlines',
    'version: 1',
    'people:',
    '  ada: {name: Ada Lovelace}',
    '  bo: {name: Bo Chen}',
  ];
  if (entries.length > 0) ledger.push('marks:', ...entries);
  return `${body}\n\n${[...ledger, '-->'].join('\n')}\n`;
}

/**
 * Every order of accepting and rejecting the changes of a file: each set of decisions reads as one
 * newest view whatever the order, no order is stuck with changes left, and every state on the way
 * is a file whose newest view is the newest view of the file after those decisions (format §3.7).
 */
function expectEveryOrderAlike(label: string, text: string): number {
  const outcomes = new Map<string, Set<string>>();
  const seen = new Set<string>();
  let states = 0;
  const walk = (current: string, decided: string[]) => {
    const key = `${current}|${decided.toSorted().join(' ')}`;
    if (seen.has(key)) return;
    seen.add(key);
    states++;
    const left = [
      ...new Set(
        parse(current)
          .marks.filter((mark) => mark.kind !== 'cmt' && mark.kind !== 'hl')
          .map((mark) => mark.id),
      ),
    ];
    if (left.length === 0) {
      const set = decided.toSorted().join(' ');
      const results = outcomes.get(set) ?? new Set<string>();
      results.add(current.replace(/\n\n<!-- redlines[\s\S]*$/, '\n'));
      outcomes.set(set, results);
      return;
    }
    let any = false;
    for (const id of left) {
      for (const [how, decide] of [
        ['a', accept],
        ['r', reject],
      ] as const) {
        let next: string;
        try {
          next = applyChanges(current, decide(current, id));
        } catch (error) {
          if (!(error instanceof EditError)) throw error;
          continue;
        }
        any = true;
        walk(next, [...decided, `${how}${id}`]);
      }
    }
    expect(any, `${label}: stuck at ${current}`).toBe(true);
  };
  walk(text, []);
  for (const [decided, results] of outcomes) {
    expect([...results], `${label}: ${decided}`).toHaveLength(1);
  }
  return states;
}

type Command = 'format.bold' | 'format.italic';

/** The command over the rectangle from the text `first` to the end of the text `last`. */
function run(doc: string, first: string, last: string, command: Command) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const notices: string[] = [];
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    tracking: true,
  });
  open.push(editor);
  createFormatting(editor, {
    author: { handle: 'ada', name: 'Ada Lovelace' },
    notice: (message) => notices.push(message),
  });
  forceParsing(editor.view, editor.view.state.doc.length, 60_000);
  const anchor = doc.indexOf(first);
  const head = doc.indexOf(last) + last.length;
  editor.view.dispatch({ selection: { anchor, head } });
  const ran = editor.commands.run(command);
  return { ran, notices, after: editor.getDoc() };
}

/** The format changes the command wrote, and the groups they share. */
function written(before: string, after: string) {
  const old = new Set(parse(before).marks.map((mark) => mark.id));
  const fresh = parse(after).marks.filter((mark) => mark.kind === 'fmt' && !old.has(mark.id));
  const groups = new Set(fresh.map((mark) => parse(after).ledger.marks[mark.id]?.group));
  return { count: fresh.length, groups };
}

const WORD = { 'format.bold': '**', 'format.italic': '*' } as const;

describe.each(['format.bold', 'format.italic'] as const)('tracked %s over a column', (command) => {
  const mark = WORD[command];

  it('of the 300-row table is written as one group, and accepts and rejects whole', () => {
    const { doc } = longDocument({ table: true });
    const { ran, notices, after } = run(doc, 'Item |', 'item 299', command);
    expect(notices).toEqual([]);
    expect(ran).toBe(true);
    const { count, groups } = written(doc, after);
    expect(count).toBe(301);
    expect(groups.size).toBe(1);
    expect(groups.has(undefined)).toBe(false);
    const accepted = applyChanges(after, acceptAll(after));
    const shown = newestView(accepted).text;
    expect(shown).toContain(`| ${mark}Item${mark} |`);
    expect(
      shown.match(
        new RegExp(
          `\\| \\${mark.split('').join('\\')}item \\d+\\${mark.split('').join('\\')} \\|`,
          'g',
        ),
      ),
    ).toHaveLength(300);
    const rejected = applyChanges(after, rejectAll(after));
    const original = applyChanges(doc, rejectAll(doc));
    expect(originalView(rejected).text).toBe(originalView(original).text);
  }, 120_000);

  it('of a smaller table reads alike in every order of decisions', () => {
    const body = ['| Item | Note |', '| ---- | ---- |', '| one | alpha |', '| two | beta |'];
    const doc = file(body.join('\n'));
    const { ran, notices, after } = run(doc, 'Item', 'two', command);
    expect(notices).toEqual([]);
    expect(ran).toBe(true);
    expect(written(doc, after).count).toBe(3);
    expectEveryOrderAlike(`${command} over a column`, after);
  });

  it('over cells whose neighbours hold another person’s insertion, deletion and substitution', () => {
    const body = [
      '| Item | Note |',
      '| ---- | ---- |',
      '| one | al<!--ins k3x9-->p<!--/k3x9-->ha |',
      '| two | b<!--del m2bd-->e<!--/m2bd-->ta |',
      '| three | <!--sub p5qm gam-->ga<!--/p5qm-->mma |',
    ];
    const doc = file(body.join('\n'), { k3x9: 'bo', m2bd: 'bo', p5qm: 'bo' });
    const { ran, notices, after } = run(doc, 'Item', 'three', command);
    expect(notices).toEqual([]);
    expect(ran).toBe(true);
    expect(written(doc, after).count).toBe(4);
    expectEveryOrderAlike(`${command} beside cells with marks`, after);
  });

  it('refuses a cell that holds another person’s change, in words that name the cell and the person', () => {
    const body = [
      '| Item | Note |',
      '| ---- | ---- |',
      '| o<!--ins k3x9-->n<!--/k3x9-->e | alpha |',
      '| two | beta |',
    ];
    const doc = file(body.join('\n'), { k3x9: 'bo' });
    const { ran, notices, after } = run(doc, 'Item', 'two', command);
    expect(ran).toBe(false);
    expect(after).toBe(doc);
    expect(notices).toEqual([
      "Bo Chen's insertion is in the cell in row 1, column 1. Accept or reject it first, then format the cell.",
    ]);
  });
});
