#!/usr/bin/env node
/**
 * `aibou chat` — an interactive terminal session whose approvals land on the watch.
 *
 * Why this exists: the Bridge can only gate sessions it owns. A separate
 * `kiro-cli chat` process has its own stdio, and its permission prompt belongs to
 * that terminal. Hooks can observe and even stall such a session but cannot
 * decide its outcome (docs/acp-findings.md A8), so an Approve button for it would
 * be a control that controls nothing.
 *
 * This gives the same terminal experience while keeping the session on the Bridge:
 * you type here, the work runs under the same signed-in Kiro account, approvals
 * appear on your wrist, and your answer resumes the turn in this window.
 */

import { createInterface, type Interface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';

const { values: flags, positionals } = parseArgs({
  options: {
    host: { type: 'string' },
    port: { type: 'string' },
    code: { type: 'string' },
    cwd: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (flags.help === true) {
  console.log(`
aibou chat — talk to your Kiro agent from the terminal, approve from your watch

Usage: aibou-chat [options] [first prompt]

Options:
  --host <addr>   Bridge host                (default 127.0.0.1)
  --port <n>      Bridge port                (default 8787)
  --code <n>      Pairing code. Omit to reuse a token this machine already has
  --cwd <path>    Working directory for the session (default: current directory)
  --help          Show this message

In-session commands:
  /interrupt      Cancel the current turn
  /status         Show session and account state
  /close          Close the session, freeing its slot on the Bridge
  /exit           Leave (the session stays open on the Bridge)
`);
  process.exit(0);
}

const HOST = typeof flags.host === 'string' && flags.host !== '' ? flags.host : '127.0.0.1';
const PORT = typeof flags.port === 'string' && flags.port !== '' ? flags.port : '8787';
const BASE = `http://${HOST}:${PORT}`;
const WS_URL = `ws://${HOST}:${PORT}/ws`;
const CWD = typeof flags.cwd === 'string' && flags.cwd !== '' ? flags.cwd : process.cwd();
const FIRST_PROMPT = positionals.join(' ').trim();

const dim = (s: string): string => `\u001b[2m${s}\u001b[0m`;
const bold = (s: string): string => `\u001b[1m${s}\u001b[0m`;
const amber = (s: string): string => `\u001b[33m${s}\u001b[0m`;
const green = (s: string): string => `\u001b[32m${s}\u001b[0m`;
const red = (s: string): string => `\u001b[31m${s}\u001b[0m`;

function die(message: string): never {
  console.error(`\n${red('✗')} ${message}\n`);
  process.exit(1);
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Get a bearer token for the Bridge.
 *
 * Prefers an explicit pairing code, then a token this machine was already
 * issued — codes expire after ten minutes, which is shorter than a working
 * session. Tokens are never printed.
 */
async function getToken(): Promise<string> {
  const code = typeof flags.code === 'string' ? flags.code : null;

  if (code) {
    const res = await fetch(`${BASE}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (res.ok) return ((await res.json()) as { token: string }).token;
    console.error(dim(`  pairing code rejected (HTTP ${res.status}); trying a stored token`));
  }

  try {
    const raw = readFileSync(join(homedir(), '.aibou', 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { tokens?: unknown };
    const tokens = Array.isArray(parsed.tokens) ? parsed.tokens : [];
    const stored = tokens.filter((t): t is string => typeof t === 'string').at(-1);
    if (stored) return stored;
  } catch {
    /* nothing stored yet */
  }

  die(
    `Could not authenticate to the Bridge.\n` +
      `  Pass the pairing code from its banner:  aibou-chat --code 123456`,
  );
}

// ─── Connect ─────────────────────────────────────────────────────────────────

let health: { clients?: number } = {};
try {
  health = (await (await fetch(`${BASE}/api/health`)).json()) as { clients?: number };
} catch {
  die(`No Bridge on ${BASE}.\n  Start it with:  node packages/bridge/dist/index.js`);
}

/**
 * Whether some other client — a watch or the web app — is already attached.
 *
 * Counted before this process connects, so any client at all is someone else.
 * Comparing against 1 here would report "no device" whenever the watch was the
 * only thing connected, which is precisely the normal case.
 */
const otherClients = health.clients ?? 0;

const token = await getToken();
const ws = new WebSocket(WS_URL);

let sessionId: string | null = null;
let turnActive = false;
/**
 * Suppress replayed history.
 *
 * Subscribing replays the session's event buffer, which is right for a phone
 * catching up but wrong here: a fresh terminal would open with several old turns
 * already scrolled past, as though the agent had just said all of it. Only render
 * events once this session has actually asked for something.
 */
let renderEvents = false;
let awaitingApproval: { summary: string; approvalId: string } | null = null;
let accountLabel = 'unknown';
let mode = 'live';
/** True once the current turn has printed something, for spacing. */
let printedThisTurn = false;

let rl: Interface | null = null;

function send(frame: Record<string, unknown>): void {
  ws.send(JSON.stringify({ v: 1, ts: Date.now(), ...frame }));
}

/** Write agent output without fighting the readline prompt. */
function out(text: string): void {
  if (rl) rl.pause();
  process.stdout.write(text);
  if (rl) rl.resume();
}

function showPrompt(): void {
  if (!rl) return;
  rl.setPrompt(turnActive ? '' : bold('› '));
  if (!turnActive) rl.prompt(true);
}

ws.on('error', (err: Error) => die(`Connection failed: ${err.message}`));

ws.on('close', () => {
  console.log(dim('\n  disconnected from the Bridge'));
  process.exit(0);
});

ws.on('open', () => send({ t: 'auth', token }));

ws.on('message', (data: Buffer) => {
  let frame: Record<string, unknown>;
  try {
    frame = JSON.parse(data.toString()) as Record<string, unknown>;
  } catch {
    return;
  }
  handleFrame(frame);
});

function handleFrame(f: Record<string, unknown>): void {
  switch (f.t) {
    case 'heartbeat':
      send({ t: 'pong' });
      return;

    case 'hello':
      mode = String(f.mode);
      send({ t: 'subscribe', id: 'sub' });
      return;

    case 'account.state': {
      const state = String(f.state);
      accountLabel =
        state === 'authenticated'
          ? String(f.email ?? f.accountType ?? 'signed in')
          : state === 'mock'
            ? 'none (mock agent)'
            : state;
      return;
    }

    case 'ack':
      if (f.id === 'sub') void startSession();
      if (f.id === 'create') {
        const result = f.result as { id?: string } | undefined;
        if (result?.id) {
          sessionId = result.id;
          ready();
        }
      }
      if (f.id === 'list') {
        const sessions = (f.result ?? []) as Array<{ id: string; status: string; cwd: string }>;
        const reusable = sessions.find(
          (s) => s.cwd === CWD && (s.status === 'idle' || s.status === 'working'),
        );
        if (reusable) {
          sessionId = reusable.id;
          ready();
        } else {
          send({ t: 'session.create', id: 'create', cwd: CWD });
        }
      }
      return;

    case 'error': {
      const code = String(f.code ?? '');
      out(`\n${red('✗')} ${String(f.message)}\n`);
      if (code === 'AIBOU_UNAUTHENTICATED') {
        out(dim('  Sign in from the Aibou web app, or run: kiro-cli login\n'));
      }
      turnActive = false;
      showPrompt();
      return;
    }

    case 'event':
      if (!renderEvents) return; // replayed history, not this conversation
      if (f.sessionId !== sessionId) return;
      renderEvent(String(f.kind), f.payload as Record<string, unknown> | undefined);
      return;

    case 'permission.request': {
      awaitingApproval = { summary: String(f.summary), approvalId: String(f.approvalId) };
      const where = otherClients > 0 ? 'your watch' : 'a paired device';
      out(
        `\n${amber('⚡ approval needed')}  ${bold(String(f.summary))}\n` +
          dim(`   risk ${String(f.riskTier)} · waiting for ${where}…\n`),
      );
      return;
    }

    case 'permission.resolved': {
      if (!awaitingApproval) return;
      const decision = String(f.decision);
      const resolution = String(f.resolution);
      const how =
        resolution === 'user'
          ? 'you'
          : resolution === 'policy'
            ? `policy${f.ruleId ? ` (${String(f.ruleId)})` : ''}`
            : 'timeout';
      const mark = decision === 'allow' ? green('✓ allowed') : red('✗ denied');
      out(`   ${mark} by ${how}\n\n`);
      awaitingApproval = null;
      return;
    }

    case 'session.state': {
      if (f.sessionId !== sessionId) return;
      const status = String(f.status);
      if (status === 'idle' && turnActive) {
        turnActive = false;
        if (printedThisTurn) out('\n');
        showPrompt();
      }
      if (status === 'error') {
        turnActive = false;
        out(`\n${red('✗')} ${String(f.statusReason ?? 'the session reported an error')}\n`);
        showPrompt();
      }
      return;
    }
  }
}

/** Print streamed agent output. Only what the Bridge actually sent. */
function renderEvent(kind: string, payload: Record<string, unknown> | undefined): void {
  if (!payload) return;

  switch (kind) {
    case 'agent.text': {
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (text) {
        out(text);
        printedThisTurn = true;
      }
      return;
    }

    case 'tool.start': {
      const raw = payload.rawInput as Record<string, unknown> | undefined;
      const command = typeof raw?.command === 'string' ? raw.command : null;
      const title = typeof payload.title === 'string' ? payload.title : null;
      out(dim(`\n  ⚙ ${command ?? title ?? 'tool'}\n`));
      printedThisTurn = true;
      return;
    }

    case 'tool.end': {
      const status = typeof payload.status === 'string' ? payload.status : 'done';
      if (status !== 'completed') out(dim(`  ↳ ${status}\n`));
      return;
    }
  }
}

// ─── Session lifecycle ───────────────────────────────────────────────────────

async function startSession(): Promise<void> {
  // Reuse a session already open for this directory rather than consuming one of
  // the Bridge's limited slots on every launch.
  send({ t: 'session.list', id: 'list' });
}

function ready(): void {
  const deviceNote =
    otherClients > 0
      ? `${green('●')} a device is connected — approvals will appear on it`
      : `${amber('●')} no device connected yet — approvals will wait until one is`;

  console.log(
    [
      '',
      `  ${bold('aibou chat')}  ${dim(`session ${sessionId?.slice(0, 8)}…`)}`,
      `  ${dim(`account  ${accountLabel}`)}`,
      `  ${dim(`mode     ${mode}${mode === 'mock' ? ' — NOT a real Kiro session' : ''}`)}`,
      `  ${dim(`cwd      ${CWD}`)}`,
      `  ${deviceNote}`,
      '',
      // Spelled out because the banner alone looks like something already
      // happened. Nothing reaches the watch until a prompt is sent, and a bare
      // "›" does not say so.
      bold('  Type what you want the agent to do, then press Enter.'),
      dim('  Anything needing permission will appear on your watch to approve.'),
      dim('  Example: Run the shell command \'node --version\' and tell me what it prints.'),
      '',
      dim('  /interrupt cancel · /status state · /close end · /exit leave'),
      '',
    ].join('\n'),
  );

  rl = createInterface({ input: process.stdin, output: process.stdout, prompt: bold('› ') });

  rl.on('line', (line) => {
    const text = line.trim();
    if (text === '') {
      showPrompt();
      return;
    }
    if (handleCommand(text)) return;

    if (turnActive) {
      out(dim('  the agent is still working — /interrupt to stop it\n'));
      return;
    }

    turnActive = true;
    printedThisTurn = false;
    renderEvents = true;
    send({ t: 'prompt.send', id: 'p', sessionId, text, source: 'text' });
    showPrompt();
  });

  rl.on('close', () => {
    console.log(dim('\n  leaving; the session stays open on the Bridge\n'));
    process.exit(0);
  });

  // Ctrl+C cancels the turn rather than killing the session, which would be a
  // rude way to lose several minutes of the agent's work.
  rl.on('SIGINT', () => {
    if (turnActive) {
      out(dim('\n  interrupting…\n'));
      send({ t: 'session.interrupt', sessionId });
      turnActive = false;
      showPrompt();
    } else {
      rl?.close();
    }
  });

  if (FIRST_PROMPT) {
    turnActive = true;
    printedThisTurn = false;
    renderEvents = true;
    send({ t: 'prompt.send', id: 'p', sessionId, text: FIRST_PROMPT, source: 'text' });
    out(`${bold('› ')}${FIRST_PROMPT}\n`);
  } else {
    showPrompt();
  }
}

/** Handle a slash command. Returns true when the line was a command. */
function handleCommand(text: string): boolean {
  if (!text.startsWith('/')) return false;

  switch (text) {
    case '/exit':
    case '/quit':
      rl?.close();
      return true;

    case '/interrupt':
      if (turnActive) {
        send({ t: 'session.interrupt', sessionId });
        turnActive = false;
        out(dim('  interrupt sent\n'));
      } else {
        out(dim('  nothing is running\n'));
      }
      showPrompt();
      return true;

    case '/close':
      // The Bridge caps concurrent sessions, so leaving them open forever
      // eventually blocks new ones. This is how a developer gives a slot back.
      send({ t: 'session.close', sessionId });
      out(dim('  session closed\n'));
      setTimeout(() => rl?.close(), 300);
      return true;

    case '/status':
      out(
        [
          dim(`  session   ${sessionId ?? 'none'}`),
          dim(`  account   ${accountLabel}`),
          dim(`  mode      ${mode}`),
          dim(`  turn      ${turnActive ? 'working' : 'idle'}`),
          dim(`  approval  ${awaitingApproval ? awaitingApproval.summary : 'none pending'}`),
          '',
        ].join('\n'),
      );
      showPrompt();
      return true;

    default:
      out(dim(`  unknown command ${text} — try /interrupt, /status, /close or /exit\n`));
      showPrompt();
      return true;
  }
}
