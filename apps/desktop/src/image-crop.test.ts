import { describe, expect, it } from 'vitest';
import { baseName, cropName, cropPixels } from './image-crop.ts';

describe('cropName', () => {
  it('puts -crop before the extension', () => {
    expect(cropName('photo.png', 'image/png')).toBe('photo-crop.png');
    expect(cropName('photo.jpeg', 'image/jpeg')).toBe('photo-crop.jpg');
  });
  it('keeps one suffix on a copy of a copy', () => {
    expect(cropName('photo-crop.png', 'image/png')).toBe('photo-crop.png');
    expect(cropName('photo-crop-2.png', 'image/png')).toBe('photo-crop.png');
  });
  it('writes a PNG for a type a canvas cannot write', () => {
    expect(cropName('spin.gif', 'image/gif')).toBe('spin-crop.png');
  });
  it('names a file with no extension', () => {
    expect(cropName('photo', 'image/png')).toBe('photo-crop.png');
  });
});

describe('cropPixels', () => {
  it('rounds to whole pixels inside the picture', () => {
    expect(cropPixels({ x: 0.25, y: 0.5, width: 0.5, height: 0.5 }, 200, 100)).toEqual({
      x: 50,
      y: 50,
      width: 100,
      height: 50,
    });
  });
  it('never leaves the picture or goes empty', () => {
    const part = cropPixels({ x: 0.9, y: 0.9, width: 0.5, height: 0 }, 100, 100);
    expect(part).toEqual({ x: 90, y: 90, width: 10, height: 1 });
  });
});

describe('baseName', () => {
  it('drops the folders', () => {
    expect(baseName('/a/b/photo.png')).toBe('photo.png');
  });
});
