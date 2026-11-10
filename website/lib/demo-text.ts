import data from './demo-text.json';

// What the demos' documents say, for the server-rendered fallback: the sentences and marks of
// `apps/website-embed/src/docs/*.md` as a list of segments. A test in the embed package
// (`src/fallback.test.ts`) holds this file to the documents, and names it when they disagree.

export type Segment =
  | { t: 'text'; s: string }
  | { t: 'ins' | 'del'; by: string; s: string }
  | { t: 'sub'; by: string; old: string; s: string }
  | { t: 'cmt'; children: Segment[]; thread: { by: string; text: string }[] };

export interface DemoText {
  title: string;
  segments: Segment[];
}

export const demoText = data as { plan: DemoText; design: DemoText };
