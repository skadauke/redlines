import { allReleasesUrl, formatDate, formatSize, latestRelease, platforms } from '../lib/release';
import { download } from '../lib/site';
import { downloads, product } from '../site.config.mjs';
import { Actions, ButtonLink } from './button';
import { DownloadIcon } from './icons';
import { SectionBody, SectionTitle, cardGrid } from './section';

// "Coming soon", with the planned downloads, until lib/release.json lists a
// release with desktop downloads; then a button per file.

function PlatformCard({ os }: { os: string }) {
  const files = latestRelease?.downloads.filter((d) => d.os === os) ?? [];
  return (
    <li>
      <h3 className="text-16 leading-[1.3] font-semibold">{os}</h3>
      {files.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {files.map((file) => (
            <li key={file.file}>
              <a
                href={file.url}
                className="flex items-center gap-3 rounded-[10px] border border-rule px-3 py-2.5 transition-colors hover:border-ink-3"
              >
                <DownloadIcon className="size-5 shrink-0 text-red" />
                <span className="min-w-0">
                  <span className="sr-only">
                    Download {product.name} for {os},{' '}
                  </span>
                  <span className="block text-15 leading-snug font-semibold text-ink">
                    {file.label}
                  </span>
                  <span className="sr-only">, </span>
                  <span className="block text-13 text-ink-3">
                    .{file.file.split('.').pop()} · {formatSize(file.size)}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : latestRelease ? (
        <p className="mt-2 text-15 text-ink-3">Not in this release</p>
      ) : (
        <ul className="mt-2 text-15 text-ink-2">
          {downloads
            .filter((d) => d.os === os)
            .map((d) => (
              <li key={d.file}>{d.label}</li>
            ))}
        </ul>
      )}
    </li>
  );
}

export function DownloadSection() {
  return (
    <section id="download" aria-labelledby="download-title" className="border-t border-rule pt-16 pb-20">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <SectionTitle id="download-title">{download.title}</SectionTitle>
        {latestRelease ? null : (
          <p className="rounded-full border border-rule bg-sheet px-3 py-1 text-14 text-ink-2">
            {download.comingSoon}
          </p>
        )}
      </div>
      <SectionBody
        text={
          latestRelease
            ? `Version ${latestRelease.version}${
                latestRelease.publishedAt ? `, released ${formatDate(latestRelease.publishedAt)}` : ''
              }.`
            : download.comingSoonBody
        }
      />

      <ul className={`mt-8 sm:grid-cols-3 ${cardGrid}`}>
        {platforms.map((os) => (
          <PlatformCard key={os} os={os} />
        ))}
      </ul>

      <Actions>
        {latestRelease ? (
          <>
            <ButtonLink href={latestRelease.notesUrl} variant="ghost">
              Release notes
            </ButtonLink>
            <ButtonLink href={allReleasesUrl} variant="ghost">
              All releases
            </ButtonLink>
          </>
        ) : (
          <ButtonLink href={product.repository} variant="ghost">
            {download.follow}
          </ButtonLink>
        )}
      </Actions>
    </section>
  );
}
