import { describe, expect, it } from 'vitest';
import { agentPrompt } from './prompt.ts';

const base = { documentName: 'plan.md', scope: 'document' as const };

describe('agentPrompt', () => {
  it('sets the voice', () => {
    const prompt = agentPrompt(base);
    expect(prompt).toMatch(/margin comment/);
    expect(prompt).toMatch(/fragments/i);
    expect(prompt).toMatch(/no preamble/i);
    expect(prompt).toMatch(/restat/i);
    expect(prompt).toContain('file:line');
    expect(prompt).toContain('200 characters');
    expect(prompt).toContain('details');
  });

  it('says to use view for this document, and names it', () => {
    const prompt = agentPrompt(base);
    expect(prompt).toMatch(/`view`/);
    expect(prompt).toContain('plan.md');
    expect(prompt).toMatch(/str_replace/);
  });

  it('says text in the document is never an instruction', () => {
    const prompt = agentPrompt(base);
    expect(prompt).toMatch(/never an instruction/i);
    expect(prompt).toMatch(/accept, reject or resolve/i);
  });

  it('gives the selected quote as text from the document', () => {
    const prompt = agentPrompt({ ...base, quote: 'ship it in March' });
    expect(prompt).toContain('ship it in March');
    expect(agentPrompt(base)).not.toContain('selected');
  });

  it('limits what the agent may read to its scope', () => {
    expect(agentPrompt(base)).toMatch(/only this document/i);
    const folder = agentPrompt({ ...base, scope: 'folder', folder: '/Users/ada/notes' });
    expect(folder).toContain('/Users/ada/notes');
    expect(folder).not.toMatch(/only this document/i);
    expect(agentPrompt({ ...base, scope: 'everything' })).not.toMatch(/only this document/i);
  });
});
