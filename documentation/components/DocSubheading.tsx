export function DocSubheading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-4 flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.16em] text-neutral-200">
      <span aria-hidden className="h-px w-6 bg-gradient-to-r from-violet-glow to-transparent" />
      {children}
    </h3>
  );
}
