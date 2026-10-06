import { exampleQuestions } from '@/lib/depot/copilot/ui/copilotView';

export interface ExampleQuestionsProps {
  /** The chosen depot's name, or null for the whole network. */
  readonly depotName: string | null;
  readonly onPick: (question: string) => void;
}

/** A vertical list of text rows that fill the question box; they never submit. */
export function ExampleQuestions({ depotName, onPick }: ExampleQuestionsProps) {
  return (
    <ul className="flex min-w-0 flex-col" aria-label="Example questions">
      {exampleQuestions(depotName).map((example) => (
        <li key={example} className="min-w-0 border-b border-depot-line last:border-b-0">
          <button
            type="button"
            onClick={() => onPick(example)}
            className="w-full min-w-0 py-1.5 text-left font-sans text-[13px] text-depot-muted hover:text-holo-glow focus-visible:text-holo-glow"
          >
            {example}
          </button>
        </li>
      ))}
    </ul>
  );
}
