// @vitest-environment happy-dom
// Tracked writes at block boundaries (#597, #601, #588): a key over a selection that starts in a
// block's syntax, a key in indented code before a `2.` item, and the bare marker's three walks. Each
// is held to the suite's invariants: micromark reads the file as it reads the newest view, and every
// order of decisions agrees. The write is a fine one or a widened one, never a refusal.
import { scriptRows, type Script } from './script.ts';

const rows: Script[] = [
  {
    name: '#597 1: Return over the > of a tag',
    doc: '<div>‸⏎',
    keys: ['Shift-ArrowLeft', 'Enter'],
    tc: true,
    expect: {},
  },
  {
    name: '#597 2: Return over the space of a heading in a quote',
    doc: '> a⏎## ‸alpha⏎',
    keys: ['Shift-ArrowLeft', 'Enter'],
    tc: true,
    expect: {},
  },
  {
    name: '#597 3: Delete in a tag after typing',
    doc: '<div>‸⏎a a a⏎',
    keys: [{ type: '  ' }, 'Home', 'Delete'],
    tc: true,
    expect: {},
  },
  {
    name: '#601 1: Shift-Return in indented code before a 2. item',
    doc: '      1. ‸ship a⏎2. a a⏎',
    keys: ['Shift-Enter'],
    tc: true,
    expect: {},
  },
  {
    name: '#588 1: Backspace after a bare + typed',
    doc: '+a‸⏎',
    keys: ['Backspace'],
    tc: true,
    expect: {},
  },
  {
    name: '#588 2: Return after a deleted bare marker line, then reject',
    doc: '* a⏎*‸⏎',
    keys: ['Backspace', 'ArrowLeft', 'Enter', { decide: 'reject' }],
    tc: true,
    expect: {},
  },
  {
    name: '#588 3: Return at a bare marker with a block after, then a tab typed',
    doc: '* a⏎*‸⏎> x⏎',
    keys: ['Enter', { type: '\ta' }],
    tc: true,
    expect: {},
  },
];

scriptRows(rows, 20000);
