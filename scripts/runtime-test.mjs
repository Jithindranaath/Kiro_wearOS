/**
 * Runtime behaviour test — covers the time-dependent paths that the other
 * suites cannot reach: approval timeout, heartbeat/pong, disconnect-during-
 * approval replay, and the session cap.
 *
 * Requires the Bridge started with a short approval timeout, e.g.
 *   node packages/bridge/dist/index.js --mock --approval-timeout 6000
 *
 * Usage: node scripts/runtime-test.mjs <pairing-code> [approvalTimeoutMs]
 */

import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:8787';
const WS_URL = 'ws://127.0.0.1:8787/ws';
const CODE = process.argv[2];
const APPROVAL_TIMEOUT_MS = Number(process.argv[3] ?? 6000);

if (!CODE) {
  console.error('Usage: node scripts/runtime-test.mjs <pairing-code> [approvalTimeoutMs]');
  process.exit(1);
}

let pass = 0, fail = 0;
const failures = [];
const check = (c, m) => {
  if (c) { pass++; console.log(`  ✅ ${m}`); }
  else { fail++; failures.push(m); console.log(`  ❌ ${m}`); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const section = (n) => console.log(`\n${'═'.repeat(58)}\n▶ ${n}\n${'═'.repeat(58)}`);

async function pair() {
  const res = await fetch(`${BASE}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: CODE }),
  });
  if (!res.ok) throw new Error(`pairing failed: HTTP ${res.status}`);
  return (await res.json()).token;
}

/** Open an authenticated, subscribed socket. `autoPong` mimics a real client. */
async function connect(token, { autoPong = true } = {}) {
  const frames = [];
  const ws = new WebSocket(WS_URL);
  ws.on('message', (d) => {
    const f = JSON.parse(d.toString());
    frames.push(f);
    if (autoPong && f.t === 'heartbeat') {
      ws.send(JSON.stringify({ v: 1, t: 'pong', ts: Date.now() }));
    }
  });
  await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ v: 1, t: 'auth', token, ts: Date.now() }));

  const waitFor = (pred, timeout = 10_000, label = 'frame') =>
    new Promise((resolve, reject) => {
      const hit = frames.find(pred);
      if (hit) return resolve(hit);
      const iv = setInterval(() => {
        const f = frames.find(pred);
        if (f) { clearInterval(iv); clearTimeout(to); resolve(f); }
      }, 50);
      const to = setTimeout(() => {
        clearInterval(iv);
        reject(new Error(`timeout waiting for ${label}`));
      }, timeout);
    });

  await waitFor(f => f.t === 'hello', 10_000, 'hello');
  ws.send(JSON.stringify({ v: 1, t: 'subscribe', id: 'sub', since: 0, ts: Date.now() }));
  await waitFor(f => f.t === 'ack' && f.id === 'sub', 10_000, 'subscribe ack');

  return { ws, frames, waitFor };
}

const token = await pair();

// ══════════════════════════════════════════════════════════════════════════
section('Approval timeout → auto-deny (AC2.1.5)');

{
  const { ws, frames, waitFor } = await connect(token);

  ws.send(JSON.stringify({ v: 1, t: 'session.create', id: 'c1', cwd: process.cwd(), ts: Date.now() }));
  const created = await waitFor(
    f => (f.t === 'ack' || f.t === 'error') && f.id === 'c1',
    45_000,
    'session create',
  );
  if (created.t === 'error') {
    console.error(
      `\n  ⚠ Could not create a session: ${created.code} — ${created.message}\n` +
        `    Restart the Bridge so this suite starts from a clean state.\n`,
    );
    process.exit(1);
  }
  const sessionId = created.result.id;

  frames.length = 0;
  ws.send(JSON.stringify({
    v: 1, t: 'prompt.send', sessionId, text: 'run the tests', source: 'text', ts: Date.now(),
  }));

  const perm = await waitFor(f => f.t === 'permission.request', 15_000, 'permission request');
  check(!!perm, 'permission request received');

  const advertised = perm.expiresAt - Date.now();
  check(
    advertised > 0 && advertised <= APPROVAL_TIMEOUT_MS + 2000,
    `expiresAt reflects the configured timeout (~${Math.round(advertised / 1000)}s of ${APPROVAL_TIMEOUT_MS / 1000}s)`,
  );

  console.log(`  ⏳ deliberately not answering; waiting out the ${APPROVAL_TIMEOUT_MS / 1000}s timeout...`);
  const started = Date.now();
  const resolved = await waitFor(
    f => f.t === 'permission.resolved' && f.approvalId === perm.approvalId,
    APPROVAL_TIMEOUT_MS + 12_000,
    'timeout resolution',
  );
  const elapsed = Date.now() - started;

  check(resolved.resolution === 'timeout', `resolution is "timeout" (got "${resolved.resolution}")`);
  check(resolved.decision === 'deny', `unanswered approval auto-denies (got "${resolved.decision}")`);
  check(
    elapsed >= APPROVAL_TIMEOUT_MS - 1500,
    `fired at the configured time, not early (${elapsed}ms)`,
  );

  // Check the state broadcast before touching the frame buffer.
  const cleared = await waitFor(
    f => f.t === 'session.state' && f.pendingApprovals === 0,
    8000,
    'pending cleared',
  );
  check(!!cleared, 'pendingApprovals returns to 0 after a timeout');

  // Answering after a timeout must be rejected, not double-answered.
  ws.send(JSON.stringify({
    v: 1, t: 'permission.respond', id: 'late', approvalId: perm.approvalId, decision: 'allow', ts: Date.now(),
  }));
  const lateErr = await waitFor(f => f.t === 'error' && f.id === 'late', 5000, 'late-response error');
  check(lateErr.code === 'AIBOU_ALREADY_RESOLVED', 'late response → AIBOU_ALREADY_RESOLVED (exactly one ACP answer)');

  ws.close();
}

// ══════════════════════════════════════════════════════════════════════════
section('Heartbeat / pong (AC3.3.1)');

{
  const { ws, frames } = await connect(token, { autoPong: true });
  console.log('  ⏳ waiting ~25s for a heartbeat...');
  await sleep(25_000);

  const beats = frames.filter(f => f.t === 'heartbeat');
  check(beats.length >= 1, `received ${beats.length} heartbeat frame(s)`);
  check(ws.readyState === WebSocket.OPEN, 'socket stays open while the client answers pongs');
  ws.close();
}

// ══════════════════════════════════════════════════════════════════════════
section('Client disconnect during a pending approval (invariant 3)');

{
  // Client A raises an approval, then vanishes without answering.
  const a = await connect(token);
  a.ws.send(JSON.stringify({ v: 1, t: 'session.create', id: 'c2', cwd: process.cwd(), ts: Date.now() }));
  const made = await a.waitFor(
    f => (f.t === 'ack' || f.t === 'error') && f.id === 'c2',
    45_000,
    'session create',
  );
  if (made.t === 'error') {
    console.error(`\n  ⚠ Could not create a session: ${made.code}. Restart the Bridge.\n`);
    process.exit(1);
  }
  const sessionId = made.result.id;

  a.frames.length = 0;
  a.ws.send(JSON.stringify({
    v: 1, t: 'prompt.send', sessionId, text: 'run the tests', source: 'text', ts: Date.now(),
  }));
  const perm = await a.waitFor(f => f.t === 'permission.request', 15_000, 'permission request');
  check(!!perm, 'approval raised on client A');

  a.ws.terminate(); // hard drop, no close handshake
  await sleep(1200);

  // Client B connects fresh and must be told about the still-pending approval.
  const b = await connect(token);
  const replayed = await b.waitFor(
    f => f.t === 'permission.request' && f.approvalId === perm.approvalId,
    8000,
    'replayed approval',
  );
  check(!!replayed, 'pending approval survives the disconnect and is replayed to a new client');
  check(replayed.summary === perm.summary, 'replayed approval carries the same summary');
  check(replayed.toolInput !== undefined, 'replayed approval still carries toolInput');

  // And client B can resolve it.
  b.frames.length = 0;
  b.ws.send(JSON.stringify({
    v: 1, t: 'permission.respond', id: 'r', approvalId: perm.approvalId, decision: 'deny', ts: Date.now(),
  }));
  const resolved = await b.waitFor(
    f => f.t === 'permission.resolved' && f.approvalId === perm.approvalId,
    8000,
    'resolution',
  );
  check(resolved.resolution === 'user', 'the reconnecting client can resolve the inherited approval');
  b.ws.close();
}

// ══════════════════════════════════════════════════════════════════════════
section('Session cap (AC1.2.3)');

{
  const { ws, frames, waitFor } = await connect(token);

  ws.send(JSON.stringify({ v: 1, t: 'session.list', id: 'l', ts: Date.now() }));
  const list = await waitFor(f => f.t === 'ack' && f.id === 'l', 8000, 'session list');
  const existing = list.result.length;
  console.log(`  ℹ ${existing} session(s) already open`);

  let limitHit = false;
  for (let i = existing; i < 8; i++) {
    frames.length = 0;
    const id = `cap-${i}`;
    ws.send(JSON.stringify({ v: 1, t: 'session.create', id, cwd: process.cwd(), ts: Date.now() }));
    const res = await waitFor(f => (f.t === 'ack' || f.t === 'error') && f.id === id, 45_000, id);
    if (res.t === 'error') {
      check(res.code === 'AIBOU_SESSION_LIMIT', `rejected with AIBOU_SESSION_LIMIT at session ${i + 1}`);
      limitHit = true;
      break;
    }
  }
  check(limitHit, 'the session cap is enforced rather than growing without bound');
  ws.close();
}

console.log(`\n${'═'.repeat(58)}`);
console.log(`  RESULTS: ${pass} passed, ${fail} failed, ${pass + fail} total`);
if (fail) failures.forEach(f => console.log(`    ❌ ${f}`));
console.log(`${'═'.repeat(58)}\n`);

process.exit(fail ? 1 : 0);
