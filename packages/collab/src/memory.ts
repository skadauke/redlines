// A transport inside one JavaScript context: for the tests, for the dev page's two windows side by
// side, and for a window that hosts its own authority (it talks to its own hub like any other).

import type { Hub } from './hub.ts';
import type { Call, Notice, Reply, Transport } from './wire.ts';

interface MemoryTransportOptions {
  /** Called before each call and notice is delivered: the tests make the network slow with it. */
  delay?: () => Promise<void>;
}

/** The transport of one client (`clientID`) to a hub in the same context. */
export function memoryTransport(
  hub: Hub,
  clientID: string,
  options: MemoryTransportOptions = {},
): Transport & { disconnect(): void; connect(): void } {
  const handlers = new Set<(notice: Notice) => void>();
  let up = true;
  const stop = hub.onNotice((to, notice) => {
    if (to !== clientID || !up) return;
    void (async () => {
      await options.delay?.();
      if (up) for (const handler of handlers) handler(notice);
    })();
  });
  void stop;
  return {
    async call(call: Call): Promise<Reply> {
      if (!up) throw new Error('offline');
      await options.delay?.();
      if (!up) throw new Error('offline');
      const reply = await hub.handle(call);
      await options.delay?.();
      if (!up) throw new Error('offline');
      return reply;
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
    disconnect() {
      up = false;
    },
    connect() {
      up = true;
    },
  };
}
