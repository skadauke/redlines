import { describe, expect, it } from 'vitest';
import { addComment, applyChanges, parse, reply } from '@redlines/format';
import { fitReply, foldComment, joinReply } from './fold.ts';

describe('foldComment', () => {
  it('shows the first paragraph and folds the rest', () => {
    expect(foldComment('Fixed.\n\nCRLF is handled in importer.ts:42.\n\nAlso §3.')).toEqual({
      shown: 'Fixed.',
      more: 'CRLF is handled in importer.ts:42.\n\nAlso §3.',
    });
  });

  it('has nothing to fold in one paragraph', () => {
    expect(foldComment('Fixed.\nDone.')).toEqual({ shown: 'Fixed.\nDone.', more: null });
  });

  it('takes a blank line with spaces, and CRLF, as the break', () => {
    expect(foldComment('One.\r\n  \r\nTwo.')).toEqual({ shown: 'One.', more: 'Two.' });
  });

  it("round-trips the format's blank-line encoding through a real reply", () => {
    const person = { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' };
    const time = '2026-11-05T10:00Z';
    const plain = '# Plan\n\nShip it.\n';
    const start = plain.indexOf('Ship');
    const added = addComment(plain, { from: start, to: start + 4 }, 'When?', {
      author: { handle: 'ada', name: 'Ada' },
      time,
    });
    const seeded = applyChanges(plain, added.changes);
    const body = joinReply('Shipped Friday.', 'Details:\n\nSee importer.ts:42.');
    const changes = reply(seeded, added.id, body, { author: person, time });
    const written = applyChanges(seeded, changes);
    expect(written).toMatch(/\n +\\\n/);
    const stored = parse(written).ledger.comments[0]?.replies[0]?.text ?? '';
    expect(stored).toBe(body);
    expect(foldComment(stored)).toEqual({
      shown: 'Shipped Friday.',
      more: 'Details:\n\nSee importer.ts:42.',
    });
  });
});

describe('joinReply', () => {
  it('puts details after a blank line', () => {
    expect(joinReply('Fixed.', 'More.')).toBe('Fixed.\n\nMore.');
  });
  it('is the text alone without details', () => {
    expect(joinReply('Fixed.')).toBe('Fixed.');
    expect(joinReply('Fixed.', '  ')).toBe('Fixed.');
  });
});

describe('fitReply', () => {
  it('leaves a message that fits', () => {
    expect(fitReply('  Done.  ')).toEqual({ text: 'Done.' });
  });

  it('keeps a short first paragraph and puts the rest in details', () => {
    expect(fitReply('Done.\n\nI changed three things.')).toEqual({
      text: 'Done.',
      details: 'I changed three things.',
    });
  });

  it('cuts 500 characters at a word within 200, with the rest as details', () => {
    const message = Array.from({ length: 100 }, (_, i) => `w${i}`.padEnd(4, 'x')).join(' ');
    expect(message.length).toBeGreaterThan(450);
    const fitted = fitReply(message);
    expect(fitted.text.length).toBeLessThanOrEqual(200);
    expect(fitted.text.length).toBeGreaterThan(150);
    expect(fitted.text).not.toMatch(/\n\s*\n/);
    expect(fitted.text.endsWith('…')).toBe(true);
    expect(fitted.text.slice(0, -1).trimEnd().split(' ').at(-1)).toMatch(/^w\d+x*$/);
    expect(fitted.details).toBeDefined();
    const kept = fitted.text.slice(0, -1).trimEnd();
    expect(message.startsWith(kept)).toBe(true);
    expect(message.endsWith(fitted.details ?? '')).toBe(true);
  });

  it('cuts a message over 2,200 characters', () => {
    const fitted = fitReply('word '.repeat(600));
    expect(fitted.text.length).toBeLessThanOrEqual(200);
    expect(fitted.details?.length).toBeLessThanOrEqual(2000);
    expect(fitted.details?.endsWith('…')).toBe(true);
  });

  it('cuts one long word at the limit', () => {
    expect(fitReply('x'.repeat(500)).text).toHaveLength(200);
  });
});
