// @vitest-environment happy-dom
// Walk seeds of the deep run (`REDLINES_FUZZ=300`, the `deep.yml` workflow, run 44184581590), each
// as the smallest script that shows it. The invariants of the suite are held after every script.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

describe('walk seed 276: Return in the indentation of an indented code block opens the paragraph above it', () => {
  scriptRows([
    {
      name: 'after Return and a selection that leaves the empty paragraph, Shift-Return, Return',
      doc: '    ‸code ',
      keys: ['Enter', 'Shift-ArrowRight', 'Shift-Enter', 'Enter'],
      tc: false,
      expect: {},
    },
    {
      name: 'Return at the start of the line, ahead of the indentation, after a blank line',
      doc: 'x⏎⏎‸    code ',
      keys: ['Enter'],
      tc: false,
      expect: { file: 'x⏎⏎    code ' },
    },
  ]);
});

describe('walk seed 294: a decision that comes down on the open empty paragraph takes it back', () => {
  scriptRows([
    {
      name: 'Return twice at the end of the last heading, the insertion rejected, Track Changes on',
      doc: '## ship‸⏎',
      keys: ['Enter', 'Enter', { decide: 'reject' }],
      tc: true,
      expect: { file: '## ship⏎' },
    },
    {
      name: 'a letter typed in the first paragraph, Return after it, the insertion rejected',
      doc: 'ship‸⏎',
      keys: ['Enter', { type: 'x' }, 'Enter', { decide: 'reject' }],
      tc: true,
      expect: { file: 'ship⏎' },
    },
  ]);
});

describe('walk seed 281: Shift-Return at a thematic break is what Return is', () => {
  scriptRows([
    {
      name: 'at its start, Track Changes off',
      doc: 'x⏎⏎‸---⏎⏎y',
      keys: ['Shift-Enter'],
      tc: false,
      expect: { file: 'x⏎⏎---⏎⏎y' },
    },
    {
      name: 'at its end, Track Changes off',
      doc: 'x⏎⏎---‸⏎⏎y',
      keys: ['Shift-Enter'],
      tc: false,
      expect: { file: 'x⏎⏎---⏎⏎y' },
    },
    {
      name: 'after an agent wrote above it (the seed)',
      doc: '‸---',
      keys: [{ agent: 'The agent wrote this.' }, { type: 'new words ' }, 'Mod-z', 'Shift-Enter'],
      tc: false,
      expect: {},
    },
  ]);
});

describe('walk seed 270: Undo of an agent’s step leaves the caret out of a table’s hidden syntax', () => {
  scriptRows([
    {
      name: 'an agent’s paragraph above a table taken back (Mod-Shift-z is Undo in the walks)',
      doc: '| | |⏎| - | - |⏎text ship‸',
      keys: [
        { agent: 'The agent wrote this.' },
        'Enter',
        { agent: 'The agent wrote this.' },
        'Mod-Shift-z',
      ],
      tc: true,
      expect: {},
    },
  ]);
});

describe('walk seed 201: an agent’s edit on the open empty paragraph’s lines', () => {
  scriptRows([
    {
      name: 'Return before a paragraph whose text starts with a space, Track Changes on, then the edit',
      doc: '+ alpha⏎⏎   ‸gamma ',
      keys: ['Enter', { agent: 'The agent wrote this.' }],
      tc: true,
      expect: {},
    },
    {
      name: 'the same Return alone keeps the caret in its block',
      doc: '+ alpha⏎⏎   ‸gamma ',
      keys: ['Enter'],
      tc: true,
      expect: {},
    },
  ]);
});

describe('bare-marker walk seeds 80 and 260: Return in a bare marker whose write replaces the whole list', () => {
  scriptRows([
    {
      name: 'a numbered bare marker, a list after it (seed 80), Track Changes on',
      doc: '1) plan⏎2)‸⏎⏎1) ',
      keys: ['Enter'],
      tc: true,
      expect: { file: '1) plan⏎2)⏎⏎1) ' },
    },
    {
      name: 'a bare marker under a nested one (seed 260), Track Changes on',
      doc: '- alpha⏎  +⏎-‸⏎- ',
      keys: ['Enter'],
      tc: true,
      expect: { file: '- alpha⏎  +⏎-⏎- ' },
    },
  ]);
});
