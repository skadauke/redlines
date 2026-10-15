import { compare } from '../lib/site';
import { YesNo, YesNoSymbols } from './icons';
import { SectionBody, SectionTitle } from './section';

const cell = 'border-b border-rule px-3.5 py-2.75 text-center';
/** The column of the product this page is about. */
const ours = 'bg-red-soft/55';

// One row per feature, one column per product. On narrow screens the table
// keeps its width and scrolls sideways in its box.
export function CompareSection() {
  return (
    <section id="compare" aria-labelledby="compare-title" className="border-t border-rule py-16">
      <SectionTitle id="compare-title">{compare.title}</SectionTitle>
      <SectionBody text={compare.body} className="mt-3" />
      <YesNoSymbols />
      {/* Focusable, so it can be scrolled with keys when it's wider than the screen. */}
      <div
        role="region"
        aria-label={compare.table}
        tabIndex={0}
        className="mt-7 overflow-x-auto rounded-sheet border border-rule bg-sheet"
      >
        <table className="w-full min-w-[640px] text-15">
          <thead>
            <tr className="text-14 whitespace-nowrap">
              <th scope="col" className={cell}>
                <span className="sr-only">{compare.feature}</span>
              </th>
              {compare.products.map((product, i) => (
                <th
                  key={product}
                  scope="col"
                  className={`${cell} font-semibold ${i === 0 ? `${ours} text-ink` : 'text-ink-2'}`}
                >
                  {product}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&>tr:last-child>*]:border-b-0">
            {compare.rows.map((row) => (
              <tr key={row.feature}>
                <th scope="row" className={`${cell} text-left font-medium text-ink`}>
                  {row.feature}
                </th>
                {row.support.map((yes, i) => (
                  <td
                    key={compare.products[i]}
                    title={`${compare.products[i]}: ${(yes ? compare.yes : compare.no).toLowerCase()}`}
                    className={`${cell} ${i === 0 ? ours : ''}`}
                  >
                    <YesNo yes={yes} label={yes ? compare.yes : compare.no} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
