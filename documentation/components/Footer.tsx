import Link from 'next/link';
import { Orbs } from './Orbs';

const COLUMNS = [
  {
    title: 'Documentation',
    links: [
      { href: '/docs#quick-start', label: 'Quick start' },
      { href: '/docs#architecture', label: 'Architecture' },
      { href: '/docs#protocol', label: 'AWP protocol' },
      { href: '/docs#policy-engine', label: 'Policy engine' },
      { href: '/docs#configuration', label: 'Configuration' },
    ],
  },
  {
    title: 'Engineering',
    links: [
      { href: '/docs#acp', label: 'ACP integration' },
      { href: '/docs#approvals', label: 'Approval lifecycle' },
      { href: '/docs#security', label: 'Security model' },
      { href: '/docs#honesty', label: 'The honesty rule' },
      { href: '/docs#testing', label: 'Testing' },
    ],
  },
  {
    title: 'Project',
    links: [
      { href: '/docs#problem', label: 'Problem statement' },
      { href: '/docs#novelty', label: 'Novelty & prior art' },
      { href: '/docs#roadmap', label: 'Roadmap' },
      { href: '/docs#limitations', label: 'Known limitations' },
      { href: '/docs#attribution', label: 'Attribution' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-white/[0.07] pt-20">
      <Orbs variant="footer" />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid gap-12 pb-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="absolute inset-0 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#06B6D4]" />
                <span className="absolute inset-0 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#06B6D4] opacity-70 blur-[8px]" />
              </span>
              <span className="font-display text-2xl leading-none text-white">Aibou</span>
            </div>
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-neutral-500">
              Remote control for your locally running Kiro agent session. Your machine, your files,
              your toolchain — approved from your wrist.
            </p>
            <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-600">
              MIT licensed · No telemetry · No hosted backend
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="label mb-4">{col.title}</h3>
              <ul className="flex flex-col gap-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-[13px] text-neutral-400 transition-colors hover:text-white"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-start justify-between gap-4 border-t border-white/[0.06] py-8 sm:flex-row sm:items-center">
          <p className="text-[12px] text-neutral-600">
            Built with Kiro, for Kiro. Kiro and AWS are trademarks of Amazon.com, Inc. — referenced
            only to describe interoperability. This project is unaffiliated.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-600">
            ⛩️ Aibou v1.0.0
          </p>
        </div>
      </div>
    </footer>
  );
}
