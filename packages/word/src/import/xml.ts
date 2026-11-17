// A small XML reader for the parts of a .docx. It resolves namespaces, so that the code reading a
// part asks for `w:p` whatever prefix the file chose (Word, Google Docs and the `docx` library each
// pick their own), and it keeps the text of every element as it is, spaces included.

export interface XmlElement {
  /** `prefix:local` with the prefix this reader chose for the namespace (see `NAMESPACES`). */
  name: string;
  /** Attributes by the same naming; `xmlns` declarations are left out. */
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

/** The prefix this reader uses for each namespace it knows. */
const NAMESPACES: Record<string, string> = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
  'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w',
  'http://schemas.microsoft.com/office/word/2010/wordml': 'w14',
  'http://schemas.microsoft.com/office/word/2012/wordml': 'w15',
  'http://schemas.microsoft.com/office/word/2016/wordml/cid': 'w16cid',
  'http://schemas.microsoft.com/office/word/2018/wordml/cex': 'w16cex',
  'http://schemas.microsoft.com/office/word/2018/wordml': 'w16',
  'http://schemas.microsoft.com/office/word/2023/wordml/word16du': 'w16du',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic',
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'wp',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape': 'wps',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'http://schemas.openxmlformats.org/officeDocument/2006/math': 'm',
  'urn:schemas-microsoft-com:vml': 'v',
};

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** A name with the prefix this reader chose for its namespace; unknown namespaces keep theirs. */
function qualify(name: string, scope: Map<string, string>, isAttribute: boolean): string {
  const colon = name.indexOf(':');
  const prefix = colon < 0 ? '' : name.slice(0, colon);
  const local = colon < 0 ? name : name.slice(colon + 1);
  if (prefix === '' && isAttribute) return local;
  const uri = scope.get(prefix);
  const chosen = uri === undefined ? undefined : NAMESPACES[uri];
  if (chosen) return `${chosen}:${local}`;
  return prefix === '' ? local : name;
}

interface Open {
  element: XmlElement;
  scope: Map<string, string>;
  raw: string;
}

/** Parses a document. Throws on text that isn't well formed. */
export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [] };
  const stack: Open[] = [{ element: root, scope: new Map(), raw: '' }];
  const top = (): Open => stack[stack.length - 1] as Open;
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      if (text.slice(i).trim() !== '') throw new Error('XML: text after the last element');
      break;
    }
    if (lt > i && stack.length > 1) top().element.children.push(decode(text.slice(i, lt)));
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) throw new Error('XML: a comment is not closed');
      i = end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0) throw new Error('XML: a CDATA section is not closed');
      if (stack.length > 1) top().element.children.push(text.slice(lt + 9, end));
      i = end + 3;
    } else if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) throw new Error('XML: a processing instruction is not closed');
      i = end + 2;
    } else if (text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt + 2);
      if (end < 0) throw new Error('XML: a declaration is not closed');
      i = end + 1;
    } else if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt + 2);
      if (end < 0) throw new Error('XML: an end tag is not closed');
      const raw = text.slice(lt + 2, end).trim();
      if (stack.length < 2 || top().raw !== raw) throw new Error(`XML: unexpected </${raw}>`);
      stack.pop();
      i = end + 1;
    } else {
      // A start tag. Attribute values may hold `>`, so scan with the quotes in mind.
      let j = lt + 1;
      let quote = '';
      while (j < text.length) {
        const ch = text[j] as string;
        if (quote) {
          if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
        j++;
      }
      if (j >= text.length) throw new Error('XML: a start tag is not closed');
      let inner = text.slice(lt + 1, j);
      const selfClosing = inner.endsWith('/');
      if (selfClosing) inner = inner.slice(0, -1);
      const nameEnd = inner.search(/\s/);
      const raw = nameEnd < 0 ? inner : inner.slice(0, nameEnd);
      const rest = nameEnd < 0 ? '' : inner.slice(nameEnd);
      const rawAttrs: [string, string][] = [];
      for (const found of rest.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        rawAttrs.push([found[1] as string, decode((found[2] ?? found[3]) as string)]);
      }
      const scope = new Map(top().scope);
      for (const [name, value] of rawAttrs) {
        if (name === 'xmlns') scope.set('', value);
        else if (name.startsWith('xmlns:')) scope.set(name.slice(6), value);
      }
      const attrs: Record<string, string> = {};
      for (const [name, value] of rawAttrs) {
        if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
        attrs[qualify(name, scope, true)] = value;
      }
      const element: XmlElement = { name: qualify(raw, scope, false), attrs, children: [] };
      top().element.children.push(element);
      if (!selfClosing) stack.push({ element, scope, raw });
      i = j + 1;
    }
  }
  if (stack.length > 1) throw new Error(`XML: <${top().raw}> is not closed`);
  const first = root.children.find((node): node is XmlElement => typeof node !== 'string');
  if (!first) throw new Error('XML: no root element');
  return first;
}

/** The child elements of an element, all or by name. */
export function kids(element: XmlElement | undefined, name?: string): XmlElement[] {
  if (!element) return [];
  return element.children.filter(
    (node): node is XmlElement =>
      typeof node !== 'string' && (name === undefined || node.name === name),
  );
}

/** The first child element with this name. */
export function kid(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return kids(element, name)[0];
}

/** All the text inside an element. */
export function textOf(element: XmlElement): string {
  let out = '';
  for (const node of element.children) {
    out += typeof node === 'string' ? node : textOf(node);
  }
  return out;
}
