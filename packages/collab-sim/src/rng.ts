// A seeded random source (mulberry32). Every session is a pure function of its seed.

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** An integer in [a, b]. */
  between(a: number, b: number): number {
    return a + this.int(b - a + 1);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new Error('pick from an empty list');
    return item;
  }

  /** Picks by weight. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let at = this.next() * total;
    for (const [value, weight] of entries) {
      at -= weight;
      if (at < 0) return value;
    }
    const last = entries[entries.length - 1];
    if (!last) throw new Error('pick from an empty list');
    return last[0];
  }

  /** A generator of its own, drawn from this one, so that adding a use elsewhere doesn't move it. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }

  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.int(256);
    return out;
  }
}

/** A seed for session `n` of a matrix cell, spread so that neighbours aren't alike. */
export function seedFor(base: number, n: number): number {
  let h = (base ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
