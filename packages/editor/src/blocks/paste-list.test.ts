// @vitest-environment happy-dom
// Pasting list items into a list item (#510), with Track Changes off and on. The paste is played
// through the editor's paste handler, as ⌘V sends it, and every script is held to the suite's
// invariants: the file reads as its newest view in micromark, every order of decisions agrees, and
// one Undo takes the whole paste back (the selection's deletion with it).
import { describe, expect, it } from 'vitest';
import {
  checkInvariants,
  invariantProblems,
  notation,
  runScript,
  type Script,
  scriptRows,
} from './script.ts';
import { pastedItems } from './paste.ts';

interface Row {
  name: string;
  doc: string;
  paste: string;
  off: Script['expect'];
  on: Script['expect'];
}

const both = (rows: Row[]): Script[] =>
  rows.flatMap((row) => [
    {
      name: `${row.name}, Track Changes off`,
      doc: row.doc,
      keys: [{ paste: row.paste.replaceAll('⏎', '\n') }],
      tc: false,
      expect: row.off,
    },
    {
      name: `${row.name}, Track Changes on`,
      doc: row.doc,
      keys: [{ paste: row.paste.replaceAll('⏎', '\n') }],
      tc: true,
      expect: row.on,
    },
  ]);

describe('pasting list items at the end of an item', () => {
  scriptRows(
    both([
      {
        name: 'a bullet: a new item after it',
        doc: '- one⏎- two‸⏎',
        paste: '- pasted',
        off: { file: '- one⏎- two⏎- pasted⏎', caret: '- one⏎- two⏎- pasted‸⏎' },
        on: { newest: '- one⏎- two⏎- pasted⏎', caret: '- one⏎- two<ins><split>⏎- pasted‸</ins>' },
      },
      {
        name: 'two items, one nested: the depth is kept',
        doc: '- one⏎- two‸⏎',
        paste: '- a⏎  - b⏎- c',
        off: { file: '- one⏎- two⏎- a⏎  - b⏎- c⏎' },
        on: { newest: '- one⏎- two⏎- a⏎  - b⏎- c⏎' },
      },
      {
        name: 'nested pasted items under a nested target item',
        doc: '- one⏎  - two‸⏎- three⏎',
        paste: '- a⏎  - b',
        off: { file: '- one⏎  - two⏎  - a⏎    - b⏎- three⏎' },
        on: { newest: '- one⏎  - two⏎  - a⏎    - b⏎- three⏎' },
      },
      {
        name: 'with the item nested items: after them',
        doc: '- one‸⏎  - sub⏎- two⏎',
        paste: '- pasted',
        off: { file: '- one⏎  - sub⏎- pasted⏎- two⏎' },
        on: { newest: '- one⏎  - sub⏎- pasted⏎- two⏎' },
      },
      {
        name: 'a task: the checkbox stays',
        doc: '- one⏎- two‸⏎',
        paste: '- [x] done',
        off: { file: '- one⏎- two⏎- [x] done⏎' },
        on: { newest: '- one⏎- two⏎- [x] done⏎' },
      },
      {
        name: 'in a loose list: with the blank line the list has',
        doc: '- one⏎⏎- two‸⏎',
        paste: '- a⏎- b',
        off: { file: '- one⏎⏎- two⏎⏎- a⏎⏎- b⏎' },
        on: { newest: '- one⏎⏎- two⏎⏎- a⏎⏎- b⏎' },
      },
      {
        name: 'in a quote',
        doc: '> - one‸⏎> - two⏎',
        paste: '- pasted',
        off: { file: '> - one⏎> - pasted⏎> - two⏎' },
        on: { newest: '> - one⏎> - pasted⏎> - two⏎' },
      },
    ]),
  );
});

describe('pasting list items at the start of an item', () => {
  scriptRows(
    both([
      {
        name: 'before the item',
        doc: '- one⏎- ‸two⏎',
        paste: '- pasted',
        off: { file: '- one⏎- pasted⏎- two⏎', caret: '- one⏎- pasted‸⏎- two⏎' },
        on: { newest: '- one⏎- pasted⏎- two⏎' },
      },
      {
        name: 'two items before it',
        doc: '- ‸one⏎- two⏎',
        paste: '- a⏎- b',
        off: { file: '- a⏎- b⏎- one⏎- two⏎' },
        on: { newest: '- a⏎- b⏎- one⏎- two⏎' },
      },
      {
        name: 'before a task item: the item keeps its checkbox',
        doc: '- [ ] one⏎- [x] ‸two⏎',
        paste: '- pasted',
        off: { file: '- [ ] one⏎- [x] pasted⏎- [x] two⏎' },
        on: { newest: '- [ ] one⏎- [x] pasted⏎- [x] two⏎' },
      },
    ]),
  );
});

describe('pasting list items into an empty item', () => {
  scriptRows(
    both([
      {
        name: 'they replace it',
        doc: '- one⏎- ‸⏎',
        paste: '- pasted',
        off: { file: '- one⏎- pasted⏎', caret: '- one⏎- pasted‸⏎' },
        on: { newest: '- one⏎- pasted⏎' },
      },
      {
        name: 'two of them',
        doc: '- one⏎- ‸⏎',
        paste: '- a⏎- b',
        off: { file: '- one⏎- a⏎- b⏎' },
        on: { newest: '- one⏎- a⏎- b⏎' },
      },
      {
        name: 'at the end of the file',
        doc: '- one⏎- ‸',
        paste: '- pasted',
        off: { file: '- one⏎- pasted' },
        on: { newest: '- one⏎- pasted' },
      },
    ]),
  );
});

describe('pasting list items into the middle of an item', () => {
  scriptRows(
    both([
      {
        name: 'the item splits at the caret',
        doc: '- one⏎- tw‸o⏎',
        paste: '- pasted',
        off: { file: '- one⏎- tw⏎- pasted⏎- o⏎', caret: '- one⏎- tw⏎- pasted‸⏎- o⏎' },
        on: { newest: '- one⏎- tw⏎- pasted⏎- o⏎' },
      },
      {
        name: 'two items between the halves',
        doc: '- one⏎- tw‸o⏎',
        paste: '- a⏎  - b',
        off: { file: '- one⏎- tw⏎- a⏎  - b⏎- o⏎' },
        on: { newest: '- one⏎- tw⏎- a⏎  - b⏎- o⏎' },
      },
      {
        name: 'over a selection: the selection goes, the item splits',
        doc: '- one⏎- t[w]o⏎',
        paste: '- pasted',
        off: { file: '- one⏎- t⏎- pasted⏎- o⏎' },
        on: { newest: '- one⏎- t⏎- pasted⏎- o⏎' },
      },
      {
        name: 'over a selection up to the end of the item: after it',
        doc: '- one⏎- t[wo]⏎',
        paste: '- pasted',
        off: { file: '- one⏎- t⏎- pasted⏎' },
        on: { newest: '- one⏎- t⏎- pasted⏎' },
      },
      {
        name: 'over a selection from the start of the item: before the rest',
        doc: '- one⏎- [tw]o⏎',
        paste: '- pasted',
        off: { file: '- one⏎- pasted⏎- o⏎' },
        on: { newest: '- one⏎- pasted⏎- o⏎' },
      },
      {
        name: 'inside bold text, which closes and opens again',
        doc: '- one⏎- **bo‸ld**⏎',
        paste: '- pasted',
        off: { file: '- one⏎- **bo**⏎- pasted⏎- **ld**⏎' },
        on: { newest: '- one⏎- **bo**⏎- pasted⏎- **ld**⏎' },
      },
    ]),
  );
});

describe('the pasted items take the target list kind', () => {
  scriptRows(
    both([
      {
        name: 'a numbered item into a bullet list is a bullet',
        doc: '- one⏎- two‸⏎',
        paste: '1. pasted⏎2. more',
        off: { file: '- one⏎- two⏎- pasted⏎- more⏎' },
        on: { newest: '- one⏎- two⏎- pasted⏎- more⏎' },
      },
      {
        name: 'a bullet into a numbered list is numbered in sequence',
        doc: '1. one⏎2. two‸⏎',
        paste: '- a⏎- b',
        off: { file: '1. one⏎2. two⏎3. a⏎4. b⏎' },
        on: { newest: '1. one⏎2. two⏎3. a⏎4. b⏎' },
      },
      {
        name: 'a bullet in the middle of a numbered item',
        doc: '1. one⏎2. tw‸o⏎',
        paste: '- a',
        off: { file: '1. one⏎2. tw⏎3. a⏎4. o⏎' },
        on: { newest: '1. one⏎2. tw⏎3. a⏎4. o⏎' },
      },
      {
        name: 'a bullet into a list numbered alike takes the same number',
        doc: '1. one⏎1. two‸⏎',
        paste: '- a',
        off: { file: '1. one⏎1. two⏎1. a⏎' },
        on: { newest: '1. one⏎1. two⏎1. a⏎' },
      },
      {
        name: 'a task into a numbered list keeps its checkbox',
        doc: '1. one⏎2. two‸⏎',
        paste: '- [ ] a',
        off: { file: '1. one⏎2. two⏎3. [ ] a⏎' },
        on: { newest: '1. one⏎2. two⏎3. [ ] a⏎' },
      },
      {
        name: 'a plus-list item into a star list is a star',
        doc: '* one⏎* two‸⏎',
        paste: '+ a',
        off: { file: '* one⏎* two⏎* a⏎' },
        on: { newest: '* one⏎* two⏎* a⏎' },
      },
    ]),
  );
});

describe('pastes that are not list items go in as text', () => {
  scriptRows(
    both([
      {
        name: 'a line of text',
        doc: '- one⏎- two‸⏎',
        paste: 'more',
        off: { file: '- one⏎- twomore⏎' },
        on: { newest: '- one⏎- twomore⏎' },
      },
      {
        name: 'list items with a blank line between',
        doc: '- one⏎- two‸⏎',
        paste: '- a⏎⏎- b',
        off: { file: '- one⏎- two- a⏎⏎- b⏎' },
        on: { newest: '- one⏎- two- a⏎⏎- b⏎' },
      },
      {
        name: 'list items into a paragraph outside any list (a follow-up, #510)',
        doc: 'Hello ‸world⏎',
        paste: '- a',
        off: { file: 'Hello - aworld⏎' },
        on: { newest: 'Hello - aworld⏎' },
      },
    ]),
  );
});

describe('a selection across two items', () => {
  scriptRows(
    both([
      {
        name: 'goes as typing deletes it, then the items go between the halves',
        doc: '- o[ne⏎- t]wo⏎',
        paste: '- a',
        off: { file: '- o⏎- a⏎- wo⏎' },
        on: { newest: '- o⏎- a⏎- wo⏎' },
      },
    ]),
  );
});

describe('pasting next to bare markers, other paragraphs, pending changes and other blocks', () => {
  scriptRows(
    both([
      {
        name: 'after a bare bullet marker: the space is written first, as it is',
        doc: '- one⏎-‸⏎',
        paste: '- a',
        off: { file: '- one⏎- a⏎' },
        on: { newest: '- one⏎- a⏎', original: '- one⏎- ⏎' },
      },
      {
        name: 'after a bare number marker',
        doc: '1. one⏎2.‸⏎',
        paste: '- a⏎- b',
        off: { file: '1. one⏎2. a⏎3. b⏎' },
        on: { newest: '1. one⏎2. a⏎3. b⏎' },
      },
      {
        name: 'after a bare star marker at the end of the file',
        doc: '* one⏎*‸',
        paste: '- a',
        off: { file: '* one⏎* a' },
        on: { newest: '* one⏎* a' },
      },
      {
        name: 'after a bare marker with a line after it',
        doc: '- one⏎-‸⏎- three⏎',
        paste: '- a',
        off: { file: '- one⏎- a⏎- three⏎' },
        on: { newest: '- one⏎- a⏎- three⏎' },
      },
      {
        name: 'at the start of a later paragraph of an item: as text',
        doc: '- one⏎⏎  ‸two⏎- three⏎',
        paste: '- a',
        off: { file: '- one⏎⏎  - atwo⏎- three⏎' },
        on: { newest: '- one⏎⏎  - atwo⏎- three⏎' },
      },
      {
        name: 'in the middle of a later paragraph of an item',
        doc: '- one⏎⏎  tw‸o⏎- three⏎',
        paste: '- a',
        off: { file: '- one⏎⏎  tw⏎⏎- a⏎⏎- o⏎- three⏎' },
        on: { newest: '- one⏎⏎  tw⏎⏎- a⏎⏎- o⏎- three⏎' },
      },
      {
        name: 'at the end of a later paragraph of an item',
        doc: '- one⏎⏎  two‸⏎- three⏎',
        paste: '- a',
        off: { file: '- one⏎⏎  two⏎⏎- a⏎- three⏎' },
        on: { newest: '- one⏎⏎  two⏎⏎- a⏎- three⏎' },
      },
      {
        name: 'right after the end of its own pending insertion',
        doc: '- one⏎- two<ins>X</ins>‸⏎',
        paste: '- a',
        off: { file: '- one⏎- two<ins>X</ins>⏎- a' },
        on: { newest: '- one⏎- twoX⏎- a⏎' },
      },
      {
        name: 'inside its own pending insertion',
        doc: '- one⏎- two<ins>X‸Y</ins>⏎',
        paste: '- a',
        off: { file: '- one⏎- two<ins>X</ins>⏎- a⏎- <ins>⏎  Y</ins>' },
        on: { newest: '- one⏎- twoX⏎- a⏎- Y⏎' },
      },
      {
        name: 'in a table cell: text, unchanged',
        doc: '| a | b |⏎|---|---|⏎| x‸ | y |⏎',
        paste: '- a',
        off: { file: '| a | b |⏎|---|---|⏎| x- a | y |⏎' },
        on: { newest: '| a | b |⏎|---|---|⏎| x- a | y |⏎' },
      },
      {
        name: 'in a code block: text, unchanged',
        doc: '```⏎x‸⏎```⏎',
        paste: '- a',
        off: { file: '```⏎x- a⏎```⏎' },
        on: { newest: '```⏎x- a⏎```⏎⏎' },
      },
    ]),
  );

  for (const tc of [false, true]) {
    it(`a paste with CRLF line breaks, Track Changes ${tc ? 'on' : 'off'}`, () => {
      const result = runScript({
        name: 'crlf',
        doc: '- one⏎- two‸⏎',
        keys: [{ paste: '- a\r\n  - b\r\n- c\r\n' }],
        tc,
        expect: tc
          ? { newest: '- one⏎- two⏎- a⏎  - b⏎- c⏎' }
          : { file: '- one⏎- two⏎- a⏎  - b⏎- c⏎' },
      });
      checkInvariants(result);
    });

    it(`paste, Backspace, then Undo leaves the paste, Track Changes ${tc ? 'on' : 'off'}`, () => {
      const result = runScript({
        name: 'history',
        doc: '- one⏎- two‸⏎',
        keys: [{ paste: '- pasted' }, 'Backspace', 'Mod-z'],
        tc,
        expect: tc ? { newest: '- one⏎- two⏎- pasted⏎' } : { file: '- one⏎- two⏎- pasted⏎' },
      });
      checkInvariants(result);
    });
  }
});

describe('a long paste that is no list', () => {
  it('is turned down at its first line, at no cost', () => {
    const long = `${'word '.repeat(2_000_000)}\n- a\n`;
    const started = performance.now();
    expect(pastedItems(long)).toBeNull();
    expect(pastedItems(`\n\n${' '.repeat(100_000)}x`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('Undo takes the whole paste back', () => {
  const docs = [
    '- one⏎- two‸⏎',
    '- one⏎- ‸two⏎',
    '- one⏎- ‸⏎',
    '- one⏎- t[w]o⏎',
    '- one⏎- [tw]o⏎',
    '- o[ne⏎- t]wo⏎',
    '1. one⏎2. tw‸o⏎',
  ];
  for (const tc of [false, true]) {
    for (const doc of docs) {
      it(`${doc}, Track Changes ${tc ? 'on' : 'off'}`, () => {
        const result = runScript({
          name: 'undo',
          doc,
          keys: [{ paste: '- a\n  - b\n- c' }, 'Mod-z'],
          tc,
          expect: {},
        });
        const start = result.start.replace(/\n+$/, '');
        expect(notation(result.file).replace(/⏎+$/, ''), 'the file as it was').toBe(
          notation(start).replace(/⏎+$/, ''),
        );
        checkInvariants(result);
      });
    }
  }
});

// The caret at every place of lists of different shapes, with pastes of different shapes: whatever
// the paste writes reads as its newest view and agrees in every order of decisions (the suite's
// invariants), with Track Changes on and off.
describe('a paste at every caret of a list', () => {
  const docs = [
    '- one⏎- two⏎- three⏎',
    '1. one⏎2. two⏎',
    '- one⏎  - sub⏎  - sub two⏎- two⏎',
    '- [ ] one⏎- [x] two⏎',
    '- one⏎⏎- two⏎',
    '> - one⏎> - two⏎',
    '- **bo** and `code`⏎- [a link](x.md) end⏎',
    '- one⏎  more of one⏎- two⏎',
    '- one⏎- ⏎- three⏎',
    '- one⏎-⏎- three⏎',
    '1. one⏎2.⏎',
    '* one⏎*',
    '- one⏎⏎  two⏎⏎  three⏎- four⏎',
    '1. one⏎⏎   two⏎2. three⏎',
  ];
  const pastes = ['- a', '1. a⏎2. b', '- a⏎  - b⏎- c', '- [x] a'];
  for (const doc of docs) {
    for (const tc of [false, true]) {
      it(`${doc}, Track Changes ${tc ? 'on' : 'off'}`, () => {
        const failures: string[] = [];
        for (let at = 0; at <= doc.length; at++) {
          if (doc[at - 1] === '⏎' && doc[at] === '⏎') continue;
          for (const paste of pastes) {
            const name = `${doc.slice(0, at)}‸${doc.slice(at)} <- ${paste} ${tc ? 'on' : 'off'}`;
            const script: Script = {
              name,
              doc: `${doc.slice(0, at)}‸${doc.slice(at)}`,
              keys: [{ paste: paste.replaceAll('⏎', '\n') }],
              tc,
              expect: {},
            };
            try {
              checkInvariants(runScript(script));
            } catch (error) {
              // A place where the paste goes in as text, as before (inside a code span, at the
              // start of a later line of an item's text), and plain text pasted there is
              // refused too: that refusal is today's, not the list paste's.
              const as = runScript({
                ...script,
                keys: [{ paste: paste.replaceAll('⏎', '\n'), plain: true }],
              });
              if (as.refusals.length > 0) continue;
              if (Object.values(invariantProblems(as)).some((found) => found.length > 0)) continue;
              failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`);
            }
          }
        }
        expect(failures).toEqual([]);
      }, 60_000);
    }
  }
});

// Every selection of a short list, over one item, across items and over their syntax.
describe('a paste over every selection of a list', () => {
  const docs = ['- one⏎- two⏎', '1. one⏎2. two⏎', '- one⏎  - sub⏎- two⏎'];
  const pastes = ['- a', '- a⏎  - b'];
  for (const doc of docs) {
    for (const tc of [false, true]) {
      it(`${doc}, Track Changes ${tc ? 'on' : 'off'}`, () => {
        const failures: string[] = [];
        for (let from = 0; from < doc.length; from++) {
          for (let to = from + 1; to <= doc.length; to++) {
            for (const paste of pastes) {
              const marked = `${doc.slice(0, from)}⟦${doc.slice(from, to)}⟧${doc.slice(to)}`;
              const script: Script = {
                name: `${marked} <- ${paste} ${tc ? 'on' : 'off'}`,
                doc: marked,
                keys: [{ paste: paste.replaceAll('⏎', '\n') }],
                tc,
                expect: {},
              };
              try {
                checkInvariants(runScript(script));
              } catch (error) {
                // A selection that goes in as text (over a marker): what text does is today's.
                const as = runScript({
                  ...script,
                  keys: [{ paste: paste.replaceAll('⏎', '\n'), plain: true }],
                });
                if (as.refusals.length > 0) continue;
                if (Object.values(invariantProblems(as)).some((found) => found.length > 0))
                  continue;
                failures.push(`${script.name}: ${(error as Error).message.split('\n')[0]}`);
              }
            }
          }
        }
        expect(failures).toEqual([]);
      }, 60_000);
    }
  }
});
