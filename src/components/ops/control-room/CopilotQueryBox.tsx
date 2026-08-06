'use client';

import { useId, useState } from 'react';
import type { CopilotSourceCitation } from '@/models/copilot';

/**
 * NL query box: asks a question, gets back an answer grounded in currently-
 * open incidents + recent ops audit/breakdown records, with the citation
 * list the server attached to the response (ticket AC "NL query answers
 * cite source records").
 */
export function CopilotQueryBox({ routeDirectionId }: { routeDirectionId: string | null }) {
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<CopilotSourceCitation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const errorId = useId();

  async function handleAsk(event: React.FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setError(null);
    setAnswer(null);

    try {
      const response = await fetch('/api/ops/control-room/copilot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, ...(routeDirectionId ? { routeDirectionId } : {}) }),
      });
      const data = (await response.json().catch(() => null)) as
        | { answer: string; citations: CopilotSourceCitation[] }
        | { error: { message: string } }
        | null;

      if (!response.ok || !data || 'error' in data) {
        setError((data && 'error' in data && data.error.message) || 'Could not answer that question.');
        setStatus('error');
        return;
      }

      setAnswer(data.answer);
      setCitations(data.citations);
      setStatus('ready');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-[rgba(255,255,255,0.08)] p-4">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">Ask the copilot</h2>

      <form onSubmit={handleAsk} className="space-y-3">
        <label htmlFor="copilotQuestion" className="sr-only">
          Question
        </label>
        <textarea
          id="copilotQuestion"
          required
          minLength={3}
          maxLength={1000}
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Why is route 12 up currently flagged as bunched?"
          aria-describedby={error ? errorId : undefined}
          className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
        />

        {error && (
          <p id={errorId} role="alert" className="text-sm text-[#f0857d]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={status === 'loading' || question.trim().length < 3}
          className="rounded-md border border-[#4f8cff]/60 bg-[#4f8cff]/12 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8fb4ff] transition-all hover:bg-[#4f8cff]/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'loading' ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {answer && (
        <div aria-live="polite" className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] p-3">
          <p className="whitespace-pre-wrap text-sm text-[#e6e9ef]">{answer}</p>
          {citations.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {citations.map((citation) => (
                <span
                  key={`${citation.recordType}-${citation.recordId}`}
                  title={citation.summary}
                  className="rounded border border-[rgba(255,255,255,0.12)] px-1.5 py-0.5 font-mono text-[9px] text-[#6f7684]"
                >
                  {citation.recordType}:{citation.recordId.slice(0, 8)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
