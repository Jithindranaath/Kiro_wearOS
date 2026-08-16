/**
 * Ring Buffer — fixed-capacity circular buffer for session events.
 *
 * Stores the most recent N events with monotonically increasing seq numbers.
 * Supports replay-since for client reconnection (AC1.3.2–4).
 */

export interface BufferedEvent {
  seq: number;
  kind: string;
  payload: unknown;
  timestamp: number;
}

export class RingBuffer {
  private buffer: BufferedEvent[];
  private head = 0; // next write position
  private count = 0;
  private nextSeq = 1;
  private readonly capacity: number;

  constructor(capacity = 500) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /**
   * Push an event into the ring buffer. Returns the assigned seq number.
   */
  push(kind: string, payload: unknown): number {
    const seq = this.nextSeq++;
    const event: BufferedEvent = {
      seq,
      kind,
      payload,
      timestamp: Date.now(),
    };

    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }

    return seq;
  }

  /**
   * Get all events with seq > since, in order.
   * Returns events with no gaps and no duplicates (AC1.3.3).
   */
  replaySince(since: number): BufferedEvent[] {
    const events: BufferedEvent[] = [];
    const start = this.count < this.capacity ? 0 : this.head;

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      const event = this.buffer[idx];
      if (event && event.seq > since) {
        events.push(event);
      }
    }

    return events;
  }

  /**
   * Get the latest seq number (0 if empty).
   */
  get latestSeq(): number {
    return this.nextSeq - 1;
  }

  /**
   * Get the total number of events currently in the buffer.
   */
  get size(): number {
    return this.count;
  }

  /**
   * Get the oldest seq still in the buffer (0 if empty).
   */
  get oldestSeq(): number {
    if (this.count === 0) return 0;
    const start = this.count < this.capacity ? 0 : this.head;
    return this.buffer[start]?.seq ?? 0;
  }
}
