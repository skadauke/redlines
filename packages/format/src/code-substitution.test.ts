// Code edited with Track Changes on (format §3.5, rule 9): a change inside a fenced code block,
// indented code, display math or a block of raw text replaces the block whole, with the old block
// as the payload of a substitution and the newest code in the file. The author's own further
// keystrokes edit the code and make no mark; another person's pending change that holds the block
// is theirs to decide first.

import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { accept, acceptAll, rejectAll } from './decide.ts';
import { EditError } from './errors.ts';
import { parse } from './parse.ts';
import { decodePayload } from './payload.ts';
import { ada, bo, bodyOf, context, expectEveryOrderAlike, file } from './test-helpers.ts';
import { trackedEdits } from './track.ts';
import { newestView, originalView } from './views.ts';
import type { Person } from './types.ts';

/** `body` as a file, the keys typed one after the other at `at(body)` (each after the text the
 * one before typed), the file they leave. */
function typeIn(
  body: string,
  inserts: readonly string[],
  at: (body: string) => number,
  who: Person = ada,
  marks: Record<string, string> = {},
) {
  let text = file(body, marks);
  let position = at(body);
  const ids = ['m2bd', 'n8fx', 'p7qd', 'q3gz'];
  for (const insert of inserts) {
    const result = trackedEdits(
      text,
      [{ from: position, to: position, insert }],
      context(who, ids),
    );
    text = applyChanges(text, result.changes);
    // The caret goes after the text typed, past the markers written in front of it.
    position += result.changes
      .filter((change) => change.from <= position)
      .reduce((sum, change) => sum + change.insert.length - (change.to - change.from), 0);
  }
  return text;
}

/** What the edit leaves, or the refusal's words and code. */
function attempt(
  text: string,
  from: number,
  to: number,
  insert: string,
  who: Person = ada,
): { after?: string; error?: string; code?: string } {
  try {
    const result = trackedEdits(text, [{ from, to, insert }], context(who, ['m2bd', 'n8fx']));
    return { after: applyChanges(text, result.changes) };
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
    return { error: error.message, ...(error.code ? { code: error.code } : {}) };
  }
}

/** The body once every change is rejected: the original text, without the line breaks that end it. */
const back = (text: string) => bodyOf(applyChanges(text, rejectAll(text))).replace(/\s+$/, '');

const BODY = 'Intro.\n\n```js\nline one\nline two\n```\n\nAfter.';
const afterOne = (b: string) => b.indexOf('one') + 3;

/** The newest and original text of a file's body, as the views read them. */
const views = (text: string) => ({
  newest: newestView(text).text,
  original: originalView(text).text,
});

describe('a fenced code block changed with Track Changes on (format §3.5)', () => {
  it('is replaced whole: the old block is the payload, the fence holds the newest code', () => {
    const text = typeIn(BODY, ['X'], afterOne);
    expect(bodyOf(text)).toBe(
      'Intro.\n\n' +
        '<!--sub m2bd \\x60\\x60\\x60js\\nline one\\nline two\\n\\x60\\x60\\x60\\n-->\n\n' +
        '```js\nline oneX\nline two\n```\n<!--/m2bd-->\nAfter.',
    );
    const parsed = parse(text);
    expect(parsed.marks).toHaveLength(1);
    expect(parsed.marks[0]?.kind).toBe('sub');
    expect(parsed.marks[0]?.payload).toBe('```js\nline one\nline two\n```\n');
    expect(parsed.marks[0]?.entry.by).toBe('ada');
    // No backtick in a marker, so knitr finds no chunk in the payload.
    expect(bodyOf(text).match(/<!--sub[^\n]*-->/)?.[0]).not.toContain('`');
  });

  it('reads right in both views, and rejecting gives the old block back, bytes and all', () => {
    const before = file(BODY);
    const text = typeIn(BODY, ['X'], afterOne);
    const { newest, original } = views(text);
    // Where a blank line follows the block, the closer stands in it: both views, and the accepted
    // file, keep as many blank lines as the file had.
    expect(newest).toBe('Intro.\n\n```js\nline oneX\nline two\n```\n\nAfter.\n');
    expect(original).toBe(originalView(before).text);
    expect(back(text)).toBe(BODY);
    expect(bodyOf(applyChanges(text, acceptAll(text))).trimEnd()).toBe(
      'Intro.\n\n```js\nline oneX\nline two\n```\n\nAfter.',
    );
  });

  it('takes a line break as a line of the code, with no split', () => {
    const text = typeIn(BODY, ['\n  '], afterOne);
    expect(bodyOf(text)).toContain('```js\nline one\n  \nline two\n```\n<!--/m2bd-->');
    expect(bodyOf(text)).not.toContain('split');
    expect(back(text)).toBe(BODY);
  });

  it('makes no new mark for further keystrokes of the author: they edit the newest code', () => {
    const text = typeIn(BODY, ['X', 'Y', '\n', 'Z'], afterOne);
    const parsed = parse(text);
    expect(parsed.marks).toHaveLength(1);
    expect(bodyOf(text)).toContain('```js\nline oneXY\nZ\nline two\n```\n<!--/m2bd-->');
    expect(parsed.marks[0]?.payload).toBe('```js\nline one\nline two\n```\n');
    // The ledger says what it said after the first key.
    expect(Object.keys(parsed.ledger.marks)).toEqual(['m2bd']);
    expect(back(text)).toBe(BODY);
    expect(newestView(text).text).toContain('line oneXY\nZ\nline two');
  });

  it('deletes code the same way, and a replaced selection', () => {
    const text = file(BODY);
    const one = text.indexOf('one');
    const deleted = attempt(text, one, one + 3, '');
    expect(deleted.after).toContain('```js\nline \nline two\n```');
    expect(back(deleted.after ?? '')).toBe(BODY);
    const across = attempt(text, one, text.indexOf('two') + 3, 'z');
    expect(across.after).toContain('```js\nline z\n```');
    expect(back(across.after ?? '')).toBe(BODY);
  });

  it('is the same for tildes, longer fences and R Markdown and Quarto chunks', () => {
    for (const [fence, open] of [
      ['~~~', '~~~'],
      ['````', '````'],
      ['```', '```{r}'],
      ['```', '```{python}'],
    ] as const) {
      const body = `Intro.\n\n${open}\nline one\nline two\n${fence}\n\nAfter.`;
      const text = typeIn(body, ['X'], afterOne);
      expect(parse(text).marks[0]?.kind, open).toBe('sub');
      expect(bodyOf(text), open).toContain(`${open}\nline oneX\nline two\n${fence}\n<!--/m2bd-->`);
      // The payload has no backtick: knitr runs nothing in it.
      expect(
        bodyOf(text)
          .split('\n')
          .find((line) => line.startsWith('<!--sub')),
      ).not.toContain('`');
      expect(back(text), open).toBe(body);
      expect(decodePayload(parse(text).marks[0]?.payload ?? '')).toContain('line one');
    }
  });

  it('works at the start and the end of a document and right under the text above', () => {
    for (const body of [
      '```js\nline one\nline two\n```\n\nAfter.',
      'Intro.\n\n```js\nline one\nline two\n```',
      'Intro.\n\n```js\nline one\nline two\n```\nAfter.',
      'Intro.\n```js\nline one\nline two\n```\n\nAfter.',
    ]) {
      const text = typeIn(body, ['X'], afterOne);
      expect(parse(text).marks[0]?.kind, body).toBe('sub');
      expect(back(text), body).toBe(body);
      // Both views keep the file's own blank lines, the ledger's included.
      expect(originalView(text).text, body).toBe(originalView(file(body)).text);
    }
  });

  it('goes in a quote and in a list item after its first block, keeping them whole', () => {
    const quote = '> Intro.\n>\n> ```js\n> line one\n> line two\n> ```\n>\n> After.';
    const inQuote = typeIn(quote, ['X'], afterOne);
    expect(bodyOf(inQuote)).toContain('> <!--sub m2bd');
    expect(bodyOf(inQuote)).toContain('> ```js\n> line oneX\n> line two\n> ```\n> <!--/m2bd-->');
    expect(back(inQuote)).toBe(quote);
    const list = '- item\n\n  ```js\n  line one\n  line two\n  ```\n\n- next';
    const inList = typeIn(list, ['X'], afterOne);
    expect(bodyOf(inList)).toContain('  <!--sub m2bd');
    expect(bodyOf(inList)).toContain('  ```js\n  line oneX\n  line two\n  ```\n  <!--/m2bd-->');
    expect(back(inList)).toBe(list);
    // The list is one list in the newest view, and in the original one.
    expect(views(inList).newest).toContain('- item');
    expect(views(inList).original).toBe(originalView(file(list)).text);
  });

  it('refuses a line that would end the block, and the first and last lines, as they are', () => {
    const text = file(BODY);
    const mid = afterOne(BODY);
    expect(attempt(text, mid, mid, '\n```').code).toBe('no-legal-placement');
    expect(attempt(text, mid, mid, '\n````').error).toContain('end the code block');
    // A fence is Markdown syntax, not code.
    const fence = text.indexOf('```js') + 5;
    expect(attempt(text, fence, fence, 'x').code).toBeDefined();
    const closing = text.indexOf('\n```\n') + 2;
    expect(attempt(text, closing, closing, 'x').code).toBeDefined();
  });

  it('keeps the file as it was when it refuses', () => {
    const text = file(BODY);
    const mid = afterOne(BODY);
    const refused = attempt(text, mid, mid, '\n```');
    expect(refused.after).toBeUndefined();
  });

  it('uses the file’s own line breaks', () => {
    const text = file(BODY).replace(/\r?\n/g, '\r\n');
    const mid = text.indexOf('one') + 3;
    const result = attempt(text, mid, mid, '\n');
    expect(result.error).toBeUndefined();
    const after = result.after ?? '';
    expect(after).toContain('<!--/m2bd-->');
    expect(after.replace(/\r\n/g, '')).not.toContain('\n');
    expect(after.replace(/\r\n/g, '')).not.toContain('\r');
    expect(bodyOf(after)).toContain('line one\r\n\r\nline two');
    expect(back(after).replace(/\r\n/g, '\n')).toBe(BODY);
    expect(parse(after).marks[0]?.payload).toBe('```js\nline one\nline two\n```\n');
  });

  it('writes the group and the note of the edit in the ledger entry', () => {
    const text = file(BODY);
    const mid = afterOne(BODY);
    const result = trackedEdits(text, [{ from: mid, to: mid, insert: 'X' }], {
      ...context(ada, ['m2bd']),
      note: 'Fix the name',
      group: 'g3rp',
    });
    const after = applyChanges(text, result.changes);
    expect(parse(after).ledger.marks['m2bd']).toMatchObject({ by: 'ada', note: 'Fix the name' });
  });
});

describe('indented code, display math and raw text', () => {
  it('replaces indented code whole, and takes the indentation as typed', () => {
    const body = 'Intro.\n\n    line one\n    line two\n\nAfter.';
    const text = typeIn(body, ['X'], afterOne);
    expect(parse(text).marks[0]?.kind).toBe('sub');
    expect(bodyOf(text)).toContain('    line oneX\n    line two\n<!--/m2bd-->');
    expect(back(text)).toBe(body);
    // No marker lands in the code: every renderer would show it as code.
    expect(parse(text).warnings.map((w) => w.code)).toEqual([]);
    const second = typeIn(body, ['\n    ', 'Y'], afterOne);
    expect(bodyOf(second)).toContain('    line one\n    Y\n    line two');
    expect(parse(second).marks).toHaveLength(1);
  });

  it('refuses indented code that a typed line would end', () => {
    const body = 'Intro.\n\n    line one\n    line two\n\nAfter.';
    const text = file(body);
    const at = text.indexOf('one') + 3;
    expect(attempt(text, at, at, '\ntext').code).toBe('no-legal-placement');
  });

  it('replaces display math whole', () => {
    const body = 'Intro.\n\n$$\nx = one\ny\n$$\n\nAfter.';
    const text = typeIn(body, ['X'], afterOne);
    expect(parse(text).marks[0]?.kind).toBe('sub');
    expect(bodyOf(text)).toContain('$$\nx = oneX\ny\n$$\n<!--/m2bd-->');
    expect(back(text)).toBe(body);
    const at = file(body).indexOf('one') + 3;
    expect(attempt(file(body), at, at, '\n$$').code).toBe('no-legal-placement');
  });

  it('replaces the raw-text elements whole', () => {
    for (const tag of ['pre', 'script', 'style', 'textarea']) {
      const body = `Intro.\n\n<${tag}>\nline one\n\nline two\n</${tag}>\n\nAfter.`;
      const text = typeIn(body, ['X'], afterOne);
      expect(parse(text).marks[0]?.kind, tag).toBe('sub');
      expect(back(text), tag).toBe(body);
      const at = file(body).indexOf('one') + 3;
      expect(attempt(file(body), at, at, `\n</${tag}>`).code, tag).toBe('no-legal-placement');
    }
  });
});

describe('a block that a pending change holds, and front matter', () => {
  it('is edited without a mark when the author’s own insertion holds it', () => {
    const body =
      'Intro.\n\n<!--ins m3bd-->\n\n```js\nline one\nline two\n```\n<!--/m3bd-->\n\nAfter.';
    const text = typeIn(body, ['X', '\n'], afterOne, ada, { m3bd: 'ada' });
    expect(parse(text).marks).toHaveLength(1);
    expect(bodyOf(text)).toContain('```js\nline oneX\n\nline two\n```');
    expect(back(text).replace(/\n{3,}/g, '\n\n')).toBe('Intro.\n\nAfter.');
  });

  it('is refused, naming the person, when another person’s change holds it', () => {
    const insertion =
      'Intro.\n\n<!--ins m3bd-->\n\n```js\nline one\nline two\n```\n<!--/m3bd-->\n\nAfter.';
    const text = file(insertion, { m3bd: 'bo' });
    const at = text.indexOf('one') + 3;
    const refused = attempt(text, at, at, 'X');
    expect(refused.error).toBe(
      "This would change how Bo Chen's insertion reads. Decide it first, or turn off Track Changes.",
    );
    expect(refused.code).toBe('no-legal-placement');
  });

  it('is refused for another person in a block that your substitution holds', () => {
    const mine = typeIn(BODY, ['X'], afterOne);
    const at = mine.indexOf('oneX') + 4;
    const refused = attempt(mine, at, at, 'Y', bo);
    expect(refused.error).toBe(
      "This would change how Ada Lovelace's replacement reads. Decide it first, or turn off Track Changes.",
    );
    // Deciding it first frees the code.
    const decided = applyChanges(mine, accept(mine, 'm2bd'));
    const free = decided.indexOf('oneX') + 4;
    expect(attempt(decided, free, free, 'Y', bo).after).toContain('<!--sub');
  });

  it('is refused in front matter, in the words of format §3.8', () => {
    const body = '---\ntitle: one\n---\n\nAfter.';
    const text = file(body);
    const at = text.indexOf('one') + 3;
    expect(attempt(text, at, at, 'X')).toMatchObject({
      error: "Front matter can't be edited with Track Changes on yet.",
      code: 'front-matter',
    });
    // Code in the body after it is still code.
    const both = '---\ntitle: one\n---\n\n```js\nline one\n```\n\nAfter.';
    const code = file(both).lastIndexOf('one') + 3;
    expect(attempt(file(both), code, code, 'X').after).toContain('<!--sub');
  });
});

describe('the end of front matter’s closing line (format §3.8)', () => {
  const body = '---\ntitle: one\n---\n\nAfter.';
  const closing = (text: string) => text.indexOf('---\n\nAfter') + 3;

  it('takes line breaks as plain text of the body: the empty paragraph Enter opens', () => {
    const text = file(body);
    const result = attempt(text, closing(text), closing(text), '\n\n');
    expect(result.error).toBeUndefined();
    expect(parse(result.after ?? '').marks).toEqual([]);
    expect(bodyOf(result.after ?? '').trimEnd()).toBe('---\ntitle: one\n---\n\n\n\nAfter.');
  });

  it('refuses text typed there, and a deletion of the closing line, in the words of §3.8', () => {
    const text = file(body);
    const at = closing(text);
    for (const [from, to, insert] of [
      [at, at, 'x'],
      [at, at, '\nx'],
      [at - 3, at, ''],
    ] as const) {
      expect(attempt(text, from, to, insert), insert).toMatchObject({
        error: "Front matter can't be edited with Track Changes on yet.",
        code: 'front-matter',
      });
    }
  });
});

describe('every order of decisions reads alike around a code change', () => {
  it('with another person’s changes in the text around it', () => {
    const body =
      'Intro <!--ins k3x9-->new <!--/k3x9-->text.\n\n```js\nline one\nline two\n```\n\n<!--del w2rf Old.-->After.';
    const text = typeIn(body, ['X'], afterOne, ada, { k3x9: 'bo', w2rf: 'bo' });
    expectEveryOrderAlike('code change next to others', text, (t) =>
      bodyOf(t).replace(/\n{3,}/g, '\n\n'),
    );
  });
});

describe('display math in a paragraph', () => {
  it('replaces `$$x = 1$$` whole, and takes a line break in it', () => {
    const body = 'Intro.\n\n$$x = 1$$\n\nAfter.';
    const text = typeIn(body, ['X', '\n'], (b) => b.indexOf('1'));
    expect(parse(text).marks.map((mark) => mark.kind)).toEqual(['sub']);
    expect(bodyOf(text)).toContain('$$x = X\n1$$\n<!--/m2bd-->');
    expect(back(text)).toBe(body);
    // A `$$` typed in it would end it.
    const inside = file(body).indexOf('1');
    expect(attempt(file(body), inside, inside, '$$').code).toBe('no-legal-placement');
  });
});

describe('a block whose range holds a marker, and its edges (fix round 1)', () => {
  const PRE = 'Intro.\n\n<pre>\nline one\nline two\n</pre><!--del k3x9 \\n\\n-->After.';
  const MARKED = file(PRE, { k3x9: 'bo' });

  it('refuses an edit in a block when another person’s marker is on its closing line', () => {
    const at = MARKED.indexOf('one') + 3;
    expect(attempt(MARKED, at, at, 'x')).toMatchObject({
      error:
        "Bo Chen's pending change is in this code block. Decide it first, or turn off Track Changes.",
      code: 'no-legal-placement',
    });
    // The same for display math with a marker on a `$$` line, and for your own other marks.
    const math = file('Intro.\n\n$$\nx = 1\n$$<!--del k3x9 \\n\\n-->After.', { k3x9: 'bo' });
    const inMath = math.indexOf('1');
    expect(attempt(math, inMath, inMath, 'x').error).toContain("Bo Chen's pending change");
    const mine = file(PRE, { k3x9: 'ada' });
    expect(attempt(mine, mine.indexOf('one') + 3, mine.indexOf('one') + 3, 'x').error).toContain(
      'Your pending change is in this code block',
    );
  });

  it('never writes a marker inside code, math or raw text: an edit at an edge is refused', () => {
    for (const [body, at, insert] of [
      ['Intro.\n\n$$\nx = 1\n$$\n\nAfter.', (t: string) => t.indexOf('\n$$\n\nAfter') + 1, 'x'],
      ['Intro.\n\n<pre>\none\n</pre>\n\nAfter.', (t: string) => t.indexOf('</pre>') + 5, ' '],
      ['Intro.\n\n```js\none\n```\n\nAfter.', (t: string) => t.indexOf('```js') + 5, 'x'],
    ] as const) {
      const text = file(body);
      const result = attempt(text, at(text), at(text), insert);
      expect(result.error, body).toBeDefined();
      expect(result.after, body).toBeUndefined();
    }
  });

  it('puts a letter typed right before the closing tag in the raw-text block', () => {
    const body = 'Intro.\n\n<pre>\nline one</pre>\n\nAfter.';
    const text = file(body);
    const at = text.indexOf('</pre>');
    const result = attempt(text, at, at, 'x');
    expect(result.error).toBeUndefined();
    expect(bodyOf(result.after ?? '')).toContain('<pre>\nline onex</pre>\n<!--/m2bd-->');
    expect(back(result.after ?? '')).toBe(body);
  });

  it('holds a `title` as raw text: rule 9 as for the other elements', () => {
    const body = 'Intro.\n\n<title>Docs</title>\n\nAfter.';
    const text = file(body);
    const at = text.indexOf('Docs') + 2;
    const result = attempt(text, at, at, 'x');
    expect(result.error).toBeUndefined();
    expect(parse(result.after ?? '').marks.map((m) => m.kind)).toEqual(['sub']);
    expect(bodyOf(result.after ?? '')).toContain('<title>Doxcs</title>');
    expect(back(result.after ?? '')).toBe(body);
    // Not raw text where a blank line comes before its closing tag.
    const open = file('Intro.\n\n<title>\n\nWords <!--ins k3x9-->x<!--/k3x9--> here.\n\n</title>', {
      k3x9: 'bo',
    });
    expect(parse(open).warnings).toEqual([]);
  });

  it('says what is not built, naming the code, and leaves the file', () => {
    for (const [body, words] of [
      [
        '- ```js\n  one\n  ```\n\nAfter.',
        "A tracked change can't go in code that starts a list item yet. Turn off Track Changes to edit it.",
      ],
      [
        '- Item.\n\n      one\n      two\n\n  After.',
        "A tracked change can't go in indented code in a list item or a quote yet. Turn off Track Changes to edit it.",
      ],
      [
        '> Para.\n>\n>     one\n>     two',
        "A tracked change can't go in indented code in a list item or a quote yet. Turn off Track Changes to edit it.",
      ],
    ] as const) {
      const text = file(body);
      const at = text.indexOf('one') + 1;
      expect(attempt(text, at, at, 'x'), body).toMatchObject({ error: words, code: 'inside-code' });
    }
  });
});

describe('line breaks of a block (fix round 1)', () => {
  it('takes typing and a line break in indented code in a CRLF file', () => {
    const text = file('Intro.\n\n    code one\n    code two\n\nAfter.').replace(/\r?\n/g, '\r\n');
    const at = text.indexOf('one') + 3;
    for (const insert of ['Q', '\n    ']) {
      const result = attempt(text, at, at, insert);
      expect(result.error, insert).toBeUndefined();
      expect(parse(result.after ?? '').marks.map((m) => m.kind)).toEqual(['sub']);
      expect(back(result.after ?? '').replace(/\r\n/g, '\n')).toBe(
        'Intro.\n\n    code one\n    code two\n\nAfter.',
      );
    }
  });

  it('refuses a block of mixed line breaks, which a payload could not give back', () => {
    const text = file('Intro.\n\n```js\none\r\ntwo\n```\n\nAfter.');
    const at = text.indexOf('one') + 1;
    expect(attempt(text, at, at, 'x')).toMatchObject({ code: 'no-legal-placement' });
    expect(attempt(text, at, at, 'x').error).toContain('line breaks');
  });
});

describe('the open line under indented code (fix round 1)', () => {
  it('typed on, goes on the code: the block replaced is the one without the line', () => {
    const body = 'Intro.\n\n    let b = 2;\n    \n\nAfter.';
    const text = file(body);
    const at = text.indexOf('\n    \n') + 5;
    const result = attempt(text, at, at, 'c');
    expect(result.error).toBeUndefined();
    expect(bodyOf(result.after ?? '')).toContain('    let b = 2;\n    c\n<!--/m2bd-->\nAfter.');
    // Rejecting gives the file as it was before the line was opened.
    expect(back(result.after ?? '')).toBe('Intro.\n\n    let b = 2;\n\nAfter.');
    expect(parse(result.after ?? '').marks.map((m) => m.kind)).toEqual(['sub']);
  });
});

describe('a marker above indented code (fix round 2)', () => {
  it('refuses a key in the code, naming the person, and writes nothing', () => {
    const text = file('## Head<!--del k3x9 \\n\\n-->    indented one\n    indented two\n\nAfter.', {
      k3x9: 'bo',
    });
    const words =
      "Bo Chen's pending change is in this code block. Decide it first, or turn off Track Changes.";
    const end = text.indexOf('indented one') + 'indented one'.length;
    for (const [from, to, insert] of [
      [end, end, '\n'],
      [end, end, 'x'],
      [end + 1, end + 1, '\n'],
    ] as const) {
      expect(attempt(text, from, to, insert), insert).toMatchObject({
        error: words,
        code: 'no-legal-placement',
      });
    }
  });

  it('goes on in the block your own substitution holds', () => {
    const text = file('Intro.\n\n    one\n    two\n\nAfter.');
    const at = text.indexOf('one') + 3;
    const first = attempt(text, at, at, 'x').after ?? '';
    const again = first.indexOf('onex') + 4;
    const result = attempt(first, again, again, 'y');
    expect(result.error).toBeUndefined();
    expect(parse(result.after ?? '').marks).toHaveLength(1);
  });
});

describe('the exact start and end of display math (fix round 2)', () => {
  it('refuses text typed against the `$$`, writes no marker beside it, and leaves line breaks alone', () => {
    for (const body of ['Intro.\n\n$$\nx = 1\n$$\n\nAfter.', 'Intro.\n\n$$x = 1$$\n\nAfter.']) {
      const text = file(body);
      const start = text.indexOf('$$');
      const end = text.indexOf('\n\nAfter');
      for (const at of [start, end]) {
        const typed = attempt(text, at, at, 'x');
        expect(typed.error, `${body} ${at}`).toBeDefined();
        expect(typed.after, `${body} ${at}`).toBeUndefined();
        // A line break there is the text around the block, written as it is.
        const broken = attempt(text, at, at, '\n');
        expect(broken.error, `${body} ${at} break`).toBeUndefined();
        expect(parse(broken.after ?? '').marks).toEqual([]);
      }
    }
  });
});

describe('CRLF files (fix round 3)', () => {
  const cases: [string, string, string, string][] = [
    ['top, text under', 'Intro.\n\n```js\na\n```\nAfter.', '```\nAfter', '\n\n\n'],
    ['top, blank under', 'Intro.\n\n```js\na\n```\n\nAfter.', '```\n\nAfter', '\n\n'],
    ['quote, text under', '> ```js\n> a\n> ```\n> After.', '> ```\n> After', '\n>\n> \n>'],
    ['quote, blank under', '> ```js\n> a\n> ```\n>\n> After.', '> ```\n>\n> After', '\n>\n> '],
    [
      'list item, text under',
      '- item\n\n  ```js\n  a\n  ```\n  After.',
      '  ```\n  After',
      '\n\n  \n',
    ],
  ];

  it('writes Return at the end of a closing fence as it does with LF line breaks, and returns', () => {
    for (const [name, body, find, insert] of cases) {
      const done: string[] = [];
      for (const crlf of [false, true]) {
        const conv = (s: string) => (crlf ? s.replace(/\n/g, '\r\n') : s);
        const text = conv(file(body));
        const at = text.indexOf(conv(find)) + conv(find).indexOf(crlf ? '\r\n' : '\n');
        const result = attempt(text, at, at, conv(insert));
        expect(result.error, `${name} ${crlf}`).toBeUndefined();
        done.push((result.after ?? '').replace(/\r\n/g, '\n'));
        // A letter there is refused or written, and either way it returns.
        attempt(text, at, at, 'x');
      }
      expect(done[1], name).toBe(done[0]);
    }
  }, 20_000);

  it('returns for a letter, a line break and a selection at the edges of every kind of block', () => {
    for (const body of [
      'Intro.\n\n```js\na\n```\nAfter.',
      'Intro.\n\n    code\nAfter.',
      'Intro.\n\n$$\nx\n$$\nAfter.',
      'Intro.\n\n<pre>\nx\n</pre>\nAfter.',
      '> ```js\n> a\n> ```\n> After.',
      '- item\n\n  ```js\n  a\n  ```\n  After.',
    ]) {
      for (const eol of ['\n', '\r\n', 'mixed']) {
        const text = file(eol === 'mixed' ? body.replace('\n', '\r\n') : body.replace(/\n/g, eol));
        for (let at = 0; at <= text.length; at += 3) {
          for (const insert of ['x', '\n']) attempt(text, at, at, insert);
        }
      }
    }
  }, 60_000);
});

describe('Return at the edges of display math in a quote (fix round 3)', () => {
  it('writes a line break with the quote’s prefixes against the `$$`, and still refuses text', () => {
    for (const [body, prefix] of [
      ['> $$\n> x = 1\n> $$\n>\n> After.', '> '],
      ['> > $$\n> > x = 1\n> > $$\n> >\n> > After.', '> > '],
    ] as const) {
      const text = file(body);
      const end = text.indexOf('$$\n', text.indexOf('x = 1')) + 2;
      const bar = prefix.trimEnd();
      const broken = attempt(text, end, end, `\n${bar}\n${prefix}`);
      expect(broken.error, body).toBeUndefined();
      expect(parse(broken.after ?? '').marks, body).toEqual([]);
      expect(attempt(text, end, end, 'x').error, body).toBeDefined();
      // Before the opening `$$`, after the quote's markers.
      const start = text.indexOf('$$');
      expect(attempt(text, start, start, `\n${bar}\n${prefix}`).error, body).toBeUndefined();
    }
  });
});

describe('the marks that refuse a key in indented code (fix round 3)', () => {
  const type = (text: string, at: number) => attempt(text, at, at, 'x');
  it('are another person’s, in the block or at the blank line that opens it, never your own', () => {
    const own = file('## He<!--ins k3x9-->y<!--/k3x9-->ad\n\n    one\n    two\n\nAfter.', {
      k3x9: 'ada',
    });
    expect(type(own, own.indexOf('one') + 1).error).toBeUndefined();
    // Bo's insertion far up in the paragraph above is not at the blank line either.
    const far = file('Para <!--ins k3x9-->y<!--/k3x9--> more words here.\n\n    one\n    two', {
      k3x9: 'bo',
    });
    expect(type(far, far.indexOf('one') + 1).error).toBeUndefined();
    // Bo's deletion of the break is at it.
    const at = file('Para<!--del k3x9 \\n\\n-->\n\n    one\n    two', { k3x9: 'bo' });
    expect(type(at, at.indexOf('one') + 1).error).toContain("Bo Chen's pending change");
    const own2 = file('Para<!--del k3x9 \\n\\n-->\n\n    one\n    two', { k3x9: 'ada' });
    expect(type(own2, own2.indexOf('one') + 1).error).toBeUndefined();
  });

  it('do not refuse a letter after a deletion that joins a line to a paragraph', () => {
    for (const body of [
      'Para<!--del k3x9 \\n-->    more text.',
      '- item<!--del k3x9 \\n-->    more',
    ]) {
      const text = file(body, { k3x9: 'bo' });
      expect(type(text, text.indexOf('more') + 1).error, body).toBeUndefined();
    }
  });
});
