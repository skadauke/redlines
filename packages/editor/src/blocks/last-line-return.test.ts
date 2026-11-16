// @vitest-environment happy-dom
// Return at the end of a document's last line, Track Changes on, when text follows the ledger
// (Practice.md, #670): the insertion is written (the format tracks what follows a ledger as it
// does any text), and the empty paragraph in it has the caret on a line of closers alone. That line
// was hidden with the blank line before it, so the caret stood at the start of the line above. It
// is drawn while the caret is on it.
import { forceParsing } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { runScript } from './script.ts';

const LEDGER =
  '<!-- redlines⏎version: 1⏎tracking: everyone⏎people:⏎  ada: {name: Ada Lovelace}⏎-->';

describe('Return at the end of a last line that follows the ledger (#670)', () => {
  for (const [name, tail] of [
    ['with a line break after it', 'Added‸⏎'],
    ['with none', 'Added‸'],
  ] as const) {
    it(`${name}: the caret is on a line of its own`, () => {
      const lines: string[][] = [];
      runScript(
        { name, doc: `One.⏎⏎${LEDGER}⏎⏎${tail}`, keys: ['Enter'], tc: true, expect: {} },
        {
          light: true,
          onStep: (editor) => {
            const { view } = editor;
            forceParsing(view, view.state.doc.length, 5000);
            view.requestMeasure();
            lines.push(
              [...view.contentDOM.querySelectorAll('.cm-line')].map(
                (line) => line.textContent ?? '',
              ),
            );
            const head = view.state.selection.main.head;
            const line = view.state.doc.lineAt(head);
            // The caret's line is a line of closers alone, and the line above it is the text.
            expect(line.text).toMatch(/^(?:<!--\/[^>]*-->)+$/);
          },
        },
      );
      const drawn = lines.at(-1)!;
      expect(drawn.at(-2)).toBe('Added');
      expect(drawn.at(-1)).toBe('');
    });
  }
});
