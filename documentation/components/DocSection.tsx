import { Reveal } from './Reveal';

interface DocSectionProps {
  id: string;
  /** Small uppercase eyebrow, e.g. "02 — Architecture". */
  eyebrow?: string;
  title: string;
  /** One-line framing sentence under the title. */
  lede?: string;
  children: React.ReactNode;
}

export function DocSection({ id, eyebrow, title, lede, children }: DocSectionProps) {
  return (
    <section id={id} className="scroll-mt-32 border-t border-white/[0.06] py-16 first:border-t-0">
      <Reveal>
        {eyebrow && <p className="label mb-3">{eyebrow}</p>}
        <h2 className="font-display text-3xl leading-[1.05] tracking-tighter2 text-white sm:text-[2.6rem]">
          {title}
        </h2>
        {lede && (
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-neutral-400">{lede}</p>
        )}
      </Reveal>
      <div className="mt-8 flex flex-col gap-6">{children}</div>
    </section>
  );
}
