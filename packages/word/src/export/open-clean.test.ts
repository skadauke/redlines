import { describe, expect, it } from 'vitest';
import { partText, readParts } from '../shared/zip.ts';
import { exportDocx } from './build.ts';

const TEXT = `A note on <!--cmt c8d2-->this<!--/c8d2--> and a change<!--ins k3x9--> here<!--/k3x9-->.

<!-- redlines
version: 1
tracking: everyone
people:
  ada: {name: Ada Lovelace}
marks:
  k3x9: {by: ada, at: 2026-10-13T22:30Z}
comments:
  c8d2:
    by: ada
    at: 2026-10-13T22:40:12Z
    text: |-
      A comment
-->
`;

async function partsOf(carriers: boolean) {
  return readParts(await exportDocx(TEXT, { carriers }));
}

describe('an export Word has nothing to change in (#1180)', () => {
  for (const carriers of [true, false]) {
    describe(carriers ? 'with the carriers' : 'without them', () => {
      it('has the settings Word writes: all compatibility settings, mapping, language', async () => {
        const settings = partText(await partsOf(carriers), 'word/settings.xml') ?? '';
        for (const name of [
          'compatibilityMode',
          'overrideTableStyleFontSizeAndJustification',
          'enableOpenTypeFeatures',
          'doNotFlipMirrorIndents',
          'differentiateMultirowTableHeaders',
          'useWord2013TrackBottomHyphenation',
        ]) {
          expect(settings).toContain(`w:name="${name}"`);
        }
        expect(settings).toMatch(/<w:compatSetting w:name="compatibilityMode"[^>]*w:val="15"/);
        for (const tag of ['themeFontLang', 'clrSchemeMapping', 'decimalSymbol', 'listSeparator']) {
          expect(settings).toContain(`<w:${tag} `);
        }
        // The order of the schema: spacing control, compat, then the language and mapping.
        const at = (s: string) => settings.indexOf(s);
        expect(at('<w:characterSpacingControl')).toBeLessThan(at('<w:compat>'));
        expect(at('</w:compat>')).toBeLessThan(at('<w:themeFontLang'));
        expect(at('<w:themeFontLang')).toBeLessThan(at('<w:clrSchemeMapping'));
        expect(at('<w:clrSchemeMapping')).toBeLessThan(at('<w:decimalSymbol'));
        expect(at('<w:decimalSymbol')).toBeLessThan(at('<w:listSeparator'));
        // Nothing asks Word to update fields as it opens.
        expect(settings).not.toContain('updateFields');
      });

      it('names its fonts, and has application properties', async () => {
        const parts = await partsOf(carriers);
        const fonts = partText(parts, 'word/fontTable.xml') ?? '';
        for (const name of ['Arial', 'Courier New']) expect(fonts).toContain(`w:name="${name}"`);
        expect(partText(parts, 'docProps/app.xml')).toContain('<Application>');
      });

      it('writes the dates of comments and properties to the second, as Word does', async () => {
        const parts = await partsOf(carriers);
        const comments = partText(parts, 'word/comments.xml') ?? '';
        expect(comments).toContain('w:date="2026-10-13T22:40:12Z"');
        expect(comments).not.toMatch(/w:date="[^"]*\.\d+Z"/);
        expect(partText(parts, 'docProps/core.xml')).not.toMatch(/\.\d+Z</);
      });
    });
  }
});
