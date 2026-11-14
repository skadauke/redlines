// Colours and contrast, for journeys that check what a person could read: the WCAG ratio between
// a text colour and what is behind it, and whether a surface lets what is behind it show through.

import type { Locator } from '@playwright/test';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** What the page says about one element: its text colour and the layers behind it, nearest first. */
export interface Paint {
  color: string;
  /** The background colours from the element out to the root, then the page's, as CSS strings. */
  backgrounds: string[];
  /** The product of every `opacity` from the element out to the root. */
  opacity: number;
}

export function parseColor(css: string): Rgba {
  const match = /rgba?\(([^)]+)\)/.exec(css);
  if (!match?.[1]) throw new Error(`not a colour: ${css}`);
  const [r = 0, g = 0, b = 0, a = 1] = match[1]
    .split(/[,/ ]+/)
    .filter(Boolean)
    .map(Number);
  return { r, g, b, a };
}

/** `top` laid over `under`, as the screen composes them. */
export function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a + under.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, u: number) => (t * top.a + u * under.a * (1 - top.a)) / a;
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The WCAG contrast ratio of two opaque colours, 1 to 21. */
export function ratio(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** What an element's layers add up to: its background where its own and those behind it are laid. */
export function flatten(
  backgrounds: string[],
  page: Rgba = { r: 255, g: 255, b: 255, a: 1 },
): Rgba {
  return backgrounds.reduceRight((under, css) => over(parseColor(css), under), page);
}

/** Reads an element's paint in the page. */
export function paintOf(locator: Locator): Promise<Paint> {
  return locator.evaluate((element) => {
    const backgrounds: string[] = [];
    let opacity = 1;
    for (let e: Element | null = element; e; e = e.parentElement) {
      const style = getComputedStyle(e);
      backgrounds.push(style.backgroundColor);
      opacity *= Number(style.opacity);
    }
    return { color: getComputedStyle(element).color, backgrounds, opacity };
  });
}

/** The contrast of an element's text with what is behind it, in the colours the screen shows. */
export async function contrastOf(locator: Locator): Promise<number> {
  const paint = await paintOf(locator);
  const behind = flatten(paint.backgrounds);
  const text = over(parseColor(paint.color), behind);
  return ratio(text, behind);
}

/** Whether nothing behind the element shows through its own background (a menu must be opaque). */
export async function isOpaque(locator: Locator): Promise<boolean> {
  const paint = await paintOf(locator);
  const own = parseColor(paint.backgrounds[0] ?? 'rgba(0, 0, 0, 0)');
  return own.a === 1 && paint.opacity === 1;
}
