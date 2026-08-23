type Tone = 'violet' | 'cyan' | 'amber' | 'emerald';

const TONES: Record<Tone, { border: string; bg: string; dot: string; label: string }> = {
  violet: {
    border: 'border-violet-glow/25',
    bg: 'bg-violet-glow/[0.06]',
    dot: 'bg-violet-glow',
    label: 'text-violet-300',
  },
  cyan: {
    border: 'border-cyan-glow/25',
    bg: 'bg-cyan-glow/[0.06]',
    dot: 'bg-cyan-glow',
    label: 'text-cyan-300',
  },
  amber: {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/[0.07]',
    dot: 'bg-amber-400',
    label: 'text-amber-300',
  },
  emerald: {
    border: 'border-emerald-glow/25',
    bg: 'bg-emerald-glow/[0.06]',
    dot: 'bg-emerald-glow',
    label: 'text-emerald-300',
  },
};

interface CalloutProps {
  title: string;
  tone?: Tone;
  children: React.ReactNode;
}

export function Callout({ title, tone = 'violet', children }: CalloutProps) {
  const t = TONES[tone];
  return (
    <aside className={`rounded-2xl border ${t.border} ${t.bg} px-5 py-4`}>
      <p
        className={`mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] ${t.label}`}
      >
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
        {title}
      </p>
      <div className="prose-aibou">{children}</div>
    </aside>
  );
}
