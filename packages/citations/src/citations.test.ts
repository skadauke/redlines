import { describe, expect, it } from 'vitest';
import {
  bibliographyRefs,
  formatBracket,
  formatNarrative,
  makeContext,
  parseBibliography,
  parseBibtex,
  parseBracket,
  parseCslJson,
  styleOfCsl,
} from './index.ts';

const BIB = `
@comment{ ignored @book{nope, author={X}} }
@string{acm = "ACM"}
@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {TeX}book},
  publisher = acm # " Press",
  year      = {1984}
}
@article{lamport1994,
  author = "Lamport, Leslie",
  title  = {{LaTeX}: A Document Preparation System},
  year   = 1994,
}
@article{pair,
  author = {Ada Lovelace and Charles Babbage},
  title  = {Notes},
  year   = {1843}
}
@article{three,
  author = {van der Berg, Anna and M{\\"u}ller, Hans and Ng, Li},
  title  = {Three},
  date   = {2001-05-02}
}
@article{many,
  author = {A One and B Two and C Three and D Four},
  title  = {Many},
  year   = {2010}
}
@article{same1,
  author = {Ada Lovelace}, title = {Beta}, year = {1843}
}
@techreport{org,
  author = {{World Health Organization}}, title = {Report}, year = {2020}
}
@misc{nodate, author = {Someone Else}, title = {Undated}}
`;

const ctx = (
  keys: string[],
  style: 'chicago-author-date' | 'apa' | 'numeric' = 'chicago-author-date',
) => makeContext(parseBibtex(BIB), style, keys);
const cite = (text: string, c = ctx(['knuth1984', 'lamport1994'])) =>
  formatBracket(parseBracket(text) ?? [], c);

describe('a BibTeX bibliography', () => {
  const bib = parseBibtex(BIB);

  it('reads the authors, the year and the title of each entry', () => {
    expect(bib.get('knuth1984')).toMatchObject({
      authors: [{ family: 'Knuth', given: 'Donald E.' }],
      year: '1984',
      title: 'The TeXbook',
    });
    expect(bib.get('lamport1994')?.authors).toEqual([{ family: 'Lamport', given: 'Leslie' }]);
    expect(bib.get('lamport1994')?.year).toBe('1994');
    expect([...bib.keys()]).not.toContain('nope');
  });

  it('reads particles, accents, a date field and an organization', () => {
    expect(bib.get('three')?.authors.map((n) => n.family)).toEqual([
      'van der Berg',
      'Müller',
      'Ng',
    ]);
    expect(bib.get('three')?.year).toBe('2001');
    expect(bib.get('org')?.authors).toEqual([{ family: 'World Health Organization' }]);
    expect(bib.get('nodate')?.year).toBeUndefined();
  });
});

describe('a CSL JSON bibliography', () => {
  it('reads the same facts', () => {
    const bib = parseCslJson(
      JSON.stringify([
        {
          id: 'knuth1984',
          author: [{ family: 'Knuth', given: 'Donald' }],
          issued: { 'date-parts': [[1984]] },
          title: 'The TeXbook',
        },
        { id: 'org', author: [{ literal: 'WHO' }], issued: { raw: '2020-01-01' } },
      ]),
    );
    expect(bib.get('knuth1984')).toMatchObject({ year: '1984', authors: [{ family: 'Knuth' }] });
    expect(bib.get('org')).toMatchObject({ year: '2020', authors: [{ family: 'WHO' }] });
    expect(parseBibliography('refs.json', '[{"id":"a","title":"A"}]').has('a')).toBe(true);
    expect(parseCslJson('not json').size).toBe(0);
  });
});

describe('Chicago author-date, pandoc’s default', () => {
  it('prints a citation as author and year', () => {
    expect(cite('[@knuth1984]')).toBe('(Knuth 1984)');
  });

  it('puts a page after a comma, without its label', () => {
    expect(cite('[@lamport1994, p. 4]')).toBe('(Lamport 1994, 4)');
    expect(cite('[@lamport1994, pp. 4-5]')).toBe('(Lamport 1994, 4–5)');
    expect(cite('[@lamport1994, chap. 2]')).toBe('(Lamport 1994, chap. 2)');
  });

  it('parts several citations with semicolons, and keeps a prefix', () => {
    expect(cite('[@lamport1994, p. 4; @knuth1984]')).toBe('(Lamport 1994, 4; Knuth 1984)');
    expect(cite('[see @knuth1984]')).toBe('(see Knuth 1984)');
  });

  it('leaves the author out of a citation that suppresses it', () => {
    expect(cite('[-@knuth1984]')).toBe('(1984)');
  });

  it('writes the names as the style does for two, three and many authors', () => {
    const c = ctx(['pair', 'three', 'many', 'org', 'nodate']);
    expect(cite('[@pair]', c)).toBe('(Lovelace and Babbage 1843)');
    expect(cite('[@three]', c)).toBe('(van der Berg, Müller, and Ng 2001)');
    expect(cite('[@many]', c)).toBe('(One et al. 2010)');
    expect(cite('[@org]', c)).toBe('(World Health Organization 2020)');
    expect(cite('[@nodate]', c)).toBe('(Else n.d.)');
  });

  it('adds a letter to two works of one author and year, and joins the same author', () => {
    const c = ctx(['pair', 'same1']);
    expect(cite('[@pair]', c)).toBe('(Lovelace and Babbage 1843)');
    const lovelace = makeContext(
      parseBibtex(
        '@a{x, author={Ada Lovelace}, title={Alpha}, year=1843}\n@a{y, author={Ada Lovelace}, title={Beta}, year=1843}\n@a{z, author={Ada Lovelace}, title={Gamma}, year=1850}',
      ),
      'chicago-author-date',
      ['x', 'y', 'z'],
    );
    expect(formatBracket(parseBracket('[@x]') ?? [], lovelace)).toBe('(Lovelace 1843a)');
    expect(formatBracket(parseBracket('[@y]') ?? [], lovelace)).toBe('(Lovelace 1843b)');
    expect(formatBracket(parseBracket('[@x; @y; @z]') ?? [], lovelace)).toBe(
      '(Lovelace 1843a, b, 1850)',
    );
  });

  it('puts the year in brackets after the name of a citation that is part of the sentence', () => {
    expect(formatNarrative('knuth1984', ctx(['knuth1984']))).toBe('Knuth (1984)');
  });

  it('leaves a citation of a work that is not there to the caller', () => {
    expect(cite('[@missing]')).toBeUndefined();
    expect(formatNarrative('missing', ctx([]))).toBeUndefined();
  });
});

describe('other styles', () => {
  it('prints APA with a comma, an ampersand and the label of a page', () => {
    const c = ctx(['knuth1984', 'pair'], 'apa');
    expect(cite('[@knuth1984, p. 4]', c)).toBe('(Knuth, 1984, p. 4)');
    expect(cite('[@pair]', c)).toBe('(Lovelace & Babbage, 1843)');
    expect(formatNarrative('knuth1984', c)).toBe('Knuth (1984)');
  });

  it('numbers works in the order they are first cited', () => {
    const c = ctx(['lamport1994', 'knuth1984'], 'numeric');
    expect(cite('[@knuth1984]', c)).toBe('[2]');
    expect(cite('[@knuth1984; @lamport1994]', c)).toBe('[1, 2]');
  });

  it('knows a style by its id or title, and no other', () => {
    expect(
      styleOfCsl(
        '<style><id>http://www.zotero.org/styles/apa</id><title>American Psychological Association 7th edition</title></style>',
      ),
    ).toBe('apa');
    expect(styleOfCsl('<id>http://www.zotero.org/styles/ieee</id><title>IEEE</title>')).toBe(
      'numeric',
    );
    expect(
      styleOfCsl(
        '<id>x/chicago-author-date</id><title>Chicago Manual of Style 17th edition (author-date)</title>',
      ),
    ).toBe('chicago-author-date');
    expect(styleOfCsl('<id>x/something</id><title>Something</title>')).toBeUndefined();
  });
});

describe('the front matter’s bibliography', () => {
  it('reads one file, a list in flow or block form, and the style', () => {
    expect(
      bibliographyRefs('---\ntitle: T\nbibliography: refs.bib\ncsl: apa.csl\n---\n\nText'),
    ).toEqual({
      files: ['refs.bib'],
      csl: 'apa.csl',
    });
    expect(bibliographyRefs('---\nbibliography: ["a.bib", \'b.json\']\n---\n')).toEqual({
      files: ['a.bib', 'b.json'],
    });
    expect(bibliographyRefs('---\nbibliography:\n  - a.bib\n  - b.bib\nx: 1\n---\n')).toEqual({
      files: ['a.bib', 'b.bib'],
    });
  });

  it('answers nothing for a document without one', () => {
    expect(bibliographyRefs('---\ntitle: T\n---\n')).toBeUndefined();
    expect(bibliographyRefs('bibliography: a.bib\n')).toBeUndefined();
  });
});
