/**
 * Verify externally-raised approvals reach the watch and that a tap decides them.
 *
 * Scope: the `POST /api/approval` path — `ApprovalManager.createExternalApproval`,
 * where the approval is held open on an HTTP response rather than on an ACP
 * JSON-RPC request. `verify-watch-tap.mjs` covers the other origin, approvals the
 * ACP agent itself raises. Both end on the same watch; only the channel that
 * carries the answer back differs, and answering the wrong one would hang a
 * caller forever, so each needs its own test.
 *
 * Replaces verify-ide-hook.mjs, which reached this endpoint through the Kiro IDE
 * `preToolUse` hook. That hook is gone: it blocked forever on a stdin that never
 * reached EOF, so it never raised a single approval.
 *
 * This answers nothing itself — the decision comes from tapping the device over
 * adb, so a pass means the watch genuinely gated the call.
 *
 * Usage: node scripts/verify-watch-live.mjs [--port 8787] [--serial emulator-5554]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d) => (argv.indexOf(n) !== -1 ? argv[argv.indexOf(n) + 1] : d);
const PORT = flag('--port', '8787');
const SERIAL = flag('--serial', null);
const BASE = `http://127.0.0.1:${PORT}`;
const PACKAGE = 'dev.aibou.wear';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveAdb() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
  ].filter(Boolean);
  for (const root of roots) {
    for (const name of ['adb.exe', 'adb']) {
      const p = join(root, 'platform-tools', name);
      if (existsSync(p)) return p;
    }
  }
  return 'adb';
}
const ADB = resolveAdb();
const adb = (args) => {
  try {
    return execFileSync(ADB, SERIAL ? ['-s', SERIAL, ...args] : args, {
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    return typeof err.stdout === 'string' ? err.stdout : '';
  }
};
const shell = (cmd) => adb(['shell', cmd]);
const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

function uiDump() {
  shell('uiautomator dump /sdcard/aibou-live.xml >/dev/null 2>&1');
  return adb(['exec-out', 'cat', '/sdcard/aibou-live.xml']);
}
const screenText = (xml) =>
  [...xml.matchAll(/text="([^"]*)"/g)].map((m) => decode(m[1])).filter((t) => t.trim());

function bounds(tag) {
  const b = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(tag);
  if (!b) return null;
  const [x1, y1, x2, y2] = b.slice(1).map(Number);
  return { x1, y1, x2, y2 };
}

/** Find the clickable ancestor of a label, so taps land on the real control. */
function findTapTarget(xml, needle) {
  const stack = [];
  const re = /<node\b[^>]*?(\/?)>|<\/node>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[0] === '</node>') {
      stack.pop();
      continue;
    }
    const selfClosing = m[1] === '/';
    const frame = { clickable: /clickable="true"/.test(m[0]), box: bounds(m[0]) };
    if (!selfClosing) stack.push(frame);
    const text = decode(/text="([^"]*)"/.exec(m[0])?.[1] ?? '');
    if (text.includes(needle)) {
      const chain = selfClosing ? [...stack, frame] : stack;
      for (let i = chain.length - 1; i >= 0; i--) {
        const f = chain[i];
        if (f.clickable && f.box) {
          return { x: Math.round((f.box.x1 + f.box.x2) / 2), y: Math.round((f.box.y1 + f.box.y2) / 2) };
        }
      }
    }
  }
  return null;
}

function storedToken() {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.aibou', 'config.json'), 'utf-8'));
    return (Array.isArray(cfg.tokens) ? cfg.tokens : []).filter((t) => typeof t === 'string').at(-1);
  } catch {
    return null;
  }
}

// ─── Preflight ───────────────────────────────────────────────────────────────

console.log('\n> preflight');
let health;
try {
  health = await (await fetch(`${BASE}/api/health`)).json();
} catch {
  console.error('\nFAILED: the Bridge is not running on ' + BASE + '\n');
  process.exit(1);
}
check('Bridge reachable', health.status === 'ok', `v${health.version}`);

const token = storedToken();
check('this machine has a pairing token', Boolean(token));
if (!token) process.exit(1);

check(`${PACKAGE} installed`, shell(`pm list packages ${PACKAGE}`).includes(PACKAGE));
if (!shell(`pidof ${PACKAGE}`).trim()) {
  shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`);
  await sleep(6000);
}

/**
 * Confirm the watch is connected, from whichever screen it happens to be on.
 *
 * "Connected" only renders on the status screen. A watch left on the Account or
 * settings screen is perfectly connected but shows no such text, which failed
 * this check and reported "watch never connected" while the Bridge could see the
 * socket. So back out of any sub-screen first, and treat the Bridge's own client
 * count as corroborating evidence rather than trusting one string.
 */
let connected = false;
for (let attempt = 0; attempt < 4 && !connected; attempt++) {
  for (let i = 0; i < 6 && !connected; i++) {
    connected = screenText(uiDump()).some((t) => t.startsWith('Connected'));
    if (!connected) await sleep(1000);
  }
  if (!connected) shell('input keyevent KEYCODE_BACK');
}
if (!connected) {
  // Last resort: the socket is what matters, not the wording on screen.
  const live = await (await fetch(`${BASE}/api/health`)).json();
  check('watch socket attached to the Bridge', live.clients > 0, `${live.clients} client(s)`);
  console.log(`  ..  on screen: ${JSON.stringify(screenText(uiDump()))}`);
  if (live.clients === 0) {
    console.error('\nFAILED: no client is attached to the Bridge\n');
    process.exit(1);
  }
} else {
  check('watch reports Connected', true);
}

// ─── The approval reaches the watch, and a tap decides it ────────────────────

/** Raise an approval and leave it open; the device must answer it. */
function raise(summaryCommand, riskTier) {
  return fetch(`${BASE}/api/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      summary: `Run: ${summaryCommand}`,
      toolName: 'shell',
      toolInput: { command: summaryCommand },
      riskTier,
      sessionId: 'verify-watch-live',
      timeoutMs: 90_000,
    }),
  }).then((r) => r.json());
}

async function waitForLabel(label, needle, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const xml = uiDump();
    const text = screenText(xml);
    if (text.some((t) => t.includes(needle)) && findTapTarget(xml, label)) return text;
    await sleep(1000);
  }
  return null;
}
async function waitCleared(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!findTapTarget(uiDump(), 'Approve')) return true;
    await sleep(500);
  }
  return false;
}

for (const [stage, command, risk, label, expect] of [
  ['approve', 'git status --short', 'medium', 'Approve', 'allow'],
  ['deny', 'rm -rf build', 'high', 'Deny', 'deny'],
]) {
  console.log(`\n> ${stage} -- "${command}"`);
  check('screen clear before starting', await waitCleared());

  const inFlight = raise(command, risk);
  const onScreen = await waitForLabel(label, command);
  check(`approval appeared on the watch`, Boolean(onScreen), onScreen?.find((t) => t.includes(command)));
  if (!onScreen) {
    console.error(`\nFAILED: never showed up. On screen: ${JSON.stringify(screenText(uiDump()))}\n`);
    process.exit(1);
  }
  check('watch shows the real command', onScreen.some((t) => t.includes(command)));
  if (risk === 'high') {
    check('destructive command flagged high risk', onScreen.some((t) => /HIGH RISK/i.test(t)),
      onScreen.find((t) => /RISK/i.test(t)));
  }

  const target = findTapTarget(uiDump(), label);
  const tappedAt = Date.now();
  if (target) shell(`input tap ${target.x} ${target.y}`);
  console.log(`  ..  tapped ${label}`);

  const outcome = await Promise.race([inFlight, sleep(30_000).then(() => null)]);
  check('the held request returned after the tap', Boolean(outcome), `${Date.now() - tappedAt}ms`);
  check(`decision is ${expect}`, outcome?.decision === expect, JSON.stringify(outcome));
  check('resolved by a human, not policy or timeout', outcome?.resolution === 'user', outcome?.resolution);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

const passed = checks.filter((c) => c.ok).length;
console.log(`\n${'-'.repeat(58)}\n  ${passed}/${checks.length} checks passed\n${'-'.repeat(58)}`);
const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}`);
} else {
  console.log('\nReal-time approvals reach the watch, and a tap decides them.\n');
}

/**
 * Set the code and let Node wind down on its own.
 *
 * `process.exit()` here aborted the process on Windows with
 * "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) ... async.c, line 76",
 * because `fetch` keep-alive sockets were still closing. That turned a fully
 * passing run into exit 1. Global fetch keeps sockets ~4s, so this exits shortly
 * and with the right code.
 */
process.exitCode = failed.length > 0 ? 1 : 0;
