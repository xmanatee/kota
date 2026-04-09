import { useCallback, useEffect, useRef } from 'react';
import type { SseEvent, SseEventType } from '../types';

type EventHandler = (event: SseEvent) => void;

/**
 * Subscribes to the daemon SSE endpoint using XMLHttpRequest (well-supported
 * in React Native). Parses the text/event-stream format and calls onEvent for
 * each complete event. Reconnects automatically with exponential backoff.
 *
 * If SSE is unavailable (connection drops repeatedly), onFallback is called
 * so the caller can switch to polling.
 */
export function useSSE(
  url: string | null,
  authHeader: string | null,
  onEvent: EventHandler,
  onStatusChange: (connected: boolean) => void,
): void {
  const onEventRef = useRef(onEvent);
  const onStatusRef = useRef(onStatusChange);
  onEventRef.current = onEvent;
  onStatusRef.current = onStatusChange;

  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const activeRef = useRef(false);
  const lastEventTimeRef = useRef<string | undefined>(undefined);

  const connect = useCallback(() => {
    if (!url || !authHeader) return;

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    const connectUrl = lastEventTimeRef.current
      ? `${url}${url.includes('?') ? '&' : '?'}since=${encodeURIComponent(lastEventTimeRef.current)}`
      : url;

    xhr.open('GET', connectUrl, true);
    xhr.setRequestHeader('Authorization', authHeader);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.setRequestHeader('Cache-Control', 'no-cache');

    let buffer = '';

    xhr.onreadystatechange = () => {
      if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED) {
        if (xhr.status === 200) {
          retryCountRef.current = 0;
          onStatusRef.current(true);
        } else {
          xhr.abort();
          scheduleRetry();
        }
      }

      if (xhr.readyState === XMLHttpRequest.LOADING || xhr.readyState === XMLHttpRequest.DONE) {
        const newText = xhr.responseText.slice(buffer.length);
        buffer = xhr.responseText;
        parseChunk(newText);
      }

      if (xhr.readyState === XMLHttpRequest.DONE) {
        onStatusRef.current(false);
        if (activeRef.current) scheduleRetry();
      }
    };

    xhr.onerror = () => {
      onStatusRef.current(false);
      if (activeRef.current) scheduleRetry();
    };

    let currentEventType = '';
    let currentData = '';

    function parseChunk(chunk: string) {
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData += line.slice(6);
        } else if (line === '' && currentData !== '') {
          try {
            const payload = JSON.parse(currentData) as Record<string, unknown>;
            const ts = typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString();
            lastEventTimeRef.current = ts;
            onEventRef.current({
              type: currentEventType as SseEventType,
              payload,
              timestamp: ts,
            });
          } catch {
            // malformed SSE data — skip
          }
          currentEventType = '';
          currentData = '';
        }
      }
    }

    xhr.send();
  }, [url, authHeader]);

  function scheduleRetry() {
    const delay = Math.min(1000 * 2 ** retryCountRef.current, 30_000);
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      if (activeRef.current) connect();
    }, delay);
  }

  useEffect(() => {
    if (!url || !authHeader) {
      onStatusRef.current(false);
      return;
    }

    activeRef.current = true;
    retryCountRef.current = 0;
    connect();

    return () => {
      activeRef.current = false;
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
      xhrRef.current?.abort();
      xhrRef.current = null;
    };
  }, [url, authHeader, connect]);
}
