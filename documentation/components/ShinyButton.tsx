import Link from 'next/link';

interface ShinyButtonProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}

/** Primary CTA with an animated conic 'shiny border'. */
export function ShinyButton({ href, children, className = '' }: ShinyButtonProps) {
  return (
    <Link
      href={href}
      className={`shiny group relative inline-flex items-center gap-2 rounded-full bg-neutral-950 px-7 py-3.5 text-[13px] font-semibold text-white transition-transform duration-300 hover:scale-[1.03] active:scale-[0.98] ${className}`}
    >
      <span className="relative z-10">{children}</span>
      <span
        aria-hidden
        className="relative z-10 translate-x-0 text-neutral-400 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-white"
      >
        →
      </span>
      <span
        aria-hidden
        className="absolute inset-0 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ boxShadow: '0 0 40px -12px #8b5cf6' }}
      />
    </Link>
  );
}
