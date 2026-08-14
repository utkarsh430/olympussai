import type { Metadata, Viewport } from 'next';
import { fontVariables } from './fonts';
import { themeInitScript } from '@/lib/theme/theme';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import './globals.css';

const SITE_URL = process.env.SITE_URL ?? 'https://olympuss.us';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Olympuss AI — Intelligence, Elevated',
    template: '%s · Olympuss AI',
  },
  description:
    'Olympuss AI is an AI-focused technology space exploring intelligent systems, real-time intelligence, adaptive automation, and human–AI interaction.',
  applicationName: 'Olympuss AI',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Olympuss AI',
    title: 'Olympuss AI — Intelligence, Elevated',
    description:
      'A digital laboratory exploring artificial intelligence, adaptive systems, and the ideas shaping the next era of technology.',
    url: SITE_URL,
    images: [
      {
        url: '/brand/olympuss-og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'Olympuss AI',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Olympuss AI — Intelligence, Elevated',
    description:
      'A digital laboratory exploring intelligent systems, real-time intelligence, adaptive automation, and human–AI interaction.',
    images: ['/brand/olympuss-og-image.jpg'],
  },
};

export const viewport: Viewport = {
  // One entry per scheme, so the browser chrome around the page matches the
  // theme instead of staying near-black behind a light console.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#02040a' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` is required and is scoped to this one
    // element: the inline script below deliberately mutates <html>'s class and
    // style before React hydrates, so the server-rendered markup and the
    // client's first read of it differ BY DESIGN. Without this, React logs a
    // mismatch on every load. It suppresses the warning for <html>'s own
    // attributes only — nothing inside the tree is affected.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/*
          Applies the theme BEFORE first paint.

          A theme applied by React runs after hydration, which is after the
          browser has already painted — so a dark-mode operator would see a
          white flash on every navigation. Setting the class synchronously in
          <head> is the only way to avoid it, and that means inline script.

          SAFETY: the script body is composed entirely of literals from
          src/lib/theme/theme.ts. No request data, no user input and no
          props reach it, so there is nothing here to escape.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
