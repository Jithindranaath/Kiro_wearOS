import { z } from 'zod';
import { BaseFrame } from './frames.js';

/**
 * Event kinds emitted by the Bridge via the event stream.
 */
export const EventKind = z.enum([
  'agent.text',
  'agent.thought',
  'tool.start',
  'tool.end',
  'task.update',
  'usage',
  'session.error',
  'unknown',
]);
export type EventKind = z.infer<typeof EventKind>;

/**
 * An event in the session event stream.
 */
export const EventFrame = BaseFrame.extend({
  t: z.literal('event'),
  sessionId: z.string(),
  seq: z.number().int().positive(),
  kind: EventKind,
  payload: z.unknown(),
});
export type EventFrame = z.infer<typeof EventFrame>;
