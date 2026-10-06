'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestCopilot,
  type CopilotFailureKind,
} from '@/lib/depot/copilot/ui/copilotClient';
import type { CopilotApiRequest, CopilotApiResponse } from '@/lib/depot/copilot/wire';
import { redirectToSignIn } from '@/lib/depot/signInRedirect';

const COUNTDOWN_STEP_MS = 1000;

export type CopilotState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'done'; readonly response: CopilotApiResponse }
  | {
      readonly status: 'failed';
      readonly kind: CopilotFailureKind;
      /** Present only for `rate_limited`: whole seconds left before a request is accepted. */
      readonly secondsRemaining?: number;
    };

export interface CopilotHook {
  readonly state: CopilotState;
  readonly request: (body: CopilotApiRequest) => void;
  readonly reset: () => void;
}

const IDLE: CopilotState = { status: 'idle' };

function isCoolingDown(state: CopilotState): boolean {
  return (
    state.status === 'failed' &&
    state.kind === 'rate_limited' &&
    (state.secondsRemaining ?? 0) > 0
  );
}

/**
 * One copilot request at a time. Nothing is requested automatically: each text
 * may spend the operator's quota, so the user always asks. A new request aborts
 * the previous one; a response is applied only if its request is still the
 * current one, which also covers fetches that do not reject on abort.
 */
export function useCopilot(): CopilotHook {
  const [state, setState] = useState<CopilotState>(IDLE);
  const stateRef = useRef<CopilotState>(IDLE);
  const controllerRef = useRef<AbortController | null>(null);

  const apply = useCallback((next: CopilotState): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  const abortCurrent = useCallback((): void => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const request = useCallback(
    (body: CopilotApiRequest): void => {
      if (isCoolingDown(stateRef.current)) return;
      abortCurrent();
      const controller = new AbortController();
      controllerRef.current = controller;
      apply({ status: 'loading' });
      void requestCopilot(body, controller.signal).then((result) => {
        if (controllerRef.current !== controller) return;
        controllerRef.current = null;
        if (result.ok) {
          apply({ status: 'done', response: result.response });
        } else if (result.kind === 'rate_limited') {
          apply({
            status: 'failed',
            kind: 'rate_limited',
            secondsRemaining: result.retryAfterSeconds,
          });
        } else {
          apply({ status: 'failed', kind: result.kind });
          // The session has ended: send the user to sign in, back to this page after.
          if (result.kind === 'session_expired') redirectToSignIn();
        }
      });
    },
    [abortCurrent, apply],
  );

  const reset = useCallback((): void => {
    abortCurrent();
    apply(IDLE);
  }, [abortCurrent, apply]);

  const secondsRemaining =
    state.status === 'failed' && state.kind === 'rate_limited' ? state.secondsRemaining : undefined;
  useEffect(() => {
    if (secondsRemaining === undefined) return;
    const timer = setTimeout(() => {
      apply(
        secondsRemaining <= 1
          ? IDLE
          : { status: 'failed', kind: 'rate_limited', secondsRemaining: secondsRemaining - 1 },
      );
    }, COUNTDOWN_STEP_MS);
    return () => clearTimeout(timer);
  }, [secondsRemaining, apply]);

  useEffect(() => abortCurrent, [abortCurrent]);

  return { state, request, reset };
}
