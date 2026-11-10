import type { Page } from '@playwright/test';

/** The origin the site is served from, which the page may ask for anything of. */
export const ORIGIN = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173').origin;

/**
 * Logs a page's requests: the URLs of other origins (each aborted, so that nothing leaves), and the
 * paths under `/embed/`, in the order they were made. Call it before the page loads.
 */
export async function watchRequests(page: Page): Promise<{ foreign: string[]; embed: string[] }> {
  const log = { foreign: [] as string[], embed: [] as string[] };
  await page.route(
    (url) => /^(https?|wss?):$/.test(url.protocol) && url.origin !== ORIGIN,
    (route) => {
      log.foreign.push(route.request().url());
      return route.abort();
    },
  );
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.includes('/embed/')) log.embed.push(pathname);
  });
  return log;
}

/** Whether the page fits its window, with nothing to scroll sideways. */
export function noSidewaysScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}
