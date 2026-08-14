'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { OlympussWordmark } from '@/components/shared/OlympussWordmark';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Button } from '@/components/ui/button';

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
        scrolled ? 'ol-glass border-b border-border py-3' : 'border-b border-transparent py-5'
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="group flex items-center gap-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
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
          <OlympussWordmark
            className={`transition-all duration-500 ${scrolled ? 'text-lg' : 'text-xl'}`}
          />
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Primary">
          <div className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <button
                key={item.target}
                type="button"
                onClick={() => scrollTo(item.target)}
                className="rounded px-3 py-2 text-[12px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {item.label}
              </button>
            ))}
          </div>
          {/*
            The theme control lives on the FRONT DOOR, not only inside the
            console. Whoever opens this page is the same person who will read
            a dashboard behind it, the preference is one durable choice for the
            whole product, and a visitor who cannot stand a dark page has no
            way to say so if the only switch is on the other side of a sign-in.
            Hidden below `sm` purely for width — the phone gets it back in the
            footer, where there is room for it to keep its labels.
          */}
          <ThemeToggle className="mr-1 hidden sm:inline-flex" />
          <Button asChild variant="brandOutline" size="sm" className="tracking-[0.16em]">
            <Link href="/login">Project Login</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
