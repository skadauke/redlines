// The v0.1 follow-ups of #11 and #17 (issue #1024), each as the case that was not reproduced.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment, deleteThread } from './comments.ts';
import { acceptAll, reject, rejectAll } from './decide.ts';
import { applyLedgerOp, ledgerMapOf } from './ledger-map.ts';
import { mergeLedgers } from './ledger-merge.ts';
import { serializeLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { ada, bo, context, file } from './test-helpers.ts';
import { blockRunAt, moveBlockEdits, neighbourGap } from './block-move.ts';
import { trackedEdit } from './track.ts';
import { newestView, originalView } from './views.ts';

const ids = (...more: string[]) => context(ada, ['k3x9', 'w8nn', 'c8d2', ...more]);

/** `text` with every pending change rejected. */
const rejected = (text: string) => applyChanges(text, rejectAll(text));

describe("#11: the ledger's YAML (format §5.5)", () => {
  const body = 'Hello world.\n';
  const commented = (text: string) =>
    applyChanges(body, addComment(body, { from: 0, to: 5 }, text, ids()).changes);

  it("writes a comment's quote as a literal block, like its text", () => {
    expect(commented('x')).toContain('    quote: |-\n      Hello\n    text: |-\n      x\n');
  });

  it('quotes a string with a colon at its end, which the plain rule leaves out', () => {
    const marks = { k3x9: { by: 'ada', at: '2026-10-13T22:30Z', note: 'Why:' } };
    const ledger = { version: 1 as const, people: [], marks, comments: [] };
    const written = serializeLedger(ledger);
    expect(written).toContain('note: "Why:"');
    const read = parse(`Hi<!--ins k3x9-->x<!--/k3x9-->\n\n${written}`);
    expect(read.ledger.marks['k3x9']?.note).toBe('Why:');
  });

  it.each(['\\', 'a\n\\\nb', '\\\n\n\\'])(
    'reads a comment whose text has a line of only a backslash back as it was: %j',
    (text) => {
      const written = commented(text);
      expect(parse(written).ledger.comments[0]?.text).toBe(text);
    },
  );

  it('keeps a key with a line break in it on one line, and reads it back', () => {
    const text = file('Hello').replace('version: 1', 'version: 1\n"a\\nb": 1');
    const written = serializeLedger(parse(text).ledger);
    expect(written).toContain('"a\\nb": "1"');
    expect(parse(`Hello\n\n${written}`).ledger.extra).toEqual({ 'a\nb': '1' });
  });

  it('reads a version that is lower or not a number with a warning, and writes version 1', () => {
    for (const bad of ['0', 'abc']) {
      const read = parse(file('Hello').replace('version: 1', `version: ${bad}`));
      expect(read.warnings.map((w) => w.message)).toEqual([`Unsupported ledger version ${bad}`]);
      expect(serializeLedger(read.ledger)).toContain('\nversion: 1\n');
    }
  });

  it("never downgrades a later version's number, keeps its fields, and warns once", () => {
    const text = file('Hello')
      .replace('version: 1', 'version: 7\nnew-setting: on')
      .replace('  name:', '  shoe: 9\n  name:');
    const read = parse(text);
    expect(read.warnings).toHaveLength(1);
    expect(read.warnings[0]?.message).toContain('version 7');
    expect(read.ledger.extra).toMatchObject({ version: '7', 'new-setting': 'on' });
    const written = serializeLedger(read.ledger);
    expect(written).toContain('\nversion: 7\n');
    expect(written).not.toContain('version: 1');
    expect(written.match(/^version:/gm)).toHaveLength(1);
    expect(written).toContain('new-setting: "on"');
    // A second read of what was written warns the same once, and writes the same again.
    const again = parse(`Hello\n\n${written}`);
    expect(again.warnings).toHaveLength(1);
    expect(serializeLedger(again.ledger)).toBe(written);
  });

  it('keeps the higher version of two sides, as numbers, and lets a version be set as a field', () => {
    const side = (version: string) =>
      ledgerMapOf({ version: 1, people: [], marks: {}, comments: [], extra: { version } });
    const merged = mergeLedgers(side('2'), side('9'), side('10'));
    expect(merged.ledger.extra.get('version')).toBe('10');
    const set = applyLedgerOp(side('2'), { op: 'setField', name: 'version', value: '3' });
    expect(set.extra.get('version')).toBe('3');
    // A version that is not a whole number above 1 is never written.
    const odd = ledgerMapOf({
      version: 1,
      people: [],
      marks: {},
      comments: [],
      extra: { version: 'x' },
    });
    expect(
      serializeLedger({ version: 1, people: [], marks: {}, comments: [], extra: { version: 'x' } }),
    ).toContain('\nversion: 1\n');
    expect(odd.extra.get('version')).toBe('x');
  });

  it.each([
    ['a list item', '- item\n  ```\n  code\n', 'item'],
    ['a quote', '> quote\n> ```\n> code\n', 'quote'],
  ])('finds the ledger after a fence that %s leaves open', (_, body, word) => {
    const at = body.indexOf(word);
    const written = applyChanges(
      body,
      addComment(body, { from: at, to: at + word.length }, 'x', ids()).changes,
    );
    expect(parse(written).ledgerRange).not.toBeNull();
    expect(parse(written).warnings).toEqual([]);
    expect(newestView(written).text).toBe(body);
  });

  it('keeps a fence line indented 4 spaces as code: edits in the block are not refused', () => {
    const body = 'Hello\n\n```\ncode\n    ```\nstill word\n```\n\nafter\n';
    for (const word of ['code', 'still']) {
      const at = body.indexOf(word);
      const written = applyChanges(
        body,
        trackedEdit(body, { from: at, to: at, insert: 'Z' }, ids()),
      );
      expect(originalView(written).text, word).toBe(body);
      expect(rejected(written), word).toBe(body);
    }
  });

  it("maps the start of a restored stretch to either side of the deleted text's marker", () => {
    const text = file('Hello <!--del k3x9 old -->world', { k3x9: 'ada' });
    const view = originalView(text);
    expect(view.text.startsWith('Hello old world')).toBe(true);
    expect(view.map.toSource(6, -1)).toBe(6);
    expect(view.map.toSource(6, 1)).toBe(text.indexOf('world'));
    expect(view.map.fromSource(6)).toBe(6);
    expect(view.map.fromSource(text.indexOf('world'))).toBe(10);
  });
});

describe('#17: line breaks, blocks and rejecting all', () => {
  // Format §4: a range that spans blocks is written as one segment, its opener in the first block
  // and its closer in the last, so that moves, deletions and decisions keep it whole. A reader also
  // takes one segment per block with the same id, which other tools may write.
  const across = (body: string, first: string, last: string) => {
    const from = body.indexOf(first);
    const to = body.indexOf(last) + last.length;
    return applyChanges(body, addComment(body, { from, to }, 'x', ids()).changes);
  };
  const THREE = 'One two.\n\nThree four.\n\nFive six.\n';

  it.each([
    ['paragraphs', THREE, 'two', 'Five'],
    ['list items', '- one\n- two\n- three\n', 'one', 'three'],
    ['quote paragraphs', '> one\n>\n> two\n', 'one', 'two'],
  ])('writes a comment across %s as one segment with one id', (_, body, a, b) => {
    const written = across(body, a, b);
    const read = parse(written);
    expect(read.warnings).toEqual([]);
    expect(read.marks.map((mark) => [mark.id, mark.segments.length])).toEqual([['k3x9', 1]]);
    expect(newestView(written).text).toBe(body);
  });

  it('keeps the comment whole when the block in the middle is deleted, tracked', () => {
    const written = across(THREE, 'two', 'Five');
    const from = written.indexOf('Three four.');
    const deleted = applyChanges(
      written,
      trackedEdit(
        written,
        { from, to: from + 'Three four.'.length, insert: '' },
        context(bo, ['m3xb', 'p3xb']),
      ),
    );
    expect(parse(deleted).marks.map((mark) => [mark.id, mark.kind])).toEqual(
      expect.arrayContaining([['k3x9', 'cmt']]),
    );
    expect(parse(deleted).marks.find((mark) => mark.kind === 'sub')).toBeUndefined();
    for (const decide of [acceptAll, rejectAll]) {
      const after = applyChanges(deleted, decide(deleted));
      const comment = parse(after).marks.find((mark) => mark.id === 'k3x9');
      expect(comment?.segments.at(-1)?.close, decide.name).toBeDefined();
      expect(
        after.slice(comment?.segments[0]?.content.from, comment?.segments[0]?.content.to),
      ).toContain('two.');
    }
    expect(newestView(rejected(deleted)).text).toBe(THREE);
  });

  it.each([
    ['up', true],
    ['down', false],
  ])('keeps the comment whole when the middle block is moved %s, untracked', (_, up) => {
    const written = across(THREE, 'two', 'Five');
    const view = newestView(written);
    const from = view.map.toSource(view.text.indexOf('Three four.'), 1);
    const run = blockRunAt(written, { from, to: from });
    const gap = run && neighbourGap(run, up);
    const plan = run && gap && moveBlockEdits(written, run, gap);
    expect(plan).toBeTruthy();
    const after = applyChanges(written, plan ? plan.edits : []);
    expect(parse(after).warnings).toEqual([]);
    const comment = parse(after).marks.find((mark) => mark.id === 'k3x9');
    expect(comment?.segments.length).toBe(1);
    expect(comment?.segments[0]?.close).toBeDefined();
    expect(newestView(after).text).toBe(
      up ? 'Three four.\n\nOne two.\n\nFive six.\n' : 'One two.\n\nFive six.\n\nThree four.\n',
    );
  });

  it('removes the one segment when the thread is deleted, and keeps the text', () => {
    const written = across(THREE, 'two', 'Five');
    const removed = applyChanges(written, deleteThread(written, 'k3x9'));
    expect(parse(removed).marks).toEqual([]);
    expect(newestView(removed).text).toBe(THREE);
    expect(removed).not.toContain('cmt');
  });

  it.each(['\n', '\r\n'])('gives a payload its line breaks back alike, in a file of %j', (eol) => {
    const body = `One\ntwo${eol}three${eol}`;
    const from = body.indexOf('two');
    const written = applyChanges(
      body,
      trackedEdit(body, { from, to: from + 3 + eol.length + 5, insert: '' }, ids()),
    );
    expect(parse(written).marks).toHaveLength(1);
    expect(originalView(written).text).toBe(body);
    expect(rejected(written)).toBe(body);
  });

  it.each(['\n', '\r\n'])('gives the file back when its last line break goes, in %j', (eol) => {
    const body = `abc${eol}def${eol}`;
    const first = applyChanges(body, trackedEdit(body, { from: 0, to: 0, insert: 'X' }, ids()));
    const edits = [
      { from: first.length, to: first.length, insert: 'Y' },
      { from: first.length - eol.length, to: first.length, insert: '' },
    ];
    for (const edit of edits) {
      const written = applyChanges(first, trackedEdit(first, edit, ids()));
      expect(originalView(written).text).toBe(body);
      expect(rejected(written)).toBe(body);
    }
  });

  it.each([
    ['Enter at the start of a tight list item', '- one\n- two\n', 'two', '\n'],
    ['Enter at the start of a line of a fenced code block', '```\ncode\n```\n', 'code', '\n'],
    ['Enter and then a line break again', 'Hello world\n', ' world', '\n'],
  ])('writes %s as a change that rejects whole, not a refusal', (_, body, at, insert) => {
    const from = body.indexOf(at);
    const written = applyChanges(body, trackedEdit(body, { from, to: from, insert }, ids()));
    expect(parse(written).marks).toHaveLength(1);
    expect(rejected(written)).toBe(body);
  });

  it('cancels your own split when you fuse it again: no change is left, and no new id', () => {
    const body = 'Hello world\n';
    const at = body.indexOf(' world');
    const split = applyChanges(body, trackedEdit(body, { from: at, to: at, insert: '\n' }, ids()));
    const view = newestView(split);
    const from = view.map.toSource(view.text.indexOf('\n'));
    const fused = applyChanges(
      split,
      trackedEdit(split, { from, to: from + 1, insert: '' }, ids()),
    );
    expect(fused).toBe(body);
  });

  it('types your own split again with the text that comes right after its break (format §3.4)', () => {
    // "Your own split is typed again with the text": the split and the typed text get ids of their
    // own, and the break and the text are decided together, in every order.
    const body = 'Hello world\n';
    const at = body.indexOf(' world');
    const split = applyChanges(body, trackedEdit(body, { from: at, to: at, insert: '\n' }, ids()));
    const view = newestView(split);
    const after = view.map.toSource(view.text.indexOf('\n') + 1, 1);
    const typed = applyChanges(
      split,
      trackedEdit(split, { from: after, to: after, insert: 'X' }, context(ada, ['p3xb', 'q3xb'])),
    );
    expect(typed.slice(0, typed.indexOf('<!-- redlines'))).toBe(
      'Hello<!--ins p3xb--><!--split q3xb-->\nX<!--/p3xb--> world\n\n',
    );
    expect(parse(typed).marks.map((mark) => [mark.id, mark.kind])).toEqual([
      ['p3xb', 'ins'],
      ['q3xb', 'split'],
    ]);
    expect(newestView(typed).text).toBe('Hello\nX world\n');
    expect(applyChanges(typed, acceptAll(typed))).toBe(newestView(typed).text);
    expect(originalView(typed).text).toBe(body);
    expect(rejected(typed)).toBe(body);
  });

  it("tracks another person's fusing of a split as a deletion under their own id", () => {
    const body = 'Hello world\n';
    const at = body.indexOf(' world');
    const split = applyChanges(body, trackedEdit(body, { from: at, to: at, insert: '\n' }, ids()));
    const view = newestView(split);
    const from = view.map.toSource(view.text.indexOf('\n'));
    const fused = applyChanges(
      split,
      trackedEdit(split, { from, to: from + 1, insert: '' }, context(bo, ['m3xb', 'p3xb'])),
    );
    expect(
      parse(fused)
        .marks.map((mark) => mark.id)
        .sort(),
    ).toEqual(['k3x9', 'm3xb']);
    expect(originalView(fused).text).toBe(body);
    expect(rejected(fused)).toBe(body);
    expect(newestView(fused).text).toBe('Hello world\n');
  });

  it.each([
    ['a replacement from inside an HTML block into the text after it', 'raw', 'Outro', 'New'],
    ['a replacement that starts above it', 'Intro', 'raw', 'New\n\nthing'],
    ['a replacement of the block alone', '<div>', '</div>', 'X'],
    ['a replacement of everything', 'Intro', 'Outro', 'Z'],
  ])('keeps every line break when %s is rejected or accepted', (_, first, last, insert) => {
    const html = 'Intro\n\n<div>\nraw\n</div>\n\nOutro\n';
    const from = html.indexOf(first);
    const to = html.indexOf(last) + last.length;
    const written = applyChanges(html, trackedEdit(html, { from, to, insert }, ids()));
    expect(rejected(written)).toBe(html);
    expect(rejected(written)).toBe(originalView(written).text);
    expect(applyChanges(written, acceptAll(written))).toBe(newestView(written).text);
    const [mark] = parse(written).marks;
    expect(applyChanges(written, reject(written, mark?.id ?? ''))).toBe(html);
  });
});
