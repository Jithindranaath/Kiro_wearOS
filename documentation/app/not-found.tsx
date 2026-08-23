import Link from 'next/link';
import { Orbs } from '@/components/Orbs';

export default function NotFound() {
  return (
    <main className="relative flex min-h-[100svh] items-center justify-center overflow-hidden px-6">
      <Orbs variant="hero" />
      <div className="relative text-center">
        <p className="label mb-5">404</p>
        <h1 className="font-display text-5xl leading-[0.95] tracking-tightest text-white sm:text-6xl">
          Nothing is waiting
          <br />
          on <span className="shimmer">this page</span>
        </h1>
        <p className="mx-auto mt-6 max-w-md text-[14px] leading-relaxed text-neutral-400">
          The route does not exist. The overview and the documentation both do.
        </p>
        <div className="mt-9 flex items-center justify-center gap-5">
          <Link
            href="/"
            className="rounded-full bg-white px-5 py-2.5 text-[12px] font-semibold text-black transition-transform duration-300 hover:scale-[1.04]"
          >
            Overview
          </Link>
          <Link
            href="/docs"
            className="text-[13px] text-neutral-400 transition-colors hover:text-white"
          >
            Documentation →
          </Link>
        </div>
      </div>
    </main>
  );
}
