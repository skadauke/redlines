// An Enter typed at the end of a unit in a container, next to another person's insertion (#17): the
// closer of the replacement stands before the break, not alone on a line after it, where it would
// read as a block of the container (format §3.12). Every order of decisions reads alike.
import { micromark } from 'micromark';
import { describe, expect, it } from 'vitest';
import { applyChanges } from './changes.ts';
import { acceptAll, rejectAll } from './decide.ts';
import { parse } from './parse.ts';
import { ada, context, file } from './test-helpers.ts';
import { trackedEdit } from './track.ts';
import { newestView, originalView } from './views.ts';

const ids = () => context(ada, ['p3xb', 'q3xb', 'r3xb']);

describe("an Enter at the end of a container's text, next to another person's insertion", () => {
  it.each([
    ['a quote', '> A\n> x <!--ins k3x9-->beta delta<!--/k3x9-->\n\nNext'],
    ['a list item', '- x <!--ins k3x9-->beta delta<!--/k3x9-->\n- two\n\nNext'],
    ['a numbered item', '1. x <!--ins k3x9-->beta delta<!--/k3x9-->\n2. two\n\nNext'],
    ['a callout', '> [!NOTE]\n> x <!--ins k3x9-->beta delta<!--/k3x9-->\n\nNext'],
    ['a nested quote', '> > x <!--ins k3x9-->beta delta<!--/k3x9-->\n\nNext'],
    ['no container', 'x <!--ins k3x9-->beta delta<!--/k3x9-->\n\nNext'],
  ])('writes the break typed over the end of the text in %s', (_, body) => {
    for (const eol of ['\n', '\r\n']) {
      const source = file(body.replaceAll('\n', eol), { k3x9: 'bo' }).replaceAll(/(?<!\r)\n/g, eol);
      const from = source.indexOf('lta');
      const written = applyChanges(
        source,
        trackedEdit(source, { from, to: from + 3, insert: eol }, ids()),
      );
      expect(parse(written).warnings, JSON.stringify(eol)).toEqual([]);
      const newest = newestView(written).text;
      expect(newest).toContain('beta de');
      expect(newest).not.toContain('lta');
      expect(applyChanges(written, acceptAll(written))).toBe(newest);
      // The break is a blank line more between blocks, which is plain (format §3.4): micromark
      // reads the original text and what rejecting gives as it reads the file before the edit.
      const html = (text: string) => micromark(text);
      expect(html(originalView(written).text)).toBe(html(originalView(source).text));
      expect(html(applyChanges(written, rejectAll(written)))).toBe(
        html(applyChanges(source, rejectAll(source))),
      );
    }
  });
});
