// @vitest-environment happy-dom
// A move that brings two lists side by side (#871, #600's family): the newest view reads them as
// one list (the second nested in the last item of the first, or both a loose list), where a file
// with the marker of a tracked move between them reads two. The move is not written as marks; the
// person is asked, and it is made untracked (the script has no sheet to ask, and takes Make Edit).
import { scriptRows, type Script } from './script.ts';

const rows: Script[] = [
  {
    name: '#871: ⌥↓ on a 2. line under text, a nested item below',
    doc: '1. plan code⏎⏎beta review note⏎2. ‸text text⏎   1. text note',
    keys: ['Alt-ArrowDown'],
    tc: true,
    expect: { newest: '1. plan code⏎⏎   1. text note⏎⏎beta review note⏎2. text text' },
  },
  {
    name: '⌥↓ on a paragraph between two bullet lists',
    doc: '- a⏎⏎‸para⏎⏎- b',
    keys: ['Alt-ArrowDown'],
    tc: true,
    expect: { newest: '- a⏎⏎- b⏎⏎para' },
  },
];

scriptRows(rows);
