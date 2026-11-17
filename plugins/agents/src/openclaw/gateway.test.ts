import { describe, expect, it } from 'vitest';
import { FAILURE_IDS, failure } from './failures.ts';
import { gatewayView } from './gateway.ts';

describe('gatewayView', () => {
  const where = { url: 'wss://studio-mini.yak-bebop.ts.net', host: 'studio-mini.yak-bebop.ts.net' };

  it('a Gateway that greeted is found, and says nothing was sent', () => {
    const view = gatewayView({ kind: 'found', ...where }, 'studio-mini');
    expect(view.found).toBe(true);
    expect(view.title).toBe('Found an OpenClaw Gateway on studio-mini.');
    expect(view.line).toContain('nothing was sent');
  });

  it('every way of not finding one names a failure card, and keeps the detail for Details', () => {
    const silent = gatewayView({ kind: 'not-answering', ...where, detail: 'No answer.' }, 'mini');
    expect(silent).toMatchObject({
      found: false,
      failure: 'computer-not-answering',
      detail: 'No answer.',
    });
    const none = gatewayView({ kind: 'no-gateway', ...where, detail: 'refused' }, 'mini');
    expect(none).toMatchObject({ found: false, failure: 'no-gateway', detail: 'refused' });
    const bad = gatewayView({ kind: 'bad-address', message: 'Nope.' }, 'mini');
    expect(bad).toMatchObject({ found: false, failure: null, line: 'Nope.' });
  });
});

describe('failure cards', () => {
  it('each has a title, a sentence, a step and one button', () => {
    for (const id of FAILURE_IDS) {
      const card = failure(id, { computer: 'studio-mini', agent: 'Moby' });
      expect(card.id).toBe(id);
      expect(card.title.length).toBeGreaterThan(10);
      expect(card.body.endsWith('.')).toBe(true);
      expect(card.step).toMatch(/^(Step [1-5]|Later)$/);
      expect(card.label.length).toBeGreaterThan(2);
    }
    expect(new Set(FAILURE_IDS).size).toBe(10);
  });

  it('names the computer and the agent where the person has seen them', () => {
    expect(failure('computer-not-answering', { computer: 'studio-mini' }).title).toBe(
      'studio-mini isn’t answering',
    );
    expect(failure('tools-unavailable', { agent: 'Moby' }).title).toBe(
      'Connected, but Moby can’t use the Redlines tools',
    );
    expect(failure('agent-silent', { agent: 'Moby' }).title).toBe('Moby didn’t answer in a minute');
  });

  it('avoids the words a person has not seen', () => {
    for (const id of FAILURE_IDS) {
      const card = failure(id, { computer: 'studio-mini', agent: 'Moby' });
      const text = `${card.title} ${card.body} ${card.label}`.toLowerCase();
      for (const word of ['node', 'bootstrap', 'device token', 'handshake']) {
        expect(text, id).not.toContain(word);
      }
    }
  });
});
