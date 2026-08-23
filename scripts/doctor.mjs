/**
 * `pnpm run doctor` — one factual readout of the whole chain.
 *
 * Exists because "nothing happened on the watch" has several very different
 * causes — no Bridge, no session, no pending approval, a watch that is not
 * attached, or simply no prompt having been sent — and they are indistinguishable
 * by looking at the emulator. This prints what each link is actually doing.
 *
 * Read-only. Starts nothing, answers nothing, changes nothing.
 *
 * Usage:
 *   node scripts/doctor.mjs [--serial emulator-5554] [--port 8787]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const argv = process.argv;
const SERIAL = argv.includes('--serial') ? argv[argv.indexOf('--serial') + 1] : null;
const PORT = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : '8787';
const BASE = `http://127.0.0.1:${PORT}`;
const PACKAGE = 'dev.aibou.wear';

const ok = (s) => `\u001b[32m${s}\u001b[0m`;
const bad = (s) => `\u001b[31m${s}\u001b[0m`;
const warn = (s) => `\u001b[33m${s}\u001b[0m`;
const dim = (s) => `\u001b[2m${s}\u001b[0m`;

const advice = [];
function line(label, value, note = '') {
  console.log(`  ${label.padEnd(22)} ${value}${note ? ` ${dim(note)}` : ''}`);
}

console.log('\n=== Aibou doctor ===\n');

// ─── 1. Kiro CLI ─────────────────────────────────────────────────────────────

let kiroEmail = null;
try {
  const out = execFileSync(process.env.AIBOU_KIRO_BIN ?? 'kiro-cli', ['whoami', '--format', 'json'], {
    encoding: 'utf-8',
    timeout: 20_000,
    windowsHide: true,
  });
  const parsed = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  kiroEmail = parsed.email ?? parsed.accountType ?? 'signed in';
  line('kiro account', ok(kiroEmail));
} catch {
  line('kiro account', bad('not signed in'));
  advice.push('Sign in to Kiro:  kiro-cli login --social google');
}

// ─── 2. Bridge ───────────────────────────────────────────────────────────────

let health = null;
let account = null;
try {
  health = await (await fetch(`${BASE}/api/health`)).json();
  account = await (await fetch(`${BASE}/api/account`)).json();
} catch {
  line('bridge', bad(`not running on ${BASE}`));
  advice.push('Start the Bridge:  node packages/bridge/dist/index.js');
}

if (health) {
  line('bridge', ok(`v${health.version}`), `up ${Math.round(health.uptime)}s`);
  line(
    'bridge mode',
    account.state === 'mock' ? warn('mock — not a real Kiro session') : ok('live'),
  );
  line(
    'bridge sees account',
    account.state === 'authenticated' ? ok(account.email ?? 'signed in') : bad(account.state),
  );
  if (account.state !== 'authenticated' && account.state !== 'mock') {
    advice.push('The Bridge cannot run prompts until an account is signed in.');
  }
  line('clients attached', health.clients > 0 ? ok(String(health.clients)) : bad('0'));
  if (health.clients === 0) {
    advice.push('Nothing is connected — the watch app is not attached to the Bridge.');
  }
}

// ─── 3. Sessions and pending approvals ───────────────────────────────────────

let sessions = [];
let pending = [];

if (health) {
  const token = (() => {
    try {
      const cfg = JSON.parse(readFileSync(join(homedir(), '.aibou', 'config.json'), 'utf-8'));
      return Array.isArray(cfg.tokens) ? cfg.tokens.at(-1) : null;
    } catch {
      return null;
    }
  })();

  if (!token) {
    line('paired devices', bad('none'), 'no token stored on this machine');
    advice.push('Pair a device first, using the code from the Bridge banner.');
  } else {
    const frames = [];
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const send = (f) => ws.send(JSON.stringify({ v: 1, ts: Date.now(), ...f }));
    await new Promise((r) => {
      ws.on('open', r);
      ws.on('error', r);
    });
    if (ws.readyState === 1) {
      ws.on('message', (d) => {
        const f = JSON.parse(d.toString());
        frames.push(f);
        if (f.t === 'heartbeat') send({ t: 'pong' });
      });
      send({ t: 'auth', token });
      await new Promise((r) => setTimeout(r, 1200));
      send({ t: 'subscribe', id: 's' });
      await new Promise((r) => setTimeout(r, 2500));
      send({ t: 'session.list', id: 'l' });
      await new Promise((r) => setTimeout(r, 1500));

      sessions = frames.find((f) => f.t === 'ack' && f.id === 'l')?.result ?? [];
      pending = frames.filter((f) => f.t === 'permission.request');
      ws.close();
    }

    line('sessions', sessions.length > 0 ? ok(String(sessions.length)) : dim('none'));
    for (const s of sessions) {
      console.log(
        dim(`      ${s.id.slice(0, 8)}  ${s.status.padEnd(20)} pending=${s.pendingApprovals}  ${s.cwd}`),
      );
    }
    if (sessions.length === 0) {
      advice.push('No session exists yet. Start one:  pnpm run chat');
    }

    line(
      'pending approvals',
      pending.length > 0 ? warn(String(pending.length)) : dim('none right now'),
    );
    for (const p of pending) {
      console.log(
        dim(`      "${p.summary}"  risk ${p.riskTier}  expires in ${Math.round((p.expiresAt - Date.now()) / 1000)}s`),
      );
    }
  }
}

// ─── 4. The watch ────────────────────────────────────────────────────────────

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
function shell(cmd) {
  try {
    return execFileSync(ADB, SERIAL ? ['-s', SERIAL, 'shell', cmd] : ['shell', cmd], {
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    return typeof err.stdout === 'string' ? err.stdout : '';
  }
}

let devices = [];
try {
  devices = execFileSync(ADB, ['devices'], { encoding: 'utf-8' })
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('device'))
    .map((l) => l.split(/\s+/)[0]);
} catch {
  /* adb unavailable */
}

if (devices.length === 0) {
  line('emulator', bad('none attached'));
  advice.push('Start the Wear emulator from Android Studio, then re-run this.');
} else {
  line('emulator', ok(devices.join(', ')));

  const installed = shell(`pm list packages ${PACKAGE}`).includes(PACKAGE);
  line('watch app', installed ? ok('installed') : bad('not installed'));
  if (!installed) {
    const gradlew = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
    advice.push(`Install it:  cd wear && ${gradlew} installDebug`);
  }

  if (installed) {
    const running = shell(`ps -A | grep ${PACKAGE}`).includes(PACKAGE);
    line('watch app running', running ? ok('yes') : warn('no'));
    if (!running) advice.push('Open the Aibou app on the watch so it can connect.');

    const svc = /isForeground=true/.test(shell(`dumpsys activity services ${PACKAGE}`));
    line('keep-alive service', svc ? ok('running') : warn('not running'));

    // What is on the screen right now, decoded.
    shell('uiautomator dump /sdcard/aibou-doctor.xml >/dev/null 2>&1');
    let xml = '';
    try {
      xml = execFileSync(
        ADB,
        SERIAL
          ? ['-s', SERIAL, 'exec-out', 'cat', '/sdcard/aibou-doctor.xml']
          : ['exec-out', 'cat', '/sdcard/aibou-doctor.xml'],
        { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
      );
    } catch {
      /* no dump */
    }
    const text = [...xml.matchAll(/text="([^"]*)"/g)]
      .map((m) =>
        m[1]
          .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
          .replace(/&amp;/g, '&'),
      )
      .filter((t) => t.trim());
    shell('rm -f /sdcard/aibou-doctor.xml');

    console.log(`  ${'watch screen'.padEnd(22)} ${text.length ? '' : dim('(blank — screen may be off)')}`);
    for (const t of text) console.log(dim(`      ${t.replace(/\n/g, ' ')}`));

    const showsApproval = text.some((t) => t.includes('Approve'));
    const showsConnected = text.some((t) => t.startsWith('Connected'));
    if (pending.length > 0 && !showsApproval) {
      advice.push(
        'An approval IS pending but the watch is not showing it. Open the Aibou app on the watch.',
      );
    }
    if (pending.length === 0 && showsConnected) {
      advice.push(
        'Everything is connected and nothing is pending — this is the idle state. ' +
          'Send a prompt to make an approval appear:  pnpm run approve',
      );
    }
  }
}

// ─── Verdict ─────────────────────────────────────────────────────────────────

console.log('');
if (advice.length === 0) {
  console.log(`  ${ok('Everything looks healthy.')}\n`);
} else {
  console.log('  Next steps:\n');
  for (const a of advice) console.log(`   • ${a}`);
  console.log('');
}
process.exit(0);
