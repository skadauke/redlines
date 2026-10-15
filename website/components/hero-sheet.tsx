import { Fragment } from 'react';
import { Badge, Caption, DocTitle, Dot, docText } from './sheet';
import { ViewSwitch } from './view-switch';

// The hero illustration: one short document with tracked changes and a
// comment, in the editor's three views. Plain markup, no screenshot. The Raw
// view is the file as saved, in the format's syntax (docs/format.md): short
// markers, with each mark's author and time in the ledger at the end. Keep it
// in step with the other two views, and with the format if its syntax changes.

const source = `# Launch plan

We will ship the <!--ins k3x9-->new <!--/k3x9-->importer in <!--sub p7qd March-->April<!--/p7qd-->, after the <!--cmt c8d2-->security review<!--/c8d2-->.<!--del w2rf  The old exporter stays as it is.-->

<!-- redlines
# If git shows a merge conflict in this block, keep both sides. The order of entries doesn't matter.
people:
  ada: {name: Ada Lovelace}
  bo: {name: Bo Chen}
  claude-ada: {name: Claude, agent: true, for: ada}
marks:
  k3x9: {by: ada, at: 2026-10-13T22:30Z}
  p7qd: {by: claude-ada, at: 2026-10-13T22:31Z}
  w2rf: {by: bo, at: 2026-10-13T22:35Z}
comments:
  c8d2:
    by: bo
    at: 2026-10-13T22:40Z
    text: Who signs off on the security review?
-->`;

/** Tracked-change marks, in their author's color. */
const ins = 'underline decoration-2 underline-offset-3';
const del = 'line-through decoration-2';

function RedlinesView() {
  return (
    <>
      <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,1fr)_210px]">
        <div className={docText}>
          <DocTitle>Launch plan</DocTitle>
          <p>
            We will ship the <ins className={`${ins} text-ada`}>new </ins>importer in{' '}
            <del className={`${del} text-claude`}>March</del>
            <ins className={`${ins} text-claude`}>April</ins>, after the{' '}
            <mark className="rounded-[3px] bg-note px-0.5 text-inherit">security review</mark>.
            <del className={`${del} text-bo`}> The old exporter stays as it is.</del>
          </p>
        </div>
        <div className="grid gap-2.5">
          <div className="rounded-[10px] border border-rule bg-sheet px-3 py-2.5 text-13 leading-[1.45]">
            <div className="flex items-center gap-1.75 font-semibold">
              <Dot who="claude" />
              Claude <Badge>for Ada</Badge>
            </div>
            <div className="mt-1 text-ink-2">Replaced “March” with “April”</div>
            <div aria-hidden="true" className="mt-2 flex gap-1.5">
              <span className="rounded-md border border-rule px-2 py-0.75 font-semibold text-ink-2">
                Accept
              </span>
              <span className="rounded-md border border-rule px-2 py-0.75 font-semibold text-ink-2">
                Reject
              </span>
            </div>
          </div>
          <div className="rounded-[10px] border border-rule bg-sheet px-3 py-2.5 text-13 leading-[1.45]">
            <div className="flex items-center gap-1.75 font-semibold">
              <Dot who="bo" />
              Bo
            </div>
            <div className="mt-1 text-ink-2">Who signs off on the security review?</div>
          </div>
        </div>
      </div>
      <Caption>
        Ada added “new”. Claude, working for Ada, suggested “April”. Bo deleted a sentence and
        asked a question.
      </Caption>
    </>
  );
}

function CleanView() {
  return (
    <>
      <div className={docText}>
        <DocTitle>Launch plan</DocTitle>
        <p>We will ship the new importer in April, after the security review.</p>
      </div>
      <Caption>Every change accepted. GitHub and other Markdown apps show this version.</Caption>
    </>
  );
}

/**
 * The file on disk: the heading in red, the HTML comments dimmed. Markers
 * inside a line never break across lines; the line breaks between them.
 */
function RawView() {
  return (
    <>
      <pre className="font-mono text-13 leading-[1.7] wrap-break-word whitespace-pre-wrap text-ink">
        {source.split(/(<!--[\s\S]*?-->|^# .*$)/m).map((part, i) =>
          part.startsWith('<!--') && part.includes('\n') ? (
            <span key={i} className="text-ink-3">
              {part}
            </span>
          ) : part.startsWith('<!--') ? (
            <Fragment key={i}>
              <wbr />
              <span className="whitespace-pre text-ink-3">{part}</span>
              <wbr />
            </Fragment>
          ) : part.startsWith('# ') ? (
            <span key={i} className="text-red">
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </pre>
      <Caption>
        The file itself. Changes are short HTML comments; who made them and when, and the comment
        threads, are in a block at the end. It stays plain Markdown.
      </Caption>
    </>
  );
}

export function HeroSheet() {
  return (
    <ViewSwitch
      file="plan.md"
      label="How to show the document"
      initial="redlines"
      views={[
        { id: 'clean', label: 'Clean', content: <CleanView /> },
        // The view's name, the common word for marked-up changes, not the product's.
        { id: 'redlines', label: 'Redlines', content: <RedlinesView /> },
        { id: 'raw', label: 'Raw', content: <RawView /> },
      ]}
    />
  );
}
