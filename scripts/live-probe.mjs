/**
 * Live probe — drives a real kiro-cli ACP session through the Bridge and
 * prints every AWP frame received, so we can confirm real behaviour.
 *
 * Usage: node scripts/live-probe.mjs <pairing-code> [prompt]
 */

import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:8787';
const WS_URL = 'ws://127.0.0.1:8787/ws';
const CODE = process.argv[2];
const PROMPT = process.argv[3] ?? 'Run the shell command `node --version` and tell me the output.';

if (!CODE) {
  console.error('Usage: node scripts/live-probe.mjs <pairing-code> [prompt]');
  process.exit(1);
}

const pairRes = await fetch(`${BASE}/api/pair`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE }),
});
if (!pairRes.ok) {
  console.error(`Pairing failed: HTTP ${pairRes.status}`);
  process.exit(1);
}
const { token } = await pairRes.json();
console.log('paired ✔');

const ws = new WebSocket(WS_URL);
const seen = [];

ws.on('message', (d) => {
  const f = JSON.parse(d.toString());
  seen.push(f);
  const t = f.t;
  if (t === 'heartbeat') return;

  if (t === 'event') {
    const p = f.payload ?? {};
    const preview = typeof p.text === 'string'
      ? JSON.stringify(p.text.slice(0, 90))
      : JSON.stringify(p).slice(0, 120);
    console.log(`  [event #${f.seq}] ${f.kind} ${preview}`);
  } else if (t === 'session.state') {
    console.log(`  [state] ${f.status} (${f.statusSource}) pending=${f.pendingApprovals}`);
  } else if (t === 'permission.request') {
    console.log(`\n  🔐 PERMISSION REQUEST`);
    console.log(`     approvalId: ${f.approvalId}`);
    console.log(`     toolName:   ${f.toolName}`);
    console.log(`     summary:    ${f.summary}`);
    console.log(`     riskTier:   ${f.riskTier}`);
    console.log(`     toolInput:  ${f.toolInput === undefined ? '(undefined ← BUG)' : JSON.stringify(f.toolInput).slice(0, 220)}`);
    console.log(`     → auto-approving in 1s\n`);
    setTimeout(() => {
      ws.send(JSON.stringify({
        v: 1, t: 'permission.respond', approvalId: f.approvalId, decision: 'allow', ts: Date.now(),
      }));
    }, 1000);
  } else if (t === 'permission.resolved') {
    console.log(`  ✅ RESOLVED ${f.decision} by ${f.resolution}${f.ruleId ? ` (rule: ${f.ruleId})` : ''}`);
  } else if (t === 'error') {
    console.log(`  ❌ ERROR ${f.code}: ${f.message}`);
  } else if (t === 'ack') {
    console.log(`  [ack] id=${f.id ?? '-'}`);
  } else if (t === 'hello') {
    console.log(`  [hello] mode=${f.mode} bridge=v${f.bridgeVersion}`);
  }
});

/** Poll `seen` until a frame matches, or reject on timeout. */
function waitFor(pred, timeout, label) {
  return new Promise((resolve, reject) => {
    const hit = seen.find(pred);
    if (hit) return resolve(hit);
    const iv = setInterval(() => {
      const f = seen.find(pred);
      if (f) { clearInterval(iv); clearTimeout(to); resolve(f); }
    }, 50);
    const to = setTimeout(() => {
      clearInterval(iv);
      reject(new Error(`timed out after ${timeout}ms waiting for ${label}`));
    }, timeout);
  });
}

await new Promise(r => ws.on('open', r));
ws.send(JSON.stringify({ v: 1, t: 'auth', token, ts: Date.now() }));
await waitFor(f => f.t === 'hello', 10_000, 'hello');
ws.send(JSON.stringify({ v: 1, t: 'subscribe', id: 's1', since: 0, ts: Date.now() }));
await waitFor(f => f.t === 'ack' && f.id === 's1', 10_000, 'subscribe ack');

// A real kiro-cli `session/new` round-trip has been measured at >3s, so allow
// a generous window here instead of a fixed sleep.
console.log('\ncreating session (real agent can take several seconds)...');
ws.send(JSON.stringify({
  v: 1, t: 'session.create', id: 'c1', cwd: process.cwd(), ts: Date.now(),
}));

let created;
try {
  created = await waitFor(
    f => (f.t === 'ack' || f.t === 'error') && f.id === 'c1',
    45_000,
    'session.create response',
  );
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}

if (created.t === 'error') {
  console.error(`❌ session.create failed: ${created.code} ${created.message}`);
  process.exit(1);
}
if (!created.result?.id) {
  console.error('❌ session.create acked without a session id');
  process.exit(1);
}
const sessionId = created.result.id;
console.log(`session: ${sessionId}`);

console.log(`\nsending prompt: "${PROMPT}"\n`);
ws.send(JSON.stringify({
  v: 1, t: 'prompt.send', id: 'p1', sessionId, text: PROMPT, source: 'text', ts: Date.now(),
}));

// Observe for 75 seconds
const WATCH_MS = 75_000;
await new Promise(r => setTimeout(r, WATCH_MS));

const events = seen.filter(f => f.t === 'event');
const perms = seen.filter(f => f.t === 'permission.request');
const resolutions = seen.filter(f => f.t === 'permission.resolved');

console.log('\n' + '─'.repeat(60));
console.log(`events:              ${events.length}`);
console.log(`event kinds:         ${[...new Set(events.map(e => e.kind))].join(', ') || '(none)'}`);
console.log(`permission requests: ${perms.length}`);
console.log(`resolutions:         ${resolutions.length}`);
console.log(`  by policy:         ${resolutions.filter(r => r.resolution === 'policy').length}`);
console.log(`  by user:           ${resolutions.filter(r => r.resolution === 'user').length}`);
console.log('─'.repeat(60) + '\n');

ws.close();
process.exit(events.length > 0 ? 0 : 1);
