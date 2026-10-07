import { suggestedQuestionGroups } from '@/lib/depot/copilot/ui/copilotView';

export interface ExampleQuestionsProps {
  /** The chosen depot's name, or null for the whole network. */
  readonly depotName: string | null;
  readonly onPick: (question: string) => void;
}

const INDEX_DIGITS = 2;

/**
 * The suggested questions in their groups, numbered through as instrument rows: a press
 * fills the question box and never submits, so a person reads what will be asked first.
 */
export function ExampleQuestions({ depotName, onPick }: ExampleQuestionsProps) {
  const groups = suggestedQuestionGroups(depotName);
  const firstIndexOf = groups.map((_, i) =>
    groups.slice(0, i).reduce((count, group) => count + group.questions.length, 0),
  );
  return (
    <ul className="flex min-w-0 flex-col gap-4" aria-label="Example questions">
      {groups.map((group, g) => (
        <li key={group.label} className="min-w-0">
          <h3 className="depot-eyebrow mb-1 px-3">{group.label}</h3>
          <ul className="flex min-w-0 flex-col gap-0.5">
            {group.questions.map((question, q) => (
              <li key={question} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onPick(question)}
                  className="group flex w-full min-w-0 items-start gap-3 rounded-[3px] border border-transparent px-3 py-2 text-left transition-colors duration-150 hover:border-depot-line hover:bg-depot-raised focus-visible:border-holo-glow/60 focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className="shrink-0 pt-px font-mono text-[11px] leading-4 text-depot-muted group-hover:text-holo-glow"
                  >
                    {String((firstIndexOf[g] ?? 0) + q + 1).padStart(INDEX_DIGITS, '0')}
                  </span>
                  <span className="min-w-0 flex-1 font-sans text-[13px] leading-5 text-depot-prose group-hover:text-depot-ink">
                    {question}
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 font-mono text-[13px] leading-5 text-depot-muted group-hover:text-holo-glow"
                  >
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
