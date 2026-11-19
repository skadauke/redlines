// What Word fills in when it opens an exported file, written in the file, so that Word has nothing
// to change and doesn't ask to save a document that nobody edited (#1180).
//
// Word marks a document as changed when it adds to it on opening. The `docx` library writes the
// smallest file that is valid; a file that Word itself saved (compared part by part) also has:
// the whole set of compatibility settings of Word 2013 and later, the color scheme mapping of the
// theme, the language and the separators of the settings, the fonts of the document in the font
// table, the application properties, and comment dates without fractions of a second.

import { partText, setPartText } from '../shared/zip.ts';
import type { Parts } from '../shared/zip.ts';

const WORD = 'http://schemas.microsoft.com/office/word';

/** The compatibility settings a file in Word 2013's mode has, as Word writes them. */
const COMPAT = [
  ['compatibilityMode', '15'],
  ['overrideTableStyleFontSizeAndJustification', '1'],
  ['enableOpenTypeFeatures', '1'],
  ['doNotFlipMirrorIndents', '1'],
  ['differentiateMultirowTableHeaders', '1'],
  ['useWord2013TrackBottomHyphenation', '1'],
]
  .map(([name, val]) => `<w:compatSetting w:name="${name}" w:uri="${WORD}" w:val="${val}"/>`)
  .join('');

const AFTER_COMPAT =
  '<w:themeFontLang w:val="en-US"/>' +
  '<w:clrSchemeMapping w:bg1="light1" w:t1="dark1" w:bg2="light2" w:t2="dark2" ' +
  'w:accent1="accent1" w:accent2="accent2" w:accent3="accent3" w:accent4="accent4" ' +
  'w:accent5="accent5" w:accent6="accent6" w:hyperlink="hyperlink" ' +
  'w:followedHyperlink="followedHyperlink"/>' +
  '<w:decimalSymbol w:val="."/><w:listSeparator w:val=","/>';

/** The fonts the document names, as Word's font table describes them. */
const FONTS = `<w:font w:name="Arial"><w:panose1 w:val="020B0604020202020204"/><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/><w:sig w:usb0="E0002AFF" w:usb1="C0007843" w:usb2="00000009" w:usb3="00000000" w:csb0="000001FF" w:csb1="00000000"/></w:font><w:font w:name="Times New Roman"><w:panose1 w:val="02020603050405020304"/><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/><w:sig w:usb0="E0002EFF" w:usb1="C000785B" w:usb2="00000009" w:usb3="00000000" w:csb0="000001FF" w:csb1="00000000"/></w:font><w:font w:name="Courier New"><w:panose1 w:val="02070309020205020404"/><w:charset w:val="00"/><w:family w:val="modern"/><w:pitch w:val="fixed"/><w:sig w:usb0="E0002EFF" w:usb1="C0007843" w:usb2="00000009" w:usb3="00000000" w:csb0="000001FF" w:csb1="00000000"/></w:font>`;

const APP_PROPERTIES =
  '<Template>Normal.dotm</Template><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>' +
  '<Application>Redlines</Application><LinksUpToDate>false</LinksUpToDate>' +
  '<SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>';

/** Edits a part's text with `change`, when the file has the part. */
function edit(parts: Parts, name: string, change: (xml: string) => string): void {
  const xml = partText(parts, name);
  if (xml === undefined) return;
  const next = change(xml);
  if (next !== xml) setPartText(parts, name, next);
}

/** Writes into the parts of an export what Word would add to them on opening. */
export function openClean(parts: Parts): void {
  edit(parts, 'word/settings.xml', (xml) =>
    xml.includes('clrSchemeMapping')
      ? xml
      : xml.replace(
          /<w:compat>[\s\S]*?<\/w:compat>/,
          `<w:characterSpacingControl w:val="doNotCompress"/><w:compat>${COMPAT}</w:compat>${AFTER_COMPAT}`,
        ),
  );
  // Word writes a date to the second; a fraction of a second is read, and then written back.
  edit(parts, 'word/comments.xml', (xml) => xml.replace(/(w:date="[^".]*)\.\d+Z"/g, '$1Z"'));
  edit(parts, 'docProps/core.xml', (xml) => xml.replace(/(>\d{4}-[^<.]*)\.\d+Z</g, '$1Z<'));
  edit(parts, 'word/fontTable.xml', (xml) =>
    /<w:fonts\b[^>]*\/>\s*$/.test(xml)
      ? xml.replace(/<w:fonts\b([^>]*)\/>\s*$/, `<w:fonts$1>${FONTS}</w:fonts>`)
      : xml,
  );
  edit(parts, 'docProps/app.xml', (xml) =>
    /<Properties\b[^>]*\/>\s*$/.test(xml)
      ? xml.replace(/<Properties\b([^>]*)\/>\s*$/, `<Properties$1>${APP_PROPERTIES}</Properties>`)
      : xml,
  );
}
