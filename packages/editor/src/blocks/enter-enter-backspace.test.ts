// @vitest-environment happy-dom
// Enter, Enter, Backspace takes back one line break, and not both (#1024, from #17), in a
// paragraph, a bullet, a numbered item and a quote, with Track Changes on and off. A script is held
// to every invariant of the suite, among them that the file's decisions read alike in any order.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

const keys = ['Enter', 'Enter', 'Backspace'] as const;

describe('#1024: Enter, Enter, Backspace', () => {
  scriptRows([
    {
      name: 'in a paragraph, tracked',
      doc: 'Hello ‸world',
      keys: [...keys],
      tc: true,
      expect: { newest: 'Hello ⏎⏎world', original: 'Hello world' },
    },
    {
      name: 'in a paragraph, untracked',
      doc: 'Hello ‸world',
      keys: [...keys],
      tc: false,
      expect: { newest: 'Hello ⏎⏎world' },
    },
    {
      name: 'in a bullet, tracked',
      doc: '- Hello ‸world',
      keys: [...keys],
      tc: true,
      expect: { newest: '- Hello ⏎- world', original: '- Hello world' },
    },
    {
      name: 'in a numbered item, tracked',
      doc: '1. Hello ‸world',
      keys: [...keys],
      tc: true,
      expect: { newest: '1. Hello ⏎2. world', original: '1. Hello world' },
    },
    {
      name: 'in a quote, tracked',
      doc: '> Hello ‸world',
      keys: [...keys],
      tc: true,
      expect: { newest: '> Hello ⏎>⏎> world', original: '> Hello world' },
    },
  ]);

  // Item C of #17: Enter at the start, in the middle and at the end of a numbered item, then the
  // suite's decisions: accepted all or rejected all read as the newest and the original view.
  scriptRows(
    [
      ['at the start', '1. ‸one two', '1. ⏎2. one two'],
      ['in the middle', '1. one‸ two', '1. one⏎2.  two'],
      ['at the end', '1. one two‸', '1. one two⏎2. '],
    ].map(([where, doc, newest]) => ({
      name: `Enter ${where} of a numbered item`,
      doc: `${doc}⏎2. three`,
      keys: ['Enter' as const],
      tc: true,
      expect: { newest: `${newest}⏎2. three` },
    })),
  );
});
