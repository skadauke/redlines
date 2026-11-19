// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { click, file, mount, PEOPLE, tick, thread, unmountAll } from './test-helpers.ts';

afterEach(unmountAll);

/** A change, a comment with a reply, and a highlight, each on its own word. */
const doc = file(
  'The <!--ins k3x9-->new <!--/k3x9-->importer <!--cmt c2dk-->ships<!--/c2dk--> in <!--hl h4kz-->April<!--/h4kz-->.\n\nMore.',
  [
    ...PEOPLE,
    'marks:',
    '  k3x9: {by: ada, at: 2026-10-31T09:30Z}',
    '  h4kz: {by: bo, at: 2026-10-31T09:41Z}',
    'comments:',
    ...thread('c2dk', 'bo', 'Which importer?', [
      { id: 'r5tw', by: 'claude-ada', text: 'The new one.' },
    ]),
  ],
);

const at = (editor: { view: { state: { doc: { toString(): string } } } }, needle: string) =>
  editor.view.state.doc.toString().indexOf(needle) + 1;

describe('the review card of a place, for the toolbar', () => {
  it('is the change’s card at a change: who, what it did, Accept and Reject', () => {
    const { review, editor } = mount(doc);
    const card = review.bubbleAt({ pos: at(editor, 'new ') + 1 });
    expect(card).not.toBeNull();
    expect(card?.querySelector('.rl-bubble-name')?.textContent).toBe('Ada Lovelace');
    expect(card?.querySelector('.rl-bubble-what')?.textContent).toBe('Inserted “new”');
    expect([...(card?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Accept',
      'Reject',
    ]);
  });

  it('decides the change from its button, and says it is done', async () => {
    const { review, editor, decided } = mount(doc);
    const card = review.bubbleAt({ pos: at(editor, 'new ') + 1 })!;
    document.body.append(card);
    let told = 0;
    card.addEventListener('rl-bubble-done', () => told++);
    card.querySelector<HTMLButtonElement>('.rl-bubble-action')?.click();
    await tick();
    expect(decided).toEqual([{ id: 'k3x9', how: 'accept' }]);
    expect(told).toBe(1);
  });

  it('is the comment’s at a comment: its text and replies, Resolve and Reply', () => {
    const { review, editor } = mount(doc);
    const card = review.bubbleAt({ pos: at(editor, 'ships') + 2 });
    expect(card?.querySelector('.rl-bubble-name')?.textContent).toBe('Bo Chen');
    const texts = [...(card?.querySelectorAll('.rl-bubble-text') ?? [])].map((t) => t.textContent);
    expect(texts).toEqual(['Which importer?', 'The new one.']);
    expect([...(card?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Resolve',
      'Reply',
    ]);
  });

  it('resolves the comment from its button', async () => {
    const { review, editor } = mount(doc);
    const card = review.bubbleAt({ pos: at(editor, 'ships') + 2 })!;
    document.body.append(card);
    card.querySelector<HTMLButtonElement>('.rl-bubble-action')?.click();
    await tick();
    expect(editor.getParsed().ledger.comments[0]?.resolved).toBeDefined();
  });

  it('is the highlight’s at a highlight, with Remove where the caret is in it', async () => {
    const { review, editor } = mount(doc);
    const pos = at(editor, 'April') + 2;
    editor.view.dispatch({ selection: { anchor: pos } });
    const card = review.bubbleAt({ pos })!;
    expect(card.querySelector('.rl-bubble-what')?.textContent).toBe('Highlighted');
    document.body.append(card);
    card.querySelector<HTMLButtonElement>('.rl-bubble-action')?.click();
    await tick();
    expect(editor.getParsed().marks.some((mark) => mark.kind === 'hl')).toBe(false);
  });

  it('is none where there is no change, comment or highlight', () => {
    const { review, editor } = mount(doc);
    expect(review.bubbleAt({ pos: editor.view.state.doc.length - 2 })).toBeNull();
  });

  it('puts away a change’s card that was open: it is the same card', async () => {
    const { review, editor } = mount(doc);
    const target = editor.view.contentDOM.querySelector('.rl-ins');
    expect(target).not.toBeNull();
    click(target!, editor.view.contentDOM);
    await tick();
    expect(editor.view.dom.querySelector('.rl-card')).not.toBeNull();
    review.bubbleAt({ pos: at(editor, 'new ') + 1 });
    expect(editor.view.dom.querySelector('.rl-card')).toBeNull();
  });
});

describe('a left click on a highlight', () => {
  it('opens its card alone', async () => {
    const { editor } = mount(doc);
    const pos = at(editor, 'April') + 2;
    const content = editor.view.contentDOM;
    const init = { bubbles: true, cancelable: true, button: 0 };
    // The press puts the caret where the pointer is (a page with a layout does; here it is set).
    content.dispatchEvent(new MouseEvent('mousedown', init));
    editor.view.dispatch({ selection: { anchor: pos } });
    content.dispatchEvent(new MouseEvent('mouseup', init));
    await tick();
    const card = editor.view.dom.querySelector('.rl-card');
    expect(card?.querySelector('.rl-card-what')?.textContent).toBe('Highlighted');
    expect(card?.querySelector('[aria-label="Remove Highlight"]')).not.toBeNull();
  });

  it('opens nothing on text with no highlight', async () => {
    const { editor } = mount(doc);
    const content = editor.view.contentDOM;
    const init = { bubbles: true, cancelable: true, button: 0 };
    content.dispatchEvent(new MouseEvent('mousedown', init));
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length - 2 } });
    content.dispatchEvent(new MouseEvent('mouseup', init));
    await tick();
    expect(editor.view.dom.querySelector('.rl-card')).toBeNull();
  });
});
