// @vitest-environment happy-dom
// An image's size and alignment (#526): the text a size is written as, the commands for a host's
// Image menu, Track Changes on and off, and Undo.
import { forceParsing } from '@codemirror/language';
import { parse } from '@redlines/format';
import { afterEach, describe, expect, it } from 'vitest';
import { type Script, runScript, scriptRows } from './blocks/script.ts';
import { undo } from './history/index.ts';
import {
  IMAGE_IN_HEADING,
  IMAGE_PARTS_PARAGRAPH,
  imageInSelection,
  imageText,
  lookEdit,
} from './image-size.ts';
import { createEditor, type Editor } from './index.ts';

const open: Editor[] = [];
afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** An editor on `doc` with the caret at `at` (the start of the document by default). */
function load(doc: string, at = 0, notices: string[] = []) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const editor = createEditor(parent, {
    doc,
    author: { handle: 'ada', name: 'Ada Lovelace' },
    onNotice: (message) => notices.push(message),
    // A host with an Image menu, which is what has the commands.
    openImage: () => {},
  });
  open.push(editor);
  editor.view.dispatch({ selection: { anchor: at } });
  forceParsing(editor.view, editor.view.state.doc.length, 5000);
  return editor;
}

/** The text of the image at the caret with the look, or null where it changes nothing. */
function written(doc: string, look: Parameters<typeof imageText>[1], at = 0): string | null {
  const { view } = load(doc, at);
  const image = imageInSelection(view.state)!;
  const edit = lookEdit(view.state, image, look);
  return edit ? edit.changes[0]!.insert : null;
}

describe('the text an image is written as', () => {
  it('turns a Markdown image into a tag with its width, keeping its alt text and its title', () => {
    expect(written('![A cat](cat.png "Tip")', { width: 320 })).toBe(
      '<img src="cat.png" alt="A cat" title="Tip" width="320">',
    );
  });

  it('writes no alt for an image that has none', () => {
    expect(written('![](cat.png)', { width: 320 })).toBe('<img src="cat.png" width="320">');
  });

  it('reads what Markdown reads in the destination, alt text and title', () => {
    expect(written('![a \\* b &amp; c](<my cat.png> "say \\"hi\\"")', { width: 5 })).toBe(
      '<img src="my cat.png" alt="a * b &amp; c" title="say &quot;hi&quot;" width="5">',
    );
  });

  it('writes the width of a tag where it was, and takes the height away: the aspect follows', () => {
    expect(written('<img src="a.png" width="200" height="100" class="x">', { width: 300 })).toBe(
      '<img src="a.png" class="x" width="300">',
    );
  });

  it('gives an image its own size again as Markdown, when nothing else is in the tag', () => {
    expect(
      written('<img src="cat.png" alt="A cat" title="Tip" width="320">', { width: null }),
    ).toBe('![A cat](cat.png "Tip")');
  });

  it('keeps the tag when something would be lost, and takes the width away', () => {
    expect(written('<img src="a.png" width="200" class="x">', { width: null })).toBe(
      '<img src="a.png" class="x">',
    );
    expect(written('<img src="a b.png" width="200">', { width: null })).toBe('<img src="a b.png">');
    expect(written('<img src="a.png" alt="*a*" width="200">', { width: null })).toBe(
      '<img src="a.png" alt="*a*">',
    );
  });

  it('changes nothing for an image that is as asked', () => {
    expect(written('![A cat](cat.png)', { width: null })).toBeNull();
    expect(written('<img src="a.png" width="200">', { width: 200 })).toBeNull();
    expect(written('<img src="a.png" align="left">', { align: 'left' })).toBeNull();
  });

  it('writes an alignment as a left or a right, and centered as none', () => {
    expect(written('![](a.png)', { align: 'left' })).toBe('<img src="a.png" align="left">');
    expect(written('![](a.png)', { align: 'right' })).toBe('<img src="a.png" align="right">');
    expect(written('<img src="a.png" align="right" width="9">', { align: 'center' })).toBe(
      '<img src="a.png" width="9">',
    );
    // Neither a width nor an alignment is left: Markdown again.
    expect(written('<img src="a.png" align="left">', { align: 'center' })).toBe('![](a.png)');
  });

  it('reads a width of pixels and a width that is not', () => {
    const { view } = load('<img src="a.png" width="50%"> <img src="b.png" width="120px">');
    expect(imageInSelection(view.state)).toMatchObject({ width: null, widthText: '50%' });
    view.dispatch({ selection: { anchor: 33 } });
    expect(imageInSelection(view.state)).toMatchObject({ width: 120, widthText: null });
  });

  it('survives its own round trips, from Markdown to a tag and back', () => {
    const alts = ['', 'A cat', 'a "quoted" cat', 'x & y', 'two  spaces', 'ünïcode ✓'];
    const titles = [null, 'Tip', 'A "quoted" tip', 'a & b'];
    const srcs = ['cat.png', 'img/cat%20two.png', 'https://example.com/a.png?x=1&y=2', '../up.png'];
    for (const alt of alts) {
      for (const title of titles) {
        for (const src of srcs) {
          const markdown =
            `![${alt}](${src}` + (title === null ? '' : ` "${title.replace(/"/g, '\\"')}"`) + ')';
          const tag = written(markdown, { width: 100 });
          expect(tag, markdown).toMatch(/^<img /);
          const back = written(tag!, { width: null })!;
          // The tag goes back to Markdown only where it is the same image: the escapes of a quote
          // or an ampersand are another way of writing it.
          expect(imageOf(back), `${markdown} through ${tag} gave ${back}`).toEqual(
            imageOf(markdown),
          );
        }
      }
    }
  });
});

/** What an image says, however it is written. */
function imageOf(doc: string) {
  const { view } = load(doc);
  const { src, alt, title } = imageInSelection(view.state)!;
  return { src, alt, title };
}

describe('the commands of an image', () => {
  it('sizes the image under the caret, and gives its own size back, with one Undo for each', () => {
    const editor = load('Words ![A cat](cat.png) more', 6);
    const { view } = editor;
    expect(editor.commands.run('image.size.medium')).toBe(true);
    const sized = view.state.doc.toString();
    expect(sized).toMatch(/^Words <img src="cat.png" alt="A cat" width="\d+"> more$/);
    expect(editor.commands.run('image.size.original')).toBe(true);
    expect(view.state.doc.toString()).toBe('Words ![A cat](cat.png) more');
    // One Undo takes back each: the size, then the first size.
    undo(view);
    expect(view.state.doc.toString()).toBe(sized);
    undo(view);
    expect(view.state.doc.toString()).toBe('Words ![A cat](cat.png) more');
  });

  it('offers small, medium and large as a part of the column', () => {
    const editor = load('![](cat.png)');
    const width = (id: string) => {
      editor.commands.run(id);
      const found = /width="(\d+)"/.exec(editor.view.state.doc.toString());
      editor.commands.run('image.size.original');
      return Number(found?.[1]);
    };
    const [small, medium, large] = [
      width('image.size.small'),
      width('image.size.medium'),
      width('image.size.large'),
    ];
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
    expect(editor.view.state.doc.toString()).toBe('![](cat.png)');
  });

  it('aligns, and marks the alignment it has', () => {
    const editor = load('![](cat.png)');
    expect(editor.commands.run('image.align.right')).toBe(true);
    expect(editor.view.state.doc.toString()).toBe('<img src="cat.png" align="right">');
    expect(editor.getUiState().activeCommands).toContain('image.align.right');
    expect(editor.getUiState().activeCommands).not.toContain('image.align.center');
    expect(editor.commands.run('image.align.center')).toBe(true);
    expect(editor.view.state.doc.toString()).toBe('![](cat.png)');
  });

  it('is disabled where there is no image, and the original size where there is no size', () => {
    const none = load('Just words.');
    expect(none.getUiState().enabledCommands).not.toContain('image.size.medium');
    expect(none.commands.run('image.size.medium')).toBe(false);
    const plain = load('![](cat.png)');
    expect(plain.getUiState().enabledCommands).toContain('image.size.medium');
    expect(plain.getUiState().enabledCommands).not.toContain('image.size.original');
  });

  it('sizes a remote image too', () => {
    const editor = load('![](https://example.com/cat.png)');
    editor.commands.run('image.size.small');
    expect(editor.view.state.doc.toString()).toMatch(
      /^<img src="https:\/\/example.com\/cat.png" width="\d+">$/,
    );
  });

  it('parts the paragraph under an image that would become an HTML block', () => {
    const editor = load('![](cat.png)\nmore **text**');
    editor.commands.run('image.size.medium');
    expect(editor.view.state.doc.toString()).toMatch(
      /^<img src="cat.png" width="\d+">\n\nmore \*\*text\*\*$/,
    );
  });
});

describe('where the tag would be an HTML block', () => {
  /** The file after the command on the image at the caret, untracked, and what it said. */
  function after(doc: string, at = 0) {
    const notices: string[] = [];
    const editor = load(doc, at, notices);
    editor.commands.run('image.size.medium');
    return { text: editor.view.state.doc.toString(), notices };
  }

  // A marker on the image's line stays where it is, and the tag is not a block of its own there.
  scriptRows([
    {
      name: 'a split after the image stays after it',
      doc: '‸![a](b.png)<split>⏎more',
      keys: [{ command: 'image.size.medium' }],
      tc: false,
      others: 'bo',
      expect: { file: '<img src="b.png" alt="a" width="360"><split>⏎more' },
      skip: { render: 'a lone <img> is an HTML block until the split goes (#628)' },
    },
  ]);

  it('does not part a tight list: the next item ends the block', () => {
    expect(after('- ![a](b.png)\n- other', 2).text).toBe(
      '- <img src="b.png" alt="a" width="360">\n- other',
    );
    expect(after('1. ![a](b.png)\n2. two', 3).text).toBe(
      '1. <img src="b.png" alt="a" width="360">\n2. two',
    );
  });

  it('parts a paragraph before a heading line the block would take, and says so for a setext heading', () => {
    expect(after('![a](b.png)\n# Heading').text).toBe(
      '<img src="b.png" alt="a" width="360">\n\n# Heading',
    );
    for (const doc of ['![a](b.png)\n---', '![a](b.png)\nmore\n===']) {
      const { text, notices } = after(doc);
      expect(text).toBe(doc);
      expect(notices).toEqual([IMAGE_IN_HEADING]);
    }
  });

  it('writes a pipe in a table cell as a character reference, and keeps the tag for it', () => {
    const table = '| x |\n|---|\n| ![a\\|b](b.png) |';
    const { text } = after(table, table.indexOf('!['));
    expect(text).toContain('<img src="b.png" alt="a&#124;b" width="360">');
    const editor = load(text, text.indexOf('<img'));
    editor.commands.run('image.size.original');
    expect(editor.view.state.doc.toString()).toContain('<img src="b.png" alt="a&#124;b">');
  });
});

const sized = 'image.size.medium';

/** Rows whose file the markers write with Track Changes on. */
const rows: Script[] = [
  {
    name: 'an image among words is replaced whole, and the tag is the new text',
    doc: 'Words ‸![A cat](a.png) more',
    keys: [{ command: sized }],
    tc: true,
    expect: { original: 'Words ![A cat](a.png) more' },
  },
  {
    name: 'a tag that gets its own size back is replaced by Markdown',
    doc: 'Words ‸<img src="a.png" alt="A cat" width="200"> more',
    keys: [{ command: 'image.size.original' }],
    tc: true,
    expect: { newest: 'Words ![A cat](a.png) more' },
  },
  {
    name: 'an image in a list item',
    doc: '- item ‸![](a.png)',
    keys: [{ command: sized }],
    tc: true,
    expect: { original: '- item ![](a.png)' },
  },
  {
    name: 'an image in a quote',
    doc: '> words ‸![](a.png) more',
    keys: [{ command: sized }],
    tc: true,
    expect: { original: '> words ![](a.png) more' },
  },
  {
    name: 'an image on the last line of a paragraph',
    doc: 'text⏎‸![](a.png)⏎⏎Two.',
    keys: [{ command: sized }],
    tc: true,
    expect: { original: 'text⏎![](a.png)⏎⏎Two.' },
  },
  {
    name: 'two changes of the same image: the second is part of the first',
    doc: 'Words ‸![](a.png) more',
    keys: [{ command: 'image.size.small' }, { command: 'image.align.left' }],
    tc: true,
    expect: { original: 'Words ![](a.png) more' },
  },
  {
    name: 'an image in another person’s pending insertion is theirs to decide',
    doc: 'Intro <ins>words ‸![](a.png) more</ins>',
    keys: [{ command: sized }],
    tc: true,
    others: 'bo',
    expect: {},
  },
  {
    // The tag alone on a line is an HTML block, which micromark reads without the <p> that the
    // marker after it makes in the file (#nnn): the writer puts the closer on the tag's line.
    name: 'an image alone in its paragraph (known: reads as a block once decided)',
    doc: 'One.⏎⏎‸![A cat](a.png)⏎⏎Two.',
    keys: [{ command: sized }],
    tc: true,
    expect: { original: 'One.⏎⏎![A cat](a.png)⏎⏎Two.' },
    skip: { render: 'a lone <img> is an HTML block; the closer after it makes it a paragraph' },
  },
  {
    name: 'a size with Track Changes off is one plain change',
    doc: 'One.⏎⏎‸![A cat](a.png)⏎⏎Two.',
    keys: [{ command: sized }],
    tc: false,
    expect: { file: 'One.⏎⏎<img src="a.png" alt="A cat" width="360">⏎⏎Two.' },
  },
];
scriptRows(rows, 60_000);

describe('with Track Changes on', () => {
  it('writes the whole image as a substitution that every decision reads the same', () => {
    const result = runScript({
      name: 'x',
      doc: 'Words ‸![A cat](a.png "Tip") more',
      keys: [{ command: sized }],
      tc: true,
      expect: {},
    });
    const marks = parse(result.file).marks;
    expect(marks.map((mark) => mark.kind)).toEqual(['sub']);
    expect(result.file).toMatch(
      /Words <!--sub \w{4} !\[A cat\]\(a\.png "Tip"\)--><img src="a\.png" alt="A cat" title="Tip" width="\d+"><!--\/\w{4}--> more/,
    );
  });

  it('says why an image with its paragraph under it is not resized, in words about the image', () => {
    const notices: string[] = [];
    const editor = load('![](a.png)\nmore **text**', 0, notices);
    editor.setTracking(true, { inFile: false });
    expect(editor.commands.run('image.size.medium')).toBe(false);
    expect(notices).toEqual([IMAGE_PARTS_PARAGRAPH]);
    expect(editor.view.state.doc.toString()).toBe('![](a.png)\nmore **text**');
  });
});
