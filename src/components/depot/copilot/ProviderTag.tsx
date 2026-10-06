import { noticeSentence, providerTagText } from '@/lib/depot/copilot/ui/copilotView';
import type { CopilotPublicNotice, CopilotPublicProvider } from '@/lib/depot/copilot/wire';

export interface ProviderTagProps {
  readonly provider: CopilotPublicProvider;
  readonly notice: CopilotPublicNotice;
}

/** Who wrote the text, as words; the reason for a fallback follows when there is one. */
export function ProviderTag({ provider, notice }: ProviderTagProps) {
  const sentence = noticeSentence(notice);
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-testid="copilot-provider">
      <span data-provider={provider} className="depot-tag border-depot-muted/50 text-depot-muted">
        {providerTagText(provider)}
      </span>
      {sentence ? <span className="depot-prose">{sentence}</span> : null}
    </p>
  );
}
