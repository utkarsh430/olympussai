'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import {
  depotIdFromPath,
  filterScopeOptions,
  moveActiveIndex,
  NETWORK_SCOPE_KEY,
  scopeLabel,
  scopeOptions,
  type ActiveMove,
  type ScopeOption,
} from '@/lib/depot/depotNav';

const MOVE_KEYS: Readonly<Record<string, ActiveMove>> = {
  ArrowDown: 'next',
  ArrowUp: 'previous',
  Home: 'first',
  End: 'last',
};
const CRUMB = 'font-mono text-[11px] uppercase tracking-[0.16em]';

/**
 * The scope crumb in the top bar, and the way between the network and one depot.
 * A button opens a filterable listbox following the WAI-ARIA combobox pattern:
 * the text field owns focus and points at the active option with
 * `aria-activedescendant`; Up and Down wrap around, Home and End jump, Enter
 * selects, Escape closes and returns focus to the button. Built by hand because a
 * native `<datalist>` cannot be styled and gives no control over the keyboard.
 */
export function ScopeSwitcher() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { data, error, loading } = useDepotNetworkContext();
  const depotId = depotIdFromPath(pathname);
  const depots = data?.depots ?? null;
  const label = scopeLabel(depotId, depots);
  const options = useMemo(() => (depots ? scopeOptions(depots) : []), [depots]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const visible = useMemo(() => filterScopeOptions(options, query), [options, query]);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number): string => `${baseId}-option-${index}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback((returnFocus: boolean): void => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  const openList = (): void => {
    const current = options.findIndex((o) => o.key === (depotId ?? NETWORK_SCOPE_KEY));
    setQuery('');
    setActive(current === -1 ? 0 : current);
    setOpen(true);
  };

  const select = (option: ScopeOption): void => {
    close(true);
    router.push(option.href);
  };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${baseId}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, baseId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const move = MOVE_KEYS[event.key];
    if (move) {
      event.preventDefault();
      setActive((index) => moveActiveIndex(index, move, visible.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = visible[active];
      if (option) select(option);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const onQueryChange = (value: string): void => {
    setQuery(value);
    setActive(filterScopeOptions(options, value).length > 0 ? 0 : -1);
  };

  if (!data && error && !loading) {
    return (
      <p
        data-testid="depot-scope-switcher"
        className={`${CRUMB} min-w-0 truncate text-depot-faint`}
      >
        {label}
        <span className="ml-2 normal-case tracking-normal text-depot-muted">
          Depot list unavailable
        </span>
      </p>
    );
  }

  return (
    <div ref={rootRef} data-testid="depot-scope-switcher" className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Scope: ${label}. Change scope`}
        disabled={!data}
        onClick={() => (open ? close(false) : openList())}
        className={`${CRUMB} flex min-w-0 max-w-[22rem] items-center gap-1.5 rounded-[3px] px-1.5 py-1 text-depot-muted hover:bg-depot-raised hover:text-depot-ink disabled:cursor-wait disabled:hover:bg-transparent`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </button>
      {open ? (
        <div className="depot-panel absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] p-2">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Filter depots by name or id"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Filter depots"
            autoComplete="off"
            spellCheck={false}
            className="depot-field w-full"
          />
          <p role="status" className="sr-only">
            {visible.length === 1 ? '1 scope' : `${visible.length} scopes`}
          </p>
          {visible.length === 0 ? (
            <p className="depot-prose px-2 py-3">No depot matches that name or id.</p>
          ) : null}
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Scopes"
            className="mt-2 max-h-72 overflow-y-auto"
          >
            {visible.map((option, index) => (
              <li
                key={option.key}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => select(option)}
                className={`flex cursor-pointer items-baseline justify-between gap-3 border-l-2 px-2 py-1.5 ${
                  index === active
                    ? 'border-holo-glow bg-depot-raised text-holo-glow'
                    : 'border-transparent text-depot-ink'
                }`}
              >
                <span className="min-w-0 truncate text-[13px]">{option.label}</span>
                <span className="shrink-0 text-[11px] text-depot-muted">
                  {option.key === (depotId ?? NETWORK_SCOPE_KEY) ? 'Current · ' : ''}
                  {option.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
