// @vitest-environment happy-dom
// Return at the start of a nested first item, Track Changes on (#395): a task item, a tab-indented
// list and a link definition on the line above. Each is held to every invariant of the suite.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

describe('#395: Return at the start of a nested first item, in the shapes the first fix left', () => {
  scriptRows([
    {
      name: 'a task item keeps its box in the new item',
      doc: '- plan⏎  - [ ] ‸note⏎  - review',
      keys: ['Enter'],
      tc: true,
      expect: { file: '- plan<split>⏎⏎  - [ ] ⏎  - [ ] note⏎  - review' },
    },
    {
      name: 'a task item, then a letter',
      doc: '- plan⏎  - [ ] ‸note⏎  - review',
      keys: ['Enter', { type: 'x' }],
      tc: true,
      expect: {},
    },
    {
      name: 'a tab-indented list',
      doc: '-\tplan⏎\t-\t‸note⏎\t-\treview',
      keys: ['Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'a tab-indented list, then a letter',
      doc: '-\tplan⏎\t-\t‸note⏎\t-\treview',
      keys: ['Enter', { type: 'x' }],
      tc: true,
      expect: {},
    },
    {
      name: 'a link definition in the item above',
      doc: '- plan⏎⏎  [a]: http://x.y⏎  - ‸note⏎  - review',
      keys: ['Enter'],
      tc: true,
      expect: {},
    },
    {
      name: 'a link definition, then a letter',
      doc: '- plan⏎⏎  [a]: http://x.y⏎  - ‸note⏎  - review',
      keys: ['Enter', { type: 'x' }],
      tc: true,
      expect: {},
    },
    {
      name: 'a footnote definition in the item above',
      doc: '- plan⏎⏎  [^a]: Note.⏎  - ‸note⏎  - review',
      keys: ['Enter', { type: 'x' }],
      tc: true,
      expect: {},
    },
  ]);
});
