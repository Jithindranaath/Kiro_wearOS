import { Reveal } from './Reveal';

const STEPS = [
  {
    n: '01',
    title: 'The agent asks',
    body: 'kiro-cli sends session/request_permission over ACP. It is a JSON-RPC request, so the agent blocks until it is answered. That block is the whole opportunity.',
    accent: 'from-violet-glow/60',
  },
  {
    n: '02',
    title: 'The Bridge enriches',
    body: 'Real permission requests carry only a toolCallId and a title. A tool-call registry replays the earlier tool_call notification to recover the actual command and input.',
    accent: 'from-violet-glow/60',
  },
  {
    n: '03',
    title: 'Policy decides',
    body: 'Rules evaluate the real command. Deny wins over allow, always. Anything unmatched escalates to a human — the engine never auto-approves by omission.',
    accent: 'from-cyan-glow/60',
  },
  {
    n: '04',
    title: 'Your wrist buzzes',
    body: 'Escalations broadcast as an AWP permission.request frame. The watch wakes, vibrates by risk tier, and renders a summary capped at 80 characters.',
    accent: 'from-cyan-glow/60',
  },
  {
    n: '05',
    title: 'One tap answers',
    body: 'A 48dp chip resolves the held ACP request. Exactly one answer is ever sent; a second tap gets AIBOU_ALREADY_RESOLVED. The agent continues immediately.',
    accent: 'from-emerald-glow/60',
  },
];

export function FlowDiagram() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute left-[15px] top-4 hidden h-[calc(100%-3rem)] w-px bg-gradient-to-b from-violet-glow/50 via-cyan-glow/40 to-emerald-glow/40 sm:block"
      />
      <ol className="flex flex-col gap-8">
        {STEPS.map((step, i) => (
          <Reveal as="li" key={step.n} delay={i} className="relative sm:pl-14">
            <span
              aria-hidden
              className={`absolute left-0 top-1 hidden h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-base font-mono text-[10px] text-neutral-400 sm:flex`}
            >
              {step.n}
            </span>
            <div className="glass-soft card-hover rounded-2xl px-5 py-5">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[10px] tracking-[0.2em] text-neutral-600 sm:hidden">
                  {step.n}
                </span>
                <h3 className="font-display text-xl text-white sm:text-2xl">{step.title}</h3>
              </div>
              <p className="mt-2.5 text-[14px] leading-relaxed text-neutral-400">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}
