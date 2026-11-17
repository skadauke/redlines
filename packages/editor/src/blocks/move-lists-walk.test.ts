// @vitest-environment happy-dom
// Reduced case of a walk failure of "Tab and ⌥↑ ⌥↓ over lists side by side" (#870): a move over list lines, tracked, held to every invariant of the block suite.
import { scriptRows, type Script } from './script.ts';

const rows: Script[] = [
  {
    name: '#870: ⌥↓ then Tab on an item of two lines',
    doc: '1. code note‸⏎   beta note⏎1. gamma code',
    keys: ['Alt-ArrowDown', 'Tab'],
    tc: true,
    expect: {},
  },
];

scriptRows(rows);
