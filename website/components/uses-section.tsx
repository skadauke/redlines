import { uses } from '../lib/site';
import { Rich, SectionBody, SectionTitle, cardGrid } from './section';

// Who reviews documents this way, beyond developers: one card per field.
export function UsesSection() {
  return (
    <section id="uses" aria-labelledby="uses-title" className="border-t border-rule py-16">
      <SectionTitle id="uses-title">{uses.title}</SectionTitle>
      <SectionBody text={uses.body} />
      <ul className={`mt-8 sm:grid-cols-2 lg:grid-cols-4 ${cardGrid}`}>
        {uses.cards.map((card) => (
          <li key={card.title}>
            <h3 className="text-16 leading-[1.3] font-semibold">{card.title}</h3>
            <p className="mt-2 text-15 text-ink-2">
              <Rich text={card.body} chip />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
