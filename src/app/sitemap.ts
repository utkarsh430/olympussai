import type { MetadataRoute } from 'next';

const SITE_URL = process.env.SITE_URL ?? 'https://olympuss.us';

/**
 * Sitemap (Section 39) — public, indexable routes only. The protected project
 * area and login are intentionally excluded.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
