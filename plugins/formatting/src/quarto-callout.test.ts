// @vitest-environment happy-dom
// The menu in a Quarto callout's title (docs/research/quarto.md, Q7): the five types of a callout
// and its title, in a `.qmd`. Choosing is a block format change of the div, tracked or plain.

import { forceParsing } from '@codemirror/language';
import { createEditor, type Editor } from '@redlines/editor';
import { afterEach, describe, expect, it } from 'vitest';
import { createFormatting } from './index.ts';

interface Mounted {
  editor: Editor;
  notices: string[];
  remove: () => void;
}

const mounted: Mounted[] = [];
const author = { handle: 'ada', name: 'Ada Lovelace' };

function mount(doc: string, options: { tracking?: boolean } = {}): Mounted {
  const parent = document.createElement('div');
  document.body.append(parent);
  const notices: string[] = [];
  const editor = createEditor(parent, {
    doc,
    author,
    tracking: options.tracking ?? false,
    dialect: 'pandoc',
  });
  const result = {
    editor,
    notices,
    remove: createFormatting(editor, { author, notice: (message) => notices.push(message) }),
  };
  mounted.push(result);
  return result;
}

afterEach(() => {
  for (const { editor, remove } of mounted.splice(0)) {
    remove();
    editor.destroy();
  }
  document.body.replaceChildren();
});

const QMD = [
  '---',
  'title: "Triage study"',
  '---',
  '',
  '## Methods {#sec-methods}',
  '',
  '::: {.callout-note}',
  'Every ward reports on the same form (@fig-flow).',
  ':::',
  '',
  'See [@smith2020].',
  '',
].join('\n');

function openMenu(editor: Editor): HTMLElement {
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  const button = editor.view.dom.querySelector<HTMLElement>('button.rl-callout-menu');
  if (!button) throw new Error('no menu button: no callout drawn');
  button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  const popover = editor.view.dom.querySelector<HTMLElement>('.rl-callout-popover');
  if (!popover) throw new Error('no menu opened');
  return popover;
}

const click = (menu: HTMLElement, selector: string) =>
  menu.querySelector<HTMLElement>(selector)?.click();

describe('the menu in a Quarto callout’s title', () => {
  it('offers Quarto’s five types and the title, the callout’s own type checked', () => {
    const { editor } = mount(QMD);
    const menu = openMenu(editor);
    expect(menu.getAttribute('aria-label')).toBe('Callout type and title');
    expect(
      [...menu.querySelectorAll<HTMLElement>('.rl-callout-item[data-type]')].map((item) => [
        item.dataset['type'],
        item.getAttribute('aria-checked'),
      ]),
    ).toEqual([
      ['note', 'true'],
      ['tip', 'false'],
      ['important', 'false'],
      ['warning', 'false'],
      ['caution', 'false'],
    ]);
    expect([...menu.querySelectorAll('[data-action]')].map((item) => item.textContent)).toEqual([
      'Set Title…',
    ]);
  });

  it('changes the type as a tracked format change, which rejecting writes back', () => {
    const { editor } = mount(QMD, { tracking: true });
    click(openMenu(editor), '[data-type="warning"]');
    const text = editor.view.state.doc.toString();
    expect(text).toContain('::: {.callout-warning}');
    expect(text).toMatch(
      /<!--fmt \w+ was=fence=\{\.callout-note\}-->\n\n::: \{\.callout-warning\}/,
    );
    expect(text).not.toMatch(/:::[^\n]*<!--/);
  });

  it('changes the type in place with Track Changes off', () => {
    const { editor } = mount(QMD);
    click(openMenu(editor), '[data-type="tip"]');
    expect(editor.view.state.doc.toString()).toBe(QMD.replace('.callout-note', '.callout-tip'));
  });

  it('sets a title typed in the menu, and clears it', () => {
    const { editor } = mount(QMD);
    const menu = openMenu(editor);
    click(menu, '[data-action="title"]');
    const field = menu.querySelector<HTMLInputElement>('input.rl-callout-title-field');
    expect(field).not.toBeNull();
    field!.value = 'Same form everywhere';
    field!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(editor.view.state.doc.toString()).toContain(
      '::: {.callout-note title="Same form everywhere"}',
    );
    // The title shows in the callout's head, and the menu now offers to change or clear it.
    const again = openMenu(editor);
    expect([...again.querySelectorAll('[data-action]')].map((item) => item.textContent)).toEqual([
      'Change Title…',
      'Clear Title',
    ]);
    click(again, '[data-action="clear"]');
    expect(editor.view.state.doc.toString()).toBe(QMD);
  });

  it('writes a title as a tracked format change too', () => {
    const { editor } = mount(QMD, { tracking: true });
    const menu = openMenu(editor);
    click(menu, '[data-action="title"]');
    const field = menu.querySelector<HTMLInputElement>('input.rl-callout-title-field')!;
    field.value = 'Scope';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const text = editor.view.state.doc.toString();
    expect(text).toMatch(/was=fence=\{\.callout-note\}-->\n\n::: \{\.callout-note title="Scope"\}/);
  });

  it('changes a callout that stands under a line of text as a substitution, not a refusal', () => {
    const doc = 'Intro line.\n::: {.callout-note}\nUse the form.\n:::\n\nAfter.\n';
    const { editor, notices } = mount(doc, { tracking: true });
    const menu = openMenu(editor);
    expect(menu.querySelector('[data-type="tip"]')?.getAttribute('aria-disabled')).toBeNull();
    click(menu, '[data-type="tip"]');
    const text = editor.view.state.doc.toString();
    expect(notices).toEqual([]);
    expect(text).toContain('.callout-tip');
    expect(text).toContain('<!--sub');
  });

  it('disables an item with its reason where nothing can be written', () => {
    // Another person's pending change in the callout's own fence line is in the way of both forms.
    const doc = [
      'Intro.',
      '',
      '::: {.callout-note}',
      'Use the <!--ins k3x9-->new <!--/k3x9-->form.',
      ':::',
      '',
      '<!-- redlines',
      'version: 1',
      'people:',
      '  bob: {name: Bob}',
      'marks:',
      '  k3x9: {by: bob, at: 2026-10-13T22:40Z}',
      '-->',
      '',
    ].join('\n');
    const { editor, notices } = mount(doc, { tracking: true });
    const menu = openMenu(editor);
    const items = [...menu.querySelectorAll<HTMLElement>('[data-type]')];
    for (const item of items.filter((each) => each.getAttribute('aria-disabled') === 'true')) {
      expect(item.title).not.toBe('');
      item.click();
    }
    expect(notices).toEqual([]);
  });
});
