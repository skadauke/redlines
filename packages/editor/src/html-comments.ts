// The HTML that Markdown blocks hand to an HTML parser, with one block left out: a block that is
// only a comment. Its tree has one node, which the Markdown parser has named (`CommentBlock`, drawn
// as a comment); the HTML parser reading it again adds a `Comment` node under it, and nothing is
// drawn or decided from that one. A tracked change that replaces a block of code holds the old block
// in one comment, the whole of it on one line, which the HTML parser would read again at each key.

import { html } from '@codemirror/lang-html';
import type { LanguageSupport } from '@codemirror/language';
import { NodeType, Parser, Tree } from '@lezer/common';
import type { Input, PartialParse, TreeFragment } from '@lezer/common';

/** Whether the text is one comment and nothing after it but white space. */
export function onlyComment(text: string): boolean {
  if (!text.startsWith('<!--')) return false;
  const close = text.indexOf('-->', 4);
  return close !== -1 && text.slice(close + 3).trim() === '';
}

/** Parses nothing: a tree with no nodes, as long as the ranges. */
class Nothing implements PartialParse {
  readonly parsedPos: number;
  stoppedAt: number | null = null;
  private readonly length: number;

  constructor(from: number, to: number) {
    this.parsedPos = to;
    this.length = to - from;
  }

  advance(): Tree {
    return new Tree(NodeType.none, [], [], this.length);
  }

  stopAt(pos: number): void {
    this.stoppedAt = pos;
  }
}

class SkipComments extends Parser {
  private readonly inner: Parser;

  constructor(inner: Parser) {
    super();
    this.inner = inner;
  }

  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    if (ranges.length === 1 && first && last && onlyComment(input.read(first.from, last.to))) {
      return new Nothing(first.from, last.to);
    }
    return this.inner.startParse(input, fragments, ranges);
  }
}

/** The language `markdown` reads HTML with (`htmlTagLanguage`): the one it reads with by default,
 * but for a block that is only a comment. */
export function htmlWithoutComments(): {
  language: { parser: Parser };
  support: LanguageSupport['support'];
} {
  const base = html({ matchClosingTags: false });
  return {
    language: { parser: new SkipComments(base.language.parser) },
    support: base.support,
  };
}
