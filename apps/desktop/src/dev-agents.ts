// The agents of a plain page in development (`pnpm dev`), where there are no agent programs to run: a
// scripted Claude, so that Ask's bubble, its citations and its actions can be seen and checked in a
// browser, as the WebKit checks do. It answers an Ask with a canned answer that cites the first
// sentence of the document, Alt Text's "Describe with Claude" with a canned description of the one picture
// it is shown, and a comment's run with a canned reply. Never in a release build.

import { fakeProvider, fakeRelay, type FakeScript } from '@redlines/agents/fake-provider';
import { createMacAgents, type MacAgents } from '@redlines/agents';
import { newestView } from '@redlines/format';

/** The first sentence of the document as a reader sees it, which the canned answer cites. */
function firstSentence(text: string): string {
  const plain = newestView(text).text.replace(/^#+\s.*\n+/, '');
  return /^[^\n]*?[.!?](?=\s|$)/.exec(plain)?.[0] ?? plain.split('\n')[0] ?? '';
}

export function createDevAgents(): MacAgents {
  const relay = fakeRelay();
  const script: FakeScript = async function* ({ request, tools }) {
    await tools.initialize();
    if (request.thread.startsWith('alt-')) {
      // Alt Text's "Describe with Claude": it looks at the one picture it is shown (`view_image`,
      // which has no document or file to read beside it) and answers with a canned description.
      yield { type: 'status', text: 'Looking at the image' };
      const picture = await tools.call('view_image', {});
      await new Promise((resolve) => setTimeout(resolve, 900));
      yield {
        type: 'done',
        finalText: picture.image
          ? `A scripted description, for development: a ${picture.image.mimeType.replace('image/', '').toUpperCase()} picture of ${Math.round((picture.image.data.length * 3) / 4)} bytes.`
          : 'The scripted agent was shown no picture.',
      };
      return;
    }
    const seen = await tools.call('view', {});
    if (request.thread.startsWith('ask-')) {
      yield { type: 'status', text: 'Reading the document' };
      // A moment, so that the live line can be seen.
      await new Promise((resolve) => setTimeout(resolve, 900));
      const cited = firstSentence(seen.text.replace(/^ +\d+\t/gm, ''));
      yield {
        type: 'done',
        finalText: `This is a scripted answer, for development. It says it read the document, and cites its first sentence [1].\n\nSources:\n[1] "${cited}"`,
      };
      return;
    }
    await tools.call('reply', { text: 'Scripted reply, for development.' });
    yield { type: 'done' };
  };
  return createMacAgents([fakeProvider({ relay, script, seesImages: true })], relay);
}
