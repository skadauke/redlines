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

  it('takes quotation marks off a quote only when they are on both sides', () => {
    const answer = parseAnswer(
      'Body.\n\nSources:\n[1] "both"\n[2] "open only\n[3] close only"\n[4] “curly”\n[5] \'single\'\n[6] `ticks`\n[7] "\'tis the season"',
    );
    expect(answer.sources.map(({ quote }) => quote)).toEqual([
      'both',
      '"open only',
      'close only"',
      'curly',
      'single',
      'ticks',
      'tis the season',
    ]);
  });

  it('keeps nothing of a quote that is all quotation marks', () => {
    expect(parseAnswer('Body.\n\nSources:\n[1] ""\n[2] """\n[3] "kept"').sources).toEqual([
      { n: 3, quote: 'kept' },
    ]);
  });
});

/**
 * An answer comes from an agent that read a document which may say anything: the page must not
 * freeze on it. These are lines that make a pattern backtrack, and each must be read in no time (a
 * pattern that gives way under them takes seconds; the app's own engine is slower than this one).
 */
describe('parseAnswer on answers built to be slow', () => {
  const fast = (text: string) => {
    const started = performance.now();
    const parsed = parseAnswer(text);
    expect(performance.now() - started).toBeLessThan(500);
    return parsed;
  };

  it('reads a line of 2,500 quotation marks', () => {
    const marks = '"'.repeat(2500);
    // Over 2,000 characters, the line is only text: not a source.
    expect(fast(`Body.\n\nSources:\n[1] ${marks}\n[2] "kept"`).sources).toEqual([
      { n: 2, quote: 'kept' },
    ]);
    // Under it, it is read, and holds nothing.
    expect(fast(`Body.\n\nSources:\n[1] ${'"'.repeat(1500)}\n[2] "kept"`).sources).toEqual([
      { n: 2, quote: 'kept' },
    ]);
    expect(fast(`Body.\n\nSources:\n[1] "${'a'.repeat(1900)}`).sources).toHaveLength(1);
  });

  it('reads a line of 20,000 spaces', () => {
    expect(fast(`${' '.repeat(20_000)}x`).body).toBe('x');
    // Before the Sources, and after them, where a line that long is more than the end of an answer
    // is searched for Sources, and they are not found.
    expect(fast(`${' '.repeat(20_000)}\n\nBody.\n\nSources:\n[1] "kept"`).sources).toEqual([
      { n: 1, quote: 'kept' },
    ]);
    expect(fast(`Body.\n\nSources:\n${' '.repeat(1990)}\n[1] "kept"`).sources).toEqual([
      { n: 1, quote: 'kept' },
    ]);
    expect(fast(`Body.\n\nSources:\n${' '.repeat(20_000)}\n[1] "kept"`).sources).toEqual([]);
    // A Sources line that is mostly spaces, and a word after them that makes it no Sources line.
    const parsed = fast(`Body.\n\nSources:${' '.repeat(1900)}x\n[1] "ignored"`);
    expect(parsed.sources).toEqual([]);
    expect(parsed.body).toContain('Body.');
    // A line of spaces and tabs and line breaks of every kind, with the entry after it.
    expect(
      fast(`Body.\n\nSources:\n${' \t'.repeat(900)}\r\r${' '.repeat(1900)}\n[1] "kept"`).sources,
    ).toEqual([{ n: 1, quote: 'kept' }]);
  });

  it('reads 100,000 characters of “[1] ” repeated', () => {
    const run = '[1] '.repeat(25_000);
    expect(fast(run).sources).toEqual([]);
    expect(fast(run).body).toBe(run.trim());
    // Before the Sources it is the body, and the entries after it are read.
    expect(fast(`${run}\n\nSources:\n[2] "kept"`).sources).toEqual([{ n: 2, quote: 'kept' }]);
    // As a line of the list it is one of text, not a source, and the entries after it are read.
    const long = fast(`Body.\n\nSources:\n${'[1] '.repeat(500)}\n[2] "kept"`);
    expect(long.sources.at(-1)).toEqual({ n: 2, quote: 'kept' });
    expect(fast(`Body.\n\nSources:\n${run}`).sources).toEqual([]);
    // Many short entries are read, all of them.
    const many = Array.from({ length: 500 }, (_, i) => `[${i + 1}] "quote ${i + 1}"`).join('\n');
    expect(fast(`Body.\n\nSources:\n${many}`).sources).toHaveLength(500);
  });

  it('treats a line over 2,000 characters as text, even where Sources would be', () => {
    // The Sources line, with a long tail of spaces: too long to be one, so the entries are no list.
    const parsed = parseAnswer(`Body.\n\nSources:${' '.repeat(2100)}\n[1] "a quote"`);
    expect(parsed.sources).toEqual([]);
    expect(parsed.body).toContain('[1] "a quote"');
    // At the limit it still is one.
    const atLimit = parseAnswer(`Body.\n\nSources:${' '.repeat(1990)}\n[1] "a quote"`);
    expect(atLimit.sources).toEqual([{ n: 1, quote: 'a quote' }]);
  });

  it('looks for the Sources only in the last 20,000 characters', () => {
    const filler = 'More words of prose.\n'.repeat(1500);
    const far = parseAnswer(`Body.\n\nSources:\n[1] "a quote"\n${filler}`);
    expect(far.sources).toEqual([]);
    expect(far.body).toContain('Sources:');
    const near = parseAnswer(`${filler}Sources:\n[1] "a quote"`);
    expect(near.sources).toEqual([{ n: 1, quote: 'a quote' }]);
    expect(near.body.endsWith('prose.')).toBe(true);
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

  describe('where a quote stands as words', () => {
    it('does not find “lien” in “alien”, and finds it where it is a word', () => {
      expect(findQuote('An alien claim.', 'lien')).toBeNull();
      const text = 'An alien claim, and a lien.';
      const at = text.indexOf('lien.');
      expect(findQuote(text, 'lien')).toEqual({ from: at, to: at + 4 });
    });

    it('finds nothing in a longer word on either side', () => {
      expect(findQuote('A relieved party.', 'lie')).toBeNull();
      expect(findQuote('The Lender shall hold an item.', 'hold a')).toBeNull();
      expect(findQuote('A lienholder.', 'lien')).toBeNull();
      expect(findQuote('Clause 13.25 applies.', '3.2')).toBeNull();
      expect(findQuote('Rate: 3.2% a year.', '3.2')).not.toBeNull();
    });

    it('needs an edge only where the quote ends in a letter or a digit', () => {
      // Brackets, quotation marks and a full stop are no part of a word: they may touch one.
      expect(findQuote('foo(bar)baz', '(bar)')).toEqual({ from: 3, to: 8 });
      expect(findQuote('say"stop"now', '"stop"')).toEqual({ from: 3, to: 9 });
      expect(findQuote('a lien.Next', 'lien.')).toEqual({ from: 2, to: 7 });
      // A letter on the side that wants an edge is still refused.
      expect(findQuote('foo(bar)baz', 'bar)b')).toBeNull();
    });

    it('takes accented letters, other scripts and digits for parts of words', () => {
      expect(findQuote('La résiliation du bail.', 'siliation')).toBeNull();
      expect(findQuote('La résiliation du bail.', 'résiliation')).not.toBeNull();
      expect(findQuote('Le café est ouvert.', 'caf')).toBeNull();
      expect(findQuote('契約解除の条件', '契約')).toBeNull();
      expect(findQuote('契約 解除', '契約')).toEqual({ from: 0, to: 2 });
    });

    it('stays at the edge of the text and finds a quote that fills it', () => {
      expect(findQuote('lien', 'lien')).toEqual({ from: 0, to: 4 });
      expect(findQuote('a lien', 'lien')).toEqual({ from: 2, to: 6 });
      expect(findQuote('lien a', 'lien')).toEqual({ from: 0, to: 4 });
    });

    it('goes on to a later place where an earlier one is part of a word', () => {
      const text = 'alien, then lien, then alien again.';
      expect(findQuote(text, 'lien')).toEqual({ from: 12, to: 16 });
    });

    it('holds for a quote that is found across white space and curly quotes', () => {
      expect(findQuote('He said “stop”  right\nthere.', 'said "stop" right there')).not.toBeNull();
      expect(findQuote('He said “stop”  right\nthere.', 'aid "stop" right there')).toBeNull();
    });
  });

  it('is nothing for a quote of one character, which is in every word', () => {
    const text = 'The Lender shall hold a lien.';
    expect(findQuote(text, 'a')).toBeNull();
    expect(findQuote(text, ' a ')).toBeNull();
    expect(findQuote(text, '5')).toBeNull();
    expect(findQuote('Pay $5 now.', '$5')).toEqual({ from: 4, to: 6 });
    // Two characters are enough, and a pair counts as one.
    expect(findQuote(text, 'a lien')).not.toBeNull();
    expect(findQuote('A 𝒜 here.', '𝒜')).toBeNull();
  });

  describe('where a quote is in several places', () => {
    const text = 'The Lender shall pay. Later: the Lender shall hold a lien. The Lender shall pay.';
    const quote = 'The Lender shall pay';
    const second = text.lastIndexOf(quote);

    it('is the one nearest the selection', () => {
      expect(findQuote(text, quote, second - 3)).toEqual({
        from: second,
        to: second + quote.length,
      });
      expect(findQuote(text, quote, text.length)).toEqual({
        from: second,
        to: second + quote.length,
      });
      expect(findQuote(text, quote, 5)).toEqual({ from: 0, to: quote.length });
      // Between the two: the nearer of them, which is the first at 29 and the second at 30.
      expect(findQuote(text, quote, 29)).toEqual({ from: 0, to: quote.length });
      expect(findQuote(text, quote, 30)).toEqual({ from: second, to: second + quote.length });
    });

    it('is the first with no selection to go by', () => {
      expect(findQuote(text, quote)).toEqual({ from: 0, to: quote.length });
    });

    it('is the earlier of two that are as near', () => {
      expect(findQuote('lien aaaa lien', 'lien', 5)).toEqual({ from: 0, to: 4 });
      expect(findQuote('lien aaaa lien', 'lien', 6)).toEqual({ from: 10, to: 14 });
    });

    it('measures the selection in the document, markers and all, and gives the range in it', () => {
      const marked =
        'Intro <!--ins k3x9-->lien<!--/k3x9--> and some words in between them here. And a lien again.';
      const first = marked.indexOf('lien');
      const again = marked.lastIndexOf('lien');
      // The caret just after the first insertion's closer: it is nearest the first lien, though
      // the markers put it as far along the file as the second.
      const afterCloser = marked.indexOf('<!--/k3x9-->') + '<!--/k3x9-->'.length;
      expect(findQuote(marked, 'lien', afterCloser)).toEqual({ from: first, to: first + 4 });
      expect(findQuote(marked, 'lien', again)).toEqual({ from: again, to: again + 4 });
    });

    it('is the nearest start of a quote with an ellipsis, with its last part after it', () => {
      const long =
        'The Lender shall hold a lien until paid in full. Elsewhere: The Lender shall hold a lien until paid in full.';
      const quoted = 'The Lender shall hold … paid in full';
      const again = long.lastIndexOf('The Lender shall hold');
      const firstEnd = long.indexOf('paid in full') + 'paid in full'.length;
      expect(findQuote(long, quoted)).toEqual({ from: 0, to: firstEnd });
      expect(findQuote(long, quoted, again + 4)).toEqual({ from: again, to: long.length - 1 });
    });

    it('goes back to an earlier place when the nearest has no last part after it', () => {
      const long = 'The Lender shall hold it, paid in full. Then The Lender shall hold a lien.';
      const end = long.indexOf('paid in full') + 'paid in full'.length;
      // The second "The Lender shall hold" is nearest, and nothing after it says "paid in full".
      expect(findQuote(long, 'The Lender shall hold … paid in full', long.length)).toEqual({
        from: 0,
        to: end,
      });
    });
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
