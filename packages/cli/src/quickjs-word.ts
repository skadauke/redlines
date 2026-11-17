// The Word half of the `redlines` program: `@redlines/word` (docx, fflate, micromark), bundled apart
// from the rest (`word.js`) because it is most of the program's weight. The program evaluates it only
// for `import-docx` and `export-docx` (`load_word` in `engine.rs`), so every other command starts as
// fast as it did without it. It sets one global, which `quickjs-entry.ts` reads.

import './quickjs-text.ts';
import { exportDocx, importDocx } from '@redlines/word';
import type { ReportEntry } from '@redlines/word';
import type { CliIo } from './run.ts';

type Word = Required<Pick<CliIo, 'importDocx' | 'exportDocx'>>;

const word: Word = {
  importDocx: (bytes) =>
    new Promise((resolve) => {
      const result = importDocx(bytes);
      resolve({
        markdown: result.markdown,
        notes: result.report.entries.map((entry) => entry.message),
        media: result.media,
      });
    }),
  async exportDocx(text, images) {
    const report: ReportEntry[] = [];
    const bytes = await exportDocx(text, { report, ...(images ? { images } : {}) });
    return { bytes, notes: report.map((entry) => entry.message) };
  },
};

declare global {
  var __redlinesWord: Word;
}
globalThis.__redlinesWord = word;
