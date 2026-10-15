import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandMark } from '../../components/icons';
import { product } from '../../site.config.mjs';

export const metadata: Metadata = { title: `Page not found · ${product.name}` };

// Pages serves this as 404.html. Link (not <a>) adds the base path.
export default function NotFound() {
  return (
    <main id="main" className="grid min-h-svh place-items-center py-20 text-center">
      <div>
        <BrandMark className="mx-auto size-10" />
        <h1 className="mt-6 font-display text-title font-medium">Page not found</h1>
        <p className="mt-3 text-ink-2">There is nothing at this address.</p>
        <Link href="/" className="mt-6 inline-block font-semibold text-red hover:underline">
          Go to the {product.name} home page
        </Link>
      </div>
    </main>
  );
}
