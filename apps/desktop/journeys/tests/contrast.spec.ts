// Text a person has to read keeps 4.5:1 (#578): hints, placeholders, captions, timestamps and the
// empty states of panels were the tertiary gray (--rl-ink-3), under it in every theme. This scans
// the text the page draws, outside the document's own, and fails on any element under 4.5:1 that
// isn't a disabled control (WCAG exempts those), in the look the run is in.

import type { Page } from '@playwright/test';
import { flatten, parseColor, ratio } from '../src/contrast.ts';
import { expect, test } from '../src/journey.ts';

interface Low {
  tag: string;
  text: string;
  ratio: number;
}

/** The visible text of the interface (the document's text has the theme's inks, held in its tests). */
function lowContrast(page: Page): Promise<Low[]> {
  return page.evaluate(() => {
    const parse = (css: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(css);
      const [r = 0, g = 0, b = 0, a = 1] = (m?.[1] ?? '0,0,0,0')
        .split(/[,/ ]+/)
        .filter(Boolean)
        .map(Number);
      return [r, g, b, a];
    };
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
    const behind = (element: Element): number[] => {
      const layers: number[][] = [];
      for (let e: Element | null = element; e; e = e.parentElement) {
        layers.push(parse(getComputedStyle(e).backgroundColor));
      }
      return layers.reduceRight<number[]>(
        (under, top) => {
          const a = top[3]! + under[3]! * (1 - top[3]!);
          return [0, 1, 2]
            .map((i) => (top[i]! * top[3]! + under[i]! * under[3]! * (1 - top[3]!)) / (a || 1))
            .concat(a);
        },
        [255, 255, 255, 1],
      );
    };
    const opacityOf = (element: Element) => {
      let o = 1;
      for (let e: Element | null = element; e; e = e.parentElement)
        o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    const failing: { tag: string; text: string; ratio: number }[] = [];
    const check = (element: Element, text: string, pseudo?: string) => {
      const style = getComputedStyle(element, pseudo);
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden') return;
      if (opacityOf(element) === 0) return;
      if (element.closest(':disabled, [aria-disabled="true"], .cm-content')) return;
      const ground = behind(element);
      const own = parse(style.color);
      const o = own[3] * opacityOf(element);
      const shown = [0, 1, 2].map((i) => own[i]! * o + ground[i]! * (1 - o));
      const [hi, lo] = [lum(shown), lum(ground)].sort((a, b) => b - a) as [number, number];
      const ratio = (hi + 0.05) / (lo + 0.05);
      if (ratio < 4.5) {
        failing.push({
          tag: `${element.tagName.toLowerCase()}.${element.className}`,
          text: text.slice(0, 40),
          ratio: Math.round(ratio * 100) / 100,
        });
      }
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const parent = node.parentElement;
      if (text && parent && !/^(SCRIPT|STYLE)$/.test(parent.tagName)) check(parent, text);
    }
    for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    )) {
      if (field.placeholder && !field.value) check(field, field.placeholder, '::placeholder');
    }
    return failing;
  });
}

const RESOLVED = [
  'A <!--cmt c8d2-->settled point<!--/c8d2--> and an open one.',
  '',
  '<!-- redlines',
  'version: 1',
  'people:',
  '  ada: {name: Ada Lovelace, email: ada@example.org}',
  '  bo: {name: Bo Chen, email: bo@example.org}',
  'comments:',
  '  c8d2:',
  '    by: bo',
  '    at: 2026-10-31T09:41Z',
  '    resolved: ada 2026-10-31T09:50Z',
  '    text: |-',
  '      Is this settled?',
  '-->',
  '',
].join('\n');

test.describe('interface text keeps 4.5:1 @views', () => {
  test('the sample, with its notes', async ({ start }) => {
    const j = await start({ view: 'redlines' });
    await j.shot('contrast-sample');
    expect(await lowContrast(j.page), 'text under 4.5:1').toEqual([]);
  });

  test('a new comment box, with its placeholder', async ({ start }) => {
    const j = await start({ doc: 'Some words to comment on.\n', tracking: false, view: 'clean' });
    await j.selectText('words');
    await j.press('Alt+Meta+m');
    await expect(j.page.locator('.rl-note-box textarea')).toBeVisible();
    await j.shot('contrast-comment-box');
    expect(await lowContrast(j.page), 'text under 4.5:1').toEqual([]);
  });

  test('the link box, with its placeholder', async ({ start }) => {
    const j = await start({ doc: 'Some words to link.\n', tracking: false, view: 'clean' });
    await j.selectText('words');
    await j.press('Meta+k');
    await expect(j.page.locator('.rl-link-popover input')).toBeVisible();
    await j.shot('contrast-link-box');
    expect(await lowContrast(j.page), 'text under 4.5:1').toEqual([]);
  });

  test('a resolved comment, and the files sidebar with nothing in it', async ({ start }) => {
    const j = await start({ doc: RESOLVED, tracking: false, view: 'redlines' });
    await j.menu('Show Resolved Comments');
    await j.press('Control+Meta+s');
    await expect(j.page.locator('.rl-sidebar')).toBeVisible();
    await j.shot('contrast-resolved-and-files');
    expect(await lowContrast(j.page), 'text under 4.5:1').toEqual([]);
  });
});

test.describe('shapes that show state keep 3:1 (#653)', () => {
  test('a checkbox outline and a focus ring', async ({ start }) => {
    const j = await start({
      doc: '- [ ] A task to do\n- [x] A task done\n\nA paragraph after.\n',
      tracking: false,
      view: 'clean',
    });
    // The page's own color, under everything: what the shapes are drawn on.
    const page = parseColor(
      await j.page.evaluate(
        () => getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor,
      ),
    );
    const outline = await j.page.evaluate(() => {
      const rect = document.querySelector('.rl-box rect');
      return rect ? getComputedStyle(rect).stroke : null;
    });
    expect(outline, 'a checkbox is drawn').not.toBeNull();
    expect(ratio(flatten([outline!], page), page), 'the checkbox outline').toBeGreaterThanOrEqual(
      3,
    );
    // A checkbox focused after a key, as the keyboard does: its ring.
    await j.caretAtEnd();
    await j.page.keyboard.press('Shift');
    await j.page
      .locator('.rl-box')
      .first()
      .evaluate((box) => (box as unknown as HTMLElement).focus());
    const ring = await j.page.evaluate(() => {
      const focused = document.activeElement;
      if (!focused || focused === document.body) return null;
      const style = getComputedStyle(focused);
      return { color: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(ring, 'the checkbox takes the focus').not.toBeNull();
    expect(ring?.style, 'the focus ring is drawn').not.toBe('none');
    if (ring && ring.style !== 'none') {
      expect(ratio(flatten([ring.color], page), page), 'the focus ring').toBeGreaterThanOrEqual(3);
    }
    await j.shot('contrast-checkbox-and-focus');
  });
});
