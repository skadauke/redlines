// The check against GitHub (#687): README-style snippets are rendered the way GitHub does, with
// micromark and GFM (its tag filter included), and cleaned by a sanitizer that follows GitHub's
// (hast-util-sanitize, given html-pipeline's own list, transcribed below). The same tree is then cleaned by Redlines' list
// (`@redlines/format`, `github-html.ts`), the list every drawing of HTML reads. The two must keep the
// same elements, the same text and the same addresses. Both
// libraries are development dependencies only.

import {
  GITHUB_ATTRIBUTES,
  GITHUB_ELEMENTS,
  GITHUB_ELEMENT_ATTRIBUTES,
  isAddressAttribute,
  isAllowedAddress,
  isAllowedAttribute,
  isAllowedElement,
  GFM_ESCAPED_TAGS,
} from '@redlines/format';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { sanitize } from 'hast-util-sanitize';
import type { Schema } from 'hast-util-sanitize';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { micromark } from 'micromark';
import { find, html as htmlSchema } from 'property-information';
import { describe, expect, it } from 'vitest';

type Node = Root | RootContent;

/** GFM's HTML for a snippet, with raw HTML allowed and its tag filter on, as GitHub starts from. */
function render(markdown: string): string {
  return micromark(markdown, {
    allowDangerousHtml: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
}

/** What a drawing keeps of a snippet: its elements in order, its text, and the addresses it kept. */
interface Drawn {
  elements: string[];
  text: string;
  addresses: string[];
}

function summarize(tree: Node): Drawn {
  const drawn: Drawn = { elements: [], text: '', addresses: [] };
  const walk = (node: Node | ElementContent): void => {
    if (node.type === 'text') drawn.text += node.value;
    if (node.type === 'element') {
      drawn.elements.push(node.tagName);
      for (const name of ['href', 'src', 'cite', 'longDesc']) {
        const value = node.properties[name];
        if (typeof value === 'string') drawn.addresses.push(`${node.tagName} ${name}=${value}`);
      }
    }
    if ('children' in node) node.children.forEach(walk);
  };
  walk(tree);
  drawn.text = drawn.text.replace(/\s+/g, ' ').trim();
  return drawn;
}

// html-pipeline's list, as written in its SanitizationFilter (commit 492ab84, the one #686 cites),
// and Selma's protocols (http, https, mailto and relative). Transcribed here, apart from the module
// that is held to it.
const THEIRS = {
  elements: `h1 h2 h3 h4 h5 h6 br b i strong em a pre code img tt div ins del sup sub p picture ol ul
    table thead tbody tfoot blockquote dl dt dd kbd q samp var hr ruby rt rp li tr td th s strike
    summary details caption figure figcaption abbr bdo cite dfn mark small source span time wbr`,
  all: `abbr accept accept-charset accesskey action align alt aria-describedby aria-hidden aria-label
    aria-labelledby axis border char charoff charset checked clear cols colspan compact coords
    datetime dir disabled enctype for frame headers height hreflang hspace id ismap label lang
    maxlength media method multiple name nohref noshade nowrap open progress prompt readonly rel rev
    role rows rowspan rules scope selected shape size span start summary tabindex title type usemap
    valign value width itemprop`,
  own: {
    a: 'href',
    img: 'src longdesc loading alt',
    div: 'itemscope itemtype',
    blockquote: 'cite',
    del: 'cite',
    ins: 'cite',
    q: 'cite',
    source: 'srcset',
  } as Record<string, string>,
};
const words = (list: string): string[] => list.split(/\s+/).filter(Boolean);

/** html-pipeline's list as a schema for hast-util-sanitize (which names attributes as properties). */
const GITHUB_SCHEMA: Schema = {
  tagNames: words(THEIRS.elements),
  attributes: {
    '*': words(THEIRS.all).map((name) => find(htmlSchema, name).property),
    ...Object.fromEntries(
      Object.entries(THEIRS.own).map(([tag, names]) => [
        tag,
        words(names).map((name) => find(htmlSchema, name).property),
      ]),
    ),
  },
  protocols: {
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
    longDesc: ['http', 'https'],
    cite: ['http', 'https'],
  },
  strip: ['script'],
  clobber: [],
  clobberPrefix: '',
  ancestors: {},
};

/** The tree as GitHub's own list leaves it. */
function byGitHub(html: string): Drawn {
  return summarize(sanitize(fromHtml(html, { fragment: true }), GITHUB_SCHEMA));
}

/** The tree as Redlines' list leaves it: a dropped element's tags go and its text stays. */
function byRedlines(html: string): Drawn {
  const clean = (nodes: ElementContent[]): ElementContent[] =>
    nodes.flatMap((node): ElementContent[] => {
      if (node.type !== 'element') return node.type === 'text' ? [node] : [];
      const children = clean(node.children);
      const name = node.tagName;
      if (!isAllowedElement(name)) return children;
      const properties: Element['properties'] = {};
      for (const [property, value] of Object.entries(node.properties)) {
        const attribute = property === 'className' ? 'class' : property.toLowerCase();
        if (!isAllowedAttribute(name, attribute)) continue;
        if (
          isAddressAttribute(name, attribute) &&
          !isAllowedAddress(name, attribute, String(value))
        )
          continue;
        properties[property] = value;
      }
      return [{ ...node, properties, children }];
    });
  const tree = fromHtml(html, { fragment: true });
  return summarize({
    ...tree,
    children: clean(tree.children as ElementContent[]) as Root['children'],
  });
}

const SNIPPETS: Record<string, string> = {
  'centered logo': '<p align="center">\n  <img src="logo.png" alt="Logo" width="200">\n</p>\n',
  'badges row':
    '<a href="https://ci.example.com"><img src="https://img.example.com/b.svg" alt="build"></a>',
  keys: 'Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy.',
  mark: 'This is <mark>important</mark> text.',
  'small and sub/sup': 'H<sub>2</sub>O and E = mc<sup>2</sup>, <small>fine print</small>.',
  abbr: 'The <abbr title="World Health Organization">WHO</abbr> said so.',
  'dfn cite q': '<dfn>Term</dfn> by <cite>Someone</cite>: <q>quoted</q>.',
  time: 'Shipped <time datetime="2026-11-16">today</time>.',
  'span with style': 'A <span style="color:red" class="x">red</span> word.',
  bdo: '<bdo dir="rtl">right to left</bdo>',
  ruby: '<ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby>',
  'ins del s strike': '<ins>added</ins> <del>removed</del> <s>struck</s> <strike>old</strike>',
  'samp var tt': '<samp>out</samp> <var>x</var> <tt>mono</tt>',
  'html forms of markdown': '<b>b</b> <i>i</i> <strong>s</strong> <em>e</em> <code>c</code>',
  'link with attributes': '<a href="/docs" target="_blank" onclick="x()" class="btn">Docs</a>',
  'javascript link': '<a href="javascript:alert(1)">click</a>',
  'obfuscated javascript link': '<a href="java\nscript:alert(1)">click</a>',
  'data image': '<img src="data:image/png;base64,AAAA" alt="x">',
  'mailto link': '<a href="mailto:me@example.com">mail</a>',
  'relative link': '<a href="../CONTRIBUTING.md">contributing</a>',
  breaks: 'one<br>two<br/>three<wbr>four',
  underline: 'An <u>underlined</u> word.',
  'font and center': '<center><font color="red">old school</font></center>',
  'unknown tag': 'A <blink>blinking</blink> and <foo bar="1">custom</foo> tag.',
  'escaped script': 'Before <script>alert(1)</script> after.',
  'escaped style': '<style>p { color: red }</style>\n\ntext',
  'escaped iframe': '<iframe src="https://example.com"></iframe>',
  'escaped textarea and title': '<textarea>t</textarea> <title>t</title>',
  'escaped xmp noembed noframes plaintext':
    '<xmp>a</xmp> <noembed>b</noembed> <noframes>c</noframes> <plaintext>d',
  video: '<video src="movie.mp4" controls></video>',
  'svg and button':
    '<svg width="10"><circle r="4"/></svg> <button>Go</button> <input type="checkbox">',
  details: '<details>\n<summary>More</summary>\n\nHidden **text**.\n\n</details>',
  'table with spans':
    '<table>\n<tr><th colspan="2">Head</th></tr>\n<tr><td>a</td><td>b</td></tr>\n</table>',
  'description list': '<dl><dt>Term</dt><dd>Meaning</dd></dl>',
  figure: '<figure><img src="a.png" alt="a"><figcaption>Caption</figcaption></figure>',
  picture:
    '<picture><source media="(prefers-color-scheme: dark)" srcset="dark.png"><img src="light.png" alt="l"></picture>',
  heading: '<h1 align="center">Title</h1>',
  'blockquote cite': '<blockquote cite="https://example.com">Quoted</blockquote>',
  'ins cite': '<ins cite="javascript:x">late</ins> <q cite="https://a.example">q</q>',
  longdesc: '<img src="a.png" alt="a" longdesc="javascript:x">',
  'control character link': '<a href="&#1;javascript:alert(1)">click</a>',
  'entity link': '<a href="&#106;avascript:alert(1)">click</a>',
  'div with markdown': '<div align="center">\n\n**Bold** inside\n\n</div>',
  'html comment': 'before <!-- hidden --> after',
};

describe('the check against GitHub', () => {
  for (const [name, snippet] of Object.entries(SNIPPETS)) {
    it(`keeps what GitHub keeps: ${name}`, () => {
      const html = render(snippet);
      expect(byRedlines(html)).toEqual(byGitHub(html));
    });
  }

  it('shows the nine tags GFM escapes as text', () => {
    expect(GFM_ESCAPED_TAGS.size).toBe(9);
    for (const tag of GFM_ESCAPED_TAGS) {
      expect(render(`<${tag}>x</${tag}>`)).toContain(`&lt;${tag}>`);
      expect(isAllowedElement(tag)).toBe(false);
    }
  });

  it('allows no element, protocol or attribute GitHub drops', () => {
    for (const tag of ['script', 'style', 'iframe', 'u', 'font', 'center', 'video', 'svg']) {
      expect(isAllowedElement(tag)).toBe(false);
    }
    expect(isAllowedAttribute('span', 'style')).toBe(false);
    expect(isAllowedAttribute('span', 'class')).toBe(false);
    expect(isAllowedAttribute('a', 'onclick')).toBe(false);
    expect(isAllowedAddress('a', 'href', 'javascript:alert(1)')).toBe(false);
    expect(isAllowedAddress('a', 'href', ' JaVa\tScRiPt:alert(1)')).toBe(false);
    expect(isAllowedAddress('img', 'src', 'data:image/png;base64,AA')).toBe(false);
    expect(isAllowedAddress('a', 'href', 'mailto:a@b.c')).toBe(true);
    expect(isAllowedAddress('a', 'href', '../x.md#top')).toBe(true);
  });

  it('is html-pipeline’s list, element for element and attribute for attribute', () => {
    expect([...GITHUB_ELEMENTS].sort()).toEqual(words(THEIRS.elements).sort());
    expect([...GITHUB_ATTRIBUTES].sort()).toEqual(words(THEIRS.all).sort());
    const own = Object.fromEntries(
      Object.entries(GITHUB_ELEMENT_ATTRIBUTES).map(([tag, names]) => [tag, [...names].sort()]),
    );
    const theirOwn = Object.fromEntries(
      Object.entries(THEIRS.own).map(([tag, names]) => [tag, words(names).sort()]),
    );
    // `alt` is on every element in their list already, so their per-element `alt` is no addition.
    theirOwn['img'] = (theirOwn['img'] as string[]).filter((name) => name !== 'alt');
    expect(own).toEqual(theirOwn);
  });
});
