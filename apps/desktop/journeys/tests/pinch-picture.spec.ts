// A pinch with a picture in view (#1157): the picture grows with the text in every frame, the
// column never takes the picture's width, and the page has no scroll bar of its own sideways. The
// pinch is the gesture events WebKit sends for two fingers on the trackpad.

import { readFileSync } from 'node:fs';
import { expect, test } from '../src/journey.ts';

/** The sample document, with a picture under its title: notes in the margin, and a picture. */
const DOC = readFileSync(new URL('../../src/sample.md', import.meta.url), 'utf8').replace(
  '\n\n',
  '\n\n![A red square](red.png)\n\n',
);

interface Frame {
  scale: number;
  img: number;
  sideways: boolean;
  /** The widest note in the rail, in px (0 when none is drawn). */
  note: number;
}

test.describe('pinching with a picture @blocks', () => {
  for (const width of [900, 1100, 1700, 2600]) {
    test(`the picture grows with the text, and the page has one scroll bar, in a window ${width} px wide`, async ({
      start,
    }) => {
      const j = await start({ tracking: false, view: 'redlines' });
      await j.page.setViewportSize({ width, height: 800 });
      await j.page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1600;
        canvas.height = 800;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#c0392b';
        context.fillRect(0, 0, 1600, 800);
        const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
        window.__redlinesImages!.replace('red.png', blob);
      });
      await j.page.evaluate((text) => window.__redlines!.editor.setDoc(text), DOC);
      await j.page.evaluate(() =>
        window.__redlines!.editor.view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true }),
      );
      const image = j.page.locator('.rl-image img');
      await expect(image).toHaveCount(1);
      await expect
        .poll(() => image.evaluate((img) => img.getBoundingClientRect().width))
        .toBeGreaterThan(100);
      await j.page.evaluate(() => {
        document.querySelector('.cm-scroller')!.scrollTop = 0;
      });
      const box = (await image.boundingBox())!;
      // The fingers are on the picture's top edge, so that it stays in view while the text grows.
      const at = { x: box.x + box.width / 2, y: box.y + 2 };

      const frames = await j.page.evaluate(async (at) => {
        const scroller = document.querySelector('.cm-scroller') as HTMLElement;
        const send = (type: string, scale: number) => {
          const event = new Event(type, { cancelable: true });
          Object.defineProperties(event, {
            scale: { value: scale },
            clientX: { value: at.x },
            clientY: { value: at.y },
          });
          window.dispatchEvent(event);
        };
        const out: Frame[] = [];
        const read = (scale: number) => {
          const img = document.querySelector('.rl-image img');
          out.push({
            scale,
            img: img ? img.getBoundingClientRect().width : -1,
            sideways: scroller.scrollWidth > scroller.clientWidth,
            note: Math.max(
              0,
              ...Array.from(document.querySelectorAll<HTMLElement>('.rl-note')).map(
                (note) => note.offsetWidth,
              ),
            ),
          });
        };
        const frame = () => new Promise((done) => requestAnimationFrame(() => done(null)));
        send('gesturestart', 1);
        // Out to 250%, a hundredth at a time, and back to 100%.
        for (let i = 1; i <= 150; i++) {
          send('gesturechange', 1 + i / 100);
          await frame();
          read(1 + i / 100);
        }
        for (let i = 149; i >= 0; i--) {
          send('gesturechange', 1 + i / 100);
          await frame();
          read(1 + i / 100);
        }
        send('gestureend', 1);
        return out;
      }, at);

      const out = frames.slice(0, 150);
      const back = frames.slice(150);
      expect(
        frames.filter((f) => f.img < 0),
        'the picture is in view throughout',
      ).toEqual([]);
      // Not narrower than the frame before it while the text grows, and not wider while it
      // shrinks (a pixel of rounding is allowed).
      for (let i = 1; i < out.length; i++) {
        expect(out[i]!.img, `at ${out[i]!.scale}`).toBeGreaterThanOrEqual(out[i - 1]!.img - 1);
      }
      for (let i = 1; i < back.length; i++) {
        expect(back[i]!.img, `at ${back[i]!.scale}`).toBeLessThanOrEqual(back[i - 1]!.img + 1);
      }
      if (width >= 2600) {
        // Room for the notes and the text: the notes grow with the fingers, as they always did.
        const widest = Math.max(...out.map((f) => f.note));
        expect(widest, 'the notes grow with the text').toBeGreaterThan(out[0]!.note * 1.5);
      }
      expect(
        frames.filter((f) => f.sideways),
        'the page never scrolls sideways',
      ).toEqual([]);
    });
  }
});
