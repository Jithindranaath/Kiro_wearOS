/**
 * Run every Aibou verification in order and report one verdict.
 *
 * Preflight first, because most "failures" are really a missing precondition —
 * no Bridge, no emulator, or a Bridge in mock mode when a suite needs the real
 * agent. Those are reported as blockers rather than as failing checks, so a red
 * result always means something is actually wrong.
 *
 * Usage:
 *   node scripts/verify-all.mjs [--serial emulator-5554] [--skip-device] [--quick]
 *
 *   --skip-device  Node suites only; no emulator needed
 *   --quick        Skip the background test, which waits 95s past the OS freeze
 *                  window and dominates the runtime
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv;
const SERIAL = argv.includes('--serial') ? argv[argv.indexOf('--serial') + 1] : null;
const SKIP_DEVICE = argv.includes('--skip-device');
const QUICK = argv.includes('--quick');
const PORT = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : '8787';
const BASE = `http://127.0.0.1:${PORT}`;
const PACKAGE = 'dev.aibou.wear';

const blockers = [];
const results = [];

function heading(text) {
  console.log(`\n${'='.repeat(64)}\n  ${text}\n${'='.repeat(64)}`);
}

// ─── Preflight ───────────────────────────────────────────────────────────────

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

function adbOut(args) {
  try {
    return execFileSync(ADB, SERIAL ? ['-s', SERIAL, ...args] : args, {
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

heading('Preflight');

console.log(`  node            ${process.version}`);

// Kiro account — the agent cannot do anything without one.
let kiroAccount = null;
try {
  const out = execFileSync(process.env.AIBOU_KIRO_BIN ?? 'kiro-cli', ['whoami', '--format', 'json'], {
    encoding: 'utf-8',
    timeout: 20_000,
    windowsHide: true,
  });
  kiroAccount = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  console.log(`  kiro account    ${kiroAccount.email ?? kiroAccount.accountType ?? 'signed in'}`);
} catch {
  console.log('  kiro account    NOT SIGNED IN');
  blockers.push('No Kiro account is signed in. Run: kiro-cli login --social google');
}

// Bridge
let health = null;
let mode = null;
try {
  health = await (await fetch(`${BASE}/api/health`)).json();
  const account = await (await fetch(`${BASE}/api/account`)).json();
  mode = account.state === 'mock' ? 'mock' : 'live';
  console.log(`  bridge          v${health.version}, ${health.clients} client(s), account ${account.state}`);
} catch {
  console.log(`  bridge          NOT RUNNING on ${BASE}`);
  blockers.push(`Bridge is not running. Start it: node packages/bridge/dist/index.js`);
}

if (mode === 'mock') {
  blockers.push(
    'Bridge is in mock mode. The account and live-agent suites need the real agent — ' +
      'restart without --mock.',
  );
}

// Device
let deviceReady = false;
if (!SKIP_DEVICE) {
  const devices = adbOut(['devices'])
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('device'));

  if (devices.length === 0) {
    console.log('  emulator        NONE ATTACHED');
    blockers.push(
      'No adb device. Launch the Wear_OS_Large_Round AVD from Android Studio, or pass --skip-device.',
    );
  } else {
    console.log(`  emulator        ${devices.map((d) => d.split(/\s+/)[0]).join(', ')}`);
    if (!adbOut(['shell', `pm list packages ${PACKAGE}`]).includes(PACKAGE)) {
      console.log(`  watch app       NOT INSTALLED`);
      blockers.push(`${PACKAGE} is not installed. Run: cd wear && .\\gradlew.bat installDebug`);
    } else {
      const paired = !adbOut(['shell', `dumpsys package ${PACKAGE}`]).includes('NOT_INSTALLED');
      console.log(`  watch app       installed${paired ? '' : ' (state unclear)'}`);
      deviceReady = true;
    }
  }
} else {
  console.log('  emulator        skipped (--skip-device)');
}

if (blockers.length > 0) {
  console.log('\n  Cannot start. Fix these first:\n');
  for (const b of blockers) console.log(`   • ${b}`);
  console.log('');
  process.exit(2);
}

// ─── Suites ──────────────────────────────────────────────────────────────────

/** Run a command, stream nothing, capture the tail for the report. */
function runSuite(name, command, args, { optional = false } = {}) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${name} … `);

  const proc = spawnSync(command, args, {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    shell: command === 'pnpm' || command === 'pnpm.cmd',
  });

  const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  const score = /(\d+)\/(\d+) checks passed/.exec(output);
  const tests = /Tests {2}(\d+) passed/.exec(output);

  const ok = proc.status === 0;
  const detail = score ? `${score[0]}` : tests ? `${tests[1]} tests passed` : ok ? 'ok' : 'failed';

  console.log(`${ok ? 'PASS' : 'FAIL'}  (${detail}, ${seconds}s)`);

  if (!ok) {
    // Surface only the failing lines; full output would bury them.
    const failing = output
      .split('\n')
      .filter((l) => /FAIL|FAILED|error TS|✗|Error:/.test(l))
      .slice(0, 12);
    for (const line of failing) console.log(`      ${line.trim()}`);
  }

  results.push({ name, ok, detail, optional });
  return ok;
}

heading('Node suites — types, lint, unit tests');
runSuite('typecheck + lint + unit tests', 'pnpm', ['run', 'check']);

heading('Session lifecycle');
// Runs first, and leaves the Bridge with no open sessions. Chained suites used to
// pile sessions up until the agent started failing prompts outright, so starting
// from a clean slate is part of the contract rather than a nicety.
runSuite('session close + capacity recovery', 'node', [
  'scripts/verify-sessions.mjs',
  '--port',
  PORT,
]);

if (deviceReady) {
  heading('Device suites — real Kiro agent, real watch app');

  runSuite('Kiro account integration', 'node', [
    'scripts/verify-account.mjs',
    ...(SERIAL ? ['--serial', SERIAL] : []),
  ]);

  runSuite('approval tap (allow)', 'node', [
    'scripts/verify-watch-tap.mjs',
    ...(SERIAL ? ['--serial', SERIAL] : []),
  ]);

  runSuite('approval tap (deny)', 'node', [
    'scripts/verify-watch-tap.mjs',
    ...(SERIAL ? ['--serial', SERIAL] : []),
    '--deny',
  ]);

  runSuite('activity feed on the watch', 'node', [
    'scripts/verify-watch-activity.mjs',
    ...(SERIAL ? ['--serial', SERIAL] : []),
  ]);

  runSuite('terminal session approved on the watch', 'node', [
    'scripts/verify-chat.mjs',
    ...(SERIAL ? ['--serial', SERIAL] : []),
  ]);

  if (QUICK) {
    console.log('\n▶ backgrounded approval … SKIPPED (--quick)');
    results.push({ name: 'backgrounded approval', ok: true, detail: 'skipped', optional: true });
  } else {
    runSuite('backgrounded approval + notification', 'node', [
      'scripts/verify-watch-background.mjs',
      ...(SERIAL ? ['--serial', SERIAL] : []),
    ]);
  }

  // Give the slots back. Each suite above reuses a session where it can, but a
  // full Bridge is the state that made the agent start failing prompts, so the
  // run should not end by leaving one behind.
  heading('Cleanup');
  runSuite('sessions released', 'node', ['scripts/verify-sessions.mjs', '--port', PORT]);
}

// ─── Verdict ─────────────────────────────────────────────────────────────────

heading('Result');

for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(38)} ${r.detail}`);
}

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length === 0) {
  console.log(`  Everything passed (${results.length} suites).`);
  if (QUICK) console.log('  Note: the backgrounded-approval suite was skipped.');
  console.log('');
  process.exit(0);
}

console.log(`  ${failed.length} of ${results.length} suites failed:`);
for (const f of failed) console.log(`   • ${f.name}`);
console.log('\n  Re-run a single suite for full output, e.g.:');
console.log('    node scripts/verify-account.mjs --serial emulator-5554\n');
process.exit(1);
