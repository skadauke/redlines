// Redlines' built-in themes (design §6.6). A theme is a set of CSS custom properties, defined in
// tokens.css for each theme and appearance; fonts.css loads the bundled fonts. Hosts import both
// stylesheets and call applyTheme on the element that holds the editor.

export type ThemeName = 'default' | 'book' | 'editorial';
export type Appearance = 'light' | 'dark';

export const THEMES: readonly { name: ThemeName; label: string }[] = [
  { name: 'default', label: 'Default' },
  { name: 'book', label: 'Book' },
  { name: 'editorial', label: 'Editorial' },
];

const AUTHOR_TOKENS = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [
  `--rl-author-${n}`,
  `--rl-author-${n}-tint`,
]);

/** Syntax colors in code: muted tones, never the brand's red. */
const CODE_TOKENS = ['keyword', 'string', 'number', 'comment', 'function', 'type'].map(
  (kind) => `--rl-code-${kind}`,
);

/** Every token a theme defines. */
export const TOKENS: readonly string[] = [
  '--rl-font-body',
  '--rl-font-heading',
  '--rl-font-ui',
  '--rl-font-mono',
  '--rl-size-body',
  '--rl-line-height',
  '--rl-size-h1',
  '--rl-size-h2',
  '--rl-size-h3',
  '--rl-weight-heading',
  '--rl-tracking-h1',
  '--rl-column',
  '--rl-page',
  '--rl-ink',
  '--rl-ink-2',
  '--rl-ink-3',
  '--rl-rule',
  '--rl-tint',
  '--rl-syntax',
  '--rl-card',
  '--rl-shadow',
  '--rl-tip',
  '--rl-pressed',
  '--rl-red',
  '--rl-mixed',
  ...AUTHOR_TOKENS,
  ...CODE_TOKENS,
  '--rl-quote-font',
  '--rl-quote-style',
  '--rl-quote-color',
  '--rl-quote-size',
  '--rl-th-font',
  '--rl-th-size',
  '--rl-th-case',
  '--rl-th-track',
];

/** Applies a theme to `root` and everything inside it. */
export function applyTheme(root: HTMLElement, theme: ThemeName, appearance: Appearance): void {
  root.dataset['rlTheme'] = theme;
  root.dataset['rlAppearance'] = appearance;
}
