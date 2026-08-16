import { describe, it, expect } from 'vitest';
import { RingBuffer } from './ringbuffer.js';

describe('RingBuffer', () => {
  it('assigns monotonically increasing seq numbers starting at 1', () => {
    const buf = new RingBuffer(10);
    expect(buf.push('agent.text', { text: 'hello' })).toBe(1);
    expect(buf.push('tool.start', { id: '1' })).toBe(2);
    expect(buf.push('tool.end', { id: '1' })).toBe(3);
  });

  it('replays events since a given seq with no gaps or duplicates', () => {
    const buf = new RingBuffer(100);
    for (let i = 0; i < 10; i++) {
      buf.push('agent.text', { text: `msg ${i}` });
    }

    const events = buf.replaySince(5);
    expect(events).toHaveLength(5);
    expect(events[0].seq).toBe(6);
    expect(events[4].seq).toBe(10);

    // No gaps
    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBe(events[i - 1].seq + 1);
    }
  });

  it('replays all events when since is 0', () => {
    const buf = new RingBuffer(100);
    buf.push('a', {});
    buf.push('b', {});
    buf.push('c', {});

    const events = buf.replaySince(0);
    expect(events).toHaveLength(3);
    expect(events[0].seq).toBe(1);
  });

  it('returns empty when since >= latestSeq', () => {
    const buf = new RingBuffer(100);
    buf.push('a', {});
    buf.push('b', {});

    expect(buf.replaySince(2)).toHaveLength(0);
    expect(buf.replaySince(5)).toHaveLength(0);
  });

  it('wraps around when capacity is exceeded', () => {
    const buf = new RingBuffer(5);
    for (let i = 1; i <= 8; i++) {
      buf.push('event', { i });
    }

    expect(buf.size).toBe(5);
    expect(buf.latestSeq).toBe(8);
    expect(buf.oldestSeq).toBe(4);

    const events = buf.replaySince(0);
    expect(events).toHaveLength(5);
    expect(events[0].seq).toBe(4);
    expect(events[4].seq).toBe(8);
  });

  it('maintains no gaps after wrap-around', () => {
    const buf = new RingBuffer(3);
    for (let i = 1; i <= 10; i++) {
      buf.push('e', { i });
    }

    const events = buf.replaySince(7);
    expect(events).toHaveLength(3);
    expect(events[0].seq).toBe(8);
    expect(events[1].seq).toBe(9);
    expect(events[2].seq).toBe(10);
  });

  it('preserves payload and kind', () => {
    const buf = new RingBuffer(10);
    buf.push('tool.start', { name: 'fs_write', path: '/tmp/test' });

    const events = buf.replaySince(0);
    expect(events[0].kind).toBe('tool.start');
    expect(events[0].payload).toEqual({ name: 'fs_write', path: '/tmp/test' });
  });

  it('timestamps events at push time', () => {
    const buf = new RingBuffer(10);
    const before = Date.now();
    buf.push('a', {});
    const after = Date.now();

    const events = buf.replaySince(0);
    expect(events[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(events[0].timestamp).toBeLessThanOrEqual(after);
  });
});
