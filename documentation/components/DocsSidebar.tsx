'use client';

import { useEffect, useState } from 'react';
import { DOCS_NAV, DOCS_SECTION_IDS } from '@/content/docsNav';

export function DocsSidebar() {
  const [active, setActive] = useState<string>(DOCS_SECTION_IDS[0]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    );

    for (const id of DOCS_SECTION_IDS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <nav
      aria-label="Documentation sections"
      className="sticky top-32 hidden max-h-[calc(100vh-10rem)] w-56 shrink-0 overflow-y-auto pb-16 lg:block"
    >
      <div className="flex flex-col gap-7">
        {DOCS_NAV.map((group) => (
          <div key={group.title}>
            <p className="label mb-3">{group.title}</p>
            <ul className="flex flex-col gap-0.5 border-l border-white/[0.08]">
              {group.items.map((item) => {
                const isActive = active === item.id;
                return (
                  <li key={item.id} className="relative">
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute -left-px top-1 h-[calc(100%-0.5rem)] w-[2px] rounded-full bg-gradient-to-b from-violet-glow to-cyan-glow"
                        style={{ boxShadow: '0 0 12px -2px #8b5cf6' }}
                      />
                    )}
                    <a
                      href={`#${item.id}`}
                      aria-current={isActive ? 'true' : undefined}
                      className={`block py-1.5 pl-4 text-[13px] transition-colors ${
                        isActive
                          ? 'text-white'
                          : 'text-neutral-500 hover:text-neutral-200'
                      }`}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
