import { Facet } from '@codemirror/state';
import type { MarkdownDialect } from './api.ts';

/** The open file's dialect (`EditorOptions.dialect`); default GitHub's. */
export const dialectFacet = Facet.define<MarkdownDialect, MarkdownDialect>({
  combine: (values) => values[0] ?? 'gfm',
});
