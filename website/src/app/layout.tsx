import type { Metadata, Viewport } from 'next';
import { Figtree, IBM_Plex_Mono, Open_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { meta } from '../../lib/site';
import { product } from '../../site.config.mjs';
import './globals.css';

// The page's three typefaces. next/font downloads them from Google Fonts at
// build time and serves them with the site, so visitors never contact Google.
// Each one is a CSS variable on <html>, read by the Tailwind theme in
// globals.css (font-sans, font-display, font-doc, font-mono).
const figtree = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-figtree',
});
const openSans = Open_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-open-sans',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});

// The deploy workflow sets SITE_URL to the Pages URL (base path included), so
// canonical and Open Graph URLs are absolute. Local builds leave them out.
const siteUrl = process.env.SITE_URL || undefined;

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
  operatingSystem: 'macOS, Windows, Linux',
  description: meta.description,
  isAccessibleForFree: true,
  license: 'https://opensource.org/license/mit',
  ...(siteUrl ? { url: siteUrl } : {}),
  sameAs: product.repository,
}).replace(/</g, '\\u003c');

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${figtree.variable} ${openSans.variable} ${plexMono.variable}`}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
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
