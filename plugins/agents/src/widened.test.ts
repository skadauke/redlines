import { describe, expect, it } from 'vitest';
import { forgetting, readableAgain, readableAgainText } from './widened.ts';

const consent = {
  'claude|/a': 'everything',
  'claude|/b': 'folder',
  'codex|/c': 'document',
  'codex|/d': 'no',
  'moby|/e': 'folder',
} as const;

describe('what a wider setting brings back', () => {
  it('counts the answers wider than the old setting, held to the new one', () => {
    expect(readableAgain(consent, 'document', 'folder')).toEqual([
      'claude|/a',
      'claude|/b',
      'moby|/e',
    ]);
    // Folder to everything: only an answer that allowed the home folder reads more.
    expect(readableAgain(consent, 'folder', 'everything')).toEqual(['claude|/a']);
    expect(readableAgain(consent, 'document', 'everything')).toEqual([
      'claude|/a',
      'claude|/b',
      'moby|/e',
    ]);
  });

  it('counts nothing when the setting is narrowed or unchanged, or for a no', () => {
    expect(readableAgain(consent, 'everything', 'folder')).toEqual([]);
    expect(readableAgain(consent, 'folder', 'folder')).toEqual([]);
    expect(readableAgain({ 'claude|/x': 'no' }, 'document', 'everything')).toEqual([]);
  });

  it('leaves out an agent that is not held to the setting', () => {
    expect(readableAgain(consent, 'document', 'folder', (agent) => agent !== 'moby')).toEqual([
      'claude|/a',
      'claude|/b',
    ]);
  });

  it('says how many, in the singular too', () => {
    expect(readableAgainText(3)).toBe('3 folders you allowed before are readable again.');
    expect(readableAgainText(1)).toBe('1 folder you allowed before is readable again.');
  });

  it('forgets exactly the keys given', () => {
    expect(forgetting(consent, ['claude|/a', 'claude|/b'])).toEqual({
      'codex|/c': 'document',
      'codex|/d': 'no',
      'moby|/e': 'folder',
    });
  });
});
