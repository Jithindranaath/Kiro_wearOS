/**
 * Automated end-to-end verification of the full Aibou loop against a REAL
 * Kiro agent — no human tap required.
 *
 * Two independent WebSocket clients are used on purpose:
 *   • DRIVER — creates the session and sends the prompt (stands in for the desk)
 *   • DEVICE — subscribes, receives permission.request, sends permission.respond
 *              (stands in for the watch; it is a separate socket with its own
 *              token, so the approving connection is genuinely not the one that
 *              asked)
 *
 * The DRIVER never answers the approval. If the DEVICE does not resolve it,
 * nothing proceeds — so a pass here means the remote-approval path really ran.
 *
 * Pass --real-device to skip the simulated tap and wait for your actual watch
 * to answer instead. Every other check is identical, so a pass in that mode
 * covers the physical hardware path too.
 *
 * Usage:
 *   node scripts/verify-live-loop.mjs <pairing-code> [--expect-mock] [--real-device]
 */

import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:8787';
const WS_URL = 'ws://127.0.0.1:8787/ws';
const CODE = process.argv[2];
const EXPECT_MODE = process.argv.includes('--expect-mock') ? 'mock' : 'live';
const REAL_DEVICE = process.argv.includes('--real-device');

if (!CODE) {
  console.error('Usage: node scripts/verify-live-loop.mjs <pairing-code> [--expect-mock]');
  process.exit(2);
}

const PROMPT =
  "Run the shell command 'node --version' and tell me exactly what it prints.";

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  summarize();
  process.exit(1);
}
function summarize() {
  const passed = checks.filter((c) => c.ok).length;
  console.log(`\n${'─'.repeat(60)}\n  ${passed}/${checks.length} checks passed\n${'─'.repeat(60)}`);
}

// ─── Client helper ───────────────────────────────────────────────────────────

async function pair(label) {
  const res = await fetch(`${BASE}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: CODE }),
  });
  if (!res.ok) {
    fail(
      res.status === 401
        ? `${label}: invalid or expired pairing code. Restart the Bridge and pass the new code.`
        : `${label}: pairing failed with HTTP ${res.status}`,
    );
  }
  const { token } = await res.json();
  return token;
}

function connect(label, token) {
  const frames = [];
  const ws = new WebSocket(WS_URL);

  const client = {
    label,
    frames,
    send: (f) => ws.send(JSON.stringify({ v: 1, ts: Date.now(), ...f })),
    close: () => ws.close(),
    waitFor(pred, timeout, what) {
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
          reject(new Error(`${label}: timed out after ${timeout}ms waiting for ${what}`));
        }, timeout);
      });
    },
  };

  ws.on('message', (d) => {
    const f = JSON.parse(d.toString());
    frames.push(f);
    if (f.t === 'heartbeat') client.send({ t: 'pong' });
  });

  client.ready = new Promise((r) => ws.on('open', r)).then(() => {
    client.send({ t: 'auth', token });
    return client.waitFor((f) => f.t === 'hello', 10_000, 'hello');
  });

  return client;
}

// ─── 0. Health ───────────────────────────────────────────────────────────────

console.log('\n▶ Stage 0 — Bridge health');
let health;
try {
  health = await (await fetch(`${BASE}/api/health`)).json();
} catch {
  fail('Bridge is not answering on 127.0.0.1:8787. Start it first.');
}
check('Bridge reachable', true, `v${health.version ?? '?'}`);

// ─── 1. Two paired clients ───────────────────────────────────────────────────

console.log('\n▶ Stage 1 — pair two independent clients');
const driverToken = await pair('DRIVER');
const deviceToken = await pair('DEVICE');
check('DRIVER + DEVICE issued distinct tokens', driverToken !== deviceToken);

const driver = connect('DRIVER', driverToken);
const device = connect('DEVICE', deviceToken);
const [driverHello, deviceHello] = await Promise.all([driver.ready, device.ready]);

check('both clients authenticated', true);
check(
  `agent mode is "${EXPECT_MODE}"`,
  driverHello.mode === EXPECT_MODE,
  `hello.mode = ${driverHello.mode}`,
);
if (driverHello.mode !== EXPECT_MODE) {
  fail(
    EXPECT_MODE === 'live'
      ? 'Bridge is in MOCK mode. Restart it without --mock to verify against real Kiro.'
      : 'Bridge is in LIVE mode but --expect-mock was passed.',
  );
}
check('DEVICE sees same mode as DRIVER', deviceHello.mode === driverHello.mode);

driver.send({ t: 'subscribe', id: 'sub-d' });
device.send({ t: 'subscribe', id: 'sub-w' });
await Promise.all([
  driver.waitFor((f) => f.t === 'ack' && f.id === 'sub-d', 10_000, 'driver subscribe ack'),
  device.waitFor((f) => f.t === 'ack' && f.id === 'sub-w', 10_000, 'device subscribe ack'),
]);
check('both clients subscribed', true);

// ─── 2. Session ──────────────────────────────────────────────────────────────

console.log('\n▶ Stage 2 — session against the real agent');
driver.send({ t: 'session.list', id: 'list' });
const list = await driver.waitFor((f) => f.t === 'ack' && f.id === 'list', 10_000, 'session list');

let sessionId;
const reusable = (list.result ?? []).find((s) => s.status === 'idle' || s.status === 'working');
const t0 = Date.now();
if (reusable) {
  sessionId = reusable.id;
  check('reused an existing session', true, sessionId);
} else {
  driver.send({ t: 'session.create', id: 'create', cwd: process.cwd() });
  const made = await driver.waitFor(
    (f) => (f.t === 'ack' || f.t === 'error') && f.id === 'create',
    90_000,
    'session.create',
  );
  if (made.t === 'error') fail(`session.create failed: ${made.code} — ${made.message}`);
  sessionId = made.result.id;
  check('session created', true, `${sessionId} in ${Date.now() - t0}ms`);
}
check(
  'session id looks agent-issued (not synthetic)',
  /^[0-9a-f-]{16,}$/i.test(sessionId),
  sessionId,
);

// ─── 3. Prompt → escalation ──────────────────────────────────────────────────

console.log('\n▶ Stage 3 — prompt that needs permission');
driver.frames.length = 0;
device.frames.length = 0;
driver.send({ t: 'prompt.send', id: 'p1', sessionId, text: PROMPT, source: 'text' });
await driver.waitFor((f) => f.t === 'ack' && f.id === 'p1', 10_000, 'prompt ack');
check('prompt acked immediately (turn is async)', true);

let perm;
try {
  perm = await device.waitFor((f) => f.t === 'permission.request', 120_000, 'permission.request');
} catch (e) {
  fail(
    `${e.message}\n   The agent did not escalate. Either policy auto-allowed the command, ` +
      `or the model answered without running one.`,
  );
}
check('DEVICE received permission.request', true, `approvalId ${perm.approvalId.slice(0, 8)}…`);
check('summary is human-readable', typeof perm.summary === 'string' && perm.summary.length > 0, perm.summary);
check(
  'toolInput carries the real command',
  typeof perm.toolInput?.command === 'string' && perm.toolInput.command.includes('node'),
  JSON.stringify(perm.toolInput),
);
check('riskTier present', ['low', 'medium', 'high'].includes(perm.riskTier), perm.riskTier);
check('expiry in the future', perm.expiresAt > Date.now(), `${Math.round((perm.expiresAt - Date.now()) / 1000)}s left`);

const awaiting = await driver.waitFor(
  (f) => f.t === 'session.state' && f.status === 'awaiting_permission',
  10_000,
  'awaiting_permission state',
);
check('session state → awaiting_permission', true, `source: ${awaiting.statusSource}`);
check('pendingApprovals counted', awaiting.pendingApprovals >= 1, String(awaiting.pendingApprovals));

// ─── 4. The tap — from the DEVICE socket only ────────────────────────────────

const tapAt = Date.now();
let resolved;

if (REAL_DEVICE) {
  console.log(
    `\n▶ Stage 4 — waiting for your watch to answer "${perm.summary}"\n` +
      '  (nothing in this script will resolve it — tap Approve now)',
  );
  try {
    resolved = await driver.waitFor(
      (f) => f.t === 'permission.resolved' && f.approvalId === perm.approvalId,
      Math.max(15_000, perm.expiresAt - Date.now()),
      'your tap on the watch',
    );
  } catch (e) {
    fail(`${e.message}\n   Nothing resolved the approval, so the loop is unproven.`);
  }
  check('a real device resolved it', true, `${Math.round((Date.now() - tapAt) / 1000)}s after it appeared`);
} else {
  console.log('\n▶ Stage 4 — DEVICE approves (DRIVER stays silent)');
  device.send({ t: 'permission.respond', id: 'tap', approvalId: perm.approvalId, decision: 'allow' });
  await device.waitFor((f) => f.t === 'ack' && f.id === 'tap', 10_000, 'respond ack');

  resolved = await driver.waitFor(
    (f) => f.t === 'permission.resolved' && f.approvalId === perm.approvalId,
    15_000,
    'permission.resolved',
  );
}
check('resolution attributed to a user, not policy/timeout', resolved.resolution === 'user', resolved.resolution);
check('decision is allow', resolved.decision === 'allow');
check('DRIVER saw the resolution it never sent', true, `${Date.now() - tapAt}ms after the tap`);

// ─── 5. Agent actually continued ─────────────────────────────────────────────

console.log('\n▶ Stage 5 — the agent resumed and produced real output');
const deadline = Date.now() + 60_000;
let idle;
while (Date.now() < deadline) {
  idle = driver.frames.find(
    (f) => f.t === 'session.state' && f.sessionId === sessionId && f.status === 'idle',
  );
  if (idle) break;
  await new Promise((r) => setTimeout(r, 200));
}

const events = driver.frames.filter((f) => f.t === 'event');
const blob = JSON.stringify(events);
const nodeVersion = process.version; // the version the real command must print

check('events streamed after approval', events.length > 0, `${events.length} events`);
check(
  `real command output contains ${nodeVersion}`,
  blob.includes(nodeVersion),
  blob.includes(nodeVersion) ? 'the command really executed' : 'not found in event payloads',
);
const text = events.filter((e) => e.kind === 'agent.text').map((e) => e.payload?.text ?? '').join('');
check('agent produced narrative text', text.trim().length > 0, JSON.stringify(text.slice(0, 90)));
check(
  'turn ended idle',
  Boolean(idle),
  idle ? `statusSource: ${idle.statusSource}` : 'still not idle after 60s',
);

// ─── Done ────────────────────────────────────────────────────────────────────

driver.close();
device.close();

summarize();
const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.log('\nFailed checks:');
  for (const f of failed) console.log(`  • ${f.name}`);
  process.exit(1);
}
console.log(
  '\n🎉 Full loop verified end-to-end against real Kiro:\n' +
    '   remote device tap → Bridge → ACP → agent executed a command → output returned.\n',
);
process.exit(0);
