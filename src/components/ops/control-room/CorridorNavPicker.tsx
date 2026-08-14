'use client';

import { useRouter, usePathname } from 'next/navigation';
import type { RouteDirectionMeta } from '@/models/control';
import { CorridorPicker } from './CorridorPicker';

/**
 * The corridor picker on a server-rendered page, where changing corridor IS a
 * navigation.
 *
 * The console keeps its corridor in client state on purpose — a navigation
 * there would tear down and remount Google Maps on every change and lose the
 * operator's camera mid-shift. The observability and copilot pages have no map
 * and are plain server renders, so for them a `?routeDirectionId=` navigation
 * is the right and simpler thing, and it keeps their URLs shareable.
 *
 * Split into its own file so `CorridorPicker` stays free of router hooks and
 * can be rendered by anything, including a test, without an App Router
 * context around it.
 */
export function CorridorNavPicker({
  corridors,
  selectedId,
  label,
}: {
  corridors: readonly RouteDirectionMeta[];
  selectedId: string | null;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  if (corridors.length === 0) return null;

  return (
    <div className="max-w-sm">
      <CorridorPicker
        corridors={corridors}
        value={selectedId}
        label={label}
        onChange={(routeDirectionId) => {
          router.push(`${pathname}?routeDirectionId=${encodeURIComponent(routeDirectionId)}`);
        }}
      />
    </div>
  );
}
