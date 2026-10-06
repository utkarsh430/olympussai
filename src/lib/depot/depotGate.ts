import 'server-only';
import { notFound } from 'next/navigation';
import { requireProjectSession } from '@/lib/auth/server';
import { depotHref } from './depotNav';
import { isValidDepotId } from './ids';

/**
 * Gate for every page under one depot.
 *
 * The depot id comes from the URL, so it is checked first: a malformed id ends
 * in the not-found page and never reaches the session redirect, a link or a
 * request. `subPath` is a fixed literal chosen by the page (`'/roster'`), never
 * user input.
 */
export async function requireDepotPage(depotId: string, subPath = ''): Promise<void> {
  if (!isValidDepotId(depotId)) notFound();
  await requireProjectSession(`${depotHref(depotId)}${subPath}`);
}
