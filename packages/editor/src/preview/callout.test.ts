// @vitest-environment happy-dom
// Alerts in the preview (#311, design §5.2): a quote whose first line is a type in brackets is drawn
// as a box with an icon and a title, and a menu in the title asks for another type. The source
// shows while the caret is in the title line, as that of any syntax does.

import { forceParsing } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { calloutMenuEffect, createEditor, type Editor } from '../index.ts';
import { previewDecorations } from './decorations.ts';

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
): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  if (mode) editor.setViewMode(mode);
  editor.view.dispatch({ selection: { anchor: cursor } });
  open.push(editor);
  return editor;
}

/** The classes that the line decorations give each line, by the line's start. */
function lineClasses(editor: Editor): Map<number, string[]> {
  const lines = new Map<number, string[]>();
  const { state } = editor.view;
  previewDecorations(state).between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string };
    if (value.point && from === to && spec.class) {
      lines.set(from, [...(lines.get(from) ?? []), ...spec.class.split(' ')]);
    }
  });
  return lines;
}

/** The replaced ranges, each with the widget that stands for it, if any. */
function replaced(editor: Editor) {
  const found: { from: number; to: number; widget: unknown }[] = [];
  const { state } = editor.view;
  previewDecorations(state).between(0, state.doc.length, (from, to, value) => {
    if (value.point && from < to) {
      found.push({ from, to, widget: (value.spec as { widget?: unknown }).widget });
    }
  });
  return found;
}

/** The title of an alert as the document draws it. */
function title(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector<HTMLElement>('.rl-callout-head');
}

const ALERT = 'Intro.\n\n> [!NOTE]\n> Useful information.\n\nAfter.\n';

describe('an alert in the preview (#311)', () => {
  it('is a box: every line of the quote is a line of it, and none a plain quote’s', () => {
    const editor = editorAt(ALERT, 0);
    const first = ALERT.indexOf('> [!NOTE]');
    const second = ALERT.indexOf('> Useful');
    const lines = lineClasses(editor);
    expect(lines.get(first)).toEqual(
      expect.arrayContaining(['rl-callout', 'rl-callout-note', 'rl-callout-first']),
    );
    expect(lines.get(second)).toEqual(
      expect.arrayContaining(['rl-callout', 'rl-callout-note', 'rl-callout-last']),
    );
    expect(lines.get(first)).not.toContain('rl-quote');
    expect(lines.get(second)).not.toContain('rl-quote');
    expect(lines.get(second)).not.toContain('rl-callout-first');
  });

  it('draws the first line as a title and hides the quote mark of the lines after it', () => {
    const editor = editorAt(ALERT, 0);
    const first = ALERT.indexOf('> [!NOTE]');
    const second = ALERT.indexOf('> Useful');
    const marks = replaced(editor);
    // The title stands for the first line's syntax, and the next line's quote mark is hidden.
    const title = marks.find((mark) => mark.from === first);
    expect(title?.to).toBe(first + '> [!NOTE]'.length);
    expect(title?.widget).toBeDefined();
    const hidden = marks.find((mark) => mark.from === second);
    expect(hidden?.to).toBe(second + 2);
    expect(hidden?.widget).toBeUndefined();
  });

  it('names the type with an icon, and has a menu button that is a button', () => {
    const editor = editorAt(ALERT, 0);
    const head = title(editor);
    expect(head).not.toBeNull();
    expect(head?.textContent).toContain('Note');
    expect(head?.querySelector('svg.rl-callout-icon')).not.toBeNull();
    const menu = head?.querySelector('button.rl-callout-menu');
    expect(menu?.getAttribute('aria-label')).toBe('Alert type');
    expect(menu?.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('names each type of GitHub, and keeps a type of another word as written', () => {
    for (const [word, name] of [
      ['TIP', 'Tip'],
      ['IMPORTANT', 'Important'],
      ['WARNING', 'Warning'],
      ['CAUTION', 'Caution'],
      ['note', 'Note'],
      ['info', 'Info'],
    ] as const) {
      const doc = `> [!${word}]\n> Body.\n`;
      const editor = editorAt(doc, doc.length);
      expect(title(editor)?.textContent, word).toContain(name);
      expect(lineClasses(editor).get(0), word).toContain(`rl-callout-${word.toLowerCase()}`);
    }
  });

  it('draws a type that is a name of JavaScript’s objects as any other, with the note’s icon', () => {
    for (const word of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      const doc = `> [!${word}]\n> Body.\n`;
      const editor = editorAt(doc, doc.length);
      expect(title(editor)?.textContent, word).toContain(
        word.charAt(0).toUpperCase() + word.slice(1),
      );
      expect(title(editor)?.querySelector('svg.rl-callout-icon'), word).not.toBeNull();
    }
    // One of them written into a live editor is drawn too.
    const editor = editorAt('Intro.\n\n', 0);
    editor.view.dispatch({ changes: { from: 8, insert: '> [!constructor]\n> Body.\n' } });
    forceParsing(editor.view, editor.view.state.doc.length, 10_000);
    expect(title(editor)?.textContent).toContain('Constructor');
  });

  it('shows the source in the syntax color while the caret is in the title line', () => {
    const editor = editorAt(ALERT, ALERT.indexOf('NOTE') + 2);
    expect(title(editor)).toBeNull();
    const first = ALERT.indexOf('> [!NOTE]');
    expect(replaced(editor).some((mark) => mark.from === first)).toBe(false);
    // The box is still drawn: only the title row's syntax is source.
    expect(lineClasses(editor).get(first)).toContain('rl-callout');
  });

  it('keeps a title that follows the type as text, and a fold mark in the syntax', () => {
    const doc = '> [!info]- A title\n> Body.\n';
    const editor = editorAt(doc, doc.length);
    const head = title(editor);
    expect(head).not.toBeNull();
    // The title text stays in the document, where it is edited.
    expect(head?.textContent).not.toContain('A title');
    const marks = replaced(editor);
    expect(
      marks.some((mark) => mark.from === 0 && doc.slice(mark.from, mark.to).includes('[!info]')),
    ).toBe(true);
    expect(marks.every((mark) => doc.slice(mark.from, mark.to) !== ' A title')).toBe(true);
  });

  it('marks the whole title as its text, whatever markers of changes are inside it', () => {
    const doc = '> [!info] A <!--ins k3x9-->new<!--/k3x9--> title\n> Body.\n';
    const editor = editorAt(doc, doc.length);
    const found: { from: number; to: number }[] = [];
    const { state } = editor.view;
    previewDecorations(state).between(0, state.doc.length, (from, to, value) => {
      if ((value.spec as { class?: string }).class === 'rl-callout-text') found.push({ from, to });
    });
    expect(found).toEqual([{ from: '> [!info]'.length, to: doc.indexOf('\n') }]);
  });

  it('is an alert with the markers of tracked changes after its type, which are no text', () => {
    const doc = '> [!NOTE]<!--ins k3x9--><!--split p7qd-->\n> Body<!--/k3x9-->\n';
    const editor = editorAt(doc, doc.length);
    expect(title(editor)?.textContent).toContain('Note');
    expect(lineClasses(editor).get(0)).toContain('rl-callout-first');
  });

  it('is no alert in a list item, in another quote, or where the first line is more', () => {
    for (const doc of [
      '- Item\n\n  > [!NOTE]\n  > Body.\n',
      '> > [!NOTE]\n> > Body.\n',
      '> Text\n> [!NOTE]\n',
      '> [!NOTE]more\n> Body.\n',
      '[!NOTE]\nBody.\n',
      '> [!]\n> Body.\n',
    ]) {
      const editor = editorAt(doc, doc.length);
      const lines = [...lineClasses(editor).values()].flat();
      expect(
        lines.some((name) => name.startsWith('rl-callout')),
        JSON.stringify(doc),
      ).toBe(false);
      expect(title(editor), JSON.stringify(doc)).toBeNull();
    }
  });

  describe('with a pending change of its type', () => {
    const pending =
      'Intro.\n\n<!--fmt q2hw was=callout-note-->\n\n> [!TIP]\n> Useful information.<!--/q2hw-->\n\nAfter.\n\n' +
      '<!-- redlines\nversion: 1\npeople:\n  ada: {name: Ada Lovelace}\n  bo: {name: Bo Chen}\nmarks:\n' +
      '  q2hw: {by: bo, at: 2026-10-31T09:00Z}\n-->\n';

    it('is drawn in the author’s color in Redlines, and told to a screen reader', () => {
      const editor = editorAt(pending, 0, 'redlines');
      const head = title(editor);
      expect(head?.classList.contains('rl-callout-pending')).toBe(true);
      expect([...(head?.classList ?? [])].some((name) => /^rl-author-\d$/.test(name))).toBe(true);
      expect(head?.getAttribute('aria-label')).toBe('Tip alert, type changed by Bo Chen, pending');
      // The type shown is the new one, and the box is drawn as that type's.
      expect(head?.textContent).toContain('Tip');
      expect(lineClasses(editor).get(pending.indexOf('> [!TIP]'))).toContain('rl-callout-tip');
    });

    it('is pending but in no author’s color in Simple, and not in Raw', () => {
      const simple = title(editorAt(pending, 0, 'simple'));
      expect(simple?.classList.contains('rl-callout-pending')).toBe(true);
      expect(simple?.className).not.toMatch(/rl-author/);
      expect(title(editorAt(pending, 0, 'raw'))).toBeNull();
    });

    it('is not drawn for an alert that has no pending change', () => {
      const head = title(editorAt(ALERT, 0, 'redlines'));
      expect(head?.classList.contains('rl-callout-pending')).toBe(false);
      expect(head?.getAttribute('aria-label')).toBe('Note alert');
    });
  });

  it('asks for the menu with its place and type, and changes nothing itself', () => {
    const editor = editorAt(ALERT, ALERT.length - 1);
    const asked: unknown[] = [];
    editor.addExtension(
      EditorView.updateListener.of(({ transactions }) => {
        for (const tr of transactions) {
          for (const effect of tr.effects) {
            if (effect.is(calloutMenuEffect)) asked.push(effect.value);
          }
        }
      }),
    );
    const button = title(editor)?.querySelector<HTMLElement>('button.rl-callout-menu');
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    button?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(asked).toHaveLength(1);
    // A place inside the type's word, which a format change takes for the alert it is in.
    expect(asked[0]).toMatchObject({ pos: ALERT.indexOf('NOTE') + 1, type: 'note' });
    expect(editor.getDoc()).toBe(ALERT);
  });

  it('is not drawn in Raw, which shows the source as written', () => {
    const editor = editorAt(ALERT, 0);
    editor.setViewMode('raw');
    expect(title(editor)).toBeNull();
    expect([...lineClasses(editor).values()].flat()).toEqual([]);
  });

  it('keeps a table, code and a list next to it as they were', () => {
    const doc = '> [!TIP]\n> Body.\n\n- one\n- two\n\n```\ncode\n```\n';
    const editor = editorAt(doc, doc.length);
    const lines = [...lineClasses(editor).values()].flat();
    expect(lines).toContain('rl-callout-tip');
    expect(lines).toContain('rl-li');
    expect(lines).toContain('rl-codeblock');
  });
});
