import { aiDocs } from '../lib/site';
import { product } from '../site.config.mjs';
import { Part } from './section';
import { RowLabel, docText } from './sheet';

const markdown = `## Findings

| Arm     | n  | Response |
| ------- | -- | -------- |
| Placebo | 42 | 18%      |
| Drug    | 40 | 47%      |

**Next:** confirm in a *larger* cohort.`;

const cell = 'border-b border-rule py-1.25 pr-2.5 text-left';

/** The same short report as raw Markdown and as the editor shows it. */
function RawVersusRendered() {
  return (
    <figure
      className="sheet grid grid-cols-1 sm:grid-cols-2"
      aria-label={`A Markdown file as raw text and as ${product.name} shows it`}
    >
      <div className="min-w-0 p-5.5">
        <RowLabel>report.md in a text editor</RowLabel>
        {/* Focusable, so the lines that run out of view can be scrolled with keys. */}
        <pre
          tabIndex={0}
          className="overflow-x-auto font-mono text-13 leading-[1.65] whitespace-pre text-ink-2"
        >
          {markdown}
        </pre>
      </div>
      <div className={`min-w-0 border-rule p-5.5 max-sm:border-t sm:border-l ${docText}`}>
        <RowLabel>report.md in {product.name}</RowLabel>
        <p className="text-18 font-bold">Findings</p>
        <table className="mt-2 w-full text-14">
          <thead>
            <tr>
              <th className={cell}>Arm</th>
              <th className={cell}>n</th>
              <th className={cell}>Response</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr>
              <td className={cell}>Placebo</td>
              <td className={cell}>42</td>
              <td className={cell}>18%</td>
            </tr>
            <tr>
              <td className={cell}>Drug</td>
              <td className={cell}>40</td>
              <td className={cell}>47%</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2.5">
          <strong>Next:</strong> confirm in a <em>larger</em> cohort.
        </p>
      </div>
    </figure>
  );
}

export function AiDocsSection() {
  return (
    <Part id="ai" title={aiDocs.title} body={aiDocs.body} points={aiDocs.points} flip>
      <RawVersusRendered />
    </Part>
  );
}
