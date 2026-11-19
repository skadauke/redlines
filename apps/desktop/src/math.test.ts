// Math (#1173): the engine the app hands the editor (Temml) writes MathML for the formulas of a
// document, as the editor's `math` option asks (packages/editor/src/preview/math.ts).

import { describe, expect, it } from 'vitest';

describe('the app’s math engine', () => {
  const load = () => import('temml').then((module) => module.default);

  it('writes MathML for an inline formula and a display', async () => {
    const engine = await load();
    const inline = engine.renderToString('E = mc^2', { throwOnError: false });
    expect(inline).toContain('<math');
    expect(inline).toContain('<msup>');
    expect(inline).not.toContain('display="block"');
    expect(engine.renderToString('\\frac{a}{b}', { displayMode: true })).toContain(
      'display="block"',
    );
  });

  it('draws a formula it can’t read as its source, in a color, and doesn’t throw', async () => {
    const engine = await load();
    const html = engine.renderToString('\\notacommand{x}', { throwOnError: false });
    expect(html).toContain('notacommand');
  });
});
