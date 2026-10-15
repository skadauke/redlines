import { developers } from '../lib/site';
import { Rich, SectionTitle, cardGrid } from './section';

export function DevelopersSection() {
  return (
    <section
      id="developers"
      aria-labelledby="developers-title"
      className="border-t border-rule py-16"
    >
      <SectionTitle id="developers-title">{developers.title}</SectionTitle>
      <ul className={`mt-8 sm:grid-cols-2 lg:grid-cols-3 ${cardGrid}`}>
        {developers.cards.map((card) => (
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
