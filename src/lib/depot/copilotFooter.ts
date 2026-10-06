import { isLaterFeedTime } from './format';

/**
 * Wording of the copilot output footer: one mono line under the
 * prose, `SCRIPTED · written 14:00 · 18 figures`. The writer is always a word.
 */

export type CopilotWriter = 'claude' | 'scripted';

const WRITER_WORD: Readonly<Record<CopilotWriter, string>> = {
  claude: 'CLAUDE',
  scripted: 'SCRIPTED',
};

const IST_TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
});

export function writerWord(writer: CopilotWriter): string {
  return WRITER_WORD[writer];
}

/**
 * "written 14:00" from the server's real ISO instant (unlike feed stamps, it is a true
 * instant, so it is shown in Indian time with a fixed zone); "written just now" if it
 * does not parse; ", reused" when the server answered from its cache for this snapshot.
 */
export function writtenWords(generatedAt: string, cached: boolean): string {
  const date = new Date(generatedAt);
  const base = Number.isNaN(date.getTime()) ? 'written just now' : `written ${IST_TIME.format(date)}`;
  return cached ? `${base}, reused` : base;
}

export function figureWords(count: number): string {
  if (count === 0) return 'no figures';
  return `${count} ${count === 1 ? 'figure' : 'figures'}`;
}

/** True when the page shows a newer feed snapshot than the one the text was written from. */
export function isOutdatedText(writtenFromFeed: string | null, currentFeed: string | null): boolean {
  return isLaterFeedTime(currentFeed, writtenFromFeed);
}

export const OUTDATED_SENTENCE = 'The page has updated since; write again.';
