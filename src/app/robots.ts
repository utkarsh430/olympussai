import type { MetadataRoute } from 'next';

const SITE_URL = process.env.SITE_URL ?? 'https://olympuss.us';

/**
 * Crawler policy (Section 39). Only the public homepage is indexable; the login
 * page, all protected project routes, and all APIs are disallowed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/login', '/project/', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
