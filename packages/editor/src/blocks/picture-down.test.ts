// @vitest-environment happy-dom
// ↓ from the last line of a picture block opens the paragraph below it (#514), for an image written
// as a tag as for `![…](…)` (#633).
import { describe, expect, it } from 'vitest';
import { runScript } from './script.ts';

const down = (doc: string) =>
  runScript({ name: doc, doc, keys: ['ArrowDown'], tc: false, expect: {} }).caret;

describe('↓ at the end of a picture block', () => {
  it('opens a paragraph under a Markdown image (the baseline)', () => {
    expect(down('![a](a.png)‸')).not.toBe('![a](a.png)‸');
  });
  for (const doc of [
    '<img src="a.png" width="100">‸',
    '<img src="a.png" width="100" align="left">‸',
    'Text.⏎⏎<img src="a.png" width="100">‸',
  ]) {
    it(`does the same under ${doc}`, () => {
      expect(down(doc)).not.toBe(doc);
    });
  }
});
