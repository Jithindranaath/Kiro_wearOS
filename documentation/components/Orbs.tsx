/**
 * Floating background orbs — violet / cyan / emerald blurs on the vantablack base.
 * Purely decorative, so hidden from assistive tech.
 */
export function Orbs({ variant = 'hero' }: { variant?: 'hero' | 'section' | 'footer' }) {
  if (variant === 'hero') {
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 55% at 50% -10%, rgba(139,92,246,0.4), transparent 70%), radial-gradient(ellipse 45% 55% at -5% 45%, rgba(6,182,212,0.08), transparent 70%)',
          }}
        />
        <div className="orb orb-violet animate-float left-[8%] top-[18%] h-[280px] w-[280px] opacity-40" />
        <div className="orb orb-cyan animate-float-slow right-[6%] top-[38%] h-[340px] w-[340px] opacity-30" />
        <div className="orb orb-emerald animate-float-fast bottom-[6%] left-[42%] h-[180px] w-[180px] opacity-25" />
      </div>
    );
  }

  if (variant === 'footer') {
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 60% 80% at 50% 120%, rgba(139,92,246,0.25), transparent 70%)',
          }}
        />
        <div className="orb orb-cyan animate-float-slow left-[20%] top-[40%] h-[240px] w-[240px] opacity-20" />
      </div>
    );
  }

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="orb orb-violet animate-float-slow right-[-6%] top-[10%] h-[320px] w-[320px] opacity-20" />
      <div className="orb orb-cyan animate-float left-[-8%] bottom-[8%] h-[280px] w-[280px] opacity-[0.14]" />
    </div>
  );
}
