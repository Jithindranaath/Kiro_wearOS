/**
 * Verify the Kiro account integration end to end, against the real CLI.
 *
 * Checks that Aibou reports the same identity `kiro-cli whoami` does, that it
 * reaches every connected client including the watch, and that the two identities
 * in play stay separate: signing out of Kiro must not unpair a device, and being
 * paired must not imply a signed-in account.
 *
 * Sign-out is NOT exercised by default — it would end the developer's real
 * session and the OAuth device flow needs a human to complete. Pass
 * --include-signout to run it, and be ready to sign in again afterwards.
 *
 * Usage:
 *   node scripts/verify-account.mjs [code] [--serial emulator-5554] [--include-signout]
 */

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const execFileAsync = promisify(execFile);

const argv = process.argv;
const CODE = /^\d{6}$/.test(argv[2] ?? '') ? argv[2] : null;
const SERIAL = argv.includes('--serial') ? argv[argv.indexOf('--serial') + 1] : null;
const INCLUDE_SIGNOUT = argv.includes('--include-signout');
const PORT = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : '8787';
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const PACKAGE = 'dev.aibou.wear';
const KIRO_BIN = process.env.AIBOU_KIRO_BIN ?? 'kiro-cli';

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

// ─── adb (optional; only used to read the watch UI) ───────────────────────────

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
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}
function watchScreenText() {
  shell('uiautomator dump /sdcard/aibou-acct.xml >/dev/null 2>&1');
  try {
    const xml = execFileSync(
      ADB,
      SERIAL ? ['-s', SERIAL, 'exec-out', 'cat', '/sdcard/aibou-acct.xml'] : ['exec-out', 'cat', '/sdcard/aibou-acct.xml'],
      { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
    );
    return [...xml.matchAll(/text="([^"]*)"/g)].map((m) => decodeEntities(m[1])).filter((t) => t.trim());
  } catch {
    return [];
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    /* none */
  }
  fail('could not authenticate; pass a fresh pairing code');
}

// ─── Stage 0: what does the CLI itself say? ──────────────────────────────────

console.log('\n> Stage 0 -- ground truth from kiro-cli');

let cliAccount = null;
try {
  const { stdout } = await execFileAsync(KIRO_BIN, ['whoami', '--format', 'json'], {
    timeout: 15_000,
    windowsHide: true,
  });
  cliAccount = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1));
  check('kiro-cli reports an account', true, JSON.stringify(cliAccount));
} catch {
  check('kiro-cli reports no account (signed out)', true, 'will verify Aibou agrees');
}

// ─── Stage 1: does the Bridge agree? ─────────────────────────────────────────

console.log('\n> Stage 1 -- the Bridge reports the same identity');

let http;
try {
  http = await (await fetch(`${BASE}/api/account`)).json();
} catch {
  fail(`Bridge is not answering on ${BASE}. Start it first.`);
}
check('/api/account is served', typeof http?.state === 'string', JSON.stringify(http));

if (cliAccount) {
  check('state is authenticated', http.state === 'authenticated', http.state);
  check(
    'email matches the CLI exactly',
    http.email === cliAccount.email,
    `${http.email} vs ${cliAccount.email}`,
  );
  check(
    'provider matches the CLI exactly',
    http.provider === cliAccount.provider,
    `${http.provider} vs ${cliAccount.provider}`,
  );
} else {
  check('state is unauthenticated', http.state === 'unauthenticated', http.state);
  check('no email is invented while signed out', http.email === undefined, String(http.email));
}

check(
  '/api/account leaks no credential',
  !JSON.stringify(http).match(/token|secret|password|refresh/i),
  'only state and identity fields',
);

// ─── Stage 2: it reaches clients over AWP ────────────────────────────────────

console.log('\n> Stage 2 -- clients are told without having to ask');

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
check(
  'hello advertises the account capability',
  Array.isArray(hello.capabilities) && hello.capabilities.includes('account'),
  (hello.capabilities ?? []).join(', '),
);

const pushed = await waitFor((f) => f.t === 'account.state', 10_000, 'account.state after hello').catch(
  (e) => fail(`${e.message} -- a client should not have to ask who is signed in`),
);
check('account.state arrives unprompted after hello', true, `state=${pushed.state}`);
check('it agrees with /api/account', pushed.state === http.state, `${pushed.state} vs ${http.state}`);
if (cliAccount) {
  check('pushed email matches the CLI', pushed.email === cliAccount.email, String(pushed.email));
}

// account.status must re-read the CLI on demand.
frames.length = 0;
send({ t: 'account.status', id: 'st' });
const ack = await waitFor((f) => f.t === 'ack' && f.id === 'st', 20_000, 'account.status ack');
check('account.status re-reads the CLI', ack.result?.state === http.state, `state=${ack.result?.state}`);

// ─── Stage 3: the two identities are separate ────────────────────────────────

console.log('\n> Stage 3 -- Kiro account and device pairing are separate');

const storedBefore = (() => {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.aibou', 'config.json'), 'utf-8'));
    return Array.isArray(cfg.tokens) ? cfg.tokens.length : 0;
  } catch {
    return 0;
  }
})();
check('device tokens are stored independently', storedBefore > 0, `${storedBefore} paired device(s)`);
check(
  'account state carries no pairing token',
  !('token' in (pushed ?? {})),
  'account frames describe the Kiro identity only',
);

// ─── Stage 4: the watch shows it ─────────────────────────────────────────────

console.log('\n> Stage 4 -- the watch shows who the agent runs as');

const installed = shell(`pm list packages ${PACKAGE}`).includes(PACKAGE);
if (!installed) {
  console.log('  ..  watch app not installed; skipping the device checks');
} else {
  shell(`am force-stop ${PACKAGE}`);
  shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`);
  await sleep(6000);

  let firstView = [];
  for (let i = 0; i < 15; i++) {
    firstView = watchScreenText();
    if (firstView.some((t) => t.startsWith('Connected'))) break;
    await sleep(1000);
  }
  check(
    'watch is connected',
    firstView.some((t) => t.startsWith('Connected')),
    JSON.stringify(firstView),
  );

  if (cliAccount?.email) {
    // Must be readable at a glance, with no scrolling. An account you have to
    // hunt for is the same as one that is not shown: that was the original
    // complaint, so assert the strict version of it.
    const shown = firstView.some((t) => t.includes(cliAccount.email));
    check(
      'watch shows the signed-in account without scrolling',
      shown,
      shown ? cliAccount.email : `not in the first viewport: ${JSON.stringify(firstView)}`,
    );
  } else {
    // A missing sign-in blocks all work, so this one must need no scrolling.
    const warned = firstView.some((t) => /not signed in/i.test(t));
    check(
      'watch warns without scrolling that Kiro is not signed in',
      warned,
      JSON.stringify(firstView),
    );
  }
}

// ─── Stage 5: prompts are refused with something actionable ──────────────────

console.log('\n> Stage 5 -- an unusable account fails loudly, not silently');

if (http.state === 'unauthenticated') {
  send({ t: 'session.list', id: 'ls' });
  const list = await waitFor((f) => f.t === 'ack' && f.id === 'ls', 10_000, 'session list');
  const sid = (list.result ?? [])[0]?.id;
  if (sid) {
    frames.length = 0;
    send({ t: 'prompt.send', id: 'pp', sessionId: sid, text: 'hello', source: 'text' });
    const res = await waitFor(
      (f) => (f.t === 'error' || f.t === 'ack') && f.id === 'pp',
      15_000,
      'prompt response',
    );
    check(
      'prompt is rejected with AIBOU_UNAUTHENTICATED',
      res.t === 'error' && res.code === 'AIBOU_UNAUTHENTICATED',
      res.t === 'error' ? res.message : 'prompt was accepted',
    );
  } else {
    console.log('  ..  no session to prompt; skipping');
  }
} else {
  console.log('  ..  an account is signed in, so the refusal path does not apply');
}

// ─── Stage 6: sign-out (opt in only) ─────────────────────────────────────────

if (INCLUDE_SIGNOUT) {
  console.log('\n> Stage 6 -- sign out, then confirm devices stay paired');

  frames.length = 0;
  send({ t: 'account.logout', id: 'out' });
  const outAck = await waitFor((f) => f.t === 'ack' && f.id === 'out', 30_000, 'logout ack');
  check('sign-out reports unauthenticated', outAck.result?.state === 'unauthenticated', String(outAck.result?.state));

  const { stdout: after } = await execFileAsync(KIRO_BIN, ['whoami', '--format', 'json'], {
    timeout: 15_000,
    windowsHide: true,
  }).catch(() => ({ stdout: '' }));
  check('the CLI agrees it is signed out', !after.includes('email'), after.trim() || '(no output)');

  const storedAfter = (() => {
    try {
      const cfg = JSON.parse(readFileSync(join(homedir(), '.aibou', 'config.json'), 'utf-8'));
      return Array.isArray(cfg.tokens) ? cfg.tokens.length : 0;
    } catch {
      return 0;
    }
  })();
  check(
    'signing out of Kiro did not unpair any device',
    storedAfter === storedBefore,
    `${storedBefore} -> ${storedAfter} paired device(s)`,
  );

  console.log('\n  Sign back in with:  kiro-cli login --social google\n');
} else {
  console.log('\n> Stage 6 -- skipped (pass --include-signout to end the real session)');
}

ws.close();
summarize();
const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.log('\nFailed checks:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
console.log('\nAibou reports the real Kiro identity, and the two identities stay separate.\n');
process.exit(0);
