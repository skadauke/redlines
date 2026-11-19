// @vitest-environment happy-dom
// A script's caret in a CRLF document is where it was written (#1233): the harness counted a CRLF as
// two characters in the editor's document, which has one LF there, and put the caret a character per
// line break too far, so a CRLF document read as a bug that its LF twin did not have. Each CRLF row
// has an LF twin, and its file is the twin's with CRLF.
import { describe } from 'vitest';
import { scriptRows } from './script.ts';

const R = '\r';
const crlf = (doc: string) => doc.replaceAll('⏎', `${R}⏎`);

describe('CRLF documents, with their LF twins', () => {
  // [name, document, keys, the file with LF line breaks]; the CRLF file is the same with CRLF, but for
  // the old text of a deletion or substitution, whose payload spells its breaks the same in any file.
  const rows = [
    [
      'an empty item under a paragraph, then typing',
      'Para.⏎⏎- ‸⏎⏎Next.',
      ['Enter', { type: 'X' }],
      'Para.<del ⏎⏎- ><ins><split>⏎⏎X</ins>⏎⏎Next.',
    ],
    [
      'an empty item with an item after it, then typing',
      'Para.⏎⏎- ‸⏎- two',
      ['Enter', { type: 'X' }],
      'Para.<sub ⏎⏎- ><split>⏎⏎X⏎</sub>⏎- two',
    ],
    ['the first item under a paragraph', 'Para.⏎- ‸apples', ['Enter'], 'Para.<split>⏎⏎- ⏎- apples'],
  ] as const;
  const inFile = (file: string) =>
    file.replace(/(<(?:del|sub) [^>]*>)|⏎/g, (m, payload?: string) => payload ?? '␍⏎');
  scriptRows(
    rows.flatMap(([name, doc, keys, file]) => [
      {
        name: `${name}, LF, Track Changes on`,
        doc,
        keys: [...keys],
        tc: true,
        expect: { file },
      },
      {
        name: `${name}, CRLF, Track Changes on`,
        doc: crlf(doc),
        keys: [...keys],
        tc: true,
        expect: { file: inFile(file) },
      },
    ]),
  );
});
