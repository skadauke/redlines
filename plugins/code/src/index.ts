// Syntax colors in code blocks, and a read-only viewer for other text files (v0.2 design:
// Rendering, The file sidebar). The grammars load on demand, one chunk per language, so none of
// them is in the editor's first load.

import type { Editor } from '@redlines/editor';
import type { Plugin } from '@redlines/plugin-api';
import { codeHighlight } from './highlight.ts';

export { codeHighlight, codeLanguages, codeStyle } from './highlight.ts';
export { createFileViewer, type FileViewer } from './viewer.ts';

/**
 * Colors the code in the editor. The editor has to be made with `codeLanguages` as well, since
 * Markdown parses a block's code as it parses the document.
 */
export const plugin: Plugin = {
  manifest: {
    id: 'redlines.code',
    name: 'Code',
    version: '0.0.0',
    needs: ['document:read'],
  },
  activate: (context) => (context.editor as Editor).addExtension(codeHighlight),
};
