'use client';

/** The changes in force for one kind of what-if, each with a Remove button. */
export function ActiveList(props: {
  readonly items: readonly { readonly key: string; readonly text: string }[];
  readonly onRemove: (key: string) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {props.items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-center gap-2 text-[13px] text-depot-ink">
          <span className="min-w-0 truncate">{item.text}</span>
          <button
            type="button"
            className="depot-link text-[11px]"
            onClick={() => props.onRemove(item.key)}
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
