'use client';

import { useId, useState } from 'react';

/**
 * Project authentication form (Section 15).
 *
 * - Explicit labels, PIN masked, numeric input mode, non-numeric stripped.
 * - Enter submits; button disabled while processing.
 * - Status announced via aria-live; error linked with aria-describedby.
 * - No credential hints, no prefilled values, generic error only.
 */
export function LoginForm({ next }: { next: string }) {
  const [projectName, setProjectName] = useState('');
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const errorId = useId();
  const statusId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName, pin }),
      });

      if (response.ok) {
        // Full navigation so the server re-renders the now-authorized route.
        window.location.assign(next);
        return;
      }

      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? 'Invalid project name or PIN.');
      setStatus('error');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full max-w-sm">
      <div className="space-y-5">
        <div>
          <label
            htmlFor="projectName"
            className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-[#a3a7b2]"
          >
            Project name
          </label>
          <input
            id="projectName"
            name="projectName"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Enter project name"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={status === 'error' || undefined}
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-4 py-3 text-[#f2eee7] placeholder:text-[#707580] transition-colors focus:border-[#d6a13a]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d6a13a]/40"
          />
        </div>

        <div>
          <label
            htmlFor="pin"
            className="mb-2 block font-mono text-[11px] uppercase tracking-[0.18em] text-[#a3a7b2]"
          >
            Project PIN
          </label>
          <input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            required
            value={pin}
            // Strip any non-numeric character so only digits are entered.
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Enter PIN"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={status === 'error' || undefined}
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-4 py-3 tracking-[0.3em] text-[#f2eee7] placeholder:tracking-normal placeholder:text-[#707580] transition-colors focus:border-[#d6a13a]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d6a13a]/40"
          />
        </div>

        {error && (
          <p id={errorId} role="alert" className="text-sm text-[#f0857d]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-md border border-[#d6a13a]/60 bg-[#d6a13a]/12 px-6 py-3.5 font-mono text-[13px] uppercase tracking-[0.2em] text-[#f3c86a] transition-all hover:bg-[#d6a13a]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6a13a] disabled:cursor-not-allowed disabled:opacity-60"
          style={{ boxShadow: '0 0 30px -12px rgba(214,161,58,0.6)' }}
        >
          {submitting ? 'Authorizing…' : 'Enter Project'}
        </button>

        {/* Screen-reader status region. */}
        <p id={statusId} aria-live="polite" className="sr-only">
          {submitting ? 'Authorizing, please wait.' : status === 'error' ? 'Authentication failed.' : ''}
        </p>
      </div>
    </form>
  );
}
