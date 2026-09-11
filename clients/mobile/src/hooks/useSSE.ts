import { useEffect, useRef } from 'react';
import type { DaemonClient } from '../daemonClient';
import type { EventSubscription } from '../daemon/sse';

export function useSSE(client: DaemonClient | null, onEvent: EventSubscription['onEvent'],
  onStatus: EventSubscription['onStatus'], onMalformed?: EventSubscription['onMalformed']): void {
  const callbacks = useRef({ onEvent, onStatus, onMalformed });
  callbacks.current = { onEvent, onStatus, onMalformed };
  useEffect(() => {
    if (!client) { callbacks.current.onStatus(false); return; }
    return client.subscribeEvents({
      onEvent: event => callbacks.current.onEvent(event),
      onStatus: connected => callbacks.current.onStatus(connected),
      onMalformed: (raw, error) => callbacks.current.onMalformed?.(raw, error),
    });
  }, [client]);
}
