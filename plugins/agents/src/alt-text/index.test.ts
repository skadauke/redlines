// @vitest-environment happy-dom
// The Alt Text bubble (#553): its field, Save and Cancel, "Describe with <agent>" and the states
// around the agent's answer, and that nothing is written to the file before Save.
import { createEditor, type Editor } from '@redlines/editor';
import { newestView } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AltDescriber,
  type AltImage,
  type AltText,
  createAltText,
  NO_IMAGE,
  WRITTEN_BY,
} from './index.ts';

const DOC = 'Before.\n\n![A red square](red.png)\n\nAfter.\n';
const mounted: { editor: Editor; alt: AltText }[] = [];
afterEach(() => {
  for (const { editor, alt } of mounted.splice(0)) {
    alt.destroy();
    editor.destroy();
  }
  document.body.replaceChildren();
  document.head.replaceChildren();
});

/** A describer whose answer the test settles by hand. */
function describer(name = 'Claude', unavailable?: string) {
  const asked: { image: AltImage; signal: AbortSignal }[] = [];
  let settle: { ok(text: string): void; fail(message: string): void } | null = null;
  const made: AltDescriber = {
    who: () => Promise.resolve({ name, ...(unavailable === undefined ? {} : { unavailable }) }),
    describe: (image, signal) =>
      new Promise<string>((ok, fail) => {
        asked.push({ image, signal });
        settle = { ok, fail: (message) => fail(new Error(message)) };
      }),
  };
  return { made, asked, settle: () => settle! };
}

function mount(options: { describer?: AltDescriber; notices?: string[]; doc?: string } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const notices = options.notices ?? [];
  const editor = createEditor(parent, {
    doc: options.doc ?? DOC,
    author: { handle: 'ada', name: 'Ada' },
    openImage: () => {},
    onNotice: (message) => notices.push(message),
  });
  const alt = createAltText(editor, {
    notice: (message) => notices.push(message),
    ...(options.describer ? { describer: options.describer } : {}),
  });
  mounted.push({ editor, alt });
  return { editor, alt, notices };
}

const at = (editor: Editor, text: string) =>
  editor.view.dispatch({
    selection: { anchor: editor.view.state.doc.toString().indexOf(text) + 1 },
  });
const bubble = () => document.querySelector<HTMLElement>('.rl-qa-alt');
const field = () => document.querySelector<HTMLTextAreaElement>('.rl-qa-alt textarea')!;
const status = () => document.querySelector<HTMLElement>('.rl-qa-alt-status')!;
const button = (label: string | RegExp) =>
  [...document.querySelectorAll<HTMLButtonElement>('.rl-qa-alt button')].find((b) =>
    typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''),
  );
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const file = (editor: Editor) => editor.view.state.doc.toString();

describe('the command', () => {
  it('is Edit Image Alt Text…, disabled with its reason where no image is picked', () => {
    const { editor } = mount();
    const command = editor.commands.list().find(({ id }) => id === 'image.altText')!;
    expect(command.title).toBe('Edit Image Alt Text…');
    at(editor, 'Before');
    expect(command.disabledReason?.(editor.view.state)).toBe(NO_IMAGE);
    at(editor, 'A red');
    expect(command.disabledReason?.(editor.view.state)).toBeUndefined();
  });

  it('opens the bubble with the alt text the image has, selected, and says so where none is picked', () => {
    const { editor, notices } = mount();
    at(editor, 'Before');
    expect(editor.commands.run('image.altText')).toBe(false);
    expect(bubble()).toBeNull();
    expect(notices).toEqual([NO_IMAGE]);
    at(editor, 'A red');
    expect(editor.commands.run('image.altText')).toBe(true);
    expect(bubble()?.getAttribute('role')).toBe('dialog');
    expect(field().value).toBe('A red square');
  });
});

describe('a typed description', () => {
  it('is written by Save, as one edit, and the bubble goes', () => {
    const { editor, alt } = mount();
    at(editor, 'A red');
    alt.start();
    field().value = 'A solid red square on white';
    field().dispatchEvent(new Event('input'));
    expect(file(editor)).toBe(DOC);
    button('Save')!.click();
    expect(file(editor)).toBe('Before.\n\n![A solid red square on white](red.png)\n\nAfter.\n');
    expect(bubble()).toBeNull();
  });

  it('is Return in the field, and Cancel and Esc write nothing', () => {
    const { editor, alt } = mount();
    at(editor, 'A red');
    alt.start();
    field().value = 'One';
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(file(editor)).toContain('![One](red.png)');
    alt.start();
    field().value = 'Two';
    button('Cancel')!.click();
    expect(file(editor)).toContain('![One](red.png)');
    expect(bubble()).toBeNull();
    alt.start();
    field().value = 'Three';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(file(editor)).toContain('![One](red.png)');
    expect(bubble()).toBeNull();
  });

  it('with Track Changes on is a tracked edit', () => {
    const { editor, alt } = mount();
    editor.setTracking(true, { inFile: false });
    at(editor, 'A red');
    alt.start();
    // Saving the text it has already is no edit.
    button('Save')!.click();
    expect(file(editor)).toBe(DOC);
    alt.start();
    field().value = 'Red';
    button('Save')!.click();
    expect(file(editor)).toContain('<!--sub ');
    expect(newestView(file(editor)).text).toContain('![Red](red.png)');
  });

  it('goes when the image does, and is placed again as the text changes', () => {
    const { editor, alt } = mount();
    at(editor, 'A red');
    alt.start();
    expect(alt.isOpen()).toBe(true);
    editor.view.dispatch({ changes: { from: 0, insert: 'Intro.\n\n' } });
    expect(alt.isOpen()).toBe(true);
    const from = file(editor).indexOf('![');
    editor.view.dispatch({ changes: { from, to: from + '![A red square](red.png)'.length } });
    expect(alt.isOpen()).toBe(false);
  });
});

describe('Describe with the agent', () => {
  it('has no button without an agent, and one named for the agent with one', async () => {
    const plain = mount();
    at(plain.editor, 'A red');
    plain.alt.start();
    await settled();
    expect(button(/Describe/)).toBeUndefined();
    plain.alt.close();

    const { editor, alt } = mount({ describer: describer('Codex').made });
    at(editor, 'A red');
    alt.start();
    await settled();
    expect(button(/Describe/)?.textContent).toBe('Describe with Codex');
    expect(button(/Describe/)?.hidden).toBe(false);
  });

  it('waits while the agent writes, then shows its text with who wrote it, and writes only on Save', async () => {
    const agent = describer('Claude');
    const { editor, alt } = mount({ describer: agent.made });
    at(editor, 'A red');
    alt.start();
    await settled();
    button('Describe with Claude')!.click();
    // The wait: the field and Save are held; the request names the image as the document has it.
    expect(agent.asked[0]?.image).toEqual({ src: 'red.png', alt: 'A red square' });
    expect(status().textContent).toBe('Claude is looking at the image…');
    expect(field().disabled).toBe(true);
    expect(button('Save')!.getAttribute('aria-disabled')).toBe('true');
    button('Save')!.click();
    expect(file(editor)).toBe(DOC);

    agent.settle().ok('A flat red square,\nfilling the frame.');
    await settled();
    expect(field().disabled).toBe(false);
    expect(field().value).toBe('A flat red square, filling the frame.');
    expect(status().textContent).toBe(WRITTEN_BY('Claude'));
    expect(status().textContent).toBe('Written by Claude. Read it and change it before saving.');
    // Nothing is written until Save.
    expect(file(editor)).toBe(DOC);
    field().value = `${field().value} Red.`;
    button('Save')!.click();
    expect(file(editor)).toContain('![A flat red square, filling the frame. Red.](red.png)');
  });

  it('says why when the agent fails, and leaves the field as it was', async () => {
    const agent = describer('Claude');
    const { editor, alt } = mount({ describer: agent.made });
    at(editor, 'A red');
    alt.start();
    await settled();
    field().value = 'Mine';
    button('Describe with Claude')!.click();
    agent.settle().fail('Claude isn’t signed in.');
    await settled();
    expect(status().textContent).toBe('Claude isn’t signed in.');
    expect(field().value).toBe('Mine');
    expect(field().disabled).toBe(false);
    expect(file(editor)).toBe(DOC);
  });

  it('stops the agent on Cancel, and takes no answer that comes after', async () => {
    const agent = describer('Claude');
    const { editor, alt } = mount({ describer: agent.made });
    at(editor, 'A red');
    alt.start();
    await settled();
    button('Describe with Claude')!.click();
    button('Cancel')!.click();
    expect(agent.asked[0]?.signal.aborted).toBe(true);
    agent.settle().ok('Late.');
    await settled();
    expect(bubble()).toBeNull();
    expect(file(editor)).toBe(DOC);
  });

  it('grays the button with the reason where the agent can’t see pictures', async () => {
    const agent = describer('Codex', 'Codex can’t look at pictures here.');
    const { editor, alt } = mount({ describer: agent.made });
    at(editor, 'A red');
    alt.start();
    await settled();
    const describe = button(/Describe/)!;
    expect(describe.getAttribute('aria-disabled')).toBe('true');
    expect(describe.title).toBe('Codex can’t look at pictures here.');
    describe.click();
    expect(agent.asked).toHaveLength(0);
  });
});
