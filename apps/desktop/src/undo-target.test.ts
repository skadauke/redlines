// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { historyIsDocuments } from './undo-target.ts';

afterEach(() => {
  document.body.replaceChildren();
});

function page() {
  document.body.innerHTML = `
    <div id="editor"><div id="content" contenteditable="true" tabindex="0"></div></div>
    <textarea id="comment"></textarea>
    <input id="find" type="text" />
    <input id="box" type="checkbox" />
    <div id="note" contenteditable="true" tabindex="0"></div>
    <button id="button">Go</button>`;
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  return { editor: get('editor'), get };
}

describe('whose history Undo and Redo take back', () => {
  it("is the document's while its editor has the focus, or nothing does", () => {
    const { editor, get } = page();
    expect(historyIsDocuments(editor, document.body, true)).toBe(true);
    expect(historyIsDocuments(editor, null, true)).toBe(true);
    expect(historyIsDocuments(editor, get('content'), true)).toBe(true);
    expect(historyIsDocuments(editor, get('button'), true)).toBe(true);
    expect(historyIsDocuments(editor, get('box'), true)).toBe(true);
  });

  it("is a text field's while one outside the editor has the focus", () => {
    const { editor, get } = page();
    expect(historyIsDocuments(editor, get('comment'), true)).toBe(false);
    expect(historyIsDocuments(editor, get('find'), true)).toBe(false);
    expect(historyIsDocuments(editor, get('note'), true)).toBe(false);
  });

  it("is another window's field when this window doesn't have the keys (Preferences)", () => {
    const { editor, get } = page();
    expect(historyIsDocuments(editor, get('content'), false)).toBe(false);
    expect(historyIsDocuments(editor, document.body, false)).toBe(false);
  });
});
