// @vitest-environment happy-dom
import { parse } from '@redlines/format';
import type { AgentInfo } from '@redlines/plugin-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachPicker, pickerEntries } from './picker.ts';

const doc = `Hello.

<!-- redlines
version: 1
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
  cy: {name: Cy Young}
  gone: {name: Gone Away, deleted: true}
  claude-ada: {name: Claude, agent: true, for: ada}
  claude-bo: {name: Claude, agent: true, for: bo}
  unknown: {name: Unknown}
-->
`;
const parsed = parse(doc);

const found = (id: string, name: string): AgentInfo => ({
  id,
  name,
  readLimit: 'folder',
  state: { found: true, signedIn: true },
});
const agents: AgentInfo[] = [
  found('claude', 'Claude'),
  { ...found('codex', 'Codex'), state: { found: false, help: 'Install it.' } },
];

const names = (query = '', list = agents) =>
  pickerEntries(parsed, 'ada', list, query).map(
    (entry) => entry.name + (entry.for ? ` for ${entry.for}` : ''),
  );

describe('pickerEntries', () => {
  it('lists agents first, then people by name, leaving out me, unknown and my own agents', () => {
    expect(names()).toEqual(['Claude', 'Bo Chen', 'Claude for Bo', 'Cy Young']);
  });

  it('lists someone else’s agent like a person, named Claude for Bo', () => {
    const entry = pickerEntries(parsed, 'ada', agents, '').find((e) => e.for);
    expect(entry).toMatchObject({ name: 'Claude', for: 'Bo', insert: '@claude-bo ' });
  });

  it('inserts an agent by its name and a person by their handle', () => {
    const [claude, bo] = pickerEntries(parsed, 'ada', agents, '');
    expect(claude?.insert).toBe('@Claude ');
    expect(bo?.insert).toBe('@bo ');
  });

  it('leaves out an agent not found on this Mac, and people who left', () => {
    expect(names('codex')).toEqual([]);
    expect(names('', [found('codex', 'Codex')])).toContain('Codex');
    expect(names('gone')).toEqual([]);
  });

  it('filters by name or handle, ignoring case', () => {
    expect(names('CHEN')).toEqual(['Bo Chen']);
    expect(names('cy')).toEqual(['Cy Young']);
    expect(names('claude')).toEqual(['Claude', 'Claude for Bo']);
    expect(names('zzz')).toEqual([]);
  });

  it('gives people the colors of the record of people met', () => {
    const met = [
      { handle: 'cy', color: 5 },
      { handle: 'bo', color: 7 },
    ];
    const entries = pickerEntries(parsed, 'ada', agents, '', met);
    const colorOf = (name: string) => entries.find((entry) => entry.name === name)?.color;
    expect(colorOf('Cy Young')).toBe(5);
    expect(colorOf('Bo Chen')).toBe(7);
  });

  it('gives each person their author color, and my agent its own', () => {
    const entries = pickerEntries(parsed, 'ada', agents, '');
    expect(entries.every((entry) => entry.color > 0)).toBe(true);
  });
});

interface Mounted {
  box: HTMLElement;
  field: HTMLTextAreaElement;
  detach: () => void;
  posted: ReturnType<typeof vi.fn>;
  closed: ReturnType<typeof vi.fn>;
}

const mounted: Mounted[] = [];

/** A field in a box that behaves like the comment box: ⌘↩ posts, Escape closes, both on the field. */
function mount(list: readonly AgentInfo[] = agents): Mounted {
  const box = document.createElement('div');
  const field = document.createElement('textarea');
  box.append(field);
  document.body.append(box);
  const posted = vi.fn();
  const closed = vi.fn();
  field.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) posted();
    else if (event.key === 'Escape') closed();
  });
  const detach = attachPicker(field, { getParsed: () => parsed, me: 'ada', agents: () => list });
  const result = { box, field, detach, posted, closed };
  mounted.push(result);
  return result;
}

afterEach(() => {
  for (const { detach } of mounted.splice(0)) detach();
  document.body.replaceChildren();
});

function type(field: HTMLTextAreaElement, text: string): void {
  field.value = text;
  field.setSelectionRange(text.length, text.length);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function press(
  field: HTMLTextAreaElement,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  field.dispatchEvent(event);
  return event;
}

const rows = (box: HTMLElement) =>
  [...box.querySelectorAll('.rl-picker [role=option]')].map((row) => row.textContent);
const isOpen = (box: HTMLElement) => !!box.querySelector('.rl-picker');

describe('attachPicker', () => {
  it('opens on @ and lists the entries', () => {
    const { box, field } = mount();
    type(field, 'Ask @');
    expect(rows(box)).toEqual(['Claude', 'Bo Chen', 'Claude for Bo', 'Cy Young']);
  });

  it('narrows as the name is typed, and closes when nothing matches', () => {
    const { box, field } = mount();
    type(field, 'Ask @bo');
    expect(rows(box)).toEqual(['Bo Chen', 'Claude for Bo']);
    type(field, 'Ask @bozz');
    expect(isOpen(box)).toBe(false);
  });

  it('does not open for an @ after a letter, as in an email address', () => {
    const { box, field } = mount();
    type(field, 'write to ada@');
    expect(isOpen(box)).toBe(false);
  });

  it('closes once the mention is followed by a space', () => {
    const { box, field } = mount();
    type(field, '@bo ');
    expect(isOpen(box)).toBe(false);
  });

  it('opens at the start of a line and after punctuation', () => {
    const { box, field } = mount();
    type(field, 'one\n@');
    expect(isOpen(box)).toBe(true);
    type(field, '(@');
    expect(isOpen(box)).toBe(true);
  });

  it('picks with Return, inserting an agent’s name and a space', () => {
    const { box, field } = mount();
    type(field, 'Ask @cl');
    const event = press(field, 'Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(field.value).toBe('Ask @Claude ');
    expect(field.selectionStart).toBe(field.value.length);
    expect(isOpen(box)).toBe(false);
  });

  it('moves with the arrow keys and picks with Tab, inserting a handle', () => {
    const { field } = mount();
    type(field, '@');
    press(field, 'ArrowDown');
    press(field, 'ArrowDown');
    press(field, 'ArrowUp');
    press(field, 'Tab');
    expect(field.value).toBe('@bo ');
  });

  it('wraps around at the ends', () => {
    const { field } = mount();
    type(field, '@');
    press(field, 'ArrowUp');
    press(field, 'Enter');
    expect(field.value).toBe('@cy ');
  });

  it('picks where the caret is, keeping the text after it and not doubling a space', () => {
    const { field } = mount();
    field.value = 'Hi @bo please';
    field.setSelectionRange(6, 6);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    press(field, 'Enter');
    expect(field.value).toBe('Hi @bo please');
    expect(field.selectionStart).toBe(7);
  });

  it('tells the box the text changed, so it can size itself and enable Post', () => {
    const { field } = mount();
    type(field, '@');
    const input = vi.fn();
    field.addEventListener('input', input);
    press(field, 'Enter');
    expect(input).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape, leaving the text, and the box does not see the key', () => {
    const { box, field, closed } = mount();
    type(field, 'Ask @b');
    const event = press(field, 'Escape');
    expect(isOpen(box)).toBe(false);
    expect(field.value).toBe('Ask @b');
    expect(closed).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves keys to the box once closed: Escape closes the box, ⌘↩ posts', () => {
    const { field, closed, posted } = mount();
    type(field, 'Ask @b');
    press(field, 'Escape');
    press(field, 'Escape');
    expect(closed).toHaveBeenCalledTimes(1);
    press(field, 'Enter', { metaKey: true });
    expect(posted).toHaveBeenCalledTimes(1);
  });

  it('lets ⌘↩ through while open, so the box posts', () => {
    const { field, posted } = mount();
    type(field, '@');
    const event = press(field, 'Enter', { metaKey: true });
    expect(posted).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    expect(field.value).toBe('@');
  });

  it('leaves Return and Tab alone when closed', () => {
    const { field } = mount();
    type(field, 'plain');
    expect(press(field, 'Enter').defaultPrevented).toBe(false);
    expect(press(field, 'Tab').defaultPrevented).toBe(false);
  });

  it('leaves every key to the input method while composing', () => {
    const { box, field, closed } = mount();
    type(field, '@');
    const enter = press(field, 'Enter', { isComposing: true });
    expect(enter.defaultPrevented).toBe(false);
    expect(field.value).toBe('@');
    const escape = press(field, 'Escape', { isComposing: true });
    expect(escape.defaultPrevented).toBe(false);
    expect(closed).not.toHaveBeenCalled();
    expect(isOpen(box)).toBe(true);
  });

  it('picks the row that is clicked', () => {
    const { box, field } = mount();
    type(field, '@c');
    const rowEls = box.querySelectorAll('.rl-picker [role=option]');
    rowEls[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(field.value).toBe('@claude-bo ');
  });

  it('draws each person’s dot in their color, and nothing else like an avatar', () => {
    const { box, field } = mount();
    type(field, '@bo');
    const row = box.querySelector('.rl-picker [role=option]')!;
    const dot = row.querySelector('.rl-dot');
    expect(dot).not.toBeNull();
    expect(row.className).toMatch(/rl-author-[1-8]/);
    expect(row.querySelector('img, svg, canvas')).toBeNull();
  });

  it('marks the chosen row, and says so to assistive tools', () => {
    const { box, field } = mount();
    type(field, '@');
    press(field, 'ArrowDown');
    const selected = box.querySelectorAll('.rl-picker [aria-selected=true]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toBe('Bo Chen');
    expect(field.getAttribute('aria-activedescendant')).toBe(selected[0]?.id);
  });

  it('asks for the agents each time it opens', () => {
    const list = vi.fn(() => agents);
    const { field } = mount();
    mounted.pop()!.detach();
    const detach = attachPicker(field, { getParsed: () => parsed, me: 'ada', agents: list });
    type(field, '@');
    type(field, '');
    type(field, '@');
    expect(list).toHaveBeenCalledTimes(2);
    detach();
  });

  it('closes when the field loses focus, and takes everything away when detached', () => {
    const { box, field, detach } = mount();
    type(field, '@');
    field.dispatchEvent(new Event('blur'));
    expect(isOpen(box)).toBe(false);
    type(field, '@');
    detach();
    expect(isOpen(box)).toBe(false);
    type(field, 'again @');
    expect(isOpen(box)).toBe(false);
    expect(field.hasAttribute('aria-activedescendant')).toBe(false);
  });
});
