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
          {/*
            The /ops/* console is no longer a separate surface with its own
            credentials — /login is now the single front door for both, and it
            routes each operator to their own dashboard by role. So this points
            at /login too.

            It is kept as a SIGNPOST rather than removed. This link exists
            because operators could not find the console at all: they scanned
            the footer for the word "Operations", did not see it, followed
            "Project Login" instead and concluded their credentials were wrong.
            That word is the entire value of the link, and it is worth just as
            much now that the two doors share a destination. Quieter than
            Project Login on purpose — wayfinding for staff, not a second call
            to action.
          */}
          <Link
            href="/login"
            className="font-sans text-xs uppercase tracking-[0.16em] text-ol-text-secondary transition-colors hover:text-ol-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ol-gold"
          >
            Operations Sign-In
          </Link>
          <p className="font-sans text-xs text-ol-muted">© 2026 Olympuss AI</p>
        </div>
      </div>
    </footer>
  );
}
