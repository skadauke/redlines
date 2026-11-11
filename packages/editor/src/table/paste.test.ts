// @vitest-environment happy-dom
// Paste over cells (design: tables, "Copy and paste", In; test 11): a range from a spreadsheet or a
// word processor, as HTML and as tab-separated text, over the cells from the caret's or the selection's
// top left, adding rows when it needs them, tracked or not. Each tracked paste reads the same in every
// decision order and gives the original's bytes back when rejected.
import { forceParsing } from '@codemirror/language';
import { acceptAll, applyChanges, newestView, rejectAll } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { undo } from '../history/index.ts';
import { plainPastes } from '../tracked/clipboard.ts';
import { createEditor, type Editor } from '../index.ts';
import { htmlToRange } from '../clipboard/paste-html.ts';
import { tsvToRange } from './clipboard.ts';
import { rectOf } from './cells.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const notices: string[] = [];

function load(doc: string, tracking = false): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: ada,
    tracking,
    onNotice: (message) => notices.push(message),
  });
  open.push(editor);
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  notices.length = 0;
  return editor;
}

function paste(editor: Editor, text: string, html?: string, plain = false): boolean {
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  if (html !== undefined) clipboardData.setData('text/html', html);
  const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
  // Paste as Plain Text sends its text this way (`editor.pastePlain`, which also focuses).
  if (plain) plainPastes.add(event);
  editor.view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

/** The captures: what each program puts on the clipboard for the cells Pears 7 / Plums 8. */
const CAPTURES: Record<string, { html: string; text: string }> = {
  Sheets: {
    text: 'Pears\t7\nPlums\t8',
    html: '<meta charset=\'utf-8\'><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style><table xmlns="http://www.w3.org/1999/xhtml" data-sheets-root="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" dir="ltr" border="1" cellspacing="0" cellpadding="0"><colgroup><col width="100"/><col width="100"/></colgroup><tbody><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Pears&quot;}">Pears</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:7}">7</td></tr><tr style="height:21px;"><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">Plums</td><td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;">8</td></tr></tbody></table>',
  },
  Excel: {
    text: 'Pears\t7\r\nPlums\t8\r\n',
    html: '<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><style><!--table {mso-displayed-decimal-separator:"\\.";}.xl65 {mso-number-format:General;}--></style></head><body link="#0563C1" vlink="#954F72"><table border=0 cellpadding=0 cellspacing=0 width=128 style=\'border-collapse:collapse;width:96pt\'><!--StartFragment--><col width=64 span=2 style=\'width:48pt\'><tr height=20 style=\'height:15.0pt\'><td height=20 class=xl65 width=64 style=\'height:15.0pt;width:48pt\'>Pears</td><td class=xl65 align=right width=64 style=\'width:48pt\'>7</td></tr><tr height=20 style=\'height:15.0pt\'><td height=20 class=xl65 style=\'height:15.0pt\'>Plums</td><td class=xl65 align=right>8</td></tr><!--EndFragment--></table></body></html>',
  },
  Numbers: {
    text: 'Pears\t7\nPlums\t8',
    html: '<meta charset="utf-8"><table cellspacing="0" cellpadding="0" style="border-collapse: collapse"><tbody><tr><td valign="top" style="width: 100px; padding: 4px 5px;"><p style="margin: 0; font: 12px Helvetica"><span style="font-kerning: none">Pears</span></p></td><td valign="top" style="width: 100px; padding: 4px 5px;"><p style="margin: 0; font: 12px Helvetica; text-align: right"><span style="font-kerning: none">7</span></p></td></tr><tr><td valign="top"><p style="margin: 0; font: 12px Helvetica"><span style="font-kerning: none">Plums</span></p></td><td valign="top"><p style="margin: 0; font: 12px Helvetica; text-align: right"><span style="font-kerning: none">8</span></p></td></tr></tbody></table>',
  },
  Word: {
    text: 'Pears\t7\r\nPlums\t8\r\n',
    html: '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style><!-- p.MsoNormal {margin:0in;}--></style></head><body lang=EN-US><!--StartFragment--><table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style=\'border-collapse:collapse;border:none\'><tr><td width=156 valign=top style=\'width:117.0pt;border:solid windowtext 1.0pt\'><p class=MsoNormal>Pears<o:p></o:p></p></td><td width=156 valign=top style=\'width:117.0pt\'><p class=MsoNormal>7<o:p></o:p></p></td></tr><tr><td width=156 valign=top><p class=MsoNormal>Plums<o:p></o:p></p></td><td width=156 valign=top><p class=MsoNormal>8<o:p></o:p></p></td></tr></table><!--EndFragment--></body></html>',
  },
  Docs: {
    text: 'Pears\t7\nPlums\t8',
    html: '<meta charset=\'utf-8\'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-4a6b1c2d-7fff"><div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;table-layout:fixed;width:468pt"><colgroup><col /><col /></colgroup><tbody><tr style="height:0pt"><td style="border-left:solid #000000 1pt;vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;">Pears</span></p></td><td style="vertical-align:top;padding:5pt;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;">7</span></p></td></tr><tr style="height:0pt"><td style="vertical-align:top;padding:5pt;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;">Plums</span></p></td><td style="vertical-align:top;padding:5pt;"><p dir="ltr" style="line-height:1.2;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;">8</span></p></td></tr></tbody></table></div></b>',
  },
};

const BASE = '| a | b | c |\n| - | - | - |\n| 11 | 12 | 13 |\n| 21 | 22 | 23 |';
const DOC = `Intro.\n\n${BASE}\n\nAfter.\n`;
const where = (find: string, nth = 0, doc = DOC) => doc.indexOf(find) + nth;

/** What the file reads after the paste, with every change accepted and every one rejected. */
function reads(editor: Editor) {
  const file = editor.getDoc();
  return {
    file,
    newest: newestView(file).text,
    accepted: applyChanges(file, acceptAll(file)),
    rejected: applyChanges(file, rejectAll(file)),
  };
}

describe('a range read from what each program copies', () => {
  for (const [name, { html, text }] of Object.entries(CAPTURES)) {
    it(`reads the cells of ${name}'s HTML and of its text alike`, () => {
      expect(htmlToRange(html)).toEqual([
        ['Pears', '7'],
        ['Plums', '8'],
      ]);
      expect(tsvToRange(text)).toEqual([
        ['Pears', '7'],
        ['Plums', '8'],
      ]);
    });
  }

  it('reads quotes, line breaks and pipes in tab-separated text', () => {
    expect(tsvToRange('"a\tb"\t"x\ny"\t"say ""hi"""\tp|q\n')).toEqual([
      ['a b', 'x<br>y', 'say "hi"', 'p\\|q'],
    ]);
    expect(tsvToRange('no tab here')).toBeNull();
  });

  it('is none for HTML with no table, or with more than the table', () => {
    expect(htmlToRange('<p>just text</p>')).toBeNull();
    expect(htmlToRange('<p>before</p><table><tr><td>a</td></tr></table><p>after</p>')).toBeNull();
  });
});

describe('pasting a range over cells', () => {
  for (const tracking of [false, true]) {
    describe(`Track Changes ${tracking ? 'on' : 'off'}`, () => {
      for (const [name, { html, text }] of Object.entries(CAPTURES)) {
        it(`pastes ${name}'s cells from the caret, rightward and down`, () => {
          const editor = load(DOC, tracking);
          editor.view.dispatch({ selection: { anchor: where('12', 1) } });
          expect(paste(editor, text, html)).toBe(true);
          const done = reads(editor);
          const want = DOC.replace(
            '| 11 | 12 | 13 |\n| 21 | 22 | 23 |',
            '| 11 | Pears | 7 |\n| 21 | Plums | 8 |',
          );
          expect(done.newest).toBe(want);
          // Every order of decisions reads alike; rejected, the original's bytes come back.
          expect(done.accepted).toBe(want);
          if (tracking) {
            expect(done.rejected).toBe(DOC);
            expect(done.file).toContain('<!--');
          } else expect(done.file).toBe(want);
        });
      }

      it('pastes onto selected cells from the selection’s top-left cell', () => {
        const editor = load(DOC, tracking);
        const { html, text } = CAPTURES['Sheets']!;
        editor.view.dispatch({ selection: { anchor: where('21'), head: where('23') + 2 } });
        expect(rectOf(editor.view.state)).not.toBeNull();
        paste(editor, text, html);
        const done = reads(editor);
        const want = DOC.replace('| 21 | 22 | 23 |', '| Pears | 7 | 23 |') + '';
        // The second row of the range goes below: the table gains a row.
        expect(done.newest).toBe(
          DOC.replace('| 21 | 22 | 23 |', '| Pears | 7 | 23 |\n| Plums | 8 |  |'),
        );
        expect(done.accepted).toBe(done.newest);
        if (tracking) expect(done.rejected).toBe(DOC);
        void want;
      });

      it('adds the rows it needs, as one change and one step to undo', () => {
        const editor = load(DOC, tracking);
        const range = 'x\ty\nz\tw\nu\tv';
        editor.view.dispatch({ selection: { anchor: where('22', 1) } });
        expect(paste(editor, range)).toBe(true);
        const done = reads(editor);
        const want = DOC.replace(
          '| 21 | 22 | 23 |',
          '| 21 | x | y |\n| z | w |  |\n| u | v |  |'
            .replace('| z | w |  |', '|  | z | w |')
            .replace('| u | v |  |', '|  | u | v |'),
        );
        expect(done.newest).toBe(want);
        expect(done.accepted).toBe(want);
        if (tracking) expect(done.rejected).toBe(DOC);
        if (tracking) {
          // The two rows are inserted rows, and every mark of the paste is one group.
          expect(done.file.match(/row-->/g)).toHaveLength(2);
          const groups = new Set([...done.file.matchAll(/group: (\w+)/g)].map((m) => m[1]));
          expect(groups.size).toBe(1);
        }
        expect(undo(editor.view)).toBe(true);
        expect(editor.getDoc()).toBe(DOC);
      });

      it('fills every selected cell with one value', () => {
        const editor = load(DOC, tracking);
        editor.view.dispatch({ selection: { anchor: where('12'), head: where('23') + 2 } });
        expect(paste(editor, 'x')).toBe(true);
        const done = reads(editor);
        const want = DOC.replace(
          '| 11 | 12 | 13 |\n| 21 | 22 | 23 |',
          '| 11 | x | x |\n| 21 | x | x |',
        );
        expect(done.newest).toBe(want);
        expect(done.accepted).toBe(want);
        if (tracking) expect(done.rejected).toBe(DOC);
      });

      it('refuses a range wider than the table, whole, with its reason', () => {
        const editor = load(DOC, tracking);
        editor.view.dispatch({ selection: { anchor: where('12', 1) } });
        expect(paste(editor, 'a\tb\tc\td\te')).toBe(true);
        expect(editor.getDoc()).toBe(DOC);
        expect(notices).toEqual([
          'The table has 3 columns and the pasted range has 5. Add columns first.',
        ]);
      });
    });
  }

  it('puts multi-line text without tabs into the one cell, as <br>, with pipes escaped', () => {
    const editor = load(DOC);
    editor.view.dispatch({ selection: { anchor: where('12'), head: where('12') + 2 } });
    paste(editor, 'one\ntwo|three');
    expect(editor.getDoc()).toBe(DOC.replace('| 12 |', '| one<br>two\\|three |'));
  });

  it('puts a text selection inside a cell’s range from that cell, not in the text', () => {
    const editor = load(DOC);
    editor.view.dispatch({ selection: { anchor: where('12'), head: where('12') + 1 } });
    paste(editor, 'x\ty');
    expect(editor.getDoc()).toBe(DOC.replace('| 12 | 13 |', '| x | y |'));
  });

  it('writes a range pasted in a file with CRLF line breaks', () => {
    const doc = DOC.replace(/\n/g, '\r\n');
    for (const tracking of [false, true]) {
      const editor = load(doc, tracking);
      editor.view.dispatch({
        selection: { anchor: editor.view.state.doc.toString().indexOf('22') + 1 },
      });
      paste(editor, 'x\ty\nz\tw');
      const done = reads(editor);
      if (tracking) expect(done.rejected).toBe(doc);
      expect(done.newest).toBe(
        doc
          .replace('| 22 | 23 |\r\n', '| x | y |\r\n|  | z | w |\r\n')
          .replace('| 21 | x', '| 21 | x'),
      );
      expect(done.file.replace(/\r\n/g, '')).not.toContain('\n');
    }
  });

  it('leaves a range pasted outside a table to the text way: its table', () => {
    const editor = load(DOC);
    editor.view.dispatch({ selection: { anchor: where('After.') } });
    const { html, text } = CAPTURES['Sheets']!;
    paste(editor, text, html);
    expect(editor.getDoc()).toContain('| Pears | 7 |');
  });

  it('pastes Paste as Plain Text into the cell with its tabs as spaces', () => {
    const editor = load(DOC);
    editor.view.dispatch({ selection: { anchor: where('12'), head: where('12') + 2 } });
    paste(editor, 'a\tb|c', undefined, true);
    expect(editor.getDoc()).toBe(DOC.replace('| 12 |', '| a b\\|c |'));
  });

  it('fills every selected cell with Paste as Plain Text', () => {
    const editor = load(DOC);
    editor.view.dispatch({ selection: { anchor: where('12'), head: where('23') + 2 } });
    paste(editor, 'p\tq', undefined, true);
    expect(editor.getDoc()).toBe(
      DOC.replace('| 11 | 12 | 13 |\n| 21 | 22 | 23 |', '| 11 | p q | p q |\n| 21 | p q | p q |'),
    );
  });
});

describe('a paste is one group', () => {
  // Rows and cell edits share one group, however few: one row with one cell, one row with several.
  for (const [name, text, at, html] of [
    ['one row, one cell', 'x\ny', '22', '<table><tr><td>x</td></tr><tr><td>y</td></tr></table>'],
    ['one row, two cells', 'x\ty\nz', '22', undefined],
    ['one row, three cells', 'x\ty\tz\nu', '21', undefined],
  ] as const) {
    it(`for ${name}`, () => {
      const editor = load(DOC, true);
      editor.view.dispatch({ selection: { anchor: where(at, 1) } });
      expect(paste(editor, text, html)).toBe(true);
      const file = editor.getDoc();
      expect(file.match(/row-->/g)).toHaveLength(1);
      const marks = file.match(/<!--(?:ins|sub) [a-z0-9]{4}/g) ?? [];
      const groups = [...file.matchAll(/group: (\w+)/g)].map((m) => m[1]);
      expect(marks.length).toBeGreaterThan(1);
      expect(groups).toHaveLength(marks.length);
      expect(new Set(groups).size).toBe(1);
      expect(undo(editor.view)).toBe(true);
      expect(editor.getDoc()).toBe(DOC);
      // Rejecting one of its marks decides all of them together.
      const again = load(DOC, true);
      again.view.dispatch({ selection: { anchor: where(at, 1) } });
      paste(again, text, html);
      expect(applyChanges(again.getDoc(), rejectAll(again.getDoc()))).toBe(DOC);
    });
  }
});

describe('a paste never brings a live marker (design §5.10)', () => {
  const MARKED = 'x<!--ins k3x9-->y<!--/k3x9-->z';
  const LEDGER =
    '\n<!-- redlines\nversion: 1\nmarks:\n  k3x9: {by: bo, at: 2026-11-01T10:00Z}\n-->\n';
  const clean = (editor: Editor) => {
    const file = editor.getDoc();
    expect(file).not.toContain('k3x9');
    expect(file).not.toContain('<!--cmt');
    return file;
  };

  for (const tracking of [false, true]) {
    describe(`Track Changes ${tracking ? 'on' : 'off'}`, () => {
      it('tab-separated text with markers pastes as its newest text', () => {
        const editor = load(DOC, tracking);
        editor.view.dispatch({ selection: { anchor: where('12', 1) } });
        paste(editor, `${MARKED}\tb<!--cmt c8d2-->c<!--/c8d2-->${LEDGER}`);
        clean(editor);
        expect(newestView(editor.getDoc()).text).toContain('| xyz | bc |');
      });

      it('plain text onto selected cells fills them with its newest text', () => {
        const editor = load(DOC, tracking);
        editor.view.dispatch({ selection: { anchor: where('12'), head: where('23') + 2 } });
        paste(editor, `${MARKED}${LEDGER}`);
        clean(editor);
        expect(newestView(editor.getDoc()).text).toContain('| 11 | xyz | xyz |');
      });

      it('Paste as Plain Text, onto cells and at a caret, brings no marker', () => {
        const rect = load(DOC, tracking);
        rect.view.dispatch({ selection: { anchor: where('12'), head: where('23') + 2 } });
        paste(rect, `${MARKED}${LEDGER}`, undefined, true);
        clean(rect);
        const caret = load(DOC, tracking);
        caret.view.dispatch({ selection: { anchor: where('12'), head: where('12') + 2 } });
        paste(caret, `${MARKED}\tq${LEDGER}`, undefined, true);
        clean(caret);
        expect(newestView(caret.getDoc()).text).toContain('| xyz q |');
      });

      it('a single value as plain text and a range as HTML bring none either', () => {
        const editor = load(DOC, tracking);
        editor.view.dispatch({ selection: { anchor: where('12'), head: where('23') + 2 } });
        paste(editor, MARKED);
        clean(editor);
        const html = load(DOC, tracking);
        html.view.dispatch({ selection: { anchor: where('12', 1) } });
        paste(html, 'a\tb', '<table><tr><td>a&lt;!--ins k3x9--&gt;</td><td>b</td></tr></table>');
        // The HTML's text stays text: its `<` is written as an entity.
        expect(html.getDoc()).not.toContain('<!--ins k3x9');
      });
    });
  }
});
