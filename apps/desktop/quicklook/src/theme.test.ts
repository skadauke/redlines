import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import documentCss from './document.css?raw';
import { face, fontFaces } from './fonts.ts';
import { ruleBody, themeCss } from './theme.ts';

const tokens = readFileSync(
  new URL('../../../../plugins/themes/src/tokens.css', import.meta.url),
  'utf8',
);

describe('ruleBody', () => {
  it('is what stands between the braces of a rule', () => {
    expect(ruleBody('a {\n  x: 1;\n}\nb { y: 2; }', 'b')).toBe(' y: 2; ');
  });

  it('refuses a rule that isn’t there, and one that isn’t closed', () => {
    expect(() => ruleBody('a { x: 1; }', 'b')).toThrow(/no rule for b/);
    expect(() => ruleBody('a { x: 1;', 'a')).toThrow(/isn't closed/);
  });
});

describe('themeCss', () => {
  const css = themeCss();

  it('is the Default theme in light, and in dark under the Mac’s dark mode', () => {
    const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
    expect(light).toContain('color-scheme: light;');
    expect(light).toContain('--rl-page: #ffffff;');
    expect(light).toContain('--rl-ink: #1d1d1f;');
    expect(dark).toContain('color-scheme: dark;');
    expect(dark).toContain('--rl-page: #1e1e1f;');
    expect(dark).toContain('--rl-ink: #f2f2f5;');
  });

  it('is read from the stylesheet that the editor uses', () => {
    const rule = (selector: string) => ruleBody(tokens, selector);
    expect(css).toContain(rule("[data-rl-theme='default'][data-rl-appearance='light']"));
    expect(css).toContain(rule("[data-rl-theme='default'][data-rl-appearance='dark']"));
    // Not the other themes'.
    expect(css).not.toContain('Gelasio');
  });

  it('defines every token that the document’s styles use', () => {
    const used = new Set([...documentCss.matchAll(/var\((--rl-[\w-]+)/g)].map((found) => found[1]));
    expect(used.size).toBeGreaterThan(20);
    for (const token of used) expect(css, token).toContain(`${token}:`);
  });
});

describe('fonts', () => {
  it('puts each font inside its face, as a data URL', () => {
    expect(face('A', 'italic', 700, 'data:font/woff2;base64,AAAA')).toBe(
      "@font-face {\n  font-family: 'A';\n  font-style: italic;\n  font-weight: 700;\n  src: url(data:font/woff2;base64,AAAA) format('woff2');\n}",
    );
  });

  it('has the text and code fonts, and nothing that is fetched', () => {
    const faces = fontFaces();
    expect(faces.match(/@font-face/g)).toHaveLength(6);
    expect(faces).toContain("font-family: 'Carlito'");
    expect(faces).toContain("font-family: 'Cousine'");
    expect(faces.match(/font-style: italic/g)).toHaveLength(2);
    const urls = [...faces.matchAll(/url\(([^)]*)\)/g)].map(([, url]) => url ?? '');
    expect(urls).toHaveLength(6);
    expect(urls.every((url) => url.startsWith('data:font/woff2;base64,'))).toBe(true);
  });
});
