// What a round trip through Google Docs loses, said before it happens. Google Docs' own .docx
// leaves out replies and resolved comments (the study's findings, lane WS), so a file that goes
// to Docs and comes back has fewer comments than the one we wrote. Reported, never an error.

import { parse } from '@redlines/format';
import type { ReportEntry } from '../shared/report.ts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a Google Docs round trip of this Redlines file will lose, in words. Empty when nothing. */
export function docsRoundTripNotes(text: string): ReportEntry[] {
  const { comments } = parse(text).ledger;
  const notes: ReportEntry[] = [];
  const replies = comments.reduce((sum, thread) => sum + thread.replies.length, 0);
  const resolved = comments.filter((thread) => thread.resolved).length;
  if (replies > 0) {
    notes.push({
      kind: 'docs-replies',
      message: `Google Docs drops replies when it saves a .docx: ${plural(replies, 'reply', 'replies')} will not come back from a round trip through Docs.`,
    });
  }
  if (resolved > 0) {
    notes.push({
      kind: 'docs-resolved',
      message: `Google Docs drops resolved comments when it saves a .docx: ${plural(resolved, 'resolved thread', 'resolved threads')} will not come back from a round trip through Docs.`,
    });
  }
  return notes;
}
