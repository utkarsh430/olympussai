import { exampleQuestions } from '@/lib/depot/copilot/ui/copilotView';

export interface ExampleQuestionsProps {
  /** The chosen depot's name, or null for the whole network. */
  readonly depotName: string | null;
  readonly onPick: (question: string) => void;
}

/** Buttons that fill the question box; they never submit. */
export function ExampleQuestions({ depotName, onPick }: ExampleQuestionsProps) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Example questions">
      {exampleQuestions(depotName).map((example) => (
        <li key={example} className="min-w-0">
          <button
            type="button"
            onClick={() => onPick(example)}
            className="hud-button max-w-full whitespace-normal text-left normal-case tracking-normal"
          >
            {example}
          </button>
        </li>
      ))}
    </ul>
  );
}
