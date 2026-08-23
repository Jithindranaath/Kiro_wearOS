/**
 * Smoke-test `pnpm run chat` exactly as a developer runs it.
 *
 * Runs the root script rather than the compiled entry point directly, because the
 * wrapper is where a working-directory bug hid: `pnpm --filter` runs inside the
 * package folder, so the session was created for packages/bridge instead of the
 * developer's project.
 *
 * Prints the transcript and the session the Bridge ended up with, then exits.
 * Diagnostic tool, not an assertion suite.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const PROMPT = process.argv[2] ?? "Run the shell command 'node --version' and tell me what it prints.";
const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

console.log(`\n> running: pnpm run chat   (cwd ${process.cwd()})\n`);

// shell: true is required on Windows — Node refuses to spawn a .cmd shim directly.
const child = spawn('pnpm', ['run', 'chat'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: process.cwd(),
  shell: true,
});

let transcript = '';
child.stdout.setEncoding('utf-8');
child.stderr.setEncoding('utf-8');
child.stdout.on('data', (d) => {
  transcript += strip(d);
});
child.stderr.on('data', (d) => {
  transcript += strip(d);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for the banner, then send a prompt.
for (let i = 0; i < 60 && !/aibou chat/.test(transcript); i++) await sleep(500);

if (!/aibou chat/.test(transcript)) {
  console.log('the CLI never printed its banner. Transcript:\n');
  console.log(transcript || '(nothing)');
  child.kill();
  process.exit(1);
}

const cwdLine = /cwd\s+(.+)/.exec(transcript)?.[1]?.trim();
console.log(`session cwd reported by the CLI: ${cwdLine}`);
console.log(
  cwdLine === process.cwd()
    ? '  -> correct: the session follows the directory you ran it from\n'
    : `  -> WRONG: expected ${process.cwd()}\n`,
);

console.log(`sending a prompt: "${PROMPT}"\n`);
child.stdin.write(`${PROMPT}\n`);

// Watch the Bridge to see what the session looks like from the outside.
const cfg = JSON.parse(readFileSync(join(homedir(), '.aibou', 'config.json'), 'utf-8'));
const ws = new WebSocket('ws://127.0.0.1:8787/ws');
const frames = [];
ws.on('message', (d) => {
  const f = JSON.parse(d.toString());
  frames.push(f);
  if (f.t === 'heartbeat') ws.send(JSON.stringify({ v: 1, t: 'pong', ts: Date.now() }));
});
await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ v: 1, t: 'auth', token: cfg.tokens.at(-1), ts: Date.now() }));
await sleep(1000);
ws.send(JSON.stringify({ v: 1, t: 'subscribe', id: 's', ts: Date.now() }));

// Give the agent time to escalate.
for (let i = 0; i < 120; i++) {
  if (frames.some((f) => f.t === 'permission.request')) break;
  await sleep(1000);
}

const perm = frames.find((f) => f.t === 'permission.request');
console.log(
  perm
    ? `approval raised on the Bridge: ${perm.summary}  (this is what the watch shows)`
    : 'no approval was raised — the agent answered without needing one',
);

ws.send(JSON.stringify({ v: 1, t: 'session.list', id: 'l', ts: Date.now() }));
await sleep(1500);
const list = frames.find((f) => f.t === 'ack' && f.id === 'l');
console.log('\nsessions on the Bridge:');
for (const s of list?.result ?? []) {
  console.log(`  ${s.id.slice(0, 8)}  ${s.status}  pending=${s.pendingApprovals}  cwd=${s.cwd}`);
}

console.log('\n--- terminal transcript ---');
console.log(transcript.trim());
console.log('---------------------------\n');

child.stdin.write('/exit\n');
ws.close();
setTimeout(() => {
  child.kill();
  process.exit(0);
}, 1500);
