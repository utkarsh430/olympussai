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
        setError(
          (data && 'error' in data && data.error.message) || 'Could not answer that question.',
        );
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
    <div className="space-y-4 rounded-md border border-border p-4">
      <h2 className="ops-label">Ask the copilot</h2>

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
          className="ops-input"
        />

        {error && (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={status === 'loading' || question.trim().length < 3}
          className="ops-button-primary px-5 py-2"
        >
          {status === 'loading' ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {answer && (
        <div aria-live="polite" className="ops-well p-3">
          <p className="whitespace-pre-wrap text-sm text-foreground">{answer}</p>
          {citations.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {citations.map((citation) => (
                <span
                  key={`${citation.recordType}-${citation.recordId}`}
                  title={citation.summary}
                  className="rounded border border-input px-1.5 py-0.5 font-mono text-[9px] text-subtle"
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
