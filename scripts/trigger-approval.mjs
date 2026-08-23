/**
 * Trigger a real approval and wait for a human to answer it.
 *
 * Creates a session, sends a prompt, then deliberately does NOT answer the
 * permission request — so it sits on your watch (and in the PWA) until you tap
 * Approve or Deny. Reports how it was resolved.
 *
 * Use this to verify the Wear OS approval flow without needing the browser.
 *
 * Usage:
 *   node scripts/trigger-approval.mjs <pairing-code> [prompt]
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:8787';
const WS_URL = 'ws://127.0.0.1:8787/ws';
const args = process.argv.slice(2);
// The code is optional: a bare prompt is fine when a stored token exists.
const CODE = /^\d{6}$/.test(args[0] ?? '') ? args.shift() : null;
const PROMPT = args[0] ?? 'run the tests';

// ─── Authenticate ────────────────────────────────────────────────────────────

/**
 * Get a bearer token.
 *
 * Pairing codes live for ten minutes, which is shorter than a working session,
 * so fall back to a token this machine was already issued rather than forcing a
 * Bridge restart just to run a script. Tokens are never printed.
 */
async function getToken() {
  if (CODE) {
    const res = await fetch(`${BASE}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: CODE }),
    });
    if (res.ok) return (await res.json()).token;
    console.log(`code rejected (HTTP ${res.status}); falling back to a stored token`);
  }

  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.aibou', 'config.json'), 'utf-8'));
    const stored = Array.isArray(cfg.tokens) ? cfg.tokens.at(-1) : null;
    if (typeof stored === 'string' && stored.length > 0) return stored;
  } catch {
    /* nothing stored yet */
  }

  console.error(
    '\n❌ Could not authenticate.\n' +
      '   Pass a fresh pairing code from the Bridge banner:\n' +
      '     node scripts/trigger-approval.mjs <code> "<prompt>"\n',
  );
  process.exit(1);
}

const token = await getToken();

// ─── Connect ─────────────────────────────────────────────────────────────────

const frames = [];
const ws = new WebSocket(WS_URL);
ws.on('message', (d) => {
  const f = JSON.parse(d.toString());
  frames.push(f);
  if (f.t === 'heartbeat') ws.send(JSON.stringify({ v: 1, t: 'pong', ts: Date.now() }));
});

function waitFor(pred, timeout, label) {
  return new Promise((resolve, reject) => {
    const hit = frames.find(pred);
    if (hit) return resolve(hit);
    const iv = setInterval(() => {
      const f = frames.find(pred);
      if (f) { clearInterval(iv); clearTimeout(to); resolve(f); }
    }, 50);
    const to = setTimeout(() => {
      clearInterval(iv);
      reject(new Error(`timed out after ${timeout}ms waiting for ${label}`));
    }, timeout);
  });
}

await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ v: 1, t: 'auth', token, ts: Date.now() }));

const hello = await waitFor((f) => f.t === 'hello', 10_000, 'hello');
console.log(`\nconnected — Bridge v${hello.bridgeVersion}, mode: ${hello.mode}`);

ws.send(JSON.stringify({ v: 1, t: 'subscribe', id: 'sub', since: 0, ts: Date.now() }));
await waitFor((f) => f.t === 'ack' && f.id === 'sub', 10_000, 'subscribe ack');

// ─── Reuse an existing session, or create one ────────────────────────────────

ws.send(JSON.stringify({ v: 1, t: 'session.list', id: 'list', ts: Date.now() }));
const list = await waitFor((f) => f.t === 'ack' && f.id === 'list', 10_000, 'session list');

let sessionId;
const reusable = list.result.find((s) => s.status === 'idle' || s.status === 'working');

if (reusable) {
  sessionId = reusable.id;
  console.log(`reusing session ${sessionId} (${reusable.status})`);
} else {
  console.log('creating a session (a real agent can take several seconds)...');
  ws.send(JSON.stringify({
    v: 1, t: 'session.create', id: 'create', cwd: process.cwd(), ts: Date.now(),
  }));
  const made = await waitFor(
    (f) => (f.t === 'ack' || f.t === 'error') && f.id === 'create',
    60_000,
    'session create',
  );
  if (made.t === 'error') {
    console.error(`\n❌ Could not create a session: ${made.code} — ${made.message}`);
    if (made.code === 'AIBOU_SESSION_LIMIT') {
      console.error('   Restart the Bridge to clear existing sessions.\n');
    }
    process.exit(1);
  }
  sessionId = made.result.id;
  console.log(`created session ${sessionId}`);
}

// ─── Send the prompt ─────────────────────────────────────────────────────────

frames.length = 0;
console.log(`\nsending prompt: "${PROMPT}"`);
ws.send(JSON.stringify({
  v: 1, t: 'prompt.send', id: 'prompt', sessionId, text: PROMPT, source: 'text', ts: Date.now(),
}));

let perm;
try {
  perm = await waitFor((f) => f.t === 'permission.request', 90_000, 'permission request');
} catch {
  console.error(
    '\n❌ No permission request arrived.\n' +
      '   In mock mode one should appear in ~1.5s.\n' +
      '   With a real agent, the prompt may not have needed permission — try one\n' +
      "   that runs a command, e.g. \"Run the shell command 'node --version'\".\n",
  );
  ws.close();
  process.exit(1);
}

const secondsLeft = Math.max(0, Math.round((perm.expiresAt - Date.now()) / 1000));

console.log(`
${'─'.repeat(58)}
  🔐 APPROVAL IS NOW PENDING — check your watch
${'─'.repeat(58)}
  summary    ${perm.summary}
  tool       ${perm.toolName}
  risk       ${perm.riskTier}
  input      ${JSON.stringify(perm.toolInput)}
  expires in ${secondsLeft}s
${'─'.repeat(58)}

The watch should have woken and be showing:  "${perm.summary}"
with full-width Approve / Deny buttons.

Tap one now. This script is deliberately NOT answering.
Waiting...
`);

// ─── Wait for a human ────────────────────────────────────────────────────────

const waitMs = Math.max(10_000, perm.expiresAt - Date.now() + 5_000);
let resolved;
try {
  resolved = await waitFor(
    (f) => f.t === 'permission.resolved' && f.approvalId === perm.approvalId,
    waitMs,
    'your decision',
  );
} catch {
  console.error('\n❌ Nothing resolved it before the timeout window elapsed.\n');
  ws.close();
  process.exit(1);
}

const how =
  resolved.resolution === 'user' ? 'a human tapped it'
  : resolved.resolution === 'policy' ? `the policy engine (rule: ${resolved.ruleId})`
  : 'the timeout fired (auto-deny)';

console.log(`✅ resolved: ${resolved.decision.toUpperCase()} — ${how}`);

if (resolved.resolution === 'user' && resolved.decision === 'allow') {
  console.log('\nAgent resuming; watching for follow-up activity...\n');
  const before = frames.filter((f) => f.t === 'event').length;
  await new Promise((r) => setTimeout(r, 4000));
  const after = frames.filter((f) => f.t === 'event');
  console.log(`  ${after.length - before} more events after approval`);
  for (const e of after.slice(before)) {
    const p = e.payload ?? {};
    const preview = typeof p.text === 'string'
      ? JSON.stringify(p.text.slice(0, 70))
      : JSON.stringify(p).slice(0, 90);
    console.log(`    [${e.kind}] ${preview}`);
  }
  const state = frames.filter((f) => f.t === 'session.state').pop();
  if (state) console.log(`\n  session is now: ${state.status} (${state.statusSource})`);
  console.log('\n🎉 Full loop verified: watch tap → Bridge → ACP → agent continued.\n');
} else {
  console.log('');
}

ws.close();
process.exit(0);
