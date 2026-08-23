import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-instrument-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Aibou — Remote control for your local Kiro agent session',
  description:
    'When your AI coding agent stalls waiting for permission, Aibou sends the approval to your phone or watch. One tap, and the agent continues. Local-first, policy-gated, fail-closed.',
  keywords: [
    'Aibou',
    'Kiro',
    'Agent Client Protocol',
    'ACP',
    'Wear OS',
    'agent approvals',
    'policy engine',
    'local-first',
    'AI coding agent',
  ],
  authors: [{ name: 'Jithindranaath' }, { name: 'Sri Dakshith Nimmagadda' }],
  openGraph: {
    title: 'Aibou — Remote control for your local Kiro agent session',
    description:
      'Approve your agent from your wrist. A local Bridge that hosts a Kiro ACP session, gates every permission through a fail-closed policy engine, and streams escalations to a phone or watch.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Aibou — Remote control for your local Kiro agent session',
    description: 'Approve your agent from your wrist. Local-first, policy-gated, fail-closed.',
  },
};

export const viewport: Viewport = {
  themeColor: '#030303',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body className="bg-base font-sans antialiased">{children}</body>
    </html>
  );
}
