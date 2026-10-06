/*
 * What a rendered depot page must never show: the word "simulated" (the
 * on-screen word is MODELLED) and a raw ISO date (every date goes through
 * `formatPlainDate`). Both are checked in the visible text and in every
 * attribute a person or a screen reader can meet (`title`, `aria-label` and
 * the rest). Only `datetime` is exempt: it is the machine-readable form of a
 * date the text shows in words.
 */

export const RAW_DATE = /\d{4}-\d{2}-\d{2}/;
const BANNED_WORD = /simulated/i;
const MACHINE_ONLY = new Set(['datetime']);

function rootOf(rendered: Element | string): Element {
  if (typeof rendered !== 'string') return rendered;
  const frame = document.createElement('div');
  frame.innerHTML = rendered;
  return frame;
}

/** Each place on the page that shows the banned word or a raw date, described. */
export function bannedOnScreen(rendered: Element | string): string[] {
  const root = rootOf(rendered);
  const pieces = [
    { where: 'text', value: root.textContent ?? '' },
    ...[root, ...Array.from(root.querySelectorAll('*'))].flatMap((el) =>
      Array.from(el.attributes)
        .filter((a) => !MACHINE_ONLY.has(a.name.toLowerCase()))
        .map((a) => ({ where: `${el.tagName.toLowerCase()}[${a.name}]`, value: a.value })),
    ),
  ];
  return pieces.flatMap(({ where, value }) => [
    ...(BANNED_WORD.test(value) ? [`"simulated" in ${where}`] : []),
    ...(RAW_DATE.test(value) ? [`raw date in ${where}: ${value.match(RAW_DATE)?.[0]}`] : []),
  ]);
}
