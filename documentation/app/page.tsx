import Link from 'next/link';
import { Callout } from '@/components/Callout';
import { CodeBlock } from '@/components/CodeBlock';
import { DataTable } from '@/components/DataTable';
import { FlowDiagram } from '@/components/FlowDiagram';
import { Footer } from '@/components/Footer';
import { Hero } from '@/components/Hero';
import { Nav } from '@/components/Nav';
import { Orbs } from '@/components/Orbs';
import { Reveal } from '@/components/Reveal';
import { SectionHeading } from '@/components/SectionHeading';
import { ShinyButton } from '@/components/ShinyButton';
import { Ticker } from '@/components/Ticker';

const TICKER_ITEMS = [
  'Agent Client Protocol v1',
  'Fail-closed policy engine',
  'Deny beats allow',
  'Constant-time token compare',
  '127.0.0.1 by default',
  'Held JSON-RPC requests',
  'Ring-buffer replay',
  'Observed vs inferred status',
  'No telemetry',
  'MIT licensed',
];

const FEATURES = [
  {
    title: 'Permission interception',
    body: 'The Bridge is the ACP client, which means it owns the permission flow. Attaching to a terminal would give observation without control.',
    source: 'Observed — session/request_permission',
  },
  {
    title: 'Configurable policy',
    body: 'Rules are data, not code. Match on tool name, ACP kind, path glob, path regex, command regex, or inside/outside the project directory.',
    source: '6 shipped defaults, 27 dangerous patterns',
  },
  {
    title: 'Live event stream',
    body: 'Every ACP session/update is normalised into a typed AWP event with a monotonic sequence number, buffered for replay after a dropped connection.',
    source: 'Observed — session/update',
  },
  {
    title: 'Real usage, or nothing',
    body: 'Token and context figures are forwarded verbatim from usage_update. If the agent sends none, clients render an em dash — never a plausible number.',
    source: 'Observed — usage_update',
  },
  {
    title: 'Standalone Wear OS app',
    body: 'Direct WebSocket from the watch, no phone companion. Risk-tiered haptics, screen wake, 48dp targets, and a foreground service so a frozen process cannot lose an approval.',
    source: 'Kotlin + Compose for Wear OS',
  },
  {
    title: 'Mock mode for reviewers',
    body: 'A bundled fake ACP agent exercises the whole stack with no Kiro credentials. The amber banner it triggers has no dismiss control anywhere in the codebase.',
    source: 'pnpm run demo',
  },
];

const CLIENTS = [
  {
    kicker: 'Full surface',
    title: 'React PWA',
    body: 'Sessions, live events, task list, prompting and approval cards. Installable to a phone home screen; the service worker caches the app shell and deliberately never touches /api or /ws, so it cannot serve stale session data.',
    points: ['Risk-tiered approval cards', 'Notification API on escalation', 'Reconnect with replay-since'],
  },
  {
    kicker: 'Three seconds',
    title: 'Wear OS watch',
    body: 'Scoped to exactly one job: unblock a stalled agent without scrolling. Two-step pairing keypad, AES-256-GCM token in the Android Keystore, and voice prompting through the on-device recogniser.',
    points: ['Wake + vibrate on escalation', '48dp Approve / Deny chips', 'Works with the app off screen'],
  },
  {
    kicker: 'Terminal',
    title: 'aibou chat',
    body: 'A terminal session the Bridge owns, so its approvals genuinely land on the watch. Hooks can observe an external chat and even stall it, but they cannot decide it — so Aibou does not pretend otherwise.',
    points: ['/interrupt, /status, /close', 'Same signed-in Kiro account', 'Reuses an existing pairing token'],
  },
];

export default function LandingPage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />

        <div className="border-y border-white/[0.06] py-5">
          <Ticker items={TICKER_ITEMS} />
        </div>

        {/* ── Problem ─────────────────────────────────────────────────────── */}
        <section id="problem" className="relative scroll-mt-32 px-6 py-28 sm:py-36">
          <Orbs variant="section" />
          <div className="relative mx-auto max-w-6xl">
            <SectionHeading
              label="The problem"
              title={
                <>
                  A forty-minute task
                  <br />
                  becomes <span className="shimmer">two hours</span>
                </>
              }
              lede="Agent runs are long and bursty. The agent works for several minutes, then stops and waits for you to approve a shell command, answer a question, or supply context. If you have walked away, that wait is unbounded."
            />

            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {[
                {
                  stat: '35 min',
                  label: 'Sitting behind a y/n',
                  body: 'Not spent working. Spent waiting for a human who is in another room.',
                },
                {
                  stat: 'Unbounded',
                  label: 'Wait when you walk away',
                  body: 'Nothing in the agent times out on your behalf. It just sits there, blocked.',
                },
                {
                  stat: 'Cloud only',
                  label: 'What the official app covers',
                  body: 'Kiro for iOS supervises AWS cloud sandbox sessions. It cannot reach your laptop.',
                },
              ].map((item, i) => (
                <Reveal key={item.label} delay={i}>
                  <div className="glass-soft card-hover h-full rounded-3xl p-6">
                    <p className="font-display text-4xl leading-none text-white">{item.stat}</p>
                    <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-neutral-500">
                      {item.label}
                    </p>
                    <p className="mt-4 text-[14px] leading-relaxed text-neutral-400">{item.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={3} className="mt-10">
              <Callout title="Aibou's core job" tone="violet">
                <p>
                  Collapse that dead time to seconds. Everything else — the event stream, the task
                  list, the usage meter — is supporting context around that one job.
                </p>
              </Callout>
            </Reveal>
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────────────────── */}
        <section id="how" className="relative scroll-mt-32 border-t border-white/[0.06] px-6 py-28 sm:py-36">
          <div className="relative mx-auto max-w-6xl">
            <SectionHeading
              label="How it works"
              title={
                <>
                  Five steps from blocked
                  <br />
                  to <span className="shimmer">running</span>
                </>
              }
              lede="The Bridge spawns kiro-cli as an ACP subprocess and becomes its client. That is the whole architectural bet: only the ACP host owns the permission flow."
            />

            <div className="mt-14 grid gap-12 lg:grid-cols-[1.05fr_0.95fr]">
              <FlowDiagram />

              <div className="flex flex-col gap-5">
                <Reveal delay={2}>
                  <CodeBlock
                    filename="system diagram"
                    code={`kiro-cli acp
   │  JSON-RPC 2.0 over stdio
   ▼
Aibou Bridge  (127.0.0.1:8787)
   ├─ AcpClient        spawn, frame, correlate
   ├─ ToolCallRegistry recover the real command
   ├─ PolicyEngine     allow / deny / escalate
   ├─ ApprovalManager  hold the JSON-RPC request
   ├─ SessionManager   status + ring buffer
   └─ Fastify + WsHub  AWP over WebSocket
   │
   ├──► React PWA        (phone / desktop)
   ├──► Wear OS app      (standalone, Wi-Fi)
   └──► aibou chat       (terminal)`}
                  />
                </Reveal>

                <Reveal delay={3}>
                  <CodeBlock
                    filename="observed prompt turn"
                    code={`client → session/prompt (id=N)        stays open all turn
agent  → session/update tool_call     full rawInput + _meta.kiro.toolName
agent  → session/request_permission   minimal toolCall; blocks the agent
client → response to that id          { outcome: { outcome, optionId } }
agent  → session/update tool_call_update
agent  → session/update agent_message_chunk × N
agent  → response to id=N             { stopReason: "end_turn" }`}
                  />
                </Reveal>

                <Reveal delay={4}>
                  <Callout title="There is no turn_end notification" tone="cyan">
                    <p>
                      End of turn is the <code>session/prompt</code> response, carrying a{' '}
                      <code>stopReason</code>. Verified against kiro-cli 2.18.1. Session status is
                      driven from that reason, not from a notification that does not exist.
                    </p>
                  </Callout>
                </Reveal>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────────────── */}
        <section className="relative border-t border-white/[0.06] px-6 py-28 sm:py-36">
          <Orbs variant="section" />
          <div className="relative mx-auto max-w-6xl">
            <SectionHeading
              label="What ships"
              title={
                <>
                  Every row has a
                  <br />
                  data <span className="shimmer">source</span>
                </>
              }
              lede="Nothing in this list is a mock-up. Where a value is observed, the ACP message it came from is named. Where it is inferred, it is labelled inferred in the UI and its failure modes are documented."
              align="center"
            />

            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title} delay={i % 3}>
                  <article className="glass-soft card-hover flex h-full flex-col rounded-3xl p-6">
                    <h3 className="font-display text-2xl leading-tight text-white">{f.title}</h3>
                    <p className="mt-3 flex-1 text-[14px] leading-relaxed text-neutral-400">
                      {f.body}
                    </p>
                    <p className="mt-5 border-t border-white/[0.07] pt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-neutral-600">
                      {f.source}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Policy engine ───────────────────────────────────────────────── */}
        <section id="policy" className="relative scroll-mt-32 border-t border-white/[0.06] px-6 py-28 sm:py-36">
          <div className="relative mx-auto max-w-6xl">
            <SectionHeading
              label="Policy engine"
              title={
                <>
                  It fails <span className="shimmer">closed</span>
                </>
              }
              lede="The one capability the official mobile app does not have. Rules are JSON, evaluated against the real command the agent is about to run — not against the title it advertised."
            />

            <div className="mt-14 grid gap-8 lg:grid-cols-2">
              <Reveal>
                <div className="flex flex-col gap-5">
                  <DataTable
                    head={['Order', 'Condition', 'Outcome']}
                    rows={[
                      ['1', 'Any matching deny rule', 'deny — regardless of rule order'],
                      ['2', 'Any matching escalate rule', 'escalate to a human'],
                      ['3', 'All matching rules allow', 'allow'],
                      ['4', 'Nothing matched', 'escalate — fail closed'],
                    ]}
                    caption="Conditions inside one `when` are ANDed. A rule with an empty `when` is treated as non-matching, so a malformed rule cannot silently allow or deny the whole system."
                  />
                  <Callout title="Degraded means paranoid" tone="amber">
                    <p>
                      An empty, unparseable or schema-invalid <code>policy.json</code> does not fail
                      open and does not exit. The engine switches to paranoid mode, escalates
                      everything, and says so on startup.
                    </p>
                  </Callout>
                </div>
              </Reveal>

              <Reveal delay={1}>
                <CodeBlock
                  filename="~/.aibou/policy.json"
                  code={`{
  "version": 1,
  "rules": [
    {
      "id": "deny-aibou-self-modification",
      "when": { "pathRegex": "[/\\\\\\\\]\\\\.aibou[/\\\\\\\\]" },
      "then": "deny",
      "reason": "The agent must not rewrite Aibou's own configuration."
    },
    {
      "id": "escalate-secrets",
      "when": { "pathRegex": "\\\\.env(\\\\.|$)|\\\\.pem$|id_rsa|credentials" },
      "then": "escalate",
      "reason": "Touches a credential or secret file."
    },
    {
      "id": "allow-test-commands",
      "when": { "commandMatches": "^(npm|pnpm|yarn)\\\\s+(test|run\\\\s+test)\\\\b" },
      "then": "allow",
      "reason": "Running the test suite is routine."
    }
  ]
}`}
                />
              </Reveal>
            </div>

            <Reveal delay={2} className="mt-8">
              <Callout title="One honest caveat" tone="cyan">
                <p>
                  The policy engine can only govern what the agent actually asks about. kiro-cli
                  requests permission for shell commands but self-approves file reads, so reads never
                  reach the engine. That is a property of the agent, not a gap in the rules.
                </p>
              </Callout>
            </Reveal>
          </div>
        </section>

        {/* ── Honesty rule ────────────────────────────────────────────────── */}
        <section className="relative border-t border-white/[0.06] px-6 py-28 sm:py-36">
          <Orbs variant="section" />
          <div className="relative mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center">
              <SectionHeading
                label="The honesty rule"
                title={
                  <>
                    Never render a number
                    <br />
                    the Bridge never <span className="shimmer">received</span>
                  </>
                }
                lede="Treated as a correctness constraint, not a style guide. It killed two features that would have looked good in a demo: CLI-hook approvals, because a hook cannot actually deny a tool, and an IDE hook that could not name what it was about to run."
              />

              <Reveal delay={1}>
                <div className="flex flex-col gap-4">
                  {[
                    {
                      t: 'Absent, not faked',
                      b: 'No usage_update means the client shows an em dash. Credits and billing are not exposed by ACP, so there is no credits display at all.',
                    },
                    {
                      t: 'Inferred is labelled',
                      b: 'Exactly one status is a guess: awaiting_input, from a turn ending with a question mark and no tool call. It ships with an inferred marker and five documented failure modes.',
                    },
                    {
                      t: 'Mock mode is unmissable',
                      b: 'Five simultaneous signals: a terminal banner, mode "mock" on every hello frame, an amber bar with no dismiss control, a watch badge, and a forced mock account state.',
                    },
                    {
                      t: 'Status never gates actions',
                      b: 'Prompting and interrupting stay available in every state, so a wrong inference can never block you.',
                    },
                  ].map((item) => (
                    <div key={item.t} className="glass-soft rounded-2xl px-5 py-4">
                      <p className="text-[13px] font-semibold text-white">{item.t}</p>
                      <p className="mt-1.5 text-[13.5px] leading-relaxed text-neutral-400">
                        {item.b}
                      </p>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Clients ─────────────────────────────────────────────────────── */}
        <section className="relative border-t border-white/[0.06] px-6 py-28 sm:py-36">
          <div className="relative mx-auto max-w-6xl">
            <SectionHeading
              label="Surfaces"
              title={
                <>
                  The Bridge is the product.
                  <br />
                  These are the <span className="shimmer">surfaces</span>
                </>
              }
              align="center"
            />

            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {CLIENTS.map((c, i) => (
                <Reveal key={c.title} delay={i}>
                  <article className="glass-soft card-hover flex h-full flex-col rounded-3xl p-6">
                    <p className="label">{c.kicker}</p>
                    <h3 className="mt-3 font-display text-3xl leading-none text-white">{c.title}</h3>
                    <p className="mt-4 flex-1 text-[14px] leading-relaxed text-neutral-400">
                      {c.body}
                    </p>
                    <ul className="mt-5 flex flex-col gap-2 border-t border-white/[0.07] pt-4">
                      {c.points.map((p) => (
                        <li key={p} className="flex items-start gap-2.5 text-[12.5px] text-neutral-400">
                          <span
                            aria-hidden
                            className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-cyan-glow"
                          />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Comparison ──────────────────────────────────────────────────── */}
        <section className="relative border-t border-white/[0.06] px-6 py-28 sm:py-36">
          <Orbs variant="section" />
          <div className="relative mx-auto max-w-5xl">
            <SectionHeading
              label="Prior art"
              title={
                <>
                  We did not invent mobile
                  <br />
                  agent <span className="shimmer">supervision</span>
                </>
              }
              lede="Kiro for iOS launched on 17 June 2026 and does this for cloud sessions. Aibou extends it to the local session — the one with your local files, your local toolchain, and your uncommitted work — which the official product does not cover."
            />

            <Reveal delay={1} className="mt-12">
              <DataTable
                head={['', 'Kiro for iOS', 'Aibou']}
                rows={[
                  ['Session location', 'AWS cloud sandbox', 'Your laptop'],
                  ['Requires', 'Cloud sandbox', 'Local kiro-cli'],
                  ['Approval surface', 'In-app', 'Phone PWA + Wear OS watch'],
                  ['Policy engine', 'No', 'Yes — configurable rules'],
                  ['Scope', 'Cloud sessions only', 'Local sessions only'],
                ]}
              />
            </Reveal>
          </div>
        </section>

        {/* ── Quick start ─────────────────────────────────────────────────── */}
        <section className="relative border-t border-white/[0.06] px-6 py-28 sm:py-36">
          <div className="relative mx-auto max-w-4xl">
            <SectionHeading
              label="Quick start"
              title={
                <>
                  Four commands,
                  <br />
                  no <span className="shimmer">credentials</span>
                </>
              }
              lede="Mock mode exercises the entire stack — Bridge, policy engine, approval interception, PWA and watch — using a bundled fake ACP agent. No account, no payment, no sign-up."
              align="center"
            />

            <Reveal delay={1} className="mt-12">
              <CodeBlock
                shell
                filename="bash"
                code={`git clone <repo-url> && cd aibou
pnpm install
pnpm --filter @aibou/protocol build
pnpm run demo`}
              />
            </Reveal>

            <Reveal delay={2} className="mt-6">
              <p className="text-center text-[14px] leading-relaxed text-neutral-400">
                Open <code className="font-mono text-cyan-300">http://localhost:8787</code> on your
                phone, on the same Wi-Fi, and enter the six-digit code the Bridge printed. That is
                the whole pairing flow.
              </p>
            </Reveal>

            <Reveal delay={3} className="mt-10 flex justify-center">
              <ShinyButton href="/docs#quick-start">Full setup guide</ShinyButton>
            </Reveal>
          </div>
        </section>

        {/* ── CTA ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-t border-white/[0.06] px-6 py-32">
          <Orbs variant="footer" />
          <div className="relative mx-auto max-w-3xl text-center">
            <Reveal>
              <h2 className="font-display text-5xl leading-[0.92] tracking-tightest text-white sm:text-6xl md:text-7xl">
                Your agent is
                <br />
                waiting on <span className="shimmer">you</span>
              </h2>
              <p className="mx-auto mt-6 max-w-xl text-[15px] font-light leading-relaxed text-neutral-400">
                Read the protocol, the policy semantics, the threat model, and the ACP findings that
                came out of tracing a real agent frame by frame.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-5 sm:flex-row sm:gap-7">
                <ShinyButton href="/docs">Open the documentation</ShinyButton>
                <Link
                  href="/docs#acp"
                  className="text-[13px] text-neutral-400 transition-colors hover:text-white"
                >
                  Read the ACP findings →
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
