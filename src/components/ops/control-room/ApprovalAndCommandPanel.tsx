'use client';

import { useState } from 'react';
import { ApprovalQueuePanel } from '@/components/ops/ApprovalQueuePanel';
import { ControlRoomCommandForm } from './ControlRoomCommandForm';

/**
 * Control-room's approval queue + command form, wired together: clicking
 * "Approve — issue command" on a queued item seeds ControlRoomCommandForm's
 * dispatcherActionId field and scrolls it into view, so approving stays a
 * single functional in-page flow rather than a copy/paste between two
 * disconnected panels.
 */
export function ApprovalAndCommandPanel() {
  const [prefillDispatcherActionId, setPrefillDispatcherActionId] = useState<string | undefined>(undefined);

  function handleApprove(dispatcherActionId: string) {
    setPrefillDispatcherActionId(dispatcherActionId);
    document.getElementById('control-room-command-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="space-y-4">
      <ApprovalQueuePanel canDecide onApprove={handleApprove} />
      <ControlRoomCommandForm prefillDispatcherActionId={prefillDispatcherActionId} />
    </div>
  );
}
