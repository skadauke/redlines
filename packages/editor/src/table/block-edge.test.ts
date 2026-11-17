import { Text } from '@codemirror/state';
import { expect, it } from 'vitest';
import { blockEdge } from './model.ts';

/** What `blockEdge` is: a walk of up to 2000 lines, one line at a time. */
function walked(doc: Text, pos: number, up: boolean): number {
  let line = doc.lineAt(Math.max(0, Math.min(doc.length, pos)));
  for (let steps = 0; steps < 2000; steps++) {
    const next = up ? line.number - 1 : line.number + 1;
    if (next < 1 || next > doc.lines) break;
    line = doc.line(next);
    if (line.text.trim() === '') break;
  }
  return up ? line.from : line.to;
}

it('stops where a walk of the lines one at a time stops', () => {
  let seed = 5;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pieces = ['a', 'bb', ' ', '\t', '\n', '\n', '\n\n', '|', '\u00a0', '\u2028'];
  for (let i = 0; i < 1500; i++) {
    // Every tenth text has thousands of lines and no blank one: the walk ends at its limit.
    const long = i % 10 === 0;
    let text = '';
    const count = long ? 6000 : 1 + Math.floor(random() * 30);
    for (let j = 0; j < count; j++) {
      text += long && random() < 0.8 ? 'x\n' : pieces[Math.floor(random() * pieces.length)];
    }
    const doc = Text.of(text.split('\n'));
    for (let k = 0; k < 8; k++) {
      const pos = Math.floor(random() * (doc.length + 3)) - 1;
      for (const up of [true, false]) {
        expect(blockEdge(doc, pos, up), JSON.stringify([text.slice(0, 80), pos, up])).toBe(
          walked(doc, pos, up),
        );
      }
    }
  }
});
