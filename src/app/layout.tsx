import type { Metadata, Viewport } from 'next';
import { Orbitron, JetBrains_Mono } from 'next/font/google';
import './globals.css';

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

export const metadata: Metadata = {
  title: 'TitanX AI — Predictive Fleet Command Intelligence',
  description:
    'Predictive fleet command intelligence. Live UPSRTC GPS and schedule integration with a predictive operations copilot.',
};

export const viewport: Viewport = {
  themeColor: '#02040a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="bg-void font-display text-[#d6ecf7] antialiased">
        <a
          href="#command-main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-holo-glow focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:text-void"
        >
          Skip to command centre
        </a>
        {children}
      </body>
    </html>
  );
}
