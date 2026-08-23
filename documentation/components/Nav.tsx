'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '/#problem', label: 'Problem' },
  { href: '/#how', label: 'How it works' },
  { href: '/#policy', label: 'Policy' },
  { href: '/docs', label: 'Docs' },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="fixed left-1/2 top-6 z-50 w-[95%] max-w-[672px] -translate-x-1/2">
      <nav
        className={`glass flex items-center justify-between rounded-full px-3 py-2 transition-shadow duration-500 ${
          scrolled ? 'shadow-[0_8px_40px_-24px_rgba(139,92,246,0.9)]' : ''
        }`}
        aria-label="Primary"
      >
        <Link
          href="/"
          className="group flex items-center gap-2 pl-2 pr-1"
          aria-label="Aibou home"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inset-0 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#06B6D4]" />
            <span className="absolute inset-0 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#06B6D4] opacity-70 blur-[6px] transition-opacity group-hover:opacity-100" />
          </span>
          <span className="font-display text-[17px] leading-none text-white">Aibou</span>
        </Link>

        <ul className="hidden items-center gap-6 sm:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="text-[12px] uppercase tracking-[0.14em] text-neutral-400 transition-colors hover:text-white"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-white sm:hidden"
            aria-expanded={open}
            aria-label="Toggle navigation"
          >
            <span className="flex flex-col gap-[3px]">
              <span className="block h-[1.5px] w-4 bg-current" />
              <span className="block h-[1.5px] w-4 bg-current" />
            </span>
          </button>
          <Link
            href="/docs#quick-start"
            className="rounded-full bg-white px-4 py-2 text-[12px] font-semibold text-black transition-transform duration-300 hover:scale-[1.04] active:scale-95"
          >
            Get started
          </Link>
        </div>
      </nav>

      {open && (
        <ul className="glass mt-2 flex flex-col gap-1 rounded-3xl p-3 sm:hidden">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                onClick={() => setOpen(false)}
                className="block rounded-2xl px-4 py-2.5 text-[12px] uppercase tracking-[0.14em] text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}
