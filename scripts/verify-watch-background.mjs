/**
 * Verify that an approval reaches the developer when the watch app is NOT on
 * screen, and that answering it from the notification reflects back into the
 * agent.
 *
 * This is the case that used to fail silently: the client was owned by the
 * Activity and torn down with it, so leaving the app severed the socket and the
 * agent sat blocked while the watch showed a clock face.
 *
 * Sequence:
 *   1. Launch the app, confirm it is connected, then press HOME
 *   2. Send a prompt from the desk side
 *   3. Assert the OS actually posted an Aibou notification while backgrounded
 *   4. Open the notification stream and tap Approve on the real notification
 *   5. Assert the Bridge saw a user decision and the agent then ran the command
 *
 * Usage:
 *   node scripts/verify-watch-background.mjs [code] [--serial emulator-5554] [--port 8787]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const argv = process.argv;
const CODE = argv[2] && /^\d{6}$/.test(argv[2]) ? argv[2] : null;
const SERIAL = argv.includes('--serial') ? argv[argv.indexOf('--serial') + 1] : null;
const PORT = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : '8787';
const PACKAGE = 'dev.aibou.wear';
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const PROMPT = "Run the shell command 'node --version' and tell me exactly what it prints.";

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

// ─── adb ─────────────────────────────────────────────────────────────────────

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
const adb = (args) =>
  execFileSync(ADB, SERIAL ? ['-s', SERIAL, ...args] : args, {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });

/**
 * Run a device command, tolerating a non-zero exit.
 *
 * Several probes here legitimately "fail": `grep` exits 1 when it matches
 * nothing, and some shell subcommands are absent on Wear images. Throwing on
 * those would abort the run for a non-problem.
 */
function shell(cmd) {
  try {
    return adb(['shell', cmd]);
  } catch (err) {
    return typeof err.stdout === 'string' ? err.stdout : '';
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
function uiDump() {
  shell('uiautomator dump /sdcard/aibou-bg.xml >/dev/null 2>&1');
  return adb(['exec-out', 'cat', '/sdcard/aibou-bg.xml']);
}
const screenText = (xml) =>
  [...xml.matchAll(/text="([^"]*)"/g)].map((m) => decodeEntities(m[1])).filter((t) => t.trim());

function bounds(tag) {
  const b = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(tag);
  if (!b) return null;
  const [x1, y1, x2, y2] = b.slice(1).map(Number);
  return { x1, y1, x2, y2, height: y2 - y1, width: x2 - x1 };
}

/** Tappable node matching `needle` in its text or content-desc. */
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
    const text = decodeEntities(/text="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const desc = decodeEntities(/content-desc="([^"]*)"/.exec(m[0])?.[1] ?? '');
    if (text.includes(needle) || desc.includes(needle)) {
      const chain = selfClosing ? [...stack, frame] : stack;
      for (let i = chain.length - 1; i >= 0; i--) {
        const f = chain[i];
        if (f.clickable && f.box) {
          return {
            x: Math.round((f.box.x1 + f.box.x2) / 2),
            y: Math.round((f.box.y1 + f.box.y2) / 2),
            label: text || desc,
          };
        }
      }
      if (frame.box) {
        return {
          x: Math.round((frame.box.x1 + frame.box.x2) / 2),
          y: Math.round((frame.box.y1 + frame.box.y2) / 2),
          label: text || desc,
          notClickable: true,
        };
      }
    }
  }
  return null;
}

/** Does the OS currently hold a notification posted by the watch app? */
function postedNotification() {
  const dump = shell('dumpsys notification --noredact');
  // Records are separated by blank-ish lines; find the block for our package.
  const index = dump.indexOf(PACKAGE);
  if (index === -1) return null;
  const block = dump.slice(Math.max(0, index - 400), index + 2500);
  if (!/aibou_approvals/.test(block)) return null;
  return {
    channel: 'aibou_approvals',
    title: /android\.title=([^\n]*)/.exec(block)?.[1]?.trim() ?? '',
    text: /android\.text=([^\n]*)/.exec(block)?.[1]?.trim() ?? '',
    hasActions: /actions=\{|Action\[/.test(block) || /android\.actions/.test(block),
  };
}

// ─── Bridge socket ───────────────────────────────────────────────────────────

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
    console.log(`  ..  code rejected (HTTP ${res.status}); using a stored token`);
  }
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.aibou', 'config.json'), 'utf-8'));
    const stored = Array.isArray(cfg.tokens) ? cfg.tokens.at(-1) : null;
    if (stored) return stored;
  } catch {
    /* none stored */
  }
  fail('could not authenticate; pass a fresh pairing code');
}

// ─── Stage 0 ─────────────────────────────────────────────────────────────────

console.log('\n> Stage 0 -- app, permission, connection');

if (!shell(`pm list packages ${PACKAGE}`).includes(PACKAGE)) {
  fail(`${PACKAGE} not installed`);
}

// Connect first and clear anything already pending. The Bridge replays open
// approvals on subscribe, so a leftover from an earlier run would put the app on
// the approval screen before this test has sent anything, and every later
// assertion would be measuring the wrong approval.
const token = await getToken();
ws = new WebSocket(WS_URL);
ws.on('message', (d) => {
  const f = JSON.parse(d.toString());
  frames.push(f);
  if (f.t === 'heartbeat') send({ t: 'pong' });
});
await new Promise((r) => ws.on('open', r));
send({ t: 'auth', token });
const hello = await waitFor((f) => f.t === 'hello', 10_000, 'hello');
send({ t: 'subscribe', id: 'sub' });
await waitFor((f) => f.t === 'ack' && f.id === 'sub', 10_000, 'subscribe ack');

const stale = frames.filter((f) => f.t === 'permission.request');
for (const s of stale) {
  send({ t: 'permission.respond', id: `drain-${s.approvalId}`, approvalId: s.approvalId, decision: 'deny' });
}
if (stale.length > 0) {
  console.log(`  ..  cleared ${stale.length} approval(s) left over from an earlier run`);
  await sleep(3000);
}
check('Bridge connected and clear of pending approvals', true, `mode=${hello.mode}`);

// Notifications are how a backgrounded approval reaches the developer, so grant
// up front rather than racing the runtime dialog.
shell(`pm grant ${PACKAGE} android.permission.POST_NOTIFICATIONS`);
const granted = shell(`dumpsys package ${PACKAGE}`).includes('POST_NOTIFICATIONS: granted=true');
check('notification permission granted', granted);

shell(`am force-stop ${PACKAGE}`);
shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`);
await sleep(5000);

let connected = false;
for (let i = 0; i < 20 && !connected; i++) {
  // Header reads "Connected · <account>", so match the prefix.
  connected = screenText(uiDump()).some((t) => t.startsWith('Connected'));
  if (!connected) await sleep(1000);
}
check('app connected to the Bridge', connected);
if (!connected) fail('the app never reported Connected');

// ─── Stage 1: background it ──────────────────────────────────────────────────

console.log('\n> Stage 1 -- send the app to the background');

const serviceRunning = /BridgeConnectionService/.test(
  shell(`dumpsys activity services ${PACKAGE}`),
);
check('foreground connection service is running', serviceRunning, 'holds the socket off screen');

const clientsBefore = (await (await fetch(`${BASE}/api/health`)).json()).clients;

shell('input keyevent KEYCODE_HOME');
await sleep(2500);
const focus = shell('dumpsys window | grep mCurrentFocus') ?? '';
check(
  'watch app is no longer in the foreground',
  !focus.includes(PACKAGE),
  focus.trim().split('\n')[0]?.trim() ?? 'unknown focus',
);

// The freezer used to suspend the process within roughly a minute, after which
// the Bridge dropped the client on missed heartbeats. Wait past that window
// before asserting the connection survived, or the test proves nothing.
const WAIT_MS = 95_000;
console.log(`  ..  waiting ${WAIT_MS / 1000}s off screen, past the freeze and heartbeat window`);
await sleep(WAIT_MS);

const clientsAfter = (await (await fetch(`${BASE}/api/health`)).json()).clients;
check(
  'connection survived being backgrounded',
  clientsAfter >= clientsBefore,
  `Bridge clients ${clientsBefore} -> ${clientsAfter}`,
);
const frozen = /freezing .*${PACKAGE}/.test(shell('logcat -d -t 300'));
if (frozen) console.log('  ..  note: the OS still reported freezing at some point');

// ─── Stage 2: desk sends work ────────────────────────────────────────────────

console.log('\n> Stage 2 -- prompt from the desk while the watch is away');
send({ t: 'session.list', id: 'list' });
const list = await waitFor((f) => f.t === 'ack' && f.id === 'list', 10_000, 'list');
let sessionId = (list.result ?? []).find((s) => s.status === 'idle' || s.status === 'working')?.id;
if (!sessionId) {
  send({ t: 'session.create', id: 'create', cwd: process.cwd() });
  const made = await waitFor((f) => (f.t === 'ack' || f.t === 'error') && f.id === 'create', 90_000, 'create');
  if (made.t === 'error') fail(`session.create failed: ${made.code} -- ${made.message}`);
  sessionId = made.result.id;
}
check('session ready', true, sessionId);

frames.length = 0;
send({ t: 'prompt.send', id: 'p1', sessionId, text: PROMPT, source: 'text' });
await waitFor((f) => f.t === 'ack' && f.id === 'p1', 10_000, 'prompt ack');

let perm;
try {
  perm = await waitFor((f) => f.t === 'permission.request', 120_000, 'permission.request');
} catch (e) {
  fail(e.message);
}
check('Bridge raised an approval', true, perm.summary);

// ─── Stage 3: did it reach the wrist? ────────────────────────────────────────

console.log('\n> Stage 3 -- did the watch surface it while backgrounded?');
let posted = null;
for (let i = 0; i < 20 && !posted; i++) {
  posted = postedNotification();
  if (!posted) await sleep(1000);
}
check(
  'the OS posted an Aibou approval notification',
  Boolean(posted),
  posted ? `title=${JSON.stringify(posted.title)} text=${JSON.stringify(posted.text)}` : 'nothing posted',
);
if (!posted) {
  fail('the approval never surfaced outside the app -- a backgrounded watch would miss it');
}
check(
  'notification text carries the real summary',
  posted.text.includes(perm.summary) || posted.title.length > 0,
  `${JSON.stringify(posted.text)} vs ${JSON.stringify(perm.summary)}`,
);
check('notification offers inline actions', posted.hasActions, 'Approve / Deny on the notification');

// ─── Stage 4: answer it from the notification ────────────────────────────────

console.log('\n> Stage 4 -- open the notification and tap Approve');

// Wear opens the notification stream on a swipe up from the bottom.
shell('input swipe 227 430 227 90 300');
await sleep(2500);

let target = findTapTarget(uiDump(), 'Approve');
if (!target) {
  // The stream may show a collapsed card; open it, then look again.
  const card = findTapTarget(uiDump(), 'Kiro') ?? findTapTarget(uiDump(), 'approval');
  if (card) {
    shell(`input tap ${card.x} ${card.y}`);
    await sleep(2500);
    target = findTapTarget(uiDump(), 'Approve');
  }
}
if (!target) {
  fail(`could not find Approve in the notification stream. On screen: ${JSON.stringify(screenText(uiDump()))}`);
}
check('Approve is reachable from the notification', true, JSON.stringify(target.label));

const tapAt = Date.now();
shell(`input tap ${target.x} ${target.y}`);

let resolved;
try {
  resolved = await waitFor(
    (f) => f.t === 'permission.resolved' && f.approvalId === perm.approvalId,
    25_000,
    'permission.resolved',
  );
} catch (e) {
  fail(`${e.message} -- the notification tap did not reach the Bridge`);
}
check('a user decision reached the Bridge', resolved.resolution === 'user', `${Date.now() - tapAt}ms`);
check('decision is allow', resolved.decision === 'allow', resolved.decision);

// ─── Stage 5: the agent carried on ───────────────────────────────────────────

console.log('\n> Stage 5 -- the agent carried on');
const deadline = Date.now() + 60_000;
let idle;
while (Date.now() < deadline) {
  idle = frames.find((f) => f.t === 'session.state' && f.sessionId === sessionId && f.status === 'idle');
  if (idle) break;
  await sleep(200);
}
const events = frames.filter((f) => f.t === 'event');
const blob = JSON.stringify(events);
check('events streamed after the tap', events.length > 0, `${events.length} events`);
check(
  `real command output contains ${process.version}`,
  blob.includes(process.version),
  blob.includes(process.version) ? 'the command really ran' : 'not found',
);
check('turn ended idle', Boolean(idle), idle ? `statusSource: ${idle.statusSource}` : 'not idle in 60s');

let cleared = false;
for (let i = 0; i < 12 && !cleared; i++) {
  cleared = postedNotification() === null;
  if (!cleared) await sleep(1000);
}
check('notification cleared once resolved', cleared, 'no stale approval left on the wrist');

ws.close();
summarize();
const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.log('\nFailed checks:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
console.log(
  '\nAn approval now reaches the developer with the app closed, and answering it ' +
    'on the notification resumes the real agent.\n',
);
process.exit(0);
