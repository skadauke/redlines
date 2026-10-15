import { latestRelease } from '../lib/release';
import { footer, links } from '../lib/site';
import { product } from '../site.config.mjs';

// The build stamp. The deploy workflow sets GIT_SHA; the page is rendered at
// build time, so this never reaches the browser as code.
const build = (process.env.GIT_SHA ?? '').slice(0, 7) || 'dev';

export function Footer() {
  return (
    <footer className="flex flex-wrap gap-x-5 gap-y-2 pb-10 text-13 text-ink-3">
      <span>{product.name}</span>
      <a href={links.license} className="transition-colors hover:text-ink">
        {footer.license}
      </a>
      <a href={product.repository} className="transition-colors hover:text-ink">
        {footer.github}
      </a>
      <span>{latestRelease ? footer.released(latestRelease.version) : footer.preview}</span>
      <span className="font-mono">build {build}</span>
    </footer>
  );
}
