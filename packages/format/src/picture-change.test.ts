import { describe, expect, it } from 'vitest';
import { describePictureChange, pictureOf } from './picture-change.ts';

describe('a picture, as its source says it (#1197)', () => {
  it('reads a Markdown image, with its attribute block, and an <img> tag', () => {
    expect(pictureOf('![A cat](img/cat.png)')).toEqual({
      src: 'img/cat.png',
      alt: 'A cat',
      width: null,
      rest: '',
    });
    expect(pictureOf('![A cat](cat.png){width=300 .wide}')).toMatchObject({
      width: '300',
      rest: '.wide',
    });
    expect(pictureOf('<img src="cat.png" alt="A cat" width="120">')).toEqual({
      src: 'cat.png',
      alt: 'A cat',
      width: '120',
      rest: '',
    });
  });

  it('is null for anything but one picture', () => {
    expect(pictureOf('text ![A](a.png)')).toBeNull();
    expect(pictureOf('![A](a.png) ![B](b.png)')).toBeNull();
    expect(pictureOf('[link](a.png)')).toBeNull();
    expect(pictureOf('<img alt="no source">')).toBeNull();
  });
});

describe('what a picture changed into says (#1197)', () => {
  it('is a resize when only the width differs, in whatever form', () => {
    expect(
      describePictureChange(
        '![A red square](red.png)',
        '<img src="red.png" alt="A red square" width="240">',
      ),
    ).toBe('Resized picture');
    expect(
      describePictureChange(
        '<img src="a.png" alt="A &amp; B" width="400">',
        '<img src="a.png" alt="A &amp; B" width="200">',
      ),
    ).toBe('Resized picture');
  });

  it('is a change for another difference, and null when a side is not a picture', () => {
    expect(describePictureChange('![A](a.png)', '![B](a.png)')).toBe('Changed picture');
    expect(describePictureChange('![A](a.png)', '![A](b.png)')).toBe('Changed picture');
    expect(describePictureChange('![A](a.png)', 'text')).toBeNull();
  });
});
