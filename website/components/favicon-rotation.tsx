'use client';

import { useEffect } from 'react';

// The tab's icon changes with every visit, as the app's Dock icon does with
// every launch: the next of the six marks of the icon family, in the app's
// order, remembered in this browser. The marks are the files in
// public/favicons. For crawlers, and without JavaScript, the tab keeps the
// caret (src/app/icon.svg).

const MARKS = [
  'caret',
  'change-bar',
  'margin-bracket',
  'delete-mark',
  'redline',
  'caret-insertion',
] as const;

const STORAGE_KEY = 'redlines.mark';

/** The mark after the one at `last`, wrapping around; the first when `last` is no mark's place. */
function nextMark(last: number): number {
  return Number.isInteger(last) && last >= 0 && last < MARKS.length
    ? (last + 1) % MARKS.length
    : 0;
}

/**
 * Changes the tab's icon once the page is up, and renders nothing. `basePath`
 * is where the site is served from, as next.config.ts has it.
 */
export function FaviconRotation({ basePath }: { basePath: string }) {
  useEffect(() => {
    let mark: number;
    try {
      mark = nextMark(Number.parseInt(localStorage.getItem(STORAGE_KEY) ?? '', 10));
      localStorage.setItem(STORAGE_KEY, String(mark));
    } catch {
      // This browser keeps nothing for the site, perhaps by choice: any mark will do.
      mark = Math.floor(Math.random() * MARKS.length);
    }
    const href = `${basePath}/favicons/${MARKS[mark]}.svg`;
    const showMark = () => {
      for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
        if (link.getAttribute('href') !== href) link.setAttribute('href', href);
      }
    };
    showMark();
    // React adds the head's icon link again when it hydrates the head, which can come after
    // this, and a tab may show either: every icon link is kept on the mark.
    const watch = new MutationObserver(showMark);
    watch.observe(document.head, { childList: true });
    return () => watch.disconnect();
  }, [basePath]);
  return null;
}
