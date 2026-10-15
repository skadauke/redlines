import { latestRelease, platforms } from '../lib/release';
import { hero, links } from '../lib/site';
import { product } from '../site.config.mjs';
import { Actions, ButtonLink } from './button';
import { HeroSheet } from './hero-sheet';

// "macOS, Windows and Linux": commas, and "and" before the last, with no
// serial comma, like the copy.
const platformList =
  platforms.length > 1
    ? `${platforms.slice(0, -1).join(', ')} and ${platforms[platforms.length - 1]}`
    : platforms.join('');

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="grid grid-cols-1 items-center gap-9 pt-6 pb-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14 lg:pt-12 lg:pb-18"
    >
      <div>
        <h1 id="hero-title" className="font-display text-hero font-bold text-balance">
          {hero.title} <span className="block text-red">{hero.titleAccent}</span>
        </h1>
        <p className="mt-6 max-w-[34rem] text-19 text-pretty text-ink-2">{hero.lede}</p>
        {/* Before the first release, the buttons lead to the design. */}
        <Actions>
          {latestRelease ? (
            <ButtonLink href="#download">{hero.download}</ButtonLink>
          ) : (
            <ButtonLink href={links.designSpec}>{hero.designSpec}</ButtonLink>
          )}
          <ButtonLink href={product.repository} variant="ghost">
            {hero.github}
          </ButtonLink>
        </Actions>
        <p className="my-3.5 text-14 text-ink-3">
          {latestRelease ? hero.released(latestRelease.version, platformList) : hero.unreleased}
        </p>
      </div>
      <HeroSheet />
    </section>
  );
}
