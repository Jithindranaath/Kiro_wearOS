/**
 * Integration test — exercises the full flow:
 * 1. Health check
 * 2. Pair with bridge
 * 3. Connect WebSocket
 * 4. Authenticate
 * 5. Subscribe
 * 6. Create session
 * 7. Send prompt
 * 8. Receive events (agent text, tool call)
 * 9. Receive permission request
 * 10. Approve permission
 * 11. Verify resolution received
 */

import WebSocket from 'ws';

const BASE_URL = 'http://127.0.0.1:8787';
const WS_URL = 'ws://127.0.0.1:8787/ws';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ ${message}`);
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Step 1: Health check ────────────────────────────────────────────────────
console.log('\n🔍 Step 1: Health check');
const healthRes = await fetch(`${BASE_URL}/api/health`);
assert(healthRes.ok, `Health endpoint returns 200 (got ${healthRes.status})`);
const healthBody = await healthRes.json();
assert(healthBody.status === 'ok', `Health status is "ok"`);
assert(healthBody.version === '1.0.0', `Version is 1.0.0`);

// ─── Step 2: Get pairing code from process output ─────────────────────────────
// We'll try pairing with the code shown in the bridge output
console.log('\n🔍 Step 2: Pair with bridge');
// First, test invalid code
const badPairRes = await fetch(`${BASE_URL}/api/pair`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: '000000' }),
});
assert(badPairRes.status === 401, `Invalid code returns 401 (got ${badPairRes.status})`);

// Pair with the correct code (read from env or use the one we saw)
const pairingCode = process.argv[2] || '344930';
const pairRes = await fetch(`${BASE_URL}/api/pair`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: pairingCode }),
});
assert(pairRes.ok, `Valid code returns 200 (got ${pairRes.status})`);
const { token } = await pairRes.json();
assert(token && token.length === 64, `Token is 64 hex chars (got ${token?.length})`);

// ─── Step 3-5: WebSocket connect, auth, subscribe ─────────────────────────────
console.log('\n🔍 Step 3-5: WebSocket connect + auth + subscribe');

const frames = [];
let ws;

await new Promise((resolve, reject) => {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    assert(true, 'WebSocket connected');
    // Send auth frame
    ws.send(JSON.stringify({ v: 1, t: 'auth', token, ts: Date.now() }));
  });

  ws.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    frames.push(frame);

    if (frame.t === 'hello') {
      assert(frame.mode === 'mock', `Hello frame has mode: "mock" (got "${frame.mode}")`);
      assert(frame.protocolVersion === 1, `Protocol version is 1`);
      // Subscribe
      ws.send(JSON.stringify({ v: 1, t: 'subscribe', since: 0, ts: Date.now() }));
    }

    if (frame.t === 'ack' && frames.filter(f => f.t === 'ack').length === 1) {
      assert(frame.ok === true, 'Subscribe acknowledged');
      resolve();
    }
  });

  ws.on('error', (err) => reject(err));
  setTimeout(() => reject(new Error('WS timeout')), 5000);
});

// ─── Step 6: Create session ──────────────────────────────────────────────────
console.log('\n🔍 Step 6: Create session');
frames.length = 0;

ws.send(JSON.stringify({
  v: 1, t: 'session.create', id: 'create-1', cwd: process.cwd(), ts: Date.now()
}));

await sleep(2000);

const createAck = frames.find(f => f.t === 'ack' && f.id === 'create-1');
assert(!!createAck, 'Session create acknowledged');
const sessionId = createAck?.result?.id;
assert(!!sessionId, `Got session ID: ${sessionId}`);

// Debug: show all frame types received
const frameTypes = frames.map(f => `${f.t}${f.sessionId ? '('+f.sessionId+')' : ''}`).join(', ');
console.log(`  [debug] Frames received: ${frameTypes}`);

const sessionState = frames.find(f => f.t === 'session.state' && f.sessionId === sessionId);
assert(!!sessionState, 'Received session.state frame');
assert(sessionState?.status === 'idle', `Session status is "idle" (got "${sessionState?.status}")`);

// ─── Step 7: Send prompt ─────────────────────────────────────────────────────
console.log('\n🔍 Step 7: Send prompt');
frames.length = 0;

ws.send(JSON.stringify({
  v: 1, t: 'prompt.send', id: 'prompt-1', sessionId, text: 'Run the tests', source: 'text', ts: Date.now()
}));

await sleep(3000); // Mock agent takes ~1.5s to send permission request

// ─── Step 8: Receive events ──────────────────────────────────────────────────
console.log('\n🔍 Step 8: Receive events');
const events = frames.filter(f => f.t === 'event');
assert(events.length > 0, `Received ${events.length} events`);

const textEvent = events.find(e => e.kind === 'agent.text');
assert(!!textEvent, 'Received agent.text event');

const toolEvent = events.find(e => e.kind === 'tool.start');
assert(!!toolEvent, 'Received tool.start event');

// ─── Step 9: Receive permission request ──────────────────────────────────────
console.log('\n🔍 Step 9: Receive permission request');
const permRequest = frames.find(f => f.t === 'permission.request');
assert(!!permRequest, 'Received permission.request frame');
assert(!!permRequest?.approvalId, `Has approvalId: ${permRequest?.approvalId}`);
assert(permRequest?.summary?.length <= 80, `Summary ≤80 chars: "${permRequest?.summary}"`);
assert(['low', 'medium', 'high'].includes(permRequest?.riskTier), `Risk tier is valid: "${permRequest?.riskTier}"`);

// Check session is awaiting_permission
const awaitState = frames.filter(f => f.t === 'session.state').pop();
assert(awaitState?.status === 'awaiting_permission', `Session status is "awaiting_permission" (got "${awaitState?.status}")`);

// ─── Step 10: Approve permission ─────────────────────────────────────────────
console.log('\n🔍 Step 10: Approve permission');
frames.length = 0;

ws.send(JSON.stringify({
  v: 1, t: 'permission.respond', id: 'approve-1', approvalId: permRequest.approvalId, decision: 'allow', ts: Date.now()
}));

await sleep(2000);

// ─── Step 11: Verify resolution ──────────────────────────────────────────────
console.log('\n🔍 Step 11: Verify resolution');
const approveAck = frames.find(f => f.t === 'ack' && f.id === 'approve-1');
assert(!!approveAck, 'Approve acknowledged');

const resolved = frames.find(f => f.t === 'permission.resolved');
assert(!!resolved, 'Received permission.resolved frame');
assert(resolved?.decision === 'allow', `Resolution decision is "allow" (got "${resolved?.decision}")`);
assert(resolved?.resolution === 'user', `Resolution source is "user" (got "${resolved?.resolution}")`);

// Check session state updated after resolution
const postResolveState = frames.filter(f => f.t === 'session.state').pop();
assert(postResolveState?.status !== 'awaiting_permission' || postResolveState?.pendingApprovals === 0,
  `Session no longer awaiting_permission after resolution`);

// ─── Step 12: Test duplicate approval (AC2.1.4) ──────────────────────────────
console.log('\n🔍 Step 12: Test duplicate approval rejection');
frames.length = 0;

ws.send(JSON.stringify({
  v: 1, t: 'permission.respond', id: 'dupe-1', approvalId: permRequest.approvalId, decision: 'deny', ts: Date.now()
}));

await sleep(500);

const dupeError = frames.find(f => f.t === 'error' && f.code === 'AIBOU_ALREADY_RESOLVED');
assert(!!dupeError, 'Duplicate approval returns AIBOU_ALREADY_RESOLVED');

// ─── Step 13: PWA serving ────────────────────────────────────────────────────
console.log('\n🔍 Step 13: PWA served from Bridge');
const pwaRes = await fetch(`${BASE_URL}/`);
assert(pwaRes.ok, `PWA index.html served (status ${pwaRes.status})`);
const pwaHtml = await pwaRes.text();
assert(pwaHtml.includes('<!DOCTYPE html>'), 'Response is HTML');
assert(pwaHtml.includes('Aibou'), 'HTML contains "Aibou"');

// ─── Step 14: Test interrupt ─────────────────────────────────────────────────
console.log('\n🔍 Step 14: Session interrupt');
frames.length = 0;

ws.send(JSON.stringify({
  v: 1, t: 'session.interrupt', id: 'interrupt-1', sessionId, ts: Date.now()
}));

await sleep(1000);

const interruptAck = frames.find(f => f.t === 'ack' && f.id === 'interrupt-1');
assert(!!interruptAck, 'Interrupt acknowledged');

// ─── Cleanup ─────────────────────────────────────────────────────────────────
ws.close();

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
