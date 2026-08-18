/**
 * A Map that forgets its oldest entries instead of growing without bound.
 *
 * Long sessions accumulate per-response and per-event bookkeeping that is only interesting for a
 * short while; keeping all of it would leak steadily. Eviction drops the oldest half at once
 * (Map iterates in insertion order) so the cost is amortised rather than paid on every insert.
 */
export class BoundedMap<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly maxSize: number = 64) {}

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  get(key: K): V | undefined {
    return this.entries.get(key);
  }

  set(key: K, value: V): void {
    this.entries.set(key, value);
    if (this.entries.size > this.maxSize) {
      const iterator = this.entries.keys();
      for (let i = 0; i < this.maxSize / 2; i++) {
        const next = iterator.next();
        if (next.done) break;
        this.entries.delete(next.value);
      }
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
