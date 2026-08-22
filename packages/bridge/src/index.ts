#!/usr/bin/env node
/**
 * Aibou Bridge — entry point.
 *
 * Spawns a Kiro ACP agent, exposes AWP over WebSocket + HTTP,
 * and serves the PWA.
 */

import { parseArgs } from 'node:util';
import { ExitCode } from '@aibou/protocol';
import { startBridge } from './bridge.js';

const DEFAULTS = {
  host: '127.0.0.1',
  port: 8787,
  /** Approval timeout before auto-deny (AC2.1.5). */
  approvalTimeoutMs: 900_000,
  /** Events retained per session for replay (AC1.3.2). */
  eventBuffer: 500,
  /** Concurrent session cap (AC1.2.3). */
  maxSessions: 4,
} as const;

const { values: flags } = parseArgs({
  options: {
    mock: { type: 'boolean', default: false },
    host: { type: 'string' },
    port: { type: 'string' },
    paranoid: { type: 'boolean', default: false },
    trace: { type: 'boolean', default: false },
    'approval-timeout': { type: 'string' },
    'event-buffer': { type: 'string' },
    'max-sessions': { type: 'string' },
    'revoke-tokens': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: false,
});

if (flags.help === true) {
  console.log(`
Aibou Bridge — remote control for a local Kiro agent session

Usage: aibou [options]

Options:
  --mock                     Use the bundled fake ACP agent (no Kiro credentials)
  --host <addr>              Bind address                 (default ${DEFAULTS.host})
  --port <n>                 Bind port                    (default ${DEFAULTS.port})
  --paranoid                 Escalate every action, ignoring allow rules
  --trace                    Log all ACP frames to ~/.aibou/logs/
  --approval-timeout <ms>    Auto-deny after this long     (default ${DEFAULTS.approvalTimeoutMs})
  --event-buffer <n>         Events retained per session   (default ${DEFAULTS.eventBuffer})
  --max-sessions <n>         Concurrent session cap        (default ${DEFAULTS.maxSessions})
  --revoke-tokens            Forget all paired devices, forcing them to re-pair
  --help                     Show this message

Paired devices are remembered in ~/.aibou/config.json, so a phone or watch
stays paired across Bridge restarts. Use --revoke-tokens to reset that.

Environment:
  AIBOU_KIRO_BIN             Path to the kiro-cli binary
`);
  process.exit(0);
}

/** Parse a positive-integer flag, falling back with a warning if unusable. */
function intFlag(raw: unknown, fallback: number, name: string): number {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`⚠️  Ignoring invalid ${name}="${raw}"; using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

const host = typeof flags.host === 'string' && flags.host !== '' ? flags.host : DEFAULTS.host;
const port = intFlag(flags.port, DEFAULTS.port, '--port');
const approvalTimeoutMs = intFlag(
  flags['approval-timeout'],
  DEFAULTS.approvalTimeoutMs,
  '--approval-timeout',
);
const eventBuffer = intFlag(flags['event-buffer'], DEFAULTS.eventBuffer, '--event-buffer');
const maxSessions = intFlag(flags['max-sessions'], DEFAULTS.maxSessions, '--max-sessions');
const mock = flags.mock === true;
const paranoid = flags.paranoid === true;
const trace = flags.trace === true;
const revokeTokens = flags['revoke-tokens'] === true;

// Warn on non-loopback binding
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.warn(
    `\n⚠️  WARNING: Binding to ${host} exposes the Bridge to the network.\n` +
      `   Anyone on your LAN can control your Kiro session.\n` +
      `   Use only on trusted networks or behind a VPN.\n`,
  );
}

startBridge({
  mock,
  host,
  port,
  paranoid,
  trace,
  approvalTimeoutMs,
  eventBuffer,
  maxSessions,
  revokeTokens,
}).catch((err) => {
  console.error('Fatal:', err);
  process.exit(ExitCode.UNHANDLED);
});
