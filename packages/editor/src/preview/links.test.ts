// @vitest-environment happy-dom
// ⌘-click on a link opens its address through the host, with a hint on hover (design §5.2).

import { forceParsing } from '@codemirror/language';
import { StateEffect } from '@codemirror/state';
import { showTooltip } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';
import corpus from './link-addresses.json' with { type: 'json' };
import { linkDestination, openableAddress, visibleFormat } from './links.ts';

const author = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

/** Says what platform the page is on, which names the key that opens a link. */
function platform(name: string): void {
  Object.defineProperty(navigator, 'platform', { value: name, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  platform('MacIntel');
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'platform');
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

const DOC = [
  'A [web link](https://example.org/a?b=1&amp;c=2) and an <https://auto.example.org/x> and',
  'https://bare.example.org/y and www.example.org and [a ref][r] and [mail](mailto:ada@example.org)',
  'and [bad](javascript:alert(1)) and [relative](plan.md#intro) and [angle](<https://a.example.org/b c>).',
  '',
  '[r]: https://ref.example.org/z "Title"',
  '',
].join('\n');

function load(doc = DOC, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc, author, ...options });
  forceParsing(editor.view, editor.view.state.doc.length, 10_000);
  // happy-dom fires `selectionchange` while CodeMirror writes a focused editor's selection, which
  // CodeMirror then reads during its own update: the press that reaches it is left unfocused.
  editor.view.focus = () => {};
  editor.view.contentDOM.focus = () => {};
  open.push(editor);
  return editor;
}

/** The drawn link whose text is `text`. */
function linkNamed(editor: Editor, text: string): HTMLElement {
  const found = [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-link')].find((el) =>
    (el.textContent ?? '').includes(text),
  );
  if (!found) throw new Error(`No link drawn with ${text}`);
  return found;
}

/** A mouse event on `target`, as the page sends it. */
function mouse(
  target: Element,
  type: string,
  init: MouseEventInit = {},
): MouseEvent & { stopped: boolean } {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  let stopped = false;
  const stop = event.stopPropagation.bind(event);
  event.stopPropagation = () => {
    stopped = true;
    stop();
  };
  target.dispatchEvent(event);
  return Object.assign(event, {
    get stopped() {
      return stopped;
    },
  });
}

/** A ⌘-click, which opens on release. */
function commandClick(target: Element, more: MouseEventInit = {}): void {
  mouse(target, 'mousedown', { metaKey: true, clientX: 5, clientY: 5, ...more });
  mouse(target, 'mouseup', { metaKey: true, clientX: 5, clientY: 5, ...more });
}

describe('the shared list of addresses (also read by links.rs)', () => {
  it('opens each of opens as it is, and nothing of refuses', () => {
    for (const address of corpus.opens) {
      expect(openableAddress(address), JSON.stringify(address)).toBe(address);
    }
    for (const address of corpus.refuses) {
      expect(openableAddress(address), JSON.stringify(address)).toBeNull();
    }
  });
});

describe('the addresses that open (design §5.2)', () => {
  it('are web and mail addresses, whatever the case of the scheme', () => {
    expect(openableAddress('https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
    expect(openableAddress('http://example.org')).toBe('http://example.org');
    expect(openableAddress('HTTPS://Example.org')).toBe('HTTPS://Example.org');
    expect(openableAddress('mailto:ada@example.org')).toBe('mailto:ada@example.org');
    expect(openableAddress('MAILTO:ada@example.org?subject=Hi')).toBe(
      'MAILTO:ada@example.org?subject=Hi',
    );
    expect(openableAddress('  https://example.org  ')).toBe('https://example.org');
  });

  it('are never script, data, file, other schemes, or links to other documents', () => {
    for (const address of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'vbscript:x',
      'data:text/html,<b>x</b>',
      'file:///etc/passwd',
      'tel:+15551234',
      'ftp://example.org',
      'x-apple.systempreferences:',
      '//example.org/x',
      'plan.md#intro',
      '../plan.md',
      '#intro',
      '/etc/passwd',
      'example.org',
      '',
      'https://',
      'https:',
      'mailto:',
      'https://exa mple.org',
      'https://example.org/\u0000',
      'https://example.org/\u0007',
    ]) {
      expect(openableAddress(address), JSON.stringify(address)).toBeNull();
    }
  });

  it('treats www. as the web over https, the scheme a copy writes for it too', () => {
    expect(openableAddress('www.example.org/x')).toBe('https://www.example.org/x');
    expect(openableAddress('WWW.example.org')).toBe('https://WWW.example.org');
    expect(openableAddress('www.')).toBeNull();
  });

  it('opens an email only as an explicit mailto: in a destination', () => {
    expect(openableAddress('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(openableAddress('logo@2x.png')).toBeNull();
    expect(openableAddress('ada@example.org')).toBeNull();
  });

  it('encodes a space after the host, which a <...> destination may hold', () => {
    expect(openableAddress('https://example.org/a b')).toBe('https://example.org/a%20b');
    expect(openableAddress('www.example.org/a b?c=d e')).toBe(
      'https://www.example.org/a%20b?c=d%20e',
    );
    // A space in the host is still no address, and no other white space is mended.
    expect(openableAddress('https://exa mple.org/x')).toBeNull();
    expect(openableAddress('https://example.org/a\tb')).toBeNull();
  });
});

describe('the address of a link (design §5.2)', () => {
  const at = (editor: Editor, text: string) =>
    linkDestination(editor.view.state, editor.view.state.doc.toString().indexOf(text) + 1);

  it('is the one in a link, a reference link, an autolink and a bare address', () => {
    const editor = load();
    // Entities are decoded and escapes taken out, as the Markdown reader has it.
    expect(at(editor, 'web link')).toBe('https://example.org/a?b=1&c=2');
    expect(at(editor, 'a ref')).toBe('https://ref.example.org/z');
    expect(at(editor, 'auto.example.org')).toBe('https://auto.example.org/x');
    expect(at(editor, 'bare.example.org')).toBe('https://bare.example.org/y');
    expect(at(editor, 'www.example.org and')).toBe('www.example.org');
    expect(at(editor, 'mail]')).toBe('mailto:ada@example.org');
    expect(at(editor, 'angle')).toBe('https://a.example.org/b c');
    expect(at(editor, 'relative')).toBe('plan.md#intro');
  });

  it('is the link’s own destination when its text begins with an address, as the reader has it', () => {
    const editor = load(
      [
        '[ada@example.org](mailto:ada@example.org) and [www.example.org](https://other.example/path)',
        'and [https://example.org/a…](https://example.org/a-very-long-path) and [https://x.example][r]',
        '',
        '[r]: https://def.example/r',
        '',
      ].join('\n'),
    );
    expect(at(editor, 'ada@example.org](')).toBe('mailto:ada@example.org');
    expect(at(editor, 'www.example.org](')).toBe('https://other.example/path');
    expect(at(editor, 'https://example.org/a…')).toBe('https://example.org/a-very-long-path');
    expect(at(editor, 'https://x.example]')).toBe('https://def.example/r');
  });

  it('is nothing outside a link, in an image, or for a reference nothing defines', () => {
    const editor = load(
      'Plain text, ![an image](https://example.org/i.png) and [undefined][nope] and `code https://x.org`.\n',
    );
    expect(at(editor, 'Plain')).toBeNull();
    expect(at(editor, 'an image')).toBeNull();
    expect(at(editor, 'undefined')).toBeNull();
    expect(at(editor, 'code https')).toBeNull();
  });

  it('is the link’s own for an image inside a link, and still nothing for an image alone', () => {
    const editor = load(
      '[![build](badge.svg)](https://ci.example) ![x](https://i.example/p.png) [![r](r.svg)][r]\n\n[r]: https://ref.example/z\n',
    );
    expect(at(editor, '![build')).toBe('https://ci.example');
    expect(at(editor, 'build]')).toBe('https://ci.example');
    expect(at(editor, 'badge.svg')).toBe('https://ci.example');
    expect(at(editor, '![r]')).toBe('https://ref.example/z');
    expect(at(editor, '![x]')).toBeNull();
    expect(at(editor, 'https://i.example')).toBeNull();
  });

  it('follows the reference whatever the case and the spacing of its label', () => {
    const editor = load('A [text][The  Label] here.\n\n[the label]: https://ref.example.org\n');
    expect(at(editor, 'text')).toBe('https://ref.example.org');
    const collapsed = load('A [Label][] here.\n\n[label]: https://c.example.org\n');
    expect(at(collapsed, 'Label')).toBe('https://c.example.org');
  });
});

describe('⌘-click on a link (design §5.2)', () => {
  it('opens its address through the host, on release, and takes the click whole', () => {
    const open = vi.fn();
    const editor = load(DOC, { openLink: open });
    const link = linkNamed(editor, 'web link');
    // The caret is elsewhere, in the text before the link.
    editor.view.dispatch({ selection: { anchor: 1 } });
    const down = mouse(link, 'mousedown', { metaKey: true, clientX: 5, clientY: 5 });
    // Taken before the editor sees it: no caret, no second cursor, no selection.
    expect(down.defaultPrevented).toBe(true);
    expect(down.stopped).toBe(true);
    expect(open).not.toHaveBeenCalled();
    const up = mouse(link, 'mouseup', { metaKey: true, clientX: 5, clientY: 5 });
    expect(up.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.org/a?b=1&c=2');
    expect(editor.view.state.selection.ranges).toHaveLength(1);
    expect(editor.view.state.selection.main.head).toBe(1);
    expect(editor.view.state.selection.main.empty).toBe(true);
  });

  it('opens an autolink, a bare address, a www. address, a reference and a mail link', () => {
    const open = vi.fn<(address: string) => void>();
    const editor = load(DOC, { openLink: open });
    for (const text of [
      'auto.example.org',
      'bare.example.org',
      'www.example.org',
      'a ref',
      'mail',
    ]) {
      commandClick(linkNamed(editor, text));
    }
    expect(open.mock.calls.map(([url]) => url)).toEqual([
      'https://auto.example.org/x',
      'https://bare.example.org/y',
      'https://www.example.org',
      'https://ref.example.org/z',
      'mailto:ada@example.org',
    ]);
  });

  it('opens an image link, a bare email and a link with a space in its <...> destination', () => {
    const open = vi.fn<(address: string) => void>();
    const editor = load(
      [
        '[![build](badge.svg)](https://ci.example) and ada@example.org and <grace@example.org>',
        'and [spaced](<https://example.org/a b>) and [file](logo@2x.png) and <a@b.co> and',
        '[mail-me](mailto:a@b.co).',
        '',
      ].join('\n'),
      { openLink: open },
    );
    const badge = editor.view.dom.querySelector<HTMLElement>('.rl-image')!;
    expect(badge.closest('.rl-link')).not.toBeNull();
    commandClick(badge);
    commandClick(linkNamed(editor, 'ada@example.org'));
    commandClick(linkNamed(editor, 'grace@example.org'));
    commandClick(linkNamed(editor, 'spaced'));
    // A relative file is left to the editor: nothing opens.
    commandClick(linkNamed(editor, 'file'));
    commandClick(linkNamed(editor, 'a@b.co'));
    commandClick(linkNamed(editor, 'mail-me'));
    expect(open.mock.calls.map(([url]) => url)).toEqual([
      'https://ci.example',
      'mailto:ada@example.org',
      'mailto:grace@example.org',
      'https://example.org/a%20b',
      'mailto:a@b.co',
      'mailto:a@b.co',
    ]);
  });

  it('opens the destination of a link whose text is an address, and not the text', () => {
    const open = vi.fn<(address: string) => void>();
    const editor = load(
      '[ada@example.org](mailto:ada@example.org) and [www.example.org](https://other.example/path)\n',
      { openLink: open },
    );
    commandClick(linkNamed(editor, 'ada@example.org'));
    commandClick(linkNamed(editor, 'www.example.org'));
    expect(open.mock.calls.map(([url]) => url)).toEqual([
      'mailto:ada@example.org',
      'https://other.example/path',
    ]);
  });

  it('is a plain click without ⌘: the editor handles the press as it always does, and nothing opens', () => {
    const open = vi.fn();
    const editor = load(DOC, { openLink: open });
    const link = linkNamed(editor, 'web link');
    const down = mouse(link, 'mousedown', { clientX: 5, clientY: 5 });
    const up = mouse(link, 'mouseup', { clientX: 5, clientY: 5 });
    // The press reaches the editor, which handles it as it always does.
    expect(down.stopped).toBe(false);
    expect(up.stopped).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('leaves alone a press with another key, a right click, and one that moved', () => {
    const open = vi.fn();
    const editor = load(DOC, { openLink: open });
    const link = linkNamed(editor, 'web link');
    for (const init of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { button: 2 }]) {
      const down = mouse(link, 'mousedown', { metaKey: true, ...init });
      mouse(link, 'mouseup', { metaKey: true, ...init });
      expect(down.stopped, JSON.stringify(init)).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
    // A press that moves away before it is let go is no click: nothing opens, and the press was
    // taken whole, so no selection starts either.
    const down = mouse(link, 'mousedown', { metaKey: true, clientX: 5, clientY: 5 });
    mouse(link, 'mouseup', { metaKey: true, clientX: 60, clientY: 5 });
    expect(down.stopped).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens once for a double click, which the press takes whole as well', () => {
    const open = vi.fn();
    const editor = load(DOC, { openLink: open });
    const link = linkNamed(editor, 'web link');
    commandClick(link);
    expect(open).toHaveBeenCalledTimes(1);
    // The second press of a double click, and the third of a triple: nothing selects a word.
    for (const detail of [2, 3]) {
      const down = mouse(link, 'mousedown', { metaKey: true, clientX: 5, clientY: 5, detail });
      mouse(link, 'mouseup', { metaKey: true, clientX: 5, clientY: 5, detail });
      expect(down.stopped, `detail ${detail}`).toBe(true);
    }
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an address that is not the web’s or mail’s, and leaves the click to the editor', () => {
    const open = vi.fn();
    const editor = load(DOC, { openLink: open });
    for (const text of ['bad', 'relative']) {
      const down = mouse(linkNamed(editor, text), 'mousedown', { metaKey: true });
      mouse(linkNamed(editor, text), 'mouseup', { metaKey: true });
      expect(down.stopped, text).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('is left to the editor outside a link, and when the host has no way to open one', () => {
    const open = vi.fn();
    const editor = load(DOC, { openLink: open });
    const text = editor.view.contentDOM.querySelector<HTMLElement>('.cm-line');
    if (!text) throw new Error('no line');
    const down = mouse(text, 'mousedown', { metaKey: true });
    expect(down.stopped).toBe(false);
    const bare = load(DOC);
    const down2 = mouse(linkNamed(bare, 'web link'), 'mousedown', { metaKey: true });
    expect(down2.stopped).toBe(false);
  });

  it('never throws at the host’s failure, which is the host’s to say', () => {
    const editor = load(DOC, {
      openLink: () => {
        throw new Error('no browser');
      },
    });
    expect(() => commandClick(linkNamed(editor, 'web link'))).not.toThrow();
  });

  it('is not a ⌘-click once the text changed under the press', () => {
    const open = vi.fn();
    const editor = load(DOC, { openLink: open });
    const link = linkNamed(editor, 'web link');
    mouse(link, 'mousedown', { metaKey: true, clientX: 5, clientY: 5 });
    editor.view.dispatch({ changes: { from: 0, insert: 'x' } });
    mouse(link, 'mouseup', { metaKey: true, clientX: 5, clientY: 5 });
    expect(open).not.toHaveBeenCalled();
  });
});

describe('the hint on a link (design §5.2)', () => {
  const hint = () => document.querySelector<HTMLElement>('.rl-link-hint');

  it('comes after the title bar’s pause, with the address, and goes with the pointer', () => {
    const editor = load(DOC, { openLink: vi.fn() });
    const link = linkNamed(editor, 'web link');
    mouse(link, 'mousemove', { clientX: 5, clientY: 5 });
    vi.advanceTimersByTime(399);
    expect(hint()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(hint()?.textContent).toContain('⌘-click to open');
    expect(hint()?.textContent).toContain('https://example.org/a?b=1&c=2');
    expect(hint()?.getAttribute('aria-hidden')).toBe('true');
    mouse(link, 'mouseleave');
    expect(hint()).toBeNull();
  });

  it('goes on from one half of a link that wraps to the other, with no new pause (#380)', () => {
    // A link over two lines is two drawn elements: moving between them is moving within the link.
    const editor = load('A [first half\nsecond half](https://example.org/w) here.\n', {
      openLink: vi.fn(),
    });
    const halves = [...editor.view.dom.querySelectorAll<HTMLElement>('.rl-link')];
    expect(halves.length).toBe(2);
    mouse(halves[0]!, 'mousemove', { clientX: 5, clientY: 5 });
    vi.advanceTimersByTime(300);
    // The pointer crosses to the other half before the pause is over: the pause is not started again.
    mouse(halves[1]!, 'mousemove', { clientX: 6, clientY: 25 });
    vi.advanceTimersByTime(100);
    expect(hint()?.textContent).toContain('https://example.org/w');
    // And with the hint shown, crossing keeps it.
    mouse(halves[0]!, 'mousemove', { clientX: 7, clientY: 5 });
    expect(hint()).not.toBeNull();
    mouse(halves[0]!, 'mouseleave');
    expect(hint()).toBeNull();
  });

  it('does not show while another tooltip does, as a change’s card over a link (#380)', () => {
    const editor = load(DOC, { openLink: vi.fn() });
    const card = showTooltip.of({
      pos: 0,
      above: true,
      create: () => ({ dom: document.createElement('div') }),
    });
    editor.view.dispatch({ effects: StateEffect.appendConfig.of(card) });
    mouse(linkNamed(editor, 'web link'), 'mousemove', { clientX: 5, clientY: 5 });
    vi.advanceTimersByTime(500);
    expect(hint()).toBeNull();
  });

  it('has a rule for the hint (the notifications’ grays) over CodeMirror’s own tooltip look, and is not clipped at the top of the page', () => {
    const editor = load(DOC, { openLink: vi.fn() });
    mouse(linkNamed(editor, 'web link'), 'mousemove', { clientX: 5, clientY: 5 });
    vi.advanceTimersByTime(400);
    // The hint is the tooltip's own element, so its rule needs the tooltip's class to win.
    expect(hint()?.classList.contains('cm-tooltip')).toBe(true);
    const rules = [...document.querySelectorAll('style')]
      .map((style) => style.textContent)
      .join('');
    const rule = /\.cm-tooltip\.rl-link-hint\s*\{([^}]*)\}/.exec(rules)?.[1] ?? '';
    expect(rule).toMatch(/background-color:\s*var\(--rl-card\)/);
    expect(rule).toMatch(/color:\s*var\(--rl-ink\)/);
    // A link on the first lines of the page still shows its hint (the title bar's room above).
    const tooltips = editor.view.state.facet(showTooltip).filter((tip) => tip !== null);
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0]?.clip).toBe(false);
  });

  it('waits for the pause again on another link, and is not for one that does not open', () => {
    const editor = load(DOC, { openLink: vi.fn() });
    mouse(linkNamed(editor, 'web link'), 'mousemove');
    vi.advanceTimersByTime(400);
    expect(hint()?.textContent).toContain('example.org/a');
    mouse(linkNamed(editor, 'bare.example.org'), 'mousemove');
    expect(hint()).toBeNull();
    vi.advanceTimersByTime(400);
    expect(hint()?.textContent).toContain('bare.example.org/y');
    mouse(linkNamed(editor, 'bad'), 'mousemove');
    vi.advanceTimersByTime(1000);
    expect(hint()).toBeNull();
  });

  it('goes when the page scrolls, which moves the link from under the pointer', () => {
    const editor = load(DOC, { openLink: vi.fn() });
    mouse(linkNamed(editor, 'web link'), 'mousemove');
    vi.advanceTimersByTime(400);
    expect(hint()).not.toBeNull();
    // A scroll event doesn't bubble: the page hears it by its capture, whatever scrolls.
    editor.view.scrollDOM.dispatchEvent(new Event('scroll'));
    expect(hint()).toBeNull();
    mouse(linkNamed(editor, 'web link'), 'mousemove');
    vi.advanceTimersByTime(400);
    expect(hint()).not.toBeNull();
    document.body.dispatchEvent(new Event('scroll'));
    expect(hint()).toBeNull();
  });

  it('does not come for a link that the text moved from under the pointer while it waited', () => {
    const editor = load(DOC, { openLink: vi.fn() });
    mouse(linkNamed(editor, 'web link'), 'mousemove');
    vi.advanceTimersByTime(100);
    editor.view.dispatch({ changes: { from: 0, to: 80 } });
    vi.advanceTimersByTime(1000);
    expect(hint()).toBeNull();
  });

  it('goes when the text changes or a press comes, and stays away without a host to open', () => {
    const editor = load(DOC, { openLink: vi.fn() });
    mouse(linkNamed(editor, 'web link'), 'mousemove');
    vi.advanceTimersByTime(400);
    expect(hint()).not.toBeNull();
    editor.view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(hint()).toBeNull();
    mouse(linkNamed(editor, 'web link'), 'mousemove');
    vi.advanceTimersByTime(400);
    expect(hint()).not.toBeNull();
    mouse(linkNamed(editor, 'web link'), 'mousedown');
    expect(hint()).toBeNull();
    const bare = load(DOC);
    mouse(linkNamed(bare, 'web link'), 'mousemove');
    vi.advanceTimersByTime(1000);
    expect(hint()).toBeNull();
  });
});

describe('the pointer over a link while ⌘ is held (design §5.2)', () => {
  const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit = { key: 'Meta' }) =>
    window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }));
  /** Whether the content says that a link under the pointer opens: its theme makes that a pointer. */
  const ready = (editor: Editor) => editor.view.contentDOM.classList.contains('rl-link-ready');

  it('is a pointer, and the cursor of text again when the key is let go or the pointer leaves', () => {
    const editor = load(DOC, { openLink: vi.fn() });
    const link = linkNamed(editor, 'web link');
    mouse(link, 'mousemove', { clientX: 5, clientY: 5 });
    expect(ready(editor)).toBe(false);
    mouse(link, 'mousemove', { metaKey: true, clientX: 6, clientY: 5 });
    expect(ready(editor)).toBe(true);
    key('keyup');
    expect(ready(editor)).toBe(false);
    // ⌘ pressed with the pointer at rest on the link.
    key('keydown');
    expect(ready(editor)).toBe(true);
    mouse(link, 'mouseleave');
    expect(ready(editor)).toBe(false);
  });

  it('is a pointer only over a link that opens', () => {
    const editor = load(DOC, { openLink: vi.fn() });
    mouse(linkNamed(editor, 'bad'), 'mousemove', { metaKey: true });
    expect(ready(editor)).toBe(false);
    mouse(linkNamed(editor, 'web link'), 'mousemove', { metaKey: true });
    expect(ready(editor)).toBe(true);
    mouse(linkNamed(editor, 'bad'), 'mousemove', { metaKey: true });
    expect(ready(editor)).toBe(false);
  });

  it('stays a pointer when the hint comes, and when the editor writes its attributes again', () => {
    const editor = load(DOC, { openLink: vi.fn() });
    const link = linkNamed(editor, 'web link');
    key('keydown');
    mouse(link, 'mousemove', { metaKey: true, clientX: 5, clientY: 5 });
    expect(ready(editor)).toBe(true);
    // The hint is a transaction, and CodeMirror sets the attributes of its content again at each.
    vi.advanceTimersByTime(400);
    expect(document.querySelector('.rl-link-hint')).not.toBeNull();
    expect(ready(editor)).toBe(true);
    editor.view.dispatch({ selection: { anchor: 2 } });
    expect(ready(editor)).toBe(true);
    // The text changing takes the link from under the pointer.
    editor.view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(ready(editor)).toBe(false);
  });

  it('has the theme make it a pointer on the link, and nowhere else', () => {
    load(DOC, { openLink: vi.fn() });
    const rules = [...document.querySelectorAll('style')]
      .map((style) => style.textContent)
      .join('');
    expect(rules).toMatch(/\.cm-content\.rl-link-ready \.rl-link\s*\{[^}]*cursor:\s*pointer/);
  });
});

describe('on a page that is not a Mac’s (design §5.2)', () => {
  it('is Ctrl-click that opens a link, and the hint says so', () => {
    platform('Win32');
    const open = vi.fn();
    const editor = load(DOC, { openLink: open });
    const link = linkNamed(editor, 'web link');
    // ⌘ is another key there.
    const meta = mouse(link, 'mousedown', { metaKey: true, clientX: 5, clientY: 5 });
    mouse(link, 'mouseup', { metaKey: true, clientX: 5, clientY: 5 });
    expect(meta.stopped).toBe(false);
    expect(open).not.toHaveBeenCalled();
    commandClick(link, { metaKey: false, ctrlKey: true });
    expect(open).toHaveBeenCalledWith('https://example.org/a?b=1&c=2');
    mouse(link, 'mousemove', { clientX: 5, clientY: 5 });
    vi.advanceTimersByTime(400);
    expect(document.querySelector('.rl-link-hint')?.textContent).toContain('Ctrl-click to open');
  });
});

describe('the hint shows format characters (#380)', () => {
  it('writes them as code points and leaves the rest as it is', () => {
    expect(visibleFormat('https://example.org/a\u202Eb\u200Bc')).toBe(
      'https://example.org/a<U+202E>b<U+200B>c',
    );
    expect(visibleFormat('https://example.org/é?x=1')).toBe('https://example.org/é?x=1');
  });
});

describe('a reference link finds its definition (#380)', () => {
  const at = (doc: string, text: string, n = 1) => {
    const editor = load(doc);
    const state = editor.view.state;
    return linkDestination(state, doc.indexOf(text) + n);
  };
  it('at the end of a long document, as soon as it is loaded', () => {
    const doc = `${'Filler paragraph.\n\n'.repeat(4000)}See [the docs][docs].\n\n[docs]: https://example.org/docs\n[A]: <https://example.org/a>\n`;
    expect(at(doc, 'the docs')).toBe('https://example.org/docs');
  });
  it('the first definition of a label counts', () => {
    const doc = 'See [x][k].\n\n[k]: https://one.org\n[K]: https://two.org\n';
    expect(at(doc, 'x]')).toBe('https://one.org');
  });
});
