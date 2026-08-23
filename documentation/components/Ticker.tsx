interface TickerProps {
  items: string[];
  fast?: boolean;
}

/** Infinite horizontal ticker. Items are duplicated once so the loop is seamless. */
export function Ticker({ items, fast = false }: TickerProps) {
  const doubled = [...items, ...items];

  return (
    <div className={`ticker-mask relative w-full overflow-hidden ${fast ? 'ticker-fast' : ''}`}>
      <div className="ticker-track">
        {doubled.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="flex shrink-0 items-center gap-8 whitespace-nowrap px-8 text-[11px] uppercase tracking-[0.2em] text-neutral-500"
            aria-hidden={i >= items.length}
          >
            {item}
            <span className="h-1 w-1 shrink-0 rounded-full bg-violet-glow/60" />
          </span>
        ))}
      </div>
    </div>
  );
}
