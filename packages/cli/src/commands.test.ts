import { describe, expect, it } from 'vitest';
import { parse } from '@redlines/format';
import { redlines } from './test-helpers.ts';

const PLAIN = '# Plan\n\nWe will ship the importer in March.\n';
const AS_CLAUDE = ['--as', 'claude-ada', '--name', 'Claude', '--for', 'ada'];

describe('str-replace', () => {
  it('replaces a note on an in-place edit', async () => {
    const first = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', 'the importer', '--new', 'the new importer'],
        ...AS_CLAUDE,
        ...['--note', 'First'],
      ],
      { 'plan.md': PLAIN },
    );
    expect(first.code).toBe(0);
    const second = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', 'the new importer', '--new', 'the new, fast importer'],
        ...AS_CLAUDE,
        ...['--note', 'Second'],
      ],
      first.files,
    );
    expect(second.code).toBe(0);
    expect(second.stdout).toBe(
      `Changed in place: ${parse(first.files['plan.md'] ?? '').marks[0]?.id}\n`,
    );
    const { marks } = parse(second.files['plan.md'] ?? '');
    expect(marks.map((mark) => mark.kind)).toEqual(['ins']);
    expect(marks[0]?.entry.note).toBe('Second');
  });

  it('keeps the note of a mark that an in-place edit gives no note', async () => {
    const first = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', 'the importer', '--new', 'the new importer'],
        ...AS_CLAUDE,
        ...['--note', 'First'],
      ],
      { 'plan.md': PLAIN },
    );
    const second = await redlines(
      [
        'str-replace',
        'plan.md',
        ...['--old', 'the new importer', '--new', 'the new, fast importer'],
        ...AS_CLAUDE,
      ],
      first.files,
    );
    expect(parse(second.files['plan.md'] ?? '').marks[0]?.entry.note).toBe('First');
  });
});
