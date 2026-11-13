import { describe, expect, it } from 'vitest';
import { findQuote, parseAnswer, selectionText } from './answer.ts';

describe('parseAnswer', () => {
  it('is all body when there is no Sources line', () => {
    expect(parseAnswer('A lien is a claim on property.\n')).toEqual({
      body: 'A lien is a claim on property.',
      sources: [],
    });
  });

  it('reads the numbered quotes after a Sources line', () => {
    const answer = parseAnswer(
      'A lien is a claim on property [1], held until the debt is paid [2].\n\nSources:\n[1] "the Lender shall hold a first lien"\n[2] “until paid in full”\n',
    );
    expect(answer.body).toBe('A lien is a claim on property [1], held until the debt is paid [2].');
    expect(answer.sources).toEqual([
      { n: 1, quote: 'the Lender shall hold a first lien' },
      { n: 2, quote: 'until paid in full' },
    ]);
  });

  it('takes bullets, numbers with a dot, backticks and bold on the Sources line', () => {
    const answer = parseAnswer(
      'It means X [1] and Y [2] and Z [3].\n\n**Sources:**\n- [1] `first words`\n2. second words\n* [3] "third words"',
    );
    expect(answer.sources).toEqual([
      { n: 1, quote: 'first words' },
      { n: 2, quote: 'second words' },
      { n: 3, quote: 'third words' },
    ]);
  });

  it('numbers quotes that have no number, in order', () => {
    const answer = parseAnswer('Body.\n\nSources:\n- "one"\n- "two"');
    expect(answer.sources).toEqual([
      { n: 1, quote: 'one' },
      { n: 2, quote: 'two' },
    ]);
  });

  it('uses the last Sources line, and leaves the body above it alone', () => {
    const answer = parseAnswer(
      'Sources: are listed below.\n\nBody text.\n\nSources:\n[1] "a quote"',
    );
    expect(answer.body).toBe('Sources: are listed below.\n\nBody text.');
    expect(answer.sources).toEqual([{ n: 1, quote: 'a quote' }]);
  });

  it('does not take a sentence that begins with "Sources" for the line', () => {
    expect(parseAnswer('Sources of funds are named in 3.2.').sources).toEqual([]);
  });

  it('skips empty entries, and the line breaks of any kind', () => {
    const answer = parseAnswer('Body.\r\n\r\nSources:\r\n[1] ""\r\n[2] "kept"\r\n');
    expect(answer.sources).toEqual([{ n: 2, quote: 'kept' }]);
  });

  it('trims the body and keeps its paragraphs', () => {
    expect(parseAnswer('\n\nOne.\n\nTwo.\n\n').body).toBe('One.\n\nTwo.');
  });
});

const NEWEST = 'The Lender shall hold a first lien on the property until paid in full.';

describe('findQuote', () => {
  it('finds an exact quote as a range of the document', () => {
    const range = findQuote(NEWEST, 'a first lien on the property');
    expect(range).toEqual({
      from: NEWEST.indexOf('a first lien'),
      to: NEWEST.indexOf(' until'),
    });
  });

  it('finds nothing for a quote that is not there, or is empty', () => {
    expect(findQuote(NEWEST, 'a second lien')).toBeNull();
    expect(findQuote(NEWEST, '   ')).toBeNull();
  });

  it('takes the first of several places', () => {
    expect(findQuote('lien and lien', 'lien')).toEqual({ from: 0, to: 4 });
  });

  it('matches across a different white space and curly quotes', () => {
    const text = 'He said “stop”  right\nthere.';
    expect(findQuote(text, 'said "stop" right there')).toEqual({ from: 3, to: text.length - 1 });
  });

  it('matches around an ellipsis, from the first words to the last', () => {
    const range = findQuote(NEWEST, 'The Lender shall hold … until paid in full');
    expect(range).toEqual({ from: 0, to: NEWEST.length - 1 });
  });

  it('reads the text as a reader does, across the markers of a change', () => {
    const text = 'The Lender <!--ins b2b2-->shall<!--/b2b2--> hold a lien.';
    const range = findQuote(text, 'Lender shall hold');
    expect(range).not.toBeNull();
    expect(text.slice(range?.from, range?.to)).toBe('Lender <!--ins b2b2-->shall<!--/b2b2--> hold');
  });

  it('does not find deleted text', () => {
    const text = 'The Lender <!--del c3c3 shall not-->hold a lien.';
    expect(findQuote(text, 'shall not')).toBeNull();
  });
});

describe('selectionText', () => {
  it('is the selected text as it reads, without markers', () => {
    const text = 'The Lender <!--ins b2b2-->shall<!--/b2b2--> hold a lien.';
    const from = text.indexOf('Lender');
    const to = text.indexOf(' lien');
    expect(selectionText(text, { from, to })).toBe('Lender shall hold a');
  });

  it('is the text itself in a plain document', () => {
    expect(selectionText('Hello world', { from: 6, to: 11 })).toBe('world');
  });
});
