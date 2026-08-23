# Aibou — landing page and documentation site

The public site for [Aibou](../README.md): a marketing landing page at `/` and the full
open-source documentation at `/docs`.

This is a standalone Next.js app. It is **deliberately outside the pnpm workspace**
(`pnpm-workspace.yaml` only globs `packages/*`), so it has its own lockfile and cannot
affect the Bridge, the PWA, the protocol package or the watch app.

## Stack

| Piece | Choice |
|---|---|
| Framework | Next.js 14 App Router, fully static (both routes prerender) |
| Styling | Tailwind CSS 3.4 + hand-written CSS for glows, tickers and the shimmer gradient |
| Fonts | `Instrument Serif` for display, `Inter` for UI, via `next/font/google` |
| Package manager | npm — isolated from the repo's pnpm workspace |

## Local development

```bash
cd documentation
npm install
npm run dev        # http://localhost:3000
```

```bash
npm run build      # production build; also runs the type check
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
```

## Deploying to Vercel

Zero config beyond pointing Vercel at this subdirectory.

1. Import the repository in Vercel.
2. Set **Root Directory** to `documentation`.
3. Framework preset: **Next.js** (auto-detected). Build command `npm run build`,
   output handled by the Next.js adapter.
4. Deploy. Both routes are static, so there is nothing to configure at runtime —
   no environment variables, no secrets, no server dependencies.

## Structure

```
documentation/
├── app/
│   ├── layout.tsx        fonts, metadata, viewport
│   ├── globals.css       design tokens, glass, orbs, shimmer, tickers, prose
│   ├── page.tsx          landing page
│   └── docs/page.tsx     the documentation, 22 sections
├── components/           one export per file
│   ├── Nav.tsx           floating glass pill
│   ├── Hero.tsx          hero with shimmer heading
│   ├── Orbs.tsx          floating background blurs
│   ├── Reveal.tsx        IntersectionObserver staggered entrance
│   ├── ShinyButton.tsx   animated conic border CTA
│   ├── Ticker.tsx        infinite marquee
│   ├── CodeBlock.tsx     copy-to-clipboard code surface
│   ├── DataTable.tsx     reference tables
│   ├── DocSection.tsx    docs section wrapper
│   ├── DocSubheading.tsx docs h3
│   ├── Callout.tsx       toned aside
│   ├── DocsSidebar.tsx   sticky sidebar with scroll-spy
│   ├── SectionHeading.tsx landing section header
│   └── Footer.tsx
└── content/docsNav.ts    single source of truth for the sidebar and scroll-spy
```

Adding a docs section means adding an entry to `content/docsNav.ts` and a
`<DocSection id="…">` with the matching id. The sidebar and the scroll-spy pick it up
automatically.

## Design notes

Vantablack base (`#030303`) with layered transparency and glowing blurs. Violet
`#8B5CF6` and cyan `#06B6D4` accents, emerald `#10B981` for status. Glass surfaces are
`rgba(10,10,10,0.7)` with a 16px backdrop blur and a 1px white/10 hairline. Motion is
central — floating orbs, an infinite ticker, and staggered entrances in 0.2s increments.
All of it collapses under `prefers-reduced-motion: reduce`.

## Content accuracy

Every claim on both pages traces back to something in this repository: `README.md`,
`context.md`, `SECURITY.md`, `docs/acp-findings.md`, `docs/status-inference.md`,
`examples/policy.example.json`, or the source itself. Measured latencies, test counts,
error codes, CLI flags and frame names are quoted as they exist, not rounded up. If a
capability does not ship, the site says so — the same honesty rule the application
follows.

## Licence

MIT, same as the project.
