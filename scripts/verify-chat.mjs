/**
 * Verify `aibou chat`: a terminal session whose approvals are answered on the watch.
 *
 * This is the loop the developer actually wants — type in a terminal, approve on
 * the wrist, see the result back in the same terminal — so it is driven exactly
 * that way: the real CLI is spawned as a child, a prompt is typed into its stdin,
 * the Approve chip is tapped on the device, and the terminal's own output is
 * checked for the outcome.
 *
 * Nothing here answers the approval over a socket. If the watch does not answer,
 * the terminal stays blocked and this fails.
 *
 * Usage:
 *   node scripts/verify-chat.mjs [--serial emulator-5554] [--port 8787]
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv;
const SERIAL = argv.includes('--serial') ? argv[argv.indexOf('--serial') + 1] : null;
const PORT = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : '8787';
const PACKAGE = 'dev.aibou.wear';
const CLI = 'packages/bridge/dist/chat/cli.js';
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
let child = null;
function fail(msg) {
  console.error(`\nFAILED: ${msg}\n`);
  if (transcript) console.error(`--- terminal transcript ---\n${transcript}\n---------------------------`);
  child?.kill();
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
function adb(args) {
  try {
    return execFileSync(ADB, SERIAL ? ['-s', SERIAL, ...args] : args, {
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    return typeof err.stdout === 'string' ? err.stdout : '';
  }
}
const shell = (cmd) => adb(['shell', cmd]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
function uiDump() {
  shell('uiautomator dump /sdcard/aibou-chat.xml >/dev/null 2>&1');
  return adb(['exec-out', 'cat', '/sdcard/aibou-chat.xml']);
}
const screenText = (xml) =>
  [...xml.matchAll(/text="([^"]*)"/g)].map((m) => decodeEntities(m[1])).filter((t) => t.trim());

function bounds(tag) {
  const b = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(tag);
  if (!b) return null;
  const [x1, y1, x2, y2] = b.slice(1).map(Number);
  return { x1, y1, x2, y2 };
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
    const frame = { clickable: /clickable="true"/.test(m[0]), box: bounds(m[0]) };
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
            label: text,
          };
        }
      }
    }
  }
  return null;
}

// ─── The terminal under test ─────────────────────────────────────────────────

/** ANSI-stripped transcript of everything the CLI has printed. */
let transcript = '';
const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

function waitForOutput(pattern, timeoutMs, what) {
  return new Promise((resolve, reject) => {
    if (pattern.test(transcript)) return resolve(true);
    const iv = setInterval(() => {
      if (pattern.test(transcript)) {
        clearInterval(iv);
        clearTimeout(to);
        resolve(true);
      }
    }, 100);
    const to = setTimeout(() => {
      clearInterval(iv);
      reject(new Error(`timed out after ${timeoutMs}ms waiting for ${what}`));
    }, timeoutMs);
  });
}

console.log('\n> Stage 0 -- device and watch app');
if (!shell(`pm list packages ${PACKAGE}`).includes(PACKAGE)) {
  fail(`${PACKAGE} is not installed`);
}
check('watch app installed', true, PACKAGE);

shell(`am force-stop ${PACKAGE}`);
shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`);
await sleep(5000);

let connected = false;
for (let i = 0; i < 20 && !connected; i++) {
  connected = screenText(uiDump()).some((t) => t.startsWith('Connected'));
  if (!connected) await sleep(1000);
}
check('watch connected to the Bridge', connected);
if (!connected) fail('the watch never reported Connected');

// ─── Stage 1: launch the terminal session ────────────────────────────────────

console.log('\n> Stage 1 -- launch aibou chat');

child = spawn(process.execPath, [CLI, '--port', PORT], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: process.cwd(),
});
child.stdout.setEncoding('utf-8');
child.stderr.setEncoding('utf-8');
child.stdout.on('data', (d) => {
  transcript += strip(d);
});
child.stderr.on('data', (d) => {
  transcript += strip(d);
});
child.on('exit', (code) => {
  if (code !== 0 && code !== null) transcript += `\n[cli exited ${code}]\n`;
});

try {
  await waitForOutput(/aibou chat/, 60_000, 'the chat banner');
} catch (e) {
  fail(`${e.message} -- the CLI did not start`);
}
check('chat session started', true);

const accountLine = /account\s+(\S+)/.exec(transcript);
check(
  'terminal reports the signed-in Kiro account',
  Boolean(accountLine) && accountLine[1] !== 'unknown',
  accountLine ? accountLine[1] : 'no account line',
);
check(
  'session is live, not mock',
  /mode\s+live/.test(transcript),
  /mode\s+(\S+)/.exec(transcript)?.[1] ?? '?',
);
check(
  'terminal reports a connected device',
  /a device is connected/.test(transcript),
  'approvals will reach the watch',
);

// ─── Stage 2: type a prompt that needs approval ──────────────────────────────

console.log('\n> Stage 2 -- type a prompt that needs approval');
child.stdin.write(`${PROMPT}\n`);

try {
  await waitForOutput(/approval needed/, 120_000, 'the terminal to report an approval');
} catch (e) {
  fail(`${e.message} -- the agent did not escalate`);
}
check('terminal reports it is waiting for approval', true);
check(
  'terminal names the command awaiting approval',
  /Run: node --version/.test(transcript),
  'summary shown in the terminal',
);
check(
  'terminal says it is waiting for the watch',
  /waiting for your watch|waiting for a paired device/.test(transcript),
  'no silent stall',
);

// ─── Stage 3: approve on the watch ───────────────────────────────────────────

console.log('\n> Stage 3 -- approve on the watch');

let target = null;
for (let i = 0; i < 30 && !target; i++) {
  target = findTapTarget(uiDump(), 'Approve');
  if (!target) await sleep(1000);
}
check('approval reached the watch', Boolean(target), target ? target.label : 'never appeared');
if (!target) fail('the approval never appeared on the watch');

const beforeTap = transcript.length;
const tapAt = Date.now();
shell(`input tap ${target.x} ${target.y}`);

try {
  await waitForOutput(/allowed by you/, 30_000, 'the terminal to report the approval');
} catch (e) {
  fail(`${e.message} -- the watch tap did not reach this terminal`);
}
check(
  'terminal shows the decision came from the developer',
  true,
  `${Date.now() - tapAt}ms after the tap`,
);
check('the decision was not made by policy or timeout', !/allowed by (policy|timeout)/.test(transcript.slice(beforeTap)));

// ─── Stage 4: the agent carried on, in this terminal ─────────────────────────

console.log('\n> Stage 4 -- output lands back in the terminal');

try {
  await waitForOutput(new RegExp(process.version.replace(/\./g, '\\.')), 90_000, 'the command output');
} catch (e) {
  fail(`${e.message} -- the agent did not report the result here`);
}
check(
  `terminal shows the real command output ${process.version}`,
  true,
  'the command really ran, and the result came back here',
);
check(
  'terminal echoed the command it ran',
  /⚙ node --version/.test(transcript),
  'tool activity streamed inline',
);

// ─── Stage 5: leaving is clean ───────────────────────────────────────────────

console.log('\n> Stage 5 -- exit cleanly');
child.stdin.write('/exit\n');
const exitCode = await new Promise((resolve) => {
  const to = setTimeout(() => resolve('timeout'), 15_000);
  child.on('exit', (code) => {
    clearTimeout(to);
    resolve(code);
  });
});
check('exits cleanly', exitCode === 0, `exit ${exitCode}`);
check(
  'says the session stays open on the Bridge',
  /session stays open/.test(transcript),
  'work is not lost by leaving',
);

summarize();
const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.log('\nFailed checks:');
  for (const f of failed) console.log(`  - ${f.name}`);
  console.log(`\n--- terminal transcript ---\n${transcript}\n---------------------------`);
  process.exit(1);
}
console.log(
  '\nTyped in a terminal, approved on the watch, and the real agent continued — ' +
    'all under the signed-in Kiro account.\n',
);
process.exit(0);
