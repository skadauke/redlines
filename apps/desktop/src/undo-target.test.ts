// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { historyIsDocuments, routeHistory, type HistoryRoute } from './undo-target.ts';

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

describe("routing the menu's Undo and Redo", () => {
  const route = (overrides: Partial<HistoryRoute> = {}) => {
    const { editor, get } = page();
    const made = {
      editor: { dom: editor, undo: vi.fn(() => true), redo: vi.fn(() => true) },
      active: () => get('content'),
      windowHasKeys: () => true,
      askApp: vi.fn(() => Promise.resolve(true)),
      pageUndo: vi.fn(),
      beep: vi.fn(),
      fail: vi.fn(),
      ...overrides,
    } satisfies HistoryRoute;
    return { made, get };
  };

  it('calls the editor in the document, and nothing else', () => {
    const { made } = route();
    routeHistory(made, false);
    routeHistory(made, true);
    expect(made.editor.undo).toHaveBeenCalledOnce();
    expect(made.editor.redo).toHaveBeenCalledOnce();
    expect(made.askApp).not.toHaveBeenCalled();
    expect(made.pageUndo).not.toHaveBeenCalled();
  });

  it("asks the app for a field's own undo, and beeps when nothing took it", async () => {
    const { get } = route();
    const taken = route({ active: () => get('comment') });
    routeHistory(taken.made, true);
    expect(taken.made.askApp).toHaveBeenCalledWith(true);
    await Promise.resolve();
    expect(taken.made.beep).not.toHaveBeenCalled();
    expect(taken.made.editor.redo).not.toHaveBeenCalled();

    const refused = route({
      windowHasKeys: () => false,
      askApp: vi.fn(() => Promise.resolve(false)),
    });
    routeHistory(refused.made, false);
    await vi.waitFor(() => expect(refused.made.beep).toHaveBeenCalledOnce());
    expect(refused.made.editor.undo).not.toHaveBeenCalled();
  });

  it("says when the app can't be asked", async () => {
    const error = new Error('no');
    const { get } = route();
    const failing = route({
      active: () => get('find'),
      askApp: vi.fn(() => Promise.reject(error)),
    });
    routeHistory(failing.made, false);
    await vi.waitFor(() => expect(failing.made.fail).toHaveBeenCalledWith(error));
    expect(failing.made.beep).not.toHaveBeenCalled();
  });

  it("uses the page's own undo where there is no app", () => {
    const { get } = route();
    const browser = route({ active: () => get('find'), askApp: null });
    routeHistory(browser.made, true);
    expect(browser.made.pageUndo).toHaveBeenCalledWith(true);
    expect(browser.made.editor.redo).not.toHaveBeenCalled();
  });
});
