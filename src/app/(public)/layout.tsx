import { Manrope, Cormorant_Garamond } from 'next/font/google';
import './olympuss.css';

/**
 * Public (landing + login) layout.
 *
 * Loads the Olympuss editorial fonts and applies the `.ol-scope` design-token
 * wrapper. Because the fonts and tokens live here — not in the root layout —
 * the protected UPSRTC dashboard never downloads them and never inherits the
 * landing palette (Section 37 style isolation).
 *
 * Deliberately no marketing header/footer here: the landing page composes those
 * itself, while /login stays a focused, chrome-free surface.
 */
const sans = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

const serifDisplay = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-serif-display',
  weight: ['300', '400', '500', '600'],
  display: 'swap',
});

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${sans.variable} ${serifDisplay.variable} ol-scope font-sans`}>
      {children}
    </div>
  );
}
