import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodePayload } from './payload.ts';
import { parse } from './parse.ts';
import { newestView, originalView, reviewView, threadEntries } from './views.ts';

const fixture = readFileSync(new URL('./fixtures/launch-plan.md', import.meta.url), 'utf8');

const LEDGER_HEAD = '<!-- redlines\nversion: 1\npeople:\n  ada: {name: Ada}\nmarks:\n';

/** A file whose ledger gives every id in `ids` to Ada, plus the YAML in `more`. */
function file(body: string, ids: string[], more = ''): string {
  const entries = ids.map((id) => `  ${id}: {by: ada, at: 2026-10-13T22:30Z}\n`).join('');
  return `${body}\n\n${LEDGER_HEAD}${entries}${more}-->\n`;
}

describe('newestView', () => {
  it('accepts every change and drops the ledger', () => {
    expect(newestView(fixture).text).toBe(
      '# Launch plan\n\nWe will ship the new importer in April, after the security review.\n',
    );
  });

  it('keeps a plain file as it is', () => {
    const plain = '# Notes\r\n\r\nSee <!-- TODO --> here.\r\n';
    const view = newestView(plain);
    expect(view.text).toBe(plain);
    expect(view.map.toSource(5)).toBe(5);
    expect(view.map.fromSource(5)).toBe(5);
  });

  it('keeps the content of marks it has no decisions for, and hides their markers', () => {
    const text = file(
      'a <!--fmt m2bd +mark-->==b==<!--/m2bd--> c\n\nd <!--hl h4kz-->e<!--/h4kz--> | <!--ins k3x9 row--> f |',
      ['m2bd', 'h4kz', 'k3x9'],
    );
    expect(newestView(text).text).toBe('a ==b== c\n\nd e |  f |\n');
    expect(originalView(text).text).toBe('a ==b== c\n\nd e |  f |\n');
  });

  it('takes the break out of the original view, where a split put it (format §3.4)', () => {
    const cases: [string, string, string][] = [
      ['First.<!--split s3vb-->\n\nSecond.', 'First.\n\nSecond.\n', 'First.Second.\n'],
      ['- one<!--split s3vb-->\n- two', '- one\n- two\n', '- onetwo\n'],
      ['> one<!--split s3vb-->\n>\n> two', '> one\n>\n> two\n', '> onetwo\n'],
      ['A<!--split s3vb-->\n\n## Heading', 'A\n\n## Heading\n', 'AHeading\n'],
      ['one<!--split s3vb-->\n two', 'one\n two\n', 'one two\n'],
    ];
    for (const [body, newest, original] of cases) {
      const text = file(body, ['s3vb']);
      expect(newestView(text).text, body).toBe(newest);
      expect(originalView(text).text, body).toBe(original);
    }
  });

  it('takes the break out with the file’s line breaks', () => {
    const text = file('One<!--split s3vb-->\n\nTwo', ['s3vb']).replaceAll('\n', '\r\n');
    expect(originalView(text).text).toBe('OneTwo\r\n');
  });

  it('leaves what looks like a marker in code alone', () => {
    const text =
      'Use `<!--ins k3x9-->x<!--/k3x9-->` like this:\n\n```\n<!--del w8nn gone-->\n```\n';
    expect(newestView(text).text).toBe(text);
    expect(originalView(text).text).toBe(text);
    expect(reviewView(text)).toBe(text);
  });

  it('leaves a comment anchor without a thread in the text', () => {
    const text = 'a <!--cmt c8d2-->b<!--/c8d2-->\n';
    expect(newestView(text).text).toBe(text);
    expect(originalView(text).text).toBe(text);
  });

  it('maps positions', () => {
    const newest = newestView(fixture);
    for (let i = 0; i < newest.text.length; i++) {
      expect(newest.text[i]).toBe(fixture[newest.map.toSource(i)]);
      expect(newest.map.fromSource(newest.map.toSource(i))).toBe(i);
    }
    expect(newest.map.toSource(newest.text.length)).toBe(fixture.length);
    expect(newest.map.fromSource(fixture.length)).toBe(newest.text.length);
  });

  it('maps positions with assoc', () => {
    const newest = newestView(fixture);
    const at = newest.text.indexOf('importer');
    const closer = fixture.indexOf('<!--/k3x9-->');
    expect(newest.map.toSource(at, -1)).toBe(closer);
    expect(newest.map.toSource(at, 1)).toBe(fixture.indexOf('importer'));
    expect(newest.map.toSource(at)).toBe(fixture.indexOf('importer'));
  });

  it('maps a position inside a marker to the visible text before it', () => {
    const newest = newestView(fixture);
    const closer = fixture.indexOf('<!--/k3x9-->');
    const at = newest.text.indexOf('importer');
    expect(newest.map.fromSource(closer)).toBe(at);
    expect(newest.map.fromSource(closer + 4)).toBe(at);
    expect(newest.map.fromSource(closer + '<!--/k3x9-->'.length)).toBe(at);
  });

  it('maps across adjacent hidden markers as one stretch', () => {
    const text = file('a<!--ins k3x9-->b<!--/k3x9--><!--ins w8nn-->c<!--/w8nn-->d', [
      'k3x9',
      'w8nn',
    ]);
    const newest = newestView(text);
    expect(newest.text).toBe('abcd\n');
    expect(newest.map.toSource(2, -1)).toBe(text.indexOf('<!--/k3x9-->'));
    expect(newest.map.toSource(2, 1)).toBe(text.indexOf('c<!--/w8nn-->'));
  });

  it('counts UTF-16 offsets', () => {
    const text = file('😀 <!--ins k3x9-->x<!--/k3x9--> é', ['k3x9']);
    const newest = newestView(text);
    expect(newest.text).toBe('😀 x é\n');
    expect(newest.map.toSource(3)).toBe(text.indexOf('-->x<') + 3);
    expect(newest.map.fromSource(text.indexOf('é'))).toBe(newest.text.indexOf('é'));
  });
});

describe('originalView', () => {
  it('shows the text before formatting, and newestView the text after', () => {
    const inline = file(
      'Plain <!--fmt m2bd +bold-->**text**<!--/m2bd--> and <!--fmt n8fx -italic-->more<!--/n8fx--> here.',
      ['m2bd', 'n8fx'],
    );
    expect(originalView(inline).text).toBe('Plain text and *more* here.\n');
    expect(newestView(inline).text).toBe('Plain **text** and more here.\n');
    const heading = file('<!--fmt q2hw was=p-->\n\n## A heading<!--/q2hw-->', ['q2hw']);
    expect(originalView(heading).text).toBe('A heading\n');
    expect(newestView(heading).text).toBe('## A heading\n');
    // The old syntax as it was written, the old indentation, and the old box.
    const numbered = file('- <!--fmt q2hw was=ol=3.\\x20-->\n  An item<!--/q2hw-->', ['q2hw']);
    expect(originalView(numbered).text).toBe('3. An item\n');
    const indented = file('- a\n  - <!--fmt q2hw was=indent=0-->\n    b<!--/q2hw-->', ['q2hw']);
    expect(originalView(indented).text).toBe('- a\n- b\n');
    const box = file('- [x] Buy milk<!--fmt q2hw +check-->', ['q2hw']);
    expect(originalView(box).text).toBe('- [ ] Buy milk\n');
    expect(newestView(box).text).toBe('- [x] Buy milk\n');
  });

  it('brings deleted text back unformatted, and drops a format inside an insertion', () => {
    const text = file(
      'Some <!--fmt m2bd +bold-->**big <!--del k3x9 old -->deal**<!--/m2bd--> and <!--ins n8fx-->new <!--fmt p7qd +italic-->*word*<!--/p7qd--> <!--/n8fx-->text.',
      ['m2bd', 'k3x9', 'n8fx', 'p7qd'],
    );
    expect(originalView(text).text).toBe('Some big old deal and text.\n');
    const view = originalView(text);
    // Positions map through the syntax it takes away.
    expect(view.text.slice(view.map.fromSource(text.indexOf('deal')))).toMatch(/^deal and/);
  });

  it('rejects every change and drops the ledger', () => {
    expect(originalView(fixture).text).toBe(
      '# Launch plan\n\nWe will ship the importer in March, after the security review. The old exporter stays as it is.\n',
    );
  });

  it('drops everything inside an insertion, including other people’s deletions', () => {
    const text = file('The <!--ins k3x9-->shiny <!--del b4rt very -->new <!--/k3x9-->importer', [
      'k3x9',
      'b4rt',
    ]);
    expect(originalView(text).text).toBe('The importer\n');
    expect(newestView(text).text).toBe('The shiny new importer\n');
  });

  it('restores the old text of a substitution, whatever sits inside the new text', () => {
    const text = file('In <!--sub p7qd March-->April <!--del b4rt early -->or May<!--/p7qd-->.', [
      'p7qd',
      'b4rt',
    ]);
    expect(originalView(text).text).toBe('In March.\n');
    expect(newestView(text).text).toBe('In April or May.\n');
  });

  it('joins a deletion split around another mark', () => {
    const text = file(
      'Ship <!--del b4rt the old --><!--del c2zf legacy --><!--del b4rt exporter -->now.',
      ['b4rt', 'c2zf'],
    );
    expect(originalView(text).text).toBe('Ship the old legacy exporter now.\n');
    expect(newestView(text).text).toBe('Ship now.\n');
  });

  it('decodes payload escapes', () => {
    const text = file('a<!--del k3x9 x\\ny-\\-z\\x60-->b', ['k3x9']);
    expect(originalView(text).text).toBe('ax\ny--z`b\n');
  });

  it('restores deleted text with emoji, combining characters and line breaks', () => {
    const deleted = 'caf\u00e9 e\u0301 😀\r\n-- `x` | {{y}}\\';
    const text = file(`a <!--del k3x9 ${encodePayload(deleted)}-->b`, ['k3x9']);
    expect(originalView(text).text).toBe(`a ${deleted.replace('\r\n', '\n')}b\n`);
    expect(reviewView(text)).toContain(`{--${deleted.replace('\r\n', '\n')}--}[k3x9 ada]b`);
    const newest = newestView(text);
    expect(newest.text).toBe('a b\n');
    expect(newest.map.toSource(2)).toBe(text.indexOf('b\n\n'));
  });

  it('maps positions around unchanged text', () => {
    const original = originalView(fixture);
    for (const word of ['importer', 'security', 'Launch']) {
      const at = original.text.indexOf(word);
      expect(original.map.toSource(at)).toBe(fixture.indexOf(word));
      expect(original.map.fromSource(fixture.indexOf(word))).toBe(at);
    }
  });

  it('maps restored text as one stretch', () => {
    const text = file('Keep <!--del k3x9 old -->tail', ['k3x9']);
    const original = originalView(text);
    expect(original.text).toBe('Keep old tail\n');
    const marker = text.indexOf('<!--del');
    const markerEnd = text.indexOf('tail');
    // A position in the restored text is before the marker or after it.
    expect(original.map.toSource(7, -1)).toBe(marker);
    expect(original.map.toSource(7, 1)).toBe(markerEnd);
    expect(original.map.fromSource(marker)).toBe(5);
    expect(original.map.fromSource(markerEnd)).toBe(9);
    expect(original.map.toSource(9)).toBe(markerEnd);
  });
});

describe('reviewView', () => {
  it('shows pending changes in CriticMarkup, each with its id and author', () => {
    expect(reviewView(fixture)).toBe(
      '# Launch plan\n\nWe will ship the {++new ++}[k3x9 ada]importer in {~~March~>April~~}[p7qd claude-ada], after the {==security review==}{>>[c8d2 bo] Who signs off on the security review?<<}.{-- The old exporter stays as it is.--}[w2rf bo]\n',
    );
  });

  it('shows highlights, point comments and nested changes', () => {
    const text = file(
      'A <!--hl h4kz-->b<!--/h4kz--> c<!--cmt c9qf--> d <!--ins k3x9-->e <!--del b4rt f -->g<!--/k3x9-->',
      ['h4kz', 'k3x9', 'b4rt'],
      'comments:\n  c9qf:\n    by: ada\n    at: 2026-10-13T22:30Z\n    text: |-\n      Why?\n',
    );
    expect(reviewView(text)).toBe(
      'A {==b==}[h4kz ada] c{>>[c9qf ada] Why?<<} d {++e {--f --}[b4rt ada]g++}[k3x9 ada]\n',
    );
  });

  it('shows each segment of a split mark', () => {
    const text = file(
      'The <!--ins k3x9-->shiny <!--/k3x9--><!--ins w8nn-->and fast <!--/w8nn--><!--ins k3x9-->importer<!--/k3x9-->',
      ['k3x9', 'w8nn'],
    );
    expect(reviewView(text)).toBe(
      'The {++shiny ++}[k3x9 ada]{++and fast ++}[w8nn ada]{++importer++}[k3x9 ada]\n',
    );
  });

  it('shows the comment of a range in several segments once, after the last', () => {
    const text = file(
      '<!--cmt c8d2-->One<!--/c8d2--> and <!--cmt c8d2-->two<!--/c8d2-->',
      [],
      'comments:\n  c8d2:\n    by: ada\n    at: 2026-10-13T22:30Z\n    text: |-\n      Why?\n',
    );
    expect(reviewView(text)).toBe('{==One==} and {==two==}{>>[c8d2 ada] Why?<<}\n');
  });

  it('hides the markers of marks it has no notation for', () => {
    const text = file('a **b** c<!--split s3vb-->', ['s3vb']);
    expect(reviewView(text)).toBe('a **b** c\n');
  });

  it('shows a format change it can not decide as its text, and nested ones in one note', () => {
    const kept = file('a <!--fmt m2bd +mark-->==b==<!--/m2bd--> c', ['m2bd']);
    expect(reviewView(kept)).toBe('a ==b== c\n');
    const nested = file(
      'a <!--fmt m2bd +bold--><!--fmt n8fx +italic-->***b***<!--/n8fx--><!--/m2bd--> c',
      ['m2bd', 'n8fx'],
    );
    expect(reviewView(nested)).toBe(
      'a {==***b***==}{>>[m2bd ada] Formatted: +bold; [n8fx ada] Formatted: +italic<<} c\n',
    );
  });

  it('names format changes, by the operations that rejecting undoes', () => {
    const text = file(
      'a <!--fmt m2bd +bold-->**b**<!--/m2bd--> c\n\n<!--fmt q2hw was=p-->\n\n## Head<!--/q2hw-->\n\n- [x] Buy<!--fmt n8fx +check-->',
      ['m2bd', 'q2hw', 'n8fx'],
    );
    expect(reviewView(text)).toBe(
      'a {==**b**==}{>>[m2bd ada] Formatted: +bold<<} c\n\n## Head{>>[q2hw ada] Formatted: was=p<<}\n\n- [x] Buy{>>[n8fx ada] Formatted: +check<<}\n',
    );
  });

  it('shows an unknown author for a mark without a ledger entry', () => {
    expect(reviewView('a <!--ins k3x9-->b<!--/k3x9-->\n')).toBe('a {++b++}[k3x9 unknown]\n');
  });

  it('shows replies', () => {
    const text = file(
      '<!--cmt c8d2-->One<!--/c8d2--> and <!--cmt c9qf-->two<!--/c9qf--> and three<!--cmt d2bc--> end',
      [],
      'comments:\n  c8d2:\n    by: ada\n    at: 2026-10-13T22:30Z\n    replies:\n      - id: r5tw\n        by: bo\n        at: 2026-10-14T09:00Z\n        text: |-\n          Because.\n      - id: r6xy\n        by: ada\n        at: 2026-10-14T10:00Z\n        text: |-\n          Ok.\n    text: |-\n      Why?\n  c9qf:\n    by: ada\n    at: 2026-10-13T22:30Z\n    text: |-\n      Alone.\n  d2bc:\n    by: bo\n    at: 2026-10-13T22:30Z\n    replies:\n      - id: r7za\n        by: ada\n        at: 2026-10-14T10:00Z\n        text: |-\n          Yes.\n    text: |-\n      Here?\n',
    );
    expect(reviewView(text)).toBe(
      '{==One==}{>>[c8d2 ada] Why?<<}{>>[c8d2 bo] Because.<<}{>>[c8d2 ada] Ok.<<} and {==two==}{>>[c9qf ada] Alone.<<} and three{>>[d2bc bo] Here?<<}{>>[d2bc ada] Yes.<<} end\n',
    );
  });
});

describe('threadEntries', () => {
  const text = file(
    '<!--cmt c8d2-->One<!--/c8d2-->',
    [],
    'comments:\n  c8d2:\n    by: ada\n    at: 2026-10-13T22:30Z\n    replies:\n      - id: r5tw\n        by: bo\n        at: 2026-10-14T09:00Z\n        text: |-\n          Because.\n    text: |-\n      Why?\n',
  );

  it('lists the comment, then its replies', () => {
    expect(threadEntries(parse(text), 'c8d2')).toEqual([
      { by: 'ada', at: '2026-10-13T22:30Z', text: 'Why?' },
      { by: 'bo', at: '2026-10-14T09:00Z', text: 'Because.' },
    ]);
  });

  it('is empty for an id that is no thread', () => {
    expect(threadEntries(parse(text), 'zzzz')).toEqual([]);
  });
});
