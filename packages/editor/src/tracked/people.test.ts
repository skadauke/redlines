// @vitest-environment happy-dom
// A machine's people (design §5.5): each keeps the color given when first met.

import { EditorView } from '@codemirror/view';
import { parse } from '@redlines/format';
import { describe, expect, it } from 'vitest';
import { createEditor, type MetPerson } from '../index.ts';
import { assignColors, meetPeople, unmetIn } from './colors.ts';

/** A document with one insertion by each author. */
function docBy(...authors: string[]): string {
  const ids = authors.map((_, i) => `bbb${i + 2}`);
  const body = ids.map((id) => `<!--ins ${id}-->${id} <!--/${id}-->`).join('');
  const marks = ids.map((id, i) => `  ${id}: {by: ${authors[i]}, at: 2026-10-31T09:30Z}\n`);
  return `Text ${body}\n\n<!-- redlines\nversion: 1\nmarks:\n${marks.join('')}-->\n`;
}

const colorsIn = (text: string, me: string, met?: readonly MetPerson[]) =>
  Object.fromEntries(assignColors(parse(text), me, met));

describe('meetPeople', () => {
  it('gives each new person the next color, 2 to 8, then around again', () => {
    const handles = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const met = meetPeople([], handles);
    expect(met.map((p) => p.color)).toEqual([2, 3, 4, 5, 6, 7, 8, 2, 3]);
    expect(met.map((p) => p.handle)).toEqual(handles);
  });

  it('keeps who is met, and skips an unknown author and anyone already met', () => {
    const met = meetPeople([{ handle: 'a', color: 2 }], ['a', 'unknown', 'b']);
    expect(met).toEqual([
      { handle: 'a', color: 2 },
      { handle: 'b', color: 3 },
    ]);
    const same = meetPeople(met, ['a', 'b']);
    expect(same).toBe(met);
  });
});

describe('assignColors with a record of people', () => {
  it('gives people the colors they were given, whatever the handle', () => {
    const met = [
      { handle: 'zed', color: 2 },
      { handle: 'amy', color: 3 },
    ];
    expect(colorsIn(docBy('amy', 'zed'), 'me', met)).toEqual({ me: 1, zed: 2, amy: 3 });
  });

  it('keeps a person’s color in a document of other people', () => {
    const met = meetPeople([], ['bo', 'cy', 'di']);
    expect(colorsIn(docBy('bo', 'cy'), 'me', met)).toMatchObject({ bo: 2, cy: 3 });
    expect(colorsIn(docBy('di', 'cy'), 'me', met)).toMatchObject({ cy: 3, di: 4 });
  });

  it('gives someone not yet met the next color in order, as the host will record it', () => {
    const met = [{ handle: 'bo', color: 2 }];
    expect(colorsIn(docBy('bo', 'cy', 'ann'), 'me', met)).toEqual({
      me: 1,
      bo: 2,
      ann: 3,
      cy: 4,
    });
  });

  it('gives you the first color, and an unknown author gray, however they are recorded', () => {
    const met = [{ handle: 'me', color: 4 }];
    const colors = colorsIn(docBy('me', 'unknown', 'bo'), 'me', met);
    // Bo is the second entry the record would hold, as `meetPeople` will give it.
    expect(colors).toEqual({ me: 1, unknown: 0, bo: 3 });
  });

  it('gives the later-met of two people with one color the next free one, in this document', () => {
    // Eight people met: the eighth (p8) took color 2 again, as the first (p1) did.
    const met = meetPeople([], ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    expect(met[7]?.color).toBe(2);
    const both = colorsIn(docBy('p8', 'p1'), 'me', met);
    expect(both).toMatchObject({ p1: 2, p8: 3 });
    // Alone, p8 has its own color, and the record is as it was.
    expect(colorsIn(docBy('p8'), 'me', met)).toMatchObject({ p8: 2 });
    expect(met[7]?.color).toBe(2);
  });

  it('shares no color among seven others', () => {
    const people = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12'];
    const met = meetPeople([], people);
    // Seven people whose recorded colors collide: p1, p8 (2), p2, p9 (3), p3, p10 (4), p4 (5).
    const seven = ['p1', 'p8', 'p2', 'p9', 'p3', 'p10', 'p4'];
    const colors = assignColors(parse(docBy(...seven)), 'me', met);
    expect(new Set(seven.map((p) => colors.get(p))).size).toBe(7);
  });

  it('is exactly today’s colors without a record', () => {
    const text = docBy('bo', 'ada', 'claude-ada');
    expect(colorsIn(text, 'cy')).toEqual({ cy: 1, ada: 5, bo: 3, 'claude-ada': 4 });
    // Even as an unknown author, you have the first color, as without the record.
    expect(colorsIn(docBy('unknown', 'bo'), 'unknown')).toEqual({ unknown: 1, bo: 3 });
  });
});

describe('a newcomer’s color', () => {
  it('is the color the host records for them, also when the record holds you', () => {
    // Your handle was met under an earlier identity, before you set it.
    const met = [
      { handle: 'stephan', color: 2 },
      { handle: 'bo', color: 3 },
    ];
    const drawn = colorsIn(docBy('cy'), 'stephan', met).cy;
    const recorded = meetPeople(met, unmetIn(parse(docBy('cy')), 'stephan', met)).at(-1)?.color;
    expect(drawn).toBe(recorded);
  });

  it('treats a color that is not 2 to 8 as invalid', () => {
    expect(colorsIn(docBy('bo'), 'me', [{ handle: 'bo', color: 2.5 }]).bo).toBe(2);
    expect(colorsIn(docBy('bo'), 'me', [{ handle: 'bo', color: 1 }]).bo).toBe(2);
  });
});

describe('unmetIn', () => {
  it('lists the people of a document that the record lacks, in handle order', () => {
    const parsed = parse(docBy('cy', 'bo', 'unknown', 'me', 'ann'));
    expect(unmetIn(parsed, 'me', [{ handle: 'bo', color: 2 }])).toEqual(['ann', 'cy']);
  });
});

describe('createEditor with a record of people', () => {
  const author = { handle: 'me', name: 'Me' };
  const mount = (doc: string, extra: object) => {
    const parent = document.createElement('div');
    document.body.append(parent);
    return createEditor(parent, { doc, author, ...extra });
  };
  const barClass = (editor: ReturnType<typeof mount>, text: string) =>
    [...editor.view.dom.querySelectorAll('.rl-ins')].find((el) => el.textContent?.includes(text))
      ?.className ?? '';

  it('tells the host about people it has no color for, once each', async () => {
    const asked: string[][] = [];
    const editor = mount(docBy('bo', 'cy'), {
      people: [{ handle: 'bo', color: 2 }],
      onNewPeople: (handles: string[]) => asked.push([...handles]),
    });
    await Promise.resolve();
    expect(asked).toEqual([['cy']]);
    // The host records them and hands the record back: nothing is asked again.
    editor.setPeople([
      { handle: 'bo', color: 2 },
      { handle: 'cy', color: 3 },
    ]);
    editor.setDoc(docBy('bo', 'cy'));
    expect(asked).toEqual([['cy']]);
    // A document with someone new asks about them alone.
    editor.setDoc(docBy('bo', 'dee'));
    expect(asked).toEqual([['cy'], ['dee']]);
  });

  it('lets the host answer from the callback, also for the first document', async () => {
    const record = [{ handle: 'bo', color: 2 }];
    const editor: ReturnType<typeof mount> = mount(docBy('bo', 'cy'), {
      people: record,
      onNewPeople: (handles: string[]) => editor.setPeople(meetPeople(record, handles)),
    });
    await Promise.resolve();
    expect(editor.view.dom.textContent).toContain('bbb3');
    expect(barClass(editor, 'bbb3')).toContain('rl-author-3');
  });

  it('asks again about a person the record still lacks after a new record arrives', async () => {
    const asked: string[][] = [];
    const editor = mount(docBy('bo', 'cy'), {
      people: [],
      onNewPeople: (handles: string[]) => asked.push([...handles]),
    });
    await Promise.resolve();
    expect(asked).toEqual([['bo', 'cy']]);
    // Another window won a race: its record has Bo, not Cy.
    editor.setPeople([{ handle: 'bo', color: 2 }]);
    expect(asked).toEqual([['bo', 'cy'], ['cy']]);
  });

  it('asks when an edit brings someone new', () => {
    const asked: string[][] = [];
    const first = docBy('bo');
    const editor = mount(first, {
      people: [{ handle: 'bo', color: 2 }],
      onNewPeople: (handles: string[]) => asked.push([...handles]),
    });
    editor.view.dispatch({
      changes: { from: 0, to: editor.view.state.doc.length, insert: docBy('bo', 'zed') },
    });
    expect(asked).toEqual([['zed']]);
  });

  it('asks nothing without a record, and the colors are as they were', () => {
    const asked: string[][] = [];
    const editor = mount(docBy('bo'), { onNewPeople: (h: string[]) => asked.push(h) });
    expect(asked).toEqual([]);
    expect(barClass(editor, 'bbb2')).toContain('rl-author-3');
  });

  it('draws a person in the color of the record, and redraws when it changes', () => {
    const editor = mount(docBy('bo'), { people: [{ handle: 'bo', color: 6 }] });
    expect(barClass(editor, 'bbb2')).toContain('rl-author-6');
    editor.setPeople([{ handle: 'bo', color: 4 }]);
    expect(barClass(editor, 'bbb2')).toContain('rl-author-4');
  });

  it('does not redraw for the same record again', () => {
    let updates = 0;
    const editor = mount(docBy('bo'), {
      people: [{ handle: 'bo', color: 6 }],
      extensions: [EditorView.updateListener.of(() => updates++)],
    });
    editor.setPeople([{ handle: 'bo', color: 6 }]);
    expect(updates).toBe(0);
    editor.setPeople([{ handle: 'bo', color: 5 }]);
    expect(updates).toBe(1);
  });
});
