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

const { values: flags } = parseArgs({
  options: {
    mock: { type: 'boolean', default: false },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '8787' },
    paranoid: { type: 'boolean', default: false },
    trace: { type: 'boolean', default: false },
  },
  strict: false,
});

const host = typeof flags.host === 'string' ? flags.host : '127.0.0.1';
const port = parseInt(typeof flags.port === 'string' ? flags.port : '8787', 10);
const mock = flags.mock === true;
const paranoid = flags.paranoid === true;
const trace = flags.trace === true;

// Warn on non-loopback binding
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.warn(
    `\n⚠️  WARNING: Binding to ${host} exposes the Bridge to the network.\n` +
      `   Anyone on your LAN can control your Kiro session.\n` +
      `   Use only on trusted networks or behind a VPN.\n`,
  );
}

startBridge({ mock, host, port, paranoid, trace }).catch((err) => {
  console.error('Fatal:', err);
  process.exit(ExitCode.UNHANDLED);
});
