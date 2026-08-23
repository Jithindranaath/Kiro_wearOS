/**
 * Pair the Wear OS app with the Bridge by driving its keypad over adb.
 *
 * Every device suite in scripts/ requires an already-paired watch, but pairing
 * itself was the one step with no automation: someone had to tap out the host,
 * the port and six digits on the emulator by hand before anything else could
 * run. This closes that gap.
 *
 * It taps the real chips at their real coordinates — nothing is injected into
 * the app's storage, so the Keystore round-trip is exercised for real.
 *
 * Usage:
 *   node scripts/pair-watch.mjs <6-digit-code> [--serial emulator-5554]
 *
 * The host and port fields are left at their pre-filled defaults (10.0.2.2:8787,
 * the emulator's host loopback). Pass --host / --port to enter different ones.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv;
const CODE = argv[2];
const SERIAL = argv.includes('--serial') ? argv[argv.indexOf('--serial') + 1] : null;
const HOST = argv.includes('--host') ? argv[argv.indexOf('--host') + 1] : null;
const PORT = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : null;
const PACKAGE = 'dev.aibou.wear';

if (!/^\d{6}$/.test(CODE ?? '')) {
  console.error('usage: node scripts/pair-watch.mjs <6-digit-code> [--serial <id>] [--host <ip>] [--port <n>]');
  process.exit(2);
}

// ─── adb plumbing ────────────────────────────────────────────────────────────

function resolveAdb() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.HOME ? join(process.env.HOME, 'Library', 'Android', 'sdk') : null,
    process.env.HOME ? join(process.env.HOME, 'Android', 'Sdk') : null,
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function uiDump() {
  shell('uiautomator dump /sdcard/aibou-pair.xml >/dev/null 2>&1');
  return adb(['exec-out', 'cat', '/sdcard/aibou-pair.xml']);
}

/** uiautomator emits non-BMP glyphs (⌫, ✓) as numeric entities. */
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const screenText = (xml) =>
  [...xml.matchAll(/text="([^"]*)"/g)].map((m) => decode(m[1])).filter((t) => t.length > 0);

/**
 * Centre of the tappable control labelled exactly `label`.
 *
 * Compose wraps a chip's TextView in a separate clickable View, so the text
 * node's own bounds are just the glyph box — walk up to the clickable ancestor.
 */
function findTap(xml, label) {
  const stack = [];
  const re = /<node\b[^>]*?(\/?)>|<\/node>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0];
    if (tag === '</node>') {
      stack.pop();
      continue;
    }
    const selfClosing = m[1] === '/';
    const text = decode(/text="([^"]*)"/.exec(tag)?.[1] ?? '');
    const clickable = /clickable="true"/.test(tag);
    const b = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(tag);
    const frame = { clickable, box: b ? b.slice(1).map(Number) : null };
    if (!selfClosing) stack.push(frame);

    if (text === label) {
      const chain = selfClosing ? [...stack, frame] : stack;
      for (let i = chain.length - 1; i >= 0; i--) {
        const f = chain[i];
        if (f.clickable && f.box) {
          const [x1, y1, x2, y2] = f.box;
          return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
        }
      }
    }
  }
  return null;
}

/** Tap a key, scrolling the list if it is not currently on screen. */
async function tap(label, what) {
  for (let attempt = 0; attempt < 14; attempt++) {
    const t = findTap(uiDump(), label);
    if (t) {
      shell(`input tap ${t.x} ${t.y}`);
      await sleep(420);
      return;
    }
    shell('input swipe 192 300 192 180 250');
    await sleep(480);
  }
  throw new Error(
    `could not find "${label}" (${what}). On screen: ${JSON.stringify(screenText(uiDump()))}`,
  );
}

// ─── Pair ────────────────────────────────────────────────────────────────────

let devices;
try {
  devices = adb(['devices'])
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('device'));
} catch {
  console.error(`could not run adb (${ADB}). Set ANDROID_HOME or install platform-tools.`);
  process.exit(1);
}
if (devices.length === 0) {
  console.error('no adb device. Start the Wear OS emulator first.');
  process.exit(1);
}

if (!shell(`pm list packages ${PACKAGE}`).includes(PACKAGE)) {
  console.error(`${PACKAGE} is not installed. Run: cd wear && ./gradlew installDebug`);
  process.exit(1);
}

// POST_NOTIFICATIONS is a runtime grant; the dialog would sit on top of the
// keypad and swallow taps. Granting it up front is what a user tapping "Allow"
// does, so nothing is being bypassed.
try {
  shell(`pm grant ${PACKAGE} android.permission.POST_NOTIFICATIONS`);
} catch {
  /* already granted, or not required on this image */
}

shell('input keyevent KEYCODE_WAKEUP');
shell(`am force-stop ${PACKAGE}`);
shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`);
await sleep(4500);

const start = screenText(uiDump());
console.log(`  screen        ${JSON.stringify(start)}`);

if (!start.some((t) => t.includes('Bridge address') || t.includes('Pairing code'))) {
  console.log('\n  already paired — nothing to do.');
  shell('rm -f /sdcard/aibou-pair.xml');
  process.exit(0);
}

// Step 1 — Bridge address. Defaults are pre-filled; retype only if asked.
if (start.some((t) => t.includes('Bridge address'))) {
  if (HOST) {
    for (let i = 0; i < 15; i++) await tap('⌫ delete', 'clear host');
    for (const ch of HOST) await tap(ch === '.' ? '.' : ch, `host char ${ch}`);
  }
  if (PORT) {
    // The port toggle chip is labelled ":<port>".
    const current = start.find((t) => /^:\d+$/.test(t));
    if (current) await tap(current, 'switch to port field');
    for (let i = 0; i < 6; i++) await tap('⌫', 'clear port');
    for (const ch of PORT) await tap(ch, `port digit ${ch}`);
  }
  await tap('✓', 'confirm address');
  await sleep(1200);
  console.log(`  address ok    ${JSON.stringify(screenText(uiDump()))}`);
}

// Step 2 — the six digits, then submit.
for (const d of CODE) await tap(d, `code digit`);
await tap('✓', 'submit code');
await sleep(5000);

const final = screenText(uiDump());
shell('rm -f /sdcard/aibou-pair.xml');
console.log(`  after submit  ${JSON.stringify(final)}`);

if (final.some((t) => t.includes('Pairing code') || t.includes('Bridge address'))) {
  console.error('\n  FAILED — still on the pairing screen. The code may have expired or been rejected.');
  process.exit(1);
}

console.log('\n  paired.');
process.exit(0);
