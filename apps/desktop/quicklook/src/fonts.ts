// The Latin subsets of the Default theme's fonts, inside the page: Carlito for the text and Cousine
// for code, the twins of Calibri and Courier New (design §6.6). The page has no network and no
// files beside it, so each font goes in as a data URL (about 170 KB in all, once in the bundle).
// Anything outside the Latin subsets falls back to the system's fonts, as the theme's stacks say.

import carlito400 from '@fontsource/carlito/files/carlito-latin-400-normal.woff2?inline';
import carlito400Italic from '@fontsource/carlito/files/carlito-latin-400-italic.woff2?inline';
import carlito700 from '@fontsource/carlito/files/carlito-latin-700-normal.woff2?inline';
import carlito700Italic from '@fontsource/carlito/files/carlito-latin-700-italic.woff2?inline';
import cousine400 from '@fontsource/cousine/files/cousine-latin-400-normal.woff2?inline';
import cousine700 from '@fontsource/cousine/files/cousine-latin-700-normal.woff2?inline';

/** A font's `@font-face`, with its file inside it as a data URL. */
export function face(
  family: string,
  style: 'normal' | 'italic',
  weight: 400 | 700,
  dataUrl: string,
): string {
  return `@font-face {
  font-family: '${family}';
  font-style: ${style};
  font-weight: ${weight};
  src: url(${dataUrl}) format('woff2');
}`;
}

export function fontFaces(): string {
  return [
    face('Carlito', 'normal', 400, carlito400),
    face('Carlito', 'italic', 400, carlito400Italic),
    face('Carlito', 'normal', 700, carlito700),
    face('Carlito', 'italic', 700, carlito700Italic),
    face('Cousine', 'normal', 400, cousine400),
    face('Cousine', 'normal', 700, cousine700),
  ].join('\n');
}
