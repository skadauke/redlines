// @vitest-environment happy-dom
// ⌥↑ and ⌥↓ with the empty paragraph that Return opened (#872). The empty paragraph is no block of
// the file: with the caret in the block Return was pressed in, the move takes it back (as leaving it
// does) and moves the block as the file has it; with the caret in the empty paragraph itself there
// is nothing to move, and the key does nothing. Held to every invariant, Track Changes on and off.
import { scriptRows, type Script } from './script.ts';

const both = (rows: Omit<Script, 'tc'>[]): Script[] =>
  rows.flatMap((row) =>
    [true, false].map((tc) => ({
      ...row,
      tc,
      name: `${row.name}, Track Changes ${tc ? 'on' : 'off'}`,
    })),
  );

scriptRows(
  both([
    {
      name: '#872: Return at the start of a paragraph after a list, then ⌥↑',
      doc: '     ship delta⏎   - plan plan⏎⏎‸ship text text⏎- delta alpha',
      keys: ['Enter', 'Alt-ArrowUp'],
      expect: {},
    },
    {
      name: '#872: …then Backspace',
      doc: '   - plan plan⏎* alpha beta⏎⏎‸ship text text⏎- delta alpha',
      keys: ['Enter', 'Alt-ArrowUp', 'Backspace'],
      expect: {},
    },
    {
      name: 'Return at the start of a paragraph, then ⌥↑',
      doc: 'One.⏎⏎‸Two.⏎⏎Three.',
      keys: ['Enter', 'Alt-ArrowUp'],
      expect: { newest: 'Two.⏎⏎One.⏎⏎Three.' },
    },
    {
      name: 'Return at the end of a paragraph, ⌥↓ in the empty paragraph does nothing',
      doc: 'One.‸⏎⏎Two.',
      keys: ['Enter', 'Alt-ArrowDown'],
      expect: { newest: 'One.⏎⏎Two.' },
    },
  ]),
);
