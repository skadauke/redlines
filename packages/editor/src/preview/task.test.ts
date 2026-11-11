// @vitest-environment happy-dom
import { forceParsing } from '@codemirror/language';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { newestView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { checkBoxEffect, createEditor, type Editor } from '../index.ts';
import { decodeEntity } from './task.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

function editorAt(
  doc: string,
  cursor: number,
  mode?: 'raw' | 'redlines' | 'simple' | 'clean',
  tracking = false,
): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, tracking });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  if (mode) editor.setViewMode(mode);
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

const boxes = (editor: Editor) => [...editor.view.dom.querySelectorAll('.rl-box')];
const entities = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('.rl-entity')].map((e) => e.textContent);

describe('task boxes', () => {
  const doc = '- [ ] Buy milk\n- [x] Call Ada\n\nEnd.\n';

  it('draws a checked and an unchecked box', () => {
    const editor = editorAt(doc, doc.length - 2);
    const [open_, done] = boxes(editor);
    expect(boxes(editor)).toHaveLength(2);
    expect(open_?.getAttribute('aria-checked')).toBe('false');
    expect(done?.getAttribute('aria-checked')).toBe('true');
    expect(done?.querySelector('path')).not.toBeNull();
    expect(open_?.querySelector('path')).toBeNull();
    expect(editor.view.dom.textContent).not.toContain('[x]');
  });

  it('hangs a wrapped item under its text, after the box', () => {
    const editor = editorAt(doc, doc.length - 2);
    const hangs = [...editor.view.dom.querySelectorAll<HTMLElement>('.cm-line.rl-hang')].map(
      (line) => line.style.getPropertyValue('--rl-hang'),
    );
    // `- [ ] ` is six columns, where the item's text starts.
    expect(hangs).toEqual(['6', '6']);
  });

  it('keeps the box while the caret is in the item text', () => {
    const editor = editorAt(doc, 10);
    expect(boxes(editor)).toHaveLength(2);
    expect(editor.view.dom.textContent).not.toContain('[ ]');
  });

  it('shows the source while the caret is on the marker, and in Raw', () => {
    const on = editorAt(doc, 3);
    expect(boxes(on)).toHaveLength(1);
    expect(on.view.dom.textContent).toContain('[ ]');
    const raw = editorAt(doc, doc.length - 2, 'raw');
    expect(boxes(raw)).toHaveLength(0);
  });

  it('is source inside a pending change', () => {
    const text = '- <!--fmt a1b2 +ins-->[ ] New<!--/a1b2-->\n\nEnd.\n';
    const editor = editorAt(text, text.length - 2);
    expect(boxes(editor)).toHaveLength(0);
  });

  it('asks for the new state on a click and leaves the caret and text alone', () => {
    const editor = editorAt(doc, doc.length - 2);
    const requests: unknown[] = [];
    editor.addExtension(
      EditorView.updateListener.of(({ transactions }) => {
        for (const tr of transactions)
          for (const e of tr.effects) if (e.is(checkBoxEffect)) requests.push(e.value);
      }),
    );
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    boxes(editor)[0]?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(requests).toEqual([{ pos: 0, checked: true }]);
    expect(editor.getDoc()).toBe(doc);
    expect(editor.view.state.selection.main.head).toBe(doc.length - 2);
  });
});

const LEDGER = (ids: Record<string, string>) =>
  `\n<!-- redlines\nversion: 1\npeople:\n  ada: {name: Ada Lovelace}\n  bob: {name: Bob}\nmarks:\n${Object.entries(
    ids,
  )
    .map(([id, by]) => `  ${id}: {by: ${by}, at: 2026-11-05T22:00Z}\n`)
    .join('')}-->\n`;

describe('the box as drawn', () => {
  const doc = '- [ ] Buy milk\n- [x] Call Ada\n\nEnd.\n';

  it('is a small SVG, 0.8 em square, centred on the x-height, not a font glyph', () => {
    const editor = editorAt(doc, doc.length - 2);
    for (const box of boxes(editor)) {
      expect(box.tagName.toLowerCase()).toBe('svg');
      expect(box.textContent).toBe('');
      expect(box.getAttribute('role')).toBe('checkbox');
    }
    const css = [...document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
    expect(css).toMatch(/\.rl-box[^{]*\{[^}]*width: 0\.8em/);
    expect(css).toMatch(/\.rl-box[^{]*\{[^}]*height: 0\.8em/);
    expect(css).toMatch(/\.rl-box[^{]*\{[^}]*vertical-align: middle/);
  });

  it('has a 1.25 px border in the third ink, a radius of 0.18 em and a filled checked state', () => {
    const editor = editorAt(doc, doc.length - 2);
    const css = [...document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
    // 16 units are 0.8 em: 1.5625 units are 1.25 px at 16 px, and 2.82 + half the stroke is 0.18 em.
    expect(css).toMatch(/\.rl-box rect[^{]*\{[^}]*stroke: var\(--rl-ink-3\)/);
    expect(css).toMatch(/\.rl-box rect[^{]*\{[^}]*stroke-width: 1\.5625/);
    expect(css).toMatch(/\.rl-box-checked rect[^{]*\{[^}]*fill: var\(--rl-ink-2\)/);
    expect(css).toMatch(/\.rl-box path[^{]*\{[^}]*stroke: var\(--rl-page\)/);
    expect(css).toMatch(/\.rl-box:hover rect[^{]*\{[^}]*stroke: var\(--rl-ink-2\)/);
    const rect = boxes(editor)[0]?.querySelector('rect');
    expect(Number(rect?.getAttribute('rx')) + 1.5625 / 2).toBeCloseTo(0.18 * 20, 1);
  });

  it('does not strike a checked item through', () => {
    const editor = editorAt(doc, doc.length - 2);
    const css = [...document.querySelectorAll('style')].map((e) => e.textContent).join('\n');
    expect(css).not.toMatch(/line-through[^}]*rl-task|rl-task[^}]*line-through/);
    const line = editor.view.dom.querySelectorAll('.cm-line')[1];
    expect(line?.querySelector('.rl-del, s, del')).toBeNull();
  });

  it('keeps its column when its source shows', () => {
    const away = editorAt(doc, doc.length - 2);
    const on = editorAt(doc, 3);
    const cols = (editor: Editor) =>
      editor.view.dom.querySelector('.rl-task')?.getAttribute('style') ?? '';
    expect(cols(away)).toContain('--rl-cols: 6');
    // On the marker it is source in monospace, six columns as the box was.
    expect(on.view.dom.querySelector('.rl-list-source')?.textContent).toBe('- [ ] ');
  });
});

describe('a box with a pending change', () => {
  const checked = (extra = '') =>
    `- [x] Buy milk<!--fmt bbk2 +check-->\n- [ ] Call Ada\n\nEnd.\n${LEDGER({ bbk2: 'bob', ...(extra ? {} : {}) })}`;

  it("is drawn in its new state, in its author's color in Redlines, with the line's bar", () => {
    const text = checked();
    const editor = editorAt(text, text.indexOf('End.'), 'redlines');
    const [box] = boxes(editor);
    expect(box?.getAttribute('aria-checked')).toBe('true');
    const wrap = box?.parentElement;
    expect(wrap?.classList.contains('rl-box-pending')).toBe(true);
    expect([...(wrap?.classList ?? [])].some((c) => /^rl-author-\d$/.test(c))).toBe(true);
    const lines = [...editor.view.dom.querySelectorAll('.cm-line')];
    expect(lines[0]?.classList.contains('rl-bar')).toBe(true);
    expect(lines[1]?.classList.contains('rl-bar')).toBe(false);
    // The box below is not pending.
    expect(boxes(editor)[1]?.parentElement?.classList.contains('rl-box-pending')).toBe(false);
  });

  it('has the bar in Simple, and no author color; in Clean, neither', () => {
    const text = checked();
    const simple = editorAt(text, text.indexOf('End.'), 'simple');
    expect(simple.view.dom.querySelector('.cm-line')?.classList.contains('rl-bar')).toBe(true);
    expect(boxes(simple)[0]?.parentElement?.className).not.toMatch(/rl-author/);
    const clean = editorAt(text, text.indexOf('End.'), 'clean');
    expect(clean.view.dom.querySelector('.cm-line')?.classList.contains('rl-bar')).toBe(false);
    expect(boxes(clean)[0]?.parentElement?.className).not.toMatch(/rl-author/);
    expect(boxes(clean)[0]?.getAttribute('aria-checked')).toBe('true');
  });

  it('is drawn for an inserted box, and the source stays for a change it cannot draw', () => {
    const inserted = `One.\n\n<!--ins bbk2-->\n\n- [ ] New<!--/bbk2-->\n\nEnd.\n${LEDGER({ bbk2: 'bob' })}`;
    const a = editorAt(inserted, inserted.indexOf('End.'), 'redlines');
    expect(boxes(a)).toHaveLength(1);
    expect(boxes(a)[0]?.parentElement?.classList.contains('rl-box-pending')).toBe(true);
    const half = `- [<!--ins bbk2-->x<!--/bbk2-->] New\n\nEnd.\n${LEDGER({ bbk2: 'bob' })}`;
    expect(boxes(editorAt(half, half.indexOf('End.'), 'redlines'))).toHaveLength(0);
  });
});

describe('the box for the keyboard and a screen reader', () => {
  const doc = '- [ ] Buy milk\n- [x] Call Ada\n\nEnd.\n';
  const css = () => [...document.querySelectorAll('style')].map((e) => e.textContent).join('\n');

  it('has a name, "To do" or "Done", and can be reached by the keyboard', () => {
    const editor = editorAt(doc, doc.length - 2);
    const [open_, done] = boxes(editor);
    expect(open_?.getAttribute('aria-label')).toBe('To do');
    expect(done?.getAttribute('aria-label')).toBe('Done');
    expect(open_?.getAttribute('tabindex')).toBe('0');
  });

  it('is checked by Space, asking as a click does, and by no other key', () => {
    const editor = editorAt(doc, doc.length - 2);
    const requests: unknown[] = [];
    editor.addExtension(
      EditorView.updateListener.of(({ transactions }) => {
        for (const tr of transactions)
          for (const e of tr.effects) if (e.is(checkBoxEffect)) requests.push(e.value);
      }),
    );
    const key = (k: string) => {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      boxes(editor)[1]?.dispatchEvent(event);
      return event;
    };
    expect(key('a').defaultPrevented).toBe(false);
    expect(key('Enter').defaultPrevented).toBe(false);
    expect(requests).toEqual([]);
    expect(key(' ').defaultPrevented).toBe(true);
    expect(requests).toEqual([{ pos: 15, checked: false }]);
  });

  it('draws the theme ring on keyboard focus, and a hover for a pending checked box', () => {
    editorAt(doc, doc.length - 2);
    expect(css()).toMatch(/\.rl-box:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--rl-ink-3\)/);
    expect(css()).toMatch(/\.rl-box-pending \.rl-box-checked:hover rect/);
  });

  it('says what is pending and by whom, in every view', () => {
    const text = `- [x] Buy milk<!--fmt bbk2 +check-->\n- [ ] Call Ada<!--fmt bbk3 -check-->\n\nEnd.\n${LEDGER({ bbk2: 'bob', bbk3: 'bob' })}`;
    for (const mode of ['redlines', 'simple', 'clean'] as const) {
      const editor = editorAt(text, text.indexOf('End.'), mode);
      expect(
        boxes(editor).map((box) => box.getAttribute('aria-label')),
        mode,
      ).toEqual(['Done, checked by Bob, pending', 'To do, unchecked by Bob, pending']);
    }
  });
});

describe('an empty task item', () => {
  it('is an empty box at the item indent, not a bullet and its source', () => {
    const text = '- one\n  - [ ] \n\nEnd.\n';
    const editor = editorAt(text, text.indexOf('End.'));
    expect(boxes(editor)).toHaveLength(1);
    expect(boxes(editor)[0]?.getAttribute('aria-checked')).toBe('false');
    expect(editor.view.dom.textContent).not.toContain('[ ]');
    expect(editor.view.dom.textContent).not.toContain('•[');
    const marks = editor.view.dom.querySelectorAll('.rl-list-mark');
    expect(marks).toHaveLength(2);
  });

  it('is one in a numbered list, and a checked one', () => {
    const text = '1. [ ] \n2. [x] \n\nEnd.\n';
    const editor = editorAt(text, text.indexOf('End.'));
    expect(boxes(editor).map((box) => box.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  });

  it('shows its source with the caret on it', () => {
    const text = '- [ ]\n\nEnd.\n';
    const editor = editorAt(text, 4);
    expect(boxes(editor)).toHaveLength(0);
    expect(editor.view.dom.textContent).toContain('[ ]');
  });
});

describe('keys on an empty task item (#198)', () => {
  /** An editor on `doc`, with the caret at `‸`, after pressing `keys`, tracked or not. */
  function pressed(doc: string, keys: string[], tracking: boolean): Editor {
    const editor = editorAt(doc.replace('‸', ''), doc.indexOf('‸'), undefined, tracking);
    for (const key of keys) {
      runScopeHandlers(
        editor.view,
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        'editor',
      );
    }
    return editor;
  }
  const filePart = (editor: Editor) => editor.getDoc().replace(/\n<!-- redlines[^]*$/, '');
  const newest = (editor: Editor) => newestView(filePart(editor)).text.replace(/\n+$/, '');
  const isOpen = (editor: Editor) => editor.view.contentDOM.dataset['rlOpenBlock'] !== undefined;
  const text = (editor: Editor) => editor.view.dom.textContent ?? '';

  it('is drawn as a box after Return, at the indent of the item above, tracked or not', () => {
    for (const tracking of [false, true]) {
      const editor = pressed('- [ ] one‸', ['Enter'], tracking);
      expect(boxes(editor), `tracking ${tracking}`).toHaveLength(2);
      expect(text(editor)).not.toContain('[ ]');
      expect(newest(editor)).toBe('- [ ] one\n- [ ] ');
    }
  });

  it('is taken away by one Backspace, box and bullet together, and the next takes a letter', () => {
    const one = pressed('- [ ] one\n- [ ] ‸', ['Backspace'], false);
    expect(filePart(one)).toBe('- [ ] one');
    expect(boxes(one)).toHaveLength(1);
    const two = pressed('- [ ] one\n- [ ] ‸', ['Backspace', 'Backspace'], false);
    expect(filePart(two)).toBe('- [ ] on');
  });

  it('is taken away tracked by one Backspace, as a change, leaving one box drawn', () => {
    const editor = pressed('- [ ] one\n- [ ] ‸', ['Backspace'], true);
    expect(newest(editor).trimEnd()).toBe('- [ ] one');
    expect(boxes(editor)).toHaveLength(1);
    expect(filePart(editor)).toMatch(/<!--sub \w+ /);
  });

  it('leaves the checklist on a second Return: an empty paragraph is open, the file keeps the item', () => {
    for (const tracking of [false, true]) {
      const editor = pressed('- [ ] one‸\n\nEnd.', ['Enter', 'Enter'], tracking);
      expect(isOpen(editor), `tracking ${tracking}`).toBe(true);
      expect(boxes(editor)).toHaveLength(1);
      expect(newest(editor)).toBe('- [ ] one\n- [ ] \n\nEnd.');
    }
  });

  it('is nested by Tab, as an empty box one level in, in the file (its box is its content)', () => {
    for (const tracking of [false, true]) {
      const editor = pressed('- [ ] one‸', ['Enter', 'Tab'], tracking);
      expect(isOpen(editor), `tracking ${tracking}`).toBe(false);
      expect(boxes(editor)).toHaveLength(2);
      expect(text(editor)).not.toContain('[ ]');
      expect(newest(editor)).toBe('- [ ] one\n  - [ ] ');
    }
  });

  it('leaves the open empty item of a checklist open, with its boxes drawn and the file without it', () => {
    for (const tracking of [false, true]) {
      const editor = pressed('- [ ] one\n- two‸', ['Enter', 'Tab'], tracking);
      expect(isOpen(editor), `tracking ${tracking}`).toBe(true);
      expect(boxes(editor)).toHaveLength(1);
      expect(newest(editor)).toBe('- [ ] one\n- two');
    }
  });
});

describe('entities, left as source', () => {
  const code = (n: number) => `&#x${n.toString(16)};`;
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const hidden = [
    ...range(0x202a, 0x202e),
    ...range(0x2066, 0x2069),
    ...[0x200e, 0x200f, 0x061c],
    ...range(0x200b, 0x200d),
    ...[0x2060, 0xfeff],
    ...[0xfdd0, 0xfffe, 0x1ffff],
    ...[0xad, 0x180e, 0x2028, 0x2029],
    ...range(0x2061, 0x2064),
  ];

  it('keeps direction controls, zero-width characters and noncharacters as source', () => {
    for (const n of hidden) expect(decodeEntity(code(n)), code(n)).toBeNull();
    expect(decodeEntity('&#173;')).toBeNull();
    expect(decodeEntity('&#x1F600;')).toBe('😀');
  });

  it('draws none of them in the editor', () => {
    const text = `a ${hidden.map(code).join(' ')} b\n\nEnd.\n`;
    expect(entities(editorAt(text, text.length - 2))).toEqual([]);
  });

  it('draws &lt; and &gt; as text, not as elements', () => {
    const text = 'a &lt;b&gt; c\n\nEnd.\n';
    const editor = editorAt(text, text.length - 2);
    expect(entities(editor)).toEqual(['<', '>']);
    expect(editor.view.dom.querySelector('b')).toBeNull();
  });
});

describe('entities', () => {
  const doc = 'Fish &amp; chips &mdash; &#169; &#x2014; &foo;\n';

  it('shows &amp; and &mdash; as their characters, and the source when the caret is on them', () => {
    const away = editorAt(doc, doc.length - 1);
    expect(entities(away)).toEqual(['&', '—', '©', '—']);
    const on = editorAt(doc, 7);
    expect(entities(on)).toEqual(['—', '©', '—']);
    expect(on.view.dom.textContent).toContain('&amp;');
  });

  it('leaves an unknown name as source', () => {
    const editor = editorAt(doc, 0);
    expect(editor.view.dom.textContent).toContain('&foo;');
  });

  it('leaves entities in code alone', () => {
    const text = 'Inline `&amp;` here.\n\n```\n&mdash;\n```\n\n    &copy;\n\nEnd.\n';
    const editor = editorAt(text, text.length - 2);
    expect(entities(editor)).toEqual([]);
    expect(editor.view.dom.textContent).toContain('&amp;');
    expect(editor.view.dom.textContent).toContain('&mdash;');
    expect(editor.view.dom.textContent).toContain('&copy;');
  });
});
