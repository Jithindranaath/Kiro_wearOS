/**
 * Automated verification of the REAL Wear OS approval path.
 *
 * Unlike verify-live-loop.mjs (which simulates the watch with a second socket),
 * this drives the actual Wear OS app running on an emulator or a USB-attached
 * watch:
 *
 *   1. Confirms the app is installed, connected, and NOT in mock mode
 *   2. Sends a prompt from this script (the "desk" side)
 *   3. Waits for the app to render the approval, and asserts the text on the
 *      watch matches the command the Bridge actually received
 *   4. Locates the Approve chip via uiautomator and taps its real coordinates
 *   5. Asserts the resolution arrived from the watch's own WebSocket, and that
 *      the agent then executed the command for real
 *
 * This script never sends permission.respond. If the watch app does not send
 * it, nothing proceeds. Only the finger is synthetic.
 *
 * Usage:
 *   node scripts/verify-watch-tap.mjs <pairing-code> [--serial emulator-5554] [--deny]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:8787';
const WS_URL = 'ws://127.0.0.1:8787/ws';
const PACKAGE = 'dev.aibou.wear';
// Optional: a stored token is used when no code is given, or the code has aged out.
const CODE = /^\d{6}$/.test(process.argv[2] ?? '') ? process.argv[2] : null;
const DECISION = process.argv.includes('--deny') ? 'deny' : 'allow';
const serialArg = process.argv.indexOf('--serial');
const SERIAL = serialArg > -1 ? process.argv[serialArg + 1] : null;

const PROMPT = "Run the shell command 'node --version' and tell me exactly what it prints.";

// ─── Reporting ───────────────────────────────────────────────────────────────

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

// ─── adb plumbing ────────────────────────────────────────────────────────────

function resolveAdb() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
    process.env.HOME ? join(process.env.HOME, 'Android', 'Sdk') : null,
    process.env.HOME ? join(process.env.HOME, 'Library', 'Android', 'sdk') : null,
  ].filter(Boolean);

  for (const root of roots) {
    for (const name of ['adb.exe', 'adb']) {
      const candidate = join(root, 'platform-tools', name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'adb'; // fall back to PATH
}

const ADB = resolveAdb();

function adb(args, { binary = false } = {}) {
  const full = SERIAL ? ['-s', SERIAL, ...args] : args;
  return execFileSync(ADB, full, {
    encoding: binary ? 'buffer' : 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function shell(cmd) {
  return adb(['shell', cmd]);
}

/** Dump the current view hierarchy as XML text. */
function uiDump() {
  shell('uiautomator dump /sdcard/aibou-ui.xml >/dev/null 2>&1');
  return adb(['exec-out', 'cat', '/sdcard/aibou-ui.xml']);
}

/** All rendered text on screen, in document order. */
/** uiautomator emits non-BMP characters as numeric entities; decode them. */
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

function screenText(xml) {
  return [...xml.matchAll(/text="([^"]*)"/g)]
    .map((m) => decodeEntities(m[1]))
    .filter((t) => t.length > 0);
}

function bounds(tag) {
  const b = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(tag);
  if (!b) return null;
  const [x1, y1, x2, y2] = b.slice(1).map(Number);
  return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
}

/**
 * Locate the tappable control whose label contains `needle`.
 *
 * Compose renders a chip as a clickable View wrapping a TextView, so the text
 * node's own bounds are just the glyph box. Measuring that would understate the
 * touch target badly, so walk up to the nearest clickable ancestor and report
 * its geometry instead.
 */
function findTapTarget(xml, needle) {
  const stack = [];
  const tagRe = /<node\b[^>]*?(\/?)>|<\/node>/g;
  let m;

  while ((m = tagRe.exec(xml)) !== null) {
    const tag = m[0];

    if (tag === '</node>') {
      stack.pop();
      continue;
    }

    const selfClosing = m[1] === '/';
    const text = /text="([^"]*)"/.exec(tag)?.[1] ?? '';
    const clickable = /clickable="true"/.test(tag);
    const frame = { tag, clickable, box: bounds(tag) };

    if (!selfClosing) stack.push(frame);

    if (text.includes(needle)) {
      const chain = selfClosing ? [...stack, frame] : stack;
      for (let i = chain.length - 1; i >= 0; i--) {
        const f = chain[i];
        if (f.clickable && f.box) {
          return {
            x: Math.round((f.box.x1 + f.box.x2) / 2),
            y: Math.round((f.box.y1 + f.box.y2) / 2),
            text,
            height: f.box.height,
            width: f.box.width,
            measuredOn: 'clickable ancestor',
          };
        }
      }
      // No clickable ancestor: fall back to the label itself and say so.
      const own = frame.box;
      if (own) {
        return {
          x: Math.round((own.x1 + own.x2) / 2),
          y: Math.round((own.y1 + own.y2) / 2),
          text,
          height: own.height,
          width: own.width,
          measuredOn: 'label only',
        };
      }
    }
  }
  return null;
}

async function pollUi(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = uiDump();
    const hit = predicate(last);
    if (hit) return { hit, xml: last };
    await new Promise((r) => setTimeout(r, 700));
  }
  fail(`timed out after ${timeoutMs}ms waiting for ${what}. On screen: ${JSON.stringify(screenText(last))}`);
}

// ─── Bridge client (the "desk" side) ─────────────────────────────────────────

const frames = [];
let ws;
function send(f) {
  ws.send(JSON.stringify({ v: 1, ts: Date.now(), ...f }));
}
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

// ─── Stage 0: device ─────────────────────────────────────────────────────────

console.log('\n> Stage 0 -- device and app');

let devices;
try {
  devices = adb(['devices'])
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('device'))
    .map((l) => l.split(/\s+/)[0]);
} catch {
  fail(`could not run adb (${ADB}). Install platform-tools or set ANDROID_HOME.`);
}
if (devices.length === 0) fail('no adb device. Start the Wear OS emulator in Android Studio first.');
check('adb device attached', true, SERIAL ?? devices.join(', '));

const installed = shell(`pm list packages ${PACKAGE}`).includes(PACKAGE);
check('watch app installed', installed, PACKAGE);
if (!installed) fail(`${PACKAGE} is not installed. Run: cd wear && ./gradlew installDebug`);

// Restart cleanly so the app is on its start destination. Resuming an existing
// task would land on whatever screen was last open and make the dump ambiguous.
shell(`am force-stop ${PACKAGE}`);
shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`);
await new Promise((r) => setTimeout(r, 4000));

const boot = uiDump();
const bootText = screenText(boot);
check('app is on screen', bootText.length > 0, JSON.stringify(bootText));

if (bootText.some((t) => t.includes('Pairing code') || t.includes('Bridge address'))) {
  fail(
    'the watch app is not paired yet. On the emulator: enter host 10.0.2.2, port 8787, ' +
      `then the code ${CODE}. Then re-run this script.`,
  );
}
check('watch is paired (no pairing screen)', true);
check(
  'no MOCK badge on the watch',
  !bootText.some((t) => t.trim() === 'MOCK'),
  'live mode confirmed from the device UI',
);

const { hit: connected } = await pollUi(
  (xml) => screenText(xml).some((t) => t === 'Connected'),
  30_000,
  'the watch to report Connected',
);
check('watch reports Connected', Boolean(connected));

// ─── Stage 1: desk client ────────────────────────────────────────────────────

console.log('\n> Stage 1 -- desk client');

/**
 * Obtain a bearer token.
 *
 * Pairing codes live ten minutes, which is shorter than a working session, so
 * fall back to a token this machine was already issued instead of demanding a
 * Bridge restart. Tokens are read, never printed.
 */
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
    if (typeof stored === 'string' && stored.length > 0) return stored;
  } catch {
    /* nothing stored */
  }
  fail('could not authenticate. Pass a fresh pairing code from the Bridge banner.');
}

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
check('Bridge is in live mode', hello.mode === 'live', `hello.mode = ${hello.mode}`);
if (hello.mode !== 'live') fail('Bridge is in mock mode. Restart it without --mock.');

send({ t: 'subscribe', id: 'sub' });
await waitFor((f) => f.t === 'ack' && f.id === 'sub', 10_000, 'subscribe ack');

send({ t: 'session.list', id: 'list' });
const list = await waitFor((f) => f.t === 'ack' && f.id === 'list', 10_000, 'session list');
let sessionId;
const reusable = (list.result ?? []).find((s) => s.status === 'idle' || s.status === 'working');
if (reusable) {
  sessionId = reusable.id;
  check('session available', true, `reused ${sessionId}`);
} else {
  send({ t: 'session.create', id: 'create', cwd: process.cwd() });
  const made = await waitFor(
    (f) => (f.t === 'ack' || f.t === 'error') && f.id === 'create',
    90_000,
    'session.create',
  );
  if (made.t === 'error') fail(`session.create failed: ${made.code} -- ${made.message}`);
  sessionId = made.result.id;
  check('session available', true, `created ${sessionId}`);
}

// ─── Stage 2: prompt → approval on the watch ─────────────────────────────────

console.log('\n> Stage 2 -- prompt, then wait for the watch to render it');

frames.length = 0;
send({ t: 'prompt.send', id: 'p1', sessionId, text: PROMPT, source: 'text' });
await waitFor((f) => f.t === 'ack' && f.id === 'p1', 10_000, 'prompt ack');

let perm;
try {
  perm = await waitFor((f) => f.t === 'permission.request', 120_000, 'permission.request');
} catch (e) {
  fail(`${e.message} -- the agent did not escalate, so there is nothing to tap.`);
}
check('Bridge emitted permission.request', true, perm.summary);

const { hit: approveBtn, xml: approvalXml } = await pollUi(
  (xml) => findTapTarget(xml, 'Approve'),
  45_000,
  'the Approve button to appear on the watch',
);
const onWatch = screenText(approvalXml);
check('watch auto-navigated to the approval screen', true, JSON.stringify(onWatch));
check(
  'watch renders the same summary the Bridge sent',
  onWatch.some((t) => t === perm.summary),
  perm.summary,
);
check(
  'risk tier shown on the watch',
  onWatch.some((t) => /APPROVAL|HIGH RISK/.test(t)),
  onWatch.find((t) => /APPROVAL|HIGH RISK/.test(t)) ?? '',
);
// Touch targets are specified in dp, but uiautomator reports clipped pixel
// bounds. Convert using the device's real density, and measure each control at
// its largest observed size: ScalingLazyColumn shrinks items near the edges, so
// a single dump understates a chip that is simply not centred yet.
const density = readDensity();
const px2dp = (px) => Math.round(px / (density / 160));

const seen = { Approve: approveBtn, Deny: findTapTarget(approvalXml, 'Deny') };
for (let i = 0; i < 3; i++) {
  shell('input swipe 227 340 227 200 300'); // nudge the list up
  await new Promise((r) => setTimeout(r, 600));
  const xml = uiDump();
  for (const label of ['Approve', 'Deny']) {
    const found = findTapTarget(xml, label);
    if (found && (!seen[label] || found.height > seen[label].height)) seen[label] = found;
  }
  if (seen.Deny && seen.Deny.height >= 96) break;
}

check(
  'Deny is reachable on the approval screen',
  Boolean(seen.Deny),
  seen.Deny ? `${px2dp(seen.Deny.height)}dp tall once scrolled` : 'never found, even after scrolling',
);
check(
  'Deny visible without scrolling on arrival',
  Boolean(findTapTarget(approvalXml, 'Deny')),
  'both actions should be glanceable the moment the approval lands',
);
check(
  'Approve meets the 48dp minimum touch target',
  px2dp(approveBtn.height) >= 48,
  `${px2dp(approveBtn.height)}x${px2dp(approveBtn.width)}dp as first rendered ` +
    `(${approveBtn.height}px, density ${density}, measured on ${approveBtn.measuredOn})`,
);

function readDensity() {
  try {
    return Number(/(\d+)/.exec(shell('wm density'))?.[1] ?? 160);
  } catch {
    return 160;
  }
}

// ─── Stage 3: the tap ────────────────────────────────────────────────────────

// Re-locate from a fresh dump: scrolling above moved things.
const scrolledXml = uiDump();
const target =
  (DECISION === 'allow'
    ? findTapTarget(scrolledXml, 'Approve')
    : findTapTarget(scrolledXml, 'Deny')) ??
  (DECISION === 'allow' ? seen.Approve : seen.Deny);
if (!target) fail(`could not locate the ${DECISION === 'allow' ? 'Approve' : 'Deny'} control to tap.`);
console.log(
  `\n> Stage 3 -- tapping "${target.text.trim()}" at (${target.x},${target.y}) on the device`,
);

const tapAt = Date.now();
shell(`input tap ${target.x} ${target.y}`);

let resolved;
try {
  resolved = await waitFor(
    (f) => f.t === 'permission.resolved' && f.approvalId === perm.approvalId,
    20_000,
    'permission.resolved from the watch',
  );
} catch (e) {
  fail(`${e.message} -- the tap did not reach the Bridge.`);
}
check(
  'resolution came from a user, not policy or timeout',
  resolved.resolution === 'user',
  resolved.resolution,
);
check(`decision is ${DECISION}`, resolved.decision === DECISION, resolved.decision);
check('round trip from tap to Bridge', true, `${Date.now() - tapAt}ms`);

await pollUi(
  (xml) => !findTapTarget(xml, 'Approve'),
  20_000,
  'the approval screen to clear on the watch',
);
check('approval screen cleared on the watch', true);

// ─── Stage 4: the agent actually continued ───────────────────────────────────

console.log('\n> Stage 4 -- what the agent did next');

const deadline = Date.now() + 60_000;
let idle;
while (Date.now() < deadline) {
  idle = frames.find((f) => f.t === 'session.state' && f.sessionId === sessionId && f.status === 'idle');
  if (idle) break;
  await new Promise((r) => setTimeout(r, 200));
}

const events = frames.filter((f) => f.t === 'event');
const blob = JSON.stringify(events);
const text = events
  .filter((e) => e.kind === 'agent.text')
  .map((e) => e.payload?.text ?? '')
  .join('');

check('events streamed after the tap', events.length > 0, `${events.length} events`);
if (DECISION === 'allow') {
  check(
    `command output contains ${process.version}`,
    blob.includes(process.version),
    blob.includes(process.version) ? 'the command really ran' : 'not found',
  );
} else {
  check(
    'agent reports it was blocked',
    /reject|denied|blocked|not allowed|permission/i.test(text),
    JSON.stringify(text.slice(0, 120)),
  );
}
check('agent produced narrative text', text.trim().length > 0, JSON.stringify(text.slice(0, 100)));
check('turn ended idle', Boolean(idle), idle ? `statusSource: ${idle.statusSource}` : 'not idle after 60s');

const finalText = screenText(uiDump());
check(
  'watch returned to the status screen',
  finalText.some((t) => t === 'Connected'),
  JSON.stringify(finalText),
);

ws.close();
summarize();

const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.log('\nFailed checks:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
console.log(
  '\nVerified on real hardware path: Wear OS app rendered the real command, ' +
    `a tap on its ${DECISION === 'allow' ? 'Approve' : 'Deny'} chip travelled over the watch's own ` +
    'WebSocket to the Bridge, and the real Kiro agent acted on it.\n',
);
process.exit(0);
