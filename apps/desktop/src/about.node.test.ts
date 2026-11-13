// The About Redlines window, as its files and the app's configuration have it: the copyright line is
// the license's own, the icon gives no sign that a click changes it, and the window is a small fixed
// one of the app's own.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COPYRIGHT } from './about.ts';
import { MARKS } from './about/marks.ts';

describe('the copyright line', () => {
  it('says what LICENSE says, with the sign the system uses for it', () => {
    const license = readFileSync(new URL('../../../LICENSE', import.meta.url), 'utf8');
    const line = license.split('\n').find((text) => text.startsWith('Copyright'));
    expect(line).toBeDefined();
    expect(COPYRIGHT).toBe((line ?? '').replace('(c)', '©'));
  });
});

describe('the icon', () => {
  it('gives no hint that a click changes it: an arrow for a cursor, no label, no role', () => {
    const css = readFileSync(new URL('./about/about.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/cursor:\s*(pointer|grab|zoom-in)/);
    const html = readFileSync(new URL('../about.html', import.meta.url), 'utf8');
    const icon = /<div[^>]*id="icon"[^>]*>/.exec(html)?.[0] ?? '';
    expect(icon).toContain('rl-about-icon');
    for (const attribute of ['title', 'role', 'tabindex', 'aria-label']) {
      expect(icon).not.toContain(`${attribute}=`);
    }
    // The click is the page's, not the window's drag: the icon is left out of the drag region.
    expect(icon).toContain('data-tauri-drag-region="false"');
  });

  it('goes through the family in the order the Dock icon does', () => {
    const rust = readFileSync(new URL('../src-tauri/src/dock_icon.rs', import.meta.url), 'utf8');
    const list = /const MARKS: \[&str; \d+\] = \[([\s\S]*?)\];/.exec(rust)?.[1] ?? '';
    const names = [...list.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
    expect(names).toEqual([...MARKS]);
  });
});

describe('the window', () => {
  const config = JSON.parse(
    readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
  ) as { app: { windows: Record<string, unknown>[] } };
  const about = config.app.windows.find((window) => window['label'] === 'about');

  it('is a small window of the app’s own, fixed in size, which its page shows once it is styled', () => {
    expect(about).toMatchObject({
      url: 'about.html',
      title: 'About Redlines',
      resizable: false,
      minimizable: false,
      maximizable: false,
      center: true,
      // Made by `open_about`, hidden, and shown by the page (src/about/main.ts).
      create: false,
      visible: false,
    });
    expect(Number(about?.['width'])).toBeLessThanOrEqual(400);
    expect(Number(about?.['height'])).toBeLessThanOrEqual(400);
  });

  it('has a page that Vite builds, and the narrow capability of the small windows', () => {
    const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    expect(vite).toContain("about: resolve(import.meta.dirname, 'about.html')");
    const capability = JSON.parse(
      readFileSync(new URL('../src-tauri/capabilities/about.json', import.meta.url), 'utf8'),
    ) as { windows: string[]; permissions: string[] };
    expect(capability.windows).toEqual(['about']);
    // No file, no clipboard, no dialog, and no document commands.
    for (const permission of capability.permissions) {
      expect(permission).toMatch(/^(core:window:allow-(show|start-dragging|close)|allow-[a-z-]+)$/);
      expect(permission).not.toMatch(/fs|clipboard|dialog|allow-(read|write|rename|watch|agent)/);
    }
  });
});
