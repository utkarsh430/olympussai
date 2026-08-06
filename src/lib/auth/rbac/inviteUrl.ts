/**
 * Shared accept-URL construction, used by both the create-invite and
 * resend-invite route handlers so the two never drift.
 */
import 'server-only';

export function siteUrl(): string {
  return process.env.SITE_URL ?? 'https://olympuss.us';
}

/** Builds the one-time accept URL for a raw (unhashed) invite token. */
export function buildAcceptUrl(token: string): URL {
  const url = new URL('/ops/accept-invite', siteUrl());
  url.searchParams.set('token', token);
  return url;
}
