import { aiDocs } from '../lib/site';
import { product } from '../site.config.mjs';
import { Part } from './section';
import { RowLabel, docText } from './sheet';

const markdown = `## Retries

| Error   | Tries | Wait |
| ------- | ----- | ---- |
| Timeout | 5     | 2 s  |
| 503     | 3     | 10 s |

**Next:** add *jitter*.`;

const cell = 'border-b border-rule py-1.25 pr-2.5 text-left';

/** The same short design doc as raw Markdown and as the editor shows it. */
function RawVersusRendered() {
  return (
    <figure
      className="sheet grid grid-cols-1 sm:grid-cols-2"
      aria-label={`A Markdown file as raw text and as ${product.name} shows it`}
    >
      <div className="min-w-0 p-5.5">
        <RowLabel>design.md in a text editor</RowLabel>
        {/* Focusable, so the lines that run out of view can be scrolled with keys. */}
        <pre
          tabIndex={0}
          className="overflow-x-auto font-mono text-13 leading-[1.65] whitespace-pre text-ink-2"
        >
          {markdown}
        </pre>
      </div>
      <div className={`min-w-0 border-rule p-5.5 max-sm:border-t sm:border-l ${docText}`}>
        <RowLabel>design.md in {product.name}</RowLabel>
        <p className="text-18 font-bold">Retries</p>
        <table className="mt-2 w-full text-14">
          <thead>
            <tr>
              <th className={cell}>Error</th>
              <th className={cell}>Tries</th>
              <th className={cell}>Wait</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr>
              <td className={cell}>Timeout</td>
              <td className={cell}>5</td>
              <td className={cell}>2 s</td>
            </tr>
            <tr>
              <td className={cell}>503</td>
              <td className={cell}>3</td>
              <td className={cell}>10 s</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2.5">
          <strong>Next:</strong> add <em>jitter</em>.
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
