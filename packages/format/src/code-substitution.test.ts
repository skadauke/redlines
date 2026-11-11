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
