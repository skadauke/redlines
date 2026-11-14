// The page that Quick Look draws: one document of HTML and CSS, with no script, no network and no
// file beside it. The Content-Security-Policy says so too, for a page whose text came from a file
// that anyone could have written: nothing loads but the stylesheet and the fonts inside it, and the
// images that the extension attached to its answer (`cid:`), never one from a server.

import documentCss from './document.css?raw';
import { fontFaces } from './fonts.ts';
import { themeCss } from './theme.ts';

/** `text` as HTML text, and as a value in double quotes. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface PageParts {
  /** The file's name. */
  title: string;
  /** A line over the document, as text. */
  notice?: string | null;
  /** The YAML at the top of the file, as the file has it. */
  frontMatter?: string | null;
  /** The document, as HTML. */
  body: string;
  /** A line under the document, as text. */
  after?: string | null;
}

let styles: string | undefined;

/** The stylesheet, worked out once: the fonts, the theme and the document's. */
function stylesheet(): string {
  styles ??= [fontFaces(), themeCss(), documentCss].join('\n');
  return styles;
}

export function page({ title, notice, frontMatter, body, after }: PageParts): string {
  // A document cut short in the middle of a line has no line break to end it.
  const content = body === '' || body.endsWith('\n') ? body : `${body}\n`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src cid:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
${stylesheet()}
</style>
</head>
<body>
<main class="rl-page">
${notice ? `<p class="rl-notice">${escapeHtml(notice)}</p>\n` : ''}<article class="rl-doc">
${frontMatter ? `<pre class="rl-frontmatter">${escapeHtml(frontMatter)}</pre>\n` : ''}${content}</article>
${after ? `<p class="rl-notice rl-notice-after">${escapeHtml(after)}</p>\n` : ''}</main>
</body>
</html>
`;
}
