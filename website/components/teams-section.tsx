import { teams } from '../lib/site';
import { Rich, SectionTitle, cardGrid } from './section';

export function TeamsSection() {
  return (
    <section id="teams" aria-labelledby="teams-title" className="border-t border-rule py-16">
      <SectionTitle id="teams-title">{teams.title}</SectionTitle>
      <ul className={`mt-8 sm:grid-cols-2 lg:grid-cols-3 ${cardGrid}`}>
        {teams.cards.map((card) => (
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
