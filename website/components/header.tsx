import { nav } from '../lib/site';
import { product } from '../site.config.mjs';
import { BrandMark } from './icons';

// The brand on the left; on the right, links to the sections (from 921px)
// and to the downloads, in the rounded box.
export function Header() {
  return (
    <header id="top" className="flex items-center justify-between gap-4 py-5">
      <a
        href="#top"
        aria-label={nav.home}
        className="flex items-center gap-2.5 font-display text-19 leading-none font-bold tracking-[-0.015em]"
      >
        <BrandMark className="size-6.5" />
        {product.name}
      </a>
      <nav aria-label={nav.label}>
        <ul className="flex items-center gap-6 text-14">
          {nav.sections.map((link) => (
            <li key={link.href} className="max-lg:hidden">
              <a href={link.href} className="text-ink-2 transition-colors hover:text-ink">
                {link.label}
              </a>
            </li>
          ))}
          <li>
            <a
              href={nav.download.href}
              className="block rounded-full border border-rule bg-sheet px-3 py-1 whitespace-nowrap text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            >
              {nav.download.label}
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}
