import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout } from '@/components/Callout';
import { CodeBlock } from '@/components/CodeBlock';
import { DataTable } from '@/components/DataTable';
import { DocSection } from '@/components/DocSection';
import { DocSubheading } from '@/components/DocSubheading';
import { DocsSidebar } from '@/components/DocsSidebar';
import { Footer } from '@/components/Footer';
import { Nav } from '@/components/Nav';
import { Orbs } from '@/components/Orbs';
import { Reveal } from '@/components/Reveal';

export const metadata: Metadata = {
  title: 'Documentation — Aibou',
  description:
    'Full documentation for Aibou: architecture, the AWP wire protocol, the fail-closed policy engine, the ACP integration and its verified findings, the security model, and the honesty rule.',
};

export default function DocsPage() {
  return (
    <>
      <Nav />

      {/* ── Docs hero ─────────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden px-6 pb-16 pt-40">
        <Orbs variant="hero" />
        <div aria-hidden className="grid-lines absolute inset-0" />
        <div className="relative mx-auto max-w-6xl">
          <p className="rise d-1 label mb-5">Documentation · v1.0.0</p>
          <h1 className="rise d-2 font-display text-5xl leading-[0.92] tracking-tightest text-white sm:text-6xl md:text-7xl">
            Everything Aibou does,
            <br />
            and how it <span className="shimmer">knows</span>
          </h1>
          <p className="rise d-3 mt-7 max-w-2xl text-base font-light leading-relaxed text-neutral-400">
            Aibou is a control plane for locally running Kiro agent sessions. This page covers the
            architecture, the wire protocol, the policy semantics, the security posture, and the
            findings that came out of driving a real ACP agent frame by frame.
          </p>
          <div className="rise d-4 mt-9 flex flex-wrap items-center gap-3">
            {['MIT licensed', 'No hosted backend', 'No telemetry', 'ACP v1', 'Node ≥ 20.11'].map(
              (chip) => (
                <span
                  key={chip}
                  className="glass rounded-full px-3.5 py-1.5 text-[11px] uppercase tracking-[0.16em] text-neutral-400"
                >
                  {chip}
                </span>
              ),
            )}
          </div>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="mx-auto flex max-w-6xl gap-14 px-6 pb-24">
        <DocsSidebar />

        <main className="min-w-0 flex-1">
          {/* ─────────────────────────────────── Overview */}
          <DocSection
            id="overview"
            eyebrow="01 — Introduction"
            title="Overview"
            lede="Aibou (相棒, 'partner') is a remote control for the Kiro agent session running on your own machine. It has three parts, and only one of them is the product."
          >
            <div className="prose-aibou">
              <p>
                <strong>The Bridge</strong> is a Node.js daemon on your machine. It spawns{' '}
                <code>kiro-cli acp</code> as a child process, speaks the{' '}
                <a href="https://agentclientprotocol.com/" target="_blank" rel="noreferrer">
                  Agent Client Protocol
                </a>{' '}
                to it over stdio, and exposes a documented, authenticated WebSocket and HTTP API. It
                is the ACP <em>client</em>, which is the entire architectural bet: only the ACP host
                owns the permission flow. Attaching to a terminal session you did not spawn gives you
                observation without control.
              </p>
              <p>
                <strong>The PWA</strong> is a React client, installable to a phone home screen, and
                the full-featured surface: sessions, live events, task list, prompting, approvals.
              </p>
              <p>
                <strong>The Wear OS app</strong> is a standalone Kotlin and Compose client scoped to
                exactly one job — unblock a stalled agent in under three seconds, without scrolling.
              </p>
              <p>
                The Bridge is the product. The clients are surfaces onto it. A third surface,{' '}
                <code>aibou chat</code>, gives you a terminal session whose approvals genuinely land
                on the watch.
              </p>
            </div>

            <DataTable
              head={['Package', 'Name', 'Role']}
              rows={[
                [
                  <code key="p">packages/protocol</code>,
                  '@aibou/protocol',
                  'AWP types and zod schemas. The single source of truth for the wire format. Only dependency: zod.',
                ],
                [
                  <code key="b">packages/bridge</code>,
                  '@aibou/bridge',
                  'The daemon. ACP host, policy engine, approval manager, session manager, auth, Fastify HTTP + WebSocket server.',
                ],
                [
                  <code key="w">packages/pwa</code>,
                  '@aibou/pwa',
                  'React 18 + Vite + Tailwind. Served statically by the Bridge.',
                ],
                [
                  <code key="m">packages/mock-agent</code>,
                  '@aibou/mock-agent',
                  'A deterministic fake ACP agent with zero runtime dependencies. Powers demos and CI.',
                ],
                [
                  <code key="wr">wear/</code>,
                  '—',
                  'Standalone Gradle project. Kotlin, Compose for Wear OS, OkHttp. Deliberately outside the pnpm workspace.',
                ],
              ]}
            />
          </DocSection>

          {/* ─────────────────────────────────── Problem */}
          <DocSection
            id="problem"
            eyebrow="02 — Introduction"
            title="The problem"
            lede="Agent runs are long and bursty. The dead time between the agent stopping and a human noticing is the single largest source of wasted wall-clock in agentic development."
          >
            <div className="prose-aibou">
              <p>
                The agent works for several minutes, then <strong>stops and waits</strong> for the
                human to approve a shell command, answer a question, or supply context. If the human
                has walked away, that wait is unbounded. A forty-minute task becomes a two-hour task
                because thirty-five of those minutes were the agent sitting idle behind a{' '}
                <code>y/n</code> prompt.
              </p>
              <p>
                Nothing times out on your behalf. The agent does not proceed optimistically, and it
                should not — the prompts that block are precisely the ones that touch your shell, your
                secrets, and your uncommitted work. The blocking is correct. The latency of the human
                answer is the defect.
              </p>
              <p>
                <strong>Aibou&apos;s core job is to collapse that dead time to seconds.</strong>{' '}
                Everything else — the event stream, the task list, the usage meter — is supporting
                context around that one job.
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Solution */}
          <DocSection
            id="solution"
            eyebrow="03 — Introduction"
            title="The solution"
            lede="Sit between the agent and the human, hold the blocking request open, decide what can be decided automatically, and route the rest to whatever screen the human is actually near."
          >
            <div className="prose-aibou">
              <p>
                When <code>kiro-cli</code> needs permission it sends{' '}
                <code>session/request_permission</code>. Critically, this is a JSON-RPC{' '}
                <em>request</em> with an <code>id</code>, not a notification — so the agent blocks
                until someone answers it. Aibou takes ownership of that answer.
              </p>
            </div>

            <DataTable
              head={['Stage', 'What happens', 'Why it matters']}
              rows={[
                [
                  'Enrich',
                  'A tool-call registry recovers the real command and input from the earlier tool_call notification.',
                  'Real permission requests carry only a toolCallId and a title. Without this, toolInput reaches clients as undefined and the policy engine has nothing to match.',
                ],
                [
                  'Decide',
                  'The policy engine evaluates the real command against JSON rules.',
                  'Routine work stops interrupting you. Dangerous work always stops.',
                ],
                [
                  'Escalate',
                  'Unresolvable requests broadcast as an AWP permission.request frame with a summary capped at 80 characters.',
                  'A watch has one line to work with. The summary is generated from real input, never fabricated.',
                ],
                [
                  'Resolve',
                  'One tap resolves the held JSON-RPC request. Exactly one answer is ever sent.',
                  'A second responder gets AIBOU_ALREADY_RESOLVED. Timeouts deny. Disconnects resolve nothing.',
                ],
              ]}
            />

            <Callout title="Why not attach to a running terminal?" tone="cyan">
              <p>
                Because the terminal owns the decision. Kiro CLI hooks fire for an external chat
                session and can even stall it, but on kiro-cli 2.18.1 a non-zero hook exit does{' '}
                <strong>not</strong> block the tool — it runs anyway. Rendering Approve and Deny
                buttons for such an event would show a control that does not control anything. So
                Aibou owns the sessions it gates, and offers <code>aibou chat</code> for the terminal
                workflow.
              </p>
            </Callout>
          </DocSection>

          {/* ─────────────────────────────────── Novelty */}
          <DocSection
            id="novelty"
            eyebrow="04 — Introduction"
            title="Novelty, prior art and creativity"
            lede="Aibou did not invent mobile agent supervision. It extends it to the one place the official product cannot reach."
          >
            <div className="prose-aibou">
              <p>
                <strong>Kiro for iOS exists.</strong> AWS launched it on 17 June 2026 at the AWS New
                York Summit. It lets developers start, monitor, steer and approve agentic coding
                sessions from a phone, review diffs, and manage multiple sessions. It connects only to
                Kiro sessions running in <strong>AWS cloud sandboxes</strong>. It does not, and cannot,
                reach a session running on your own machine.
              </p>
              <p>
                The one-sentence differentiator: Kiro for iOS supervises sessions running in AWS&apos;s
                cloud. Aibou supervises the session running on <em>your own machine</em> — the one with
                your local files, your local toolchain, and your uncommitted work.
              </p>
            </div>

            <DataTable
              head={['', 'Kiro for iOS', 'Aibou']}
              rows={[
                ['Session location', 'AWS cloud sandbox', 'Your laptop'],
                ['Requires', 'Cloud sandbox', <code key="k">kiro-cli</code>],
                ['Approval surface', 'In-app', 'Phone PWA + Wear OS watch'],
                ['Policy engine', 'No', 'Yes — configurable JSON rules'],
                ['Scope', 'Cloud sessions only', 'Local sessions only'],
              ]}
            />

            <DocSubheading>Where the innovation actually is</DocSubheading>
            <div className="prose-aibou">
              <ul>
                <li>
                  <strong>The policy engine.</strong> The capability the official app does not have.
                  It turns an interrupt-driven workflow into a graded one: routine writes inside the
                  project proceed silently, secrets and destructive commands always stop, and anything
                  unrecognised stops by default rather than by accident.
                </li>
                <li>
                  <strong>Owning the ACP host.</strong> Most integrations observe an agent. Aibou
                  hosts it, which is the only position from which a permission can actually be
                  answered remotely.
                </li>
                <li>
                  <strong>A wrist as a first-class surface.</strong> Not a phone app shrunk down. The
                  entire approval payload is designed backwards from an 80-character single-line
                  summary and two 48dp targets.
                </li>
                <li>
                  <strong>Honesty as an engineering constraint.</strong> Two features were deleted
                  rather than shipped as convincing-looking controls that did nothing. See{' '}
                  <Link href="#honesty">the honesty rule</Link>.
                </li>
                <li>
                  <strong>Documented protocol corrections.</strong> Two published ACP behaviours turned
                  out not to match the shipped agent, and both were load-bearing. See{' '}
                  <Link href="#acp">ACP integration</Link>.
                </li>
              </ul>
            </div>

            <Callout title="Scope discipline" tone="violet">
              <p>
                Explicit non-goals, recorded before implementation started: native iOS or Android
                apps, a code editor or diff editor on the watch, replacing Kiro Web, multi-user or
                hosted SaaS, cloud relay and NAT traversal, telemetry, and screen-scraping the Kiro
                TUI. If ACP does not expose something, Aibou does not have it.
              </p>
            </Callout>
          </DocSection>
          {/* ─────────────────────────────────── Quick start */}
          <DocSection
            id="quick-start"
            eyebrow="05 — Getting started"
            title="Quick start"
            lede="Four commands and a six-digit code. Mock mode exercises the entire stack with no Kiro account, no payment and no sign-up."
          >
            <DocSubheading>Prerequisites</DocSubheading>
            <DataTable
              head={['Requirement', 'Version', 'Needed for']}
              rows={[
                [<code key="n">node</code>, '≥ 20.11.0 (.nvmrc pins 20.11)', 'Bridge, PWA, protocol, mock agent'],
                [<code key="p">pnpm</code>, '≥ 9.0.0', 'Workspace install and scripts'],
                [
                  <code key="k">kiro-cli</code>,
                  'Any version exposing `kiro-cli acp` (verified against agent 2.18.1)',
                  'Live mode only — mock mode does not need it',
                ],
                [
                  'Android Studio',
                  'JDK 17+, compileSdk 37',
                  'Building the Wear OS app only',
                ],
              ]}
            />

            <DocSubheading>Mock mode — the reviewer path</DocSubheading>
            <CodeBlock
              shell
              filename="bash"
              code={`git clone <repo-url> && cd aibou
pnpm install
pnpm --filter @aibou/protocol build
pnpm run demo`}
            />
            <div className="prose-aibou">
              <p>
                Open <code>http://localhost:8787</code> on your phone browser, on the same Wi-Fi, and
                enter the six-digit code the Bridge printed. That is the entire pairing flow. The code
                changes on every start and expires after ten minutes.
              </p>
            </div>

            <DocSubheading>Live mode — a real Kiro session</DocSubheading>
            <CodeBlock
              shell
              filename="bash"
              code={`pnpm --filter @aibou/pwa build
pnpm --filter @aibou/bridge start`}
            />
            <div className="prose-aibou">
              <p>
                Live mode needs a signed-in Kiro CLI. You can sign in with <code>kiro-cli login</code>{' '}
                or from the Aibou web app, which drives the CLI&apos;s own OAuth device flow and relays
                the verification URL and user code. Aibou never sees a Kiro password.
              </p>
            </div>

            <DocSubheading>What the Bridge prints on startup</DocSubheading>
            <CodeBlock
              filename="terminal"
              code={`✅ ACP agent initialized: Kiro CLI Agent v2.18.1
   Protocol: v1
   Capabilities: loadSession=true

┌──────────────────────────────────────────────────────┐
│  ⛩️  Aibou Bridge v1.0.0                              │
├──────────────────────────────────────────────────────┤
│  Mode:    🟢 LIVE                                     │
│  Server:  http://127.0.0.1:8787                      │
│  Pairing: 428917                                     │
└──────────────────────────────────────────────────────┘

👤 Kiro account: you@example.com (Google)
🛡️  Policy: built-in defaults (6 rules)
🔗 Paired devices: none yet — enter the code above on your phone or watch
📱 Pairing URL: http://localhost:8787/pair?code=428917`}
            />

            <Callout title="Wear OS emulator: the number one setup failure" tone="amber">
              <p>
                From inside an Android emulator, the Bridge on your host is at{' '}
                <code>10.0.2.2:8787</code>, not <code>localhost</code>. That value is pre-filled on the
                pairing screen and is fully editable so a physical watch can point at your LAN IP.
              </p>
              <p>
                Also <strong>cold-boot the AVD</strong>. A Wear AVD resumed from a quickboot snapshot
                restores the clock it was saved with, and the watch has no time source to correct it,
                so elapsed times are computed against a host clock that disagrees. Use{' '}
                <em>Cold Boot Now</em>, or <code>emulator -avd Wear_OS_Small_Round -no-snapshot-load</code>.
              </p>
            </Callout>

            <DocSubheading>Building the Wear OS app</DocSubheading>
            <CodeBlock
              shell
              filename="bash"
              code={`cd wear
./gradlew :app:assembleDebug     # installable debug APK
./gradlew :app:assembleRelease   # release APK (unsigned without keystore.properties)
./gradlew :app:lintDebug         # 0 errors expected
adb install -r app/build/outputs/apk/debug/app-debug.apk`}
            />
            <div className="prose-aibou">
              <p>
                Toolchain is pinned: Gradle 9.4.1, AGP 9.2.1, Kotlin 2.4.10, JDK 17+, compileSdk 37,
                targetSdk 36, minSdk 30 (Wear OS 3+). A fresh machine needs two SDK packages that
                Android Studio does not install by default, because compileSdk 37 is newer than the
                bundled default:
              </p>
            </div>
            <CodeBlock
              shell
              filename="bash"
              code={`export ANDROID_HOME="$HOME/Library/Android/sdk"   # macOS; ~/Android/Sdk on Linux
sdkmanager "platforms;android-37.0" "build-tools;37.0.0"`}
            />
            <div className="prose-aibou">
              <p>
                Release signing is optional and driven by a gitignored{' '}
                <code>wear/keystore.properties</code>. Without it the release build still succeeds and
                produces an unsigned APK, so cloning the repo never requires local secrets. To pair
                without tapping the keypad by hand,{' '}
                <code>node scripts/pair-watch.mjs &lt;code&gt; --serial emulator-5554</code> drives the
                real keypad over adb, so the Keystore path is still exercised.
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Clients */}
          <DocSection
            id="clients"
            eyebrow="06 — Getting started"
            title="Clients"
            lede="Three surfaces, one Bridge. Each is scoped deliberately: the PWA is complete, the watch is glanceable, the terminal client exists so terminal approvals are answerable on the wrist."
          >
            <DocSubheading>React PWA</DocSubheading>
            <div className="prose-aibou">
              <p>
                Served statically by the Bridge at its root URL, installable via a web manifest.
                Screens: pairing, session list, event stream, approval cards, prompt input, account
                panel.
              </p>
              <ul>
                <li>
                  Approval cards are bordered by risk tier and show the full tool input — a shell
                  command as <code>$ cmd</code> in monospace, anything else as pretty-printed JSON —
                  with a live expiry countdown.
                </li>
                <li>
                  The event stream auto-scrolls <em>only</em> when you are already at the bottom, with a
                  50px threshold and a &quot;scroll to bottom&quot; pill otherwise.
                </li>
                <li>
                  Browser notifications fire on escalation, titled{' '}
                  <code>⛩️ Aibou — Approval Needed</code>, tagged by <code>approvalId</code> so repeats
                  coalesce.
                </li>
                <li>
                  The service worker precaches the app shell and <strong>bypasses</strong>{' '}
                  <code>/api</code> and <code>/ws</code> entirely, so it can never serve stale session
                  data.
                </li>
                <li>
                  A rejected token clears local storage, resets state, and returns to the pairing screen
                  with an explanation — rather than sitting on &quot;Disconnected&quot; forever with no
                  way forward.
                </li>
              </ul>
            </div>

            <DocSubheading>Wear OS app</DocSubheading>
            <div className="prose-aibou">
              <p>
                Standalone by design — a direct WebSocket from the watch, no phone companion, because
                companion pairing forces two emulators on anyone trying to run the project. The
                consequence is that the watch needs Wi-Fi on the same network as the Bridge.
              </p>
              <ul>
                <li>
                  On <code>permission.request</code>: vibrate by risk tier, wake the screen, and
                  auto-navigate to the approval. Summary at ≥16sp, Approve and Deny as full-width chips
                  ≥48dp, vertically separated to prevent mis-taps.
                </li>
                <li>
                  With the app off screen, a notification carries Approve and Deny actions, handled by a
                  receiver declared <code>exported=&quot;false&quot;</code> so only this app can dispatch
                  a decision.
                </li>
                <li>
                  A <code>specialUse</code> foreground service holds the socket open. A backgrounded
                  process gets frozen by ActivityManager, which kills the WebSocket and loses
                  approvals. <code>connectedDevice</code> was rejected because it demands a Bluetooth or
                  Wi-Fi permission the app does not use, and <code>dataSync</code> is throttled to a few
                  hours a day.
                </li>
                <li>
                  The pairing token is encrypted with an AES-256-GCM key held in the Android Keystore.{' '}
                  <code>androidx.security:security-crypto</code> is deliberately unused — it is
                  deprecated.
                </li>
                <li>
                  Voice prompting uses <code>RecognizerIntent.ACTION_RECOGNIZE_SPEECH</code> with
                  transcript confirmation, and the feature hides itself if no recogniser is available. A{' '}
                  <code>&lt;queries&gt;</code> manifest declaration is required, without which{' '}
                  <code>resolveActivity()</code> returns null on Android 11+ even when a recogniser is
                  installed.
                </li>
              </ul>
            </div>

            <DocSubheading>aibou chat</DocSubheading>
            <div className="prose-aibou">
              <p>
                A terminal client for a session the Bridge owns, so its approvals are answerable on the
                watch. Flags: <code>--host</code>, <code>--port</code>, <code>--code &lt;n&gt;</code>{' '}
                (omit to reuse an existing token), <code>--cwd</code>, plus a positional first prompt.
                In-session commands: <code>/interrupt</code>, <code>/status</code>, <code>/close</code>,{' '}
                <code>/exit</code> (which leaves the session open on the Bridge).
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Configuration */}
          <DocSection
            id="configuration"
            eyebrow="07 — Getting started"
            title="Configuration"
            lede="Flags, environment variables and on-disk paths. There is no database — configuration is JSON files and events live in memory."
          >
            <DocSubheading>CLI flags</DocSubheading>
            <DataTable
              head={['Flag', 'Default', 'Effect']}
              rows={[
                [<code key="a">--mock</code>, 'off', 'Use the bundled fake ACP agent. No Kiro credentials required.'],
                [<code key="b">--host &lt;addr&gt;</code>, '127.0.0.1', 'Bind address. Anything non-loopback prints a network-exposure warning.'],
                [<code key="c">--port &lt;n&gt;</code>, '8787', 'Bind port. EADDRINUSE exits 98 with a platform-correct command to find the owner.'],
                [<code key="d">--paranoid</code>, 'off', 'Escalate every action, ignoring all allow rules.'],
                [<code key="e">--trace</code>, 'off', 'Log every ACP frame to ~/.aibou/logs/acp-<date>.jsonl.'],
                [<code key="f">--approval-timeout &lt;ms&gt;</code>, '900000 (15 min)', 'Auto-deny a held approval after this long.'],
                [<code key="g">--event-buffer &lt;n&gt;</code>, '500', 'Events retained per session for replay.'],
                [<code key="h">--max-sessions &lt;n&gt;</code>, '4', 'Concurrent session cap.'],
                [<code key="i">--revoke-tokens</code>, 'off', 'Forget all paired devices, forcing them to pair again.'],
                [<code key="j">--help</code>, '—', 'Print usage.'],
              ]}
              caption="Invalid numeric values are rejected with a warning and fall back to the default, rather than starting the Bridge in a broken state."
            />

            <DocSubheading>Environment and paths</DocSubheading>
            <DataTable
              head={['Path or variable', 'Purpose']}
              rows={[
                [<code key="a">AIBOU_KIRO_BIN</code>, 'Override the kiro-cli binary path. Used by both the ACP client and the account manager.'],
                [<code key="b">~/.aibou/config.json</code>, 'Issued pairing tokens, written with mode 0600, capped at 20 entries. Only values matching /^[0-9a-f]{64}$/ are loaded back.'],
                [<code key="c">~/.aibou/policy.json</code>, 'Your policy document. Absent means built-in defaults apply. A UTF-8 BOM is tolerated.'],
                [<code key="d">~/.aibou/logs/acp-&lt;date&gt;.jsonl</code>, 'Raw ACP frames, written only under --trace.'],
              ]}
            />

            <DocSubheading>Scripts</DocSubheading>
            <CodeBlock
              shell
              filename="bash"
              code={`pnpm run demo        # Bridge in mock mode (builds protocol, mock agent, PWA first)
pnpm run dev         # Bridge with tsx watch
pnpm run start       # Bridge from built output
pnpm run chat        # aibou chat
pnpm run check       # typecheck + lint + test
pnpm -r test         # unit tests across all packages
make verify-node     # types, lint and unit tests only — no emulator required
make verify-quick    # full verification minus the 95s backgrounded-approval wait
make verify          # everything, needs a live Bridge and a Wear emulator`}
            />
            <div className="prose-aibou">
              <p>
                Note that <code>make wear</code> is declared <code>.PHONY</code> but has no rule — build
                the watch app with <code>./gradlew</code> from the <code>wear/</code> directory.
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Architecture */}
          <DocSection
            id="architecture"
            eyebrow="08 — Reference"
            title="Architecture"
            lede="One daemon, four adapters, three surfaces. ACP knowledge is confined to two files by convention, so the rest of the codebase never has to know what protocol the agent speaks."
          >
            <CodeBlock
              filename="module map"
              code={`packages/bridge/src/
├── index.ts              CLI parsing, flag validation, LAN warning
├── bridge.ts             orchestrator — wires everything together
├── acp/
│   ├── client.ts         spawn, newline-delimited JSON-RPC, request correlation
│   ├── methods.ts        typed ACP calls          ← knows ACP's shape
│   ├── normalize.ts      ACP session/update → AWP ← knows ACP's shape
│   └── toolcalls.ts      toolCallId → { kind, rawInput, kiroToolName }
├── session/
│   ├── manager.ts        status derivation, per-session state
│   └── ringbuffer.ts     fixed-capacity replay buffer
├── policy/
│   ├── engine.ts         allow / deny / escalate evaluation
│   └── defaults.ts       shipped rules, as data
├── approval/manager.ts   holds ACP responses until answered
├── account/manager.ts    kiro-cli whoami / login device flow
├── server/
│   ├── auth.ts           pairing codes, tokens, rate limiting
│   ├── http.ts           Fastify routes + static PWA
│   └── ws.ts             WebSocket hub, auth gate, heartbeat
└── chat/cli.ts           the aibou chat terminal client`}
            />

            <Callout title="Architectural rules, enforced by steering" tone="violet">
              <p>
                <code>acp/methods.ts</code> and <code>acp/normalize.ts</code> are the only files that
                know ACP&apos;s shape. <code>packages/protocol</code> is the single source of truth for
                wire types. Every inbound frame is zod-parsed and <code>as</code> assertions are
                banned. There is no database: configuration is JSON files and events are in-memory ring
                buffers.
              </p>
            </Callout>

            <DocSubheading>Permission data flow</DocSubheading>
            <CodeBlock
              filename="flow"
              code={`1  agent  → session/update { sessionUpdate: "tool_call", toolCallId,
                              kind, rawInput, _meta.kiro.toolName }
      ToolCallRegistry.record()  →  normalize → tool.start event → seq → broadcast

2  agent  → session/request_permission (id=M)   toolCallId + title ONLY

3  Bridge   merge remembered details
            policyToolName = kiroToolName ?? kind ?? title ?? "unknown"
            riskTier       = determineRiskTier(kind, rawInput)
            PolicyEngine.evaluate({ toolName, rawInput, cwd })

4a allow/deny  → answer ACP immediately
               → broadcast permission.resolved { resolution: "policy", ruleId }

4b escalate    → setAwaitingPermission()
               → createApproval()  (approvalId = 16 random bytes, hex)
               → broadcast permission.request + session.state

5  client  → permission.respond { approvalId, decision }
6  Bridge    resolveApproval() → optionId resolved from the semantic kind
             origin "acp"      → answer the held JSON-RPC request
             origin "external" → resolve the held HTTP promise
7  Bridge  → broadcast permission.resolved + session.state`}
            />

            <DocSubheading>Failure behaviour</DocSubheading>
            <DataTable
              head={['Failure', 'Handling']}
              rows={[
                ['kiro-cli missing', 'Exit code 78 with a hint naming AIBOU_KIRO_BIN and --mock.'],
                [
                  'Agent crashes mid-session',
                  'All sessions marked disconnected; three respawn attempts at 1000 / 2000 / 4000 ms, then exit 78.',
                ],
                [
                  'Agent exits before the handshake',
                  'No respawn — a binary that cannot initialise will not initialise on retry. Exit 78.',
                ],
                ['Unparseable ACP frame', 'Normalised to kind "unknown" with the payload preserved. Never crashes.'],
                ['Malformed policy.json', 'Paranoid mode. The Bridge keeps running and says why.'],
                ['Two clients answer the same approval', 'First wins. The second gets AIBOU_ALREADY_RESOLVED.'],
                [
                  'Port already in use',
                  'Exit 98, names the port, prints the platform-correct command to find the owner, suggests --port n+1, and kills the spawned agent so it is not leaked.',
                ],
                ['Watch loses Wi-Fi', 'Reconnect with backoff, then resubscribe from the last sequence number.'],
                ['Nobody answers an approval', 'Auto-deny at the timeout with resolution "timeout".'],
              ]}
            />

            <DocSubheading>Performance budget</DocSubheading>
            <DataTable
              head={['Path', 'Budget', 'Measured against the real agent']}
              rows={[
                ['Permission request → wire', '< 250 ms', 'Met'],
                ['Watch tap → ACP answer', '< 300 ms', 'Met'],
                ['session/update → rendered', '< 500 ms', 'Met'],
                ['Bridge idle memory', '< 150 MB', 'Met'],
                ['Wear cold start', '< 2 s', 'Met'],
                ['initialize round-trip', '—', '≈ 2.0 s'],
                ['session/new round-trip', '—', '≈ 3.4 s — expected, not a hang'],
              ]}
              caption="session/new taking over three seconds is why client-side timeouts must be generous. A 3s timeout fails intermittently."
            />
          </DocSection>

          {/* ─────────────────────────────────── Protocol */}
          <DocSection
            id="protocol"
            eyebrow="09 — Reference"
            title="AWP — the Aibou Wire Protocol"
            lede="A single WebSocket at /ws carrying JSON text frames. Original to this project, defined by zod schemas in packages/protocol, and versioned by a literal."
          >
            <CodeBlock
              filename="packages/protocol/src/frames.ts"
              code={`BaseFrame = {
  v:  1          // zod literal — a v:2 frame is rejected as AIBOU_BAD_FRAME
  t:  string     // discriminator
  id?: string    // client-generated, echoed on the reply
  ts: number     // epoch millis
}`}
            />

            <DocSubheading>Client → Server</DocSubheading>
            <DataTable
              head={['Frame', 'Fields', 'Notes']}
              rows={[
                [<code key="a">auth</code>, 'token', 'Must be the first frame. Anything else closes the socket with 4401.'],
                [<code key="b">subscribe</code>, 'sessionId?, since?', 'Omit sessionId to subscribe to everything. since drives replay.'],
                [<code key="c">session.create</code>, 'cwd', 'Fails with AIBOU_BAD_CWD or AIBOU_SESSION_LIMIT.'],
                [<code key="d">session.list</code>, '—', 'Returns session summaries on the ack.'],
                [<code key="e">prompt.send</code>, "sessionId, text, source: 'text' | 'voice'", 'Acked immediately — never after the turn, which can take minutes.'],
                [<code key="f">permission.respond</code>, "approvalId, decision: 'allow' | 'deny', remember?", 'Second response for the same approvalId returns AIBOU_ALREADY_RESOLVED.'],
                [<code key="g">session.interrupt</code>, 'sessionId', 'Sends the ACP session/cancel notification.'],
                [<code key="h">session.close</code>, 'sessionId', 'Frees the session slot. Without it the concurrency cap is a dead end.'],
                [<code key="i">pong</code>, '—', 'Answer to heartbeat. Three misses closes with 4408.'],
                [<code key="j">account.status</code>, '—', 'Ask which Kiro account the agent runs as.'],
                [<code key="k">account.login</code>, 'license?, social?, identityProvider?, region?', "Starts the CLI's OAuth device flow."],
                [<code key="l">account.login.cancel</code>, '—', 'Abandon an in-flight sign-in without signing out.'],
                [<code key="m">account.logout</code>, '—', 'Signs the Kiro account out. Does not unpair the device.'],
              ]}
            />

            <DocSubheading>Server → Client</DocSubheading>
            <DataTable
              head={['Frame', 'Fields', 'Notes']}
              rows={[
                [
                  <code key="a">hello</code>,
                  "bridgeVersion, protocolVersion: 1, mode: 'live' | 'mock', capabilities",
                  "bridgeVersion is read at runtime from package.json. capabilities is ['sessions','permissions','events','account'].",
                ],
                [<code key="b">ack</code>, 'ok: true, result?', 'Echoes the request id.'],
                [<code key="c">error</code>, 'code, message, retryable', 'Codes listed below.'],
                [
                  <code key="d">session.state</code>,
                  "sessionId, cwd, status, statusSource: 'observed' | 'inferred', statusReason?, pendingApprovals, lastActivity",
                  'statusSource is what makes inference visible rather than implied.',
                ],
                [<code key="e">event</code>, 'sessionId, seq, kind, payload', 'seq is monotonic per session and never resets.'],
                [
                  <code key="f">permission.request</code>,
                  'approvalId, sessionId, toolName, summary, toolInput, riskTier, expiresAt',
                  'summary is schema-capped at 80 characters — the watch budget.',
                ],
                [
                  <code key="g">permission.resolved</code>,
                  "approvalId, decision, resolution: 'user' | 'policy' | 'timeout', resolvedBy?, ruleId?",
                  'Emitted for policy auto-resolutions too, so the audit trail has no holes.',
                ],
                [<code key="h">heartbeat</code>, '—', 'Every 20 seconds.'],
                [
                  <code key="i">account.state</code>,
                  'state, accountType?, provider?, email?, verificationUri?, userCode?, reason?',
                  'Optional fields are present only when the CLI reported them.',
                ],
              ]}
            />

            <DocSubheading>Enums</DocSubheading>
            <DataTable
              head={['Enum', 'Values']}
              rows={[
                [
                  'SessionStatus',
                  <code key="a">idle · working · awaiting_permission · awaiting_input · error · disconnected</code>,
                ],
                ['RiskTier', <code key="b">low · medium · high</code>],
                [
                  'EventKind',
                  <code key="c">
                    agent.text · agent.thought · tool.start · tool.end · task.update · usage ·
                    session.error · unknown
                  </code>,
                ],
                [
                  'AccountState',
                  <code key="d">authenticated · unauthenticated · authenticating · mock · unavailable</code>,
                ],
              ]}
              caption="unknown is mandatory, not a fallback of last resort: unrecognised ACP frames are preserved verbatim rather than dropped or crashed on."
            />

            <DocSubheading>Error and exit codes</DocSubheading>
            <DataTable
              head={['Code', 'Meaning']}
              rows={[
                [<code key="a">AIBOU_UNAUTHORIZED</code>, 'Bad or revoked Aibou pairing token.'],
                [<code key="b">AIBOU_UNAUTHENTICATED</code>, 'No Kiro account is signed in, so the agent cannot do any work.'],
                [<code key="c">AIBOU_BAD_CWD</code>, 'Requested working directory is unusable.'],
                [<code key="d">AIBOU_SESSION_LIMIT</code>, 'Concurrent session cap reached. Close one with session.close.'],
                [<code key="e">AIBOU_SESSION_NOT_FOUND</code>, 'Unknown sessionId.'],
                [<code key="f">AIBOU_ALREADY_RESOLVED</code>, 'This approval was already answered.'],
                [<code key="g">AIBOU_APPROVAL_NOT_FOUND</code>, 'Unknown approvalId.'],
                [<code key="h">AIBOU_UNSUPPORTED</code>, 'Capability not available.'],
                [<code key="i">AIBOU_AGENT_DOWN</code>, 'The ACP agent is not running.'],
                [<code key="j">AIBOU_RATE_LIMITED</code>, 'Too many attempts.'],
                [<code key="k">AIBOU_BAD_FRAME</code>, 'Frame failed zod validation.'],
                [<code key="l">AIBOU_INTERNAL</code>, 'Unexpected Bridge error.'],
                [<code key="m">exit 78</code>, 'Agent unavailable.'],
                [<code key="n">exit 98</code>, 'Port in use.'],
                [<code key="o">close 4401</code>, 'WebSocket: auth timeout, first frame not auth, or invalid token.'],
                [<code key="p">close 4408</code>, 'WebSocket: three missed heartbeats.'],
              ]}
            />

            <DocSubheading>The summary contract</DocSubheading>
            <div className="prose-aibou">
              <p>
                An approval summary is at most 80 characters, single-line, with no ANSI. Whitespace runs
                are collapsed so a multi-line command stays on one line, and truncation backs off a
                character rather than splitting a UTF-16 surrogate pair. The generator tries, in order:{' '}
                <code>Run: &lt;command&gt;</code>, <code>Write: &lt;basename&gt;</code>,{' '}
                <code>Delete: &lt;basename&gt;</code>, <code>Read/Fetch/Search: &lt;target&gt;</code>, the
                agent&apos;s own title, then a generic label. It never fabricates specifics.
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Policy engine */}
          <DocSection
            id="policy-engine"
            eyebrow="10 — Reference"
            title="Policy engine"
            lede="Rules are data, not code. They are evaluated against the real command the agent is about to run, recovered from the earlier tool_call notification."
          >
            <CodeBlock
              filename="rule schema"
              code={`PolicyRule = {
  id: string
  when: {
    tool?:           string | string[]      // tool name or ACP kind; supports * and prefix_*
    pathIn?:         "cwd" | "outside_cwd"  // relative to the session directory
    pathMatches?:    string                 // glob against the target path
    pathRegex?:      string                 // regex, unanchored, case-insensitive
    commandMatches?: string                 // regex, unanchored, case-insensitive
  }
  then:   "allow" | "deny" | "escalate"
  reason: string
}

Policy = { version: 1, rules: PolicyRule[] }`}
            />

            <DocSubheading>Evaluation order</DocSubheading>
            <DataTable
              head={['Step', 'Rule', 'Result']}
              rows={[
                ['0', 'Paranoid mode active', 'escalate everything, ignoring all rules'],
                ['1', 'Collect every matching rule', '—'],
                ['2', 'Any match is deny', 'deny — regardless of rule order'],
                ['3', 'Any match is escalate', 'escalate'],
                ['4', 'All matches are allow', 'allow'],
                ['5', 'Nothing matched', 'escalate — fail closed'],
              ]}
              caption="Conditions inside one `when` are ANDed. A rule with an empty `when` would match everything, so it is treated as non-matching instead — a malformed rule cannot silently allow or deny the whole system."
            />

            <DocSubheading>Matching semantics</DocSubheading>
            <div className="prose-aibou">
              <ul>
                <li>
                  Globs escape every regex metacharacter except <code>*</code> and <code>?</code>, which
                  become <code>.*</code> and <code>.</code>, then anchor with <code>^…$</code>.
                </li>
                <li>
                  An invalid regex is logged and the condition <strong>fails</strong>. An invalid regex
                  must never silently widen a rule.
                </li>
                <li>
                  Paths are normalised — backslashes to forward slashes, trailing slash stripped,
                  lowercased — so Windows and POSIX compare equally.
                </li>
                <li>
                  <code>pathIn</code> compares on a path-segment boundary, so{' '}
                  <code>/project-secrets</code> is not treated as inside <code>/project</code>.
                </li>
                <li>
                  Paths are extracted across known field names:{' '}
                  <code>path, file, files, file_path, filePath, targetFile, target_file, destinationPath, sourcePath, directory, dir</code>{' '}
                  — using the first string entry if the value is an array.
                </li>
                <li>
                  Commands are extracted from <code>command, cmd, script, commandLine</code>.
                </li>
                <li>
                  Rules match on the agent&apos;s real tool name (<code>_meta.kiro.toolName</code>, e.g.{' '}
                  <code>shell</code>), falling back to the ACP tool kind (e.g. <code>execute</code>).
                </li>
              </ul>
            </div>

            <DocSubheading>Shipped defaults</DocSubheading>
            <DataTable
              head={['Rule id', 'Matches', 'Decision']}
              rows={[
                [<code key="a">deny-aibou-self-modification</code>, 'Any path inside ~/.aibou/', 'deny'],
                [<code key="b">escalate-secret-paths</code>, '18 secret-path patterns: .env, *.pem, *.key, id_rsa, .ssh/, .aws/, .kube/, .netrc, credentials, keystore, .npmrc …', 'escalate'],
                [<code key="c">escalate-dangerous-commands</code>, '27 command patterns: rm -rf, sudo, chmod 777, git push --force, git reset --hard, piped shells, dd if=, mkfs, npm publish, shutdown, kill -9, iptables -F …', 'escalate'],
                [<code key="d">escalate-writes-outside-cwd</code>, 'Write tools with a target outside the session directory', 'escalate'],
                [<code key="e">allow-read-only-tools</code>, 'fs_read, read_file, grep_search, file_search, list_directory, get_diagnostics + ACP kinds read, search', 'allow'],
                [<code key="f">allow-writes-in-cwd</code>, 'Write tools with a target inside the session directory', 'allow'],
              ]}
              caption="Notably, command tools appear in no allow rule. By default every shell command escalates: running commands always deserves a human decision unless you explicitly allow-list it."
            />

            <Callout title="Degradation is fail-closed, not fail-open" tone="amber">
              <p>
                An empty, unparseable or schema-invalid <code>policy.json</code> switches the engine to
                paranoid mode, records why, and logs it. The Bridge keeps running and prints the reason
                on startup. <code>reload()</code> clears the degraded state so a fixed file restores
                normal operation without a restart. A UTF-8 BOM is stripped before parsing, because
                Windows editors add one and <code>JSON.parse</code> rejects it.
              </p>
            </Callout>

            <DocSubheading>Risk tiers</DocSubheading>
            <div className="prose-aibou">
              <p>
                Separate from the policy decision, every escalation carries a risk tier that drives the
                PWA card colour and the watch haptic pattern. Command kinds, or any non-empty command
                string, are <code>medium</code> — or <code>high</code> if the command matches the
                destructive pattern set. Deletes are <code>high</code>; writes, edits and moves are{' '}
                <code>medium</code>; everything else is <code>low</code>.
              </p>
            </div>

            <DocSubheading>Worked example</DocSubheading>
            <CodeBlock
              filename="~/.aibou/policy.json"
              code={`{
  "version": 1,
  "rules": [
    {
      "id": "deny-git-history-rewrite",
      "when": { "commandMatches": "git\\\\s+(push\\\\s+--force|push\\\\s+-f\\\\b|reset\\\\s+--hard)" },
      "then": "deny",
      "reason": "Rewriting or force-pushing history is never allowed unattended."
    },
    {
      "id": "allow-test-commands",
      "when": { "commandMatches": "^(npm|pnpm|yarn)\\\\s+(test|run\\\\s+test)\\\\b|^pytest\\\\b" },
      "then": "allow",
      "reason": "Running the test suite is routine; approve without interrupting."
    }
  ]
}`}
            />
            <div className="prose-aibou">
              <p>
                A documented starting point ships at <code>examples/policy.example.json</code>, with the
                evaluation order and every condition explained inline. Its behaviour is covered by tests,
                so the example cannot drift from the engine. Copy it to <code>~/.aibou/policy.json</code>{' '}
                to use it — the Bridge prints which policy is active on startup.
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Approvals */}
          <DocSection
            id="approvals"
            eyebrow="11 — Reference"
            title="Approval lifecycle"
            lede="An escalated permission is a JSON-RPC request being held open on purpose. Six invariants keep that from becoming a leak, a double-answer, or a lie."
          >
            <DataTable
              head={['#', 'Invariant']}
              rows={[
                ['1', 'Exactly one ACP answer per request, ever. A second responder receives AIBOU_ALREADY_RESOLVED.'],
                ['2', 'A held request always terminates — a user decision or a timeout deny. It is never leaked.'],
                ['3', 'Client disconnection never resolves an approval. It is replayed on resubscribe.'],
                ['4', 'Deny beats allow, always, regardless of rule order.'],
                ['5', 'An unmatched request escalates. The engine never auto-approves by omission.'],
                ['6', 'Every resolution emits permission.resolved — including policy auto-resolutions, so the audit trail has no holes.'],
              ]}
            />

            <DocSubheading>Option ids are resolved semantically</DocSubheading>
            <div className="prose-aibou">
              <p>
                The agent supplies its own option ids. Real kiro-cli uses snake_case —{' '}
                <code>allow_once</code>, <code>allow_always</code>, <code>reject_once</code> — so the
                Bridge never assumes a hyphenated literal. It resolves the id through the semantic{' '}
                <code>kind</code> field, preferring <code>allow_once</code> then{' '}
                <code>allow_always</code> for an approval, and <code>reject_once</code> then{' '}
                <code>reject_always</code> for a denial.
              </p>
            </div>

            <DocSubheading>Two origins, two response channels</DocSubheading>
            <DataTable
              head={['Origin', 'Raised by', 'Answered on']}
              rows={[
                [<code key="a">acp</code>, 'The hosted agent, via session/request_permission', 'The held JSON-RPC request'],
                [
                  <code key="b">external</code>,
                  'Another process, via POST /api/approval',
                  'The held HTTP response',
                ],
              ]}
              caption="Answering the wrong channel would either leave an agent blocked forever or crash on a request id that does not exist. To clients the two are deliberately indistinguishable — the watch renders and answers both identically."
            />

            <Callout title="External approvals still go through policy" tone="emerald">
              <p>
                <code>POST /api/approval</code> requires a bearer token, because anything that can raise
                an approval can also interrupt you. The policy engine is consulted for external
                approvals too, so an auto-deny rule cannot be bypassed by asking over HTTP instead.
              </p>
            </Callout>

            <DocSubheading>HTTP endpoints</DocSubheading>
            <DataTable
              head={['Method', 'Path', 'Auth', 'Purpose']}
              rows={[
                ['GET', <code key="a">/ws</code>, 'Frame-level', 'WebSocket upgrade. auth must be the first frame, within 5 seconds.'],
                ['POST', <code key="b">/api/pair</code>, 'None', 'Exchange a six-digit code for a bearer token. 400 / 429 / 401.'],
                ['GET', <code key="c">/api/health</code>, 'None', 'status, version, uptime, connected client count.'],
                ['GET', <code key="d">/api/account</code>, 'None', 'Read-only account state. Exposes no credentials — only what the CLI itself prints.'],
                ['POST', <code key="e">/api/approval</code>, 'Bearer', 'Raise an approval from outside ACP and block until a human answers.'],
                ['GET', <code key="f">/*</code>, 'None', 'Static PWA with an SPA index fallback.'],
              ]}
            />
          </DocSection>

          {/* ─────────────────────────────────── Sessions */}
          <DocSection
            id="sessions"
            eyebrow="12 — Reference"
            title="Sessions, status and replay"
            lede="Four concurrent sessions by default, 500 events retained each, and a replay contract that survives a watch walking out of Wi-Fi range."
          >
            <DocSubheading>Ring buffer</DocSubheading>
            <div className="prose-aibou">
              <p>
                A true circular buffer with a monotonic sequence counter starting at 1. Sequence numbers
                are never reset by wraparound. <code>replaySince(n)</code> walks from the oldest retained
                slot forward and emits everything with <code>seq &gt; n</code> in order — no gaps, no
                duplicates within what is retained.
              </p>
              <p>
                Overflow silently overwrites the oldest entry. A client asking for a sequence older than
                the buffer&apos;s oldest gets only the survivors: events are lost rather than errored,
                and no gap is signalled. That is a real limitation of the current design, noted here
                rather than papered over.
              </p>
            </div>

            <DocSubheading>Replay on subscribe</DocSubheading>
            <CodeBlock
              filename="order"
              code={`1  every buffered event with seq > since
      sent with the ORIGINAL event timestamp as ts, not the replay time
2  the current session.state frame
3  every pending approval, re-sent as a full permission.request frame
4  one ack, echoing the subscribe request id`}
            />
            <div className="prose-aibou">
              <p>
                Step 3 is invariant 3 in action. The PWA and the watch both resubscribe with{' '}
                <code>since: lastSeq</code> immediately on receiving <code>hello</code>, so a reconnect
                catches up rather than starting blank.
              </p>
            </div>

            <DocSubheading>Status derivation</DocSubheading>
            <DataTable
              head={['Status', 'Source', 'Derived from']}
              rows={[
                [<code key="a">awaiting_permission</code>, 'observed', 'At least one held session/request_permission'],
                [<code key="b">working</code>, 'observed', 'Prompt forwarded; turn not yet resolved'],
                [<code key="c">idle</code>, 'observed', "session/prompt resolved with stopReason 'end_turn'"],
                [
                  <code key="d">awaiting_input</code>,
                  <strong key="i">inferred</strong>,
                  'Heuristic — see the honesty rule',
                ],
                [<code key="e">error</code>, 'observed', "stopReason 'refusal', an ACP error frame, or a prompt failure"],
                [<code key="f">disconnected</code>, 'observed', 'The agent child process exited'],
              ]}
            />

            <DataTable
              head={['stopReason', 'Resulting status']}
              rows={[
                [<code key="a">end_turn</code>, 'idle, or awaiting_input if the heuristic fires'],
                [<code key="b">max_tokens</code>, 'idle with statusReason "Turn stopped: max_tokens"'],
                [<code key="c">max_turn_requests</code>, 'idle with statusReason "Turn stopped: max_turn_requests"'],
                [<code key="d">cancelled</code>, 'idle with statusReason "Turn stopped: cancelled"'],
                [<code key="e">refusal</code>, 'error with an explanatory statusReason'],
              ]}
              caption="max_tokens, max_turn_requests and cancelled are reported as observed because the agent stated them explicitly. The statusReason preserves the detail rather than flattening it to a bare idle."
            />

            <DocSubheading>Session capacity</DocSubheading>
            <div className="prose-aibou">
              <p>
                At the cap, <code>session.create</code> first reclaims sessions already in{' '}
                <code>error</code> or <code>disconnected</code> — holding a slot for a dead session only
                turns the cap into a dead end. Only if the Bridge is still full does it return{' '}
                <code>AIBOU_SESSION_LIMIT</code>, with a message naming <code>session.close</code> and the
                session list in the web app as the two ways out.
              </p>
              <p>
                Closing a session cancels its approvals, sends the ACP <code>session/cancel</code>{' '}
                notification best-effort, then broadcasts the final <code>disconnected</code> state{' '}
                <em>before</em> removal so clients can drop it from their lists.
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Security */}
          <DocSection
            id="security"
            eyebrow="13 — Reference"
            title="Security model"
            lede="Aibou is a remote control for a process that executes arbitrary shell commands. Security is treated as an application-quality deliverable, not a nice-to-have."
          >
            <DocSubheading>Threat model</DocSubheading>
            <DataTable
              head={['Threat', 'Impact', 'Mitigation']}
              rows={[
                [
                  'Attacker on the LAN intercepts traffic',
                  'Sees approval content, steals a token',
                  'Binds to 127.0.0.1 by default; LAN binding requires an explicit --host with a printed warning; Tailscale or a VPN recommended for remote access',
                ],
                [
                  'Attacker brute-forces the pairing code',
                  'Gains a permanent access token',
                  'Six-digit code (1M combinations); 5 failed attempts per IP in 60s blocks that IP for 5 minutes; the code expires in 10 minutes',
                ],
                [
                  'Token stolen from device storage',
                  'Full session control',
                  'PWA: localStorage under same-origin protection. Watch: AES-256-GCM key in the Android Keystore',
                ],
                [
                  'Malicious client forges an approval',
                  'The agent executes an unauthorised action',
                  'Bearer token required on every connection; token is 32 bytes from a CSPRNG; comparison is constant-time',
                ],
                [
                  'The agent modifies Aibou config',
                  'Policy bypass',
                  'A default deny rule blocks any write to ~/.aibou/',
                ],
                [
                  'Replay of a WebSocket approval',
                  'Re-approving a previously denied action',
                  'Each approval has a unique approvalId; a second response returns AIBOU_ALREADY_RESOLVED',
                ],
              ]}
            />

            <DocSubheading>Authentication</DocSubheading>
            <div className="prose-aibou">
              <ul>
                <li>
                  Pairing code: six digits from <code>randomInt</code>, valid for ten minutes, printed in
                  the terminal alongside a QR code for the pairing URL.
                </li>
                <li>
                  Token: <code>randomBytes(32).toString(&apos;hex&apos;)</code> — 64 hex characters,
                  32 bytes of CSPRNG output.
                </li>
                <li>
                  Comparison uses <code>crypto.timingSafeEqual</code>. On a length mismatch it still runs
                  a dummy comparison, so length does not leak through timing.
                </li>
                <li>
                  Tokens persist to <code>~/.aibou/config.json</code> at mode <code>0600</code>, capped at
                  20, and only values shaped like tokens Aibou would have issued are loaded back. Without
                  persistence, every Bridge restart would silently force every device to re-pair.
                </li>
                <li>
                  A malformed config file is a warning, never fatal — it simply means no device is paired
                  yet.
                </li>
                <li>
                  WebSocket: <code>auth</code> must be the first frame and must arrive within five
                  seconds, or the socket closes with 4401. Heartbeats run every 20 seconds and three
                  missed pongs close with 4408.
                </li>
              </ul>
            </div>

            <Callout title="Two separate identities" tone="cyan">
              <p>
                The <strong>Aibou pairing token</strong> authenticates a device. The{' '}
                <strong>Kiro account</strong> is who the agent runs as. Signing out of Kiro does not
                unpair a device, and unpairing does not sign out of Kiro. Aibou never sees a Kiro
                password — sign-in goes through the CLI&apos;s own OAuth device flow and Aibou relays
                only the verification URL and user code.
              </p>
            </Callout>

            <DocSubheading>No TLS — the reasoning</DocSubheading>
            <div className="prose-aibou">
              <p>
                Aibou does not implement TLS. The default binding is loopback, so there is no network
                exposure; LAN binding is intended for a trusted home or office network; and self-signed
                certificates create real UX friction without meaningful security against a local
                attacker. For remote access, use Tailscale or WireGuard. Aibou deliberately does not
                implement a cloud relay, NAT traversal or public tunnelling.
              </p>
              <p>
                If the Bridge is bound to <code>0.0.0.0</code> and an attacker is on your network:
                without a token they can do nothing, since every WebSocket must authenticate within five
                seconds and every endpoint except health and account state requires a token. If they
                guess the pairing code within its ten-minute window and past the rate limiter, they get
                full control — which is why the code is only ever displayed in your terminal.
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── ACP */}
          <DocSection
            id="acp"
            eyebrow="14 — Engineering notes"
            title="ACP integration and verified findings"
            lede="Every assumption about the Agent Client Protocol was verified against a real kiro-cli agent with --trace, reading raw JSON-RPC frames. Two published behaviours did not match the shipped agent, and both were load-bearing."
          >
            <DataTable
              head={['Environment', 'Value']}
              rows={[
                ['kiro-cli CLI', '2.3.0'],
                ['ACP agent reported', 'Kiro CLI Agent 2.18.1'],
                ['ACP protocol version', '1'],
                ['OS / Node', 'Windows 11 / Node v24.12.0'],
              ]}
            />

            <DocSubheading>Correction 1 — session/prompt takes prompt, not content</DocSubheading>
            <div className="prose-aibou">
              <p>
                Kiro&apos;s published docs page shows <code>params.content</code>. The real agent requires{' '}
                <code>params.prompt</code>, matching the ACP v1 spec. Sending <code>content</code> makes
                the agent <strong>exit with code 0 immediately</strong> — no response, no error. Silent
                process death with no diagnostic, which surfaces to the caller only as &quot;agent exited
                while waiting for a response&quot;.
              </p>
            </div>
            <CodeBlock
              filename="correct shape"
              code={`{
  "method": "session/prompt",
  "params": {
    "sessionId": "...",
    "prompt": [ { "type": "text", "text": "..." } ]
  }
}`}
            />

            <DocSubheading>Correction 2 — session/cancel is a notification</DocSubheading>
            <div className="prose-aibou">
              <p>
                It is not a request, and the agent never replies to it directly. Awaiting a response hangs
                forever. Confirmation arrives as the pending <code>session/prompt</code> response with{' '}
                <code>stopReason: &quot;cancelled&quot;</code>. Relatedly, session updates arrive as{' '}
                <code>session/update</code>, not the documented <code>session/notification</code> — the
                Bridge accepts both so it does not break if that changes.
              </p>
            </div>

            <DocSubheading>The permission request is minimal</DocSubheading>
            <div className="prose-aibou">
              <p>
                This is the finding that shaped the most code. <code>toolCall</code> in a real{' '}
                <code>session/request_permission</code> contains <strong>only</strong>{' '}
                <code>toolCallId</code> and <code>title</code> — no <code>kind</code>, no{' '}
                <code>rawInput</code>. The command lives in the earlier <code>tool_call</code> notification
                sharing the same id.
              </p>
            </div>
            <CodeBlock
              filename="observed frames"
              code={`// earlier notification — has everything
{
  "method": "session/update",
  "params": { "sessionId": "e152157f-…", "update": {
    "sessionUpdate": "tool_call",
    "toolCallId": "tooluse_KzQPRMhH6QYtQdcV74o66m",
    "title": "Running: node --version",
    "kind": "execute",
    "rawInput": { "command": "node --version" },
    "_meta": { "kiro": { "toolName": "shell" } }
  } }
}

// the blocking request — has almost nothing
{
  "jsonrpc": "2.0",
  "id": "5aa73b0d-…",
  "method": "session/request_permission",
  "params": {
    "sessionId": "e152157f-…",
    "toolCall": {
      "toolCallId": "tooluse_KzQPRMhH6QYtQdcV74o66m",
      "title": "Running: node --version"
    },
    "options": [
      { "optionId": "allow_once",   "name": "Yes",    "kind": "allow_once"   },
      { "optionId": "allow_always", "name": "Always", "kind": "allow_always" },
      { "optionId": "reject_once",  "name": "No",     "kind": "reject_once"  }
    ]
  }
}`}
            />
            <div className="prose-aibou">
              <p>
                Three consequences: the Bridge keeps a tool-call registry so the policy engine has a real
                command to match and clients display real input instead of <code>undefined</code>;{' '}
                <code>_meta.kiro.toolName</code> is the real tool identifier that rules should match on,
                with the ACP <code>kind</code> as fallback; and option ids are snake_case, so they must be
                resolved via the semantic <code>kind</code> field rather than assumed.
              </p>
            </div>

            <DocSubheading>Observed session updates</DocSubheading>
            <DataTable
              head={['sessionUpdate', 'Meaning', 'Normalised to']}
              rows={[
                [<code key="a">agent_message_chunk</code>, 'Streaming assistant text, with an optional messageId', <code key="a2">agent.text</code>],
                [<code key="b">agent_thought_chunk</code>, 'Streaming reasoning text', <code key="b2">agent.thought</code>],
                [<code key="c">tool_call</code>, 'New tool invocation with kind, rawInput and _meta', <code key="c2">tool.start</code>],
                [<code key="d">tool_call_update</code>, 'Status or content update for an existing toolCallId', <code key="d2">tool.end</code>],
                [<code key="e">plan</code>, 'Task list entries', <code key="e2">task.update</code>],
                [<code key="f">usage_update</code>, 'Real token usage: used, size, optional cost', <code key="f2">usage</code>],
                [<code key="g">_kiro.dev/*</code>, 'Kiro-specific extensions, safely ignorable', <code key="g2">unknown</code>],
              ]}
              caption="Text arrives in very small chunks — a one-sentence reply was split across more than 30 agent_message_chunk frames."
            />

            <Callout title="Hooks were investigated and rejected — twice" tone="amber">
              <p>
                <strong>CLI hooks.</strong> A <code>preToolUse</code> hook does fire in an ordinary{' '}
                <code>kiro-cli chat</code> session, receives real detail on stdin, and the CLI blocks
                while it runs — a 9-second stall produced a 14-second turn, so a hook could wait on a
                watch tap. But on kiro-cli 2.18.1 a hook <strong>cannot deny a tool</strong>: any non-zero
                exit is reported as exit code 1 and the tool runs anyway. Verified with both{' '}
                <code>exit 1</code> and <code>exit 2</code>.
              </p>
              <p>
                <strong>IDE hooks.</strong> These genuinely do gate the call — but the IDE gives the hook a
                stdin that is never closed, so the idiomatic{' '}
                <code>for await (const chunk of process.stdin)</code> never returns. Combined with{' '}
                <code>&quot;timeout&quot;: 0</code> this produced an unkillable hook: a 35-minute hang
                where every editor command blocked and no approval was ever raised. The fail-open path and
                its AbortController were both correct and both unreachable. The tool name and command are
                only available on that stdin, so the hook was removed rather than shipped showing
                &quot;some tool&quot;.
              </p>
            </Callout>

            <DocSubheading>What kiro-cli actually asks about</DocSubheading>
            <div className="prose-aibou">
              <p>
                Shell commands always request permission. File reads never do — the agent self-approves
                them, so they never reach the policy engine. The engine can only govern what the agent
                chooses to ask about. That is a property of the agent, not a limitation of the rules, and
                it is stated plainly rather than glossed.
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Honesty */}
          <DocSection
            id="honesty"
            eyebrow="15 — Engineering notes"
            title="The honesty rule"
            lede="Never render a number the Bridge did not receive from a real ACP message. Where state is inferred, label it inferred and document the heuristic. Treated as a correctness constraint, not a style guide."
          >
            <DocSubheading>Four rules</DocSubheading>
            <div className="prose-aibou">
              <ul>
                <li>
                  <strong>No synthesised values.</strong> If token usage is not available, the UI shows{' '}
                  <code>—</code> and an explanation. It does not show a plausible-looking number.
                </li>
                <li>
                  <strong>Absent features stay absent.</strong> Credits and billing consumption are not
                  exposed by ACP, so there is no credits display. The feature table says so in a row of
                  its own.
                </li>
                <li>
                  <strong>Inference is labelled.</strong> Any status with{' '}
                  <code>statusSource: &quot;inferred&quot;</code> renders with an <code>inferred</code>{' '}
                  marker in both clients, and its failure modes are written down.
                </li>
                <li>
                  <strong>Mock mode is unmissable.</strong> Permitted and encouraged as a test harness,
                  but never mistakable for a real session.
                </li>
              </ul>
            </div>

            <DocSubheading>Mock mode: five simultaneous signals</DocSubheading>
            <DataTable
              head={['Surface', 'Signal']}
              rows={[
                ['Bridge terminal', 'Prints 🟡 MOCK MODE (not a real Kiro session) in the startup banner'],
                ['Wire protocol', 'Every hello frame carries mode: "mock"'],
                ['PWA', 'A sticky amber bar reading ⚠️ MOCK MODE — not a real Kiro session. No dismiss control exists anywhere in the component'],
                ['Wear OS', 'A mock badge on the status screen'],
                ['Account state', 'Forced to mock; sign-in returns "Sign-in does not apply in mock mode"'],
              ]}
              caption="The banner is not optional and must not be suppressible."
            />

            <DocSubheading>The one inferred status</DocSubheading>
            <div className="prose-aibou">
              <p>
                When a turn ends with <code>stopReason: &quot;end_turn&quot;</code>, the session is marked{' '}
                <code>awaiting_input</code> if <strong>both</strong> hold: no <code>tool_call</code> was
                seen during the turn, and the accumulated agent text ends with <code>?</code> ignoring
                trailing whitespace. Otherwise the session is <code>idle</code>.
              </p>
              <p>
                Why it is a guess: ACP does not distinguish &quot;I finished&quot; from &quot;I finished and
                I am waiting for you to answer something&quot;. The agent simply ends its turn. The trailing
                question mark is the only available signal.
              </p>
            </div>

            <DataTable
              head={['Failure mode', 'Effect', 'Why it is acceptable']}
              rows={[
                ['Rhetorical question at end of turn', 'False positive', 'Labelled inferred; sending a prompt is never blocked by status'],
                ['Question not at the very end', 'False negative', 'Status is advisory only'],
                ['Non-English text where questions do not end with ?', 'False negative', 'Same as above'],
                ['Question asked mid-turn, then tools run', 'False negative', 'Correct — the agent kept working'],
                ['Ends with a question and ran tools', 'False negative by design', 'Tool activity is stronger evidence the agent was working, not asking'],
              ]}
            />

            <DocSubheading>What is deliberately not inferred</DocSubheading>
            <div className="prose-aibou">
              <ul>
                <li>
                  <strong>Token and cost usage.</strong> Emitted only when the agent sends{' '}
                  <code>usage_update</code>. With none, clients render <code>—</code>.
                </li>
                <li>
                  <strong>Progress percentages.</strong> ACP exposes a task list via the{' '}
                  <code>plan</code> update but no overall progress figure, so none is shown.
                </li>
                <li>
                  <strong>Time remaining.</strong> Not derivable. Clients show elapsed time in the current
                  status, computed from real timestamps.
                </li>
              </ul>
            </div>

            <Callout title="The rule deleted working code" tone="violet">
              <p>
                Both hook-based approval paths were removed rather than shipped. Rendering Approve and Deny
                for an event whose outcome you cannot control would be a control that controls nothing.
                Even the Wear manifest applies the rule: the <code>connectedDevice</code> foreground
                service type was rejected because it demands a permission the app does not use, and
                declaring an unused permission to satisfy a type check would be dishonest.
              </p>
            </Callout>
          </DocSection>

          {/* ─────────────────────────────────── Testing */}
          <DocSection
            id="testing"
            eyebrow="16 — Engineering notes"
            title="Testing and verification"
            lede="Vitest for TypeScript with colocated tests, integration suites against a live Bridge, and adb-driven device suites that press real pixels on a real emulator rather than simulating a client."
          >
            <DocSubheading>Unit and type checks</DocSubheading>
            <CodeBlock
              shell
              filename="bash"
              code={`pnpm -r typecheck                    # every package
pnpm --filter @aibou/bridge test     # policy engine, example config, session manager,
                                     # auth, ring buffer, ACP normaliser, tool-call correlation
pnpm run check                       # typecheck + lint + test`}
            />
            <div className="prose-aibou">
              <p>
                Testing conventions are enforced by steering: the policy engine must carry at least 20
                positive and 10 negative dangerous-command cases (30 and 12 shipped), the ring buffer must
                prove replay with no gaps and no duplicates, auth must cover constant-time comparison, rate
                limiting and token generation, and normalisation must cover the unknown fallback.
              </p>
            </div>

            <DocSubheading>Integration suites</DocSubheading>
            <CodeBlock
              shell
              filename="bash"
              code={`# terminal 1
pnpm run demo

# terminal 2 — replace <code> with the six-digit code, it changes every start
node scripts/module-test.mjs <code>     # 67 assertions: every module + integration
node scripts/pwa-flow-test.mjs <code>   # 20 assertions: exact PWA frame sequence

# timing-dependent behaviour, against a freshly started Bridge
node packages/bridge/dist/index.js --mock --approval-timeout 6000 --max-sessions 3
node scripts/runtime-test.mjs <code> 6000   # 16 assertions, ~60s — it waits out real timers

# drive a real Kiro session and read the frames
node packages/bridge/dist/index.js --trace
node scripts/live-probe.mjs <code> "Run the shell command 'node --version'."`}
            />

            <DocSubheading>Reported status</DocSubheading>
            <DataTable
              head={['Check', 'Result']}
              rows={[
                ['Build', '4 / 4 packages'],
                ['Typecheck', '4 / 4 packages'],
                ['Unit tests', '235 / 235'],
                ['Module + integration', '68 / 68'],
                ['PWA frame contract', '20 / 20'],
                ['Wear OS build', 'debug + release'],
                ['Wear OS lint', '0 errors'],
                ['Wear OS on-device suites', '9 / 9'],
              ]}
              caption="Device suites run on a Wear OS 6 emulator (Wear_OS_Small_Round, API 36, 384×384) against the real agent, covering pairing through the keypad, the Keystore token round-trip across a cold boot, haptics, screen wake, auto-navigation to an approval, both decisions, the notification path with the app off screen, and reconnect."
            />
          </DocSection>

          {/* ─────────────────────────────────── Impact */}
          <DocSection
            id="impact"
            eyebrow="17 — Project"
            title="Impact and use cases"
            lede="The value is measured in wall-clock recovered per agent run, and in the class of mistake the policy engine makes structurally impossible."
          >
            <DocSubheading>Who this is for</DocSubheading>
            <DataTable
              head={['Use case', 'What changes']}
              rows={[
                [
                  'Long refactors on your own machine',
                  'You start a multi-step task, walk away, and answer its three shell approvals from the kitchen instead of discovering it stalled forty minutes ago.',
                ],
                [
                  'Test-and-fix loops',
                  'An allow rule for the test command removes the most frequent interruption entirely, while writes outside the project still stop you.',
                ],
                [
                  'Working with secrets in the tree',
                  'Any path matching the secret patterns escalates regardless of which tool touches it, so an agent cannot quietly read a .env because the tool looked harmless.',
                ],
                [
                  'Pair-debugging away from the desk',
                  'The event stream and task list are readable on a phone, so you can follow reasoning and tool output without a laptop.',
                ],
                [
                  'Reviewing an unfamiliar agent',
                  'Paranoid mode escalates everything, turning Aibou into a step-debugger for agent behaviour.',
                ],
                [
                  'Teams with shared conventions',
                  'A policy file is a reviewable artifact. What the agent may do unattended becomes a diff in version control rather than a habit.',
                ],
              ]}
            />

            <DocSubheading>Where this generalises</DocSubheading>
            <div className="prose-aibou">
              <p>
                Nothing about the Bridge is Kiro-specific below the two ACP adapter files. Aibou speaks
                Agent Client Protocol v1, an open specification from Zed Industries that several agents
                implement. The policy engine, the approval invariants, the AWP frame contract, the replay
                buffer and both clients are agent-agnostic. Swapping in a different ACP agent is a change
                to <code>acp/methods.ts</code> and <code>acp/normalize.ts</code>, not to the product.
              </p>
              <p>
                The broader argument the project makes is that <strong>a permission prompt is a routing
                problem, not a UI problem</strong>. Agents will keep asking; the question is whether the
                request reaches a human who can answer it, and whether the requests that should never have
                been asked get filtered before they interrupt anyone.
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Roadmap */}
          <DocSection
            id="roadmap"
            eyebrow="18 — Project"
            title="Roadmap and future work"
            lede="Ordered by how much of the design already exists. Everything here is unbuilt — it is listed as intent, not as capability."
          >
            <DataTable
              head={['Item', 'Why it is next', 'State']}
              rows={[
                [
                  'Honour permission.respond.remember',
                  'The frame already accepts it and the agent already advertises allow_always. Turning a one-off approval into a persisted rule is the natural next step.',
                  'Accepted by the schema, not yet acted on',
                ],
                [
                  'Generate a policy rule from an approval',
                  'Real permission requests carry _meta.trustOptions with ready-made command patterns. "Always allow node *" could write a rule straight from the approval card.',
                  'Field is documented but unused',
                ],
                [
                  'Audit endpoint',
                  'Every resolution already emits permission.resolved, so the trail exists in memory. Exposing it as a queryable endpoint was the first item cut for time.',
                  'Cut, design intact',
                ],
                [
                  'Signal ring-buffer gaps',
                  'oldestSeq already exists. A client asking for a sequence older than the buffer should be told events were dropped rather than silently receiving fewer.',
                  'Known gap',
                ],
                [
                  'Policy editing UI',
                  'Editing rules currently means editing JSON on the host machine. A reviewed, in-app editor would need care not to become a policy-bypass surface.',
                  'Cut',
                ],
                [
                  'Physical-hardware verification',
                  'The watch app is verified on an emulator. Real haptics, a real ambient display and Wi-Fi roaming behave differently.',
                  'Open',
                ],
                [
                  'More watch geometries',
                  'The layout no longer assumes a fixed screen, but only 384×384 small round is covered by the suites.',
                  'Open',
                ],
              ]}
            />
          </DocSection>

          {/* ─────────────────────────────────── Limitations */}
          <DocSection
            id="limitations"
            eyebrow="19 — Project"
            title="Known limitations"
            lede="Stated plainly, because a limitation you can read is cheaper than one you discover."
          >
            <div className="prose-aibou">
              <ul>
                <li>
                  <strong>The Wear OS app is verified on an emulator, not physical hardware.</strong> Every
                  device suite runs against a Wear OS 6 AVD.
                </li>
                <li>
                  <strong>Only one watch geometry is tested</strong> — 384×384 small round. Others should
                  work but are not covered.
                </li>
                <li>
                  <strong>No TLS.</strong> Loopback by default; LAN binding requires an explicit flag and
                  prints a warning. Use Tailscale or a VPN for remote access.
                </li>
                <li>
                  <strong>No background push.</strong> PWA notifications require the tab to be open, and the
                  watch app must be running. There is no server-initiated push.
                </li>
                <li>
                  <strong>Reads bypass the policy engine,</strong> because kiro-cli self-approves them and
                  never sends a permission request.
                </li>
                <li>
                  <strong>Credits and billing are not shown.</strong> Not exposed by ACP, and not faked.
                </li>
                <li>
                  <strong>The watch needs Wi-Fi.</strong> Standalone by design — no Bluetooth relay through a
                  phone, so it must be on the same network as the Bridge.
                </li>
                <li>
                  <strong><code>awaiting_input</code> is a heuristic</strong> and can produce false positives
                  on rhetorical questions. Always labelled inferred.
                </li>
                <li>
                  <strong>Single-session flow.</strong> Four concurrent sessions are supported and the PWA
                  lists them, but the UI is tuned for one at a time.
                </li>
                <li>
                  <strong><code>session/new</code> is slow</strong> — around 3.4 seconds against the real
                  agent. Expected, not a hang.
                </li>
                <li>
                  <strong>Ring-buffer overflow is silent.</strong> A client reconnecting after a long absence
                  receives only the retained events, with no gap signalled.
                </li>
              </ul>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Built with Kiro */}
          <DocSection
            id="built-with-kiro"
            eyebrow="20 — Project"
            title="Built with Kiro"
            lede="Aibou was specced and built in Kiro, using Kiro's own hooks and ACP surfaces, to build a tool that observes Kiro. The .kiro/ directory is committed, not gitignored."
          >
            <DataTable
              head={['Artifact', 'What it did']}
              rows={[
                [
                  <code key="a">.kiro/specs/aibou/</code>,
                  'requirements.md, design.md and tasks.md drove the build. Scope was fixed before implementation started, which is why the phase boundaries map one-to-one onto the commit history.',
                ],
                [
                  <code key="b">.kiro/steering/conventions.md</code>,
                  'Strict TypeScript, zod-parse every inbound frame, never as-cast, confine ACP knowledge to two adapter files, fail-closed policy, and the honesty rule — applied on every turn.',
                ],
                [
                  <code key="c">.kiro/steering/testing.md</code>,
                  'Colocated Vitest files and the ≥20 positive / ≥10 negative dangerous-command requirement. The shipped suite has 30 and 12.',
                ],
                [
                  <code key="d">.kiro/hooks/on-save-verify.json</code>,
                  'Ran the typecheck on every TypeScript save, so type breakage surfaced immediately rather than at commit time.',
                ],
              ]}
            />

            <div className="prose-aibou">
              <p>
                The steering rules are visible in the result: no production file outside{' '}
                <code>acp/</code> mentions an ACP method name, and the policy suite carries the mandated
                case counts. The judgement that mattered most, though, came from driving the real agent and
                reading raw frames rather than reading documentation — three defects were found that way,
                and compiling the Wear app surfaced five more, including a missing{' '}
                <code>&lt;queries&gt;</code> declaration that would have permanently hidden voice input on
                Android 11+.
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Contributing */}
          <DocSection
            id="contributing"
            eyebrow="21 — Project"
            title="Contributing"
            lede="The conventions are short, enforced by steering, and worth reading before the first pull request."
          >
            <DocSubheading>Code style</DocSubheading>
            <div className="prose-aibou">
              <ul>
                <li>TypeScript in strict mode. No <code>any</code> outside ACP boundary adapters.</li>
                <li>
                  Every inbound frame is zod-parsed. Never use <code>as</code> type assertions.
                </li>
                <li>
                  Errors use the typed <code>AibouError</code> with codes from the protocol package.
                </li>
                <li>One export per file for components. Colocate tests as <code>*.test.ts</code>.</li>
                <li>
                  <code>acp/methods.ts</code> and <code>acp/normalize.ts</code> are the only files that may
                  know ACP&apos;s shape.
                </li>
                <li>
                  <code>packages/protocol</code> is the single source of truth for wire types.
                </li>
                <li>No database. Config is JSON files; events are in-memory ring buffers.</li>
                <li>Never log tokens or tool input at info level.</li>
              </ul>
            </div>

            <DocSubheading>Before opening a pull request</DocSubheading>
            <CodeBlock
              shell
              filename="bash"
              code={`pnpm run check       # typecheck + lint + test
make verify-node     # same, via the Makefile — no emulator required`}
            />
            <div className="prose-aibou">
              <p>
                If a change touches the approval path, the policy engine, or the wire protocol, add tests
                alongside it and run the integration suites against a live Bridge in mock mode. If it
                touches the watch, run <code>./gradlew :app:lintDebug</code> — zero errors is the
                expectation, not the goal.
              </p>
            </div>
          </DocSection>

          {/* ─────────────────────────────────── Attribution */}
          <DocSection
            id="attribution"
            eyebrow="22 — Project"
            title="Attribution, costs and licence"
            lede="Aibou is free, has no paid dependencies, no hosted backend, and makes no third-party API calls. Everything runs on your own machine."
          >
            <DocSubheading>Costs and accounts</DocSubheading>
            <DataTable
              head={['Path', 'Account needed', 'Cost']}
              rows={[
                [<code key="a">pnpm run demo</code>, 'None — bundled fake ACP agent', 'Free'],
                ['Live mode', 'A signed-in Kiro CLI', 'Uses your own Kiro plan'],
              ]}
              caption="There are no Aibou accounts and no logins. Authentication is a six-digit pairing code printed by the Bridge on startup, different every run, so no static credential can be published. Aibou adds no calls of its own — it forwards exactly what you type. There is no telemetry, no analytics and no crash reporting."
            />

            <DocSubheading>Dependencies</DocSubheading>
            <DataTable
              head={['Component', 'Libraries', 'Licence']}
              rows={[
                [
                  'Bridge',
                  'Fastify with @fastify/websocket and @fastify/static, zod, ws, nanoid',
                  'MIT',
                ],
                ['Bridge', 'qrcode-terminal', 'Apache-2.0'],
                ['PWA', 'React, React DOM, Vite, Tailwind CSS, PostCSS, Autoprefixer', 'MIT'],
                [
                  'Wear OS',
                  'Compose for Wear OS, Jetpack Compose, OkHttp, kotlinx.serialization, kotlinx.coroutines',
                  'Apache-2.0',
                ],
                ['Toolchain', 'TypeScript, Vitest, tsx, pnpm', 'MIT'],
                ['Toolchain', 'Gradle, Android Gradle Plugin, Kotlin', 'Apache-2.0'],
                ['Toolchain', 'OpenJDK 17', 'GPL-2.0-with-classpath-exception'],
              ]}
            />

            <DocSubheading>Protocols</DocSubheading>
            <DataTable
              head={['Specification', 'Owner', 'Use']}
              rows={[
                [
                  <a key="a" href="https://agentclientprotocol.com/" target="_blank" rel="noreferrer">
                    Agent Client Protocol v1
                  </a>,
                  'Zed Industries',
                  'The protocol Aibou speaks to kiro-cli acp. Documented behaviour verified against the real agent.',
                ],
                ['Kiro CLI ACP surface', 'AWS / Kiro', 'Host process. Not bundled or redistributed.'],
                ['AWP', 'This project', 'The Bridge ↔ client protocol. Original to Aibou.'],
              ]}
            />

            <div className="prose-aibou">
              <p>
                No datasets, fonts, images, audio or trademarked assets are bundled with the application.
                Icons are Unicode emoji. Token encryption on the watch uses the platform Android Keystore.
                Kiro and AWS are trademarks of Amazon.com, Inc. — referenced only to describe
                interoperability; this project is unaffiliated.
              </p>
            </div>

            <DocSubheading>Team</DocSubheading>
            <DataTable
              head={['Member', 'Area', 'Contribution']}
              rows={[
                [
                  'Jithindranaath',
                  'Bridge & protocol',
                  'Concept and product decisions, specs and steering. Defined the AWP frame contract as the single source of truth, then built the Bridge on it: the ACP client that spawns and drives real kiro-cli, ACP→AWP normalisation, the per-session ring buffer with replay-since, the approval manager that holds a permission request open until a human answers, the fail-closed policy engine, constant-time token auth with per-IP rate limiting, and the unit suite.',
                ],
                [
                  'Sri Dakshith Nimmagadda',
                  'Clients & device verification',
                  'The Wear OS app in Kotlin and Compose — two-step pairing keypad, status screen, risk-tiered haptics, and token storage encrypted with an AES-256-GCM key in the Android Keystore. The React PWA, including approval cards, the live event stream and the unsuppressible mock-mode banner. Drove on-device verification, including the adb-driven suites that assert an approval genuinely renders on the watch and that a real tap decides it.',
                ],
              ]}
            />

            <Callout title="Licence" tone="emerald">
              <p>
                MIT. Use it, fork it, ship it. If you extend the policy engine or add another ACP agent
                adapter, the conventions above will keep the result reviewable.
              </p>
            </Callout>
          </DocSection>

          {/* ── Docs footer CTA ─────────────────────────────────────────── */}
          <Reveal className="mt-16">
            <div className="glass relative overflow-hidden rounded-3xl px-8 py-10 text-center">
              <div
                aria-hidden
                className="orb orb-violet animate-float-slow left-[10%] top-[-40%] h-[220px] w-[220px] opacity-30"
              />
              <div className="relative">
                <h2 className="font-display text-3xl leading-tight text-white sm:text-4xl">
                  That is the whole system
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-[14px] leading-relaxed text-neutral-400">
                  One daemon holding a JSON-RPC request open, a policy that fails closed, and a wrist that
                  answers in under three seconds.
                </p>
                <Link
                  href="/"
                  className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[12px] font-semibold text-black transition-transform duration-300 hover:scale-[1.04]"
                >
                  Back to the overview
                </Link>
              </div>
            </div>
          </Reveal>

        </main>
      </div>

      <Footer />
    </>
  );
}
