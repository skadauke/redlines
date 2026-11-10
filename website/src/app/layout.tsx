import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { FaviconRotation } from '../../components/favicon-rotation';
import { platforms } from '../../lib/release';
import { meta } from '../../lib/site';
import { product } from '../../site.config.mjs';
import './globals.css';

// The page's three typefaces, self-hosted: the latin subset of each, as woff2 files from the
// @fontsource packages (dev dependencies), so a build needs no network for fonts and visitors never
// contact Google. next/font/local copies them into the export. Each one is a CSS variable on
// <html>, read by the Tailwind theme in globals.css (font-sans, font-display, font-doc, font-mono).
const manrope = localFont({
  src: [
    { path: '../../node_modules/@fontsource/manrope/files/manrope-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../node_modules/@fontsource/manrope/files/manrope-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../../node_modules/@fontsource/manrope/files/manrope-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../../node_modules/@fontsource/manrope/files/manrope-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-manrope',
});
const openSans = localFont({
  src: [
    { path: '../../node_modules/@fontsource/open-sans/files/open-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../node_modules/@fontsource/open-sans/files/open-sans-latin-400-italic.woff2', weight: '400', style: 'italic' },
    { path: '../../node_modules/@fontsource/open-sans/files/open-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../../node_modules/@fontsource/open-sans/files/open-sans-latin-600-italic.woff2', weight: '600', style: 'italic' },
    { path: '../../node_modules/@fontsource/open-sans/files/open-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: '../../node_modules/@fontsource/open-sans/files/open-sans-latin-700-italic.woff2', weight: '700', style: 'italic' },
  ],
  variable: '--font-open-sans',
});
const plexMono = localFont({
  src: [
    { path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-plex-mono',
});

// The deploy workflow sets SITE_URL to the Pages URL (base path included), so
// canonical and Open Graph URLs are absolute. Local builds leave them out.
const siteUrl = process.env.SITE_URL || undefined;

// Where the site is served from, as next.config.ts has it: the tab's icons are
// files in public/, which Next doesn't prefix.
const basePath = process.env.BASE_PATH || '';

export const metadata: Metadata = {
  title: meta.title,
  description: meta.description,
  applicationName: product.name,
  ...(siteUrl ? { metadataBase: new URL(siteUrl), alternates: { canonical: '/' } } : {}),
  openGraph: {
    type: 'website',
    siteName: product.name,
    title: meta.title,
    description: meta.description,
    ...(siteUrl ? { url: '/' } : {}),
  },
  // The large card shows the social image (src/app/opengraph-image.png) at full size.
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#101216' },
  ],
};

// Structured data for search engines. `<` is escaped so no string in it can
// close the script element.
const jsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: product.name,
  applicationCategory: 'BusinessApplication',
  operatingSystem: platforms.join(', '),
  description: meta.description,
  isAccessibleForFree: true,
  license: 'https://opensource.org/license/mit',
  ...(siteUrl ? { url: siteUrl } : {}),
  sameAs: product.repository,
}).replace(/</g, '\\u003c');

// The page asks nothing of another origin. The editor loads an image it is given as it is once it
// isn't inside a pending change, so a visitor who pastes a paragraph from another site, with Track
// Changes off, would otherwise make the page fetch from that site. Pages can't send headers, so the
// policy is a <meta>, in production builds only (the dev server needs eval and a socket). Scripts
// and styles are 'unsafe-inline' because Next and CodeMirror write them inline.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${manrope.variable} ${openSans.variable} ${plexMono.variable}`}>
      {process.env.NODE_ENV === 'production' ? (
        <head>
          <meta httpEquiv="Content-Security-Policy" content={csp} />
        </head>
      ) : null}
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
        <FaviconRotation basePath={basePath} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-14 focus:font-semibold focus:text-paper"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
