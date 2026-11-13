import { describe, expect, it, vi } from 'vitest';
import { createSetupRegistry } from './setup-registry.ts';

const done = { ok: true, message: '' };

describe('the updates and sign-ins under way', () => {
  it('keeps one for an agent until it ends, and then says so once', async () => {
    const ended = vi.fn();
    const registry = createSetupRegistry(ended);
    let finish: (result: typeof done) => void = () => {};
    const started = new Promise<typeof done>((resolve) => (finish = resolve));
    const tracked = registry.track('claude', 'update', started);
    expect(registry.running('claude')).toMatchObject({ doing: 'update' });
    expect(registry.running('codex')).toBeUndefined();
    expect(ended).not.toHaveBeenCalled();
    // A pane drawn again follows the same end.
    expect(registry.running('claude')?.ended).toBe(tracked);

    finish(done);
    expect(await tracked).toEqual(done);
    expect(registry.running('claude')).toBeUndefined();
    expect(ended).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledWith('claude');
  });

  it('lets go of one that failed, and hands the failure to whoever follows it', async () => {
    const ended = vi.fn();
    const registry = createSetupRegistry(ended);
    const tracked = registry.track('codex', 'sign-in', Promise.reject(new Error('no browser')));
    await expect(tracked).rejects.toThrow('no browser');
    expect(registry.running('codex')).toBeUndefined();
    expect(ended).toHaveBeenCalledWith('codex');
  });

  it('keeps each agent’s own, and an unfollowed failure is no unhandled rejection', async () => {
    const registry = createSetupRegistry(() => {});
    void registry.track('claude', 'update', Promise.resolve(done));
    void registry.track('codex', 'sign-in', Promise.reject(new Error('x')));
    expect(registry.running('claude')?.doing).toBe('update');
    expect(registry.running('codex')?.doing).toBe('sign-in');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(registry.running('claude')).toBeUndefined();
    expect(registry.running('codex')).toBeUndefined();
  });
});
