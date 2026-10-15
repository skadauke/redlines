import { closing, links } from '../lib/site';
import { Actions, ButtonLink } from './button';
import { SectionTitle } from './section';

export function ClosingSection() {
  return (
    <section
      id="open"
      aria-labelledby="open-title"
      className="grid items-end gap-9 border-t border-rule py-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8"
    >
      <div>
        <SectionTitle id="open-title" className="max-w-[34rem]">
          {closing.title}
        </SectionTitle>
        <p className="mt-3.5 max-w-[34rem] text-ink-2">{closing.body}</p>
      </div>
      <Actions className="">
        <ButtonLink href={links.designSpec}>{closing.designSpec}</ButtonLink>
        <ButtonLink href={links.format} variant="ghost">
          {closing.format}
        </ButtonLink>
      </Actions>
    </section>
  );
}
