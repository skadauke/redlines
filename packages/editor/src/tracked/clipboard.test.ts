// @vitest-environment happy-dom
import { newestView, parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { markdownToHtml } from '../clipboard/copy-html.ts';
import { htmlToMarkdown } from '../clipboard/paste-html.ts';
import { createEditor, type Editor, type EditorOptions } from '../index.ts';
import { plainText } from './clipboard.ts';

const ada = { handle: 'ada', name: 'Ada Lovelace' };
const open: Editor[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** Bo's insertion, Claude's substitution and deletion, and Bo's comment, with their ledger. */
const doc = [
  'The changes<!--ins k3x9--> and comments<!--/k3x9--> live in the file, so it opens ' +
    '<!--sub p7qd in every editor-->anywhere<!--/p7qd--> and merges.<!--del w2rf  Nothing to install.-->',
  '',
  'Each <!--cmt c8d2-->agent suggests<!--/c8d2--> in its own name.',
  '',
  '<!-- redlines',
  'version: 1',
  'people:',
  '  bo: {name: Bo Chen}',
  '  claude-ada: {name: Claude, agent: true, for: ada}',
  'marks:',
  '  k3x9: {by: bo, at: 2026-10-31T09:30Z}',
  '  p7qd: {by: claude-ada, at: 2026-10-31T09:31Z}',
  '  w2rf: {by: claude-ada, at: 2026-10-31T09:35Z}',
  'comments:',
  '  c8d2:',
  '    by: bo',
  '    at: 2026-10-31T09:41Z',
  '    text: |-',
  '      Can agents answer too?',
  '-->',
  '',
].join('\n');

function load(text: string, options: Partial<EditorOptions> = {}): Editor {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, { doc: text, author: ada, ...options });
  open.push(editor);
  return editor;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Copies or cuts the text from `from` to `to`, as ⌘C or ⌘X does, and returns the clipboard. */
async function copyData(
  editor: Editor,
  from: number,
  to: number,
  type = 'copy',
): Promise<DataTransfer> {
  editor.view.dispatch({ selection: { anchor: from, head: to } });
  // CodeMirror copies its own selection, once the page's is in the editor. The editor isn't
  // focused: happy-dom would report the page's selection while CodeMirror is still writing it.
  document.getSelection()?.selectAllChildren(editor.view.contentDOM);
  await tick();
  const clipboardData = new DataTransfer();
  const event = new ClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true });
  editor.view.contentDOM.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return clipboardData;
}

/** The plain text of a copy or cut. */
async function copy(editor: Editor, from: number, to: number, type = 'copy'): Promise<string> {
  return (await copyData(editor, from, to, type)).getData('text/plain');
}

/** Pastes `text` (and `html`, when the clipboard has some) at `at`, as ⌘V does. */
function paste(editor: Editor, at: number, text: string, html?: string): void {
  editor.view.dispatch({ selection: { anchor: at } });
  const clipboardData = new DataTransfer();
  clipboardData.setData('text/plain', text);
  if (html !== undefined) clipboardData.setData('text/html', html);
  editor.view.contentDOM.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
  );
}

const between = (text: string, start: string, end: string) => [
  text.indexOf(start),
  text.indexOf(end) + end.length,
];

describe('copy and cut', () => {
  it('copy the newest text of the selection in Redlines', async () => {
    const editor = load(doc);
    expect(editor.getUiState().view).toBe('redlines');
    const [from, to] = between(doc, 'The changes', 'merges.<!--del w2rf  Nothing to install.-->');
    expect(await copy(editor, from!, to!)).toBe(
      'The changes and comments live in the file, so it opens anywhere and merges.',
    );
    const [start, end] = between(doc, 'Each', 'own name.');
    expect(await copy(editor, start!, end!)).toBe('Each agent suggests in its own name.');
  });

  it('copy the newest text in Clean, without the deleted text it hides', async () => {
    const editor = load(doc, { view: 'clean' });
    const [from, to] = between(doc, 'anywhere', 'Each');
    expect(await copy(editor, from!, to!)).toBe('anywhere and merges.\n\nEach');
  });

  it('copy the source as written in Raw', async () => {
    const editor = load(doc, { view: 'raw' });
    const [from, to] = between(doc, 'The changes', 'comments<!--/k3x9-->');
    expect(await copy(editor, from!, to!)).toBe(
      'The changes<!--ins k3x9--> and comments<!--/k3x9-->',
    );
  });

  it('cut the newest text, and the cut is tracked', async () => {
    const editor = load(doc, { tracking: true });
    const [from, to] = between(doc, 'anywhere', 'merges.');
    expect(await copy(editor, from!, to!, 'cut')).toBe('anywhere and merges.');
    const deletions = editor.getParsed().marks.filter((mark) => mark.entry.by === 'ada');
    expect(deletions.map((mark) => mark.kind)).not.toEqual([]);
    expect(editor.getDoc()).toContain('in every editor');
  });
});

describe('paste', () => {
  const markup = 'The changes<!--ins k3x9--> and comments<!--/k3x9-->';

  it('pastes markup as its newest text with Track Changes on, as the paster’s insertion', () => {
    const notices: string[] = [];
    const editor = load(doc, { tracking: true, onNotice: (m) => notices.push(m) });
    paste(editor, doc.indexOf('own name'), markup + ' ');
    expect(notices).toEqual([]);
    expect(newestView(editor.getDoc()).text).toContain('in its The changes and comments own name.');
    const pasted = editor.getParsed().marks.filter((mark) => mark.entry.by === 'ada');
    expect(
      pasted.map((mark) => [
        mark.kind,
        editor.getParsed().text.slice(mark.segments[0]!.content.from, mark.segments[0]!.content.to),
      ]),
    ).toEqual([['ins', 'The changes and comments ']]);
    expect(editor.getParsed().marks.find((mark) => mark.id === 'k3x9')?.segments).toHaveLength(1);
  });

  it('pastes markup as its newest text with Track Changes off, which joins no change', () => {
    const editor = load(doc);
    paste(editor, doc.indexOf('Each'), markup + ' ');
    expect(editor.getDoc()).toContain('\n\nThe changes and comments Each');
    expect(editor.getParsed().marks.find((mark) => mark.id === 'k3x9')?.segments).toHaveLength(1);
    // Rejecting the change that was copied leaves the pasted words.
    editor.reject('k3x9');
    expect(editor.getDoc()).toContain('\n\nThe changes and comments Each');
  });

  it('pastes a comment’s anchor as its text, which joins no thread', () => {
    const editor = load(doc);
    paste(editor, doc.indexOf('Each'), '<!--cmt c8d2-->agent suggests<!--/c8d2--> ');
    expect(editor.getDoc()).toContain('\n\nagent suggests Each');
    expect(editor.getParsed().marks.find((mark) => mark.id === 'c8d2')?.segments).toHaveLength(1);
    expect(parse(editor.getDoc()).warnings).toEqual([]);
  });

  it('pastes as written in Raw, where markup is edited by hand', () => {
    const editor = load(doc, { view: 'raw' });
    paste(editor, doc.indexOf('Each'), '<!--hl h6bz-->Each<!--/h6bz--> ');
    expect(editor.getDoc()).toContain('<!--hl h6bz-->Each<!--/h6bz--> Each');
  });
});

describe('plainText', () => {
  it('leaves text without markup as it is', () => {
    expect(plainText('Plain text, with <!-- a note --> and `<!--ins k3x9-->` in code.')).toBe(
      'Plain text, with <!-- a note --> and `<!--ins k3x9-->` in code.',
    );
  });

  it('takes the newest text of marks, and drops a ledger', () => {
    expect(plainText(doc)).toBe(
      'The changes and comments live in the file, so it opens anywhere and merges.\n\n' +
        'Each agent suggests in its own name.\n',
    );
  });

  it('drops markers whose other half was left behind', () => {
    expect(plainText('so it opens <!--sub p7qd in every editor-->anywhere')).toBe(
      'so it opens anywhere',
    );
    expect(plainText('and comments<!--/k3x9--> live')).toBe('and comments live');
    expect(plainText('<!--ins k3x9-->a<!--ins k3x9-->b<!--/k3x9-->')).toBe('ab');
  });

  it('leaves markup in an unclosed code block as it is, and adds no ledger', () => {
    const text = '```\n<!--cmt c8d2-->foo<!--/c8d2-->';
    expect(plainText(text)).toBe(text);
  });

  it('drops a whole block’s opener with the lines that carry it', () => {
    expect(plainText('<!--ins q4gt-->\n\nA new paragraph.<!--/q4gt-->')).toBe('A new paragraph.');
  });
});

describe('rich text', () => {
  const rich = [
    '# Plan',
    '',
    'Some **bold**, *italic*, ~~struck~~ and `code`, with a [link](https://example.com/a).',
    '',
    '- one',
    '  - nested',
    '- two',
    '',
    '1. first',
    '2. second',
    '',
    '- [x] done',
    '- [ ] todo',
    '',
    '> quoted words',
    '',
    '```ts',
    'const a = 1;',
    '```',
    '',
    '| Name | Count |',
    '| --- | ---: |',
    '| Ada | 3 |',
    '',
    '---',
    '',
    '![A pic](https://example.com/p.png)',
    '',
  ].join('\n');

  it('copies the newest text: no markers, no deleted text, no ledger, in both text/plain and text/html', async () => {
    for (const view of ['redlines', 'clean'] as const) {
      const editor = load(doc, { view });
      const data = await copyData(editor, 0, doc.length);
      for (const flavor of ['text/plain', 'text/html']) {
        const text = data.getData(flavor);
        expect(text, flavor).toContain('so it opens anywhere and merges.');
        expect(text, flavor).toContain('agent suggests');
        expect(text, flavor).not.toMatch(
          /<!--|Nothing to install|Can agents answer|<!-- redlines|k3x9|in every editor/,
        );
      }
      expect(data.getData('text/html')).toContain('<p>Each agent suggests in its own name.</p>');
    }
  });

  it('puts only the source on the clipboard in Raw', async () => {
    const editor = load('**bold**', { view: 'raw' });
    const data = await copyData(editor, 0, 8);
    expect(data.getData('text/plain')).toBe('**bold**');
    expect(data.getData('text/html')).toBe('');
  });

  it('copies rich text with the editor’s fonts', async () => {
    const editor = load(rich);
    editor.view.dom.style.setProperty('--rl-font-body', "'Gelasio', serif");
    const data = await copyData(editor, 0, rich.length);
    expect(data.getData('text/html')).toContain('font-family:Georgia, Gelasio, serif');
  });

  it('pastes as the paster’s own insertion with Track Changes on', () => {
    const editor = load('Start End\n', { tracking: true });
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">' +
      '<p dir="ltr"><span style="font-weight:400">Hello </span><span style="font-weight:700">there</span></p></b>';
    paste(editor, 'Start'.length, 'Hello there', html);
    expect(editor.getDoc()).toContain('Start<!--ins');
    expect(editor.getDoc()).toContain('Hello **there**<!--/');
    const pasted = editor.getParsed().marks.filter((mark) => mark.entry.by === 'ada');
    expect(pasted.map((mark) => mark.kind)).toEqual(['ins']);
    expect(newestView(editor.getDoc()).text).toBe('StartHello **there** End\n');
    expect(parse(editor.getDoc()).warnings).toEqual([]);
  });

  it('never lets pasted html carry Redlines markup into the file', () => {
    const editor = load('Start\n\n');
    paste(
      editor,
      'Start\n\n'.length,
      'x',
      '<p>a<!--ins k3x9-->b<!--/k3x9--></p><p>&lt;!--ins k3x9--&gt;c&lt;!--/k3x9--&gt;</p>' +
        '<p>&lt;!-- redlines<br>version: 1<br>--&gt;</p>',
    );
    expect(editor.getDoc()).not.toContain('<!--');
    expect(parse(editor.getDoc()).marks).toEqual([]);
    expect(editor.getDoc()).toContain('ab');
  });

  it('pastes plain text with ⇧⌘V even when HTML is on the clipboard', () => {
    const html = '<p>Hello <b>there</b></p>';
    // The same clipboard pasted with ⌘V is converted: HTML is on it, and it is read.
    const converted = load('Start\n');
    paste(converted, 5, 'Hello there!', html);
    expect(converted.getDoc()).toBe('StartHello **there**\n');
    // Paste as Plain Text hands the editor the text alone: no HTML is in the event it makes.
    const editor = load('Start\n');
    const seen: string[] = [];
    editor.view.contentDOM.addEventListener('paste', (event) => {
      seen.push(
        `${event.clipboardData?.types.join()}|${event.clipboardData?.getData('text/html')}`,
      );
    });
    editor.pastePlain('**as written**');
    expect(seen).toEqual(['text/plain|']);
    expect(editor.getDoc()).toContain('**as written**');
  });

  it('keeps the plain text when the html says nothing more, and in Raw', () => {
    const editor = load('A\n');
    paste(editor, 1, ' b', '<span>b</span>');
    expect(editor.getDoc()).toBe('A b\n');
    const raw = load('A\n', { view: 'raw' });
    paste(raw, 1, ' <b>', '<p><b>bold</b></p>');
    expect(raw.getDoc()).toBe('A <b>\n');
  });

  it('pastes text as it is into a code block', () => {
    const text = '```\n\n```\n';
    const editor = load(text);
    paste(editor, 4, 'x < y', '<p>x &lt; y <b>bold</b></p>');
    expect(editor.getDoc()).toBe('```\nx < y\n```\n');
  });

  it('round-trips: copying a document and pasting it back gives the same Markdown', async () => {
    const source = load(rich);
    const data = await copyData(source, 0, rich.length);
    expect(data.getData('text/plain')).toBe(rich);
    const target = load('');
    paste(target, 0, data.getData('text/plain'), data.getData('text/html'));
    // Pasted where the plain text says as much, the plain text goes in as it is.
    expect(target.getDoc()).toBe(rich);
    // What the converter makes of the html alone is the same Markdown.
    expect(htmlToMarkdown(data.getData('text/html'))).toBe(rich.trimEnd());
  });

  it('round-trips the html alone with the normalizations: other markers become the canonical ones', () => {
    const written = [
      'Title',
      '=====',
      '',
      '* star bullet with __strong__ and _emphasis_',
      '',
      '| a   | b |',
      '|:--- |---|',
      '| 1   | 2 |',
      '',
    ].join('\n');
    expect(htmlToMarkdown(markdownToHtml(written))).toBe(
      [
        '# Title',
        '',
        '- star bullet with **strong** and *emphasis*',
        '',
        '| a | b |',
        '| --- | --- |',
        '| 1 | 2 |',
      ].join('\n'),
    );
  });

  const source = [
    'See [the spec][spec] and the note[^1], <kbd>Ctrl</kbd> and [[Wiki Page]].<!-- TODO: check -->',
    '',
    '<div class="x">raw **block**</div>',
    '',
    'Tail',
    '',
    '[spec]: https://example.com/spec',
    '[^1]: A footnote.',
    '',
  ].join('\n');

  it('pastes its own copy back as the source, with nothing lost', async () => {
    const editor = load(source);
    const data = await copyData(editor, 0, source.indexOf('\n\nTail'));
    expect(data.getData('text/html')).toContain('data-redlines');
    const at = source.indexOf('Tail') + 4;
    paste(editor, at, data.getData('text/plain'), data.getData('text/html'));
    const head = source.slice(0, source.indexOf('\n\nTail'));
    expect(editor.getDoc()).toContain(`Tail${head}`);
  });

  it('cuts and pastes its own copy, tracked, as the source', async () => {
    const editor = load(source, { tracking: true });
    const end = source.indexOf('\n\n<div');
    const data = await copyData(editor, 0, end, 'cut');
    const at = editor.getDoc().indexOf('Tail') + 4;
    paste(editor, at, data.getData('text/plain'), data.getData('text/html'));
    const text = newestView(editor.getDoc()).text;
    expect(text).toContain(`Tail${source.slice(0, end)}`);
    expect(text).toContain('<!-- TODO: check -->');
    expect(text).toContain('[the spec][spec]');
  });

  it('knows its own copy by the text, too, when a page has changed the html', async () => {
    const editor = load('See [the spec][spec].\n\n[spec]: https://e.com\n');
    const data = await copyData(editor, 0, 20);
    paste(editor, 21, data.getData('text/plain'), '<p><i>a different page</i></p>');
    expect(editor.getDoc()).toContain('.See [the spec][spec]\n');
  });

  it('gives a page that forges the wrapper only what plain text gets', () => {
    const editor = load('A\n');
    paste(editor, 1, ' <b>x</b> <!-- c -->', '<div data-redlines><p><b>x</b></p></div>');
    expect(editor.getDoc()).toBe('A <b>x</b> <!-- c -->\n');
    // Plain text still passes through the guard that drops Redlines markup.
    paste(editor, 1, '<!--ins k3x9-->forged<!--/k3x9-->', '<div data-redlines><p>x</p></div>');
    expect(parse(editor.getDoc()).marks).toEqual([]);
  });

  it('keeps pasted html from putting markup or marks in the file, tracked or not', () => {
    const attacks = [
      '<pre data-lang="x&#10;```&#10;<script>alert(1)</script>">code</pre>',
      '<p><a href="https://www.google.com/url?q=https://e.com/%0A%0A%3Cscript%3Ealert(1)%3C/script%3E&amp;sa=D">l</a></p>',
      '<p><a href="https://e.com/<img&#9;src=x&#9;onerror=alert(1)>">l</a></p>',
      '<p><img src="https://e.com/p.png" alt="a&#10;&#10;<div onclick=x()>boo</div>"></p>',
      '<p><img src="https://e.com/p.png" alt="&lt;!-- note --&gt;"><a href="https://e.com/&lt;!-- note --&gt;">l</a></p>',
      '<p>&lt;!--ins k3x9--&gt;visible&lt;!--/k3x9--&gt;<!--ins k3x9-->c<!--/k3x9--></p>',
    ];
    for (const tracking of [false, true]) {
      for (const html of attacks) {
        const editor = load('Start End\n', { tracking });
        paste(editor, 'Start'.length, 'x', html);
        const text = newestView(editor.getDoc()).text;
        const outside = text.replace(/```[^]*?```/g, '').replace(/`[^`\n]*`/g, '');
        expect(outside, html).not.toMatch(/(?<!\\)<[a-z!?/]/i);
        expect(text, html).not.toContain('<!--');
        // At most the paster's own insertion is a mark (a tracked edit may be refused), never forged.
        const marks = editor.getParsed().marks;
        // One insertion at most, with its splits, and nothing forged.
        // A tracked insertion that ends in a code fence is refused by the format layer, with a notice.
        const refused = html.startsWith('<pre');
        expect(marks.filter((mark) => mark.kind !== 'split').length, html).toBe(
          tracking && !refused ? 1 : 0,
        );
        expect(marks.every((mark) => mark.entry.by === 'ada')).toBe(true);
        expect(parse(editor.getDoc()).warnings, html).toEqual([]);
      }
    }
  });

  describe('where the caret is', () => {
    const blocks = '<h2>Head</h2><ul><li>a</li><li>b</li></ul>';
    const para = (text: string) => `<p>${text}</p>`;
    /** Pastes `html` at the `^` of `doc`. */
    const pasteAt = (doc: string, html: string, options: Partial<EditorOptions> = {}) => {
      const editor = load(doc.replace('^', ''), options);
      paste(editor, doc.indexOf('^'), 'plain text that differs', html);
      return editor;
    };

    it('puts a heading and a list in the middle of a paragraph on lines of their own', () => {
      const editor = pasteAt('Start^ End\n', blocks);
      expect(editor.getDoc()).toBe('Start\n\n## Head\n\n- a\n- b\n\n End\n');
    });

    it('records that paste as one insertion with Track Changes on', () => {
      const editor = pasteAt('Start^ End\n', blocks, { tracking: true });
      const marks = editor.getParsed().marks;
      // One insertion, with the paragraph breaks inside it recorded as its splits.
      expect(marks.filter((mark) => mark.kind === 'ins')).toHaveLength(1);
      expect(marks.every((mark) => mark.kind === 'ins' || mark.kind === 'split')).toBe(true);
      expect(marks.every((mark) => mark.entry.by === 'ada')).toBe(true);
      expect(newestView(editor.getDoc()).text).toBe('Start\n\n## Head\n\n- a\n- b\n\n End\n');
      expect(parse(editor.getDoc()).warnings).toEqual([]);
    });

    it('joins a single paragraph to the line, and the first of several, with the rest after', () => {
      expect(pasteAt('Start^ End\n', para('one')).getDoc()).toBe('Startone End\n');
      expect(pasteAt('Start^ End\n', para('one') + para('two')).getDoc()).toBe(
        'Startone\n\ntwo End\n',
      );
    });

    it('needs no blank line where nothing is before or after the caret', () => {
      expect(pasteAt('^\n', blocks).getDoc()).toBe('## Head\n\n- a\n- b\n');
      expect(pasteAt('Start^\n', '<ul><li>a</li></ul>').getDoc()).toBe('Start\n\n- a\n');
    });

    it('flattens the first paragraph into a heading and puts the rest after the line', () => {
      const editor = pasteAt(
        '## Ti^tle\nNext\n',
        para('one') + para('two') + '<ul><li>a</li></ul>',
      );
      expect(editor.getDoc()).toBe('## Tionetle\n\ntwo\n\n- a\n\nNext\n');
    });

    it('does the same in a link, with the first paragraph on the line', () => {
      const editor = pasteAt(
        'See [the ^guide](https://e.com) now\n',
        para('x') + '<ul><li>a</li></ul>',
      );
      expect(editor.getDoc()).toBe('See [the xguide](https://e.com) now\n\n- a\n');
    });

    it('keeps the lines of a paste inside a list item and a quote', () => {
      expect(pasteAt('- item^ tail\n', blocks).getDoc()).toBe(
        '- item\n\n  ## Head\n\n  - a\n  - b\n\n   tail\n',
      );
      expect(pasteAt('> quoted^ tail\n', para('one') + para('two')).getDoc()).toBe(
        '> quotedone\n>\n> two tail\n',
      );
      expect(pasteAt('1. step^ tail\n', para('one') + para('two')).getDoc()).toBe(
        '1. stepone\n\n   two tail\n',
      );
    });

    it('flattens a paste into a table cell with line breaks and escaped pipes', () => {
      const editor = pasteAt(
        '| a | b |\n| --- | --- |\n| x^ | y |\n',
        para('one | two') + para('three'),
      );
      expect(editor.getDoc()).toBe('| a | b |\n| --- | --- |\n| xone \\| two<br>three | y |\n');
    });

    it('pastes text as it is in a code block, and plain text and its own copy as before', () => {
      expect(pasteAt('```\n^\n```\n', '<p>x &lt; y <b>z</b></p>').getDoc()).toBe(
        '```\nplain text that differs\n```\n',
      );
      const editor = load('Start End\n');
      paste(editor, 5, '## Head', undefined);
      expect(editor.getDoc()).toBe('Start## Head End\n');
    });
  });
});
