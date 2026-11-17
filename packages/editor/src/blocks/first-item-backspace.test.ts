// @vitest-environment happy-dom
// Backspace at a file's first item, Track Changes on (#291): under front matter, and over another
// person's pending insertion. Each is held to every invariant of the suite.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

describe('#291: Backspace at a file’s first item, Track Changes on', () => {
  scriptRows([
    {
      name: 'under front matter',
      doc: '---⏎title: T⏎---⏎⏎- ‸one⏎- three',
      keys: ['Backspace'],
      tc: true,
      expect: { file: '---⏎title: T⏎---⏎⏎<del - >⏎⏎one⏎- three' },
    },
    {
      name: 'above another person’s inserted item',
      doc: '- ‸one<ins>⏎- two</ins>⏎- three',
      keys: ['Backspace'],
      tc: true,
      others: 'bo',
      expect: { file: '<del - >⏎⏎one<ins>⏎- two</ins>⏎- three' },
    },
  ]);
});
