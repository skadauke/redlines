// The default theme as CSS for a page with no script (design §6.6). The tokens are read from the
// stylesheet of @redlines/themes, the one the editor uses, so that the preview follows the theme
// when it changes: the light rule is the page's, and the dark one applies when the Mac is in dark
// mode, as the editor's does through its appearance. The preview is never in Book or Editorial, and
// has no setting for it: Quick Look has no way to ask.

import tokens from '@redlines/themes/tokens.css?raw';

/** The rule for `selector` in `css`: what stands between its braces. A theme's rules hold
 * declarations only, so the first closing brace ends it. */
export function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`The themes' stylesheet has no rule for ${selector}.`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  if (close < 0) throw new Error(`The rule for ${selector} isn't closed.`);
  return css.slice(open + 1, close);
}

/** The tokens of the Default theme, in light, and in dark under the system's dark mode. */
export function themeCss(stylesheet: string = tokens): string {
  const light = ruleBody(stylesheet, "[data-rl-theme='default'][data-rl-appearance='light']");
  const dark = ruleBody(stylesheet, "[data-rl-theme='default'][data-rl-appearance='dark']");
  return [
    // --rl-margin is the editor's side margin, which its host sets where the theme is applied.
    `:root {${light}  --rl-margin: 24px;\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root {${dark}}\n}`,
  ].join('\n');
}
