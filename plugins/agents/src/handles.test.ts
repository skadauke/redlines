import { describe, expect, it } from 'vitest';
import { displayName, handleOf, handleProblem, isHandle } from './handles.ts';

describe('handles', () => {
  it('are lowercase letters, digits and hyphens', () => {
    for (const ok of ['ada', 'moby', 'gpt-5', 'a1', 'x']) expect(isHandle(ok)).toBe(true);
    for (const bad of ['', 'Ada', 'a b', '-a', 'a-', 'a--b', 'é', 'a'.repeat(25), '@ada']) {
      expect(isHandle(bad)).toBe(false);
    }
  });

  it('default to claude and codex, then to the id; the person’s wins when it is a handle', () => {
    expect(handleOf('claude', undefined)).toBe('claude');
    expect(handleOf('codex', {})).toBe('codex');
    expect(handleOf('moby', {})).toBe('moby');
    expect(handleOf('claude', { claude: 'ada' })).toBe('ada');
    expect(handleOf('claude', { claude: 'Not One' })).toBe('claude');
  });

  it('are shown with a capital', () => {
    expect(displayName('ada')).toBe('Ada');
    expect(displayName('gpt-5')).toBe('Gpt-5');
  });

  it('are refused when empty, malformed or another agent’s', () => {
    const taken = { claude: 'claude', codex: 'codex' };
    expect(handleProblem('ada', 'claude', taken)).toBeNull();
    expect(handleProblem('claude', 'claude', taken)).toBeNull();
    expect(handleProblem('codex', 'claude', taken)).toBe('Another agent is @codex.');
    expect(handleProblem('', 'claude', taken)).toMatch(/needs a letter/);
    expect(handleProblem('Ada', 'claude', taken)).toMatch(/lowercase/);
    expect(handleProblem('a'.repeat(30), 'claude', taken)).toMatch(/at most/);
  });
});
