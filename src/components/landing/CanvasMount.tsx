'use client';

import dynamic from 'next/dynamic';

/**
 * Client boundary for the WebGL canvas. `next/dynamic` with `ssr: false` is only
 * permitted inside a Client Component, so the server landing page mounts the
 * experience through here. The heavy three.js bundle loads lazily on the client.
 */
const ExperienceCanvas = dynamic(() => import('@/three/ExperienceCanvas'), { ssr: false });

export function CanvasMount() {
  return <ExperienceCanvas />;
}
