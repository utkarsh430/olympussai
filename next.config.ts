import type { NextConfig } from 'next';
import path from 'node:path';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Content-Security-Policy (production only — dev needs eval/websocket for HMR).
 *
 * Deliberately permissive enough not to break the things this app actually
 * needs: Next's inline bootstrap ('unsafe-inline'), the Google Maps JS SDK used
 * by the dashboard (script/img/connect to the maps + gstatic origins), Next's
 * self-hosted fonts, and WebGL (all self / blob / data — three.js is bundled and
 * textures are generated in-canvas). 'unsafe-inline'/'unsafe-eval' on scripts is
 * a known trade-off to tighten later with per-request nonces.
 *
 * `frame-ancestors 'none'` forbids embedding (no clickjacking, no iframe reuse
 * of the dashboard); `base-uri`/`form-action 'self'` and `object-src 'none'`
 * close common injection vectors.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://maps.googleapis.com https://*.googleapis.com",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    // Restrict powerful features the app does not use. Fullscreen is left at its
    // default (self-allowed) because the dashboard uses requestFullscreen().
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProd
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
        { key: 'Content-Security-Policy', value: csp },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The live fleet payload is ~3.8 MB of JSON on every 15s poll. Compression
  // takes it to a few hundred KB, which matters on presentation-room wifi.
  compress: true,
  // A stray lockfile in the parent directory makes Next infer the wrong
  // workspace root; pin it to this project.
  outputFileTracingRoot: path.resolve(__dirname),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
