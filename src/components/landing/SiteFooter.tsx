import Link from 'next/link';
import Image from 'next/image';
import { OlympussWordmark } from '@/components/shared/OlympussWordmark';

/**
 * Restrained closing footer (Section 27). No fake address, social, legal,
 * team, or investor claims — a calm conclusion, not another large section.
 */
export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-[var(--ol-border)] bg-ol-bg/80 px-6 py-14">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Image src="/brand/olympuss-emblem.webp" alt="" width={36} height={36} className="h-9 w-9" />
          <OlympussWordmark className="text-xl" />
        </div>

        <ul className="space-y-1.5 font-sans text-sm text-ol-text-secondary">
          <li>Artificial Intelligence</li>
          <li>Intelligent Systems</li>
          <li>Innovation</li>
        </ul>

        <div className="flex flex-col items-start gap-3 sm:items-end">
          <Link
            href="/login"
            className="font-sans text-sm uppercase tracking-[0.16em] text-ol-gold-light transition-colors hover:text-ol-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ol-gold"
          >
            Project Login
          </Link>
          <p className="font-sans text-xs text-ol-muted">© 2026 Olympuss AI</p>
        </div>
      </div>
    </footer>
  );
}
