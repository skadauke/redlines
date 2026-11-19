// The simulated network: a virtual clock, and links with latency, spikes, dropped connections and
// offline periods. Messages on one link arrive in order, as on a WebSocket; a message in flight
// when its connection drops is lost.

import type { Rng } from './rng.ts';

export interface NetConfig {
  /** Latency range in ms, one way. */
  latency: [number, number];
  /** The chance that a message is held up by a spike, and the spike's range in ms. */
  spikeP: number;
  spike: [number, number];
}

export const DEFAULT_NET: NetConfig = { latency: [5, 225], spikeP: 0.02, spike: [400, 3000] };

interface Timed {
  at: number;
  seq: number;
  run: () => void;
}

/** A virtual clock and its queue of events. */
export class Clock {
  now = 0;
  private seq = 0;
  private queue: Timed[] = [];

  at(time: number, run: () => void): void {
    const item = { at: Math.max(time, this.now), seq: this.seq++, run };
    let lo = 0;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const other = this.queue[mid] as Timed;
      if (other.at < item.at || (other.at === item.at && other.seq < item.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.queue.splice(lo, 0, item);
  }

  after(ms: number, run: () => void): void {
    this.at(this.now + ms, run);
  }

  get idle(): boolean {
    return this.queue.length === 0;
  }

  /** Runs events until none is due before `until`, or none is left. Returns false at the limit. */
  run(until = Infinity, limit = 5_000_000): boolean {
    let steps = 0;
    while (this.queue.length > 0 && (this.queue[0] as Timed).at <= until) {
      if (steps++ > limit) return false;
      const next = this.queue.shift() as Timed;
      this.now = next.at;
      next.run();
    }
    return true;
  }
}

type Direction = 'up' | 'down';

/** One connection between a client and the authority (or between two replicas). */
export class Link {
  up = true;
  /** Changes at every drop, so that messages sent earlier are lost. */
  private epoch = 0;
  private lastArrival: Record<Direction, number> = { up: 0, down: 0 };
  private listeners: (() => void)[] = [];
  private dropListeners: (() => void)[] = [];
  sent = 0;
  lost = 0;

  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly net: NetConfig;

  constructor(clock: Clock, rng: Rng, net: NetConfig) {
    this.clock = clock;
    this.rng = rng;
    this.net = net;
  }

  /** Sends `deliver` to the other end. Returns false when the link is down. */
  send(direction: Direction, deliver: () => void): boolean {
    this.sent++;
    if (!this.up) {
      this.lost++;
      return false;
    }
    const [lo, hi] = this.net.latency;
    let delay = lo + this.rng.next() * (hi - lo);
    if (this.rng.chance(this.net.spikeP)) {
      const [slo, shi] = this.net.spike;
      delay += slo + this.rng.next() * (shi - slo);
    }
    const arrival = Math.max(this.clock.now + delay, this.lastArrival[direction] + 0.001);
    this.lastArrival[direction] = arrival;
    const epoch = this.epoch;
    this.clock.at(arrival, () => {
      if (this.up && this.epoch === epoch) deliver();
      else this.lost++;
    });
    return true;
  }

  /** Outages that overlap hold the link down until the last one ends. */
  private holds = 0;

  disconnect(): void {
    this.holds++;
    if (!this.up) return;
    this.up = false;
    this.epoch++;
    for (const listener of this.dropListeners) listener();
  }

  connect(): void {
    this.holds = Math.max(0, this.holds - 1);
    if (this.up || this.holds > 0) return;
    this.up = true;
    this.lastArrival = { up: this.clock.now, down: this.clock.now };
    for (const listener of this.listeners) listener();
  }

  /** Called when the connection drops. */
  onDisconnect(listener: () => void): void {
    this.dropListeners.push(listener);
  }

  /** Called when the link comes back. */
  onConnect(listener: () => void): void {
    this.listeners.push(listener);
  }
}

/** Plans when a link is down: a drop or two, and for some links a long offline period. */
export function planOutages(
  clock: Clock,
  link: Link,
  rng: Rng,
  span: number,
  offlineP: number,
  dropP = 0.3,
): number {
  let outages = 0;
  const outage = (start: number, length: number) => {
    outages++;
    clock.at(start, () => link.disconnect());
    clock.at(start + length, () => link.connect());
  };
  if (rng.chance(offlineP)) outage(rng.next() * span * 0.8, 2000 + rng.next() * 6000);
  if (rng.chance(dropP)) outage(rng.next() * span, 100 + rng.next() * 900);
  return outages;
}
