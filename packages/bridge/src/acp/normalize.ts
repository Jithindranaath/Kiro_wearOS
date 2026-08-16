/**
 * ACP → AWP Normalizer
 *
 * Transforms raw ACP session/update notifications into typed AWP events.
 * This and methods.ts are the ONLY files that know ACP's internal shape.
 */

import type { EventKind } from '@aibou/protocol';
import type { SessionUpdateParams, SessionUpdate } from './methods.js';

export interface NormalizedEvent {
  kind: EventKind;
  payload: unknown;
}

/**
 * Normalize an ACP session/update notification into an AWP event.
 * Unknown update types are preserved as kind: "unknown" per AC1.3.5.
 */
export function normalizeSessionUpdate(params: SessionUpdateParams): NormalizedEvent {
  const { update } = params;

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = update.content as { text?: string; type?: string } | undefined;
      return {
        kind: 'agent.text',
        payload: {
          text: content?.text ?? '',
          contentType: content?.type ?? 'text',
          messageId: update.messageId,
        },
      };
    }

    case 'agent_thought_chunk': {
      const content = update.content as { text?: string; type?: string } | undefined;
      return {
        kind: 'agent.thought',
        payload: {
          text: content?.text ?? '',
          messageId: update.messageId,
        },
      };
    }

    case 'tool_call':
      return {
        kind: 'tool.start',
        payload: {
          toolCallId: update.toolCallId,
          title: update.title,
          kind: update.kind,
          status: update.status,
          rawInput: update.rawInput,
        },
      };

    case 'tool_call_update':
      return {
        kind: 'tool.end',
        payload: {
          toolCallId: update.toolCallId,
          status: update.status,
          content: update.content,
        },
      };

    case 'plan':
      return {
        kind: 'task.update',
        payload: { entries: update.entries },
      };

    case 'usage_update':
      // Real numbers straight from the agent — never synthesised. Emitted only
      // because the agent sent them (see context.md §6 honesty rule).
      return {
        kind: 'usage',
        payload: {
          used: update.used,
          size: update.size,
          cost: update.cost,
        },
      };

    case 'turn_end':
      return {
        kind: 'agent.text',
        payload: { turnEnd: true },
      };

    default:
      // Unknown ACP frame — preserve raw payload, never crash (AC1.3.5)
      return {
        kind: 'unknown',
        payload: update,
      };
  }
}

/**
 * Derive whether the update signals end of agent turn.
 */
export function isTurnEnd(update: SessionUpdate): boolean {
  return update.sessionUpdate === 'turn_end';
}

/**
 * Check if the last agent message text ends with a question mark.
 * Used for the awaiting_input inference heuristic.
 */
export function endsWithQuestion(text: string): boolean {
  return text.trimEnd().endsWith('?');
}
