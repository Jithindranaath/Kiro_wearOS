/**
 * Verify session lifecycle: closing works, and the concurrent cap is not a dead end.
 *
 * The bug this guards against: sessions could be created but never closed, so a
 * long-lived Bridge filled its slots and then refused new sessions with
 * "Close a session first" — advice no client could act on. Chained verification
 * runs hit exactly that, and the agent began failing prompts with a JSON-RPC
 * internal error once state had piled up.
 *
 * Usage:
 *   node scripts/verify-sessions.mjs [code] [--port 8787]
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const argv = process.argv;
const CODE = /^\d{6}$/.test(argv[2] ?? '') ? argv[2] : null;
const PORT = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : '8787';
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? '  OK  ' : '  FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
}
function summarize() {
  const passed = checks.filter((c) => c.ok).length;
  console.log(`\n${'-'.repeat(60)}\n  ${passed}/${checks.length} checks passed\n${'-'.repeat(60)}`);
}
function fail(msg) {
  console.error(`\nFAILED: ${msg}\n`);
  summarize();
  process.exit(1);
}

const frames = [];
let ws;
const send = (f) => ws.send(JSON.stringify({ v: 1, ts: Date.now(), ...f }));
function waitFor(pred, timeout, what) {
  return new Promise((resolve, reject) => {
    const hit = frames.find(pred);
    if (hit) return resolve(hit);
    const iv = setInterval(() => {
      const f = frames.find(pred);
      if (f) {
        clearInterval(iv);
        clearTimeout(to);
        resolve(f);
      }
    }, 40);
    const to = setTimeout(() => {
      clearInterval(iv);
      reject(new Error(`timed out after ${timeout}ms waiting for ${what}`));
    }, timeout);
  });
}
async function getToken() {
  if (CODE) {
    const res = await fetch(`${BASE}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: CODE }),
    });
    if (res.ok) return (await res.json()).token;
  }
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.aibou', 'config.json'), 'utf-8'));
    const stored = Array.isArray(cfg.tokens) ? cfg.tokens.at(-1) : null;
    if (stored) return stored;
  } catch {
    /* none */
  }
  fail('could not authenticate; pass a fresh pairing code');
}

async function listSessions(id) {
  send({ t: 'session.list', id });
  const ack = await waitFor((f) => f.t === 'ack' && f.id === id, 10_000, 'session list');
  return ack.result ?? [];
}

// ─── Connect ─────────────────────────────────────────────────────────────────

console.log('\n> Stage 0 -- connect');
const token = await getToken();
ws = new WebSocket(WS_URL);
ws.on('message', (d) => {
  const f = JSON.parse(d.toString());
  frames.push(f);
  if (f.t === 'heartbeat') send({ t: 'pong' });
});
await new Promise((r) => ws.on('open', r));
send({ t: 'auth', token });
await waitFor((f) => f.t === 'hello', 10_000, 'hello');
send({ t: 'subscribe', id: 'sub' });
await waitFor((f) => f.t === 'ack' && f.id === 'sub', 10_000, 'subscribe ack');
check('connected to the Bridge', true);

// ─── Stage 1: close what is already there ────────────────────────────────────

console.log('\n> Stage 1 -- closing a session frees its slot');

let existing = await listSessions('l0');
console.log(`  ..  ${existing.length} session(s) already open`);

// Make sure at least one exists to close.
if (existing.length === 0) {
  send({ t: 'session.create', id: 'c0', cwd: process.cwd() });
  const made = await waitFor((f) => (f.t === 'ack' || f.t === 'error') && f.id === 'c0', 90_000, 'create');
  if (made.t === 'error') fail(`could not create a session: ${made.code} -- ${made.message}`);
  existing = await listSessions('l1');
}

const before = existing.length;
const victim = existing[0].id;
send({ t: 'session.close', id: 'x1', sessionId: victim });
const closeAck = await waitFor(
  (f) => (f.t === 'ack' || f.t === 'error') && f.id === 'x1',
  15_000,
  'close ack',
);
check('session.close is supported', closeAck.t === 'ack', closeAck.t === 'ack' ? victim.slice(0, 8) : closeAck.code);
if (closeAck.t !== 'ack') fail('the Bridge does not support closing a session');

const after = await listSessions('l2');
check(
  'the closed session is gone from the list',
  !after.some((s) => s.id === victim),
  `${before} -> ${after.length} session(s)`,
);

// Closing something that is not there must be an error, not a silent success.
send({ t: 'session.close', id: 'x2', sessionId: victim });
const twice = await waitFor((f) => (f.t === 'ack' || f.t === 'error') && f.id === 'x2', 15_000, 'second close');
check(
  'closing an unknown session reports an error',
  twice.t === 'error' && twice.code === 'AIBOU_SESSION_NOT_FOUND',
  twice.t === 'error' ? twice.code : 'it was accepted',
);

// ─── Stage 2: fill the cap, then recover from it ─────────────────────────────

console.log('\n> Stage 2 -- the cap is reachable and escapable');

let created = [];
let limitHit = null;

for (let i = 0; i < 8; i++) {
  const id = `fill-${i}`;
  send({ t: 'session.create', id, cwd: process.cwd() });
  const res = await waitFor((f) => (f.t === 'ack' || f.t === 'error') && f.id === id, 90_000, `create ${i}`);
  if (res.t === 'error') {
    limitHit = res;
    break;
  }
  created.push(res.result.id);
}

check(
  'the Bridge enforces a session cap',
  Boolean(limitHit) && limitHit.code === 'AIBOU_SESSION_LIMIT',
  limitHit ? limitHit.message : 'no limit was reached in 8 attempts',
);

if (limitHit) {
  check(
    'the limit message names an action a client can actually take',
    /session\.close|web app/i.test(limitHit.message),
    limitHit.message,
  );

  // Now escape it, which is the whole point.
  const open = await listSessions('l3');
  send({ t: 'session.close', id: 'freeing', sessionId: open[0].id });
  await waitFor((f) => f.t === 'ack' && f.id === 'freeing', 15_000, 'close to free a slot');

  send({ t: 'session.create', id: 'after-free', cwd: process.cwd() });
  const recovered = await waitFor(
    (f) => (f.t === 'ack' || f.t === 'error') && f.id === 'after-free',
    90_000,
    'create after freeing a slot',
  );
  check(
    'a new session can be created after closing one',
    recovered.t === 'ack',
    recovered.t === 'ack' ? recovered.result.id.slice(0, 8) : `${recovered.code}: ${recovered.message}`,
  );
  if (recovered.t === 'ack') created.push(recovered.result.id);
}

// ─── Stage 3: leave the Bridge tidy ──────────────────────────────────────────

console.log('\n> Stage 3 -- clean up after ourselves');

const remaining = await listSessions('l4');
for (const s of remaining) {
  send({ t: 'session.close', id: `cleanup-${s.id}`, sessionId: s.id });
}
await new Promise((r) => setTimeout(r, 1500));

const finalList = await listSessions('l5');
check('every session was closed', finalList.length === 0, `${finalList.length} left open`);

ws.close();
summarize();
const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.log('\nFailed checks:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
console.log('\nSessions can be closed, and a full Bridge can be recovered without a restart.\n');
process.exit(0);
