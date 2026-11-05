// Helpers shared by the tests of this package. They are not part of it.

import type { ToolContext, ToolDocument } from './tools.ts';

export const PLAN = '# Plan\n\nWe will ship the importer in March.\n\nThe tests run in CI.\n';

/** A document in memory that counts how often it was written. */
export interface FakeDocument extends ToolDocument {
  text: string;
  writes: number;
}

export function fakeDocument(text: string = PLAN): FakeDocument {
  const doc: FakeDocument = {
    text,
    writes: 0,
    read: () => doc.text,
    write: (next) => {
      doc.text = next;
      doc.writes++;
    },
  };
  return doc;
}

export interface Calls {
  statuses: string[];
  replies: number;
}

export function fakeContext(
  doc: ToolDocument,
  calls: Calls = { statuses: [], replies: 0 },
  thread = '',
): ToolContext {
  return {
    doc,
    author: { handle: 'claude-ada', name: 'Claude', agent: true, for: 'ada' },
    thread,
    group: 'r7k2',
    now: () => new Date('2026-11-05T10:30:45.000Z'),
    requestedBy: 'ada',
    onStatus: (text) => calls.statuses.push(text),
    onReply: () => {
      calls.replies++;
    },
  };
}
