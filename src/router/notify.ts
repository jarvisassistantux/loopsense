import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { markEventsNotified } from '../store/db.js';
import type { LoopSenseEvent } from '../types.js';

function sendNotification(server: Server, uri: string): void {
  try {
    const result = server.notification({
      method: 'notifications/resources/updated',
      params: { uri },
    });
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    // Client doesn't support notifications — poll_events is the fallback
  }
}

export function createNotifyFn(server: Server): (event: LoopSenseEvent) => void {
  return (event: LoopSenseEvent) => {
    const primaryUri = event.action_id
      ? `loopsense://consequences/${event.action_id}`
      : 'loopsense://timeline/recent';

    sendNotification(server, primaryUri);

    if (event.action_id) {
      sendNotification(server, 'loopsense://timeline/recent');
    }

    markEventsNotified([event.id]);
  };
}
