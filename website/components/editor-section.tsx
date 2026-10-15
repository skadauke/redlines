import type { ReactNode } from 'react';
import { editor } from '../lib/site';
import { Part } from './section';
import { RowLabel, docText } from './sheet';

/** Markdown syntax, as the editor shows it next to the caret. */
function Syntax({ children }: { children: ReactNode }) {
  return <span className="font-normal text-ink-3">{children}</span>;
}

function Caret() {
  return (
    <span aria-hidden="true" className="mx-px inline-block h-[1.15em] w-0.5 bg-ink align-[-0.2em]" />
  );
}

/** One sentence twice: the caret elsewhere, then inside the bold text. */
function CaretSheet() {
  return (
    <figure
      className="sheet"
      aria-label="The same sentence with the caret outside and inside the bold text"
    >
      <div className="px-6 py-5.5">
        <RowLabel>Caret after the sentence: syntax hidden</RowLabel>
        <p className={docText}>
          Please return the payroll forms within <strong>three days</strong>.
          <Caret />
        </p>
      </div>
      <div className="border-t border-rule px-6 py-5.5">
        <RowLabel>Caret in the bold text: syntax shown</RowLabel>
        <p className={docText}>
          Please return the payroll forms within{' '}
          <strong>
            <Syntax>**</Syntax>three
            <Caret /> days<Syntax>**</Syntax>
          </strong>
          .
        </p>
      </div>
    </figure>
  );
}

export function EditorSection() {
  return (
    <Part id="editor" title={editor.title} body={editor.body} points={editor.points}>
      <CaretSheet />
    </Part>
  );
}
