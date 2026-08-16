/**
 * PWA flow test — replays the exact frame sequence the PWA sends,
 * using the same correlation ids, to prove the UI wiring works.
 *
 * Usage: node scripts/pwa-flow-test.mjs <pairing-code>
 */

import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:8787';
const WS_URL = 'ws://127.0.0.1:8787/ws';
const CODE = process.argv[2];

if (!CODE) {
  console.error('Usage: node scripts/pwa-flow-test.mjs <pairing-code>');
  process.exit(1);
}

// Must match CREATE_SESSION_FRAME_ID in packages/pwa/src/App.tsx
const CREATE_SESSION_FRAME_ID = 'pwa-session-create';

let pass = 0, fail = 0;
const failures = [];
const check = (c, m) => {
  if (c) { pass++; console.log(`  ✅ ${m}`); }
  else { fail++; failures.push(m); console.log(`  ❌ ${m}`); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('\n▶ PWA flow: pair → connect → auth → subscribe → create session → prompt → approve\n');

// 1. Pair exactly as PairScreen does
const pairRes = await fetch(`${BASE}/api/pair`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE }),
});
check(pairRes.ok, 'PairScreen: POST /api/pair succeeds');
const { token } = await pairRes.json();

// 2. Connect + auth exactly as WsClient does
const frames = [];
const ws = new WebSocket(WS_URL);
ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
await new Promise(r => ws.on('open', r));

const waitFor = (pred, timeout = 8000) => new Promise((resolve, reject) => {
  const iv = setInterval(() => {
    const f = frames.find(pred);
    if (f) { clearInterval(iv); clearTimeout(to); resolve(f); }
  }, 50);
  const to = setTimeout(() => { clearInterval(iv); reject(new Error('timeout')); }, timeout);
});

ws.send(JSON.stringify({ v: 1, t: 'auth', token, ts: Date.now() }));
const hello = await waitFor(f => f.t === 'hello');
check(!!hello, 'WsClient: auth → hello received');
check(typeof hello.bridgeVersion === 'string' && hello.bridgeVersion !== '', `WsClient: hello.bridgeVersion present ("${hello.bridgeVersion}")`);

// WsClient auto-subscribes on hello
ws.send(JSON.stringify({ v: 1, t: 'subscribe', since: 0, ts: Date.now() }));
await sleep(600);

// 3. NewSessionDialog: bad path must surface an error tagged with the PWA's id
frames.length = 0;
ws.send(JSON.stringify({
  v: 1,
  t: 'session.create',
  id: CREATE_SESSION_FRAME_ID,
  cwd: 'Q:\\no\\such\\directory',
  ts: Date.now(),
}));
const badErr = await waitFor(f => f.t === 'error' && f.id === CREATE_SESSION_FRAME_ID);
check(badErr.code === 'AIBOU_BAD_CWD', 'NewSessionDialog: invalid path → error routed to dialog (matching id)');
check(typeof badErr.message === 'string' && badErr.message.length > 0, 'NewSessionDialog: error carries a human-readable message');

// 4. NewSessionDialog: valid path must ack with the PWA's id and include session id
frames.length = 0;
ws.send(JSON.stringify({
  v: 1,
  t: 'session.create',
  id: CREATE_SESSION_FRAME_ID,
  cwd: process.cwd(),
  ts: Date.now(),
}));
const ack = await waitFor(f => f.t === 'ack' && f.id === CREATE_SESSION_FRAME_ID);
check(!!ack, 'NewSessionDialog: valid path → ack routed to dialog (matching id)');
check(!!ack.result?.id, `NewSessionDialog: ack.result.id present → App selects session (${ack.result?.id})`);
const sessionId = ack.result.id;

const state = await waitFor(f => f.t === 'session.state' && f.sessionId === sessionId);
check(!!state, 'SessionList: session.state broadcast → session appears in list');
check(typeof state.cwd === 'string' && state.cwd.length > 0, 'SessionList: cwd present for basename display');

// 5. PromptInput
frames.length = 0;
ws.send(JSON.stringify({
  v: 1, t: 'prompt.send', sessionId, text: 'Run the tests', source: 'text', ts: Date.now(),
}));
await sleep(3000);

const events = frames.filter(f => f.t === 'event');
check(events.length > 0, `EventStream: received ${events.length} events to render`);
check(events.every(e => typeof e.seq === 'number'), 'EventStream: every event has a seq for React keys');
check(events.every(e => typeof e.kind === 'string'), 'EventStream: every event has a kind for icon mapping');

// 6. ApprovalCard
const perm = frames.find(f => f.t === 'permission.request');
check(!!perm, 'ApprovalCard: permission.request received');
if (perm) {
  check(typeof perm.summary === 'string', 'ApprovalCard: summary present for headline');
  check(perm.toolInput !== undefined, 'ApprovalCard: toolInput present for detail pane');
  check(['low','medium','high'].includes(perm.riskTier), 'ApprovalCard: riskTier maps to a known style');
  check(perm.expiresAt > Date.now(), 'ApprovalCard: expiresAt in future for countdown');

  frames.length = 0;
  ws.send(JSON.stringify({
    v: 1, t: 'permission.respond', approvalId: perm.approvalId, decision: 'allow', ts: Date.now(),
  }));
  const resolved = await waitFor(f => f.t === 'permission.resolved' && f.approvalId === perm.approvalId);
  check(!!resolved, 'ApprovalCard: approve → permission.resolved → card removed from state');
}

// 7. Reconnect replay (WsClient backoff path)
const seen = Math.max(0, ...frames.filter(f => f.t === 'event').map(f => f.seq));
const ws2Frames = [];
const ws2 = new WebSocket(WS_URL);
ws2.on('message', (d) => ws2Frames.push(JSON.parse(d.toString())));
await new Promise(r => ws2.on('open', r));
ws2.send(JSON.stringify({ v: 1, t: 'auth', token, ts: Date.now() }));
await sleep(500);
ws2.send(JSON.stringify({ v: 1, t: 'subscribe', since: seen, ts: Date.now() }));
await sleep(1500);
const replayed = ws2Frames.filter(f => f.t === 'event');
check(replayed.every(e => e.seq > seen), `WsClient: reconnect with since=${seen} yields no duplicate events`);
check(!!ws2Frames.find(f => f.t === 'session.state'), 'WsClient: reconnect restores session state');

ws.close();
ws2.close();

console.log(`\n  RESULTS: ${pass} passed, ${fail} failed, ${pass + fail} total`);
if (fail) failures.forEach(f => console.log(`    ❌ ${f}`));
console.log('');
process.exit(fail ? 1 : 0);
