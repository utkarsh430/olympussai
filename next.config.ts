import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The live fleet payload is ~3.8 MB of JSON on every 15s poll. Compression
  // takes it to a few hundred KB, which matters on presentation-room wifi.
  compress: true,
  // A stray lockfile in the parent directory makes Next infer the wrong
  // workspace root; pin it to this project.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
