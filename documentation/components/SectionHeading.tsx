import { Reveal } from './Reveal';

interface SectionHeadingProps {
  label: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  align?: 'left' | 'center';
}

export function SectionHeading({ label, title, lede, align = 'left' }: SectionHeadingProps) {
  const centered = align === 'center';
  return (
    <Reveal className={centered ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <p className={`label mb-4 ${centered ? 'justify-center' : ''}`}>{label}</p>
      <h2 className="font-display text-4xl leading-[0.95] tracking-tightest text-white sm:text-5xl md:text-6xl">
        {title}
      </h2>
      {lede && (
        <p className="mt-5 text-[15px] font-light leading-relaxed text-neutral-400 sm:text-base">
          {lede}
        </p>
      )}
    </Reveal>
  );
}
