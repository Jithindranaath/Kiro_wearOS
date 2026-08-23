/**
 * Verify that the watch shows what the agent is doing, not just its status.
 *
 * Drives the real Wear OS app: sends a prompt, then reads the device's own view
 * hierarchy to confirm the agent's activity (tool commands, real output, prose)
 * actually reached the wrist. Also re-checks the approval screen now that both
 * buttons are meant to fit without scrolling.
 *
 * Works against either agent — mock or live — because the Bridge emits the same
 * event frames through the same normalizer either way. The reported mode is
 * printed so the result is never ambiguous.
 *
 * Usage:
 *   node scripts/verify-watch-activity.mjs <pairing-code> [--serial emulator-5554] [--port 8787]
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const argv = process.argv;
const CODE = argv[2] && !argv[2].startsWith('--') ? argv[2] : null;
const SERIAL = argv.includes('--serial') ? argv[argv.indexOf('--serial') + 1] : null;
const PORT = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : '8787';
const PACKAGE = 'dev.aibou.wear';
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

/**
 * Obtain a bearer token.
 *
 * Prefers a fresh pairing code. Pairing codes expire after ten minutes, which
 * makes them useless against a Bridge that has been up a while, so fall back to
 * a token this machine was already issued. Tokens are read but never printed.
 */
async function getToken() {
  if (CODE) {
    const res = await fetch(`${BASE}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: CODE }),
    });
    if (res.ok) return { token: (await res.json()).token, how: 'paired with the code' };
    console.log(`  ..  code rejected (HTTP ${res.status}); trying a stored token`);
  }

  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.aibou', 'config.json'), 'utf-8'));
    const stored = Array.isArray(cfg.tokens) ? cfg.tokens.at(-1) : null;
    if (typeof stored === 'string' && stored.length > 0) {
      return { token: stored, how: 'reused a stored token from ~/.aibou/config.json' };
    }
  } catch {
    /* no stored config */
  }

  fail(
    'could not authenticate. Restart the Bridge for a fresh pairing code and pass it as the first argument.',
  );
}

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
const adb = (args, opts = {}) =>
  execFileSync(ADB, SERIAL ? ['-s', SERIAL, ...args] : args, {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  });
const shell = (cmd) => adb(['shell', cmd]);

function uiDump() {
  shell('uiautomator dump /sdcard/aibou-ui.xml >/dev/null 2>&1');
  return adb(['exec-out', 'cat', '/sdcard/aibou-ui.xml']);
}
/**
 * uiautomator serialises non-BMP characters as numeric entities, so an emoji
 * glyph arrives as "&#128202;" rather than the character itself. Decode before
 * matching, or every check involving a glyph silently fails.
 */
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

const screenText = (xml) =>
  [...xml.matchAll(/text="([^"]*)"/g)]
    .map((m) => decodeEntities(m[1]))
    .filter((t) => t.trim().length > 0);

function bounds(tag) {
  const b = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(tag);
  if (!b) return null;
  const [x1, y1, x2, y2] = b.slice(1).map(Number);
  return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
}

/** Tappable control whose label contains `needle`, measured on its clickable ancestor. */
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
    const frame = { tag: m[0], clickable: /clickable="true"/.test(m[0]), box: bounds(m[0]) };
    if (!selfClosing) stack.push(frame);
    const text = decodeEntities(/text="([^"]*)"/.exec(m[0])?.[1] ?? '');
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
          };
        }
      }
    }
  }
  return null;
}

async function pollUi(pred, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = uiDump();
    const hit = pred(last);
    if (hit) return { hit, xml: last };
    await new Promise((r) => setTimeout(r, 600));
  }
  return { hit: null, xml: last, timedOut: true, what, timeoutMs };
}

const density = Number(/(\d+)/.exec(shell('wm density'))?.[1] ?? 160);
const px2dp = (px) => Math.round(px / (density / 160));

// ─── Bridge socket (the desk side) ───────────────────────────────────────────

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

// ─── Stage 0 ─────────────────────────────────────────────────────────────────

console.log('\n> Stage 0 -- device');
if (!shell(`pm list packages ${PACKAGE}`).includes(PACKAGE)) {
  fail(`${PACKAGE} not installed. Run: cd wear && .\\gradlew.bat installDebug`);
}
check('watch app installed', true, PACKAGE);

shell(`am force-stop ${PACKAGE}`);
shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`);
await new Promise((r) => setTimeout(r, 4000));

const boot = screenText(uiDump());
if (boot.some((t) => t.includes('Pairing code') || t.includes('Bridge address'))) {
  fail(`the app is not paired. Pair it to 10.0.2.2:${PORT}, then re-run.`);
}
check('app launched and paired', true, JSON.stringify(boot));

const conn = await pollUi(
  (xml) => screenText(xml).some((t) => t === 'Connected'),
  30_000,
  'Connected',
);
check('watch connected to the Bridge', Boolean(conn.hit));
if (!conn.hit) fail(`watch never reported Connected. On screen: ${JSON.stringify(screenText(conn.xml))}`);

// The Activity entry point hangs off a session, so only assert it when one
// exists. With no session there is nothing to show and nothing to link to.
if (!boot.includes('No active session')) {
  const xml = uiDump();
  const entry =
    findTapTarget(xml, 'Activity') ??
    ['💬', '⚙', '✓', '📋', '📊'].map((g) => findTapTarget(xml, g)).find(Boolean);
  check(
    'activity is reachable from the status screen',
    Boolean(entry),
    entry ? `tappable chip: ${JSON.stringify(entry.text.slice(0, 40))}` : 'no entry point found',
  );
}

// ─── Stage 1 ─────────────────────────────────────────────────────────────────

console.log('\n> Stage 1 -- desk client');
const { token, how } = await getToken();
check('authenticated to the Bridge', true, how);

ws = new WebSocket(WS_URL);
ws.on('message', (d) => {
  const f = JSON.parse(d.toString());
  frames.push(f);
  if (f.t === 'heartbeat') send({ t: 'pong' });
});
await new Promise((r) => ws.on('open', r));
send({ t: 'auth', token });
const hello = await waitFor((f) => f.t === 'hello', 10_000, 'hello');
console.log(`  ..  agent mode: ${hello.mode}`);
check('Bridge reachable over AWP', true, `mode=${hello.mode}, v${hello.bridgeVersion}`);

send({ t: 'subscribe', id: 'sub' });
await waitFor((f) => f.t === 'ack' && f.id === 'sub', 10_000, 'subscribe ack');

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

// ─── Stage 2: activity reaches the wrist ─────────────────────────────────────

console.log('\n> Stage 2 -- prompt, then read the watch');
frames.length = 0;
send({ t: 'prompt.send', id: 'p1', sessionId, text: PROMPT, source: 'text' });
await waitFor((f) => f.t === 'ack' && f.id === 'p1', 10_000, 'prompt ack');

const perm = await waitFor((f) => f.t === 'permission.request', 120_000, 'permission.request').catch(
  (e) => fail(`${e.message} -- no approval to show`),
);
check('approval requested', true, perm.summary);

// --- the approval screen, re-measured after the layout change ---
const appr = await pollUi((xml) => findTapTarget(xml, 'Approve'), 45_000, 'Approve');
if (!appr.hit) fail('Approve never appeared on the watch');
const apprXml = appr.xml;
const approveBtn = findTapTarget(apprXml, 'Approve');
const denyBtn = findTapTarget(apprXml, 'Deny');
const apprText = screenText(apprXml);

check('watch shows the approval', true, JSON.stringify(apprText));
check('summary matches the Bridge frame', apprText.includes(perm.summary), perm.summary);
check(
  'Deny visible without scrolling',
  Boolean(denyBtn),
  denyBtn ? `${px2dp(denyBtn.height)}x${px2dp(denyBtn.width)}dp` : 'still below the fold',
);
check(
  'Approve meets 48dp',
  px2dp(approveBtn.height) >= 48,
  `${px2dp(approveBtn.height)}x${px2dp(approveBtn.width)}dp`,
);
check(
  'Approve and Deny are the same size',
  Boolean(denyBtn) && denyBtn.height === approveBtn.height,
  denyBtn ? `${px2dp(denyBtn.height)}dp vs ${px2dp(approveBtn.height)}dp` : 'n/a',
);

// --- tap Approve on the device ---
const tapAt = Date.now();
shell(`input tap ${approveBtn.x} ${approveBtn.y}`);
const resolved = await waitFor(
  (f) => f.t === 'permission.resolved' && f.approvalId === perm.approvalId,
  20_000,
  'permission.resolved',
).catch((e) => fail(`${e.message} -- the tap did not reach the Bridge`));
check('tap resolved by a user', resolved.resolution === 'user', `${Date.now() - tapAt}ms`);
check('decision allow', resolved.decision === 'allow');

// --- wait for the turn to finish, then read the feed ---
const deadline = Date.now() + 60_000;
let idle;
while (Date.now() < deadline) {
  idle = frames.find((f) => f.t === 'session.state' && f.sessionId === sessionId && f.status === 'idle');
  if (idle) break;
  await new Promise((r) => setTimeout(r, 200));
}
check('turn completed', Boolean(idle), idle ? `statusSource: ${idle.statusSource}` : 'not idle in 60s');

const events = frames.filter((f) => f.t === 'event');
const agentText = events
  .filter((e) => e.kind === 'agent.text')
  .map((e) => e.payload?.text ?? '')
  .join('');
console.log(`  ..  Bridge sent ${events.length} events; agent said ${JSON.stringify(agentText.slice(0, 80))}`);

// The status screen should now carry a preview of the newest activity.
const preview = await pollUi(
  (xml) => screenText(xml).some((t) => /💬|⚙|✓|📋/.test(t) && t.length > 2),
  25_000,
  'an activity preview on the status screen',
);
check(
  'status screen previews the latest activity',
  Boolean(preview.hit),
  JSON.stringify(screenText(preview.xml)),
);

// Open the activity feed.
const chip = findTapTarget(preview.xml, '💬') ?? findTapTarget(preview.xml, 'activity');
if (!chip) fail(`could not find the activity chip. On screen: ${JSON.stringify(screenText(preview.xml))}`);
shell(`input tap ${chip.x} ${chip.y}`);
await new Promise((r) => setTimeout(r, 2500));

/**
 * Read the whole feed, not just the visible window: scroll to the top, then
 * walk down collecting every line. Items above or below the fold would
 * otherwise look like missing data.
 */
async function collectFeedText() {
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    shell('input swipe 227 150 227 390 240'); // drag down = scroll up
    await new Promise((r) => setTimeout(r, 450));
  }
  for (let i = 0; i < 7; i++) {
    for (const t of screenText(uiDump())) seen.add(t);
    shell('input swipe 227 390 227 150 240');
    await new Promise((r) => setTimeout(r, 450));
  }
  for (const t of screenText(uiDump())) seen.add(t);
  return [...seen];
}

const feed = await collectFeedText();
const feedBlob = feed.join(' | ');
console.log(`  ..  feed contents: ${JSON.stringify(feed)}`);

check('activity feed opened', feed.length > 2, `${feed.length} lines across the whole feed`);

// Assert against what the Bridge actually sent, never a hardcoded expectation.
// The mock agent runs its own scripted commands, so a literal like
// "node --version" would only ever pass in live mode.
const toolStart = events.find((e) => e.kind === 'tool.start');
const expectedCommand =
  toolStart?.payload?.rawInput?.command ?? toolStart?.payload?.title ?? null;

function toolOutputOf(event) {
  const content = event?.payload?.content;
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    const direct = typeof c?.text === 'string' ? c.text : null;
    if (direct?.trim()) return direct.trim();
    const nested = typeof c?.content?.text === 'string' ? c.content.text : null;
    if (nested?.trim()) return nested.trim();
  }
  return null;
}
const expectedOutput = events.filter((e) => e.kind === 'tool.end').map(toolOutputOf).find(Boolean);

/** Does the feed contain a recognisable run of words from `expected`? */
function feedContains(expected) {
  if (!expected) return false;
  const cleaned = expected.replace(/\s+/g, ' ').trim();
  if (feedBlob.replace(/\s+/g, ' ').includes(cleaned)) return true;
  // Fall back to a distinctive fragment: watch lines are truncated by design.
  const fragment = cleaned.split(' ').slice(0, 4).join(' ');
  return fragment.length > 3 && feedBlob.replace(/\s+/g, ' ').includes(fragment);
}

check(
  'feed shows the command the agent ran',
  feedContains(expectedCommand),
  expectedCommand ? `tool.start command: ${JSON.stringify(expectedCommand)}` : 'no tool.start in this turn',
);
check(
  'feed shows the real command output',
  feedContains(expectedOutput),
  expectedOutput ? `tool.end output: ${JSON.stringify(expectedOutput.slice(0, 40))}` : 'no tool output in this turn',
);
check(
  "feed shows the agent's own words",
  feedContains(agentText),
  agentText.trim() ? JSON.stringify(agentText.trim().slice(0, 50)) : 'agent sent no prose',
);
check(
  'feed labels each line by type',
  ['⚙', '✓', '💬'].filter((g) => feedBlob.includes(g)).length >= 2,
  ['⚙', '✓', '💬', '📊'].filter((g) => feedBlob.includes(g)).join(' '),
);

// ─── Stage 3: an approval must interrupt the feed ─────────────────────────────

// The watch is still on the activity feed here. An approval arriving now has to
// take over the screen: a destination's effects stop running once it leaves
// composition, so this is exactly the case that used to be missed.
console.log('\n> Stage 3 -- approval interrupts while the feed is open');

const onFeed = screenText(uiDump());
check(
  'still on the activity feed',
  !onFeed.some((t) => t.includes('Approve')),
  JSON.stringify(onFeed.slice(0, 4)),
);

frames.length = 0;
send({ t: 'prompt.send', id: 'p2', sessionId, text: PROMPT, source: 'text' });
await waitFor((f) => f.t === 'ack' && f.id === 'p2', 10_000, 'second prompt ack');

let perm2;
try {
  perm2 = await waitFor((f) => f.t === 'permission.request', 120_000, 'second permission.request');
} catch (e) {
  fail(`${e.message} -- could not test the interrupt path`);
}

const raised = await pollUi((xml) => findTapTarget(xml, 'Approve'), 30_000, 'the approval to take over');
check(
  'approval took over the activity screen',
  Boolean(raised.hit),
  raised.hit ? JSON.stringify(screenText(raised.xml)) : 'the feed stayed on screen',
);
if (!raised.hit) fail('an approval arriving while the feed was open did not reach the developer');

const approve2 = findTapTarget(raised.xml, 'Approve');
shell(`input tap ${approve2.x} ${approve2.y}`);
const resolved2 = await waitFor(
  (f) => f.t === 'permission.resolved' && f.approvalId === perm2.approvalId,
  20_000,
  'second resolution',
).catch((e) => fail(e.message));
check('second approval resolved from the watch', resolved2.resolution === 'user', resolved2.decision);

// Dismissing should return to where the developer was, not reset them.
await new Promise((r) => setTimeout(r, 3000));
const after = screenText(uiDump());
check(
  'returns to the screen the developer was on',
  after.some((t) => t === 'Activity') || after.some((t) => /💬|⚙|✓/.test(t)),
  JSON.stringify(after.slice(0, 4)),
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
  `\nThe watch now shows the agent's activity, not just its status. ` +
    `Verified against a "${hello.mode}" agent on port ${PORT}.\n`,
);
process.exit(0);
