'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { OlympussWordmark } from '@/components/shared/OlympussWordmark';

const NAV = [
  { label: 'Vision', target: 'ascent' },
  { label: 'Exploration', target: 'exploration' },
  { label: 'Intelligence', target: 'intelligence' },
] as const;

/**
 * Fixed landing header (Section 21). Transparent and spacious at the top;
 * condenses to a thin translucent glass bar once scrolled. In-page links use
 * smooth scroll to the corresponding section; Project Login is a real route.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'ol-glass border-b border-[var(--ol-border)] py-3'
          : 'border-b border-transparent py-5'
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="group flex items-center gap-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ol-gold"
          aria-label="Olympuss AI — home"
        >
          <Image
            src="/brand/olympuss-emblem.webp"
            alt=""
            width={40}
            height={40}
            priority
            className={`transition-all duration-500 ${scrolled ? 'h-7 w-7' : 'h-9 w-9'}`}
          />
          <OlympussWordmark className={`transition-all duration-500 ${scrolled ? 'text-lg' : 'text-xl'}`} />
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Primary">
          <div className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <button
                key={item.target}
                type="button"
                onClick={() => scrollTo(item.target)}
                className="rounded px-3 py-2 font-sans text-[12px] uppercase tracking-[0.16em] text-ol-text-secondary transition-colors hover:text-ol-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ol-gold"
              >
                {item.label}
              </button>
            ))}
          </div>
          <Link
            href="/login"
            className="rounded border border-ol-gold/45 px-3.5 py-2 font-sans text-[12px] uppercase tracking-[0.16em] text-ol-gold-light transition-all hover:border-ol-gold hover:bg-ol-gold/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ol-gold"
            style={{ boxShadow: 'inset 0 0 18px -10px rgba(214,161,58,0.7)' }}
          >
            Project Login
          </Link>
        </nav>
      </div>
    </header>
  );
}
