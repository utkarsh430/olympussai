import type { Metadata, Viewport } from 'next';
import { Orbitron, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/**
 * Dashboard typography. Exposed as CSS variables on <html> and consumed only by
 * the protected UPSRTC shell (`font-display` / `font-mono`). The public
 * Olympuss landing page loads its own editorial + interface fonts in a later
 * phase; keeping both families as variables lets each route group opt in
 * without a global default font fighting the other.
 */
const display = Orbitron({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['300', '400', '500', '600'],
  display: 'swap',
});

const SITE_URL = process.env.SITE_URL ?? 'https://olympuss.us';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Olympuss AI — Intelligence, Elevated',
    template: '%s · Olympuss AI',
  },
  description:
    'Olympuss AI is an AI-focused technology space exploring intelligent systems, real-time intelligence, adaptive automation, and human–AI interaction.',
};

export const viewport: Viewport = {
  themeColor: '#050507',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
