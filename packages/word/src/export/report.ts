// What a Word file can't hold of a Redlines file, in words for the person who exported it. It is
// reported, never an error (import.md, "Things Markdown can't hold", read the other way). Row 2
// of the plan carries images; until then they are named here.

import type { ExportReport } from '../shared/report.ts';

/** What `text` holds that the export leaves out. */
export function exportReport(text: string): ExportReport {
  const entries: ExportReport['entries'] = [];
  const withoutCode = text.replace(/^(`{3,}|~{3,})[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '');
  const images = withoutCode.match(/!\[[^\]\n]*\]\([^)\n]*\)/g)?.length ?? 0;
  if (images > 0) {
    entries.push({
      kind: 'image',
      message:
        images === 1
          ? 'One image is not in the Word file.'
          : `${images} images are not in the Word file.`,
    });
  }
  return { entries };
}
