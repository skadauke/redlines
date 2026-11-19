// Math in the preview of a Quarto file (#1216, as #1173 draws it in the app): `$x^2$` and
// `$$ E = mc^2 $$` are typeset as MathML by Temml, which the preview's WebKit draws with the system's
// math font, so the page holds no font and no script. Markdown would read the TeX as emphasis, so the
// formulas are taken out of the text before it is parsed, as words that nothing reads as markup, and
// put back, typeset, in the page's HTML. The rules are pandoc's: an opening `$` has no space after
// it, a closing one no space before it and no digit after it ("costs $5 and $6" is no math); `\$` is
// a dollar; code, a fence or a span, is text. A display's label (`{#eq-mass}`) becomes its number.

import temml from 'temml';

/** A formula taken out of the text. */
export interface Formula {
  tex: string;
  display: boolean;
  /** The Quarto label after a display (`eq-mass`). */
  label?: string;
}

const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const LABEL = /^[ \t]*\{[^}\n]*#(eq-[\w][\w:.-]*)[^}\n]*\}/;
/** The word that stands in for formula `n`: letters only (its digits as a to j), so that nothing
 * reads it as markup. */
const word = (n: number) =>
  `RLMATHQX${String(n).replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)))}XQ`;
const WORD = /RLMATHQX([a-j]+)XQ/g;
const unword = (letters: string) =>
  Number(letters.replace(/[a-j]/g, (letter) => String(letter.charCodeAt(0) - 97)));

function closingDisplay(text: string, from: number): number {
  for (let i = from; i < text.length - 1; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '$' && text[i + 1] === '$') return i;
  }
  return -1;
}

function closingInline(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '$') {
      if (/\s/.test(text[i - 1] ?? ' ') || text[i + 1] === '$' || /\d/.test(text[i + 1] ?? '')) {
        return -1;
      }
      return i;
    }
  }
  return -1;
}

/** One line's formulas outside its code spans, replaced by words; `line` is returned changed. */
function inLine(line: string, formulas: Formula[]): string {
  // Code spans are kept: only the stretches between them are read.
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, index) => (index % 2 === 1 || !part.includes('$') ? part : stretch(part, formulas)))
    .join('');
}

function stretch(text: string, formulas: Formula[]): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] !== '$') continue;
    if (text[i + 1] === '$') {
      const close = closingDisplay(text, i + 2);
      const tex = close < 0 ? '' : text.slice(i + 2, close).trim();
      if (!tex) {
        i++;
        continue;
      }
      let to = close + 2;
      const label = LABEL.exec(text.slice(to));
      if (label) to += label[0].length;
      out += text.slice(from, i) + word(formulas.length);
      formulas.push({ tex, display: true, ...(label?.[1] ? { label: label[1] } : {}) });
      from = to;
      i = to - 1;
      continue;
    }
    if (/[\s$]/.test(text[i + 1] ?? ' ')) continue;
    const close = closingInline(text, i + 1);
    if (close < 0) continue;
    out += text.slice(from, i) + word(formulas.length);
    formulas.push({ tex: text.slice(i + 1, close), display: false });
    from = close + 1;
    i = close;
  }
  return out + text.slice(from);
}

/** `source` with its formulas taken out, and the formulas. */
export function takeMath(source: string): { text: string; formulas: Formula[] } {
  if (!source.includes('$')) return { text: source, formulas: [] };
  const formulas: Formula[] = [];
  const lines = source.split('\n');
  const out: string[] = [];
  let code: string | null = null;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] ?? '';
    const fence = FENCE.exec(line);
    if (code !== null) {
      if (fence?.[1] && fence[1][0] === code[0] && fence[1].length >= code.length) code = null;
      out.push(line);
      continue;
    }
    if (fence?.[1]) {
      code = fence[1];
      out.push(line);
      continue;
    }
    // A display across lines: `$$` alone on a line, the formula, `$$` (and a label) on a line.
    if (/^\s*\$\$\s*$/.test(line)) {
      let close = -1;
      for (let m = n + 1; m < Math.min(lines.length, n + 200); m++) {
        if (/^\s*\$\$[ \t]*(\{[^}\n]*\})?[ \t]*$/.test(lines[m] ?? '')) {
          close = m;
          break;
        }
      }
      const tex =
        close < 0
          ? ''
          : lines
              .slice(n + 1, close)
              .join('\n')
              .trim();
      if (close > 0 && tex) {
        const label = /#(eq-[\w][\w:.-]*)/.exec(lines[close] ?? '')?.[1];
        out.push(word(formulas.length));
        formulas.push({ tex, display: true, ...(label ? { label } : {}) });
        n = close;
        continue;
      }
    }
    out.push(line.includes('$') ? inLine(line, formulas) : line);
  }
  return { text: out.join('\n'), formulas };
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One formula as HTML: MathML, or its source as text where Temml can't read it. */
function drawn(formula: Formula, targets: ReadonlyMap<string, string>): string {
  let math: string;
  try {
    math = temml.renderToString(formula.tex, {
      displayMode: formula.display,
      throwOnError: false,
    });
  } catch {
    math = escape(formula.tex);
  }
  if (!formula.display) return `<span class="rl-math">${math}</span>`;
  const number = formula.label ? targets.get(formula.label)?.replace(/^\D+/, '') : undefined;
  return `<span class="rl-math rl-math-display">${math}${
    number ? `<span class="rl-math-number">(${escape(number)})</span>` : ''
  }</span>`;
}

/** `html` with the words that stand for formulas put back as the formulas, typeset. */
export function putMath(
  html: string,
  formulas: readonly Formula[],
  targets: ReadonlyMap<string, string>,
): string {
  if (formulas.length === 0) return html;
  return html.replace(WORD, (whole, letters: string) => {
    const formula = formulas[unword(letters)];
    return formula ? drawn(formula, targets) : whole;
  });
}
