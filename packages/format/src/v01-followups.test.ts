// The v0.1 follow-ups of #11 and #17 (issue #1024), each as the case that was not reproduced.
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { addComment } from './comments.ts';
import { rejectAll } from './decide.ts';
import { applyLedgerOp, ledgerMapOf } from './ledger-map.ts';
import { mergeLedgers } from './ledger-merge.ts';
import { serializeLedger } from './ledger-write.ts';
import { parse } from './parse.ts';
import { ada, context, file } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import { newestView, originalView } from './views.ts';

const ids = (...more: string[]) => context(ada, ['k3x9', 'w8nn', 'c8d2', ...more]);
const bodyOf = (text: string) => text.slice(0, text.indexOf('<!-- redlines'));

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
  it('writes a comment across two blocks as one segment', () => {
    const body = 'First para.\n\nSecond para.\n';
    const from = body.indexOf('para');
    const to = body.indexOf('Second') + 3;
    const written = applyChanges(body, addComment(body, { from, to }, 'x', ids()).changes);
    expect(parse(written).marks.map((mark) => mark.segments.length)).toEqual([1]);
    expect(newestView(written).text).toBe(body);
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

  it('gives back the text of a break and its own fusing, both tracked', () => {
    const body = 'Hello world\n';
    const at = body.indexOf(' world');
    const split = applyChanges(body, trackedEdit(body, { from: at, to: at, insert: '\n' }, ids()));
    const view = newestView(split);
    const from = view.map.toSource(view.text.indexOf('\n'));
    const fused = applyChanges(
      split,
      trackedEdit(split, { from, to: from + 1, insert: '' }, ids()),
    );
    expect(originalView(fused).text).toBe(body);
    expect(rejected(fused)).toBe(body);
    expect(bodyOf(fused).length).toBeGreaterThan(0);
  });
});
