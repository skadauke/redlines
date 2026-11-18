// @vitest-environment happy-dom
// A walk's finding (#1109, #586, seed 300 of the Tab and ⌥↑ ⌥↓ walk): Delete at the start of a
// closing fence took a backtick out of it, the fence stopped being one, and the fences after it
// paired up differently, so that the list below the code was read as code. Backspace and Delete over
// a fence's marker run, or over the break that sets the closing fence on its own line, do nothing,
// as they do at the ends of the code; a closing fence longer than the opening one may shrink.
import { describe } from 'vitest';
import { scriptRows, type Script, type Step } from './script.ts';

const both = (name: string, doc: string, key: Step, after: string): Script[] =>
  [false, true].map((tc) => ({
    name: `${name}, Track Changes ${tc ? 'on' : 'off'}`,
    doc,
    keys: [key],
    tc,
    expect: { file: after.replace('‸', ''), caret: after },
  }));

describe('Backspace and Delete in a fence line keep the fence whole (#1109)', () => {
  scriptRows([
    ...both(
      'Delete at the start of the closing fence',
      '```⏎code⏎‸```⏎⏎```⏎more⏎```⏎⏎* a⏎* b',
      'Delete',
      '```⏎code⏎‸```⏎⏎```⏎more⏎```⏎⏎* a⏎* b',
    ),
    ...both(
      'Delete at the start of the opening fence',
      '‸```⏎code⏎```⏎⏎* a⏎* b',
      'Delete',
      '‸```⏎code⏎```⏎⏎* a⏎* b',
    ),
    ...both(
      'Backspace at the end of the closing fence',
      '```⏎code⏎```‸⏎⏎* a⏎* b',
      'Backspace',
      '```⏎code⏎```‸⏎⏎* a⏎* b',
    ),
    ...both(
      'Backspace at the start of the closing fence, which would join it to the code',
      '```⏎code⏎‸```⏎⏎* a⏎* b',
      'Backspace',
      '```⏎code⏎‸```⏎⏎* a⏎* b',
    ),
    ...both(
      'Backspace in the marks of a closing fence with a space after it',
      '```⏎code⏎`‸`` ⏎⏎* a⏎* b',
      'Backspace',
      '```⏎code⏎`‸`` ⏎⏎* a⏎* b',
    ),
    ...both(
      'Delete at the end of the last line of the code',
      '```⏎code‸⏎```⏎⏎* a⏎* b',
      'Delete',
      '```⏎code‸⏎```⏎⏎* a⏎* b',
    ),
    ...both(
      'Delete in the closing fence of a code block in a quote',
      '> ```⏎> code⏎> ‸```⏎⏎* a⏎* b',
      'Delete',
      '> ```⏎> code⏎> ‸```⏎⏎* a⏎* b',
    ),
  ]);
});
