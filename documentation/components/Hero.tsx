import Link from 'next/link';
import { Orbs } from './Orbs';
import { ShinyButton } from './ShinyButton';

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-center justify-center overflow-hidden px-6 pb-24 pt-40">
      <Orbs variant="hero" />
      <div aria-hidden className="grid-lines absolute inset-0" />

      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <div className="rise d-1 glass mb-8 inline-flex items-center gap-2.5 rounded-full px-4 py-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-pulse-soft rounded-full bg-emerald-glow" />
            <span className="absolute inset-0 rounded-full bg-emerald-glow blur-[4px]" />
          </span>
          <span className="text-[11px] uppercase tracking-[0.2em] text-neutral-400">
            Local session · ACP v1 · Wear OS
          </span>
        </div>

        <h1 className="rise d-2 font-display text-6xl leading-[0.9] tracking-tightest text-white sm:text-7xl md:text-8xl lg:text-[8.5rem]">
          Approve your agent
          <br />
          from your <span className="shimmer">wrist</span>
        </h1>

        <p className="rise d-3 mt-8 max-w-2xl text-base font-light leading-relaxed text-neutral-400 sm:text-lg">
          When your AI coding agent stalls waiting for permission, Aibou sends the approval request
          to your phone or watch. One tap, and the agent continues. You never went back to your desk.
        </p>

        <div className="rise d-5 mt-10 flex flex-col items-center gap-5 sm:flex-row sm:gap-7">
          <ShinyButton href="/docs#quick-start">Read the docs</ShinyButton>
          <Link
            href="#how"
            className="group inline-flex items-center gap-2 text-[13px] text-neutral-400 transition-colors hover:text-white"
          >
            See how it works
            <span
              aria-hidden
              className="transition-transform duration-300 group-hover:translate-y-0.5"
            >
              ↓
            </span>
          </Link>
        </div>

        <div className="rise d-6 mt-16 grid w-full max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03]">
          {[
            { value: '<300ms', label: 'Tap to ACP answer' },
            { value: '6 rules', label: 'Fail-closed defaults' },
            { value: '0', label: 'Cloud dependencies' },
          ].map((stat) => (
            <div key={stat.label} className="bg-base/60 px-4 py-5">
              <p className="font-display text-2xl leading-none text-white sm:text-3xl">
                {stat.value}
              </p>
              <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
