// @ts-check
//
// Redraws the two images that stand for the site outside it: the Apple touch
// icon (src/app/apple-icon.png, 180 x 180) and the social image
// (src/app/opengraph-image.png, 1200 x 630). Next's file convention links
// them. Run it by hand when the caret changes (`npx playwright install
// chromium` once, then `npm run make-social`) and commit the results; CI
// doesn't run it. It renders in Playwright's Chromium, with Manrope from
// @fontsource/manrope, so the type doesn't depend on the machine's fonts.
//
// The caret is src/app/icon.svg, which `npm run icons:check` holds to the
// app's master (apps/desktop/src-tauri/icons/family/caret.svg).

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const file = (/** @type {string} */ path) => fileURLToPath(new URL(path, import.meta.url));

const icon = readFileSync(file('../src/app/icon.svg'), 'utf8');
// The shapes inside the <svg>, without its comment.
const shapes = icon.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, '');
// The tile itself is the first rect; the bars and the caret are what follows it.
const tileRect = /<rect x="1" y="1" width="98" height="98"[^>]*\/>/;
if (!tileRect.test(shapes)) throw new Error('src/app/icon.svg: no tile');
const contents = shapes.replace(tileRect, '');

const manrope = readFileSync(
  require.resolve('@fontsource/manrope/files/manrope-latin-700-normal.woff2'),
).toString('base64');

const PAPER = '#fbf9f4';
const GROUND = '#f6f7f9';
const INK = '#15171c';
const RED = '#d42a1e';

const fontFace = `@font-face { font-family: Manrope; font-weight: 700; src: url(data:font/woff2;base64,${manrope}) format('woff2'); }`;

const apple = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${PAPER}}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 100 100"><rect width="100" height="100" fill="${PAPER}"/>${contents}</svg>`;

const social = `<!doctype html><meta charset="utf-8"><style>
${fontFace}
html,body{margin:0}
body{width:1200px;height:630px;background:${GROUND};display:flex;align-items:center;padding:0 90px;box-sizing:border-box;gap:60px;font-family:Manrope,sans-serif;font-weight:700}
svg{flex:none;display:block}
h1{margin:0;font-size:68px;line-height:1.14;letter-spacing:-0.02em;color:${INK}}
h1 span{display:block;color:${RED}}
</style>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 100 100">${shapes}</svg>
<h1>The most beautiful Markdown editor.<span>See every change.</span></h1>`;

const browser = await chromium.launch();
try {
  for (const [html, width, height, out] of /** @type {const} */ ([
    [apple, 180, 180, '../src/app/apple-icon.png'],
    [social, 1200, 630, '../src/app/opengraph-image.png'],
  ])) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    writeFileSync(file(out), await page.screenshot({ type: 'png', omitBackground: false }));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('make-social: wrote src/app/apple-icon.png and src/app/opengraph-image.png');
