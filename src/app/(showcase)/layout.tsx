import type { Metadata, Viewport } from 'next';
import '../(public)/olympuss.css';
import './showcase.css';

/**
 * The trial showcase's ground.
 *
 * Night-only by design: this is a presentation surface, and its instrument
 * language is light added to a dark field. Tailwind's `darkMode: 'class'`
 * resolves against any `.dark` ANCESTOR, so pinning the class on this
 * wrapper re-resolves every token underneath it whatever the visitor's own
 * theme is, without touching <html>. `showcase.css` then re-tunes the accent
 * and the bloom for this subtree alone.
 *
 * The wrapper is also the SCROLL CONTAINER. That is what keeps the scrollbar
 * and the overscroll inside the dark subtree (both would otherwise resolve
 * against the root's light palette), and it is the element present mode
 * snaps between scenes on.
 *
 * Set in the product's own face (Noto Sans, from the root layout); the
 * display typeface an earlier cut loaded here is gone.
 */
export const metadata: Metadata = {
  title: 'Fleet trial',
  description:
    'A thousand buses under the deployed control laws, across nineteen ways a corridor comes apart.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#02040a',
  width: 'device-width',
  initialScale: 1,
};

export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sc-root ol-scope dark h-[100dvh] overflow-y-auto overscroll-none bg-background font-sans text-foreground antialiased">
      {children}
    </div>
  );
}
