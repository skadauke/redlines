import { describe, expect, it } from 'vitest';
import { emptiedFormats } from './emptied-formats.ts';

const del = (text: string, word: string) => {
  const from = text.indexOf(word);
  return { from, to: from + word.length, insert: '' };
};

describe('a deletion that empties a format', () => {
  it('takes the delimiters of the format, outermost first', () => {
    const text = 'one **two three** four\n';
    expect(emptiedFormats(text, [del(text, 'two three')])).toEqual([del(text, '**two three**')]);
    const nested = 'one ~~**two**~~ four\n';
    expect(emptiedFormats(nested, [del(nested, 'two')])).toEqual([del(nested, '~~**two**~~')]);
  });

  it('leaves a deletion of part of the text, a replacement and text without a format', () => {
    const text = 'one **two three** four\n';
    expect(emptiedFormats(text, [del(text, 'two')])).toEqual([del(text, 'two')]);
    const sub = { ...del(text, 'two three'), insert: 'x' };
    expect(emptiedFormats(text, [sub])).toEqual([sub]);
    const plain = 'a ** b ** c\n';
    expect(emptiedFormats(plain, [del(plain, ' b ')])).toEqual([del(plain, ' b ')]);
  });

  it('takes the delimiters of a format that holds an insertion, as the editor reads it (#1094)', () => {
    const text = 'one **two<!--ins k3x9--> new<!--/k3x9--> three** four\n';
    const inside = 'two<!--ins k3x9--> new<!--/k3x9--> three';
    const from = text.indexOf(inside);
    const edit = { from, to: from + inside.length, insert: '' };
    expect(emptiedFormats(text, [edit])).toEqual([{ ...edit, from: from - 2, to: edit.to + 2 }]);
  });
});
