// Screenshots: where a journey's pictures go, and what they are called.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

/** `name-dark-200` for a dark page at 200%; the plain light 100% page keeps the bare name. */
export function shotName(name: string, look: { scheme: string; textSize: number }): string {
  const parts = [name];
  if (look.scheme !== 'light') parts.push(look.scheme);
  if (look.textSize !== 1) parts.push(String(Math.round(look.textSize * 100)));
  return parts.join('-');
}

/** The folder a run's screenshots are written to: one folder per journey, under the output folder. */
export function shotsDir(info: TestInfo): string {
  return join(info.outputDir, 'shots');
}

const taken = new Map<string, number>();

/** Takes the screenshot, writes it to the run's shots folder and attaches it to the report. */
export async function writeShot(
  page: Page,
  info: TestInfo,
  name: string,
  options: { clip?: { x: number; y: number; width: number; height: number } } = {},
): Promise<string> {
  const dir = shotsDir(info);
  await mkdir(dir, { recursive: true });
  // A name is a file's: no path characters in it, and a name used twice gets a number.
  const base = name.replace(/[^\w.-]+/g, '-');
  const key = join(dir, base);
  const used = (taken.get(key) ?? 0) + 1;
  taken.set(key, used);
  const path = join(dir, `${used === 1 ? base : `${base}-${used}`}.png`);
  await page.screenshot({ path, ...(options.clip ? { clip: options.clip } : {}) });
  await info.attach(name, { path, contentType: 'image/png' });
  return path;
}
