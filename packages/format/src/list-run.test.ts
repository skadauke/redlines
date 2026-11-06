import { describe, expect, it } from 'vitest';
import { lineStartsTouched, linesAboveStart, listGoesOnEveryWay } from './list-run.ts';
import { parse } from './parse.ts';
import { file } from './test-helpers.ts';
import { newestView, originalView } from './views.ts';

/** Whether Ada's item, the line of `text` with her block change, goes on with the list in every
 * decision of the changes above it. */
function everyWay(body: string, marks: Record<string, string>): boolean {
  const text = file(body, marks);
  const top = text.lastIndexOf('\n', text.indexOf('<!--fmt')) + 1;
  const parsed = parse(text);
  expect(parsed.warnings).toEqual([]);
  const payload = parsed.marks.find((mark) => mark.kind === 'fmt')?.segments[0]?.payload ?? '';
  return listGoesOnEveryWay(
    text,
    parsed,
    newestView(text),
    () => originalView(text),
    top,
    '.',
    payload,
  );
}

const ADA = '- <!--fmt m2bd was=ol=2.\\x20-->\n  delta<!--/m2bd-->\n\nEnd';

describe('a numbered item from 2 in every decision of the changes above it (format §2.6)', () => {
  it('goes on where nothing is pending above it, or nothing that moves a line', () => {
    expect(everyWay(`1. gamma beta\n${ADA}`, { m2bd: 'ada' })).toBe(true);
    // A word typed in the middle of a line.
    expect(
      everyWay(`1. gamma <!--ins k3x9-->big <!--/k3x9-->beta\n${ADA}`, { m2bd: 'ada', k3x9: 'bo' }),
    ).toBe(true);
  });

  it('does not where one decision ends the list and another starts it again', () => {
    // A split at the start of `gamma beta`, and an insertion of `1. new`, with a split inside it,
    // under it: accepting the first split and rejecting the inner one leaves a paragraph after an
    // empty item, which `2. delta` can't interrupt. Both views go on with the list.
    const body = `1. <!--split s3vb-->\ngamma beta<!--ins k3x9--><!--split h4kz-->\n1. new<!--/k3x9-->\n${ADA}`;
    expect(everyWay(body, { m2bd: 'ada', s3vb: 'bo', k3x9: 'bo', h4kz: 'bo' })).toBe(false);
  });

  it('goes on after Enter in the list, with the items after it renumbered', () => {
    // As the editor writes it: the split in a substitution of the next item's number, or apart
    // from substitutions that only renumber the items after it.
    const wrapped =
      '1. alpha one\n2. beta two<!--sub cpp9 \\n3. gamma--><!--split nhd8-->\n3. \n4. gamma<!--/cpp9--> three\n- <!--fmt m2bd was=ol=4.\\x20-->\n  delta four<!--/m2bd-->\n\nEnd';
    expect(everyWay(wrapped, { m2bd: 'ada', cpp9: 'bo', nhd8: 'bo' })).toBe(true);
    const apart =
      '1. alpha<!--split kph9-->\n2.  one<!--sub dg2p \\n2. beta-->\n3. beta<!--/dg2p--> two<!--sub t58x \\n3. gamma-->\n4. gamma<!--/t58x--> three\n- <!--fmt m2bd was=ol=4.\\x20-->\n  delta four<!--/m2bd-->\n\nEnd';
    expect(everyWay(apart, { m2bd: 'ada', kph9: 'bo', dg2p: 'bo', t58x: 'bo' })).toBe(true);
  });

  it('reads past a blank line that a pending split wrote', () => {
    // Accepted, the split parts `gamma` from `beta`; `1. new` starts the list again under it, but
    // not once its own split is rejected.
    const body = `1. gamma<!--split s3vb-->\n\nbeta<!--ins k3x9--><!--split h4kz-->\n1. new<!--/k3x9-->\n${ADA}`;
    const marks = { m2bd: 'ada', s3vb: 'bo', k3x9: 'bo', h4kz: 'bo' };
    expect(everyWay(body, marks)).toBe(false);
    const text = file(body, marks);
    expect(linesAboveStart(text, parse(text), text.indexOf('- <!--fmt'))).toBe(0);
    // A paragraph break at the end of the first item: with it or without it, `2. beta two` goes on
    // with the list.
    const loose = `1. alpha one<!--split s3vb-->\n\n2. beta two\n${ADA.replace('ol=2.', 'ol=3.')}`;
    expect(everyWay(loose, { m2bd: 'ada', s3vb: 'bo' })).toBe(true);
    // A blank line that is there in every decision parts the lines above it from the item.
    const apart = `1. <!--split s3vb-->\ngamma beta\n\n1. one\n${ADA}`;
    expect(everyWay(apart, { m2bd: 'ada', s3vb: 'bo' })).toBe(true);
  });

  it('reads a deletion and an insertion at one place in every decision of both', () => {
    // Rejected, the deletion brings back a blank line and a paragraph, after which `2.` is text
    // unless the insertion's `1. new` starts the list again: with both rejected it doesn't.
    const body = `1. alpha<!--del k3x9 \\n\\nfoo--><!--ins h4kz--><!--split g3rp-->\n1. new<!--/h4kz-->\n${ADA}`;
    expect(everyWay(body, { m2bd: 'ada', k3x9: 'bo', h4kz: 'bo', g3rp: 'bo' })).toBe(false);
  });

  it('reads many changes in one place without trying their decisions together', () => {
    // Words typed at the start of items, and Enter after them: every decision reads items.
    const line = (id: string, word: string, split?: string) =>
      `<!--ins ${id}-->\n   ${word} <!--/${id}-->text${split ? `<!--split ${split}-->` : ''}`;
    const marks = { m2bd: 'ada', k3x9: 'bo', h4kz: 'bo', g3rp: 'bo', d3x9: 'bo', q7wd: 'bo' };
    const head = `1. ${line('k3x9', 'x', 'h4kz')}\n2. ${line('g3rp', 'y', 'd3x9')}\n2. `;
    expect(everyWay(`${head}${line('q7wd', 'z')}\n${ADA}`, marks)).toBe(true);
  });

  it('reads past many blank lines that pending changes wrote in one pass', () => {
    // Every other item has a paragraph inserted after a blank line: the lines above the last item
    // reach to the top of the list, past every blank line, without looking at every change for each.
    const REST = 'bcdfghjkmnpqrstvwxz23456789';
    const id = (k: number) =>
      `b${[0, 1, 2].map((i) => REST[Math.floor(k / 27 ** i) % 27]).join('')}`;
    const marks: Record<string, string> = { m2bd: 'ada' };
    const lines: string[] = [];
    for (let i = 1; i < 4800; i++) {
      if (i % 2 === 0) lines.push(`${i}. item ${i}`);
      else {
        marks[id(i)] = 'bo';
        // Indented to the item's text, so that it is the item's second paragraph.
        const indent = ' '.repeat(String(i).length + 2);
        lines.push(`${i}. item ${i}<!--ins ${id(i)}-->\n\n${indent}para ${i}<!--/${id(i)}-->`);
      }
    }
    const text = file(`Intro\n\n${lines.join('\n')}\n${ADA.replace('ol=2.', 'ol=4800.')}`, marks);
    const parsed = parse(text);
    const top = text.indexOf('- <!--fmt');
    const newest = newestView(text);
    const start = performance.now();
    expect(linesAboveStart(text, parsed, top)).toBe(text.indexOf('1. item'));
    expect(listGoesOnEveryWay(text, parsed, newest, () => originalView(text), top, '.', '')).toBe(
      true,
    );
    expect(performance.now() - start).toBeLessThan(60);
  });

  it('finds the changes that stand at the start of a line', () => {
    const text = file(
      '1. <!--ins k3x9-->\n   very <!--/k3x9-->gamma <!--ins h4kz-->big<!--/h4kz-->',
      {
        k3x9: 'bo',
        h4kz: 'bo',
      },
    );
    const parsed = parse(text);
    expect(parsed.warnings).toEqual([]);
    const [start, middle] = parsed.marks;
    expect(start && lineStartsTouched(text, parsed, start, newestView(text))).toEqual([3]);
    expect(middle && lineStartsTouched(text, parsed, middle, newestView(text))).toEqual([]);
  });
});
